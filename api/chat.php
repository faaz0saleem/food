<?php
require_once __DIR__ . '/_config.php';

mm_handle_options();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$body = mm_read_json_body();
$message = trim((string) ($body['message'] ?? ''));
$subject = trim((string) ($body['subject'] ?? 'General'));
$userLevel = trim((string) ($body['userLevel'] ?? 'Newbie'));

if ($message === '') {
    mm_json_response(400, ['error' => 'A message is required.']);
    exit;
}

$model = mm_env_value('GROQ_MODEL', 'llama-3.3-70b-versatile');
$openaiModel = mm_env_value('OPENAI_MODEL', 'gpt-4o');
$anthropicModel = mm_env_value('ANTHROPIC_MODEL', 'claude-sonnet-4-20250514');

$history = mm_normalize_history($body['history'] ?? []);
$attachments = mm_normalize_attachments($body['attachments'] ?? []);
$finalMessage = mm_build_final_message($message, $attachments);

$budget = mm_ai_budget_decision($body, 1);
if (($budget['mode'] ?? 'live') === 'signup') {
    mm_json_response(403, ['error' => (string) $budget['message'], 'requiresSignup' => true]);
    exit;
}
if (($budget['mode'] ?? 'live') === 'limit') {
    mm_json_response(429, ['error' => (string) $budget['message'], 'dailyLimitReached' => true]);
    exit;
}
if (($budget['mode'] ?? 'live') === 'demo') {
    $demoReply = mm_demo_chat_reply($subject, $message);
    mm_json_response(200, [
        'status' => 'ok',
        'reply' => $demoReply,
        'engine' => 'Demo',
        'model' => $model,
        'demoMode' => true,
    ]);
    exit;
}

$systemPrompt = mm_build_system_prompt($subject, $userLevel);

/**
 * Build multimodal user content for providers that support image inputs.
 */
function mm_build_vision_user_content(string $message, array $attachments, string $provider): array {
    $parts = [];
    $message = trim($message);
    $files = [];
    $images = [];

    foreach ($attachments as $attachment) {
        $kind = (string) ($attachment['kind'] ?? 'file');
        if ($kind === 'image' && !empty($attachment['imageDataUrl'])) {
            $images[] = $attachment;
            continue;
        }
        if (!empty($attachment['textContent'])) {
            $files[] = $attachment;
        }
    }

    $text = $message;
    if (!empty($files)) {
        $fileBlocks = [];
        foreach ($files as $file) {
            $fileBlocks[] = '[File: ' . (string) ($file['name'] ?? 'attachment') . "]\n" . (string) ($file['textContent'] ?? '');
        }
        $text .= "\n\n" . implode("\n\n", $fileBlocks);
    }

    if ($provider === 'openai') {
        $parts[] = ['type' => 'text', 'text' => $text];
        foreach (array_slice($images, 0, 3) as $image) {
            $parts[] = [
                'type' => 'image_url',
                'image_url' => ['url' => (string) $image['imageDataUrl']],
            ];
        }
        return $parts;
    }

    // anthropic format
    $parts[] = ['type' => 'text', 'text' => $text];
    foreach (array_slice($images, 0, 3) as $image) {
        $dataUrl = (string) $image['imageDataUrl'];
        if (preg_match('/^data:([^;]+);base64,(.+)$/s', $dataUrl, $matches) !== 1) {
            continue;
        }
        $parts[] = [
            'type' => 'image',
            'source' => [
                'type' => 'base64',
                'media_type' => (string) $matches[1],
                'data' => (string) $matches[2],
            ],
        ];
    }
    return $parts;
}

function mm_call_openai_chat(array $messages, string $model): array {
    $apiKey = mm_env_value('OPENAI_API_KEY', '');
    if ($apiKey === '') {
        return ['ok' => false, 'status' => 500, 'error' => 'Missing OPENAI_API_KEY', 'reply' => ''];
    }

    $payload = [
        'model' => $model,
        'messages' => $messages,
        'max_tokens' => 700,
    ];

    $ch = curl_init('https://api.openai.com/v1/chat/completions');
    if ($ch === false) {
        return ['ok' => false, 'status' => 500, 'error' => 'Failed to initialize OpenAI request', 'reply' => ''];
    }

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $apiKey,
        ],
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_TIMEOUT => 45,
    ]);

    $responseRaw = curl_exec($ch);
    $curlError = curl_error($ch);
    $statusCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($responseRaw === false) {
        return ['ok' => false, 'status' => 500, 'error' => 'OpenAI request failed: ' . $curlError, 'reply' => ''];
    }

    $responseData = json_decode($responseRaw, true);
    if (!is_array($responseData)) {
        return ['ok' => false, 'status' => 500, 'error' => 'Invalid OpenAI response', 'reply' => ''];
    }

    if ($statusCode >= 400) {
        $errorMessage = (string) ($responseData['error']['message'] ?? 'OpenAI API error');
        return ['ok' => false, 'status' => $statusCode, 'error' => $errorMessage, 'reply' => ''];
    }

    $reply = trim((string) ($responseData['choices'][0]['message']['content'] ?? ''));
    return ['ok' => true, 'status' => 200, 'error' => '', 'reply' => $reply];
}

function mm_call_anthropic_chat(array $messages, string $systemPrompt, string $model): array {
    $apiKey = mm_env_value('ANTHROPIC_API_KEY', '');
    if ($apiKey === '') {
        return ['ok' => false, 'status' => 500, 'error' => 'Missing ANTHROPIC_API_KEY', 'reply' => ''];
    }

    $payload = [
        'model' => $model,
        'max_tokens' => 700,
        'system' => $systemPrompt,
        'messages' => $messages,
    ];

    $ch = curl_init('https://api.anthropic.com/v1/messages');
    if ($ch === false) {
        return ['ok' => false, 'status' => 500, 'error' => 'Failed to initialize Anthropic request', 'reply' => ''];
    }

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'x-api-key: ' . $apiKey,
            'anthropic-version: 2023-06-01',
        ],
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_TIMEOUT => 45,
    ]);

    $responseRaw = curl_exec($ch);
    $curlError = curl_error($ch);
    $statusCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($responseRaw === false) {
        return ['ok' => false, 'status' => 500, 'error' => 'Anthropic request failed: ' . $curlError, 'reply' => ''];
    }

    $responseData = json_decode($responseRaw, true);
    if (!is_array($responseData)) {
        return ['ok' => false, 'status' => 500, 'error' => 'Invalid Anthropic response', 'reply' => ''];
    }

    if ($statusCode >= 400) {
        $errorMessage = (string) ($responseData['error']['message'] ?? 'Anthropic API error');
        return ['ok' => false, 'status' => $statusCode, 'error' => $errorMessage, 'reply' => ''];
    }

    $reply = '';
    if (!empty($responseData['content']) && is_array($responseData['content'])) {
        foreach ($responseData['content'] as $block) {
            if (is_array($block) && ($block['type'] ?? '') === 'text') {
                $reply .= (string) ($block['text'] ?? '');
            }
        }
    }
    return ['ok' => true, 'status' => 200, 'error' => '', 'reply' => trim($reply)];
}

$hasImages = false;
foreach ($attachments as $attachment) {
    if (($attachment['kind'] ?? 'file') === 'image' && !empty($attachment['imageDataUrl'])) {
        $hasImages = true;
        break;
    }
}

$result = ['ok' => false, 'status' => 500, 'error' => 'No provider available', 'reply' => ''];
$engineName = 'Reasoner';
$modelUsed = $model;

if ($hasImages) {
    $openaiKey = mm_env_value('OPENAI_API_KEY', '');
    $anthropicKey = mm_env_value('ANTHROPIC_API_KEY', '');

    if ($openaiKey !== '') {
        $openaiMessages = [
            ['role' => 'system', 'content' => $systemPrompt],
        ];
        foreach ($history as $item) {
            $openaiMessages[] = $item;
        }
        $openaiMessages[] = [
            'role' => 'user',
            'content' => mm_build_vision_user_content($message, $attachments, 'openai'),
        ];
        $result = mm_call_openai_chat($openaiMessages, $openaiModel);
        if ($result['ok']) {
            $engineName = 'Explorer';
            $modelUsed = $openaiModel;
        }
    }

    if (!$result['ok'] && $anthropicKey !== '') {
        $anthropicMessages = [];
        foreach ($history as $item) {
            $anthropicMessages[] = [
                'role' => (string) ($item['role'] ?? 'user'),
                'content' => (string) ($item['content'] ?? ''),
            ];
        }
        $anthropicMessages[] = [
            'role' => 'user',
            'content' => mm_build_vision_user_content($message, $attachments, 'anthropic'),
        ];
        $result = mm_call_anthropic_chat($anthropicMessages, $systemPrompt, $anthropicModel);
        if ($result['ok']) {
            $engineName = 'Storyteller';
            $modelUsed = $anthropicModel;
        }
    }
}

$messages = [
    ['role' => 'system', 'content' => $systemPrompt],
];
foreach ($history as $item) {
    $messages[] = $item;
}
$messages[] = ['role' => 'user', 'content' => $finalMessage];

if (!$result['ok']) {
    $result = mm_call_groq($messages, 0.5, 700);
    if ($result['ok']) {
        $engineName = 'Reasoner';
        $modelUsed = $model;
    }
}

if (!$result['ok']) {
    mm_json_response((int) ($result['status'] ?? 500), ['error' => (string) ($result['error'] ?? 'Groq API error')]);
    exit;
}

$reply = trim((string) ($result['reply'] ?? ''));
if ($reply === '') {
    $reply = "Sorry, I couldn't generate a response right now.";
}

try {
    mm_track_visit((string) ($body['visitorId'] ?? ''));
    mm_record_chat($body, $reply, $engineName, $modelUsed);
    mm_record_ai_usage((string) ($budget['scopeKey'] ?? mm_ai_scope_key($body)), isset($budget['user']['id']) ? (int) $budget['user']['id'] : null, 1);
} catch (Throwable $error) {
    // Do not fail chat delivery if analytics storage is unavailable.
}

mm_json_response(200, [
    'status' => 'ok',
    'reply' => $reply,
    'engine' => $engineName,
    'model' => $modelUsed,
]);

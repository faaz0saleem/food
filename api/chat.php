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
$learningStyle = trim((string) ($body['learningStyle'] ?? ''));
$engineMode = strtolower(trim((string) ($body['engineMode'] ?? $body['engine'] ?? 'auto')));
$excludeEngine = trim((string) ($body['excludeEngine'] ?? ''));

if ($message === '') {
    mm_json_response(400, ['error' => 'A message is required.']);
    exit;
}

$history = mm_normalize_history($body['history'] ?? []);
$attachments = mm_normalize_attachments($body['attachments'] ?? []);

// Split attachments: file text is inlined into the message, images go to vision providers.
$images = [];
$files = [];
foreach ($attachments as $attachment) {
    if (($attachment['kind'] ?? 'file') === 'image' && !empty($attachment['imageDataUrl'])) {
        $images[] = (string) $attachment['imageDataUrl'];
        continue;
    }
    if (!empty($attachment['textContent'])) {
        $files[] = $attachment;
    }
}
$userText = $message;
if (count($files) > 0) {
    $fileBlocks = [];
    foreach ($files as $file) {
        $fileBlocks[] = '[File: ' . (string) ($file['name'] ?? 'attachment') . "]\n" . (string) ($file['textContent'] ?? '');
    }
    $userText .= "\n\n" . implode("\n\n", $fileBlocks);
}

$budget = mm_ai_budget_decision($body, $engineMode === 'all' ? 3 : 1);
if (($budget['mode'] ?? 'live') === 'signup') {
    mm_json_response(403, ['error' => (string) $budget['message'], 'requiresSignup' => true]);
    exit;
}
if (($budget['mode'] ?? 'live') === 'limit') {
    mm_json_response(429, ['error' => (string) $budget['message'], 'dailyLimitReached' => true]);
    exit;
}
if (($budget['mode'] ?? 'live') === 'demo') {
    mm_json_response(200, [
        'status' => 'ok',
        'reply' => mm_demo_chat_reply($subject, $message),
        'engine' => 'Demo',
        'model' => mm_env_value('GROQ_MODEL', 'llama-3.3-70b-versatile'),
        'demoMode' => true,
    ]);
    exit;
}

$engines = mm_engines_config();
$engineNames = [];
$reply = '';
$modelUsed = mm_env_value('GROQ_MODEL', 'llama-3.3-70b-versatile');
$usageCost = 1;

if ($engineMode === 'all') {
    // Orchestra mode: all four engines draft an answer, then a conductor pass
    // merges them into ONE best answer (instead of dumping four replies).
    $results = mm_call_engines_all($subject, $userLevel, $userText, $history, $images);
    if (count($results) > 0) {
        $drafts = [];
        foreach ($results as $result) {
            $drafts[] = '--- Draft from ' . $result['engine'] . " ---\n" . $result['reply'];
            $engineNames[] = mm_engine_display_name($result);
        }
        $conductorPrompt = "Four AI tutors each drafted an answer to the student's question below. "
            . "Synthesize them into ONE single best answer: keep the clearest explanation, the best example, "
            . "and anything one draft caught that others missed. Fix any disagreement by choosing what is correct. "
            . "Do NOT mention the drafts, the tutors, or the merging — just answer the student directly, "
            . "in the same concise tutoring style.\n\nStudent's question: " . $message . "\n\n" . implode("\n\n", $drafts);
        $synth = mm_call_engine('reasoner', $subject, $userLevel, $conductorPrompt, [], [], 900, 0.4);
        if ($synth['ok'] && trim((string) $synth['reply']) !== '') {
            $reply = (string) $synth['reply'];
            $modelUsed = (string) $synth['model'];
            $engineNames = ['⚡ Orchestra · ' . implode(' + ', array_map(fn ($r) => $r['engine'], $results))];
        } else {
            // Conductor unavailable — fall back to the classic side-by-side view.
            $sections = [];
            foreach ($results as $result) {
                $sections[] = '**' . $result['icon'] . ' ' . $result['engine'] . '** · _' . $result['providerLabel'] . "_\n\n" . $result['reply'];
            }
            $reply = implode("\n\n---\n\n", $sections);
            $modelUsed = (string) ($results[0]['model'] ?? $modelUsed);
        }
        $usageCost = count($results);
    }
} else {
    // Pick one engine: forced by the student, or routed by message content.
    $engineKey = isset($engines[$engineMode]) ? $engineMode : mm_route_engine($message, $subject, $learningStyle);
    if ($excludeEngine !== '' && ($engines[$engineKey]['name'] ?? '') === $excludeEngine) {
        foreach (array_keys($engines) as $altKey) {
            if (($engines[$altKey]['name'] ?? '') !== $excludeEngine && count(mm_engine_chain($altKey)) > 0) {
                $engineKey = $altKey;
                break;
            }
        }
    }
    $result = mm_call_engine($engineKey, $subject, $userLevel, $userText, $history, $images);
    if (!$result['ok'] && $engineKey !== 'reasoner') {
        $result = mm_call_engine('reasoner', $subject, $userLevel, $userText, $history, $images);
    }
    if ($result['ok']) {
        $reply = (string) $result['reply'];
        $engineNames[] = mm_engine_display_name($result);
        $modelUsed = (string) $result['model'];
    } else {
        $aiFailureDetail = (string) ($result['error'] ?? '');
    }
}

if ($reply === '') {
    // Never leave the student without an answer: fall back to the built-in
    // tutor reply and tell the site owner what actually broke.
    mm_json_response(200, [
        'status' => 'ok',
        'reply' => mm_demo_chat_reply($subject, $message),
        'engine' => 'Hungter',
        'model' => $modelUsed,
        'fallback' => true,
        'ownerHint' => ($aiFailureDetail ?? 'All AI providers failed or none are configured.') . ' → Owner: open /api/setup.php on this site to fix it in one step.',
    ]);
    exit;
}

try {
    mm_track_visit((string) ($body['visitorId'] ?? ''));
    mm_record_chat($body, $reply, implode(', ', $engineNames), $modelUsed);
    mm_record_ai_usage((string) ($budget['scopeKey'] ?? mm_ai_scope_key($body)), isset($budget['user']['id']) ? (int) $budget['user']['id'] : null, $usageCost);
} catch (Throwable $error) {
    // Do not fail chat delivery if analytics storage is unavailable.
}

mm_json_response(200, [
    'status' => 'ok',
    'reply' => $reply,
    'engine' => implode(', ', $engineNames),
    'model' => $modelUsed,
    'credits' => isset($budget['credits']) ? array_merge($budget['credits'], ['used' => ($budget['credits']['used'] ?? 0) + $usageCost, 'left' => max(0, ($budget['credits']['left'] ?? 0) - $usageCost)]) : null,
    'payg' => (bool) ($budget['payg'] ?? false),
]);

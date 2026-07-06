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

$groqKey = mm_env_value('GROQ_API_KEY', '');
$model = mm_env_value('GROQ_MODEL', 'llama-3.3-70b-versatile');

if ($groqKey === '') {
    mm_json_response(500, ['error' => 'Missing GROQ_API_KEY on server']);
    exit;
}

$history = mm_normalize_history($body['history'] ?? []);
$attachments = mm_normalize_attachments($body['attachments'] ?? []);
$finalMessage = mm_build_final_message($message, $attachments);

$systemPrompt = 'You are Hungter, an AI tutor. You ONLY help with educational topics and you decline off-topic requests by redirecting to learning. '
    . 'Subject focus: ' . ($subject !== '' ? $subject : 'General') . '. '
    . 'Learner level: ' . ($userLevel !== '' ? $userLevel : 'Newbie') . '. '
    . 'Be concise: 2-4 sentences unless the student asks for or clearly needs a worked example.';

$messages = [
    ['role' => 'system', 'content' => $systemPrompt],
];
foreach ($history as $item) {
    $messages[] = $item;
}
$messages[] = ['role' => 'user', 'content' => $finalMessage];

$payload = [
    'model' => $model,
    'temperature' => 0.5,
    'max_tokens' => 700,
    'messages' => $messages,
];

$ch = curl_init('https://api.groq.com/openai/v1/chat/completions');
if ($ch === false) {
    mm_json_response(500, ['error' => 'Failed to initialize request']);
    exit;
}

curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $groqKey,
    ],
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_TIMEOUT => 30,
]);

$responseRaw = curl_exec($ch);
$curlError = curl_error($ch);
$statusCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($responseRaw === false) {
    mm_json_response(500, ['error' => 'Groq request failed: ' . $curlError]);
    exit;
}

$responseData = json_decode($responseRaw, true);
if (!is_array($responseData)) {
    mm_json_response(500, ['error' => 'Invalid Groq response']);
    exit;
}

if ($statusCode >= 400) {
    $errorMessage = (string) ($responseData['error']['message'] ?? 'Groq API error');
    mm_json_response($statusCode, ['error' => $errorMessage]);
    exit;
}

$reply = trim((string) ($responseData['choices'][0]['message']['content'] ?? ''));
if ($reply === '') {
    $reply = "Sorry, I couldn't generate a response right now.";
}

mm_json_response(200, [
    'status' => 'ok',
    'reply' => $reply,
    'engine' => 'Reasoner',
    'model' => $model,
]);

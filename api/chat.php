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

$history = mm_normalize_history($body['history'] ?? []);
$attachments = mm_normalize_attachments($body['attachments'] ?? []);
$finalMessage = mm_build_final_message($message, $attachments);

$systemPrompt = mm_build_system_prompt($subject, $userLevel);

$messages = [
    ['role' => 'system', 'content' => $systemPrompt],
];
foreach ($history as $item) {
    $messages[] = $item;
}
$messages[] = ['role' => 'user', 'content' => $finalMessage];

$result = mm_call_groq($messages, 0.5, 700);
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
    mm_record_chat($body, $reply, 'Reasoner', $model);
} catch (Throwable $error) {
    // Do not fail chat delivery if analytics storage is unavailable.
}

mm_json_response(200, [
    'status' => 'ok',
    'reply' => $reply,
    'engine' => 'Reasoner',
    'model' => $model,
]);

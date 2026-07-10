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
    mm_record_ai_usage((string) ($budget['scopeKey'] ?? mm_ai_scope_key($body)), isset($budget['user']['id']) ? (int) $budget['user']['id'] : null, 1);
} catch (Throwable $error) {
    // Do not fail chat delivery if analytics storage is unavailable.
}

mm_json_response(200, [
    'status' => 'ok',
    'reply' => $reply,
    'engine' => 'Reasoner',
    'model' => $model,
]);

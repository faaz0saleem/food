<?php
require_once __DIR__ . '/_config.php';

mm_handle_options();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$body = mm_read_json_body();
$engineKey = trim((string) ($body['engineKey'] ?? 'reasoner'));
$message = trim((string) ($body['message'] ?? ''));
$subject = trim((string) ($body['subject'] ?? 'General'));
$userLevel = trim((string) ($body['userLevel'] ?? 'Newbie'));

$budget = mm_ai_budget_decision($body, 1);
if (($budget['mode'] ?? 'live') === 'signup') {
    mm_json_response(403, ['error' => (string) $budget['message'], 'requiresSignup' => true]);
    exit;
}
if (($budget['mode'] ?? 'live') === 'limit') {
    mm_json_response(429, ['error' => (string) $budget['message'], 'dailyLimitReached' => true]);
    exit;
}

if ($message === '') {
    mm_json_response(400, ['error' => 'engineKey and message are required.']);
    exit;
}

if (($budget['mode'] ?? 'live') === 'demo') {
    mm_json_response(200, [
        'status' => 'ok',
        'reply' => mm_demo_chat_reply($subject, $message),
        'engine' => 'Demo',
        'demoMode' => true,
    ]);
    exit;
}

$engines = mm_engines_config();
if (!isset($engines[$engineKey])) {
    $engineKey = 'reasoner';
}
$engineName = $engines[$engineKey]['name'];

$userPrompt = $message . "\n\nExpand this answer from the " . $engineName . " perspective in 3-5 concise sentences.";
$result = mm_call_engine($engineKey, $subject, $userLevel, $userPrompt, [], [], 700, 0.6);

if (!$result['ok']) {
    mm_json_response(500, ['error' => (string) ($result['error'] ?? 'AI request failed')]);
    exit;
}

mm_json_response(200, [
    'status' => 'ok',
    'reply' => (string) $result['reply'],
    'engine' => mm_engine_display_name($result),
]);
mm_record_ai_usage((string) ($budget['scopeKey'] ?? mm_ai_scope_key($body)), isset($budget['user']['id']) ? (int) $budget['user']['id'] : null, 1);

<?php
require_once __DIR__ . '/_config.php';

mm_handle_options();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$body = mm_read_json_body();
$engineKey = trim((string) ($body['engineKey'] ?? ''));
$message = trim((string) ($body['message'] ?? ''));
$subject = trim((string) ($body['subject'] ?? 'General'));
$userLevel = trim((string) ($body['userLevel'] ?? 'Newbie'));

if ($engineKey === '' || $message === '') {
    mm_json_response(400, ['error' => 'engineKey and message are required.']);
    exit;
}

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
    mm_json_response(200, [
        'status' => 'ok',
        'reply' => mm_demo_chat_reply($subject, $message),
        'engine' => 'Hungter',
        'demoMode' => true,
    ]);
    exit;
}

$result = mm_call_engine($engineKey, $subject, $userLevel, $message, [], [], 900, 0.7);

try {
    mm_record_ai_usage((string) ($budget['scopeKey'] ?? mm_ai_scope_key($body)), isset($budget['user']['id']) ? (int) $budget['user']['id'] : null, 1);
} catch (Throwable $error) {
    // Do not fail delivery if analytics storage is unavailable.
}

mm_json_response(200, [
    'status' => 'ok',
    'reply' => $result['ok'] ? $result['reply'] : 'Unable to expand this answer right now.',
    'engine' => $result['ok'] ? mm_engine_display_name($result) : $engineKey,
]);

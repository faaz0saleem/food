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

$engineMeta = [
    'reasoner' => ['name' => 'Reasoner', 'extra' => 'Focus on logic, derivations, and clear steps.'],
    'explorer' => ['name' => 'Explorer', 'extra' => 'Focus on real-world applications and practical examples.'],
    'storyteller' => ['name' => 'Storyteller', 'extra' => 'Use analogy or short narrative to make the idea memorable.'],
];
$meta = $engineMeta[$engineKey] ?? $engineMeta['reasoner'];

$systemPrompt = mm_build_system_prompt($subject, $userLevel, $meta['extra']);
$userPrompt = $message . "\n\nExpand this answer from the " . $meta['name'] . " perspective in 3-5 concise sentences.";

$result = mm_call_groq([
    ['role' => 'system', 'content' => $systemPrompt],
    ['role' => 'user', 'content' => $userPrompt],
], 0.6, 700);

if (!$result['ok']) {
    mm_json_response((int) ($result['status'] ?? 500), ['error' => (string) ($result['error'] ?? 'AI request failed')]);
    exit;
}

$reply = trim((string) ($result['reply'] ?? ''));
if ($reply === '') {
    $reply = 'Unable to expand this answer right now.';
}

mm_json_response(200, [
    'status' => 'ok',
    'reply' => $reply,
    'engine' => $meta['name'],
]);
mm_record_ai_usage((string) ($budget['scopeKey'] ?? mm_ai_scope_key($body)), isset($budget['user']['id']) ? (int) $budget['user']['id'] : null, 1);

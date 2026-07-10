<?php
require_once __DIR__ . '/_config.php';

mm_handle_options();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$body = mm_read_json_body();
mm_require_rate_limit(mm_rate_limit_key($body), 20, 60);

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
    mm_json_response(200, ['understood' => true, 'feedback' => 'Demo mode: your explanation is on the right track. Make it clearer by defining the concept first, then give one short example.', 'demoMode' => true]);
    exit;
}

$concept = trim((string) ($body['concept'] ?? ''));
$studentExplanation = trim((string) ($body['studentExplanation'] ?? ''));
if ($concept === '' || $studentExplanation === '') {
    mm_json_response(400, ['error' => 'concept and studentExplanation are required.']);
    exit;
}

$payload = mm_generate_explain_check($concept, $studentExplanation);
mm_record_ai_usage((string) ($budget['scopeKey'] ?? mm_ai_scope_key($body)), isset($budget['user']['id']) ? (int) $budget['user']['id'] : null, 1);
mm_json_response(200, $payload);

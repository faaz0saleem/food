<?php
require_once __DIR__ . '/_config.php';

mm_handle_options();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$body = mm_read_json_body();
mm_require_rate_limit(mm_rate_limit_key($body), 10, 60);

$budget = mm_ai_budget_decision($body, 2);
if (($budget['mode'] ?? 'live') === 'signup') {
    mm_json_response(403, ['error' => (string) $budget['message'], 'requiresSignup' => true]);
    exit;
}
if (($budget['mode'] ?? 'live') === 'limit') {
    mm_json_response(429, ['error' => (string) $budget['message'], 'dailyLimitReached' => true]);
    exit;
}

$subject = trim((string) ($body['subject'] ?? ''));
$chapter = trim((string) ($body['chapter'] ?? ''));
$bookContext = trim((string) ($body['bookContext'] ?? ''));
$userLevel = trim((string) ($body['userLevel'] ?? 'Newbie'));
if ($subject === '') {
    mm_json_response(400, ['error' => 'subject is required.']);
    exit;
}

$payload = (($budget['mode'] ?? 'live') === 'demo')
    ? ['notes' => "OVERVIEW\nDemo mode is active because today\'s AI budget is exhausted.\n\nKEY POINTS\n- Review the core definition of this topic.\n- Write one worked example in your own words.\n\nFORMULAS & DEFINITIONS\n- List the important rules from your class notes.\n\nCOMMON MISTAKES\n- Avoid copying without understanding.\n\nEXAM TIPS\n- Practice one question and explain each step.", 'engine' => 'Demo']
    : mm_generate_chapter_notes($subject, $chapter, $bookContext, $userLevel);
if (($budget['mode'] ?? 'live') === 'live') {
    mm_record_ai_usage((string) ($budget['scopeKey'] ?? mm_ai_scope_key($body)), isset($budget['user']['id']) ? (int) $budget['user']['id'] : null, 2);
}
mm_json_response(200, ['status' => 'ok'] + $payload + ['demoMode' => (($budget['mode'] ?? 'live') === 'demo')]);

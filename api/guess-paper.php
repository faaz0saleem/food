<?php
require_once __DIR__ . '/_config.php';

mm_handle_options();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$body = mm_read_json_body();
mm_require_rate_limit(mm_rate_limit_key($body), 10, 60);

$budget = mm_ai_budget_decision($body, 3);
if (($budget['mode'] ?? 'live') === 'signup') {
    mm_json_response(403, ['error' => (string) $budget['message'], 'requiresSignup' => true]);
    exit;
}
if (($budget['mode'] ?? 'live') === 'limit') {
    mm_json_response(429, ['error' => (string) $budget['message'], 'dailyLimitReached' => true]);
    exit;
}

$section = trim((string) ($body['section'] ?? ''));
$subject = trim((string) ($body['subject'] ?? ''));
$paperFormat = trim((string) ($body['paperFormat'] ?? ''));
$chapter = trim((string) ($body['chapter'] ?? ''));

if ($section === '' || $subject === '') {
    mm_json_response(400, ['error' => 'section and subject are required.']);
    exit;
}

$payload = (($budget['mode'] ?? 'live') === 'demo')
    ? ['paper' => trim($section . ' ' . $subject) . " — Demo Practice Paper\n\n1. Define the topic clearly.\n2. Give one real-world example.\n3. Explain one common mistake.\n\nAnswer Key\n1-3: Open-ended demo questions.", 'generatedBy' => ['Demo']]
    : mm_generate_guess_paper($section, $subject, $paperFormat, $chapter);
if (($budget['mode'] ?? 'live') === 'live') {
    mm_record_ai_usage((string) ($budget['scopeKey'] ?? mm_ai_scope_key($body)), isset($budget['user']['id']) ? (int) $budget['user']['id'] : null, 3);
}
mm_json_response(200, ['status' => 'ok'] + $payload + ['demoMode' => (($budget['mode'] ?? 'live') === 'demo')]);

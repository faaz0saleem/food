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
if ($subject === '') {
    mm_json_response(400, ['error' => 'subject is required.']);
    exit;
}

$cards = (($budget['mode'] ?? 'live') === 'demo')
    ? [['front' => 'What is the key idea in ' . ($chapter !== '' ? $chapter : $subject) . '?', 'back' => 'Demo mode: sign in later or try again tomorrow for full AI-generated flashcards.']]
    : mm_generate_book_flashcards($subject, $chapter, $bookContext);
if (($budget['mode'] ?? 'live') === 'live') {
    mm_record_ai_usage((string) ($budget['scopeKey'] ?? mm_ai_scope_key($body)), isset($budget['user']['id']) ? (int) $budget['user']['id'] : null, 2);
}
mm_json_response(200, ['status' => 'ok', 'cards' => $cards, 'demoMode' => (($budget['mode'] ?? 'live') === 'demo')]);

<?php
require_once __DIR__ . '/_config.php';

mm_handle_options();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$body = mm_read_json_body();
mm_require_rate_limit(mm_rate_limit_key($body), 10, 60);

// A full paper runs all four engines, so it costs HALF the daily free
// credit allowance. Anonymous visitors are pushed to sign up first.
$freeLimit = max(1, (int) mm_env_value('FREE_DAILY_MESSAGES_LIMIT', '20'));
$paperCost = max(1, (int) ceil($freeLimit / 2));

$budget = mm_ai_budget_decision($body, $paperCost);
if (($budget['mode'] ?? 'live') === 'signup') {
    mm_json_response(403, ['error' => 'Guess papers use half of a day\'s AI credits — create a free account to generate one.', 'requiresSignup' => true]);
    exit;
}
if (($budget['mode'] ?? 'live') === 'limit') {
    mm_json_response(429, ['error' => 'Not enough AI credits left today for a full paper (needs ' . $paperCost . '). Come back tomorrow or upgrade.', 'dailyLimitReached' => true]);
    exit;
}

$section = trim((string) ($body['section'] ?? ''));
$subject = trim((string) ($body['subject'] ?? ''));
$chapter = trim((string) ($body['chapter'] ?? ''));
$bookTitle = trim((string) ($body['bookTitle'] ?? ''));

if ($section === '' || $subject === '') {
    mm_json_response(400, ['error' => 'section and subject are required.']);
    exit;
}

if (($budget['mode'] ?? 'live') === 'demo') {
    $exam = mm_generate_guess_paper_exam($section, $subject, $chapter, $bookTitle, 0);
    mm_json_response(200, ['status' => 'ok', 'demoMode' => true, 'creditsCharged' => 0] + $exam);
    exit;
}

$exam = mm_generate_guess_paper_exam($section, $subject, $chapter, $bookTitle, 2);

// Only charge when the AI actually produced the paper.
$aiGenerated = !in_array('Hungter offline generator', $exam['generatedBy'] ?? [], true);
if ($aiGenerated) {
    mm_record_ai_usage((string) ($budget['scopeKey'] ?? mm_ai_scope_key($body)), isset($budget['user']['id']) ? (int) $budget['user']['id'] : null, $paperCost);
}

mm_json_response(200, [
    'status' => 'ok',
    'demoMode' => false,
    'creditsCharged' => $aiGenerated ? $paperCost : 0,
] + $exam);

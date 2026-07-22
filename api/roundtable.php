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

$engines = mm_engines_config();
$availableKeys = [];
foreach (array_keys($engines) as $key) {
    if (count(mm_engine_chain($key)) > 0) {
        $availableKeys[] = $key;
    }
}

// A debate needs at least two voices; fall back to a single-engine answer otherwise.
$cost = max(1, count($availableKeys) * 2 + 1);
$budget = mm_ai_budget_decision($body, $cost);
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
        'transcript' => [],
        'finalAnswer' => mm_demo_chat_reply($subject, $message),
        'engines' => ['Hungter'],
        'demoMode' => true,
    ]);
    exit;
}

if (count($availableKeys) < 2) {
    $solo = mm_call_engine(count($availableKeys) ? $availableKeys[0] : 'reasoner', $subject, $userLevel, $message, [], [], 1200, 0.7);
    mm_json_response(200, [
        'status' => 'ok',
        'transcript' => [],
        'finalAnswer' => $solo['ok'] ? $solo['reply'] : mm_demo_chat_reply($subject, $message),
        'engines' => [$solo['ok'] ? mm_engine_display_name($solo) : 'Hungter'],
    ]);
    exit;
}

// Round 1: every engine gives its own independent take.
$round1Prompts = [];
foreach ($availableKeys as $key) {
    $round1Prompts[$key] = $message . "\n\nGive your take on how to best explain this, in 2-3 sentences, using your specialty.";
}
$round1Results = mm_call_engine_assignments($round1Prompts, $subject, $userLevel, 500, 0.7);

if (count($round1Results) === 0) {
    mm_json_response(200, [
        'status' => 'ok',
        'transcript' => [],
        'finalAnswer' => mm_demo_chat_reply($subject, $message),
        'engines' => ['Hungter'],
    ]);
    exit;
}

// Round 2: each engine reacts to what the others said.
$round2Prompts = [];
foreach ($round1Results as $key => $result) {
    $others = [];
    foreach ($round1Results as $otherKey => $otherResult) {
        if ($otherKey === $key) {
            continue;
        }
        $others[] = $otherResult['engine'] . ': ' . $otherResult['reply'];
    }
    $round2Prompts[$key] = 'Other tutors said, about explaining "' . $message . '":' . "\n" . implode("\n", $others)
        . "\n\nIn 1-2 sentences, briefly agree, disagree, or add something they missed.";
}
$round2Results = mm_call_engine_assignments($round2Prompts, $subject, $userLevel, 350, 0.7);

$transcript = [];
foreach ($round1Results as $result) {
    $transcript[] = ['round' => 1, 'engine' => $result['engine'], 'text' => $result['reply']];
}
foreach ($round2Results as $result) {
    $transcript[] = ['round' => 2, 'engine' => $result['engine'], 'text' => $result['reply']];
}

$fullTranscriptLines = [];
foreach ($round1Results as $result) {
    $fullTranscriptLines[] = $result['engine'] . ' (Round 1): ' . $result['reply'];
}
foreach ($round2Results as $result) {
    $fullTranscriptLines[] = $result['engine'] . ' (Round 2): ' . $result['reply'];
}
$fullTranscript = implode("\n", $fullTranscriptLines);

$conductorPrompt = 'Here is a debate between ' . count($round1Results) . ' AI tutors about how to answer a student\'s question: "'
    . $message . '"' . "\n\n" . $fullTranscript
    . "\n\nWrite ONE final, clear answer for the student (2-4 sentences), combining the best of what they said.";
$conductor = mm_call_engine(mm_best_ready_engine(), $subject, $userLevel, $conductorPrompt, [], [], 500, 0.4);
$firstReply = reset($round1Results);
$finalAnswer = $conductor['ok'] && trim((string) $conductor['reply']) !== '' ? $conductor['reply'] : $firstReply['reply'];

$engineNames = [];
foreach ($round1Results as $result) {
    $engineNames[] = $result['engine'];
}

try {
    mm_track_visit((string) ($body['visitorId'] ?? ''));
    mm_record_ai_usage((string) ($budget['scopeKey'] ?? mm_ai_scope_key($body)), isset($budget['user']['id']) ? (int) $budget['user']['id'] : null, $cost);
} catch (Throwable $error) {
    // Do not fail the debate if analytics storage is unavailable.
}

mm_json_response(200, [
    'status' => 'ok',
    'transcript' => $transcript,
    'finalAnswer' => $finalAnswer,
    'engines' => $engineNames,
    'credits' => isset($budget['credits']) ? array_merge($budget['credits'], ['used' => ($budget['credits']['used'] ?? 0) + $cost, 'left' => max(0, ($budget['credits']['left'] ?? 0) - $cost)]) : null,
    'payg' => (bool) ($budget['payg'] ?? false),
]);

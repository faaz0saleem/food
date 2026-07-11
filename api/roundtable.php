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

$budget = mm_ai_budget_decision($body, 3);
if (($budget['mode'] ?? 'live') === 'signup') {
    mm_json_response(403, ['error' => (string) $budget['message'], 'requiresSignup' => true]);
    exit;
}
if (($budget['mode'] ?? 'live') === 'limit') {
    mm_json_response(429, ['error' => (string) $budget['message'], 'dailyLimitReached' => true]);
    exit;
}

if ($message === '') {
    mm_json_response(400, ['error' => 'A message is required.']);
    exit;
}

if (($budget['mode'] ?? 'live') === 'demo') {
    $demo = mm_demo_chat_reply($subject, $message);
    mm_json_response(200, [
        'status' => 'ok',
        'transcript' => [],
        'previews' => [
            ['engine' => 'reasoner', 'name' => 'Reasoner', 'preview' => $demo],
        ],
        'finalAnswer' => $demo,
        'engines' => ['Demo'],
        'demoMode' => true,
    ]);
    exit;
}

// All four engines join the debate, each answering through its own provider
// chain (native vendor when its key exists, best available fallback otherwise).
$engineConfigs = mm_engines_config();
$participants = [];
foreach ($engineConfigs as $key => $engine) {
    if (count(mm_engine_chain($key)) > 0) {
        $participants[$key] = $engine;
    }
}

$round1 = [];
foreach ($participants as $key => $engine) {
    $result = mm_call_engine($key, $subject, $userLevel, $message . "\n\nGive your take on how to best explain this, in 2-3 sentences, using your specialty.", [], [], 500, 0.65);
    $text = trim((string) ($result['reply'] ?? ''));
    if ($text === '') {
        continue;
    }
    $round1[] = [
        'key' => $key,
        'name' => $engine['name'],
        'text' => $text,
    ];
}

$round2 = [];
foreach ($round1 as $speaker) {
    $otherLines = [];
    foreach ($round1 as $other) {
        if ($other['key'] === $speaker['key']) {
            continue;
        }
        $otherLines[] = $other['name'] . ': ' . $other['text'];
    }

    $result = mm_call_engine($speaker['key'], $subject, $userLevel, "Student question: " . $message . "\n\nOther tutor takes:\n" . implode("\n", $otherLines) . "\n\nIn 1-2 sentences, add one missing point or correction.", [], [], 320, 0.5);
    $text = trim((string) ($result['reply'] ?? ''));
    if ($text === '') {
        $text = 'No follow-up response.';
    }

    $round2[] = [
        'key' => $speaker['key'],
        'name' => $speaker['name'],
        'text' => $text,
    ];
}

$transcript = [];
$previews = [];
foreach ($round1 as $item) {
    $transcript[] = ['round' => 1, 'engine' => $item['name'], 'text' => $item['text']];
    $previews[] = ['engine' => $item['key'], 'name' => $item['name'], 'preview' => $item['text']];
}
foreach ($round2 as $item) {
    $transcript[] = ['round' => 2, 'engine' => $item['name'], 'text' => $item['text']];
}

$transcriptText = implode("\n", array_map(static fn($line) => 'Round ' . $line['round'] . ' - ' . $line['engine'] . ': ' . $line['text'], $transcript));
$final = mm_call_engine('reasoner', $subject, $userLevel, "Student question: " . $message . "\n\nDebate transcript:\n" . $transcriptText . "\n\nWrite one final 2-4 sentence answer for the student.", [], [], 500, 0.45);

$finalAnswer = trim((string) ($final['reply'] ?? ''));
if ($finalAnswer === '') {
    $finalAnswer = (string) ($round1[0]['text'] ?? 'Keep practicing and ask a narrower follow-up question.');
}

mm_json_response(200, [
    'status' => 'ok',
    'transcript' => $transcript,
    'previews' => $previews,
    'finalAnswer' => $finalAnswer,
    'engines' => array_map(static fn($item) => $item['name'], $round1),
]);
mm_record_ai_usage((string) ($budget['scopeKey'] ?? mm_ai_scope_key($body)), isset($budget['user']['id']) ? (int) $budget['user']['id'] : null, 3);

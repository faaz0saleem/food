<?php
// Codex: all four engines divide one coding task — architecture, logic,
// frontend, and a mentor who teaches how the code works.
require_once __DIR__ . '/_config.php';

mm_handle_options();
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$body = mm_read_json_body();
mm_require_rate_limit(mm_rate_limit_key($body), 6, 60);

$task = trim((string) ($body['task'] ?? ''));
$language = trim((string) ($body['language'] ?? 'JavaScript'));
$existing = trim((string) ($body['code'] ?? ''));
$userLevel = trim((string) ($body['userLevel'] ?? 'Newbie'));

if ($task === '') {
    mm_json_response(400, ['error' => 'Describe what you want to build.']);
    exit;
}

$budget = mm_ai_budget_decision($body, 4);
if (($budget['mode'] ?? 'live') === 'signup') {
    mm_json_response(403, ['error' => 'Codex runs all 4 engines — create a free account first.', 'requiresSignup' => true]);
    exit;
}
if (($budget['mode'] ?? 'live') === 'limit') {
    mm_json_response(429, ['error' => 'Not enough AI credits left today for a Codex build (needs 4).', 'dailyLimitReached' => true]);
    exit;
}

$context = "Project: " . substr($task, 0, 1200) . "\nLanguage: " . $language
    . ($existing !== '' ? "\n\nExisting code from the student:\n```\n" . substr($existing, 0, 6000) . "\n```" : '')
    . "\nStudent level: " . $userLevel . ". Use markdown with fenced code blocks.";

$assignments = [
    'storyteller' => "You are CLAUDE, the FRONTEND DESIGNER on a 4-AI dev team. $context\n\nDeliver: the complete frontend — HTML structure, beautiful styling, and UI interactions as working code the student can paste in. Explain your design choices in one short paragraph.",
    'explorer' => "You are CHATGPT, the BACKEND ARCHITECT on a 4-AI dev team. $context\n\nDeliver: the backend — data model, endpoints/functions, and the core server-side code, briefly annotated.",
    'solver' => "You are GEMINI, the QA ENGINEER on a 4-AI dev team. $context\n\nDeliver: the hardest algorithm/logic implemented correctly, edge cases handled, one worked test example, and 3 bugs a beginner would likely hit here with fixes.",
    'reasoner' => "You are GROQ, the CODING TEACHER on a 4-AI dev team. $context\n\nDeliver: teach it — explain how frontend and backend fit together, walk through the trickiest lines in plain words, list 3 concepts the student just learned and 2 exercises to build next.",
];

$roleNames = ['storyteller' => '🟣 Claude · Frontend Designer', 'explorer' => '🔵 ChatGPT · Backend Architect', 'solver' => '🟠 Gemini · QA Engineer', 'reasoner' => '🟢 Groq · Coding Teacher'];

if (($budget['mode'] ?? 'live') === 'demo') {
    $sections = [];
    foreach ($roleNames as $key => $role) {
        $sections[] = ['role' => $role, 'engine' => 'Demo', 'reply' => "Demo mode: describe your project and this engine will write its part of the code — plus teach you how it works. Add an AI key on the server to go live."];
    }
    mm_json_response(200, ['status' => 'ok', 'demoMode' => true, 'sections' => $sections]);
    exit;
}

$results = mm_call_engine_assignments($assignments, 'Programming', $userLevel, 1700, 0.4);

$sections = [];
foreach ($results as $result) {
    $engineKeyGuess = strtolower((string) ($result['engine'] ?? ''));
    $roleKey = null;
    $brandToRole = ['claude' => 'storyteller', 'chatgpt' => 'explorer', 'gemini' => 'solver', 'groq' => 'reasoner'];
    foreach ($brandToRole as $brand => $k) {
        if (stripos($engineKeyGuess, $brand) !== false) { $roleKey = $k; break; }
    }
    $sections[] = [
        'role' => $roleKey !== null ? $roleNames[$roleKey] : ($result['icon'] ?? '🤖') . ' ' . ($result['engine'] ?? 'Engine'),
        'engine' => mm_engine_display_name($result),
        'reply' => (string) ($result['reply'] ?? ''),
    ];
}

if (count($sections) === 0) {
    mm_json_response(200, [
        'status' => 'ok',
        'fallback' => true,
        'sections' => [[ 'role' => '🧠 Hungter', 'engine' => 'Hungter', 'reply' => "The engines are offline right now. Owner: open /api/setup.php to add the AI key, then Codex builds with all four engines." ]],
    ]);
    exit;
}

mm_record_ai_usage((string) ($budget['scopeKey'] ?? mm_ai_scope_key($body)), isset($budget['user']['id']) ? (int) $budget['user']['id'] : null, 4);
mm_json_response(200, ['status' => 'ok', 'sections' => $sections]);

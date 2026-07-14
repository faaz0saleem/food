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
$mode = strtolower(trim((string) ($body['mode'] ?? 'build'))) === 'fix' ? 'fix' : 'build';
$repo = trim((string) ($body['repo'] ?? ''));

if ($task === '') {
    mm_json_response(400, ['error' => 'Describe what you want to build.']);
    exit;
}

// A GitHub-connected visitor (signed cookie set by github-callback.php) is
// treated as authorized so the GitHub gate actually unlocks Codex.
$githubOk = false;
$ghCookie = (string) ($_COOKIE['mm_github'] ?? '');
if ($ghCookie !== '' && strpos($ghCookie, '.') !== false) {
    [$b64, $sig] = explode('.', $ghCookie, 2);
    $payload = base64_decode($b64, true);
    if ($payload !== false) {
        $salt = mm_env_value('ADMIN_KEY', '') . '|hungter-gh';
        if (hash_equals(hash_hmac('sha256', $payload, $salt), $sig)) {
            $githubOk = true;
        }
    }
}

$budget = mm_ai_budget_decision($body, 4);
if ($githubOk && (($budget['mode'] ?? 'live') === 'signup')) {
    $budget['mode'] = 'live'; // GitHub sign-in counts as an account for Codex
}
if (($budget['mode'] ?? 'live') === 'signup') {
    mm_json_response(403, ['error' => 'Codex runs all 4 engines — create a free account first.', 'requiresSignup' => true]);
    exit;
}
if (($budget['mode'] ?? 'live') === 'limit') {
    mm_json_response(429, ['error' => 'Not enough AI credits left today for a Codex build (needs 4).', 'dailyLimitReached' => true]);
    exit;
}

$goal = $mode === 'fix'
    ? "MODE: FIX & IMPROVE an existing project. Find and fix bugs, then add the improvements the student asked for."
    : "MODE: BUILD a new project from scratch.";
$repoLine = $repo !== '' ? "\nTarget GitHub repo: " . substr($repo, 0, 200) . " — write files so they can be committed there." : "\nNo repo linked — deliver paste-ready files the student can drop into a new repo.";

$context = $goal . "\nProject: " . substr($task, 0, 1200) . "\nLanguage: " . $language . $repoLine
    . ($existing !== '' ? "\n\nExisting code from the student:\n```\n" . substr($existing, 0, 6000) . "\n```" : '')
    . "\nStudent level: " . $userLevel . ". Use markdown with fenced code blocks.";

if ($mode === 'fix') {
    $assignments = [
        'solver' => "You are GEMINI, the QA ENGINEER. $context\n\nDeliver: list every bug you can find in the code above (numbered), each with the exact fix as a code snippet. Then note any edge cases still unhandled.",
        'explorer' => "You are CHATGPT, the BACKEND ARCHITECT. $context\n\nDeliver: the corrected + improved backend/logic code with the requested new features added, annotated.",
        'storyteller' => "You are CLAUDE, the FRONTEND DESIGNER. $context\n\nDeliver: the improved frontend — cleaner UI, the new features styled in, and any visual bugs fixed, as working code.",
        'reasoner' => "You are GROQ, the CODING TEACHER. $context\n\nDeliver: explain WHY the bugs happened and what the fixes teach, in plain words. List 3 concepts learned and 2 things to try next.",
    ];
} else {
    $assignments = [
        'storyteller' => "You are CLAUDE, the FRONTEND DESIGNER on a 4-AI dev team. $context\n\nDeliver: the complete frontend — HTML structure, beautiful styling, and UI interactions as working code the student can paste in. Explain your design choices in one short paragraph.",
        'explorer' => "You are CHATGPT, the BACKEND ARCHITECT on a 4-AI dev team. $context\n\nDeliver: the backend — data model, endpoints/functions, and the core server-side code, briefly annotated.",
        'solver' => "You are GEMINI, the QA ENGINEER on a 4-AI dev team. $context\n\nDeliver: the hardest algorithm/logic implemented correctly, edge cases handled, one worked test example, and 3 bugs a beginner would likely hit here with fixes.",
        'reasoner' => "You are GROQ, the CODING TEACHER on a 4-AI dev team. $context\n\nDeliver: teach it — explain how frontend and backend fit together, walk through the trickiest lines in plain words, list 3 concepts the student just learned and 2 exercises to build next.",
    ];
}

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

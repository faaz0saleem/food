<?php
// Codex — an autonomous 4-AI dev team. It does not just print code: it creates
// (or reuses) a GitHub repo the signed-in user owns and COMMITS the files the
// engines produce, then reports what it built. Each engine owns a lane:
//   🟣 Claude   — frontend files (HTML/CSS/UI JS)
//   🔵 ChatGPT  — backend files (server/API/logic)
//   🟠 Gemini   — QA: README + tests + bug notes
//   🟢 Groq     — teacher: plain-language explanation of the whole build
require_once __DIR__ . '/_config.php';

mm_handle_options();
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$body = mm_read_json_body();
mm_require_rate_limit(mm_rate_limit_key($body), 4, 60);

$task = trim((string) ($body['task'] ?? ''));
$language = trim((string) ($body['language'] ?? 'JavaScript'));
$existing = trim((string) ($body['code'] ?? ''));
$userLevel = trim((string) ($body['userLevel'] ?? 'Newbie'));
$mode = strtolower(trim((string) ($body['mode'] ?? 'build'))) === 'fix' ? 'fix' : 'build';
$repoInput = trim((string) ($body['repo'] ?? ''));

if ($task === '') {
    mm_json_response(400, ['error' => 'Describe what you want to build.']);
    exit;
}

// ── GitHub auth ──────────────────────────────────────────────────────────────
// The httponly mm_gh_token cookie (set by github-callback.php) carries the
// repo-scoped access token. Its presence is what lets Codex act on its own.
function cx_github_session(): ?array {
    $c = (string) ($_COOKIE['mm_gh_token'] ?? '');
    if ($c === '' || strpos($c, '.') === false) {
        return null;
    }
    [$b64, $sig] = explode('.', $c, 2);
    $payload = base64_decode($b64, true);
    if ($payload === false) {
        return null;
    }
    $salt = mm_env_value('ADMIN_KEY', '') . '|hungter-gh';
    if (!hash_equals(hash_hmac('sha256', $payload, $salt), $sig)) {
        return null;
    }
    $data = json_decode($payload, true);
    if (!is_array($data) || empty($data['token']) || empty($data['login'])) {
        return null;
    }
    return ['token' => (string) $data['token'], 'login' => (string) $data['login']];
}

$gh = cx_github_session();

// Signed-in-with-old-scope: profile cookie exists but no repo token yet.
$hasProfile = false;
$ghCookie = (string) ($_COOKIE['mm_github'] ?? '');
if ($ghCookie !== '' && strpos($ghCookie, '.') !== false) {
    [$pb64, $psig] = explode('.', $ghCookie, 2);
    $ppayload = base64_decode($pb64, true);
    if ($ppayload !== false) {
        $salt = mm_env_value('ADMIN_KEY', '') . '|hungter-gh';
        if (hash_equals(hash_hmac('sha256', $ppayload, $salt), $psig)) {
            $hasProfile = true;
        }
    }
}

if ($gh === null) {
    // No repo token: either never connected, or connected before repo scope existed.
    mm_json_response(403, [
        'error' => $hasProfile
            ? 'Reconnect GitHub so Codex can create repos and commit for you.'
            : 'Sign in with GitHub so Codex can build straight into your repo.',
        'needsRepoScope' => true,
    ]);
    exit;
}

// ── Budget: Codex runs all four engines, costs 4 credits. GitHub = an account. ─
$budget = mm_ai_budget_decision($body, 4);
if (($budget['mode'] ?? 'live') === 'signup') {
    $budget['mode'] = 'live';
}
if (($budget['mode'] ?? 'live') === 'limit') {
    mm_json_response(429, ['error' => 'Not enough AI credits left today for a Codex build (needs 4).', 'dailyLimitReached' => true]);
    exit;
}

// ── GitHub REST helpers ──────────────────────────────────────────────────────
function cx_gh_api(string $token, string $method, string $path, ?array $bodyData = null): array {
    $ch = curl_init('https://api.github.com' . $path);
    $headers = [
        'Authorization: Bearer ' . $token,
        'User-Agent: Hungter-Codex',
        'Accept: application/vnd.github+json',
        'X-GitHub-Api-Version: 2022-11-28',
    ];
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_TIMEOUT => 25,
    ];
    if ($bodyData !== null) {
        $headers[] = 'Content-Type: application/json';
        $opts[CURLOPT_POSTFIELDS] = json_encode($bodyData);
    }
    $opts[CURLOPT_HTTPHEADER] = $headers;
    curl_setopt_array($ch, $opts);
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    return ['status' => $status, 'json' => json_decode((string) $raw, true), 'error' => $err];
}

function cx_encode_path(string $path): string {
    return implode('/', array_map('rawurlencode', explode('/', $path)));
}

/** Create or update a single file on the repo's default branch. */
function cx_put_file(string $token, string $owner, string $repo, string $path, string $content, string $message): array {
    $encoded = cx_encode_path($path);
    $existing = cx_gh_api($token, 'GET', "/repos/$owner/$repo/contents/$encoded");
    $payload = ['message' => $message, 'content' => base64_encode($content)];
    if (($existing['status'] ?? 0) === 200 && !empty($existing['json']['sha'])) {
        $payload['sha'] = $existing['json']['sha'];
    }
    return cx_gh_api($token, 'PUT', "/repos/$owner/$repo/contents/$encoded", $payload);
}

/** Pull "===FILE: path===\n```lang\n...\n```" blocks out of an engine reply. */
function cx_parse_files(string $text): array {
    $files = [];
    if (preg_match_all('/===\s*FILE:\s*([^\n=]+?)\s*===\s*```[a-zA-Z0-9._+-]*\r?\n(.*?)```/s', $text, $matches, PREG_SET_ORDER)) {
        foreach ($matches as $m) {
            $path = trim($m[1]);
            // Block path traversal and absolute paths.
            $path = str_replace(['\\', '..'], ['/', ''], $path);
            $path = ltrim($path, '/');
            $path = preg_replace('#/+#', '/', $path);
            if ($path === '' || strlen($path) > 200) {
                continue;
            }
            $files[$path] = rtrim($m[2], "\r\n") . "\n";
        }
    }
    return $files;
}

$token = $gh['token'];
$login = $gh['login'];

// ── Resolve the target repo (owner/name) ─────────────────────────────────────
$owner = $login;
$name = '';
if ($repoInput !== '') {
    $parts = explode('/', str_replace('\\', '/', $repoInput));
    $name = trim((string) array_pop($parts));
    $maybeOwner = trim((string) array_pop($parts));
    if ($maybeOwner !== '') {
        $owner = $maybeOwner;
    }
}
if ($name === '') {
    // Codex names the repo from the task.
    $slug = strtolower(preg_replace('/[^a-z0-9]+/i', '-', $task));
    $slug = trim($slug, '-');
    $name = substr($slug, 0, 40);
    if ($name === '') {
        $name = 'hungter-project';
    }
}
$name = preg_replace('/[^A-Za-z0-9._-]/', '-', $name);

// ── Ensure the repo exists (create under the signed-in user if missing) ───────
$log = [];
$repoCheck = cx_gh_api($token, 'GET', "/repos/$owner/$name");
if (($repoCheck['status'] ?? 0) === 404) {
    if (strcasecmp($owner, $login) !== 0) {
        mm_json_response(422, ['error' => "Repo $owner/$name doesn't exist and Codex can only create repos under your account ($login)."]);
        exit;
    }
    $created = cx_gh_api($token, 'POST', '/user/repos', [
        'name' => $name,
        'private' => false,
        'auto_init' => true,
        'description' => 'Built by Hungter Codex — 4 AIs, one project.',
    ]);
    if (($created['status'] ?? 0) >= 300) {
        $ghMsg = $created['json']['message'] ?? ('HTTP ' . ($created['status'] ?? '?'));
        mm_json_response(502, ['error' => "Couldn't create the repo: $ghMsg"]);
        exit;
    }
    $log[] = "📦 Created new repo $owner/$name";
    // auto_init needs a beat before the Contents API sees the default branch.
    usleep(800000);
} elseif (($repoCheck['status'] ?? 0) >= 300) {
    $ghMsg = $repoCheck['json']['message'] ?? ('HTTP ' . ($repoCheck['status'] ?? '?'));
    mm_json_response(502, ['error' => "Couldn't reach the repo $owner/$name: $ghMsg"]);
    exit;
}

// ── Build the assignments (strict FILE format so we can commit the output) ────
$fileFormat = "\n\nOUTPUT FORMAT — this is critical. Emit ONLY files, no prose, no explanation outside code. "
    . "For every file write a line EXACTLY like:\n===FILE: relative/path.ext===\nimmediately followed by a fenced code block "
    . "containing the FULL contents of that file. Repeat for each file. Do not write anything between or after the blocks.";

$goal = $mode === 'fix'
    ? "You are FIXING & IMPROVING an existing project. Correct the bugs and add what the student asked, then output the corrected files in full."
    : "You are BUILDING a new project from scratch.";
$repoLine = "Repo: $owner/$name.";
$base = $goal . "\nProject: " . substr($task, 0, 1200) . "\nLanguage: " . $language . "\n" . $repoLine
    . ($existing !== '' ? "\n\nExisting code from the student:\n```\n" . substr($existing, 0, 6000) . "\n```" : '')
    . "\nStudent level: " . $userLevel . '.';

$assignments = [
    'storyteller' => "You are CLAUDE, the FRONTEND DESIGNER on a 4-AI dev team. $base\n\nBuild the complete frontend: an index.html, a styles.css, and the UI JavaScript. Make it genuinely good-looking and responsive.$fileFormat",
    'explorer' => "You are CHATGPT, the BACKEND ARCHITECT on a 4-AI dev team. $base\n\nBuild the backend: the server/app entry file, routes/endpoints or core logic, and any data layer. Keep it runnable.$fileFormat",
    'solver' => "You are GEMINI, the QA ENGINEER on a 4-AI dev team. $base\n\nProduce a clear README.md (what it is + how to run it) and one tests file that exercises the core logic. Inside the README add a short '## Known edge cases' section.$fileFormat",
    'reasoner' => "You are GROQ, the CODING TEACHER on a 4-AI dev team. $base\n\nDo NOT output files. In plain language for a $userLevel, explain what the team is building, how the frontend and backend fit together, walk through the 3 trickiest ideas, then list 3 concepts learned and 2 things to try next.",
];

$roleNames = [
    'storyteller' => '🟣 Claude · Frontend Designer',
    'explorer' => '🔵 ChatGPT · Backend Architect',
    'solver' => '🟠 Gemini · QA Engineer',
    'reasoner' => '🟢 Groq · Coding Teacher',
];

$results = mm_call_engine_assignments($assignments, 'Programming', $userLevel, 2600, 0.4);

if (count($results) === 0) {
    mm_json_response(200, [
        'status' => 'ok',
        'fallback' => true,
        'repo' => "$owner/$name",
        'repoUrl' => "https://github.com/$owner/$name",
        'sections' => [['role' => '🧠 Hungter', 'engine' => 'Hungter', 'reply' => "The engines are offline right now. Owner: open /api/setup.php to add an AI key, then Codex builds with all four engines."]],
    ]);
    exit;
}

// ── Collect the files the builders produced, and the teacher's explanation ────
$allFiles = [];
$sections = [];
$teacherReply = '';
$brandOrder = ['storyteller', 'explorer', 'solver', 'reasoner'];
foreach ($brandOrder as $key) {
    if (!isset($results[$key])) {
        continue;
    }
    $reply = (string) ($results[$key]['reply'] ?? '');
    if ($key === 'reasoner') {
        $teacherReply = $reply;
        continue;
    }
    $files = cx_parse_files($reply);
    foreach ($files as $path => $content) {
        $allFiles[$path] = $content; // later lanes can override, but lanes rarely collide
    }
    $sections[] = [
        'role' => $roleNames[$key],
        'engine' => mm_engine_display_name($results[$key]),
        'files' => array_keys($files),
    ];
}

// ── Commit every file to the repo ─────────────────────────────────────────────
$committed = [];
$failed = [];
$commitMsg = ($mode === 'fix' ? 'Codex: fix & improve — ' : 'Codex: build — ') . substr($task, 0, 60);
foreach ($allFiles as $path => $content) {
    $res = cx_put_file($token, $owner, $name, $path, $content, $commitMsg);
    if (($res['status'] ?? 0) < 300) {
        $committed[] = $path;
    } else {
        $failed[] = $path . ' (' . ($res['json']['message'] ?? ('HTTP ' . ($res['status'] ?? '?'))) . ')';
    }
}

// Commit a build log so the repo shows what happened.
if (count($committed) > 0) {
    $logMd = "# 🤖 Hungter Codex build\n\n**Task:** " . $task . "\n\n**Mode:** " . $mode . "  \n**Language:** " . $language . "\n\n## Files committed\n"
        . implode("\n", array_map(fn ($f) => "- `$f`", $committed)) . "\n\n## How it works\n\n" . $teacherReply . "\n";
    cx_put_file($token, $owner, $name, 'CODEX_BUILD.md', $logMd, 'Codex: build notes');
    $committed[] = 'CODEX_BUILD.md';
}

$log[] = count($committed) > 0
    ? '✅ Committed ' . count($committed) . ' file' . (count($committed) === 1 ? '' : 's') . " to $owner/$name"
    : '⚠️ The engines ran but produced no committable files — try a more specific request.';
foreach ($failed as $f) {
    $log[] = '⚠️ Skipped ' . $f;
}

if (count($committed) > 0) {
    mm_record_ai_usage((string) ($budget['scopeKey'] ?? mm_ai_scope_key($body)), isset($budget['user']['id']) ? (int) $budget['user']['id'] : null, 4);
}

mm_json_response(200, [
    'status' => 'ok',
    'built' => count($committed) > 0,
    'repo' => "$owner/$name",
    'repoUrl' => "https://github.com/$owner/$name",
    'committed' => $committed,
    'failed' => $failed,
    'log' => $log,
    'teacher' => $teacherReply,
    'sections' => $sections,
]);

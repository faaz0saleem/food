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

// ── One-click deploy: turn the repo into a live GitHub Pages site ────────────
if (strtolower((string) ($body['action'] ?? '')) === 'deploy') {
    $gh = cx_github_session();
    if ($gh === null) {
        mm_json_response(403, ['error' => 'Reconnect GitHub so Codex can deploy for you.', 'needsRepoScope' => true]);
        exit;
    }
    $repoFull = str_replace('\\', '/', $repoInput);
    if ($repoFull === '' || strpos($repoFull, '/') === false) {
        mm_json_response(400, ['error' => 'No repo to deploy.']);
        exit;
    }
    [$dOwner, $dName] = explode('/', $repoFull, 2);
    $dOwner = trim($dOwner);
    $dName = trim($dName);
    $tok = $gh['token'];
    $repoInfo = cx_gh_api($tok, 'GET', "/repos/$dOwner/$dName");
    $branch = (string) ($repoInfo['json']['default_branch'] ?? 'main');
    $enable = cx_gh_api($tok, 'POST', "/repos/$dOwner/$dName/pages", ['source' => ['branch' => $branch, 'path' => '/']]);
    $url = '';
    if (($enable['status'] ?? 0) < 300) {
        $url = (string) ($enable['json']['html_url'] ?? '');
    } else {
        // Already enabled (409) or needs a GET to read the URL.
        $get = cx_gh_api($tok, 'GET', "/repos/$dOwner/$dName/pages");
        if (($get['status'] ?? 0) < 300) {
            $url = (string) ($get['json']['html_url'] ?? '');
        } elseif (($enable['status'] ?? 0) !== 409) {
            $msg = $enable['json']['message'] ?? ('HTTP ' . ($enable['status'] ?? '?'));
            mm_json_response(502, ['error' => "Couldn't enable GitHub Pages: $msg"]);
            exit;
        }
    }
    if ($url === '') {
        $url = "https://$dOwner.github.io/$dName/";
    }
    mm_json_response(200, ['status' => 'ok', 'deployed' => true, 'url' => $url]);
    exit;
}

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

/**
 * Read the repo the way Claude Code does before it edits: list the tree, then
 * pull the contents of the most relevant source files (capped) so the engines
 * work against real code instead of guessing. Returns [contextText, fileCount].
 */
function cx_read_repo(string $token, string $owner, string $repo, string $branch): array {
    $tree = cx_gh_api($token, 'GET', "/repos/$owner/$repo/git/trees/" . rawurlencode($branch) . '?recursive=1');
    if (($tree['status'] ?? 0) !== 200 || empty($tree['json']['tree'])) {
        return ['', 0];
    }
    $codeExt = ['js', 'ts', 'jsx', 'tsx', 'php', 'py', 'html', 'css', 'json', 'md', 'java', 'cpp', 'c', 'h', 'go', 'rb', 'vue', 'svelte', 'sql'];
    $skipDirs = ['node_modules/', '.git/', 'vendor/', 'dist/', 'build/', '.next/', 'coverage/'];
    $candidates = [];
    foreach ($tree['json']['tree'] as $node) {
        if (($node['type'] ?? '') !== 'blob') {
            continue;
        }
        $path = (string) ($node['path'] ?? '');
        $size = (int) ($node['size'] ?? 0);
        if ($path === '' || $size > 60000) {
            continue;
        }
        foreach ($skipDirs as $skip) {
            if (strpos($path, $skip) === 0 || strpos($path, '/' . $skip) !== false) {
                continue 2;
            }
        }
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        if (!in_array($ext, $codeExt, true) && strtolower(basename($path)) !== 'package.json') {
            continue;
        }
        // Prioritise entry points and configs so the map is meaningful.
        $rank = 5;
        $lower = strtolower($path);
        if (preg_match('#(^|/)(index|main|app|server)\.#', $lower)) { $rank = 1; }
        elseif (in_array(basename($lower), ['package.json', 'readme.md'], true)) { $rank = 2; }
        elseif (strpos($lower, '/') === false) { $rank = 3; }
        $candidates[] = ['path' => $path, 'rank' => $rank];
    }
    usort($candidates, fn ($a, $b) => $a['rank'] <=> $b['rank'] ?: strcmp($a['path'], $b['path']));

    $context = '';
    $budget = 24000; // total chars of code we hand the engines
    $count = 0;
    foreach ($candidates as $c) {
        if ($count >= 14 || $budget <= 0) {
            break;
        }
        $file = cx_gh_api($token, 'GET', "/repos/$owner/$repo/contents/" . cx_encode_path($c['path']));
        if (($file['status'] ?? 0) !== 200 || empty($file['json']['content'])) {
            continue;
        }
        $decoded = base64_decode(str_replace("\n", '', (string) $file['json']['content']), true);
        if ($decoded === false || $decoded === '') {
            continue;
        }
        $slice = substr($decoded, 0, min(4000, $budget));
        $budget -= strlen($slice);
        $context .= "\n===EXISTING FILE: {$c['path']}===\n```\n" . $slice . "\n```\n";
        $count++;
    }
    return [$context, $count];
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
    $defaultBranch = (string) ($created['json']['default_branch'] ?? 'main');
    $freshRepo = true;
    // auto_init needs a beat before the Contents API sees the default branch.
    usleep(800000);
} elseif (($repoCheck['status'] ?? 0) >= 300) {
    $ghMsg = $repoCheck['json']['message'] ?? ('HTTP ' . ($repoCheck['status'] ?? '?'));
    mm_json_response(502, ['error' => "Couldn't reach the repo $owner/$name: $ghMsg"]);
    exit;
} else {
    $defaultBranch = (string) ($repoCheck['json']['default_branch'] ?? 'main');
    $freshRepo = false;
}

// ── Read the repo first (Claude-Code-style) so the engines edit real code ─────
$repoContext = '';
if (empty($freshRepo)) {
    [$repoContext, $repoFileCount] = cx_read_repo($token, $owner, $name, $defaultBranch);
    if ($repoFileCount > 0) {
        $log[] = "🔍 Read $repoFileCount file" . ($repoFileCount === 1 ? '' : 's') . " from $owner/$name";
    }
}

// ── Build the assignments (strict FILE format so we can commit the output) ────
$fileFormat = "\n\nOUTPUT FORMAT — this is critical. Emit ONLY files, no prose, no explanation outside code. "
    . "For every file write a line EXACTLY like:\n===FILE: relative/path.ext===\nimmediately followed by a fenced code block "
    . "containing the FULL contents of that file. Repeat for each file. Do not write anything between or after the blocks.";

$goal = $mode === 'fix'
    ? "You are FIXING & IMPROVING an existing project. Correct the bugs and add what the student asked, then output the corrected files IN FULL."
    : "You are BUILDING a new project from scratch.";
$repoLine = "Repo: $owner/$name.";
$repoNote = $repoContext !== ''
    ? "\n\nThe repo already contains these files. To CHANGE one, output a file with the EXACT SAME path and its full new contents. To add a file, use a new path. Do not touch files you are not changing." . $repoContext
    : '';
$base = $goal . "\nProject: " . substr($task, 0, 1200) . "\nLanguage: " . $language . "\n" . $repoLine
    . ($existing !== '' ? "\n\nExtra code the student pasted:\n```\n" . substr($existing, 0, 6000) . "\n```" : '')
    . $repoNote
    . "\nStudent level: " . $userLevel . '.';

$frontendJob = $mode === 'fix'
    ? "Fix the frontend files that need it and add the requested UI changes — output each changed file in full at its existing path (create new ones only if truly needed)."
    : "Build the complete frontend: an index.html, a styles.css, and the UI JavaScript. Make it genuinely good-looking and responsive.";
$backendJob = $mode === 'fix'
    ? "Fix the backend/logic bugs and add the requested behaviour — output each changed file in full at its existing path."
    : "Build the backend: the server/app entry file, routes/endpoints or core logic, and any data layer. Keep it runnable.";
$qaJob = $mode === 'fix'
    ? "Update the README if behaviour changed and add/adjust a tests file that covers the fixes. Keep a short '## Known edge cases' section."
    : "Produce a clear README.md (what it is + how to run it) and one tests file that exercises the core logic. Add a short '## Known edge cases' section.";
$teachJob = $mode === 'fix'
    ? "Do NOT output files. In plain language for a $userLevel, explain what was broken, why, and what each fix teaches — then list 3 concepts learned and 2 things to try next."
    : "Do NOT output files. In plain language for a $userLevel, explain what the team is building, how the frontend and backend fit together, walk through the 3 trickiest ideas, then list 3 concepts learned and 2 things to try next.";

$assignments = [
    'storyteller' => "You are CLAUDE, the FRONTEND DESIGNER on a 4-AI dev team. $base\n\n$frontendJob$fileFormat",
    'explorer' => "You are CHATGPT, the BACKEND ARCHITECT on a 4-AI dev team. $base\n\n$backendJob$fileFormat",
    'solver' => "You are GEMINI, the QA ENGINEER on a 4-AI dev team. $base\n\n$qaJob$fileFormat",
    'reasoner' => "You are GROQ, the CODING TEACHER on a 4-AI dev team. $base\n\n$teachJob",
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

// Return the generated file contents (capped) so the UI can show a live
// preview, a file tree/code viewer, and a ZIP download without more API calls.
$filesOut = [];
$byteBudget = 240000;
foreach ($allFiles as $path => $content) {
    if ($byteBudget <= 0) break;
    $slice = substr($content, 0, min(60000, $byteBudget));
    $byteBudget -= strlen($slice);
    $filesOut[$path] = $slice;
}

mm_json_response(200, [
    'status' => 'ok',
    'built' => count($committed) > 0,
    'repo' => "$owner/$name",
    'repoUrl' => "https://github.com/$owner/$name",
    'committed' => $committed,
    'failed' => $failed,
    'files' => $filesOut,
    'log' => $log,
    'teacher' => $teacherReply,
    'sections' => $sections,
]);

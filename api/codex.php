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
 * Safety net so a delivered project is actually coherent and runnable:
 *  - drop empty files
 *  - never ship Flask debug mode (RCE risk)
 *  - strip <link>/<script> references to LOCAL files that weren't generated,
 *    so the live preview never 404s on a missing stylesheet/script.
 */
function cx_finalize_files(array $files, bool $isWeb): array {
    foreach ($files as $p => $c) {
        if (trim((string) $c) === '') { unset($files[$p]); continue; }
        if (preg_match('/\.py$/i', $p)) {
            $files[$p] = preg_replace('/debug\s*=\s*True/i', 'debug=False', $c);
        }
    }
    if ($isWeb) {
        $strip = function (string $ref) use ($files): bool {
            if (preg_match('#^(https?:)?//#i', $ref) || strncmp($ref, 'data:', 5) === 0) return false; // external — keep
            $key = ltrim(preg_replace('#[?\#].*$#', '', $ref), './');
            return !isset($files[$key]); // local + missing → strip
        };
        foreach ($files as $p => $c) {
            if (!preg_match('/\.html?$/i', $p)) continue;
            $c = preg_replace_callback('/<link\b[^>]*\bhref=["\']([^"\']+)["\'][^>]*>/i', fn ($m) => $strip($m[1]) ? '' : $m[0], $c);
            $c = preg_replace_callback('/<script\b[^>]*\bsrc=["\']([^"\']+)["\'][^>]*><\/script>/i', fn ($m) => $strip($m[1]) ? '' : $m[0], $c);
            $files[$p] = $c;
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

// The Orchestra: 🧭 Gemini plans → 🛠 Claude builds from the plan (sole file
// author, so nothing references missing pieces) → 🔍 ChatGPT reviews →
// 🧪 Groq tests → 🚀 Codex ships.
$isWeb = (bool) preg_match('/html|css|js|javascript|react|vue|svelte|frontend|web/i', $language);

$repoNote = $repoContext !== ''
    ? "\n\nThe repo already contains these files — output a file at the EXACT SAME path to change it, a new path to add one, and never reference a file that does not exist." . $repoContext
    : '';
$ctx = "Project: " . substr($task, 0, 1200) . "\nStack: " . $language . "\nRepo: $owner/$name."
    . ($existing !== '' ? "\n\nExisting code from the student:\n```\n" . substr($existing, 0, 6000) . "\n```" : '')
    . $repoNote . "\nAudience level: " . $userLevel . '.';

$rulesWeb = "\n\nHARD RULES — a broken build is a failure:\n"
    . "1. The app MUST actually work when opened — wire up EVERY button, form and interaction with real, working JavaScript.\n"
    . "2. Deliver a SINGLE self-contained index.html: put ALL CSS in one <style> tag and ALL JavaScript in one <script> tag inside that same file. Do NOT reference external local files (no <link href=\"styles.css\">, no <script src=\"app.js\">).\n"
    . "3. Modern, clean, responsive dark UI.\n4. No placeholders, no TODO, no dead links, nothing left unfinished.\n5. Also add a short README.md that matches the project exactly.";
$rulesCode = "\n\nHARD RULES — a broken build is a failure:\n"
    . "1. The project MUST run as-is. EVERY module you import/require/include MUST be a file you also output — never reference a file you don't create.\n"
    . "2. Never use debug or production-unsafe settings (e.g. never Flask debug=True).\n"
    . "3. Names consistent with the task; no placeholders or TODO.\n4. Add a README.md with exact run steps that matches the project.";

$buildVerb = $mode === 'fix'
    ? "FIX and IMPROVE the project as asked, re-outputting every changed file IN FULL"
    : "BUILD the complete project from scratch";

// ── STAGE 1 · 🧭 PLAN (Gemini) — a real plan the builder must follow ─────────
$planPrompt = "You are the PLANNER on an AI dev orchestra. $ctx\n\n"
    . "Write a tight build plan for this task (max 12 lines): the app's core features (bulleted), "
    . "the exact file(s) to create, the data model/state, and the trickiest part with how to handle it. "
    . "No code — just the plan.";
$planResult = mm_call_engine('solver', 'Programming', $userLevel, $planPrompt, [], [], 600, 0.4);
$planText = ($planResult['ok'] ?? false) ? trim((string) $planResult['reply']) : '';
$planNote = $planText !== '' ? "\n\nFOLLOW THIS BUILD PLAN from the team's planner:\n" . substr($planText, 0, 2200) : '';

// ── STAGE 2 · 🛠 BUILD (Claude) + 🔍 REVIEW (ChatGPT) + 🧪 TEST (Groq) ───────
$builderPrompt = "You are the ENGINEER on an AI dev orchestra, shipping a real project. $ctx$planNote\n\nTask: $buildVerb."
    . ($isWeb ? $rulesWeb : $rulesCode) . $fileFormat;

$assignments = [
    'storyteller' => $builderPrompt, // Claude — the ONLY file author
    'explorer' => "You are the CODE REVIEWER on an AI dev orchestra. $ctx" . ($planText !== '' ? "\n\nThe planner's plan:\n" . substr($planText, 0, 1500) : '') . "\n\nDo NOT output any files or code blocks. In 2-3 short bullets, review the plan/approach and name the single most likely bug to watch for.",
    'reasoner' => "You are the QA TESTER and CODING TEACHER on an AI dev orchestra. $ctx\n\nDo NOT output any files or full code blocks. Two parts:\n"
        . "1) List 3 concrete test cases as 'do X → expect Y' that prove the app works.\n"
        . "2) Then a line containing exactly ===LESSON=== followed by a VERY SHORT lesson (max 6 short lines, plain words for a $userLevel): "
        . "what each part of this exact app's code does (HTML structure / styling / the logic), the 1-2 key concepts used, and the first step to rebuild it yourself.",
];
$roleNames = [
    'solver' => '🧭 Planner',
    'storyteller' => '🛠 Engineer',
    'explorer' => '🔍 Reviewer',
    'reasoner' => '🧪 Tester',
];

$results = mm_call_engine_assignments($assignments, 'Programming', $userLevel, 3400, 0.3);

if (count($results) === 0 || !isset($results['storyteller'])) {
    mm_json_response(200, [
        'status' => 'ok',
        'fallback' => true,
        'repo' => "$owner/$name",
        'repoUrl' => "https://github.com/$owner/$name",
        'sections' => [['role' => '🧠 Hungter', 'engine' => 'Hungter', 'reply' => "The engines are offline right now. Owner: open /api/setup.php to add an AI key, then Codex can build."]],
    ]);
    exit;
}

// Files come ONLY from the engineer, then get repaired for coherence.
$allFiles = cx_finalize_files(cx_parse_files((string) ($results['storyteller']['reply'] ?? '')), $isWeb);

$sections = [];
if ($planText !== '') {
    $sections[] = ['role' => $roleNames['solver'], 'engine' => mm_engine_display_name($planResult), 'reply' => $planText];
}
$teacherReply = '';
foreach (['storyteller', 'explorer', 'reasoner'] as $key) {
    if (!isset($results[$key])) continue;
    $reply = (string) ($results[$key]['reply'] ?? '');
    if ($key === 'reasoner' && strpos($reply, '===LESSON===') !== false) {
        // Split Groq's answer: test cases stay in the Tester section, the short
        // "how to code this yourself" lesson becomes the teacher block.
        [$tests, $lesson] = array_map('trim', explode('===LESSON===', $reply, 2));
        $reply = $tests;
        $teacherReply = $lesson;
    } elseif ($key === 'reasoner') {
        $teacherReply = '';
    }
    $sections[] = $key === 'storyteller'
        ? ['role' => $roleNames[$key], 'engine' => mm_engine_display_name($results[$key]), 'files' => array_keys($allFiles)]
        : ['role' => $roleNames[$key], 'engine' => mm_engine_display_name($results[$key]), 'reply' => $reply];
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

// Commit a build log so the repo shows what happened (kept OUT of the project
// file count so "N files" is honest).
$projectCount = count($committed);
if ($projectCount > 0) {
    $logMd = "# 🤖 Hungter Codex build\n\n**Task:** " . $task . "\n\n**Mode:** " . $mode . "  \n**Stack:** " . $language . "\n\n## Files\n"
        . implode("\n", array_map(fn ($f) => "- `$f`", $committed)) . "\n\n## How it works\n\n" . $teacherReply . "\n";
    cx_put_file($token, $owner, $name, 'CODEX_BUILD.md', $logMd, 'Codex: build notes');
}

$log[] = $projectCount > 0
    ? '✅ Committed ' . $projectCount . ' file' . ($projectCount === 1 ? '' : 's') . " to $owner/$name (+ build notes)"
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
    'teacher' => $teacherReply, // the short "how to code this yourself" lesson
    'sections' => $sections,
]);

<?php
// Real GitHub OAuth for Codex.
//   No ?code   -> redirect the user to GitHub to authorize.
//   ?code=...  -> exchange it for a token, read the GitHub profile, drop a
//                 signed cookie, and bounce back to /codex signed in.
// The Client ID is public. The secret is read ONLY from the server .env
// (GITHUB_CLIENT_SECRET) and is never committed.
require_once __DIR__ . '/_config.php';

$clientId = mm_env_value('GITHUB_CLIENT_ID', 'Ov23lippGfF9FsZ0QUMm');
$secret = mm_env_value('GITHUB_CLIENT_SECRET', '');

$scheme = (($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') ? 'https' : 'http';
$host = $_SERVER['HTTP_HOST'] ?? 'localhost';
$redirectUri = $scheme . '://' . $host . '/api/github-callback.php';

$code = trim((string) ($_GET['code'] ?? ''));

// Step 1 — send the user to GitHub.
if ($code === '') {
    $state = bin2hex(random_bytes(8));
    setcookie('gh_state', $state, ['expires' => time() + 600, 'path' => '/', 'secure' => $scheme === 'https', 'httponly' => true, 'samesite' => 'Lax']);
    $url = 'https://github.com/login/oauth/authorize?' . http_build_query([
        'client_id' => $clientId,
        'redirect_uri' => $redirectUri,
        // 'repo' lets Codex create repositories and commit files on the
        // user's behalf — that is what makes it an autonomous builder.
        'scope' => 'repo read:user user:email',
        'state' => $state,
    ]);
    header('Location: ' . $url);
    exit;
}

function gh_fail(string $msg): void {
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/brand.css"><body style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;"><div style="max-width:460px;background:rgba(13,20,40,.85);border:1px solid var(--border-glow);border-radius:18px;padding:34px;text-align:center;"><h1 style="font-size:1.3rem;">GitHub sign-in issue</h1><p style="color:var(--ink-soft);line-height:1.6;">' . htmlspecialchars($msg, ENT_QUOTES) . '</p><a href="/codex.html" style="color:var(--cyan);">Back to Codex</a></div></body>';
    exit;
}

if ($secret === '') {
    gh_fail('GitHub sign-in is not finished setting up on the server (missing GITHUB_CLIENT_SECRET in .env). The owner can add it at /api/setup.php?provider=github.');
}

// Optional CSRF check.
if (isset($_COOKIE['gh_state'], $_GET['state']) && !hash_equals((string) $_COOKIE['gh_state'], (string) $_GET['state'])) {
    gh_fail('Security check failed (state mismatch). Please try signing in again.');
}

// Step 2 — exchange the code for an access token.
$ch = curl_init('https://github.com/login/oauth/access_token');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/x-www-form-urlencoded'],
    CURLOPT_POSTFIELDS => http_build_query(['client_id' => $clientId, 'client_secret' => $secret, 'code' => $code, 'redirect_uri' => $redirectUri]),
    CURLOPT_TIMEOUT => 15,
]);
$raw = curl_exec($ch);
$err = curl_error($ch);
curl_close($ch);
if ($raw === false) { gh_fail('Could not reach GitHub (' . $err . ').'); }
$token = json_decode((string) $raw, true)['access_token'] ?? '';
if ($token === '') { gh_fail('GitHub did not return a token. The Client ID/Secret may not match this app.'); }

// Step 3 — fetch the profile.
$ch = curl_init('https://api.github.com/user');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token, 'User-Agent: Hungter', 'Accept: application/vnd.github+json'],
    CURLOPT_TIMEOUT => 15,
]);
$profileRaw = curl_exec($ch);
curl_close($ch);
$profile = json_decode((string) $profileRaw, true) ?: [];
$login = (string) ($profile['login'] ?? '');
if ($login === '') { gh_fail('Could not read your GitHub profile. Please try again.'); }

// Signed session cookie the frontend can trust (HMAC with ADMIN_KEY or a
// server salt so it cannot be forged client-side).
$salt = mm_env_value('ADMIN_KEY', '') . '|hungter-gh';
$payload = json_encode(['login' => $login, 'name' => (string) ($profile['name'] ?? $login), 'avatar' => (string) ($profile['avatar_url'] ?? ''), 'ts' => time()]);
$sig = hash_hmac('sha256', $payload, $salt);
$cookie = base64_encode($payload) . '.' . $sig;
setcookie('mm_github', $cookie, ['expires' => time() + 30 * 86400, 'path' => '/', 'secure' => $scheme === 'https', 'httponly' => false, 'samesite' => 'Lax']);

// The access token itself goes in a SEPARATE httponly cookie the browser JS
// can never read — only the server reads it, to create repos and push files.
// HMAC-signed so it cannot be forged or tampered with.
$tokenPayload = json_encode(['token' => $token, 'login' => $login, 'ts' => time()]);
$tokenSig = hash_hmac('sha256', $tokenPayload, $salt);
setcookie('mm_gh_token', base64_encode($tokenPayload) . '.' . $tokenSig, ['expires' => time() + 30 * 86400, 'path' => '/', 'secure' => $scheme === 'https', 'httponly' => true, 'samesite' => 'Lax']);

header('Location: /codex.html?github=connected');
exit;

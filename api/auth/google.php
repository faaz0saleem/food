<?php
// Sign in with Google. The browser gets an ID token from Google Identity
// Services and POSTs it here as {credential}. We VERIFY it with Google (never
// trust the client), then create/find the user and hand back a session token.
require_once __DIR__ . '/../_config.php';

mm_handle_options();
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$clientId = mm_env_value('GOOGLE_CLIENT_ID', '222174024094-g85g7rm3mhjjcmp93j2e4thgd2pvhm3s.apps.googleusercontent.com');

$body = mm_read_json_body();
$credential = trim((string) ($body['credential'] ?? ''));
if ($credential === '') {
    mm_json_response(400, ['error' => 'Missing Google credential.']);
    exit;
}

// ── Verify the ID token with Google ──────────────────────────────────────────
$ch = curl_init('https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($credential));
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12]);
$raw = curl_exec($ch);
$httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
$info = json_decode((string) $raw, true);
if ($httpCode !== 200 || !is_array($info)) {
    mm_json_response(401, ['error' => 'Could not verify Google sign-in. Please try again.']);
    exit;
}

// Audience must be OUR client id, issuer must be Google, token unexpired,
// and the email must be verified by Google.
$aud = (string) ($info['aud'] ?? '');
$iss = (string) ($info['iss'] ?? '');
$exp = (int) ($info['exp'] ?? 0);
$email = strtolower(trim((string) ($info['email'] ?? '')));
$emailVerified = ($info['email_verified'] ?? 'false') === 'true' || ($info['email_verified'] ?? false) === true;

if ($aud !== $clientId) {
    mm_json_response(401, ['error' => 'This sign-in was not issued for Hungter.']);
    exit;
}
if ($iss !== 'https://accounts.google.com' && $iss !== 'accounts.google.com') {
    mm_json_response(401, ['error' => 'Invalid token issuer.']);
    exit;
}
if ($exp < time()) {
    mm_json_response(401, ['error' => 'Sign-in expired — please try again.']);
    exit;
}
if ($email === '' || !$emailVerified) {
    mm_json_response(401, ['error' => 'Your Google email is not verified.']);
    exit;
}

$name = trim((string) ($info['name'] ?? '')) ?: (explode('@', $email)[0]);
$picture = trim((string) ($info['picture'] ?? ''));

$db = mm_db();
if ($db === null) {
    mm_json_response(503, ['error' => 'Accounts are not available right now (database offline).']);
    exit;
}
mm_ensure_runtime_tables();

try {
    $stmt = $db->prepare('SELECT * FROM users WHERE email = :e LIMIT 1');
    $stmt->execute([':e' => $email]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        $ins = $db->prepare('INSERT INTO users (visitor_id, name, email, password_hash, email_verified, learning_style, level, xp, plan_status, created_at, updated_at)
                             VALUES (:vid, :n, :e, :ph, 1, :ls, :lv, 0, :ps, UTC_TIMESTAMP(), UTC_TIMESTAMP())');
        $ins->execute([
            ':vid' => substr('g_' . bin2hex(random_bytes(8)), 0, 64),
            ':n' => substr($name, 0, 120),
            ':e' => $email,
            ':ph' => 'google-oauth', // no local password — sign-in is Google-only
            ':ls' => 'Visual',
            ':lv' => 'Newbie',
            ':ps' => 'inactive',
        ]);
        $userId = mm_last_insert_id($db, 'users_id_seq');
        $isNew = true;
    } else {
        $userId = (int) $user['id'];
        $isNew = false;
        // Keep the display name fresh.
        if (trim((string) ($user['name'] ?? '')) === '' && $name !== '') {
            $db->prepare('UPDATE users SET name = :n WHERE id = :id')->execute([':n' => substr($name, 0, 120), ':id' => $userId]);
        }
    }

    $token = mm_create_session($userId);
    mm_json_response(200, [
        'status' => 'ok',
        'token' => $token,
        'isNew' => $isNew,
        'user' => ['id' => $userId, 'name' => $name, 'email' => $email, 'picture' => $picture],
    ]);
} catch (Throwable $e) {
    mm_json_response(500, ['error' => 'Sign-in failed: ' . $e->getMessage()]);
}

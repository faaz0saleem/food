<?php
// Admin JSON API for admin.hungter.com. Username/password admins (seeded
// admin / Faaz12345), each issuing a signed token. Everything the owner needs:
// analytics + time series, full user list, delete a user, grant free access,
// create more admins, and a geography breakdown.
require_once __DIR__ . '/_config.php';

mm_handle_options();

$db = mm_db();
$body = mm_read_json_body();
$action = strtolower(trim((string) ($_GET['action'] ?? ($body['action'] ?? 'overview'))));

// ── Admin accounts ───────────────────────────────────────────────────────────
function admin_ensure(?PDO $db): void {
    if ($db === null) return;
    try {
        // On Postgres the admins table comes from supabase/schema.sql.
        if (mm_db_driver() !== 'pgsql') {
            $db->exec('CREATE TABLE IF NOT EXISTS admins (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                username VARCHAR(64) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                created_at DATETIME NOT NULL,
                PRIMARY KEY (id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
        }
        $count = (int) $db->query('SELECT COUNT(*) FROM admins')->fetchColumn();
        if ($count === 0) {
            $seedPass = mm_env_value('ADMIN_SEED_PASSWORD', 'Faaz12345');
            $stmt = $db->prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (:u, :p, UTC_TIMESTAMP())');
            $stmt->execute([':u' => 'admin', ':p' => password_hash($seedPass, PASSWORD_DEFAULT)]);
        }
    } catch (Throwable $e) { /* ignore */ }
}

function admin_secret(): string {
    $k = mm_env_value('ADMIN_KEY', '');
    return ($k !== '' ? $k : 'hungter-fallback-secret') . '|hungter-admin-v1';
}
function admin_make_token(string $username): string {
    $payload = json_encode(['u' => $username, 'exp' => time() + 7 * 86400]);
    return base64_encode($payload) . '.' . hash_hmac('sha256', $payload, admin_secret());
}
function admin_valid_token(string $token): ?string {
    if ($token === '' || strpos($token, '.') === false) return null;
    [$b64, $sig] = explode('.', $token, 2);
    $payload = base64_decode($b64, true);
    if ($payload === false || !hash_equals(hash_hmac('sha256', $payload, admin_secret()), $sig)) return null;
    $d = json_decode($payload, true);
    if (!is_array($d) || ($d['exp'] ?? 0) < time()) return null;
    return (string) ($d['u'] ?? '');
}
function admin_authed(array $body): bool {
    // Either a valid admin session token, or the raw ADMIN_KEY (legacy).
    $tok = trim((string) ($_SERVER['HTTP_X_ADMIN_TOKEN'] ?? ($body['admtok'] ?? '')));
    if ($tok !== '' && admin_valid_token($tok) !== null) return true;
    $key = trim((string) ($_SERVER['HTTP_X_ADMIN_KEY'] ?? ($_GET['key'] ?? ($body['key'] ?? ''))));
    $expected = mm_env_value('ADMIN_KEY', '');
    return $expected !== '' && hash_equals($expected, $key);
}

if ($db !== null) { mm_ensure_runtime_tables(); } // provisions tables on Supabase
admin_ensure($db);

// ── Public: login ────────────────────────────────────────────────────────────
if ($action === 'login') {
    // Brute-force lock: max 5 attempts per IP per minute.
    mm_require_rate_limit('admin-login|' . mm_client_ip(), 5, 60);
    if ($db === null) { mm_json_response(503, ['error' => 'Database offline — connect the DB in .env first (the admin needs MySQL to store admins and users).']); exit; }
    $u = trim((string) ($body['username'] ?? ''));
    $p = (string) ($body['password'] ?? '');
    try {
        $stmt = $db->prepare('SELECT password_hash FROM admins WHERE username = :u LIMIT 1');
        $stmt->execute([':u' => $u]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row || !password_verify($p, (string) $row['password_hash'])) {
            mm_json_response(401, ['error' => 'Wrong username or password.']);
            exit;
        }
        mm_json_response(200, ['status' => 'ok', 'token' => admin_make_token($u), 'username' => $u]);
    } catch (Throwable $e) { mm_json_response(500, ['error' => 'Login failed: ' . $e->getMessage()]); }
    exit;
}

// ── Everything below requires admin auth ─────────────────────────────────────
if (!admin_authed($body)) {
    mm_json_response(401, ['error' => 'Unauthorized']);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

function cx_series(?PDO $db, string $sql, int $days = 14): array {
    $map = [];
    if ($db !== null) {
        try {
            $stmt = $db->query($sql);
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) { $map[(string) ($row['d'] ?? '')] = (int) ($row['c'] ?? 0); }
        } catch (Throwable $e) {}
    }
    $out = [];
    for ($i = $days - 1; $i >= 0; $i--) {
        $day = gmdate('Y-m-d', time() - $i * 86400);
        $out[] = ['date' => substr($day, 5), 'value' => $map[$day] ?? 0];
    }
    return $out;
}

if ($method === 'POST' && $action === 'grant') {
    if ($db === null) { mm_json_response(503, ['error' => 'Database offline.']); exit; }
    $email = strtolower(trim((string) ($body['email'] ?? '')));
    $plan = strtolower(trim((string) ($body['plan'] ?? 'pro')));
    $plans = ['free' => 0.0, 'student' => 5.0, 'pro' => 12.0];
    if ($email === '' || !isset($plans[$plan])) { mm_json_response(400, ['error' => 'Need a valid email and plan.']); exit; }
    try {
        $stmt = $db->prepare('UPDATE users SET plan_name = :p, plan_price = 0, plan_status = :st, plan_started = UTC_TIMESTAMP() WHERE email = :e');
        $stmt->execute([':p' => $plan === 'free' ? '' : ucfirst($plan), ':st' => $plan === 'free' ? 'inactive' : 'active', ':e' => $email]);
        if ($stmt->rowCount() === 0) { mm_json_response(404, ['error' => 'No user with that email.']); exit; }
        mm_json_response(200, ['status' => 'ok', 'message' => ($plan === 'free' ? 'Removed access for ' : 'Granted free ' . ucfirst($plan) . ' access to ') . $email]);
    } catch (Throwable $e) { mm_json_response(500, ['error' => 'Grant failed: ' . $e->getMessage()]); }
    exit;
}

if ($method === 'POST' && $action === 'delete_user') {
    if ($db === null) { mm_json_response(503, ['error' => 'Database offline.']); exit; }
    $id = (int) ($body['id'] ?? 0);
    if ($id <= 0) { mm_json_response(400, ['error' => 'Need a user id.']); exit; }
    try {
        $db->prepare('DELETE FROM auth_sessions WHERE user_id = :id')->execute([':id' => $id]);
        $stmt = $db->prepare('DELETE FROM users WHERE id = :id');
        $stmt->execute([':id' => $id]);
        mm_json_response(200, ['status' => 'ok', 'message' => 'Deleted user #' . $id, 'deleted' => $stmt->rowCount()]);
    } catch (Throwable $e) { mm_json_response(500, ['error' => 'Delete failed: ' . $e->getMessage()]); }
    exit;
}

if ($method === 'POST' && $action === 'create_admin') {
    if ($db === null) { mm_json_response(503, ['error' => 'Database offline.']); exit; }
    $u = trim((string) ($body['username'] ?? ''));
    $p = (string) ($body['password'] ?? '');
    if (strlen($u) < 3 || strlen($p) < 6) { mm_json_response(400, ['error' => 'Username ≥ 3 chars and password ≥ 6 chars.']); exit; }
    try {
        $stmt = $db->prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (:u, :p, UTC_TIMESTAMP())');
        $stmt->execute([':u' => $u, ':p' => password_hash($p, PASSWORD_DEFAULT)]);
        mm_json_response(200, ['status' => 'ok', 'message' => 'Created admin “' . $u . '”.']);
    } catch (Throwable $e) {
        $msg = strpos($e->getMessage(), 'Duplicate') !== false ? 'That username already exists.' : $e->getMessage();
        mm_json_response(400, ['error' => $msg]);
    }
    exit;
}

if ($action === 'admins') {
    $admins = [];
    if ($db !== null) {
        try { $stmt = $db->query('SELECT username, created_at FROM admins ORDER BY created_at ASC');
            while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) { $admins[] = ['username' => $r['username'], 'created' => $r['created_at']]; }
        } catch (Throwable $e) {}
    }
    mm_json_response(200, ['status' => 'ok', 'admins' => $admins]);
    exit;
}

if ($action === 'geography') {
    $rows = [];
    if ($db !== null) {
        try {
            $stmt = $db->query("SELECT country, COUNT(*) c FROM visitor_sessions WHERE country IS NOT NULL AND country <> '' GROUP BY country ORDER BY c DESC LIMIT 30");
            while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) { $rows[] = ['country' => (string) $r['country'], 'count' => (int) $r['c']]; }
        } catch (Throwable $e) { /* column may not exist yet */ }
    }
    mm_json_response(200, ['status' => 'ok', 'countries' => $rows, 'note' => $rows ? '' : 'Country data appears once visits are tagged (needs the CF-IPCountry header or a geo lookup).']);
    exit;
}

if ($action === 'users') {
    $users = [];
    if ($db !== null) {
        try {
            $stmt = $db->query('SELECT id, name, email, email_verified, plan_name, plan_price, plan_status, level, xp, created_at FROM users ORDER BY created_at DESC LIMIT 1000');
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $users[] = [
                    'id' => (int) $row['id'], 'name' => (string) ($row['name'] ?? ''), 'email' => (string) ($row['email'] ?? ''),
                    'verified' => (int) ($row['email_verified'] ?? 0) === 1, 'plan' => (string) ($row['plan_name'] ?: 'Free'),
                    'price' => (float) ($row['plan_price'] ?? 0), 'active' => (string) ($row['plan_status'] ?? '') === 'active',
                    'level' => (string) ($row['level'] ?? ''), 'joined' => (string) ($row['created_at'] ?? ''),
                ];
            }
        } catch (Throwable $e) {}
    }
    mm_json_response(200, ['status' => 'ok', 'users' => $users, 'dbConnected' => $db !== null]);
    exit;
}

// Default: overview
$summary = mm_get_admin_summary();
$revenue = ['mrr' => 0.0, 'payingUsers' => 0, 'totalUsers' => 0, 'bookRevenue' => 0.0];
if ($db !== null) {
    try {
        $r = $db->query("SELECT COALESCE(SUM(plan_price),0) s, COUNT(*) c FROM users WHERE plan_status='active' AND plan_price>0")->fetch(PDO::FETCH_ASSOC);
        $revenue['mrr'] = (float) ($r['s'] ?? 0); $revenue['payingUsers'] = (int) ($r['c'] ?? 0);
        $revenue['totalUsers'] = (int) $db->query('SELECT COUNT(*) FROM users')->fetchColumn();
    } catch (Throwable $e) {}
    try { $revenue['bookRevenue'] = (float) $db->query("SELECT COALESCE(SUM(amount),0) FROM book_orders WHERE status='paid'")->fetchColumn(); } catch (Throwable $e) {}
}
$series = [
    'chats' => cx_series($db, "SELECT DATE(created_at) d, COUNT(*) c FROM chats WHERE created_at >= (UTC_DATE() - INTERVAL 13 DAY) GROUP BY DATE(created_at)"),
    'signups' => cx_series($db, "SELECT DATE(created_at) d, COUNT(*) c FROM users WHERE created_at >= (UTC_DATE() - INTERVAL 13 DAY) GROUP BY DATE(created_at)"),
    'active' => cx_series($db, "SELECT DATE(last_seen) d, COUNT(*) c FROM visitor_sessions WHERE last_seen >= (UTC_DATE() - INTERVAL 13 DAY) GROUP BY DATE(last_seen)"),
];
mm_json_response(200, ['status' => 'ok', 'dbConnected' => $db !== null, 'totals' => $summary, 'revenue' => $revenue, 'series' => $series]);

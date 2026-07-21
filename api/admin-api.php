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

// ── Built-in primary admin (works without any database) ──────────────────────
// Username defaults to `admin`, password to ADMIN_SEED_PASSWORD (default
// Faaz12345). This lets the owner log in even before the DB is connected.
function admin_builtin_check(string $u, string $p): bool {
    $wantUser = mm_env_value('ADMIN_USERNAME', 'admin');
    $wantPass = mm_env_value('ADMIN_SEED_PASSWORD', 'Faaz12345');
    if ($wantPass === '') return false;
    return hash_equals($wantUser, $u) && hash_equals($wantPass, $p);
}

// ── IP allowlist ─────────────────────────────────────────────────────────────
// Set ADMIN_ALLOWED_IPS in .env to a comma-separated list of IPs / CIDR ranges
// to lock the whole admin to just those addresses. Empty = allow everyone (so
// you never get permanently locked out before you've set your IP).
function admin_ip_in_cidr(string $ip, string $cidr): bool {
    if (strpos($cidr, '/') === false) return false;
    [$subnet, $bits] = explode('/', $cidr, 2);
    $bits = (int) $bits;
    $ipBin = @inet_pton($ip);
    $subBin = @inet_pton($subnet);
    if ($ipBin === false || $subBin === false || strlen($ipBin) !== strlen($subBin)) return false;
    $bytes = intdiv($bits, 8);
    $rem = $bits % 8;
    if ($bytes > 0 && strncmp($ipBin, $subBin, $bytes) !== 0) return false;
    if ($rem === 0) return true;
    $mask = chr(0xff << (8 - $rem) & 0xff);
    return (ord($ipBin[$bytes]) & ord($mask)) === (ord($subBin[$bytes]) & ord($mask));
}
function admin_ip_allowed(): bool {
    $raw = trim(mm_env_value('ADMIN_ALLOWED_IPS', ''));
    if ($raw === '') return true; // no allowlist configured — allow all
    $ip = mm_client_ip();
    foreach (explode(',', $raw) as $entry) {
        $entry = trim($entry);
        if ($entry === '') continue;
        if ($entry === $ip) return true;
        if (strpos($entry, '/') !== false && admin_ip_in_cidr($ip, $entry)) return true;
    }
    return false;
}

// ── Google Analytics (server-side, service account — no user sign-in) ─────────
// Configure with a service-account key so analytics load automatically:
//   GA_SA_JSON       = the full service-account JSON (as one string), or
//   GA_SA_KEY_FILE   = path to the downloaded .json key file, or
//   GA_SA_EMAIL + GA_SA_PRIVATE_KEY  = the two fields separately.
// Then add that service account's email as a Viewer on the GA4 property.
function ga_service_account(): ?array {
    $json = trim(mm_env_value('GA_SA_JSON', ''));
    if ($json === '') {
        $file = trim(mm_env_value('GA_SA_KEY_FILE', ''));
        if ($file !== '' && is_readable($file)) { $json = (string) file_get_contents($file); }
    }
    if ($json !== '') {
        $d = json_decode($json, true);
        if (is_array($d) && !empty($d['client_email']) && !empty($d['private_key'])) return $d;
    }
    $email = trim(mm_env_value('GA_SA_EMAIL', ''));
    $key = trim(mm_env_value('GA_SA_PRIVATE_KEY', ''));
    if ($email !== '' && $key !== '') {
        return ['client_email' => $email, 'private_key' => str_replace('\\n', "\n", $key)];
    }
    return null;
}
// Explains exactly why a service account couldn't be loaded, so setup is easy.
function ga_config_hint(): string {
    $json = trim(mm_env_value('GA_SA_JSON', ''));
    $file = trim(mm_env_value('GA_SA_KEY_FILE', ''));
    $email = trim(mm_env_value('GA_SA_EMAIL', ''));
    if ($json !== '') {
        $d = json_decode($json, true);
        if (!is_array($d) || empty($d['client_email']) || empty($d['private_key']))
            return 'GA_SA_JSON is set but is not valid service-account JSON. It is usually easier to use GA_SA_KEY_FILE with the path to your key.json instead.';
        return '';
    }
    if ($file !== '') {
        if (strpos($file, '…') !== false || strpos($file, '...') !== false)
            return 'GA_SA_KEY_FILE still contains the “…” placeholder. Replace it with the real full path to your key.json, e.g. /home/u779661998/domains/hungter.com/key.json';
        if (!file_exists($file)) return 'GA_SA_KEY_FILE points to a path that does not exist on the server: ' . $file;
        if (!is_readable($file)) return 'GA_SA_KEY_FILE exists but PHP cannot read it (fix file permissions): ' . $file;
        $d = json_decode((string) file_get_contents($file), true);
        if (!is_array($d) || empty($d['client_email']) || empty($d['private_key']))
            return 'The file at GA_SA_KEY_FILE is not a valid service-account key.json.';
        return '';
    }
    if ($email !== '' && trim(mm_env_value('GA_SA_PRIVATE_KEY', '')) === '')
        return 'GA_SA_EMAIL is set but GA_SA_PRIVATE_KEY is missing.';
    return 'No service-account key found. Set GA_SA_KEY_FILE in .env to the full path of your key.json (for example /home/u779661998/domains/hungter.com/key.json).';
}
function ga_b64url(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function ga_access_token(array $sa): ?string {
    $cache = sys_get_temp_dir() . '/hungter_ga_tok_' . md5((string) $sa['client_email']) . '.json';
    if (is_readable($cache)) {
        $c = json_decode((string) file_get_contents($cache), true);
        if (is_array($c) && ($c['exp'] ?? 0) > time() + 60 && !empty($c['token'])) return (string) $c['token'];
    }
    if (!function_exists('openssl_sign')) return null;
    $now = time();
    $head = ga_b64url(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $claim = ga_b64url(json_encode([
        'iss' => $sa['client_email'],
        'scope' => 'https://www.googleapis.com/auth/analytics.readonly',
        'aud' => 'https://oauth2.googleapis.com/token',
        'iat' => $now, 'exp' => $now + 3600,
    ]));
    $input = $head . '.' . $claim;
    $sig = '';
    if (!openssl_sign($input, $sig, $sa['private_key'], OPENSSL_ALGO_SHA256)) return null;
    $jwt = $input . '.' . ga_b64url($sig);
    $ch = curl_init('https://oauth2.googleapis.com/token');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true, CURLOPT_TIMEOUT => 15,
        CURLOPT_POSTFIELDS => http_build_query(['grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion' => $jwt]),
        CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
    ]);
    $resp = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    $d = json_decode((string) $resp, true);
    if ($code === 200 && !empty($d['access_token'])) {
        @file_put_contents($cache, json_encode(['token' => $d['access_token'], 'exp' => $now + (int) ($d['expires_in'] ?? 3600)]));
        return (string) $d['access_token'];
    }
    return null;
}
function ga_call(string $token, string $propertyId, string $method, array $body): array {
    $ch = curl_init('https://analyticsdata.googleapis.com/v1beta/properties/' . $propertyId . ':' . $method);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true, CURLOPT_TIMEOUT => 20,
        CURLOPT_POSTFIELDS => json_encode($body),
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token, 'Content-Type: application/json'],
    ]);
    $resp = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    $d = json_decode((string) $resp, true);
    if ($code === 200 && is_array($d)) return $d;
    return ['_error' => is_array($d) && isset($d['error']['message']) ? $d['error']['message'] : ('HTTP ' . $code)];
}
function ga_rows(array $rep): array {
    $out = [];
    foreach (($rep['rows'] ?? []) as $r) {
        $out[] = ['label' => (string) ($r['dimensionValues'][0]['value'] ?? ''), 'value' => (int) round((float) ($r['metricValues'][0]['value'] ?? 0))];
    }
    return $out;
}

if ($db !== null) { mm_ensure_runtime_tables(); } // provisions tables on Supabase
admin_ensure($db);

// ── Public: whoami — tells you your IP so you can set ADMIN_ALLOWED_IPS ───────
// Never IP-gated: you must be able to discover your own address to allowlist it.
if ($action === 'whoami') {
    $raw = trim(mm_env_value('ADMIN_ALLOWED_IPS', ''));
    mm_json_response(200, [
        'status' => 'ok',
        'ip' => mm_client_ip(),
        'ipLockEnabled' => $raw !== '',
        'allowed' => admin_ip_allowed(),
        'dbConnected' => $db !== null,
    ]);
    exit;
}

// ── IP lock — applies to login and every admin action below ──────────────────
if (!admin_ip_allowed()) {
    mm_json_response(403, [
        'error' => 'This admin is locked to specific IP addresses and yours (' . mm_client_ip() . ') is not on the list.',
        'ip' => mm_client_ip(),
        'hint' => 'Add this IP to ADMIN_ALLOWED_IPS in .env (comma-separated) to allow it.',
    ]);
    exit;
}

// ── Public: login ────────────────────────────────────────────────────────────
if ($action === 'login') {
    // Brute-force lock: max 5 attempts per IP per minute.
    mm_require_rate_limit('admin-login|' . mm_client_ip(), 5, 60);
    $u = trim((string) ($body['username'] ?? ''));
    $p = (string) ($body['password'] ?? '');

    // 1) Built-in primary admin — works even with no database connected.
    if (admin_builtin_check($u, $p)) {
        mm_json_response(200, ['status' => 'ok', 'token' => admin_make_token($u), 'username' => $u]);
        exit;
    }

    // 2) Database-backed admins (secondary accounts you create in the panel).
    if ($db !== null) {
        try {
            $stmt = $db->prepare('SELECT password_hash FROM admins WHERE username = :u LIMIT 1');
            $stmt->execute([':u' => $u]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($row && password_verify($p, (string) $row['password_hash'])) {
                mm_json_response(200, ['status' => 'ok', 'token' => admin_make_token($u), 'username' => $u]);
                exit;
            }
        } catch (Throwable $e) { mm_json_response(500, ['error' => 'Login failed: ' . $e->getMessage()]); exit; }
    }

    mm_json_response(401, ['error' => 'Wrong username or password.']);
    exit;
}

// ── Everything below requires admin auth ─────────────────────────────────────
if (!admin_authed($body)) {
    mm_json_response(401, ['error' => 'Unauthorized']);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// ── Google Analytics summary (auto-loads, no user sign-in) ───────────────────
if ($action === 'analytics') {
    $propertyId = trim(mm_env_value('GA_PROPERTY_ID', '543528938'));
    $sa = ga_service_account();
    if ($sa === null) {
        mm_json_response(200, ['status' => 'ok', 'configured' => false, 'hint' => ga_config_hint()]);
        exit;
    }
    $token = ga_access_token($sa);
    if ($token === null) {
        mm_json_response(200, ['status' => 'ok', 'configured' => false,
            'hint' => 'Service-account sign-in failed. Check the key is valid and PHP has the openssl + curl extensions.']);
        exit;
    }
    // Serve a cached snapshot for up to 5 minutes to respect API quotas.
    $cache = sys_get_temp_dir() . '/hungter_ga_report_' . md5($propertyId) . '.json';
    if (is_readable($cache)) {
        $c = json_decode((string) file_get_contents($cache), true);
        if (is_array($c) && ($c['_t'] ?? 0) > time() - 300 && isset($c['payload'])) { mm_json_response(200, $c['payload']); exit; }
    }
    $range = [['startDate' => '28daysAgo', 'endDate' => 'today']];
    $tot = ga_call($token, $propertyId, 'runReport', ['dateRanges' => $range, 'metrics' => [['name' => 'activeUsers'], ['name' => 'sessions'], ['name' => 'screenPageViews'], ['name' => 'newUsers']]]);
    if (isset($tot['_error'])) {
        mm_json_response(200, ['status' => 'ok', 'configured' => true, 'error' => $tot['_error'],
            'hint' => 'If this says permission denied, add the service-account email as a Viewer on GA4 property ' . $propertyId . '. If it says API disabled, enable the Google Analytics Data API.']);
        exit;
    }
    $ts = ga_call($token, $propertyId, 'runReport', ['dateRanges' => [['startDate' => '27daysAgo', 'endDate' => 'today']], 'dimensions' => [['name' => 'date']], 'metrics' => [['name' => 'activeUsers']], 'orderBys' => [['dimension' => ['dimensionName' => 'date']]]]);
    $pages = ga_call($token, $propertyId, 'runReport', ['dateRanges' => $range, 'dimensions' => [['name' => 'pagePath']], 'metrics' => [['name' => 'screenPageViews']], 'orderBys' => [['metric' => ['metricName' => 'screenPageViews'], 'desc' => true]], 'limit' => 8]);
    $countries = ga_call($token, $propertyId, 'runReport', ['dateRanges' => $range, 'dimensions' => [['name' => 'country']], 'metrics' => [['name' => 'activeUsers']], 'orderBys' => [['metric' => ['metricName' => 'activeUsers'], 'desc' => true]], 'limit' => 10]);
    $devices = ga_call($token, $propertyId, 'runReport', ['dateRanges' => $range, 'dimensions' => [['name' => 'deviceCategory']], 'metrics' => [['name' => 'activeUsers']], 'orderBys' => [['metric' => ['metricName' => 'activeUsers'], 'desc' => true]]]);
    $live = ga_call($token, $propertyId, 'runRealtimeReport', ['metrics' => [['name' => 'activeUsers']]]);
    $m = $tot['rows'][0]['metricValues'] ?? [];
    $series = [];
    foreach (ga_rows($ts) as $row) { $d = $row['label']; $series[] = ['date' => substr($d, 4, 2) . '-' . substr($d, 6, 2), 'value' => $row['value']]; }
    $payload = [
        'status' => 'ok', 'configured' => true, 'property' => $propertyId,
        'totals' => [
            'users' => (int) ($m[0]['value'] ?? 0), 'sessions' => (int) ($m[1]['value'] ?? 0),
            'views' => (int) ($m[2]['value'] ?? 0), 'newUsers' => (int) ($m[3]['value'] ?? 0),
        ],
        'series' => $series, 'pages' => ga_rows($pages), 'countries' => ga_rows($countries), 'devices' => ga_rows($devices),
        'live' => (int) ($live['rows'][0]['metricValues'][0]['value'] ?? 0),
    ];
    @file_put_contents($cache, json_encode(['_t' => time(), 'payload' => $payload]));
    mm_json_response(200, $payload);
    exit;
}

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

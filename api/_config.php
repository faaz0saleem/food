<?php

function mm_env_value(string $key, string $default = ''): string {
    $fromEnv = getenv($key);
    if ($fromEnv !== false && $fromEnv !== '') {
        return (string) $fromEnv;
    }

    $root = dirname(__DIR__);
    $envPath = $root . DIRECTORY_SEPARATOR . '.env';
    if (!is_file($envPath)) {
        return $default;
    }

    $lines = @file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) {
        return $default;
    }

    foreach ($lines as $line) {
        $trimmed = trim($line);
        if ($trimmed === '' || str_starts_with($trimmed, '#')) {
            continue;
        }

        $parts = explode('=', $trimmed, 2);
        if (count($parts) !== 2) {
            continue;
        }

        $name = trim($parts[0]);
        $value = trim($parts[1]);
        if ($name !== $key) {
            continue;
        }

        if ((str_starts_with($value, '"') && str_ends_with($value, '"')) || (str_starts_with($value, "'") && str_ends_with($value, "'"))) {
            $value = substr($value, 1, -1);
        }

        return $value;
    }

    return $default;
}

function mm_app_env(): string {
    $value = strtolower(trim(mm_env_value('APP_ENV', 'production')));
    return $value === '' ? 'production' : $value;
}

function mm_is_production_env(): bool {
    return mm_app_env() === 'production';
}

function mm_should_expose_dev_codes(): bool {
    $override = strtolower(trim(mm_env_value('AUTH_EXPOSE_DEV_CODES', '')));
    if ($override !== '') {
        return in_array($override, ['1', 'true', 'yes', 'on'], true);
    }

    return !mm_is_production_env();
}

function mm_json_response(int $statusCode, array $payload): void {
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET,POST,OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type,Authorization');
    echo json_encode($payload);
}

function mm_read_json_body(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }

    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return [];
    }

    return $decoded;
}

function mm_handle_options(): void {
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        mm_json_response(204, ['status' => 'ok']);
        exit;
    }
}

function mm_normalize_history(mixed $history): array {
    if (!is_array($history)) {
        return [];
    }

    $normalized = [];
    foreach ($history as $item) {
        if (!is_array($item)) {
            continue;
        }
        $role = isset($item['role']) && $item['role'] === 'assistant' ? 'assistant' : 'user';
        $content = trim((string) ($item['content'] ?? ''));
        if ($content === '') {
            continue;
        }
        $normalized[] = ['role' => $role, 'content' => $content];
    }

    return array_slice($normalized, -12);
}

function mm_normalize_attachments(mixed $attachments): array {
    if (!is_array($attachments)) {
        return [];
    }

    $normalized = [];
    foreach ($attachments as $item) {
        if (!is_array($item)) {
            continue;
        }

        $normalized[] = [
            'name' => substr((string) ($item['name'] ?? 'attachment'), 0, 120),
            'type' => substr((string) ($item['type'] ?? 'application/octet-stream'), 0, 120),
            'kind' => (isset($item['kind']) && $item['kind'] === 'image') ? 'image' : 'file',
            'textContent' => substr((string) ($item['textContent'] ?? ''), 0, 12000),
            'imageDataUrl' => substr((string) ($item['imageDataUrl'] ?? ''), 0, 250000),
            'size' => (int) ($item['size'] ?? 0),
        ];
    }

    return array_slice($normalized, 0, 5);
}

function mm_build_final_message(string $message, array $attachments): string {
    $message = trim($message);
    if (count($attachments) === 0) {
        return $message;
    }

    $parts = [];
    foreach ($attachments as $attachment) {
        $header = '[Attachment: ' . ($attachment['name'] ?? 'attachment') . ' | ' . ($attachment['type'] ?? 'application/octet-stream') . ' | ' . (int) ($attachment['size'] ?? 0) . ' bytes]';
        if (($attachment['kind'] ?? 'file') === 'image' && !empty($attachment['imageDataUrl'])) {
            $parts[] = $header . "\nImage data URL provided by student (truncated):\n" . substr((string) $attachment['imageDataUrl'], 0, 1800);
            continue;
        }

        if (!empty($attachment['textContent'])) {
            $parts[] = $header . "\nFile text excerpt:\n" . (string) $attachment['textContent'];
            continue;
        }

        $parts[] = $header . "\nNo parseable text extracted.";
    }

    return $message . "\n\nStudent uploaded files/images for analysis:\n" . implode("\n\n", $parts);
}

function mm_db(): ?PDO {
    static $pdo = false;
    if ($pdo !== false) {
        return $pdo;
    }

    $host = mm_env_value('MYSQL_HOST', mm_env_value('DB_HOST', ''));
    $port = mm_env_value('MYSQL_PORT', mm_env_value('DB_PORT', '3306'));
    $name = mm_env_value('MYSQL_DATABASE', mm_env_value('DB_NAME', ''));
    $user = mm_env_value('MYSQL_USER', mm_env_value('DB_USER', ''));
    $pass = mm_env_value('MYSQL_PASSWORD', mm_env_value('DB_PASSWORD', ''));

    if ($host === '' || $name === '' || $user === '') {
        $pdo = null;
        return $pdo;
    }

    try {
        $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $host, $port, $name);
        $pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    } catch (Throwable $error) {
        $pdo = null;
    }

    return $pdo;
}

function mm_ensure_runtime_tables(): void {
    static $initialized = false;
    if ($initialized) {
        return;
    }

    $db = mm_db();
    if ($db === null) {
        return;
    }

    $db->exec('CREATE TABLE IF NOT EXISTS auth_sessions (
        token VARCHAR(128) NOT NULL PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        KEY idx_auth_sessions_user_id (user_id),
        KEY idx_auth_sessions_expires_at (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');

    $db->exec('CREATE TABLE IF NOT EXISTS api_rate_limits (
        limiter_key VARCHAR(160) NOT NULL PRIMARY KEY,
        window_start DATETIME NOT NULL,
        request_count INT NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');

    $db->exec('CREATE TABLE IF NOT EXISTS ai_usage_daily (
        usage_date DATE NOT NULL,
        scope_key VARCHAR(190) NOT NULL,
        user_id BIGINT UNSIGNED NULL,
        calls_used INT NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (usage_date, scope_key),
        KEY idx_ai_usage_daily_user_id (user_id),
        KEY idx_ai_usage_daily_updated_at (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');

    $db->exec('CREATE TABLE IF NOT EXISTS auth_challenges (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        challenge_type VARCHAR(32) NOT NULL,
        code_hash VARCHAR(255) NOT NULL,
        expires_at DATETIME NOT NULL,
        consumed_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_auth_challenges_user_id (user_id),
        KEY idx_auth_challenges_type (challenge_type),
        KEY idx_auth_challenges_expires_at (expires_at),
        CONSTRAINT fk_auth_challenges_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');

    $db->exec('CREATE TABLE IF NOT EXISTS book_orders (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_ref VARCHAR(40) NOT NULL,
        book_id VARCHAR(120) NOT NULL,
        book_title VARCHAR(255) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        email VARCHAR(190) NOT NULL,
        user_id BIGINT UNSIGNED NULL,
        status VARCHAR(30) NOT NULL DEFAULT \'pending\',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_book_orders_order_ref (order_ref),
        KEY idx_book_orders_email (email),
        KEY idx_book_orders_book_id (book_id),
        KEY idx_book_orders_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');

    $initialized = true;
}

function mm_client_ip(): string {
    $forwarded = trim((string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ''));
    if ($forwarded !== '') {
        $parts = explode(',', $forwarded);
        $first = trim((string) ($parts[0] ?? ''));
        if ($first !== '') {
            return substr($first, 0, 64);
        }
    }

    $remote = trim((string) ($_SERVER['REMOTE_ADDR'] ?? ''));
    if ($remote !== '') {
        return substr($remote, 0, 64);
    }

    return 'unknown';
}

function mm_rate_limit_key(array $body = []): string {
    $visitorId = trim((string) ($body['visitorId'] ?? ''));
    if ($visitorId !== '') {
        return 'visitor:' . substr($visitorId, 0, 120);
    }

    return 'ip:' . mm_client_ip();
}

function mm_require_rate_limit(string $key, int $maxRequests, int $windowSeconds): void {
    $db = mm_db();
    if ($db === null) {
        // No database configured (e.g. local dev without MySQL) - fail open
        // rather than blocking every auth request.
        return;
    }
    mm_ensure_runtime_tables();

    $limiterKey = substr($key, 0, 160);
    $stmt = $db->prepare('SELECT window_start, request_count FROM api_rate_limits WHERE limiter_key = :limiter_key LIMIT 1');
    $stmt->execute([':limiter_key' => $limiterKey]);
    $row = $stmt->fetch();

    if ($row === false) {
        $insert = $db->prepare('INSERT INTO api_rate_limits (limiter_key, window_start, request_count)
                                VALUES (:limiter_key, UTC_TIMESTAMP(), 1)
                                ON DUPLICATE KEY UPDATE window_start = VALUES(window_start), request_count = 1');
        $insert->execute([':limiter_key' => $limiterKey]);
        return;
    }

    $windowStart = strtotime((string) $row['window_start'] . ' UTC');
    $elapsed = time() - $windowStart;

    if ($elapsed > $windowSeconds) {
        $reset = $db->prepare('UPDATE api_rate_limits SET window_start = UTC_TIMESTAMP(), request_count = 1 WHERE limiter_key = :limiter_key');
        $reset->execute([':limiter_key' => $limiterKey]);
        return;
    }

    if ((int) $row['request_count'] >= $maxRequests) {
        mm_json_response(429, ['error' => 'Too many requests. Please wait a moment and try again.']);
        exit;
    }

    $bump = $db->prepare('UPDATE api_rate_limits SET request_count = request_count + 1 WHERE limiter_key = :limiter_key');
    $bump->execute([':limiter_key' => $limiterKey]);
}

function mm_ai_scope_key(array $body = []): string {
    $user = mm_current_user();
    if (is_array($user) && isset($user['id'])) {
        return 'user:' . (int) $user['id'];
    }

    $visitorId = trim((string) ($body['visitorId'] ?? ''));
    if ($visitorId !== '') {
        return 'visitor:' . substr($visitorId, 0, 120);
    }

    return 'ip:' . mm_client_ip();
}

function mm_is_paid_user(?array $user): bool {
    if (!is_array($user)) {
        return false;
    }

    $status = strtolower(trim((string) ($user['plan_status'] ?? 'inactive')));
    $planName = strtolower(trim((string) ($user['plan_name'] ?? '')));
    if ($status !== 'active') {
        return false;
    }

    return $planName !== '' && $planName !== 'free';
}

function mm_get_ai_usage_today(string $scopeKey): int {
    $db = mm_db();
    if ($db === null) {
        return 0;
    }

    mm_ensure_runtime_tables();
    $stmt = $db->prepare('SELECT calls_used FROM ai_usage_daily WHERE usage_date = UTC_DATE() AND scope_key = :scope_key LIMIT 1');
    $stmt->execute([':scope_key' => substr($scopeKey, 0, 190)]);
    $value = $stmt->fetchColumn();
    return (int) ($value ?: 0);
}

function mm_get_global_ai_usage_today(): int {
    $db = mm_db();
    if ($db === null) {
        return 0;
    }

    mm_ensure_runtime_tables();
    $stmt = $db->query('SELECT COALESCE(SUM(calls_used), 0) FROM ai_usage_daily WHERE usage_date = UTC_DATE()');
    return (int) $stmt->fetchColumn();
}

function mm_record_ai_usage(string $scopeKey, ?int $userId, int $cost = 1): void {
    $db = mm_db();
    if ($db === null) {
        return;
    }

    mm_ensure_runtime_tables();
    $scope = substr($scopeKey, 0, 190);
    $stmt = $db->prepare('INSERT INTO ai_usage_daily (usage_date, scope_key, user_id, calls_used, updated_at)
                          VALUES (UTC_DATE(), :scope_key, :user_id, :calls_used, UTC_TIMESTAMP())
                          ON DUPLICATE KEY UPDATE calls_used = calls_used + VALUES(calls_used), user_id = VALUES(user_id), updated_at = UTC_TIMESTAMP()');
    $stmt->bindValue(':scope_key', $scope, PDO::PARAM_STR);
    if ($userId === null) {
        $stmt->bindValue(':user_id', null, PDO::PARAM_NULL);
    } else {
        $stmt->bindValue(':user_id', $userId, PDO::PARAM_INT);
    }
    $stmt->bindValue(':calls_used', max(1, $cost), PDO::PARAM_INT);
    $stmt->execute();
}

function mm_ai_budget_decision(array $body = [], int $cost = 1): array {
    $user = mm_current_user();
    $scopeKey = mm_ai_scope_key($body);
    $isPaid = mm_is_paid_user($user);
    $freeLimit = max(1, (int) mm_env_value('FREE_DAILY_MESSAGES_LIMIT', '20'));
    $anonLimit = max(1, (int) mm_env_value('ANON_DAILY_AI_LIMIT', '3'));
    $globalLimit = max(1, (int) mm_env_value('AI_DAILY_GLOBAL_LIMIT', '500'));

    $globalUsed = mm_get_global_ai_usage_today();
    if (($globalUsed + $cost) > $globalLimit) {
        return [
            'mode' => 'demo',
            'message' => 'AI is at today\'s capacity. Hungter is temporarily in demo mode until midnight UTC.',
            'scopeKey' => $scopeKey,
            'user' => $user,
        ];
    }

    $used = mm_get_ai_usage_today($scopeKey);
    if ($user === null) {
        if (($used + $cost) > $anonLimit) {
            return [
                'mode' => 'signup',
                'message' => 'Create a free account to continue after your launch-preview messages.',
                'scopeKey' => $scopeKey,
                'user' => null,
            ];
        }

        return ['mode' => 'live', 'scopeKey' => $scopeKey, 'user' => null];
    }

    if (!$isPaid && (($used + $cost) > $freeLimit)) {
        return [
            'mode' => 'limit',
            'message' => 'Free plan limit reached for today. Upgrade or come back tomorrow for more AI help.',
            'scopeKey' => $scopeKey,
            'user' => $user,
        ];
    }

    return ['mode' => 'live', 'scopeKey' => $scopeKey, 'user' => $user];
}

function mm_demo_chat_reply(string $subject, string $message): string {
    $topic = trim($subject) !== '' ? $subject : 'your topic';
    return 'Demo mode: Hungter is pacing AI usage right now. For ' . $topic . ', break the problem into smaller steps, identify the main concept, and try one worked example based on your question: "' . substr(trim($message), 0, 140) . '".';
}

function mm_check_rate_limit(string $key, int $windowSeconds = 60, int $maxRequests = 20): array {
    $db = mm_db();
    if ($db === null) {
        return ['allowed' => true, 'retryAfterMs' => 0];
    }

    mm_ensure_runtime_tables();

    $select = $db->prepare('SELECT limiter_key, window_start, request_count FROM api_rate_limits WHERE limiter_key = :limiter_key');
    $select->execute([':limiter_key' => $key]);
    $row = $select->fetch();
    $now = time();

    if (!$row) {
        $insert = $db->prepare('INSERT INTO api_rate_limits (limiter_key, window_start, request_count) VALUES (:limiter_key, UTC_TIMESTAMP(), 1)');
        $insert->execute([':limiter_key' => $key]);
        return ['allowed' => true, 'retryAfterMs' => 0];
    }

    $windowStart = strtotime((string) ($row['window_start'] ?? 'now')) ?: $now;
    $count = (int) ($row['request_count'] ?? 0);

    if (($now - $windowStart) >= $windowSeconds) {
        $reset = $db->prepare('UPDATE api_rate_limits SET window_start = UTC_TIMESTAMP(), request_count = 1 WHERE limiter_key = :limiter_key');
        $reset->execute([':limiter_key' => $key]);
        return ['allowed' => true, 'retryAfterMs' => 0];
    }

    if ($count >= $maxRequests) {
        $retryMs = max(1000, ($windowSeconds - ($now - $windowStart)) * 1000);
        return ['allowed' => false, 'retryAfterMs' => $retryMs];
    }

    $update = $db->prepare('UPDATE api_rate_limits SET request_count = request_count + 1 WHERE limiter_key = :limiter_key');
    $update->execute([':limiter_key' => $key]);
    return ['allowed' => true, 'retryAfterMs' => 0];
}

function mm_track_visit(string $visitorId): void {
    $id = trim($visitorId);
    if ($id === '') {
        return;
    }

    $db = mm_db();
    if ($db === null) {
        return;
    }

    $sql = 'INSERT INTO visitor_sessions (visitor_id, first_seen, last_seen, ip_address)
            VALUES (:visitor_id, UTC_TIMESTAMP(), UTC_TIMESTAMP(), :ip_address)
            ON DUPLICATE KEY UPDATE last_seen = UTC_TIMESTAMP(), ip_address = VALUES(ip_address)';
    $stmt = $db->prepare($sql);
    $stmt->execute([
        ':visitor_id' => substr($id, 0, 120),
        ':ip_address' => mm_client_ip(),
    ]);
}

function mm_record_chat(array $payload, string $reply, string $engine, string $model): void {
    $db = mm_db();
    if ($db === null) {
        return;
    }

    mm_ensure_runtime_tables();

    $stmt = $db->prepare('INSERT INTO chats (visitor_id, subject, user_level, learning_style, engine, model, message, reply, created_at)
                          VALUES (:visitor_id, :subject, :user_level, :learning_style, :engine, :model, :message, :reply, UTC_TIMESTAMP())');
    $stmt->execute([
        ':visitor_id' => substr((string) ($payload['visitorId'] ?? ''), 0, 120),
        ':subject' => substr((string) ($payload['subject'] ?? 'General'), 0, 120),
        ':user_level' => substr((string) ($payload['userLevel'] ?? 'Newbie'), 0, 60),
        ':learning_style' => substr((string) ($payload['learningStyle'] ?? ''), 0, 60),
        ':engine' => substr($engine, 0, 120),
        ':model' => substr($model, 0, 120),
        ':message' => substr((string) ($payload['message'] ?? ''), 0, 24000),
        ':reply' => substr($reply, 0, 32000),
    ]);
}

function mm_find_user_by_email(string $email): ?array {
    $db = mm_db();
    if ($db === null) {
        return null;
    }

    $stmt = $db->prepare('SELECT * FROM users WHERE email = :email LIMIT 1');
    $stmt->execute([':email' => strtolower(trim($email))]);
    $row = $stmt->fetch();
    return is_array($row) ? $row : null;
}

function mm_find_user_by_id(int $id): ?array {
    $db = mm_db();
    if ($db === null) {
        return null;
    }

    $stmt = $db->prepare('SELECT * FROM users WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();
    return is_array($row) ? $row : null;
}

function mm_create_user(string $name, string $email, string $password, string $learningStyle = 'Visual'): array {
    $db = mm_db();
    if ($db === null) {
        throw new RuntimeException('Database not configured.');
    }

    $stmt = $db->prepare('INSERT INTO users (visitor_id, name, email, password_hash, email_verified, learning_style, level, xp, plan_status, created_at, updated_at)
                          VALUES (:visitor_id, :name, :email, :password_hash, 0, :learning_style, :level, 0, :plan_status, UTC_TIMESTAMP(), UTC_TIMESTAMP())');
    $stmt->execute([
        ':visitor_id' => mm_generate_visitor_id(),
        ':name' => substr($name, 0, 160),
        ':email' => substr(strtolower(trim($email)), 0, 190),
        ':password_hash' => mm_hash_password($password),
        ':learning_style' => substr($learningStyle, 0, 60),
        ':level' => 'Newbie',
        ':plan_status' => 'inactive',
    ]);

    $user = mm_find_user_by_id((int) $db->lastInsertId());
    if ($user === null) {
        throw new RuntimeException('User was created but could not be reloaded.');
    }
    return $user;
}

function mm_public_user(array $user): array {
    return [
        'visitorId' => (string) ($user['visitor_id'] ?? ''),
        'name' => (string) ($user['name'] ?? ''),
        'email' => (string) ($user['email'] ?? ''),
        'learningStyle' => (string) ($user['learning_style'] ?? 'Visual'),
        'level' => (string) ($user['level'] ?? 'Newbie'),
        'xp' => (int) ($user['xp'] ?? 0),
        'planName' => (string) ($user['plan_name'] ?? ''),
        'planPrice' => (float) ($user['plan_price'] ?? 0),
        'planStatus' => (string) ($user['plan_status'] ?? 'inactive'),
        'planStarted' => (string) ($user['plan_started'] ?? ''),
        'emailVerified' => (bool) ($user['email_verified'] ?? false),
    ];
}

function mm_generate_numeric_code(int $length = 6): string {
    $max = (10 ** $length) - 1;
    $value = random_int(0, $max);
    return str_pad((string) $value, $length, '0', STR_PAD_LEFT);
}

function mm_store_auth_challenge(int $userId, string $type, string $code, int $ttlMinutes = 20): void {
    $db = mm_db();
    if ($db === null) {
        throw new RuntimeException('Database unavailable');
    }
    mm_ensure_runtime_tables();
    $hash = password_hash($code, PASSWORD_DEFAULT);
    $db->prepare('UPDATE auth_challenges SET consumed_at = UTC_TIMESTAMP() WHERE user_id = :user_id AND challenge_type = :challenge_type AND consumed_at IS NULL')
       ->execute([':user_id' => $userId, ':challenge_type' => $type]);
    $stmt = $db->prepare('INSERT INTO auth_challenges (user_id, challenge_type, code_hash, expires_at, created_at)
                          VALUES (:user_id, :challenge_type, :code_hash, DATE_ADD(UTC_TIMESTAMP(), INTERVAL :ttl MINUTE), UTC_TIMESTAMP())');
    $stmt->bindValue(':user_id', $userId, PDO::PARAM_INT);
    $stmt->bindValue(':challenge_type', $type, PDO::PARAM_STR);
    $stmt->bindValue(':code_hash', $hash, PDO::PARAM_STR);
    $stmt->bindValue(':ttl', max(1, $ttlMinutes), PDO::PARAM_INT);
    $stmt->execute();
}

function mm_consume_auth_challenge(int $userId, string $type, string $code): bool {
    $db = mm_db();
    if ($db === null) {
        return false;
    }
    mm_ensure_runtime_tables();
    $stmt = $db->prepare('SELECT id, code_hash FROM auth_challenges
                          WHERE user_id = :user_id
                            AND challenge_type = :challenge_type
                            AND consumed_at IS NULL
                            AND expires_at >= UTC_TIMESTAMP()
                          ORDER BY id DESC LIMIT 1');
    $stmt->execute([':user_id' => $userId, ':challenge_type' => $type]);
    $row = $stmt->fetch();
    if (!is_array($row)) {
        return false;
    }
    if (!password_verify($code, (string) ($row['code_hash'] ?? ''))) {
        return false;
    }
    $db->prepare('UPDATE auth_challenges SET consumed_at = UTC_TIMESTAMP() WHERE id = :id')->execute([':id' => (int) $row['id']]);
    return true;
}

function mm_mark_email_verified(int $userId): bool {
    $db = mm_db();
    if ($db === null) {
        return false;
    }
    $stmt = $db->prepare('UPDATE users SET email_verified = 1, updated_at = UTC_TIMESTAMP() WHERE id = :id');
    return $stmt->execute([':id' => $userId]);
}

function mm_update_password(int $userId, string $newPassword): bool {
    $db = mm_db();
    if ($db === null) {
        return false;
    }
    $hash = password_hash($newPassword, PASSWORD_DEFAULT);
    $stmt = $db->prepare('UPDATE users SET password_hash = :password_hash, updated_at = UTC_TIMESTAMP() WHERE id = :id');
    return $stmt->execute([':password_hash' => $hash, ':id' => $userId]);
}

function mm_generate_visitor_id(): string {
    return 'user-' . time() . '-' . bin2hex(random_bytes(4));
}

function mm_hash_password(string $password): string {
    return password_hash($password, PASSWORD_DEFAULT);
}

function mm_verify_password(string $password, string $hash): bool {
    return $hash !== '' && password_verify($password, $hash);
}

function mm_create_session(int $userId, int $ttlDays = 30): string {
    $db = mm_db();
    if ($db === null) {
        throw new RuntimeException('Database not configured.');
    }

    mm_ensure_runtime_tables();

    $token = bin2hex(random_bytes(32));
    $stmt = $db->prepare('INSERT INTO auth_sessions (token, user_id, created_at, last_seen, expires_at)
                          VALUES (:token, :user_id, UTC_TIMESTAMP(), UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL :ttl DAY))');
    $stmt->bindValue(':token', $token);
    $stmt->bindValue(':user_id', $userId, PDO::PARAM_INT);
    $stmt->bindValue(':ttl', $ttlDays, PDO::PARAM_INT);
    $stmt->execute();
    return $token;
}

function mm_read_bearer_token(): string {
    $header = trim((string) ($_SERVER['HTTP_AUTHORIZATION'] ?? ''));
    if ($header === '' && function_exists('getallheaders')) {
        $headers = getallheaders();
        $header = trim((string) ($headers['Authorization'] ?? $headers['authorization'] ?? ''));
    }

    if (str_starts_with($header, 'Bearer ')) {
        return trim(substr($header, 7));
    }

    return '';
}

function mm_current_user(): ?array {
    $token = mm_read_bearer_token();
    if ($token === '') {
        return null;
    }

    $db = mm_db();
    if ($db === null) {
        return null;
    }

    mm_ensure_runtime_tables();

    $stmt = $db->prepare('SELECT u.*
                          FROM auth_sessions s
                          INNER JOIN users u ON u.id = s.user_id
                          WHERE s.token = :token AND s.expires_at > UTC_TIMESTAMP()
                          LIMIT 1');
    $stmt->execute([':token' => $token]);
    $user = $stmt->fetch();
    if (!is_array($user)) {
        return null;
    }

    $touch = $db->prepare('UPDATE auth_sessions SET last_seen = UTC_TIMESTAMP() WHERE token = :token');
    $touch->execute([':token' => $token]);
    return $user;
}

function mm_require_auth_user(): array {
    $user = mm_current_user();
    if ($user === null) {
        mm_json_response(401, ['error' => 'Not authenticated.']);
        exit;
    }
    return $user;
}

function mm_get_admin_summary(): array {
    $db = mm_db();
    if ($db === null) {
        return [
            'totalVisitors' => 0,
            'activeNow' => 0,
            'dailyActiveUsers' => 0,
            'monthlyActiveUsers' => 0,
            'totalChats' => 0,
            'chatsToday' => 0,
            'topSubjects' => [],
            'purchases' => [
                'count' => 0,
                'status' => 'No payment provider connected yet',
                'succeeded' => 0,
                'processing' => 0,
                'failed' => 0,
                'expired' => 0,
            ],
        ];
    }

    $totals = [
        'totalVisitors' => (int) $db->query('SELECT COUNT(*) FROM visitor_sessions')->fetchColumn(),
        'activeNow' => (int) $db->query('SELECT COUNT(*) FROM visitor_sessions WHERE last_seen >= (UTC_TIMESTAMP() - INTERVAL 5 MINUTE)')->fetchColumn(),
        'dailyActiveUsers' => (int) $db->query('SELECT COUNT(*) FROM visitor_sessions WHERE DATE(last_seen) = UTC_DATE()')->fetchColumn(),
        'monthlyActiveUsers' => (int) $db->query('SELECT COUNT(*) FROM visitor_sessions WHERE YEAR(last_seen) = YEAR(UTC_DATE()) AND MONTH(last_seen) = MONTH(UTC_DATE())')->fetchColumn(),
        'totalChats' => (int) $db->query('SELECT COUNT(*) FROM chats')->fetchColumn(),
        'chatsToday' => (int) $db->query('SELECT COUNT(*) FROM chats WHERE DATE(created_at) = UTC_DATE()')->fetchColumn(),
    ];

    $subjectStmt = $db->query('SELECT subject, COUNT(*) AS count FROM chats GROUP BY subject ORDER BY count DESC LIMIT 8');
    $subjects = [];
    while ($row = $subjectStmt->fetch()) {
        $subjects[] = [
            'subject' => (string) ($row['subject'] ?? 'General'),
            'count' => (int) ($row['count'] ?? 0),
        ];
    }

    return [
        ...$totals,
        'topSubjects' => $subjects,
        'purchases' => [
            'count' => 0,
            'status' => 'No payment provider connected yet',
            'succeeded' => 0,
            'processing' => 0,
            'failed' => 0,
            'expired' => 0,
        ],
    ];
}

function mm_build_system_prompt(string $subject, string $userLevel, string $extra = ''): string {
    $subjectValue = trim($subject) !== '' ? trim($subject) : 'General';
    $levelValue = trim($userLevel) !== '' ? trim($userLevel) : 'Newbie';

    return 'You are Hungter, an AI tutor. You ONLY help with educational topics and you decline off-topic requests by redirecting to learning. '
        . 'Subject focus: ' . $subjectValue . '. '
        . 'Learner level: ' . $levelValue . '. '
        . 'Be concise: 2-4 sentences unless the student asks for or clearly needs a worked example. '
        . trim($extra);
}

function mm_parse_json_loose(string $text): mixed {
    $parsed = json_decode($text, true);
    if ($parsed !== null || trim($text) === 'null') {
        return $parsed;
    }

    if (preg_match('/(\[.*\])/s', $text, $matches) === 1) {
        $parsed = json_decode($matches[1], true);
        if ($parsed !== null) {
            return $parsed;
        }
    }

    return null;
}

function mm_ai_text(string $systemPrompt, string $userPrompt, float $temperature = 0.5, int $maxTokens = 800): array {
    return mm_call_groq([
        ['role' => 'system', 'content' => $systemPrompt],
        ['role' => 'user', 'content' => $userPrompt],
    ], $temperature, $maxTokens);
}

function mm_call_groq(array $messages, float $temperature = 0.5, int $maxTokens = 700): array {
    $groqKey = mm_env_value('GROQ_API_KEY', '');
    $model = mm_env_value('GROQ_MODEL', 'llama-3.3-70b-versatile');

    if ($groqKey === '') {
        return ['ok' => false, 'error' => 'Missing GROQ_API_KEY on server', 'status' => 500, 'model' => $model, 'reply' => ''];
    }

    $payload = [
        'model' => $model,
        'temperature' => $temperature,
        'max_tokens' => $maxTokens,
        'messages' => $messages,
    ];

    $ch = curl_init('https://api.groq.com/openai/v1/chat/completions');
    if ($ch === false) {
        return ['ok' => false, 'error' => 'Failed to initialize request', 'status' => 500, 'model' => $model, 'reply' => ''];
    }

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $groqKey,
        ],
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_TIMEOUT => 35,
    ]);

    $responseRaw = curl_exec($ch);
    $curlError = curl_error($ch);
    $statusCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($responseRaw === false) {
        return ['ok' => false, 'error' => 'Groq request failed: ' . $curlError, 'status' => 500, 'model' => $model, 'reply' => ''];
    }

    $responseData = json_decode($responseRaw, true);
    if (!is_array($responseData)) {
        return ['ok' => false, 'error' => 'Invalid Groq response', 'status' => 500, 'model' => $model, 'reply' => ''];
    }

    if ($statusCode >= 400) {
        $errorMessage = (string) ($responseData['error']['message'] ?? 'Groq API error');
        return ['ok' => false, 'error' => $errorMessage, 'status' => $statusCode, 'model' => $model, 'reply' => ''];
    }

    $reply = trim((string) ($responseData['choices'][0]['message']['content'] ?? ''));
    return ['ok' => true, 'error' => '', 'status' => 200, 'model' => $model, 'reply' => $reply];
}

// ---------- Multi-engine AI layer (parity with server.js) ----------
// Four student-facing engines, each with a native provider and a fallback
// chain so every engine can answer as long as ANY provider key is configured.

function mm_engines_config(): array {
    return [
        'reasoner' => [
            'name' => 'Reasoner', 'icon' => '🟢', 'native' => 'groq',
            'fallbacks' => ['gemini', 'openai', 'anthropic'],
            'persona' => 'You are THE REASONER, Hungter\'s deep-reasoning engine. Your specialty: rigorous step-by-step logic. Break the problem into numbered steps and explain WHY each step is true, not just what to do.',
        ],
        'solver' => [
            'name' => 'Solver', 'icon' => '🟠', 'native' => 'gemini',
            'fallbacks' => ['groq', 'openai', 'anthropic'],
            'persona' => 'You are THE SOLVER, Hungter\'s math/code/physics engine. Your specialty: precise worked solutions. Show every calculation line by line, state formulas before using them, and double-check the final answer.',
        ],
        'explorer' => [
            'name' => 'Explorer', 'icon' => '🔵', 'native' => 'openai',
            'fallbacks' => ['gemini', 'groq', 'anthropic'],
            'persona' => 'You are THE EXPLORER, Hungter\'s real-world engine. Your specialty: concrete everyday examples. Anchor every explanation in a real situation the student has actually seen or lived.',
        ],
        'storyteller' => [
            'name' => 'Storyteller', 'icon' => '🟣', 'native' => 'anthropic',
            'fallbacks' => ['gemini', 'groq', 'openai'],
            'persona' => 'You are THE STORYTELLER, Hungter\'s narrative engine. Your specialty: analogies and mini-stories that make ideas unforgettable. Teach through one vivid analogy or short story, then connect it back to the real concept.',
        ],
    ];
}

function mm_provider_api_key(string $provider): string {
    return match ($provider) {
        'groq' => mm_env_value('GROQ_API_KEY', ''),
        'gemini' => mm_env_value('GEMINI_API_KEY', mm_env_value('GOOGLE_API_KEY', '')),
        'openai' => mm_env_value('OPENAI_API_KEY', ''),
        'anthropic' => mm_env_value('ANTHROPIC_API_KEY', ''),
        default => '',
    };
}

function mm_provider_model(string $provider): string {
    return match ($provider) {
        'groq' => mm_env_value('GROQ_MODEL', 'llama-3.3-70b-versatile'),
        'gemini' => mm_env_value('GEMINI_MODEL', 'gemini-2.5-flash'),
        'openai' => mm_env_value('OPENAI_MODEL', 'gpt-4o'),
        'anthropic' => mm_env_value('ANTHROPIC_MODEL', 'claude-sonnet-5'),
        default => '',
    };
}

function mm_provider_label(string $provider): string {
    return match ($provider) {
        'groq' => 'Groq Llama 3.3',
        'gemini' => 'Gemini Flash',
        'openai' => 'GPT-4o',
        'anthropic' => 'Claude Sonnet',
        default => $provider,
    };
}

function mm_provider_ready(string $provider): bool {
    return mm_provider_api_key($provider) !== '';
}

function mm_provider_supports_vision(string $provider): bool {
    return in_array($provider, ['gemini', 'openai', 'anthropic'], true);
}

function mm_engine_chain(string $engineKey, bool $needVision = false): array {
    $engines = mm_engines_config();
    if (!isset($engines[$engineKey])) {
        return [];
    }
    $engine = $engines[$engineKey];
    $chain = array_values(array_filter(array_merge([$engine['native']], $engine['fallbacks']), 'mm_provider_ready'));
    if ($needVision) {
        $vision = array_values(array_filter($chain, 'mm_provider_supports_vision'));
        $rest = array_values(array_diff($chain, $vision));
        if (count($vision) > 0) {
            $chain = array_merge($vision, $rest);
        }
    }
    return $chain;
}

/**
 * Build a ready-to-send curl request spec for one provider.
 * $images is a list of data: URLs (max 3 used).
 */
function mm_provider_request_spec(string $provider, string $systemPrompt, string $userText, array $history = [], array $images = [], int $maxTokens = 700, float $temperature = 0.7): ?array {
    $apiKey = mm_provider_api_key($provider);
    if ($apiKey === '') {
        return null;
    }
    $model = mm_provider_model($provider);
    $images = array_slice($images, 0, 3);

    if ($provider === 'groq' || $provider === 'openai') {
        $messages = [['role' => 'system', 'content' => $systemPrompt]];
        foreach ($history as $item) {
            $messages[] = ['role' => (string) ($item['role'] ?? 'user'), 'content' => (string) ($item['content'] ?? '')];
        }
        if ($provider === 'openai' && count($images) > 0) {
            $parts = [['type' => 'text', 'text' => $userText]];
            foreach ($images as $dataUrl) {
                $parts[] = ['type' => 'image_url', 'image_url' => ['url' => $dataUrl]];
            }
            $messages[] = ['role' => 'user', 'content' => $parts];
        } else {
            $messages[] = ['role' => 'user', 'content' => $userText];
        }
        $payload = ['model' => $model, 'messages' => $messages, 'max_tokens' => $maxTokens];
        if ($provider === 'groq') {
            $payload['temperature'] = $temperature;
        }
        $url = $provider === 'groq'
            ? mm_env_value('GROQ_API_URL', 'https://api.groq.com/openai/v1/chat/completions')
            : mm_env_value('OPENAI_API_URL', 'https://api.openai.com/v1/chat/completions');
        return [
            'provider' => $provider,
            'model' => $model,
            'url' => $url,
            'headers' => ['Content-Type: application/json', 'Authorization: Bearer ' . $apiKey],
            'payload' => json_encode($payload),
        ];
    }

    if ($provider === 'anthropic') {
        $messages = [];
        foreach ($history as $item) {
            $messages[] = ['role' => (string) ($item['role'] ?? 'user'), 'content' => (string) ($item['content'] ?? '')];
        }
        if (count($images) > 0) {
            $blocks = [['type' => 'text', 'text' => $userText]];
            foreach ($images as $dataUrl) {
                if (preg_match('/^data:([^;]+);base64,(.+)$/s', $dataUrl, $matches) !== 1) {
                    continue;
                }
                $blocks[] = ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $matches[1], 'data' => $matches[2]]];
            }
            $messages[] = ['role' => 'user', 'content' => $blocks];
        } else {
            $messages[] = ['role' => 'user', 'content' => $userText];
        }
        return [
            'provider' => $provider,
            'model' => $model,
            'url' => mm_env_value('ANTHROPIC_API_URL', 'https://api.anthropic.com/v1/messages'),
            'headers' => ['Content-Type: application/json', 'x-api-key: ' . $apiKey, 'anthropic-version: 2023-06-01'],
            'payload' => json_encode(['model' => $model, 'max_tokens' => $maxTokens, 'system' => $systemPrompt, 'messages' => $messages]),
        ];
    }

    if ($provider === 'gemini') {
        $contents = [];
        foreach ($history as $item) {
            $contents[] = [
                'role' => (($item['role'] ?? 'user') === 'assistant') ? 'model' : 'user',
                'parts' => [['text' => (string) ($item['content'] ?? '')]],
            ];
        }
        $parts = [['text' => $userText]];
        foreach ($images as $dataUrl) {
            if (preg_match('/^data:([^;]+);base64,(.+)$/s', $dataUrl, $matches) !== 1) {
                continue;
            }
            $parts[] = ['inline_data' => ['mime_type' => $matches[1], 'data' => $matches[2]]];
        }
        $contents[] = ['role' => 'user', 'parts' => $parts];
        $base = rtrim(mm_env_value('GEMINI_API_URL', 'https://generativelanguage.googleapis.com/v1beta'), '/');
        return [
            'provider' => $provider,
            'model' => $model,
            'url' => $base . '/models/' . $model . ':generateContent?key=' . urlencode($apiKey),
            'headers' => ['Content-Type: application/json'],
            'payload' => json_encode([
                'systemInstruction' => ['parts' => [['text' => $systemPrompt]]],
                'contents' => $contents,
                'generationConfig' => ['maxOutputTokens' => $maxTokens, 'temperature' => $temperature],
            ]),
        ];
    }

    return null;
}

function mm_parse_provider_reply(string $provider, mixed $raw, int $status, string $curlError = ''): array {
    if (!is_string($raw) || $raw === '') {
        return ['ok' => false, 'reply' => '', 'error' => 'Request failed: ' . ($curlError !== '' ? $curlError : 'empty response'), 'status' => 500];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        return ['ok' => false, 'reply' => '', 'error' => 'Invalid ' . $provider . ' response', 'status' => 500];
    }
    if ($status >= 400) {
        $message = (string) ($data['error']['message'] ?? ($provider . ' API error'));
        return ['ok' => false, 'reply' => '', 'error' => $message, 'status' => $status];
    }

    $reply = '';
    if ($provider === 'anthropic') {
        foreach ((array) ($data['content'] ?? []) as $block) {
            if (is_array($block) && ($block['type'] ?? '') === 'text') {
                $reply .= (string) ($block['text'] ?? '');
            }
        }
    } elseif ($provider === 'gemini') {
        foreach ((array) ($data['candidates'][0]['content']['parts'] ?? []) as $part) {
            if (is_array($part)) {
                $reply .= (string) ($part['text'] ?? '');
            }
        }
    } else {
        $reply = (string) ($data['choices'][0]['message']['content'] ?? '');
    }

    $reply = trim($reply);
    return ['ok' => $reply !== '', 'reply' => $reply, 'error' => $reply === '' ? 'Empty reply' : '', 'status' => 200];
}

/** Execute one or more provider request specs in parallel via curl_multi. */
function mm_execute_provider_specs(array $specs, int $timeout = 40): array {
    $multi = curl_multi_init();
    $handles = [];

    // Optional egress proxy + CA bundle (dev sandboxes); ignored when the
    // env vars are absent, which is the case on normal hosting.
    $proxy = getenv('HTTPS_PROXY') ?: getenv('https_proxy') ?: '';
    $caBundle = getenv('CURL_CA_BUNDLE') ?: getenv('SSL_CERT_FILE') ?: '';

    foreach ($specs as $key => $spec) {
        $ch = curl_init($spec['url']);
        if ($ch === false) {
            continue;
        }
        $options = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => $spec['headers'],
            CURLOPT_POSTFIELDS => $spec['payload'],
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 12,
        ];
        if ($proxy !== '') {
            $options[CURLOPT_PROXY] = $proxy;
        }
        if ($caBundle !== '' && is_file($caBundle)) {
            $options[CURLOPT_CAINFO] = $caBundle;
        }
        curl_setopt_array($ch, $options);
        curl_multi_add_handle($multi, $ch);
        $handles[$key] = $ch;
    }

    do {
        $state = curl_multi_exec($multi, $running);
        if ($running > 0) {
            curl_multi_select($multi, 1.0);
        }
    } while ($running > 0 && $state === CURLM_OK);

    // curl_error() is unreliable on multi handles — read transfer results
    // from the multi stack so real network errors surface.
    $transferErrors = [];
    while (($info = curl_multi_info_read($multi)) !== false) {
        if (($info['result'] ?? CURLE_OK) !== CURLE_OK && isset($info['handle'])) {
            $transferErrors[spl_object_id($info['handle'])] = (string) curl_strerror((int) $info['result']);
        }
    }

    $results = [];
    foreach ($handles as $key => $ch) {
        $error = curl_error($ch);
        if ($error === '' && isset($transferErrors[spl_object_id($ch)])) {
            $error = $transferErrors[spl_object_id($ch)];
        }
        $results[$key] = [
            'raw' => curl_multi_getcontent($ch),
            'status' => (int) curl_getinfo($ch, CURLINFO_HTTP_CODE),
            'error' => $error,
        ];
        curl_multi_remove_handle($multi, $ch);
        curl_close($ch);
    }
    curl_multi_close($multi);
    return $results;
}

/** Ask ONE engine, walking its provider fallback chain until something answers. */
function mm_call_engine(string $engineKey, string $subject, string $userLevel, string $userText, array $history = [], array $images = [], int $maxTokens = 700, float $temperature = 0.7): array {
    $engines = mm_engines_config();
    $engine = $engines[$engineKey] ?? null;
    if ($engine === null) {
        return ['ok' => false, 'reply' => '', 'error' => 'Unknown engine', 'engine' => $engineKey, 'icon' => '', 'provider' => '', 'providerLabel' => '', 'model' => '', 'native' => false];
    }

    $systemPrompt = mm_build_system_prompt($subject, $userLevel, $engine['persona']);
    $lastError = 'No AI provider is configured (set GROQ_API_KEY in .env)';
    foreach (mm_engine_chain($engineKey, count($images) > 0) as $provider) {
        $spec = mm_provider_request_spec($provider, $systemPrompt, $userText, $history, $images, $maxTokens, $temperature);
        if ($spec === null) {
            continue;
        }
        $responses = mm_execute_provider_specs(['single' => $spec]);
        $parsed = mm_parse_provider_reply($provider, $responses['single']['raw'] ?? '', $responses['single']['status'] ?? 0, $responses['single']['error'] ?? '');
        if ($parsed['ok']) {
            return [
                'ok' => true, 'reply' => $parsed['reply'], 'error' => '',
                'engine' => $engine['name'], 'icon' => $engine['icon'],
                'provider' => $provider, 'providerLabel' => mm_provider_label($provider),
                'model' => $spec['model'], 'native' => $provider === $engine['native'],
            ];
        }
        $lastError = $provider . ': ' . (string) ($parsed['error'] ?? 'request failed');
    }

    return ['ok' => false, 'reply' => '', 'error' => $lastError, 'engine' => $engine['name'], 'icon' => $engine['icon'], 'provider' => '', 'providerLabel' => '', 'model' => '', 'native' => false];
}

function mm_engine_display_name(array $result): string {
    $name = (string) ($result['engine'] ?? 'Engine');
    if (!empty($result['native']) || empty($result['providerLabel'])) {
        return $name;
    }
    return $name . ' (via ' . $result['providerLabel'] . ')';
}

/** Ask ALL engines in parallel (first-choice providers), falling back per engine on failure. */
function mm_call_engines_all(string $subject, string $userLevel, string $userText, array $history = [], array $images = [], int $maxTokens = 700): array {
    $engines = mm_engines_config();
    $specs = [];
    $meta = [];
    foreach ($engines as $key => $engine) {
        $chain = mm_engine_chain($key, count($images) > 0);
        if (count($chain) === 0) {
            continue;
        }
        $provider = $chain[0];
        $systemPrompt = mm_build_system_prompt($subject, $userLevel, $engine['persona']);
        $spec = mm_provider_request_spec($provider, $systemPrompt, $userText, $history, $images, $maxTokens, 0.7);
        if ($spec === null) {
            continue;
        }
        $specs[$key] = $spec;
        $meta[$key] = $provider;
    }
    if (count($specs) === 0) {
        return [];
    }

    $responses = mm_execute_provider_specs($specs);
    $results = [];
    foreach ($specs as $key => $spec) {
        $provider = $meta[$key];
        $engine = $engines[$key];
        $parsed = mm_parse_provider_reply($provider, $responses[$key]['raw'] ?? '', $responses[$key]['status'] ?? 0, $responses[$key]['error'] ?? '');
        if ($parsed['ok']) {
            $results[] = [
                'ok' => true, 'reply' => $parsed['reply'], 'error' => '',
                'engine' => $engine['name'], 'icon' => $engine['icon'],
                'provider' => $provider, 'providerLabel' => mm_provider_label($provider),
                'model' => $spec['model'], 'native' => $provider === $engine['native'],
            ];
            continue;
        }
        // First-choice provider failed — retry through this engine's full chain.
        $retry = mm_call_engine($key, $subject, $userLevel, $userText, $history, $images, $maxTokens);
        if ($retry['ok']) {
            $results[] = $retry;
        }
    }
    return $results;
}

/**
 * Run different prompts on different engines in parallel (first-choice
 * providers), retrying each failed engine through its fallback chain.
 * $assignments: engineKey => userPrompt. Returns engineKey => result array.
 */
function mm_call_engine_assignments(array $assignments, string $subject, string $userLevel, int $maxTokens = 900, float $temperature = 0.6): array {
    $engines = mm_engines_config();
    $specs = [];
    $meta = [];
    foreach ($assignments as $key => $userPrompt) {
        if (!isset($engines[$key])) {
            continue;
        }
        $chain = mm_engine_chain($key);
        if (count($chain) === 0) {
            continue;
        }
        $provider = $chain[0];
        $systemPrompt = mm_build_system_prompt($subject, $userLevel, $engines[$key]['persona']);
        $spec = mm_provider_request_spec($provider, $systemPrompt, $userPrompt, [], [], $maxTokens, $temperature);
        if ($spec === null) {
            continue;
        }
        $specs[$key] = $spec;
        $meta[$key] = $provider;
    }
    if (count($specs) === 0) {
        return [];
    }

    $responses = mm_execute_provider_specs($specs);
    $results = [];
    foreach ($specs as $key => $spec) {
        $provider = $meta[$key];
        $engine = $engines[$key];
        $parsed = mm_parse_provider_reply($provider, $responses[$key]['raw'] ?? '', $responses[$key]['status'] ?? 0, $responses[$key]['error'] ?? '');
        if ($parsed['ok']) {
            $results[$key] = [
                'ok' => true, 'reply' => $parsed['reply'], 'error' => '',
                'engine' => $engine['name'], 'icon' => $engine['icon'],
                'provider' => $provider, 'providerLabel' => mm_provider_label($provider),
                'model' => $spec['model'], 'native' => $provider === $engine['native'],
            ];
            continue;
        }
        $retry = mm_call_engine($key, $subject, $userLevel, $assignments[$key], [], [], $maxTokens, $temperature);
        if ($retry['ok']) {
            $results[$key] = $retry;
        }
    }
    return $results;
}

/** Keyword routing: pick the best engine for a message (no extra API call). */
function mm_route_engine(string $message, string $subject, string $learningStyle = ''): string {
    $haystack = strtolower($message . ' ' . $subject);
    foreach (['story', 'analogy', 'poem', 'imagine', 'narrative'] as $word) {
        if (str_contains($haystack, $word)) {
            return 'storyteller';
        }
    }
    foreach (['solve', 'calculate', 'equation', 'math', 'algebra', 'geometry', 'calculus', 'derivative', 'integral', 'physics', 'code', 'coding', 'program', 'debug', 'formula', 'simplify', 'factor'] as $word) {
        if (str_contains($haystack, $word)) {
            return 'solver';
        }
    }
    foreach (['example', 'real-world', 'real world', 'real life', 'application', 'use case'] as $word) {
        if (str_contains($haystack, $word)) {
            return 'explorer';
        }
    }
    if ($learningStyle === 'Stories') {
        return 'storyteller';
    }
    return 'reasoner';
}

function mm_engine_details(): array {
    $details = [];
    foreach (mm_engines_config() as $key => $engine) {
        $chain = mm_engine_chain($key);
        $backing = $chain[0] ?? null;
        $details[$key] = [
            'name' => $engine['name'],
            'live' => $backing !== null,
            'native' => $backing === $engine['native'],
            'provider' => $backing !== null ? mm_provider_label($backing) : null,
            'model' => $backing !== null ? mm_provider_model($backing) : null,
        ];
    }
    return $details;
}

function mm_quiz_pool(): array {
    return [
        'Math' => [
            ['question' => 'What is the value of x in 2x + 6 = 18?', 'options' => ['4', '6', '8', '12'], 'answer' => '6', 'explanation' => 'Subtract 6 from both sides then divide by 2.'],
            ['question' => 'What is the derivative of x^2?', 'options' => ['x', '2x', 'x^2', '2'], 'answer' => '2x', 'explanation' => 'Power rule: d/dx of x^n is n*x^(n-1).'],
            ['question' => 'What is 15% of 80?', 'options' => ['8', '10', '12', '16'], 'answer' => '12', 'explanation' => '0.15 x 80 = 12.'],
            ['question' => 'If a triangle has angles 50° and 60°, the third angle is:', 'options' => ['70°', '80°', '90°', '100°'], 'answer' => '70°', 'explanation' => 'Triangle angles sum to 180°.'],
        ],
        'Science' => [
            ['question' => 'Which organelle is known as the powerhouse of the cell?', 'options' => ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi apparatus'], 'answer' => 'Mitochondria', 'explanation' => 'Mitochondria produce ATP energy.'],
            ['question' => 'What is the chemical symbol for sodium?', 'options' => ['So', 'Sd', 'Na', 'S'], 'answer' => 'Na', 'explanation' => 'Na comes from the Latin word natrium.'],
            ['question' => 'What force keeps planets in orbit around the sun?', 'options' => ['Magnetism', 'Friction', 'Gravity', 'Tension'], 'answer' => 'Gravity', 'explanation' => 'Gravity pulls bodies toward each other.'],
            ['question' => 'At sea level, water boils at:', 'options' => ['90°C', '95°C', '100°C', '110°C'], 'answer' => '100°C', 'explanation' => 'Standard atmospheric pressure gives a boiling point of 100°C.'],
        ],
        'English' => [
            ['question' => 'Which is a synonym of "rapid"?', 'options' => ['Slow', 'Quick', 'Silent', 'Heavy'], 'answer' => 'Quick', 'explanation' => 'Rapid means fast or quick.'],
            ['question' => 'What is the main purpose of a thesis statement?', 'options' => ['To greet readers', 'To state the main argument', 'To add citations', 'To list page numbers'], 'answer' => 'To state the main argument', 'explanation' => 'A thesis states your central claim.'],
            ['question' => 'Choose the correctly punctuated sentence.', 'options' => ['Its raining today.', 'It\'s raining today.', 'Its\' raining today.', 'It is raining today'], 'answer' => 'It\'s raining today.', 'explanation' => 'It\'s is the contraction of it is.'],
            ['question' => 'A metaphor is:', 'options' => ['A direct comparison', 'An exaggerated statement', 'A question format', 'A sound device'], 'answer' => 'A direct comparison', 'explanation' => 'A metaphor compares without using like or as.'],
        ],
    ];
}

function mm_normalize_subject_for_quiz(string $subject): string {
    $value = strtolower(trim($subject));
    if (str_contains($value, 'math')) return 'Math';
    if (str_contains($value, 'science') || str_contains($value, 'biology') || str_contains($value, 'chem') || str_contains($value, 'physics')) return 'Science';
    if (str_contains($value, 'english')) return 'English';
    return 'Science';
}

function mm_generate_quiz(string $subject, int $count, array $askedQuestions = []): array {
    $pool = mm_quiz_pool();
    $bucket = $pool[mm_normalize_subject_for_quiz($subject)] ?? $pool['Science'];
    $asked = array_map(static fn($item) => strtolower(trim((string) $item)), $askedQuestions);
    $fresh = array_values(array_filter($bucket, static fn($q) => !in_array(strtolower(trim((string) ($q['question'] ?? ''))), $asked, true)));

    if (count($fresh) < $count) {
        $fresh = array_merge($fresh, $bucket);
    }

    shuffle($fresh);
    $selected = array_slice($fresh, 0, max(1, min(50, $count)));
    return array_values($selected);
}

function mm_generate_quiz_question(string $subject): array {
    $items = mm_generate_quiz($subject, 1, []);
    if (count($items) === 0) {
        return [
            'question' => 'What is 2 + 2?',
            'options' => ['3', '4', '5', '6'],
            'answer' => '4',
            'explanation' => 'Basic arithmetic.',
        ];
    }
    return $items[0];
}

function mm_generate_book_flashcards(string $subject, string $chapter, string $bookContext): array {
    $topic = trim($chapter) !== '' ? trim($chapter) : trim($subject);
    $bookNote = $bookContext !== '' ? ' studied from a book like "' . $bookContext . '"' : '';
    $jsonRule = ' Return ONLY valid JSON like [{"front":"...","back":"..."}]. No other text.';
    $assignments = [
        'reasoner' => 'Write 3 original flashcards focused on core definitions/facts for the topic "' . $topic . '"' . $bookNote . '.' . $jsonRule,
        'solver' => 'Write 3 original flashcards focused on formulas and worked steps for the topic "' . $topic . '"' . $bookNote . '.' . $jsonRule,
        'explorer' => 'Write 3 original flashcards focused on applied real-world examples for the topic "' . $topic . '"' . $bookNote . '.' . $jsonRule,
        'storyteller' => 'Write 3 original flashcards focused on memorable analogies for the topic "' . $topic . '"' . $bookNote . '.' . $jsonRule,
    ];
    $results = mm_call_engine_assignments($assignments, $subject, 'Learner', 800, 0.4);

    $cards = [];
    foreach ($results as $result) {
        $parsed = mm_parse_json_loose((string) ($result['reply'] ?? ''));
        if (!is_array($parsed)) {
            continue;
        }
        foreach ($parsed as $item) {
            if (!is_array($item)) {
                continue;
            }
            $front = trim((string) ($item['front'] ?? ''));
            $back = trim((string) ($item['back'] ?? ''));
            if ($front === '' || $back === '') {
                continue;
            }
            $cards[] = ['front' => $front, 'back' => $back];
        }
    }

    return count($cards) ? array_slice($cards, 0, 12) : [['front' => 'What is the key idea in ' . $topic . '?', 'back' => 'Review this topic with the AI tutor for a full explanation.']];
}

function mm_generate_chapter_notes(string $subject, string $chapter, string $bookContext, string $userLevel): array {
    $topic = trim($chapter) !== '' ? trim($chapter) : trim($subject);
    $userPrompt = 'Write original revision notes for the topic "' . $topic . '"'
        . ($bookContext !== '' ? ' from a book like "' . $bookContext . '"' : '')
        . '. Use these exact headings: OVERVIEW, KEY POINTS, FORMULAS & DEFINITIONS, COMMON MISTAKES, EXAM TIPS.';

    // Strongest available engine first, walking each one's fallback chain.
    foreach (['storyteller', 'explorer', 'solver', 'reasoner'] as $engineKey) {
        if (count(mm_engine_chain($engineKey)) === 0) {
            continue;
        }
        $result = mm_call_engine($engineKey, $subject, $userLevel, $userPrompt, [], [], 1300, 0.45);
        if ($result['ok'] && trim((string) $result['reply']) !== '') {
            return [
                'notes' => trim((string) $result['reply']),
                'engine' => mm_engine_display_name($result),
            ];
        }
    }

    return [
        'notes' => "OVERVIEW\n" . $topic . " is a core part of " . $subject . ".\n\nKEY POINTS\n- Review this topic with the AI tutor.\n- Practice quiz questions on this chapter.\n\nFORMULAS & DEFINITIONS\n- Add key terms here once AI is connected.\n\nCOMMON MISTAKES\n- Rushing without checking definitions.\n\nEXAM TIPS\n- Show your working and define key terms clearly.",
        'engine' => 'Demo',
    ];
}

function mm_generate_guess_paper(string $section, string $subject, string $paperFormat, string $chapter): array {
    $topic = trim($chapter) !== '' ? trim($chapter) : trim($subject);
    $base = 'You are helping create an ORIGINAL practice exam paper for a ' . trim($section) . ' ' . trim($subject) . ' student focused on "' . $topic
        . '". Format: ' . ($paperFormat !== '' ? $paperFormat : '60 minutes')
        . '. Write entirely new original questions — do not copy any official exam paper. Include a separate "Answer Key" section after your questions. ';
    $assignments = [
        'reasoner' => $base . 'Write 2 conceptual reasoning questions with an answer key.',
        'solver' => $base . 'Write 2 calculation/problem-solving questions with a fully worked answer key.',
        'explorer' => $base . 'Write 2 applied/real-world scenario questions with an answer key.',
        'storyteller' => $base . 'Write 2 extended-response/essay-style questions with an answer key.',
    ];
    $results = mm_call_engine_assignments($assignments, $subject, 'Learner', 1200, 0.55);

    if (count($results) === 0) {
        return [
            'paper' => trim($section . ' ' . $subject) . " — Practice Paper\n\n1. Define the key idea of " . $topic . ".\n2. Give one worked example.\n3. Explain one common mistake students make.\n\nAnswer Key\n1-3: Open-ended demo paper.",
            'generatedBy' => ['Demo'],
        ];
    }

    $sections = [];
    $generatedBy = [];
    foreach ($results as $result) {
        $sections[] = trim((string) $result['reply']);
        $generatedBy[] = (string) $result['engine'];
    }
    $paper = implode("\n\n", $sections) . "\n\n---\nGenerated by AI (" . implode(', ', $generatedBy) . ") — original practice content, not an official exam paper.";
    return ['paper' => $paper, 'generatedBy' => $generatedBy];
}

/**
 * Pull the first JSON array out of an LLM reply (tolerates markdown fences
 * and prose around it). Returns [] when nothing parseable is found.
 */
function mm_extract_json_array(string $raw): array {
    $text = trim($raw);
    $text = preg_replace('/^```(?:json)?\s*|\s*```$/m', '', $text);
    $start = strpos($text, '[');
    if ($start === false) {
        return [];
    }
    $depth = 0;
    $inString = false;
    $escaped = false;
    for ($i = $start, $len = strlen($text); $i < $len; $i++) {
        $char = $text[$i];
        if ($inString) {
            if ($escaped) { $escaped = false; }
            elseif ($char === '\\') { $escaped = true; }
            elseif ($char === '"') { $inString = false; }
            continue;
        }
        if ($char === '"') { $inString = true; }
        elseif ($char === '[') { $depth++; }
        elseif ($char === ']') {
            $depth--;
            if ($depth === 0) {
                $candidate = substr($text, $start, $i - $start + 1);
                $decoded = json_decode($candidate, true);
                return is_array($decoded) ? $decoded : [];
            }
        }
    }
    return [];
}

/**
 * Structured, solvable guess paper. Each of the four engines writes its own
 * question types; every question carries the engine that wrote it plus a
 * topic tag so results can show weak areas.
 */
function mm_generate_guess_paper_exam(string $section, string $subject, string $chapter, string $bookTitle, int $perEngine = 2): array {
    $topic = $chapter !== '' ? $chapter : $subject;
    $source = $bookTitle !== ''
        ? 'Base the questions on the kind of material covered by the book "' . $bookTitle . '"' . ($chapter !== '' ? ', chapter/topic "' . $chapter . '"' : '') . '.'
        : 'Focus on the topic "' . $topic . '".';

    $jsonRules = 'Reply with ONLY a JSON array, no prose, no markdown. Each item: '
        . '{"type":"mcq","question":"...","options":["A","B","C","D"],"correct":0,"explanation":"why","topic":"short topic tag","marks":2} '
        . 'or {"type":"short","question":"...","answer":"model answer in 1-3 sentences","explanation":"marking notes","topic":"short topic tag","marks":4}. '
        . 'Questions must be ORIGINAL (never copied from any official paper), at ' . $section . ' difficulty, on ' . $subject . '. ' . $source;

    $n = max(1, min(3, $perEngine));
    $assignments = [
        'reasoner' => 'Write ' . $n . ' conceptual multiple-choice questions that test understanding, not memory. ' . $jsonRules,
        'solver' => 'Write ' . $n . ' calculation/problem-solving questions: 1 as "mcq" with numeric options and the rest as "short" with a fully worked model answer. ' . $jsonRules,
        'explorer' => 'Write ' . $n . ' applied real-world scenario multiple-choice questions. ' . $jsonRules,
        'storyteller' => 'Write ' . $n . ' "short" extended-response questions that ask the student to explain or argue, with a clear model answer. ' . $jsonRules,
    ];

    $results = mm_call_engine_assignments($assignments, $subject, 'Learner', 1400, 0.5);

    $questions = [];
    $generatedBy = [];
    foreach ($results as $result) {
        $items = mm_extract_json_array((string) ($result['reply'] ?? ''));
        $engineName = (string) ($result['engine'] ?? 'Engine');
        $engineIcon = (string) ($result['icon'] ?? '🤖');
        $providerLabel = (string) ($result['providerLabel'] ?? '');
        $added = false;
        foreach ($items as $item) {
            if (!is_array($item)) { continue; }
            $type = strtolower(trim((string) ($item['type'] ?? '')));
            $questionText = trim((string) ($item['question'] ?? ''));
            if ($questionText === '' || !in_array($type, ['mcq', 'short'], true)) { continue; }
            $entry = [
                'id' => 'q' . (count($questions) + 1),
                'type' => $type,
                'question' => $questionText,
                'explanation' => trim((string) ($item['explanation'] ?? '')),
                'topic' => trim((string) ($item['topic'] ?? $topic)) ?: $topic,
                'marks' => max(1, min(10, (int) ($item['marks'] ?? ($type === 'mcq' ? 2 : 4)))),
                'engine' => $engineName,
                'engineIcon' => $engineIcon,
                'provider' => $providerLabel,
            ];
            if ($type === 'mcq') {
                $options = array_values(array_filter(array_map(static fn($o) => trim((string) $o), (array) ($item['options'] ?? [])), static fn($o) => $o !== ''));
                $correct = (int) ($item['correct'] ?? -1);
                if (count($options) < 2 || $correct < 0 || $correct >= count($options)) { continue; }
                $entry['options'] = array_slice($options, 0, 5);
                $entry['correct'] = $correct;
            } else {
                $answer = trim((string) ($item['answer'] ?? ''));
                if ($answer === '') { continue; }
                $entry['answer'] = $answer;
            }
            $questions[] = $entry;
            $added = true;
        }
        if ($added) {
            $generatedBy[] = $engineName . ($providerLabel !== '' ? ' (' . $providerLabel . ')' : '');
        }
    }

    if (count($questions) === 0) {
        // Guaranteed offline paper so the feature never dead-ends.
        $questions = [
            ['id' => 'q1', 'type' => 'short', 'question' => 'Define the core idea of ' . $topic . ' in your own words and give one everyday example.', 'answer' => 'A clear definition of ' . $topic . ' plus one concrete real-life example.', 'explanation' => 'Full marks for a correct definition and a relevant example.', 'topic' => $topic, 'marks' => 4, 'engine' => 'Hungter', 'engineIcon' => '🧠', 'provider' => ''],
            ['id' => 'q2', 'type' => 'short', 'question' => 'Describe one common mistake students make with ' . $topic . ' and how to avoid it.', 'answer' => 'One realistic misconception and a practical way to avoid it.', 'explanation' => 'Any sensible misconception accepted.', 'topic' => $topic, 'marks' => 4, 'engine' => 'Hungter', 'engineIcon' => '🧠', 'provider' => ''],
        ];
        $generatedBy = ['Hungter offline generator'];
    }

    $totalMarks = 0;
    foreach ($questions as $q) { $totalMarks += (int) $q['marks']; }

    return [
        'paper' => [
            'title' => trim($section . ' ' . $subject) . ' — AI Guess Paper',
            'section' => $section,
            'subject' => $subject,
            'chapter' => $chapter,
            'book' => $bookTitle,
            'totalMarks' => $totalMarks,
            'questionCount' => count($questions),
        ],
        'questions' => $questions,
        'generatedBy' => array_values(array_unique($generatedBy)),
    ];
}

/**
 * Grade written answers. One AI call grades the whole batch; a keyword
 * overlap heuristic covers the offline case so grading always completes.
 */
function mm_grade_short_answers(array $items, string $subject): array {
    $grades = [];

    $prompt = "Grade these student answers. Reply with ONLY a JSON array, one item per answer, same order: {\"score\":0.0-1.0,\"feedback\":\"one short sentence\"}.\n\n";
    foreach ($items as $i => $item) {
        $prompt .= 'Q' . ($i + 1) . ': ' . (string) ($item['question'] ?? '') . "\n"
            . 'Model answer: ' . (string) ($item['modelAnswer'] ?? '') . "\n"
            . 'Student answer: ' . trim((string) ($item['studentAnswer'] ?? '')) . "\n\n";
    }

    $result = mm_call_engine('reasoner', $subject, 'Learner', $prompt, [], [], 800, 0.2);
    $parsed = $result['ok'] ? mm_extract_json_array((string) $result['reply']) : [];

    foreach ($items as $i => $item) {
        $student = trim((string) ($item['studentAnswer'] ?? ''));
        $aiGrade = $parsed[$i] ?? null;
        if (is_array($aiGrade) && isset($aiGrade['score'])) {
            $grades[] = [
                'score' => max(0.0, min(1.0, (float) $aiGrade['score'])),
                'feedback' => trim((string) ($aiGrade['feedback'] ?? '')) ?: 'Graded.',
                'gradedBy' => 'ai',
            ];
            continue;
        }
        // Heuristic fallback: keyword overlap with the model answer.
        $modelWords = array_filter(preg_split('/\W+/u', mb_strtolower((string) ($item['modelAnswer'] ?? ''))), static fn($w) => mb_strlen($w) > 3);
        $studentWords = array_flip(array_filter(preg_split('/\W+/u', mb_strtolower($student)), static fn($w) => mb_strlen($w) > 3));
        $hits = 0;
        foreach ($modelWords as $word) {
            if (isset($studentWords[$word])) { $hits++; }
        }
        $ratio = count($modelWords) > 0 ? $hits / count($modelWords) : 0;
        $score = $student === '' ? 0.0 : max(0.15, min(0.9, $ratio * 1.4));
        $grades[] = [
            'score' => round($score, 2),
            'feedback' => $student === '' ? 'No answer given.' : 'Auto-marked by keyword match — compare your answer with the model answer.',
            'gradedBy' => 'heuristic',
        ];
    }

    return $grades;
}

function mm_generate_explain_check(string $concept, string $studentExplanation): array {
    $result = mm_call_engine('reasoner', 'General', 'Learner', 'Concept: ' . $concept . "\nStudent explanation: " . $studentExplanation . "\n\nIn one short sentence, say whether they show understanding and give a brief correction or encouragement.", [], [], 120, 0.3);

    if ($result['ok'] && trim((string) ($result['reply'] ?? '')) !== '') {
        return ['understood' => true, 'feedback' => (string) $result['reply']];
    }

    return ['understood' => true, 'feedback' => 'Good effort. Tighten the definition and include one concrete example.'];
}

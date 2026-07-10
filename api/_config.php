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
    ];
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
    $prompt = 'Create 6 original flashcards for the topic "' . $topic . '"'
        . ($bookContext !== '' ? ' studied from a book like "' . $bookContext . '"' : '')
        . '. Return ONLY valid JSON like [{"front":"...","back":"..."}].';
    $result = mm_ai_text('You generate concise educational flashcards. Only return valid JSON.', $prompt, 0.4, 900);
    if (!($result['ok'] ?? false)) {
        return [['front' => 'What is the key idea in ' . $topic . '?', 'back' => 'Review this topic with the AI tutor for a full explanation.']];
    }

    $parsed = mm_parse_json_loose((string) ($result['reply'] ?? ''));
    if (!is_array($parsed)) {
        return [['front' => 'What is the key idea in ' . $topic . '?', 'back' => 'Review this topic with the AI tutor for a full explanation.']];
    }

    $cards = [];
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

    return count($cards) ? array_slice($cards, 0, 12) : [['front' => 'What is the key idea in ' . $topic . '?', 'back' => 'Review this topic with the AI tutor for a full explanation.']];
}

function mm_generate_chapter_notes(string $subject, string $chapter, string $bookContext, string $userLevel): array {
    $topic = trim($chapter) !== '' ? trim($chapter) : trim($subject);
    $systemPrompt = mm_build_system_prompt($subject, $userLevel, 'Write complete original revision notes in a structured format.');
    $userPrompt = 'Write original revision notes for the topic "' . $topic . '"'
        . ($bookContext !== '' ? ' from a book like "' . $bookContext . '"' : '')
        . '. Use these exact headings: OVERVIEW, KEY POINTS, FORMULAS & DEFINITIONS, COMMON MISTAKES, EXAM TIPS.';
    $result = mm_ai_text($systemPrompt, $userPrompt, 0.45, 1300);
    if (!($result['ok'] ?? false) || trim((string) ($result['reply'] ?? '')) === '') {
        return [
            'notes' => "OVERVIEW\n" . $topic . " is a core part of " . $subject . ".\n\nKEY POINTS\n- Review this topic with the AI tutor.\n- Practice quiz questions on this chapter.\n\nFORMULAS & DEFINITIONS\n- Add key terms here once AI is connected.\n\nCOMMON MISTAKES\n- Rushing without checking definitions.\n\nEXAM TIPS\n- Show your working and define key terms clearly.",
            'engine' => 'Demo',
        ];
    }

    return [
        'notes' => trim((string) $result['reply']),
        'engine' => 'Reasoner',
    ];
}

function mm_generate_guess_paper(string $section, string $subject, string $paperFormat, string $chapter): array {
    $topic = trim($chapter) !== '' ? trim($chapter) : trim($subject);
    $prompt = 'Create an ORIGINAL practice paper for ' . trim($section) . ' ' . trim($subject)
        . ' focused on "' . $topic . '". Format: ' . ($paperFormat !== '' ? $paperFormat : '60 minutes')
        . '. Include 6 questions and a separate Answer Key. Do not copy any official exam paper.';
    $result = mm_ai_text('You generate original practice exam papers for students.', $prompt, 0.55, 1500);
    if (!($result['ok'] ?? false) || trim((string) ($result['reply'] ?? '')) === '') {
        return [
            'paper' => trim($section . ' ' . $subject) . " — Practice Paper\n\n1. Define the key idea of " . $topic . ".\n2. Give one worked example.\n3. Explain one common mistake students make.\n\nAnswer Key\n1-3: Open-ended demo paper.",
            'generatedBy' => ['Demo'],
        ];
    }

    return [
        'paper' => trim((string) $result['reply']),
        'generatedBy' => ['Reasoner'],
    ];
}

function mm_generate_explain_check(string $concept, string $studentExplanation): array {
    $result = mm_call_groq([
        ['role' => 'system', 'content' => 'You are a supportive tutor grading a student explanation briefly.'],
        ['role' => 'user', 'content' => 'Concept: ' . $concept . "\nStudent explanation: " . $studentExplanation . "\n\nIn one short sentence, say whether they show understanding and give a brief correction or encouragement."],
    ], 0.3, 120);

    if ($result['ok'] && trim((string) ($result['reply'] ?? '')) !== '') {
        return ['understood' => true, 'feedback' => (string) $result['reply']];
    }

    return ['understood' => true, 'feedback' => 'Good effort. Tighten the definition and include one concrete example.'];
}

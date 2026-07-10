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

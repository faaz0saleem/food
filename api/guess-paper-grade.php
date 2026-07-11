<?php
require_once __DIR__ . '/_config.php';

mm_handle_options();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$body = mm_read_json_body();
mm_require_rate_limit(mm_rate_limit_key($body), 10, 60);

$subject = trim((string) ($body['subject'] ?? 'General'));
$items = $body['items'] ?? [];

if (!is_array($items) || count($items) === 0) {
    mm_json_response(400, ['error' => 'items to grade are required.']);
    exit;
}
if (count($items) > 12) {
    $items = array_slice($items, 0, 12);
}

$clean = [];
foreach ($items as $item) {
    $clean[] = [
        'question' => substr(trim((string) ($item['question'] ?? '')), 0, 600),
        'modelAnswer' => substr(trim((string) ($item['modelAnswer'] ?? '')), 0, 800),
        'studentAnswer' => substr(trim((string) ($item['studentAnswer'] ?? '')), 0, 1200),
    ];
}

// Grading is part of the paper the student already paid credits for —
// it is free, and the heuristic fallback inside guarantees a result.
$grades = mm_grade_short_answers($clean, $subject);

mm_json_response(200, ['status' => 'ok', 'grades' => $grades]);

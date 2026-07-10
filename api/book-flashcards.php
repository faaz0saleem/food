<?php
require_once __DIR__ . '/_config.php';

mm_handle_options();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$body = mm_read_json_body();
mm_require_rate_limit(mm_rate_limit_key($body), 10, 60);

$subject = trim((string) ($body['subject'] ?? ''));
$chapter = trim((string) ($body['chapter'] ?? ''));
$bookContext = trim((string) ($body['bookContext'] ?? ''));
if ($subject === '') {
    mm_json_response(400, ['error' => 'subject is required.']);
    exit;
}

mm_json_response(200, ['status' => 'ok', 'cards' => mm_generate_book_flashcards($subject, $chapter, $bookContext)]);

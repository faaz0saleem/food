<?php
require_once __DIR__ . '/_config.php';

mm_handle_options();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$body = mm_read_json_body();
$subject = trim((string) ($body['subject'] ?? 'Math'));

$question = mm_generate_quiz_question($subject);
mm_json_response(200, $question);

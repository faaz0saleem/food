<?php
require_once __DIR__ . '/_config.php';

mm_handle_options();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$body = mm_read_json_body();
mm_require_rate_limit(mm_rate_limit_key($body), 20, 60);

$concept = trim((string) ($body['concept'] ?? ''));
$studentExplanation = trim((string) ($body['studentExplanation'] ?? ''));
if ($concept === '' || $studentExplanation === '') {
    mm_json_response(400, ['error' => 'concept and studentExplanation are required.']);
    exit;
}

mm_json_response(200, mm_generate_explain_check($concept, $studentExplanation));

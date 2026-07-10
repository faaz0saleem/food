<?php
require_once __DIR__ . '/_config.php';

mm_handle_options();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$expected = mm_env_value('ADMIN_KEY', '');
$provided = trim((string) ($_SERVER['HTTP_X_ADMIN_KEY'] ?? ($_GET['key'] ?? '')));

if ($expected === '' || $provided !== $expected) {
    mm_json_response(401, ['error' => 'Unauthorized']);
    exit;
}

mm_json_response(200, mm_get_admin_summary());

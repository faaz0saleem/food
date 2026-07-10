<?php
require_once dirname(__DIR__) . '/_config.php';

mm_handle_options();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$token = mm_read_bearer_token();
if ($token !== '') {
    $db = mm_db();
    if ($db !== null) {
        mm_ensure_runtime_tables();
        $stmt = $db->prepare('DELETE FROM auth_sessions WHERE token = :token');
        $stmt->execute([':token' => $token]);
    }
}

mm_json_response(200, ['status' => 'ok']);

<?php
require_once dirname(__DIR__) . '/_config.php';

mm_handle_options();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$user = mm_current_user();
if ($user === null) {
    mm_json_response(401, ['error' => 'Not authenticated.']);
    exit;
}

mm_json_response(200, ['status' => 'ok', 'user' => mm_public_user($user)]);

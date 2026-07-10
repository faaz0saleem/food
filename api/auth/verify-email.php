<?php
require_once dirname(__DIR__) . '/_config.php';

mm_handle_options();
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$user = mm_require_auth_user();
$body = mm_read_json_body();
$code = trim((string) ($body['code'] ?? ''));
if (!preg_match('/^\d{6}$/', $code)) {
    mm_json_response(400, ['error' => 'A valid 6-digit code is required.']);
    exit;
}

if (!mm_consume_auth_challenge((int) $user['id'], 'email_verify', $code)) {
    mm_json_response(400, ['error' => 'Invalid or expired verification code.']);
    exit;
}

mm_mark_email_verified((int) $user['id']);
$fresh = mm_find_user_by_id((int) $user['id']);
mm_json_response(200, ['status' => 'ok', 'user' => mm_public_user($fresh ?: $user)]);

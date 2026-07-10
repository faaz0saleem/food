<?php
require_once dirname(__DIR__) . '/_config.php';

mm_handle_options();
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$body = mm_read_json_body();
$email = strtolower(trim((string) ($body['email'] ?? '')));
$code = trim((string) ($body['code'] ?? ''));
$newPassword = (string) ($body['newPassword'] ?? '');

if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    mm_json_response(400, ['error' => 'A valid email is required.']);
    exit;
}
if (!preg_match('/^\d{6}$/', $code)) {
    mm_json_response(400, ['error' => 'A valid 6-digit code is required.']);
    exit;
}
if (strlen($newPassword) < 8) {
    mm_json_response(400, ['error' => 'Password must be at least 8 characters.']);
    exit;
}

$user = mm_find_user_by_email($email);
if (!$user) {
    mm_json_response(400, ['error' => 'Invalid reset request.']);
    exit;
}

if (!mm_consume_auth_challenge((int) $user['id'], 'password_reset', $code)) {
    mm_json_response(400, ['error' => 'Invalid or expired reset code.']);
    exit;
}

mm_update_password((int) $user['id'], $newPassword);
mm_json_response(200, ['status' => 'ok']);

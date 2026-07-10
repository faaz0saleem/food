<?php
require_once dirname(__DIR__) . '/_config.php';

mm_handle_options();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$body = mm_read_json_body();
mm_require_rate_limit(mm_rate_limit_key($body), 12, 60);

$email = strtolower(trim((string) ($body['email'] ?? '')));
$password = (string) ($body['password'] ?? '');

$user = mm_find_user_by_email($email);
if ($user === null || !mm_verify_password($password, (string) ($user['password_hash'] ?? ''))) {
    mm_json_response(401, ['error' => 'Incorrect email or password.']);
    exit;
}

try {
    $token = mm_create_session((int) $user['id']);
    mm_json_response(200, ['status' => 'ok', 'token' => $token, 'user' => mm_public_user($user)]);
} catch (Throwable $error) {
    mm_json_response(500, ['error' => 'Unable to log in right now.']);
}

<?php
require_once dirname(__DIR__) . '/_config.php';

mm_handle_options();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$body = mm_read_json_body();
mm_require_rate_limit(mm_rate_limit_key($body), 10, 60);

$name = trim((string) ($body['name'] ?? ''));
$email = strtolower(trim((string) ($body['email'] ?? '')));
$password = (string) ($body['password'] ?? '');
$learningStyle = trim((string) ($body['learningStyle'] ?? 'Visual'));

if ($name === '' || mb_strlen($name) < 2) {
    mm_json_response(400, ['error' => 'Please enter your name.']);
    exit;
}
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    mm_json_response(400, ['error' => 'Please enter a valid email.']);
    exit;
}
if (strlen($password) < 8) {
    mm_json_response(400, ['error' => 'Password must be at least 8 characters.']);
    exit;
}
if (mm_find_user_by_email($email) !== null) {
    mm_json_response(409, ['error' => 'An account with this email already exists.']);
    exit;
}

try {
    $user = mm_create_user($name, $email, $password, $learningStyle);
    $token = mm_create_session((int) $user['id']);
    mm_json_response(200, ['status' => 'ok', 'token' => $token, 'user' => mm_public_user($user)]);
} catch (Throwable $error) {
    mm_json_response(500, ['error' => 'Unable to create account right now.']);
}

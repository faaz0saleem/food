<?php
require_once dirname(__DIR__) . '/_config.php';

mm_handle_options();
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$body = mm_read_json_body();
mm_require_rate_limit(mm_rate_limit_key($body), 6, 60);

$email = strtolower(trim((string) ($body['email'] ?? '')));
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    mm_json_response(400, ['error' => 'A valid email is required.']);
    exit;
}

$user = mm_find_user_by_email($email);
if ($user) {
    $code = mm_generate_numeric_code(6);
    mm_store_auth_challenge((int) $user['id'], 'password_reset', $code, 20);
    mm_json_response(200, ['status' => 'ok', 'message' => 'Reset code generated.', 'devCode' => $code]);
    exit;
}

mm_json_response(200, ['status' => 'ok', 'message' => 'If the account exists, a reset code has been issued.']);

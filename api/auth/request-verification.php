<?php
require_once dirname(__DIR__) . '/_config.php';

mm_handle_options();
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$user = mm_require_auth_user();
$body = mm_read_json_body();
mm_require_rate_limit(mm_rate_limit_key($body), 6, 60);

if (!empty($user['email_verified'])) {
    mm_json_response(200, ['status' => 'ok', 'alreadyVerified' => true]);
    exit;
}

$code = mm_generate_numeric_code(6);
mm_store_auth_challenge((int) $user['id'], 'email_verify', $code, 20);

 $response = [
    'status' => 'ok',
    'message' => 'Verification code generated. Configure SMTP sender in production.',
];

if (mm_should_expose_dev_codes()) {
    $response['devCode'] = $code;
}

mm_json_response(200, $response);

<?php
require_once __DIR__ . '/_config.php';

mm_handle_options();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$user = mm_require_auth_user();
$body = mm_read_json_body();

$fields = [
    'plan_name' => trim((string) ($body['planName'] ?? '')),
    'plan_price' => (float) ($body['planPrice'] ?? 0),
    'plan_status' => trim((string) ($body['planStatus'] ?? 'inactive')),
    'plan_started' => trim((string) ($body['planStarted'] ?? '')),
];

$updated = mm_update_user_profile((int) $user['id'], $fields);
if ($updated === null) {
    mm_json_response(500, ['error' => 'Could not update subscription.']);
    exit;
}

mm_json_response(200, ['status' => 'ok', 'user' => mm_public_user($updated)]);

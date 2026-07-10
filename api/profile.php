<?php
require_once __DIR__ . '/_config.php';

mm_handle_options();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$user = mm_require_auth_user();
$body = mm_read_json_body();

$fields = [];
if (array_key_exists('name', $body)) {
    $fields['name'] = trim((string) $body['name']);
}
if (array_key_exists('learningStyle', $body)) {
    $fields['learning_style'] = trim((string) $body['learningStyle']);
}
if (array_key_exists('level', $body)) {
    $fields['level'] = trim((string) $body['level']);
}
if (array_key_exists('xp', $body)) {
    $fields['xp'] = max(0, (int) $body['xp']);
}

$updated = mm_update_user_profile((int) $user['id'], $fields);
if ($updated === null) {
    mm_json_response(500, ['error' => 'Could not save profile.']);
    exit;
}

mm_json_response(200, ['status' => 'ok', 'user' => mm_public_user($updated)]);

<?php
require_once __DIR__ . '/_config.php';

mm_handle_options();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$body = mm_read_json_body();
$visitorId = trim((string) ($body['visitorId'] ?? ''));

if ($visitorId !== '') {
    try {
        mm_track_visit($visitorId);
    } catch (Throwable $error) {
        // Keep endpoint resilient even when DB is unavailable.
    }
}

mm_json_response(200, ['status' => 'ok', 'stats' => mm_get_admin_summary()]);

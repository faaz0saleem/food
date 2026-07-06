<?php
require_once __DIR__ . '/_config.php';

mm_handle_options();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'POST') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

// Keep endpoint contract for frontend; no-op storage on simple PHP hosting.
mm_json_response(200, ['status' => 'ok']);

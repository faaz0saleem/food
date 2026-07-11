<?php
require_once __DIR__ . '/_config.php';

mm_handle_options();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$model = mm_env_value('GROQ_MODEL', 'llama-3.3-70b-versatile');
$details = mm_engine_details();
$engines = [];
foreach ($details as $key => $detail) {
    $engines[$key] = (bool) $detail['live'];
}

mm_json_response(200, [
    'status' => 'ok',
    'model' => $model,
    'engines' => $engines,
    'engineDetails' => $details,
    'stats' => mm_get_admin_summary(),
]);

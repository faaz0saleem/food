<?php
require_once __DIR__ . '/_config.php';

mm_handle_options();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET') {
    mm_json_response(405, ['error' => 'Method not allowed']);
    exit;
}

$groqKey = mm_env_value('GROQ_API_KEY', '');
$openaiKey = mm_env_value('OPENAI_API_KEY', '');
$anthropicKey = mm_env_value('ANTHROPIC_API_KEY', '');
$model = mm_env_value('GROQ_MODEL', 'llama-3.3-70b-versatile');

mm_json_response(200, [
    'status' => 'ok',
    'model' => $model,
    'engines' => [
        'reasoner' => $groqKey !== '',
        'solver' => $groqKey !== '',
        'explorer' => $openaiKey !== '',
        'storyteller' => $anthropicKey !== '',
    ],
    'stats' => mm_get_admin_summary(),
]);

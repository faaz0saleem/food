<?php
// Self-diagnosis for the AI backend. Safe to expose: reports only booleans,
// status codes, and masked key prefixes — never the keys themselves.
require_once __DIR__ . '/_config.php';

mm_handle_options();

$checks = [];

// 1. Runtime
$checks['php'] = [
    'version' => PHP_VERSION,
    'curl' => function_exists('curl_init'),
    'curl_multi' => function_exists('curl_multi_init'),
];

// 2. Which provider keys exist (masked)
$providers = ['groq', 'gemini', 'openai', 'anthropic'];
$keys = [];
foreach ($providers as $provider) {
    $key = mm_provider_api_key($provider);
    $keys[$provider] = [
        'present' => $key !== '',
        'length' => strlen($key),
        'prefix' => $key !== '' ? substr($key, 0, 4) . '…' : null,
    ];
}
$checks['apiKeys'] = $keys;

// 3. Every key-file location the config hunts through — shows exactly
//    which file the owner's paste landed in (never shows the key itself).
$root = dirname(__DIR__);
$checks['keyFiles'] = [];
foreach ([$root => 'webRoot', dirname($root) => 'aboveWebRoot'] as $dir => $label) {
    foreach (['.env', 'env', '.env.txt', 'env.txt', '.env.production', 'keys.txt', '.env.example'] as $fileName) {
        $path = $dir . DIRECTORY_SEPARATOR . $fileName;
        if (!is_file($path)) {
            continue;
        }
        $content = (string) @file_get_contents($path);
        $hasReal = preg_match('/^[ \t]*GROQ_API_KEY[ \t]*=[ \t]*(?!your[_-]|change|xxxx)[^\s#]+/mi', $content) === 1;
        $checks['keyFiles'][$label . '/' . $fileName] = [
            'readable' => is_readable($path),
            'hasGroqKeyLine' => $hasReal,
        ];
    }
}

// 4. Live outbound test against Groq (auth check, ~1s). 200 = key valid,
//    401 = key wrong/expired, status 0 + error = outbound HTTPS blocked.
$groqKey = mm_provider_api_key('groq');
if ($groqKey !== '' && function_exists('curl_init')) {
    $ch = curl_init('https://api.groq.com/openai/v1/models');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $groqKey],
        CURLOPT_TIMEOUT => 12,
        CURLOPT_CONNECTTIMEOUT => 8,
    ]);
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    $checks['groqConnectivity'] = [
        'httpStatus' => $status,
        'curlError' => $error !== '' ? $error : null,
        'verdict' => $status === 200
            ? 'OK — key is valid and outbound HTTPS works'
            : ($status === 401
                ? 'KEY INVALID/EXPIRED — generate a new key at console.groq.com and update .env'
                : ($status === 0
                    ? 'OUTBOUND BLOCKED — this server cannot reach api.groq.com (' . ($error ?: 'unknown curl error') . ')'
                    : 'Unexpected HTTP ' . $status)),
    ];
} else {
    $checks['groqConnectivity'] = [
        'verdict' => $groqKey === ''
            ? 'NO KEY — GROQ_API_KEY is empty. Open /api/setup.php on this site to paste your key, or edit .env manually (it is NOT deployed from GitHub).'
            : 'curl missing',
    ];
}

// 5. Engine chains as the router sees them
$checks['engineChains'] = [];
foreach (array_keys(mm_engines_config()) as $engineKey) {
    $checks['engineChains'][$engineKey] = mm_engine_chain($engineKey);
}

// 6. Database (analytics/limits) — degrades gracefully if down
try {
    $checks['database'] = ['connected' => mm_db() !== null];
} catch (Throwable $e) {
    $checks['database'] = ['connected' => false];
}

mm_json_response(200, ['status' => 'ok', 'checks' => $checks, 'generatedAt' => gmdate('c')]);

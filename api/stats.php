<?php
// Per-user analytics sync. The client keeps stats in localStorage for speed and
// pushes/pulls them here so they follow the account across devices and show up
// in the admin. GET returns the stored blob; POST saves it.
require_once __DIR__ . '/_config.php';

mm_handle_options();

$user = mm_current_user();
if ($user === null) {
    mm_json_response(401, ['error' => 'Not signed in.']);
    exit;
}

$db = mm_db();
if ($db === null) {
    // No DB — behave like "nothing stored" so the client just keeps localStorage.
    mm_json_response(200, ['status' => 'ok', 'stats' => null, 'offline' => true]);
    exit;
}

$id = (int) $user['id'];
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'POST') {
    $body = mm_read_json_body();
    $stats = $body['stats'] ?? null;
    if (!is_array($stats)) {
        mm_json_response(400, ['error' => 'Need a stats object.']);
        exit;
    }
    $json = json_encode($stats);
    if ($json === false || strlen($json) > 200000) {
        mm_json_response(413, ['error' => 'Stats payload too large.']);
        exit;
    }
    // Mirror level/xp onto the row too so the admin user list reflects progress.
    $xp = (int) ($stats['xp'] ?? ($user['xp'] ?? 0));
    $level = substr((string) ($stats['mm_level'] ?? $stats['level'] ?? ($user['level'] ?? 'Newbie')), 0, 60);
    try {
        $db->prepare('UPDATE users SET stats_json = :s, xp = :xp, level = :lv, updated_at = UTC_TIMESTAMP() WHERE id = :id')
           ->execute([':s' => $json, ':xp' => $xp, ':lv' => $level, ':id' => $id]);
        mm_json_response(200, ['status' => 'ok']);
    } catch (Throwable $e) {
        mm_json_response(500, ['error' => 'Could not save stats: ' . $e->getMessage()]);
    }
    exit;
}

// GET
try {
    $stmt = $db->prepare('SELECT stats_json FROM users WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $id]);
    $raw = (string) $stmt->fetchColumn();
    $stats = $raw !== '' ? json_decode($raw, true) : null;
    mm_json_response(200, ['status' => 'ok', 'stats' => is_array($stats) ? $stats : null]);
} catch (Throwable $e) {
    mm_json_response(200, ['status' => 'ok', 'stats' => null]);
}

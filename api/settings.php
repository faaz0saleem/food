<?php
// Public, read-only subset of the admin site settings. The live site reads this
// to show the announcement banner, honor maintenance mode, etc. Only safe keys
// are exposed — never credentials or internal config.
require_once __DIR__ . '/_config.php';
mm_handle_options();

$path = __DIR__ . '/../data/site-settings.json';
$raw = @file_get_contents($path);
$s = is_string($raw) ? json_decode($raw, true) : null;
if (!is_array($s)) { $s = []; }

function pub_bool($s, $k, $d = false) { return isset($s[$k]) ? (bool) $s[$k] : $d; }
function pub_str($s, $k, $d = '') { return isset($s[$k]) ? (string) $s[$k] : $d; }
function pub_num($s, $k, $d = 0) { return isset($s[$k]) ? $s[$k] + 0 : $d; }

$public = [
    'site_name' => pub_str($s, 'site_name', 'Hungter'),
    'tagline' => pub_str($s, 'tagline', 'The tutor that gets you.'),
    'maintenance_mode' => pub_bool($s, 'maintenance_mode', false),
    'maintenance_message' => pub_str($s, 'maintenance_message', ''),
    'announcement_enabled' => pub_bool($s, 'announcement_enabled', false),
    'announcement_text' => pub_str($s, 'announcement_text', ''),
    'announcement_link' => pub_str($s, 'announcement_link', ''),
    'force_login' => pub_bool($s, 'force_login', false),
    'signups_enabled' => pub_bool($s, 'signups_enabled', true),
    'manual_login_enabled' => pub_bool($s, 'manual_login_enabled', true),
    'billing_enabled' => pub_bool($s, 'billing_enabled', false),
    'store_enabled' => pub_bool($s, 'store_enabled', true),
    'show_pricing_page' => pub_bool($s, 'show_pricing_page', true),
    'features' => [
        'chat' => pub_bool($s, 'feature_chat', true),
        'quiz' => pub_bool($s, 'feature_quiz', true),
        'flashcards' => pub_bool($s, 'feature_flashcards', true),
        'guess_papers' => pub_bool($s, 'feature_guess_papers', true),
        'codex' => pub_bool($s, 'feature_codex', true),
        'progress' => pub_bool($s, 'feature_progress', true),
        'books' => pub_bool($s, 'feature_books', true),
        'all4' => pub_bool($s, 'feature_all4', true),
    ],
    'prices' => [
        'student' => pub_num($s, 'price_student', 5),
        'pro' => pub_num($s, 'price_pro', 12),
    ],
    'support_email' => pub_str($s, 'support_email', ''),
    'social' => [
        'twitter' => pub_str($s, 'social_twitter', ''),
        'instagram' => pub_str($s, 'social_instagram', ''),
        'tiktok' => pub_str($s, 'social_tiktok', ''),
    ],
];

header('Cache-Control: public, max-age=60');
mm_json_response(200, ['status' => 'ok', 'settings' => $public]);

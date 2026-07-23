<?php
// Public book catalog: the static seed (data/books.json) merged with any books
// an admin has added (store_books table). Used by the storefront and the
// product pages so admin-added books appear everywhere without a redeploy.
require_once __DIR__ . '/_config.php';

mm_handle_options();

$books = [];

// 1) Static seed catalog.
$seedRaw = @file_get_contents(__DIR__ . '/../data/books.json');
if (is_string($seedRaw) && $seedRaw !== '') {
    $seed = json_decode($seedRaw, true);
    if (is_array($seed)) {
        foreach ($seed as $b) {
            if (is_array($b) && !empty($b['id'])) { $b['source'] = 'seed'; $books[(string) $b['id']] = $b; }
        }
    }
}

// 2) Admin-added books (override/add by id). Newest first so they surface.
$db = mm_db();
if ($db !== null) {
    try {
        $stmt = $db->query('SELECT * FROM store_books ORDER BY created_at DESC');
        while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $topics = [];
            if (!empty($r['topics_json'])) { $t = json_decode((string) $r['topics_json'], true); if (is_array($t)) $topics = $t; }
            $books[(string) $r['id']] = [
                'id' => (string) $r['id'],
                'title' => (string) $r['title'],
                'author' => (string) ($r['author'] ?? ''),
                'subject' => (string) ($r['subject'] ?? ''),
                'section' => (string) ($r['section'] ?? ''),
                'price' => (float) ($r['price'] ?? 0),
                'isbn' => (string) ($r['isbn'] ?? ''),
                'description' => (string) ($r['description'] ?? ''),
                'topics' => $topics,
                'cover' => (string) ($r['cover_data'] ?? ''),
                'source' => 'admin',
            ];
        }
    } catch (Throwable $e) { /* table may not exist yet */ }
}

// Preserve admin-first ordering, then seed.
$admin = []; $seedOut = [];
foreach ($books as $b) { if (($b['source'] ?? '') === 'admin') $admin[] = $b; else $seedOut[] = $b; }
mm_json_response(200, array_values(array_merge($admin, $seedOut)));

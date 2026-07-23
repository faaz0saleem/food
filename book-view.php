<?php
// Dynamic product page for any book by id (used for admin-added books that have
// no static /books/<id>.html file). Renders server-side so it's SEO-friendly.
require_once __DIR__ . '/api/_config.php';

$id = preg_replace('/[^a-z0-9\-]+/i', '', (string) ($_GET['id'] ?? ''));

// Find the book: admin store_books first, then the static seed.
$book = null;
$db = mm_db();
if ($db !== null && $id !== '') {
    try {
        $stmt = $db->prepare('SELECT * FROM store_books WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $r = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($r) {
            $topics = [];
            if (!empty($r['topics_json'])) { $t = json_decode((string) $r['topics_json'], true); if (is_array($t)) $topics = $t; }
            $book = ['id' => $r['id'], 'title' => $r['title'], 'author' => $r['author'], 'subject' => $r['subject'],
                     'section' => $r['section'], 'price' => (float) $r['price'], 'isbn' => $r['isbn'],
                     'description' => $r['description'], 'topics' => $topics, 'cover' => (string) ($r['cover_data'] ?? '')];
        }
    } catch (Throwable $e) {}
}
if ($book === null) {
    $seedRaw = @file_get_contents(__DIR__ . '/data/books.json');
    if (is_string($seedRaw)) {
        $seed = json_decode($seedRaw, true);
        if (is_array($seed)) { foreach ($seed as $b) { if (($b['id'] ?? '') === $id) { $book = $b; break; } } }
    }
}

if ($book === null) {
    http_response_code(404);
    $book = ['id' => '', 'title' => 'Book not found', 'author' => '', 'subject' => '', 'section' => '', 'price' => 0, 'isbn' => '', 'description' => 'This book could not be found.', 'topics' => [], 'cover' => ''];
}

function bv_e($s) { return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8'); }
function bv_color($s) {
    $p = ['#8B5CFF','#4DF0FF','#FF6B4A','#C8FF4D','#FF4DE3','#4DD8FF','#FFD14D'];
    $s = (string) $s; $h = 0; $len = strlen($s);
    for ($i = 0; $i < $len; $i++) { $h = ord($s[$i]) + (($h << 5) - $h); }
    return $p[abs($h) % count($p)];
}
$title = (string) $book['title'];
$author = (string) ($book['author'] ?? '');
$author0 = trim(explode('/', $author)[0]);
$desc = (string) ($book['description'] ?? '');
$metaDesc = 'Buy ' . $title . ' as an instant PDF (emailed within 5 hours) or a physical copy. Every book includes a free Student subscription to Hungter.';
$cover = (string) ($book['cover'] ?? '');
$coverStyle = 'background:linear-gradient(150deg,' . bv_color($book['subject'] ?: $title) . ',rgba(4,6,15,0.9));';
$ld = json_encode([
    '@context' => 'https://schema.org', '@type' => 'Book', 'name' => $title,
    'author' => ['@type' => 'Person', 'name' => $author0], 'isbn' => (string) ($book['isbn'] ?? ''),
    'about' => (string) ($book['subject'] ?? ''), 'description' => $desc,
    'offers' => ['@type' => 'Offer', 'price' => (string) $book['price'], 'priceCurrency' => 'USD', 'availability' => 'https://schema.org/InStock', 'url' => 'https://hungter.com/books/' . $book['id']],
]);
$bookJson = json_encode(['id' => $book['id'], 'title' => $title, 'subject' => $book['subject'] ?? '', 'section' => $book['section'] ?? '', 'price' => (float) $book['price']]);
?><!DOCTYPE html>
<html lang="en">
<head>
<meta name="google-adsense-account" content="ca-pub-7768612748508302">
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-FHMTQDLHV2"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("consent","default",{ad_storage:"denied",analytics_storage:"denied",ad_user_data:"denied",ad_personalization:"denied"});gtag("js",new Date());gtag("config","G-FHMTQDLHV2");</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
<title><?php echo bv_e($title); ?> — Buy PDF or Physical Book | Hungter</title>
<meta name="description" content="<?php echo bv_e($metaDesc); ?>">
<link rel="canonical" href="https://hungter.com/books/<?php echo bv_e($book['id']); ?>">
<link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt">
<meta property="og:type" content="product">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="<?php echo bv_e($title); ?>">
<meta property="og:description" content="<?php echo bv_e($metaDesc); ?>">
<meta property="og:url" content="https://hungter.com/books/<?php echo bv_e($book['id']); ?>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Manrope:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/brand.css?v=20260720">
<link rel="stylesheet" href="/nav.css">
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/book.css?v=1">
<script type="application/ld+json"><?php echo $ld; ?></script>
</head>
<body>
<div class="wrap">
  <div class="crumbs"><a href="/">Home</a> / <a href="/books">Books</a> / <span><?php echo bv_e($title); ?></span></div>
  <div id="productView">
    <div class="prod">
      <div>
      <?php if ($cover !== '') { ?>
        <img class="cover" src="<?php echo bv_e($cover); ?>" alt="<?php echo bv_e($title); ?> cover" style="object-fit:cover;">
      <?php } else { ?>
        <div class="cover" style="<?php echo $coverStyle; ?>">
          <?php if (!empty($book['isbn'])) { ?><img class="cover-img" src="https://covers.openlibrary.org/b/isbn/<?php echo bv_e($book['isbn']); ?>-L.jpg" alt="<?php echo bv_e($title); ?> cover" loading="lazy" onerror="this.remove()" onload="if(this.naturalWidth&lt;10)this.remove()"><?php } ?>
          <div class="c-sub"><?php echo bv_e($book['subject'] ?? ''); ?></div><div class="c-title"><?php echo bv_e($title); ?></div><div class="c-auth"><?php echo bv_e($author0); ?></div></div>
      <?php } ?>
      </div>
      <div class="info">
        <h1><?php echo bv_e($title); ?></h1>
        <p class="author"><?php echo $author ? 'by ' . bv_e($author) : ''; ?></p>
        <div class="badges">
          <?php if (!empty($book['section'])) echo '<span class="badge sec">' . bv_e($book['section']) . '</span>'; ?>
          <?php if (!empty($book['subject'])) echo '<span class="badge sub">' . bv_e($book['subject']) . '</span>'; ?>
          <?php if (!empty($book['isbn'])) echo '<span class="badge">ISBN ' . bv_e($book['isbn']) . '</span>'; ?>
        </div>
        <div class="stars">★★★★★ <small>Trusted coursebook</small></div>
        <p class="desc"><?php echo bv_e($desc); ?></p>
        <?php if (!empty($book['topics'])) { ?>
        <div class="sec-h">What's inside</div>
        <div class="topics"><?php foreach ($book['topics'] as $t) echo '<span class="topic">' . bv_e($t) . '</span>'; ?></div>
        <?php } ?>
        <div class="incl">
          <b>✨ Every book includes a free Student subscription</b> (worth $5/mo).
          <ul>
            <li>$8/month of AI tutoring — thousands of messages</li>
            <li>⚡ All-4 engine compare mode &amp; priority generation</li>
            <li>All quizzes, flashcards &amp; progress tracking</li>
          </ul>
        </div>
      </div>
      <div class="buy">
        <div class="price" id="price">—</div>
        <div class="buy-perk">+ Free Student subscription included</div>
        <div class="fmt">
          <button id="fmtPdf" class="on" data-fmt="pdf">📄 PDF<small id="pdfPrice"></small></button>
          <button id="fmtPhys" data-fmt="physical">📦 Physical<small id="physPrice"></small></button>
        </div>
        <div id="deliveryNote" class="buy-note"></div>
        <div class="qty" id="qtyRow">
          <span style="font-size:0.85rem;color:var(--ink-soft);">Qty</span>
          <button id="qMinus" type="button">−</button>
          <span id="qVal" style="font-family:var(--font-mono);min-width:20px;text-align:center;">1</span>
          <button id="qPlus" type="button">+</button>
        </div>
        <button class="btn-buy" id="buyBtn">Buy now</button>
        <div class="trust"><span>🔒 Secure</span><span>↩︎ 7-day guarantee</span><span>⚡ Instant PDF</span></div>
      </div>
    </div>
    <div id="checkout" class="hide" style="max-width:520px;margin:32px auto 0;">
      <div class="buy" style="position:static;">
        <h2 style="font-family:var(--font-display);font-size:1.15rem;margin:0 0 4px;">Checkout</h2>
        <p class="buy-note" id="coSummary" style="margin:0 0 12px;"></p>
        <input class="buy-inp" id="coName" placeholder="Full name" autocomplete="name">
        <input class="buy-inp" id="coEmail" type="email" placeholder="Email (for your PDF / receipt)" autocomplete="email">
        <div id="shipFields" class="hide">
          <textarea class="buy-inp" id="coAddress" placeholder="Full shipping address (street, city, postal code, country)"></textarea>
          <input class="buy-inp" id="coPhone" placeholder="Phone (for delivery)" autocomplete="tel">
        </div>
        <button class="btn-buy" id="placeBtn" style="margin-top:8px;">Place order</button>
        <p class="err" id="coErr" style="color:var(--coral);font-size:0.82rem;min-height:1em;margin-top:8px;"></p>
        <p class="buy-note">Payment isn't connected yet — your order is reserved and we'll email you to complete it. The Student subscription activates on your account right away.</p>
      </div>
    </div>
  </div>
  <div id="doneView" class="hide" style="max-width:560px;margin:20px auto;">
    <div class="ok-card"><div class="big">🎉</div><h2>Order placed!</h2>
      <p>Reference <span class="ref" id="doneRef"></span></p>
      <p style="color:var(--ink-soft);line-height:1.6;" id="doneMsg"></p>
      <a href="/books" class="btn-buy" style="display:inline-block;text-decoration:none;margin-top:12px;max-width:240px;">Browse more books</a>
    </div>
  </div>
  <div class="related" id="relatedWrap" style="display:none;"><h2>You might also like</h2><div class="rel-grid" id="relGrid"></div></div>
</div>
<footer class="site-footer"></footer>
<script>window.BOOK=<?php echo $bookJson; ?>;</script>
<script src="/api-config.js"></script>
<script src="/layout.js" defer></script>
<script src="/book-buy.js" defer></script>
</body>
</html>

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BOOKS_JSON = path.join(ROOT, 'data', 'books.json');
const OUT_DIR = path.join(ROOT, 'books');
const SITEMAP = path.join(ROOT, 'sitemap.xml');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncateDescription(value, max = 150) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}...`;
}

function bookPageHtml(book, books) {
  const title = escapeHtml(book.title);
  const author = escapeHtml(book.author);
  const isbn = escapeHtml(book.isbn);
  const section = escapeHtml(book.section);
  const subject = escapeHtml(book.subject);
  const description = escapeHtml(book.description);
  const metaDescription = escapeHtml(truncateDescription(book.description, 150));
  const canonical = `https://hungter.com/books/${book.id}.html`;
  const interactiveUrl = `/book.html?id=${book.id}`;
  const buyLink = interactiveUrl; // buying happens on Hungter's own site, not a third party
  const price = Number(book.price || 0);
  const priceLabel = price > 0 ? `$${price.toFixed(2)}` : '';
  const coverUrl = `https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg`;

  const similar = books
    .filter((item) => item.id !== book.id && item.section === book.section && item.subject === book.subject)
    .slice(0, 6)
    .map((item) => `<li><a href="/books/${item.id}.html">${escapeHtml(item.title)}</a></li>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-FHMTQDLHV2"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag("js", new Date());

  gtag("config", "G-FHMTQDLHV2");
</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Fredoka:wght@500;600;700&family=Manrope:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap">
<title>${title} — ${section} ${subject} | Hungter</title>
<meta name="description" content="${metaDescription}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="book">
<meta property="og:title" content="${title} — ${section} ${subject} | Hungter">
<meta property="og:description" content="${metaDescription}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="https://hungter.com/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/brand.css">
<link rel="stylesheet" href="/nav.css">
<style>
  .book-page { max-width: var(--container); margin: 0 auto; padding: 28px 16px 56px; }
  .crumbs { display: flex; flex-wrap: wrap; gap: 8px; color: var(--ink-soft); margin-bottom: 12px; }
  .crumbs a { color: var(--ink-soft); text-decoration: none; border-bottom: 1px solid var(--border); }
  .book-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-sm); padding: 18px; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
  .book-card h1 { margin: 0 0 10px; font-family: var(--font-display); }
  .book-meta { color: var(--ink-soft); margin: 0 0 12px; }
  .book-layout { display: grid; grid-template-columns: 180px 1fr; gap: 16px; align-items: start; }
  .book-layout img { width: 180px; height: 260px; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--border); box-shadow: var(--shadow-sm); }
  .book-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
  .btn { border: 1px solid var(--border); border-radius: 999px; padding: 8px 14px; text-decoration: none; }
  .btn.primary { background: var(--gradient-brand); color: var(--bg-deep); box-shadow: var(--glow-lime); border: none; font-weight: 700; }
  .btn.secondary { background: transparent; color: var(--ink); }
  .notice { margin-top: 14px; color: var(--ink-soft); }
  .similar { margin-top: 18px; }
  .similar ul { margin: 10px 0 0; padding-left: 18px; }
  .similar a { color: var(--lime); }
  @media (max-width: 700px) {
    .book-layout { grid-template-columns: 1fr; }
    .book-layout img { width: 100%; max-width: 240px; height: auto; }
  }
</style>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Book","name":"${title}","author":{"@type":"Person","name":"${author}"},"isbn":"${isbn}","description":"${description}","url":"${canonical}"}</script>
</head>
<body>
<header class="site-nav"></header>
<main class="book-page">
  <nav class="crumbs" aria-label="Breadcrumb">
    <a href="/">Home</a>
    <span>&gt;</span>
    <a href="/books.html">Books</a>
    <span>&gt;</span>
    <span>${section}</span>
    <span>&gt;</span>
    <span>${title}</span>
  </nav>
  <article class="book-card">
    <h1>${title}</h1>
    <p class="book-meta">${author} · ${section} · ${subject}</p>
    <div class="book-layout">
      <img src="${coverUrl}" alt="${title} cover" width="180" height="260">
      <div>
        <p>${description}</p>
        <div class="book-actions">
          <a class="btn primary" href="${buyLink}">Buy this book${priceLabel ? ` — ${priceLabel}` : ''}</a>
          <a class="btn secondary" href="${interactiveUrl}">Open interactive AI tools for this book →</a>
        </div>
        <p class="notice">AI-generated original practice content — not official exam board material.</p>
      </div>
    </div>
    <section class="similar">
      <h2>Similar books</h2>
      ${similar ? `<ul>${similar}</ul>` : '<p>No similar books in this section yet.</p>'}
    </section>
  </article>
</main>
<footer class="site-footer"></footer>
<script src="/layout.js" defer></script>
</body>
</html>`;
}

function buildSitemap(books) {
  const topPages = [
    '/',
    '/books.html',
    '/guess-papers.html',
    '/roundchat.html',
    '/chat.html',
    '/quiz.html',
    '/flashcards.html',
    '/learn.html',
    '/dashboard.html',
    '/progress.html',
    '/subjects.html',
    '/faq.html',
    '/about.html',
    '/terms.html',
    '/privacy.html',
  ];

  const urls = topPages
    .map((url) => `  <url><loc>https://hungter.com${url}</loc></url>`)
    .concat(books.map((book) => `  <url><loc>https://hungter.com/books/${book.id}.html</loc></url>`));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  fs.writeFileSync(SITEMAP, xml, 'utf8');
}

function main() {
  const books = JSON.parse(fs.readFileSync(BOOKS_JSON, 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  books.forEach((book) => {
    const html = bookPageHtml(book, books);
    fs.writeFileSync(path.join(OUT_DIR, `${book.id}.html`), html, 'utf8');
  });

  buildSitemap(books);
  console.log(`Generated ${books.length} static book pages and sitemap.xml`);
}

main();

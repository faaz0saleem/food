const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TAG_ID = 'G-FHMTQDLHV2';
const SKIP_DIRS = new Set(['node_modules', '.git']);

function walk(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(path.join(dir, entry.name));
    }
  }
}

function main() {
  const htmlFiles = [];
  walk(ROOT, htmlFiles);

  const missing = [];
  for (const file of htmlFiles) {
    const content = fs.readFileSync(file, 'utf8');
    if (!content.includes(TAG_ID)) {
      missing.push(path.relative(ROOT, file));
    }
  }

  if (missing.length) {
    console.error('Google Analytics tag missing in these HTML files:');
    for (const file of missing) console.error(`- ${file}`);
    process.exit(1);
  }

  console.log(`OK: ${htmlFiles.length} HTML files include ${TAG_ID}`);
}

main();

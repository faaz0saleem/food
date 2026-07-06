const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const REQUIRED_FILES = [
  'index.html',
  'server.js',
  'engines.js',
  'stats-core.js',
  'layout.js',
  'brand.css',
  'netlify.toml',
  '.env.example',
];

test('required project files exist', () => {
  for (const file of REQUIRED_FILES) {
    assert.equal(fs.existsSync(file), true, `missing required file: ${file}`);
  }
});

test('netlify API redirect is configured', () => {
  const netlifyToml = fs.readFileSync('netlify.toml', 'utf8');
  assert.match(netlifyToml, /from = "\/api\/\*"/);
  assert.match(netlifyToml, /to = "\/.netlify\/functions\/api\/:splat"/);
});

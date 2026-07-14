<?php
// AI key setup — one page per provider: /api/setup.php (Groq),
// ?provider=gemini, ?provider=openai, ?provider=anthropic.
// Keys are validated live with the vendor BEFORE saving, written into the
// server's .env, never echoed back. A provider that already has a key is
// locked and requires the ADMIN_KEY to change.
require_once __DIR__ . '/_config.php';

$PROVIDERS = [
    'groq' => ['title' => 'Groq', 'env' => 'GROQ_API_KEY', 'ph' => 'gsk_…', 'console' => 'console.groq.com → API Keys', 'engine' => '🟢 Groq engine (required — powers fallbacks too)'],
    'gemini' => ['title' => 'Gemini', 'env' => 'GEMINI_API_KEY', 'ph' => 'AIza…', 'console' => 'aistudio.google.com/apikey', 'engine' => '🟠 Gemini engine'],
    'openai' => ['title' => 'ChatGPT (OpenAI)', 'env' => 'OPENAI_API_KEY', 'ph' => 'sk-…', 'console' => 'platform.openai.com → API keys', 'engine' => '🔵 ChatGPT engine'],
    'anthropic' => ['title' => 'Claude (Anthropic)', 'env' => 'ANTHROPIC_API_KEY', 'ph' => 'sk-ant-…', 'console' => 'console.anthropic.com → API Keys', 'engine' => '🟣 Claude engine'],
];
$provider = strtolower(trim((string) ($_GET['provider'] ?? 'groq')));
if (!isset($PROVIDERS[$provider])) { $provider = 'groq'; }
$meta = $PROVIDERS[$provider];

function setup_validate(string $provider, string $key): array {
    $reqs = [
        'groq' => ['https://api.groq.com/openai/v1/models', ['Authorization: Bearer ' . $key]],
        'gemini' => ['https://generativelanguage.googleapis.com/v1beta/models?key=' . urlencode($key), []],
        'openai' => ['https://api.openai.com/v1/models', ['Authorization: Bearer ' . $key]],
        'anthropic' => ['https://api.anthropic.com/v1/models', ['x-api-key: ' . $key, 'anthropic-version: 2023-06-01']],
    ];
    [$url, $headers] = $reqs[$provider];
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => 12, CURLOPT_CONNECTTIMEOUT => 8]);
    curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    if ($status === 200) return ['ok' => true, 'message' => 'Key verified with the vendor ✓'];
    if (in_array($status, [400, 401, 403], true)) return ['ok' => false, 'message' => 'The vendor rejected this key (HTTP ' . $status . '). Copy a fresh key and try again.'];
    if ($status === 0) return ['ok' => false, 'message' => 'This server cannot reach the vendor (' . ($error ?: 'network blocked') . '). Key NOT saved.'];
    return ['ok' => false, 'message' => 'Unexpected vendor response (HTTP ' . $status . '). Key not saved.'];
}

function setup_write_env(array $pairs): array {
    $envPath = dirname(__DIR__) . DIRECTORY_SEPARATOR . '.env';
    $lines = is_file($envPath) ? (@file($envPath, FILE_IGNORE_NEW_LINES) ?: []) : [];
    foreach ($pairs as $name => $value) {
        $found = false;
        foreach ($lines as $i => $line) {
            if (preg_match('/^\s*' . preg_quote($name, '/') . '\s*=/', $line) === 1) { $lines[$i] = $name . '=' . $value; $found = true; break; }
        }
        if (!$found) { $lines[] = $name . '=' . $value; }
    }
    $written = @file_put_contents($envPath, implode("\n", $lines) . "\n", LOCK_EX);
    if ($written === false) {
        return ['ok' => false, 'message' => '.env is not writable by PHP. Manual fix: Hostinger File Manager → public_html → edit .env → add the line yourself.'];
    }
    @chmod($envPath, 0600);
    return ['ok' => true, 'message' => 'Saved to .env ✓'];
}

$locked = mm_provider_api_key($provider) !== '';
$notice = null;

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    try { mm_require_rate_limit('setup:' . mm_client_ip(), 10, 300); } catch (Throwable $e) {}
    $key = trim((string) ($_POST['api_key'] ?? $_POST['groq_key'] ?? ''));
    $adminKey = trim((string) ($_POST['admin_key'] ?? ''));

    if ($locked) {
        $realAdmin = mm_env_value('ADMIN_KEY', '');
        if ($realAdmin === '' || !hash_equals($realAdmin, $adminKey)) {
            $notice = ['ok' => false, 'message' => 'A ' . $meta['title'] . ' key is already configured — changing it requires the correct ADMIN_KEY.'];
        }
    }
    if ($notice === null) {
        if (strlen($key) < 15) {
            $notice = ['ok' => false, 'message' => 'Paste the full API key.'];
        } else {
            $check = setup_validate($provider, $key);
            $notice = $check['ok'] ? array_merge(setup_write_env([$meta['env'] => $key]), ['ok' => true]) : $check;
            if (($notice['ok'] ?? false) && $check['ok']) {
                $notice['message'] = $check['message'] . ' · Saved. The ' . $meta['title'] . ' engine is now answering with its real vendor!';
            }
            $locked = mm_provider_api_key($provider) !== '';
        }
    }
}

function h($v) { return htmlspecialchars((string) $v, ENT_QUOTES); }
header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex');
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex">
<title><?php echo h($meta['title']); ?> Key Setup | Hungter</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/brand.css">
<style>
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
  .setup-card { width: min(560px, 100%); background: rgba(13,20,40,0.85); border: 1px solid var(--border-glow); border-radius: var(--radius); box-shadow: var(--shadow); padding: 34px; backdrop-filter: blur(18px); }
  h1 { font-size: 1.4rem; letter-spacing: -0.02em; margin: 0 0 6px; }
  .sub { color: var(--ink-soft); font-size: 0.92rem; line-height: 1.6; margin: 0 0 20px; }
  .tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
  .tabs a { font-family: var(--font-mono); font-size: 0.7rem; letter-spacing: 0.06em; padding: 7px 13px; border-radius: 999px; border: 1px solid var(--border); color: var(--ink-soft); }
  .tabs a.on { background: var(--gradient-brand); color: var(--bg-deep); border-color: transparent; font-weight: 700; }
  .tabs a .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; background: var(--coral); }
  .tabs a .dot.ok { background: var(--lime); }
  label { display: block; font-family: var(--font-mono); font-size: 0.66rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-faint); margin: 14px 0 6px; }
  input { width: 100%; border: 1px solid var(--border); background: var(--surface-2); color: var(--ink); border-radius: 10px; padding: 12px 14px; font-family: var(--font-mono); font-size: 0.88rem; }
  input:focus { outline: none; border-color: var(--cyan); box-shadow: var(--glow-cyan); }
  button { width: 100%; margin-top: 20px; border: none; border-radius: 999px; padding: 14px; font-family: var(--font-display); font-weight: 700; font-size: 1rem; background: var(--gradient-brand); color: var(--bg-deep); cursor: pointer; box-shadow: var(--glow-lime); }
  .notice { border-radius: 12px; padding: 13px 16px; font-size: 0.9rem; line-height: 1.55; margin-bottom: 16px; }
  .notice.ok { color: var(--lime); background: rgba(200,255,77,0.08); border: 1px solid rgba(200,255,77,0.35); }
  .notice.bad { color: var(--coral); background: rgba(255,107,74,0.08); border: 1px solid rgba(255,107,74,0.35); }
  .steps { color: var(--ink-soft); font-size: 0.86rem; line-height: 1.7; margin: 0; padding-left: 18px; }
  .foot { margin-top: 18px; display: flex; gap: 14px; font-size: 0.82rem; flex-wrap: wrap; }
  .foot a { color: var(--cyan); }
</style>
</head>
<body>
  <main class="setup-card">
    <h1>🔑 <?php echo h($meta['title']); ?> API Key</h1>
    <div class="tabs">
      <?php foreach ($PROVIDERS as $pk => $pm): $has = mm_provider_api_key($pk) !== ''; ?>
        <a href="/api/setup.php?provider=<?php echo h($pk); ?>" class="<?php echo $pk === $provider ? 'on' : ''; ?>"><span class="dot <?php echo $has ? 'ok' : ''; ?>"></span><?php echo h($pm['title']); ?></a>
      <?php endforeach; ?>
    </div>
    <p class="sub">Powers the <?php echo h($meta['engine']); ?>. <?php echo $locked ? 'A key is already configured for this provider — enter your ADMIN_KEY to replace it.' : 'The key is verified with the vendor, then written into this server\'s .env. It never leaves your site.'; ?></p>

    <?php if ($notice !== null): ?><div class="notice <?php echo ($notice['ok'] ?? false) ? 'ok' : 'bad'; ?>"><?php echo h($notice['message']); ?></div><?php endif; ?>

    <ol class="steps">
      <li>Get your key: <strong><?php echo h($meta['console']); ?></strong></li>
      <li>Paste it below and hit verify</li>
    </ol>
    <form method="post" autocomplete="off">
      <label for="api_key"><?php echo h($meta['title']); ?> API key</label>
      <input id="api_key" name="api_key" type="password" placeholder="<?php echo h($meta['ph']); ?>" required>
      <?php if ($locked): ?>
        <label for="admin_key">Admin key</label>
        <input id="admin_key" name="admin_key" type="password" placeholder="ADMIN_KEY from .env">
      <?php endif; ?>
      <button type="submit">Verify &amp; save <?php echo h($meta['title']); ?> key</button>
    </form>

    <div class="foot">
      <a href="/api/diag.php">Server self-check</a>
      <a href="/api/admin.php">Owner panel</a>
      <a href="/chat.html">Open chat</a>
    </div>
  </main>
</body>
</html>

<?php
// One-time AI key setup for the site owner.
//
// Security model: while NO working key is configured, the form is open —
// the only thing it accepts is a key that Groq itself validates, and the
// key is written server-side, never echoed back. Once a key exists the
// endpoint LOCKS and further changes require the ADMIN_KEY from .env.
require_once __DIR__ . '/_config.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

function setup_is_locked(): bool {
    return mm_provider_api_key('groq') !== '';
}

function setup_validate_groq(string $key): array {
    $ch = curl_init('https://api.groq.com/openai/v1/models');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $key],
        CURLOPT_TIMEOUT => 12,
        CURLOPT_CONNECTTIMEOUT => 8,
    ]);
    curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    if ($status === 200) return ['ok' => true, 'message' => 'Key verified with Groq ✓'];
    if ($status === 401) return ['ok' => false, 'message' => 'Groq rejected this key (401). Copy a fresh key from console.groq.com → API Keys.'];
    if ($status === 0) return ['ok' => false, 'message' => 'This server cannot reach api.groq.com (' . ($error ?: 'network blocked') . '). The key was NOT saved — hosting must allow outbound HTTPS first.'];
    return ['ok' => false, 'message' => 'Unexpected response from Groq (HTTP ' . $status . '). Key not saved.'];
}

/** Update or append KEY=value lines in the web-root .env (created if missing). */
function setup_write_env(array $pairs): array {
    $envPath = dirname(__DIR__) . DIRECTORY_SEPARATOR . '.env';
    $lines = is_file($envPath) ? (@file($envPath, FILE_IGNORE_NEW_LINES) ?: []) : [];
    foreach ($pairs as $name => $value) {
        $found = false;
        foreach ($lines as $i => $line) {
            if (preg_match('/^\s*' . preg_quote($name, '/') . '\s*=/', $line) === 1) {
                $lines[$i] = $name . '=' . $value;
                $found = true;
                break;
            }
        }
        if (!$found) {
            $lines[] = $name . '=' . $value;
        }
    }
    $content = implode("\n", $lines) . "\n";
    $written = @file_put_contents($envPath, $content, LOCK_EX);
    if ($written === false) {
        return ['ok' => false, 'message' => '.env is not writable by PHP. Manual fix: Hostinger File Manager → public_html → create/edit .env → add the line GROQ_API_KEY=your_key'];
    }
    @chmod($envPath, 0600);
    return ['ok' => true, 'message' => 'Saved to .env ✓'];
}

$notice = null;   // ['ok' => bool, 'message' => string]

if ($method === 'POST') {
    // Best-effort rate limit; never let a broken DB block the owner.
    try { mm_require_rate_limit('setup:' . mm_client_ip(), 10, 300); } catch (Throwable $e) { /* no DB — continue */ }

    $groqKey = trim((string) ($_POST['groq_key'] ?? ''));
    $adminKey = trim((string) ($_POST['admin_key'] ?? ''));

    if (setup_is_locked()) {
        $realAdmin = mm_env_value('ADMIN_KEY', '');
        if ($realAdmin === '' || !hash_equals($realAdmin, $adminKey)) {
            $notice = ['ok' => false, 'message' => 'A key is already configured — changes require the correct ADMIN_KEY (or edit .env directly on the server).'];
        }
    }

    if ($notice === null) {
        if ($groqKey === '' || strlen($groqKey) < 20) {
            $notice = ['ok' => false, 'message' => 'Paste a full Groq API key (starts with gsk_).'];
        } else {
            $check = setup_validate_groq($groqKey);
            if (!$check['ok']) {
                $notice = $check;
            } else {
                $pairs = ['GROQ_API_KEY' => $groqKey];
                foreach (['gemini_key' => 'GEMINI_API_KEY', 'openai_key' => 'OPENAI_API_KEY', 'anthropic_key' => 'ANTHROPIC_API_KEY'] as $field => $envName) {
                    $extra = trim((string) ($_POST[$field] ?? ''));
                    if ($extra !== '') {
                        $pairs[$envName] = $extra;
                    }
                }
                $write = setup_write_env($pairs);
                $notice = $write['ok']
                    ? ['ok' => true, 'message' => $check['message'] . ' · ' . $write['message'] . ' All four engines are live — try the chat!']
                    : $write;
            }
        }
    }
}

$locked = setup_is_locked();
header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex');
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>AI Engine Setup | Hungter</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/brand.css">
<style>
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
  .setup-card {
    width: min(560px, 100%);
    background: rgba(13, 20, 40, 0.85);
    border: 1px solid var(--border-glow);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 34px;
    backdrop-filter: blur(18px);
  }
  .setup-card h1 { font-size: 1.5rem; letter-spacing: -0.02em; margin: 0 0 6px; }
  .setup-card .sub { color: var(--ink-soft); font-size: 0.92rem; line-height: 1.6; margin: 0 0 22px; }
  label { display: block; font-family: var(--font-mono); font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-faint); margin: 16px 0 6px; }
  input {
    width: 100%; border: 1px solid var(--border); background: var(--surface-2); color: var(--ink);
    border-radius: 10px; padding: 12px 14px; font-family: var(--font-mono); font-size: 0.88rem;
  }
  input:focus { outline: none; border-color: var(--cyan); box-shadow: var(--glow-cyan); }
  button {
    width: 100%; margin-top: 22px; border: none; border-radius: 999px; padding: 14px;
    font-family: var(--font-display); font-weight: 700; font-size: 1rem;
    background: var(--gradient-brand); color: var(--bg-deep); cursor: pointer; box-shadow: var(--glow-lime);
  }
  .notice { border-radius: 12px; padding: 13px 16px; font-size: 0.9rem; line-height: 1.55; margin-bottom: 18px; }
  .notice.ok { color: var(--lime); background: rgba(200,255,77,0.08); border: 1px solid rgba(200,255,77,0.35); }
  .notice.bad { color: var(--coral); background: rgba(255,107,74,0.08); border: 1px solid rgba(255,107,74,0.35); }
  .steps { color: var(--ink-soft); font-size: 0.86rem; line-height: 1.7; margin: 0 0 6px; padding-left: 18px; }
  .foot { margin-top: 18px; display: flex; gap: 14px; font-size: 0.82rem; }
  .foot a { color: var(--cyan); }
  details { margin-top: 14px; }
  summary { cursor: pointer; color: var(--ink-faint); font-size: 0.82rem; }
</style>
</head>
<body>
  <main class="setup-card">
    <h1>🧠 AI Engine Setup</h1>
    <p class="sub"><?php echo $locked
      ? 'A Groq key is already configured on this server. Enter your ADMIN_KEY to replace it.'
      : 'The AI engines need a Groq API key on this server. Paste it below — it is verified with Groq, then written straight into this server\'s .env. It never leaves your site.'; ?></p>

    <?php if ($notice !== null): ?>
      <div class="notice <?php echo $notice['ok'] ? 'ok' : 'bad'; ?>"><?php echo htmlspecialchars($notice['message'], ENT_QUOTES); ?></div>
    <?php endif; ?>

    <?php if (!($notice['ok'] ?? false)): ?>
    <ol class="steps">
      <li>Open <strong>console.groq.com</strong> → API Keys → Create key (free)</li>
      <li>Copy the key (starts with <code>gsk_</code>) and paste it below</li>
    </ol>
    <form method="post" autocomplete="off">
      <label for="groq_key">Groq API key (required)</label>
      <input id="groq_key" name="groq_key" type="password" placeholder="gsk_…" required>
      <?php if ($locked): ?>
        <label for="admin_key">Admin key (required to change an existing key)</label>
        <input id="admin_key" name="admin_key" type="password" placeholder="ADMIN_KEY from .env">
      <?php endif; ?>
      <details>
        <summary>Optional: add Gemini / OpenAI / Anthropic keys too</summary>
        <label for="gemini_key">Gemini API key</label>
        <input id="gemini_key" name="gemini_key" type="password" placeholder="optional">
        <label for="openai_key">OpenAI API key</label>
        <input id="openai_key" name="openai_key" type="password" placeholder="optional">
        <label for="anthropic_key">Anthropic API key</label>
        <input id="anthropic_key" name="anthropic_key" type="password" placeholder="optional">
      </details>
      <button type="submit">Verify &amp; activate engines</button>
    </form>
    <?php endif; ?>

    <div class="foot">
      <a href="/api/diag">Run server self-check</a>
      <a href="/chat.html">Open chat</a>
    </div>
  </main>
</body>
</html>

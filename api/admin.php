<?php
// Owner analytics & control panel. Access: /api/admin.php with the
// ADMIN_KEY from .env. Shows live totals, revenue, and every user with
// their usage — and lets the owner change a user's plan.
require_once __DIR__ . '/_config.php';

$adminKey = mm_env_value('ADMIN_KEY', '');
$given = (string) ($_POST['key'] ?? ($_COOKIE['mm_admin'] ?? ''));
$authed = $adminKey !== '' && $given !== '' && hash_equals(hash('sha256', $adminKey), strlen($given) === 64 ? $given : hash('sha256', $given));

if ($authed && isset($_POST['key'])) {
    setcookie('mm_admin', hash('sha256', $adminKey), ['expires' => time() + 86400, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Strict']);
}

$actionMsg = '';
$db = null;
try { $db = mm_db(); } catch (Throwable $e) { $db = null; }

// Plan change action
if ($authed && isset($_POST['user_id'], $_POST['plan']) && $db !== null) {
    $plans = ['free' => 0.0, 'student' => 5.0, 'pro' => 12.0];
    $plan = strtolower(trim((string) $_POST['plan']));
    if (isset($plans[$plan])) {
        $stmt = $db->prepare("UPDATE users SET plan_name = :p, plan_price = :pr, plan_status = :st, plan_started = UTC_TIMESTAMP() WHERE id = :id");
        $stmt->execute([':p' => $plan === 'free' ? '' : ucfirst($plan), ':pr' => $plans[$plan], ':st' => $plan === 'free' ? 'inactive' : 'active', ':id' => (int) $_POST['user_id']]);
        $actionMsg = 'User #' . (int) $_POST['user_id'] . ' plan set to ' . $plan . '.';
    }
}

$summary = [];
$users = [];
$orders = [];
$revenue = ['orders' => 0.0, 'orderCount' => 0, 'mrr' => 0.0, 'payingUsers' => 0];
if ($db !== null) {
    try {
        $summary = mm_get_admin_summary();
        $users = $db->query("SELECT u.id, u.name, u.email, u.email_verified, u.plan_name, u.plan_price, u.plan_status, u.created_at,
              (SELECT COUNT(*) FROM chats c WHERE c.visitor_id = u.visitor_id) AS chat_count,
              (SELECT COALESCE(SUM(a.calls_used),0) FROM ai_usage_daily a WHERE a.user_id = u.id) AS ai_calls,
              (SELECT COALESCE(SUM(b.price),0) FROM book_orders b WHERE b.user_id = u.id OR b.email = u.email) AS book_spend
            FROM users u ORDER BY u.created_at DESC LIMIT 200")->fetchAll(PDO::FETCH_ASSOC);
        $row = $db->query("SELECT COALESCE(SUM(price),0) s, COUNT(*) c FROM book_orders")->fetch(PDO::FETCH_ASSOC);
        $revenue['orders'] = (float) $row['s'];
        $revenue['orderCount'] = (int) $row['c'];
        $row = $db->query("SELECT COALESCE(SUM(plan_price),0) s, COUNT(*) c FROM users WHERE plan_status = 'active' AND plan_price > 0")->fetch(PDO::FETCH_ASSOC);
        $revenue['mrr'] = (float) $row['s'];
        $revenue['payingUsers'] = (int) $row['c'];
        $orders = $db->query("SELECT order_ref, book_title, price, email, status, created_at FROM book_orders ORDER BY created_at DESC LIMIT 25")->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) { $actionMsg = 'DB query issue: ' . $e->getMessage(); }
}

function h($v) { return htmlspecialchars((string) $v, ENT_QUOTES); }
header('Content-Type: text/html; charset=utf-8');
header('X-Robots-Tag: noindex');
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex">
<title>Owner Panel | Hungter</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/brand.css">
<style>
  body { padding: 30px 20px 70px; }
  .ad-wrap { max-width: 1100px; margin: 0 auto; }
  .ad-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 20px 0; }
  .ad-stat { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 16px; }
  .ad-stat b { display: block; font-family: var(--font-display); font-size: 1.6rem; background: var(--gradient-brand); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .ad-stat span { font-family: var(--font-mono); font-size: 0.64rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-faint); }
  table { width: 100%; border-collapse: collapse; font-size: 0.84rem; margin: 12px 0 30px; }
  th, td { border: 1px solid var(--border); padding: 8px 10px; text-align: left; color: var(--ink-soft); }
  th { font-family: var(--font-mono); font-size: 0.64rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--lime); background: var(--surface-2); }
  .tbl-wrap { overflow-x: auto; }
  h1 { font-size: 1.6rem; letter-spacing: -0.02em; margin: 0 0 4px; }
  h2 { font-family: var(--font-display); font-size: 1.05rem; margin: 26px 0 4px; }
  input, select, button { border: 1px solid var(--border); background: var(--surface-2); color: var(--ink); border-radius: 8px; padding: 8px 10px; font-family: var(--font-body); }
  button { background: var(--gradient-brand); color: var(--bg-deep); border: none; font-weight: 700; cursor: pointer; }
  .msg { color: var(--lime); margin: 10px 0; }
  .warn { color: var(--coral); }
</style>
</head>
<body>
<div class="ad-wrap">
<?php if (!$authed): ?>
  <h1>🔐 Owner Panel</h1>
  <p style="color:var(--ink-soft)">Enter the ADMIN_KEY from this server's .env file.</p>
  <?php if ($adminKey === ''): ?><p class="warn">ADMIN_KEY is not set in .env — add a line like ADMIN_KEY=some-long-secret first.</p><?php endif; ?>
  <form method="post" style="display:flex;gap:10px;max-width:420px;margin-top:14px;">
    <input type="password" name="key" placeholder="ADMIN_KEY" style="flex:1;" required>
    <button type="submit">Unlock</button>
  </form>
<?php else: ?>
  <h1>📊 Hungter Owner Panel</h1>
  <p style="color:var(--ink-faint);font-family:var(--font-mono);font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;">Live data · <?php echo h(gmdate('Y-m-d H:i')); ?> UTC</p>
  <?php if ($actionMsg !== ''): ?><p class="msg"><?php echo h($actionMsg); ?></p><?php endif; ?>
  <?php if ($db === null): ?><p class="warn">Database is not reachable — stats and users need MySQL configured in .env.</p><?php endif; ?>

  <div class="ad-grid">
    <div class="ad-stat"><b>$<?php echo number_format($revenue['orders'] + 0, 2); ?></b><span>Book revenue (<?php echo (int) $revenue['orderCount']; ?> orders)</span></div>
    <div class="ad-stat"><b>$<?php echo number_format($revenue['mrr'], 2); ?></b><span>Subscription MRR (<?php echo (int) $revenue['payingUsers']; ?> paying)</span></div>
    <div class="ad-stat"><b><?php echo (int) ($summary['totalVisitors'] ?? 0); ?></b><span>Total visitors</span></div>
    <div class="ad-stat"><b><?php echo (int) ($summary['activeNow'] ?? 0); ?></b><span>Active now</span></div>
    <div class="ad-stat"><b><?php echo (int) ($summary['dailyActiveUsers'] ?? 0); ?></b><span>Active today</span></div>
    <div class="ad-stat"><b><?php echo (int) ($summary['totalChats'] ?? 0); ?></b><span>Total chats (<?php echo (int) ($summary['chatsToday'] ?? 0); ?> today)</span></div>
  </div>

  <h2>👥 Users (<?php echo count($users); ?>) — revenue &amp; usage per user</h2>
  <div class="tbl-wrap"><table>
    <tr><th>ID</th><th>Name</th><th>Email</th><th>Verified</th><th>Plan</th><th>Plan $</th><th>Book $</th><th>Chats</th><th>AI calls</th><th>Joined</th><th>Set plan</th></tr>
    <?php foreach ($users as $u): ?>
    <tr>
      <td><?php echo (int) $u['id']; ?></td>
      <td><?php echo h($u['name']); ?></td>
      <td><?php echo h($u['email']); ?></td>
      <td><?php echo $u['email_verified'] ? '✓' : '—'; ?></td>
      <td><?php echo h($u['plan_name'] ?: 'Free'); ?> <?php echo h($u['plan_status'] === 'active' ? '·active' : ''); ?></td>
      <td>$<?php echo number_format((float) $u['plan_price'], 2); ?></td>
      <td>$<?php echo number_format((float) $u['book_spend'], 2); ?></td>
      <td><?php echo (int) $u['chat_count']; ?></td>
      <td><?php echo (int) $u['ai_calls']; ?></td>
      <td><?php echo h(substr((string) $u['created_at'], 0, 10)); ?></td>
      <td>
        <form method="post" style="display:flex;gap:6px;">
          <input type="hidden" name="user_id" value="<?php echo (int) $u['id']; ?>">
          <select name="plan"><option value="free">Free</option><option value="student">Student $5</option><option value="pro">Pro $12</option></select>
          <button type="submit">Save</button>
        </form>
      </td>
    </tr>
    <?php endforeach; ?>
    <?php if (count($users) === 0): ?><tr><td colspan="11">No registered users yet.</td></tr><?php endif; ?>
  </table></div>

  <h2>🛒 Recent book orders</h2>
  <div class="tbl-wrap"><table>
    <tr><th>Ref</th><th>Book</th><th>Price</th><th>Email</th><th>Status</th><th>Date</th></tr>
    <?php foreach ($orders as $o): ?>
    <tr><td><?php echo h($o['order_ref']); ?></td><td><?php echo h($o['book_title']); ?></td><td>$<?php echo number_format((float) $o['price'], 2); ?></td><td><?php echo h($o['email']); ?></td><td><?php echo h($o['status']); ?></td><td><?php echo h(substr((string) $o['created_at'], 0, 16)); ?></td></tr>
    <?php endforeach; ?>
    <?php if (count($orders) === 0): ?><tr><td colspan="6">No orders yet.</td></tr><?php endif; ?>
  </table></div>

  <h2>📚 Top subjects</h2>
  <div class="tbl-wrap"><table>
    <tr><th>Subject</th><th>Chats</th></tr>
    <?php foreach (($summary['topSubjects'] ?? []) as $s): ?>
    <tr><td><?php echo h($s['subject']); ?></td><td><?php echo (int) $s['count']; ?></td></tr>
    <?php endforeach; ?>
  </table></div>

  <p style="color:var(--ink-faint);font-size:0.8rem;">Server checks: <a href="/api/diag.php" style="color:var(--cyan)">/api/diag.php</a> · Key setup: <a href="/api/setup.php" style="color:var(--cyan)">/api/setup.php</a></p>
<?php endif; ?>
</div>
</body>
</html>

<?php
// Visit https://hungter.com/api/clear-cache.php once after a deploy to force
// PHP to run the newest code. Hostinger (LiteSpeed/PHP) caches compiled PHP in
// OPcache, so freshly deployed .php files can keep running the old version
// until the cache is cleared. This file is new on each deploy, so it always
// runs fresh and can reset the cache for everything else.
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');

$out = [];
if (function_exists('opcache_reset')) {
    $out[] = @opcache_reset() ? 'OPcache: cleared ✓' : 'OPcache: reset returned false (may be disabled)';
} else {
    $out[] = 'OPcache: not enabled (nothing to clear)';
}

// Also drop any cached Google Analytics token/report snapshots.
$cleared = 0;
foreach (@glob(sys_get_temp_dir() . '/hungter_ga_*') ?: [] as $f) { @unlink($f); $cleared++; }
$out[] = 'Cleared ' . $cleared . ' cached analytics snapshot(s).';

$out[] = '';
$out[] = 'Done. Reload admin.hungter.com → Analytics — it now runs the latest code.';
echo implode("\n", $out) . "\n";

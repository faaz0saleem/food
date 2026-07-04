const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 15;

function emptyStats() {
  return {
    visitors: {},
    dailyChats: {},
    subjects: {},
    totalChats: 0,
    rateLimits: {},
  };
}

// Sliding-window cap on chat requests per visitor, to protect against a runaway
// bug or bad actor burning through metered AI API spend. Not a security boundary
// (visitorId is client-supplied) — just a cheap backstop against accidental abuse.
function checkAndRecordRateLimit(stats, visitorId, now = Date.now()) {
  if (!stats.rateLimits) stats.rateLimits = {};
  if (!visitorId) return { allowed: true };

  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const recent = (stats.rateLimits[visitorId] || []).filter((ts) => ts > windowStart);

  if (recent.length >= RATE_LIMIT_MAX) {
    stats.rateLimits[visitorId] = recent;
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - recent[0]);
    return { allowed: false, retryAfterMs: Math.max(1000, retryAfterMs) };
  }

  recent.push(now);
  stats.rateLimits[visitorId] = recent;
  return { allowed: true };
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function touchVisitor(stats, visitorId, now = Date.now()) {
  if (!visitorId) return;
  const existing = stats.visitors[visitorId];
  stats.visitors[visitorId] = { first: existing?.first ?? now, last: now };
}

function recordVisit(stats, visitorId) {
  touchVisitor(stats, visitorId);
}

function recordChat(stats, visitorId, subject) {
  const now = Date.now();
  touchVisitor(stats, visitorId, now);
  const key = todayKey(new Date(now));
  stats.dailyChats[key] = (stats.dailyChats[key] || 0) + 1;
  stats.totalChats = (stats.totalChats || 0) + 1;
  if (subject) {
    stats.subjects[subject] = (stats.subjects[subject] || 0) + 1;
  }
}

function summarize(stats) {
  const now = Date.now();
  const today = todayKey();
  const month = monthKey();
  const visitors = Object.values(stats.visitors || {});

  const activeNow = visitors.filter((v) => now - v.last <= ACTIVE_WINDOW_MS).length;
  const dailyActiveUsers = visitors.filter((v) => todayKey(new Date(v.last)) === today).length;
  const monthlyActiveUsers = visitors.filter((v) => monthKey(new Date(v.last)) === month).length;

  const dailyChats = stats.dailyChats || {};
  const chatsToday = dailyChats[today] || 0;
  const chatsThisMonth = Object.entries(dailyChats)
    .filter(([day]) => day.startsWith(month))
    .reduce((sum, [, count]) => sum + count, 0);

  const topSubjects = Object.entries(stats.subjects || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([subject, count]) => ({ subject, count }));

  return {
    totalVisitors: visitors.length,
    activeNow,
    dailyActiveUsers,
    monthlyActiveUsers,
    totalChats: stats.totalChats || 0,
    chatsToday,
    chatsThisMonth,
    topSubjects,
  };
}

module.exports = {
  emptyStats,
  todayKey,
  monthKey,
  recordVisit,
  recordChat,
  summarize,
  checkAndRecordRateLimit,
};

function emptyStats() {
  return {
    visitors: {},
    dailyChats: {},
    subjects: {},
    totalChats: 0,
    rateLimits: {},
    purchases: {},
  };
}

function ensureStatsShape(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    visitors: input.visitors && typeof input.visitors === 'object' ? input.visitors : {},
    dailyChats: input.dailyChats && typeof input.dailyChats === 'object' ? input.dailyChats : {},
    subjects: input.subjects && typeof input.subjects === 'object' ? input.subjects : {},
    totalChats: Number(input.totalChats || 0),
    rateLimits: input.rateLimits && typeof input.rateLimits === 'object' ? input.rateLimits : {},
    purchases: input.purchases && typeof input.purchases === 'object' ? input.purchases : {},
  };
}

function isoDay(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function isoMonth(ts) {
  return new Date(ts).toISOString().slice(0, 7);
}

function touchVisitor(stats, visitorId, ts = Date.now()) {
  if (!visitorId) return;
  const shape = ensureStatsShape(stats);
  const existing = shape.visitors[visitorId] || {};
  shape.visitors[visitorId] = {
    first: Number(existing.first || ts),
    last: ts,
  };
  Object.assign(stats, shape);
}

function recordVisit(stats, visitorId, ts = Date.now()) {
  touchVisitor(stats, visitorId, ts);
}

function recordChat(stats, visitorId, subject, ts = Date.now()) {
  const shape = ensureStatsShape(stats);
  touchVisitor(shape, visitorId, ts);
  const dayKey = isoDay(ts);
  shape.dailyChats[dayKey] = Number(shape.dailyChats[dayKey] || 0) + 1;
  shape.totalChats = Number(shape.totalChats || 0) + 1;
  if (subject) {
    shape.subjects[subject] = Number(shape.subjects[subject] || 0) + 1;
  }
  Object.assign(stats, shape);
}

function recordPurchaseIntent(stats, data) {
  const shape = ensureStatsShape(stats);
  const sessionId = String(data?.sessionId || data?.basketId || '').trim();
  if (!sessionId) {
    Object.assign(stats, shape);
    return;
  }
  const existing = shape.purchases[sessionId] || {};
  shape.purchases[sessionId] = {
    ...existing,
    ...data,
    updatedAt: new Date().toISOString(),
    createdAt: existing.createdAt || new Date().toISOString(),
  };
  Object.assign(stats, shape);
}

function recordPurchaseStatus(stats, sessionId, status, rawSession) {
  const shape = ensureStatsShape(stats);
  const key = String(sessionId || '').trim();
  if (!key) {
    Object.assign(stats, shape);
    return;
  }
  const existing = shape.purchases[key] || {};
  shape.purchases[key] = {
    ...existing,
    status: String(status || existing.status || 'UNKNOWN'),
    rawSession: rawSession || existing.rawSession || null,
    updatedAt: new Date().toISOString(),
    createdAt: existing.createdAt || new Date().toISOString(),
  };
  Object.assign(stats, shape);
}

function checkAndRecordRateLimit(stats, visitorId, windowMs = 60_000, max = 20) {
  const shape = ensureStatsShape(stats);
  const key = String(visitorId || 'anon').trim() || 'anon';
  const now = Date.now();
  const history = Array.isArray(shape.rateLimits[key]) ? shape.rateLimits[key] : [];
  const kept = history.filter((ts) => now - Number(ts) < windowMs);
  if (kept.length >= max) {
    const retryAfterMs = Math.max(1000, windowMs - (now - Number(kept[0] || now)));
    shape.rateLimits[key] = kept;
    Object.assign(stats, shape);
    return { allowed: false, retryAfterMs };
  }
  kept.push(now);
  shape.rateLimits[key] = kept;
  Object.assign(stats, shape);
  return { allowed: true, retryAfterMs: 0 };
}

function summarize(stats) {
  const shape = ensureStatsShape(stats);
  const now = Date.now();
  const day = isoDay(now);
  const month = isoMonth(now);
  const visitors = Object.values(shape.visitors || {});

  const dau = visitors.filter((entry) => isoDay(Number(entry.last || 0)) === day).length;
  const mau = visitors.filter((entry) => isoMonth(Number(entry.last || 0)) === month).length;
  const activeNow = visitors.filter((entry) => now - Number(entry.last || 0) <= 5 * 60 * 1000).length;

  return {
    totalVisitors: visitors.length,
    totalChats: Number(shape.totalChats || 0),
    chatsToday: Number(shape.dailyChats[day] || 0),
    dau,
    mau,
    activeNow,
    topSubjects: Object.entries(shape.subjects || {})
      .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
      .slice(0, 10)
      .map(([subject, count]) => ({ subject, count: Number(count || 0) })),
  };
}

module.exports = {
  emptyStats,
  ensureStatsShape,
  recordVisit,
  recordChat,
  recordPurchaseIntent,
  recordPurchaseStatus,
  summarize,
  checkAndRecordRateLimit,
};
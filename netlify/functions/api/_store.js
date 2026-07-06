const { getStore } = require('@netlify/blobs');
const {
  emptyStats,
  recordVisit,
  recordChat,
  recordPurchaseIntent,
  recordPurchaseStatus,
  summarize,
  checkAndRecordRateLimit,
} = require('../../../stats-core');

const STORE_NAME = 'hungter-stats';
const KEY = 'stats';
const memoryState = global.__hungterStatsMemory || { stats: emptyStats() };
global.__hungterStatsMemory = memoryState;
let warnedBlobUnavailable = false;

function getBlobStore() {
  try {
    return getStore(STORE_NAME);
  } catch (error) {
    if (!warnedBlobUnavailable) {
      warnedBlobUnavailable = true;
      console.warn('Netlify Blobs unavailable, using in-memory stats fallback:', error.message);
    }
    return null;
  }
}

async function loadStats() {
  const store = getBlobStore();
  if (!store) return memoryState.stats;

  try {
    const data = await store.get(KEY, { type: 'json' });
    const resolved = data || emptyStats();
    memoryState.stats = resolved;
    return resolved;
  } catch (error) {
    if (!warnedBlobUnavailable) {
      warnedBlobUnavailable = true;
      console.warn('Netlify Blobs read failed, using in-memory stats fallback:', error.message);
    }
    return memoryState.stats;
  }
}

async function saveStats(stats) {
  memoryState.stats = stats;
  const store = getBlobStore();
  if (!store) return;

  try {
    await store.setJSON(KEY, stats);
  } catch (error) {
    if (!warnedBlobUnavailable) {
      warnedBlobUnavailable = true;
      console.warn('Netlify Blobs write failed, using in-memory stats fallback:', error.message);
    }
  }
}

async function trackVisit(visitorId) {
  const stats = await loadStats();
  recordVisit(stats, visitorId);
  await saveStats(stats);
  return stats;
}

async function trackChat(visitorId, subject) {
  const stats = await loadStats();
  recordChat(stats, visitorId, subject);
  await saveStats(stats);
  return stats;
}

async function checkRateLimit(visitorId) {
  const stats = await loadStats();
  const result = checkAndRecordRateLimit(stats, visitorId);
  await saveStats(stats);
  return result;
}

async function trackPurchaseCreated(data) {
  const stats = await loadStats();
  recordPurchaseIntent(stats, data || {});
  await saveStats(stats);
  return stats;
}

async function trackPurchaseStatusChanged(sessionId, status, rawSession) {
  const stats = await loadStats();
  recordPurchaseStatus(stats, sessionId, status, rawSession);
  await saveStats(stats);
  return stats;
}

module.exports = {
  loadStats,
  trackVisit,
  trackChat,
  trackPurchaseCreated,
  trackPurchaseStatusChanged,
  summarize,
  checkRateLimit,
};

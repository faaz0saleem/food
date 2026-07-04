const { getStore } = require('@netlify/blobs');
const { emptyStats, recordVisit, recordChat, summarize, checkAndRecordRateLimit } = require('../../../stats-core');

const STORE_NAME = 'mindmesh-stats';
const KEY = 'stats';

function getBlobStore() {
  return getStore(STORE_NAME);
}

async function loadStats() {
  const store = getBlobStore();
  const data = await store.get(KEY, { type: 'json' });
  return data || emptyStats();
}

async function saveStats(stats) {
  const store = getBlobStore();
  await store.setJSON(KEY, stats);
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

module.exports = { loadStats, trackVisit, trackChat, summarize, checkRateLimit };

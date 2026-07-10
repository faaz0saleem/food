const { config } = require('dotenv');
config();

const { trackChat, checkRateLimit } = require('./_store');
const { routeChat } = require('../../../engines');

// Simple per-function rate limiter stored on the global to survive warm starts
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 60 * 1000);
const RATE_MAX = Number(process.env.RATE_MAX || 20);
const rateMap = global.__netlifyRateMap || new Map();
global.__netlifyRateMap = rateMap;

function getClientIpFromEvent(event) {
  const headers = event.headers || {};
  const xf = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
  if (xf) return xf.split(',')[0].trim();
  return headers['x-nf-client-connection-ip'] || headers['client-ip'] || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  if (entry.count > RATE_MAX) return true;
  return false;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const ip = getClientIpFromEvent(event);
    if (isRateLimited(ip)) {
      return {
        statusCode: 429,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Rate limit exceeded' }),
      };
    }
    const payload = JSON.parse(event.body || '{}');
    const message = (payload.message || '').trim();
    const subject = payload.subject || 'General';
    const userLevel = payload.userLevel || 'Newbie';
    const learningStyle = payload.learningStyle;
    const visitorId = payload.visitorId || '';

    if (!message) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'A message is required.' }),
      };
    }

    const rateLimit = await checkRateLimit(visitorId);
    if (!rateLimit.allowed) {
      return {
        statusCode: 429,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: "You're sending messages too quickly. Please wait a moment and try again.",
          retryAfterMs: rateLimit.retryAfterMs,
        }),
      };
    }

    trackChat(visitorId, subject).catch((error) => console.error('Chat tracking failed:', error.message));

    const { reply, engine, model } = await routeChat({
      message,
      subject,
      learningStyle,
      userLevel,
      excludeEngine: payload.excludeEngine || null,
      history: Array.isArray(payload.history) ? payload.history : [],
      attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok', reply, engine, model }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Chat request failed' }),
    };
  }
};

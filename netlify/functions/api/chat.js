const { config } = require('dotenv');
config();

const { trackChat, checkRateLimit } = require('./_store');
const { routeChat } = require('../../../engines');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
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

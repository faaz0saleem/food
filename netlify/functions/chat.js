const { config } = require('dotenv');
config();

const Groq = require('groq-sdk');

const DEFAULT_MODEL = process.env.GROQ_MODEL || process.env.GROQ_MODEL_NAME || 'llama-3.3-70b-versatile';
const client = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

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

    if (!message) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'A message is required.' }),
      };
    }

    if (!client) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'ok',
          reply: `Demo mode answer for ${subject}: Keep practicing and review one concept at a time to master it!`,
          model: DEFAULT_MODEL,
        }),
      };
    }

    const systemPrompt = `You are an expert learning assistant helping a student who is at the "${userLevel}" level study ${subject || 'general topics'}. Keep responses concise and encouraging.`;

    const response = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      max_tokens: 256,
      temperature: 0.7,
    });

    const reply = response.choices?.[0]?.message?.content?.trim() || 'I could not generate a response.';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok', reply, model: DEFAULT_MODEL }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Chat request failed' }),
    };
  }
};

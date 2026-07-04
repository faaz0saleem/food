const { config } = require('dotenv');
config();

const Groq = require('groq-sdk');

const DEFAULT_MODEL = process.env.GROQ_MODEL || process.env.GROQ_MODEL_NAME || 'llama-3.3-70b-versatile';
const client = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 60 * 1000);
const RATE_MAX = Number(process.env.RATE_MAX || 20);
const rateMap = global.__netlifyQuizQuestionRateMap || new Map();
global.__netlifyQuizQuestionRateMap = rateMap;

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
  return entry.count > RATE_MAX;
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/(\[.*\])/s);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }
}

function getDemoQuestion(subject) {
  return {
    question: `What is the most important idea in ${subject}?`,
    options: [
      'A) It helps people solve problems',
      'B) It is only interesting for experts',
      'C) It cannot be used in real life',
      'D) It is always boring',
    ],
    correct: 'A',
    explanation: `The best answer is A because ${subject} is useful for real-world thinking and problem solving.`,
  };
}

async function generateQuizQuestion(subject) {
  if (!client) {
    return getDemoQuestion(subject);
  }

  try {
    const prompt = `Generate 1 multiple choice question for a student learning ${subject}. Return ONLY valid JSON in this exact format: [{\"question\": \"...\",\"options\": [\"A)...\",\"B)...\",\"C)...\",\"D)...\"],\"correct\":\"A\",\"explanation\":\"...\"}]`;

    const response = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: 'You are a quiz generator. Only output valid JSON.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 600,
    });

    const content = response.choices?.[0]?.message?.content || '';
    const parsed = parseJsonSafe(content);
    if (Array.isArray(parsed) && parsed[0]) {
      return parsed[0];
    }
    return getDemoQuestion(subject);
  } catch {
    return getDemoQuestion(subject);
  }
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
    const subject = payload.subject || 'Math';
    const question = await generateQuizQuestion(subject);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(question),
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Quiz question request failed' }),
    };
  }
};

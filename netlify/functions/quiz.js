const { config } = require('dotenv');
config();

const Groq = require('groq-sdk');

const DEFAULT_MODEL = process.env.GROQ_MODEL || process.env.GROQ_MODEL_NAME || 'llama-3.3-70b-versatile';
const client = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 60 * 1000);
const RATE_MAX = Number(process.env.RATE_MAX || 20);
const rateMap = global.__netlifyQuizRateMap || new Map();
global.__netlifyQuizRateMap = rateMap;

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

function getDemoQuiz(subject, count = 5) {
  const item = {
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

  return Array.from({ length: count }, () => ({ ...item }));
}

async function generateQuiz(subject, count = 5, askedQuestions = []) {
  if (!client) {
    return getDemoQuiz(subject, count);
  }

  const filteredAsked = Array.isArray(askedQuestions)
    ? askedQuestions.filter((item) => typeof item === 'string' && item.trim().length > 5)
    : [];

  try {
    const prompt = `Generate ${count} multiple choice questions for a student learning ${subject}. Avoid repeating any questions the student has already answered. Previously asked questions: ${filteredAsked.slice(-20).join(' | ')}. Return ONLY valid JSON in this exact format: [{\"question\": \"...\",\"options\": [\"A)...\",\"B)...\",\"C)...\",\"D)...\"],\"correct\":\"A\",\"explanation\":\"...\"}]`;

    const response = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: 'You are a quiz generator. Only output valid JSON.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1024,
    });

    const content = response.choices?.[0]?.message?.content || '';
    const parsed = parseJsonSafe(content);
    const data = Array.isArray(parsed) ? parsed : [];
    const unique = data.filter((item) => {
      if (!item || typeof item.question !== 'string') return false;
      const questionText = item.question.trim().toLowerCase();
      return !filteredAsked.some((asked) => {
        const askedText = asked.trim().toLowerCase();
        return questionText.includes(askedText) || askedText.includes(questionText);
      });
    });

    if (unique.length >= count) {
      return unique.slice(0, count);
    }

    return unique.concat(getDemoQuiz(subject, count)).slice(0, count);
  } catch {
    return getDemoQuiz(subject, count);
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
    const count = Math.max(1, Math.min(50, Number(payload.count) || 5));
    const askedQuestions = Array.isArray(payload.askedQuestions) ? payload.askedQuestions : [];

    const questions = await generateQuiz(subject, count, askedQuestions);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(questions),
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Quiz request failed' }),
    };
  }
};

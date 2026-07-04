require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Groq = require('groq-sdk');
const statsCore = require('./stats-core');
const { routeChat, getEngineAvailability } = require('./engines');
const { createRapidPayCheckoutSession, getRapidPayCheckoutSessionStatus } = require('./rapidpay');

const port = process.env.PORT || 3000;
const rootDir = __dirname;
const statsFile = path.join(rootDir, 'stats.json');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const DEFAULT_MODEL = process.env.GROQ_MODEL || process.env.GROQ_MODEL_NAME || 'llama-3.3-70b-versatile';
const MODEL_LABEL = process.env.GROQ_MODEL_LABEL || DEFAULT_MODEL;

// Simple in-memory rate limiter (per-IP)
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 60 * 1000);
const RATE_MAX = Number(process.env.RATE_MAX || 20);
const rateMap = new Map(); // ip -> {count, windowStart}
const ADMIN_AUTH_WINDOW_MS = Number(process.env.ADMIN_AUTH_WINDOW_MS || 10 * 60 * 1000);
const ADMIN_AUTH_MAX_FAILURES = Number(process.env.ADMIN_AUTH_MAX_FAILURES || 8);
const adminAuthMap = new Map(); // ip -> {count, blockedUntil, windowStart}
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return xf.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
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

let groqClient = null;
if (process.env.GROQ_API_KEY) {
  groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath);
    const contentType = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
    }[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function loadStats() {
  try {
    const contents = fs.readFileSync(statsFile, 'utf8');
    const parsed = JSON.parse(contents);
    if (!parsed || typeof parsed.visitors !== 'object') {
      return statsCore.emptyStats();
    }
    return parsed;
  } catch {
    return statsCore.emptyStats();
  }
}

function saveStats() {
  fs.writeFile(statsFile, JSON.stringify(visitorStats, null, 2), (error) => {
    if (error) {
      console.error('Unable to save stats:', error.message);
    }
  });
}

function getStatusSummary() {
  return { ...statsCore.summarize(visitorStats), model: MODEL_LABEL };
}

function registerVisitor(visitorId) {
  if (visitorId) {
    statsCore.recordVisit(visitorStats, visitorId);
    saveStats();
  }
  return getStatusSummary();
}

function recordChatEvent(visitorId, subject) {
  statsCore.recordChat(visitorStats, visitorId, subject);
  saveStats();
}

function recordPurchaseCreated(data) {
  statsCore.recordPurchaseIntent(visitorStats, data || {});
  saveStats();
}

function recordPurchaseStatusChanged(sessionId, status, rawSession) {
  statsCore.recordPurchaseStatus(visitorStats, sessionId, status, rawSession);
  saveStats();
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/(\[.*\])/s);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function getCorsOrigin(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return '';
  if (!ALLOWED_ORIGINS.length) return origin;
  return ALLOWED_ORIGINS.includes(origin) ? origin : '';
}

function timingSafeEqualString(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isAdminAuthBlocked(ip) {
  const now = Date.now();
  const entry = adminAuthMap.get(ip);
  if (!entry) return false;
  if (entry.blockedUntil && entry.blockedUntil > now) return true;
  if (now - entry.windowStart > ADMIN_AUTH_WINDOW_MS) {
    adminAuthMap.set(ip, { count: 0, blockedUntil: 0, windowStart: now });
    return false;
  }
  return false;
}

function recordAdminAuthFailure(ip) {
  const now = Date.now();
  const entry = adminAuthMap.get(ip) || { count: 0, blockedUntil: 0, windowStart: now };
  if (now - entry.windowStart > ADMIN_AUTH_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
    entry.blockedUntil = 0;
  }

  entry.count += 1;
  if (entry.count >= ADMIN_AUTH_MAX_FAILURES) {
    const multiplier = Math.max(1, entry.count - ADMIN_AUTH_MAX_FAILURES + 1);
    entry.blockedUntil = now + multiplier * 60 * 1000;
  }
  adminAuthMap.set(ip, entry);
}

function clearAdminAuthFailures(ip) {
  adminAuthMap.delete(ip);
}

function getDemoQuiz(subject, count = 5) {
  const guaranteed = [
    {
      question: `What is the most important idea in ${subject}?`,
      options: ['A) It helps people solve problems', 'B) It is only interesting for experts', 'C) It cannot be used in real life', 'D) It is always boring'],
      correct: 'A',
      explanation: `The best answer is A because ${subject} is useful for real-world thinking and problem solving.`,
    },
  ];
  const result = [];
  for (let i = 0; i < count; i += 1) {
    const item = guaranteed[0];
    result.push({
      question: item.question,
      options: item.options,
      correct: item.correct,
      explanation: item.explanation,
    });
  }
  return result;
}

async function generateQuiz(subject, count = 5, askedQuestions = []) {
  if (!groqClient) {
    return getDemoQuiz(subject, count);
  }

  const filteredAsked = Array.isArray(askedQuestions)
    ? askedQuestions.filter((item) => typeof item === 'string' && item.trim().length > 5)
    : [];

  try {
    const prompt = `Generate ${count} multiple choice questions for a student learning ${subject}. Avoid repeating any questions the student has already answered. Previously asked questions: ${filteredAsked.slice(-20).join(' | ')}. Return ONLY valid JSON in this exact format: [{"question": "...","options": ["A)...","B)...","C)...","D)..."],"correct":"A","explanation":"..."}]`;
    const response = await groqClient.chat.completions.create({
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
    const fallback = getDemoQuiz(subject, count);
    return unique.concat(fallback).slice(0, count);
  } catch (error) {
    console.error('Quiz generation failed:', error.message);
    return getDemoQuiz(subject, count);
  }
}

async function generateQuizQuestion(subject) {
  const questions = await generateQuiz(subject, 1);
  if (!questions.length) {
    return {
      question: `Which prompt best describes ${subject}?`,
      options: ['A) A fun topic', 'B) A topic with no meaning', 'C) A subject to avoid', 'D) A field only for experts'],
      correct: 'A',
      explanation: `Answer A because ${subject} is meant to help learners grow.`,
    };
  }
  return questions[0];
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const visitorStats = loadStats();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const corsOrigin = getCorsOrigin(req);

  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'GET') {
    if (pathname === '/' || pathname === '/index.html') {
      sendFile(res, path.join(rootDir, 'index.html'));
      return;
    }

    const cleanedPath = path.normalize(pathname).replace(/^\.{2,}(?:[\/\\]|$)/, '');
    const requestedPath = cleanedPath.slice(1);
    const filePath = path.join(rootDir, requestedPath);
    const requestedExt = path.extname(filePath).toLowerCase();
    const allowedStaticExtensions = ['.css', '.js', '.png', '.svg', '.ico', '.json'];

    if (requestedPath && allowedStaticExtensions.includes(requestedExt)) {
      sendFile(res, filePath);
      return;
    }

    if (pathname.endsWith('.html')) {
      sendFile(res, filePath);
      return;
    }

    if (pathname === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (pathname === '/api/status') {
      sendJson(res, 200, { status: 'ok', model: MODEL_LABEL, engines: getEngineAvailability(), stats: getStatusSummary() });
      return;
    }

    if (pathname === '/api/admin-stats') {
      const clientIp = getClientIp(req);
      if (isAdminAuthBlocked(clientIp)) {
        sendJson(res, 429, { error: 'Too many failed admin authentication attempts. Try again later.' });
        return;
      }

      const providedKey = req.headers['x-admin-key'] || url.searchParams.get('key') || '';
      if (!ADMIN_KEY || !timingSafeEqualString(providedKey, ADMIN_KEY)) {
        recordAdminAuthFailure(clientIp);
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }
      clearAdminAuthFailures(clientIp);
      sendJson(res, 200, {
        ...statsCore.summarize(visitorStats),
      });
      return;
    }

    if (pathname === '/api/payments/checkout-session') {
      try {
        const sessionId = url.searchParams.get('sessionId') || '';
        const session = await getRapidPayCheckoutSessionStatus(sessionId);
        recordPurchaseStatusChanged(sessionId, session?.status, session);
        sendJson(res, 200, { status: 'ok', session });
      } catch (error) {
        sendJson(res, 400, { error: error.message || 'Payment status lookup failed' });
      }
      return;
    }
  }

  if (req.method === 'OPTIONS') {
    if (String(req.headers.origin || '').trim() && !corsOrigin) {
      sendJson(res, 403, { error: 'Origin not allowed' });
      return;
    }

    res.writeHead(204, {
      'Access-Control-Allow-Origin': corsOrigin || 'null',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Key',
    });
    res.end();
    return;
  }

  if (req.method === 'POST' && pathname === '/api/visit') {
    try {
      const clientIp = getClientIp(req);
      if (isRateLimited(clientIp)) {
        sendJson(res, 429, { error: 'Rate limit exceeded' });
        return;
      }
      const payload = await parseRequestBody(req);
      const summary = registerVisitor(payload.visitorId);
      sendJson(res, 200, { status: 'ok', stats: summary });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/chat') {
    try {
      const clientIp = getClientIp(req);
      if (isRateLimited(clientIp)) {
        sendJson(res, 429, { error: 'Rate limit exceeded' });
        return;
      }
      const payload = await parseRequestBody(req);
      const visitorId = payload.visitorId;
      const message = (payload.message || '').trim();
      const subject = payload.subject || 'General';
      const userLevel = payload.userLevel || 'Newbie';
      if (!message) {
        sendJson(res, 400, { error: 'A message is required.' });
        return;
      }
      const rateLimit = statsCore.checkAndRecordRateLimit(visitorStats, visitorId);
      if (!rateLimit.allowed) {
        sendJson(res, 429, {
          error: "You're sending messages too quickly. Please wait a moment and try again.",
          retryAfterMs: rateLimit.retryAfterMs,
        });
        return;
      }
      recordChatEvent(visitorId, subject);
      const learningStyle = payload.learningStyle;
      const { reply, engine, model } = await routeChat({ message, subject, learningStyle, userLevel });
      sendJson(res, 200, { status: 'ok', reply, engine, model: model || MODEL_LABEL, stats: getStatusSummary() });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/quiz-question') {
    try {
      const clientIp = getClientIp(req);
      if (isRateLimited(clientIp)) {
        sendJson(res, 429, { error: 'Rate limit exceeded' });
        return;
      }
      const payload = await parseRequestBody(req);
      const subject = payload.subject || 'Math';
      const question = await generateQuizQuestion(subject);
      sendJson(res, 200, question);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/quiz') {
    try {
      const clientIp = getClientIp(req);
      if (isRateLimited(clientIp)) {
        sendJson(res, 429, { error: 'Rate limit exceeded' });
        return;
      }
      const payload = await parseRequestBody(req);
      const subject = payload.subject || 'Math';
      const count = Number(payload.count) || 5;
      const askedQuestions = Array.isArray(payload.askedQuestions) ? payload.askedQuestions : [];
      const questions = await generateQuiz(subject, count, askedQuestions);
      sendJson(res, 200, questions);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/payments/checkout-session') {
    try {
      const payload = await parseRequestBody(req);
      const result = await createRapidPayCheckoutSession({
        planId: payload.plan,
        customerEmail: payload.customerEmail,
        customerMobile: payload.customerMobile,
      });
      recordPurchaseCreated({
        sessionId: result.sessionId,
        basketId: result.basketId,
        planId: result.plan?.id,
        customerEmail: payload.customerEmail,
        customerMobile: payload.customerMobile,
        amount: result.amount,
        currency: result.currency,
        status: 'CREATED',
        provider: 'RapidPay',
      });
      sendJson(res, 200, { status: 'ok', ...result });
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'Payment session creation failed' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/payments/webhook') {
    try {
      const webhookToken = process.env.RAPIDPAY_WEBHOOK_TOKEN || '';
      if (!webhookToken) {
        sendJson(res, 501, { error: 'Webhook not configured. Set RAPIDPAY_WEBHOOK_TOKEN.' });
        return;
      }

      const providedToken = req.headers['x-webhook-token'] || '';
      if (providedToken !== webhookToken) {
        sendJson(res, 401, { error: 'Unauthorized webhook request' });
        return;
      }

      const payload = await parseRequestBody(req);
      const sessionId = payload.sessionId || payload.data?.sessionId || payload.id;
      const status = payload.status || payload.data?.status;

      if (!sessionId) {
        sendJson(res, 400, { error: 'sessionId is required in webhook payload' });
        return;
      }

      recordPurchaseStatusChanged(sessionId, status, payload);
      sendJson(res, 200, { status: 'ok' });
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'Webhook handling failed' });
    }
    return;
  }

  if (pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  sendFile(res, path.join(rootDir, '404.html'));
});

server.listen(port, () => {
  console.log(`Website running at http://localhost:${port}`);
});

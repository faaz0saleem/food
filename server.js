require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Groq = require('groq-sdk');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { createRapidPayCheckoutSession, getRapidPayCheckoutSessionStatus } = require('./rapidpay');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const port = process.env.PORT || 3000;
const rootDir = __dirname;
const statsFile = path.join(rootDir, 'stats.json');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || process.env.GROQ_MODEL_NAME || 'llama-3.3-70b-versatile';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MODEL_LABEL = process.env.GROQ_MODEL_LABEL || GROQ_MODEL;

// ─── AI CLIENTS ───────────────────────────────────────────────────────────────
const groqClient = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const anthropicClient = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

const ENGINES = {
  reasoner:    { name: 'Reasoner',    provider: 'Groq',               model: GROQ_MODEL,      client: groqClient },
  solver:      { name: 'Solver',      provider: 'Groq (Gemini pending)', model: GROQ_MODEL,    client: groqClient },
  explorer:    { name: 'Explorer',    provider: 'OpenAI',              model: OPENAI_MODEL,    client: openaiClient },
  storyteller: { name: 'Storyteller', provider: 'Anthropic',           model: ANTHROPIC_MODEL, client: anthropicClient },
};

// ─── AI ROUTING ───────────────────────────────────────────────────────────────
function buildSystemPrompt(subject, userLevel) {
  return `You are MindMesh, an AI tutor. You ONLY help with educational topics: schoolwork, academic subjects, study skills, and learning ${subject || 'general topics'}. If the user asks about anything unrelated to learning or education, politely decline and redirect them.

Student level: "${userLevel || 'Newbie'}".
- Newbie/Learner: simple explanations with basic examples.
- Explorer/Scholar: detailed explanations with worked examples.
- Master: advanced insights and complex problem-solving.

Be encouraging, clear, and keep responses concise (2-4 sentences) unless the question needs a worked example.`;
}

async function callGroq(client, model, systemPrompt, message) {
  const response = await client.chat.completions.create({
    model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
    max_tokens: 400, temperature: 0.7,
  });
  return response.choices?.[0]?.message?.content?.trim() || null;
}

async function callOpenAI(client, model, systemPrompt, message) {
  const response = await client.chat.completions.create({
    model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
    max_tokens: 400,
  });
  return response.choices?.[0]?.message?.content?.trim() || null;
}

async function callAnthropic(client, model, systemPrompt, message) {
  const response = await client.messages.create({
    model, max_tokens: 400, system: systemPrompt,
    messages: [{ role: 'user', content: message }],
  });
  return response.content?.find((b) => b.type === 'text')?.text?.trim() || null;
}

async function callOneEngine(key, message, subject, userLevel) {
  const engine = ENGINES[key];
  if (!engine.client) return { name: engine.name, reply: null };
  const systemPrompt = buildSystemPrompt(subject, userLevel);
  try {
    let reply;
    if (key === 'reasoner' || key === 'solver') reply = await callGroq(engine.client, engine.model, systemPrompt, message);
    else if (key === 'explorer') reply = await callOpenAI(engine.client, engine.model, systemPrompt, message);
    else reply = await callAnthropic(engine.client, engine.model, systemPrompt, message);
    return { name: engine.name, reply };
  } catch (error) {
    console.error(`${engine.name} (${engine.provider}) failed:`, error.message);
    return { name: engine.name, reply: null };
  }
}

async function classifyMessage(message, subject) {
  if (!groqClient) return 'GENERAL';
  try {
    const response = await groqClient.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: `Classify the student message into one category. Reply with ONLY the category word.
Categories: MATH EXAMPLES STORY COMPLEX GENERAL
MATH=math/coding/physics/step-by-step | EXAMPLES=real-world examples | STORY=story/analogy/poem | COMPLEX=hard multi-part | GENERAL=everything else` },
        { role: 'user', content: `Subject: ${subject || 'General'}\nMessage: ${message}` },
      ],
      max_tokens: 5, temperature: 0,
    });
    const raw = (response.choices?.[0]?.message?.content || '').trim().toUpperCase();
    return ['MATH', 'EXAMPLES', 'STORY', 'COMPLEX', 'GENERAL'].find((c) => raw.includes(c)) || 'GENERAL';
  } catch { return 'GENERAL'; }
}

const CATEGORY_TO_ENGINE = { MATH: 'solver', EXAMPLES: 'explorer', STORY: 'storyteller', GENERAL: 'reasoner' };

async function answerSmart({ message, subject, userLevel }) {
  const category = await classifyMessage(message, subject);

  if (category === 'COMPLEX') {
    const secondaryKey = anthropicClient ? 'storyteller' : (openaiClient ? 'explorer' : 'solver');
    const [a, b] = await Promise.all([
      callOneEngine('reasoner', message, subject, userLevel),
      callOneEngine(secondaryKey, message, subject, userLevel),
    ]);
    const ok = [a, b].filter((r) => r.reply).filter((r, i, arr) => arr.findIndex((x) => x.name === r.name) === i);
    if (ok.length) return { reply: ok.map((r) => `**${r.name}:**\n${r.reply}`).join('\n\n---\n\n'), engine: ok.map((r) => r.name).join(', ') };
  } else {
    const result = await callOneEngine(CATEGORY_TO_ENGINE[category] || 'reasoner', message, subject, userLevel);
    if (result.reply) return { reply: result.reply, engine: result.name };
  }

  const fallback = await callOneEngine('reasoner', message, subject, userLevel);
  if (fallback.reply) return { reply: fallback.reply, engine: fallback.name };

  return { reply: `Demo mode — ${subject || 'your topic'}: Review one concept at a time and keep practising!`, engine: 'Reasoner' };
}

function getEngineAvailability() {
  return { reasoner: Boolean(groqClient), solver: false, explorer: Boolean(openaiClient), storyteller: Boolean(anthropicClient) };
}

// ─── STATS ────────────────────────────────────────────────────────────────────
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 15;

function emptyStats() { return { visitors: {}, dailyChats: {}, subjects: {}, totalChats: 0, rateLimits: {}, purchases: {} }; }
function todayKey(d = new Date()) { return d.toISOString().slice(0, 10); }
function monthKey(d = new Date()) { return d.toISOString().slice(0, 7); }

function touchVisitor(stats, visitorId, now = Date.now()) {
  if (!visitorId) return;
  const ex = stats.visitors[visitorId];
  stats.visitors[visitorId] = { first: ex?.first ?? now, last: now };
}

function recordVisit(stats, visitorId) { touchVisitor(stats, visitorId); }

function recordChatStat(stats, visitorId, subject) {
  const now = Date.now();
  touchVisitor(stats, visitorId, now);
  const key = todayKey(new Date(now));
  stats.dailyChats[key] = (stats.dailyChats[key] || 0) + 1;
  stats.totalChats = (stats.totalChats || 0) + 1;
  if (subject) stats.subjects[subject] = (stats.subjects[subject] || 0) + 1;
}

function checkAndRecordRateLimit(stats, visitorId, now = Date.now()) {
  if (!stats.rateLimits) stats.rateLimits = {};
  if (!visitorId) return { allowed: true };
  const recent = (stats.rateLimits[visitorId] || []).filter((ts) => ts > now - RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    stats.rateLimits[visitorId] = recent;
    return { allowed: false, retryAfterMs: Math.max(1000, RATE_LIMIT_WINDOW_MS - (now - recent[0])) };
  }
  recent.push(now);
  stats.rateLimits[visitorId] = recent;
  return { allowed: true };
}

function recordPurchase(stats, data) {
  if (!stats.purchases) stats.purchases = {};
  if (data.sessionId) stats.purchases[data.sessionId] = { ...stats.purchases[data.sessionId], ...data, updatedAt: Date.now() };
}

function summarize(stats) {
  const now = Date.now(); const today = todayKey(); const month = monthKey();
  const visitors = Object.values(stats.visitors || {});
  const activeNow = visitors.filter((v) => now - v.last <= ACTIVE_WINDOW_MS).length;
  const dailyActiveUsers = visitors.filter((v) => todayKey(new Date(v.last)) === today).length;
  const monthlyActiveUsers = visitors.filter((v) => monthKey(new Date(v.last)) === month).length;
  const dailyChats = stats.dailyChats || {};
  const chatsToday = dailyChats[today] || 0;
  const chatsThisMonth = Object.entries(dailyChats).filter(([d]) => d.startsWith(month)).reduce((s, [, c]) => s + c, 0);
  const topSubjects = Object.entries(stats.subjects || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([subject, count]) => ({ subject, count }));
  const pl = Object.values(stats.purchases || {}).filter(Boolean);
  return { totalVisitors: visitors.length, activeNow, dailyActiveUsers, monthlyActiveUsers, totalChats: stats.totalChats || 0, chatsToday, chatsThisMonth, topSubjects, purchases: { count: pl.length, succeeded: pl.filter((p) => String(p.status || '').toUpperCase() === 'SUCCEEDED').length } };
}

// ─── RATE LIMITER (per IP) ───────────────────────────────────────────────────
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 60 * 1000);
const RATE_MAX = Number(process.env.RATE_MAX || 20);
const rateMap = new Map();
const ADMIN_AUTH_WINDOW_MS = Number(process.env.ADMIN_AUTH_WINDOW_MS || 10 * 60 * 1000);
const ADMIN_AUTH_MAX_FAILURES = Number(process.env.ADMIN_AUTH_MAX_FAILURES || 8);
const adminAuthMap = new Map();

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  return xf ? xf.split(',')[0].trim() : (req.socket?.remoteAddress || 'unknown');
}

function isRateLimited(ip) {
  const now = Date.now(); const entry = rateMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) { rateMap.set(ip, { count: 1, windowStart: now }); return false; }
  return ++entry.count > RATE_MAX;
}

function timingSafeEqualString(l, r) {
  const a = Buffer.from(String(l || ''), 'utf8'); const b = Buffer.from(String(r || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isAdminAuthBlocked(ip) {
  const now = Date.now(); const e = adminAuthMap.get(ip);
  if (!e) return false;
  if (e.blockedUntil && e.blockedUntil > now) return true;
  if (now - e.windowStart > ADMIN_AUTH_WINDOW_MS) { adminAuthMap.set(ip, { count: 0, blockedUntil: 0, windowStart: now }); return false; }
  return false;
}

function recordAdminAuthFailure(ip) {
  const now = Date.now(); const e = adminAuthMap.get(ip) || { count: 0, blockedUntil: 0, windowStart: now };
  if (now - e.windowStart > ADMIN_AUTH_WINDOW_MS) { e.count = 0; e.windowStart = now; e.blockedUntil = 0; }
  if (++e.count >= ADMIN_AUTH_MAX_FAILURES) e.blockedUntil = now + Math.max(1, e.count - ADMIN_AUTH_MAX_FAILURES + 1) * 60 * 1000;
  adminAuthMap.set(ip, e);
}

// ─── FILE SERVING ─────────────────────────────────────────────────────────────
function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    const ct = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain', '.xml': 'text/xml', '.webmanifest': 'application/manifest+json' }[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct });
    res.end(data);
  });
}

function loadStats() {
  try { const p = JSON.parse(fs.readFileSync(statsFile, 'utf8')); return p?.visitors ? p : emptyStats(); } catch { return emptyStats(); }
}
function saveStats() { fs.writeFile(statsFile, JSON.stringify(visitorStats, null, 2), (e) => { if (e) console.error('Stats save failed:', e.message); }); }
function getStatusSummary() { return { ...summarize(visitorStats), model: MODEL_LABEL }; }

// ─── QUIZ ─────────────────────────────────────────────────────────────────────
function parseJsonSafe(text) {
  try { return JSON.parse(text); } catch { const m = text.match(/(\[.*\])/s); if (m) { try { return JSON.parse(m[1]); } catch {} } return null; }
}

function getDemoQuiz(subject, count = 5) {
  const q = { question: `What is the most important idea in ${subject}?`, options: ['A) It helps people solve problems', 'B) Only interesting for experts', 'C) Cannot be used in real life', 'D) Always boring'], correct: 'A', explanation: `${subject} is useful for real-world thinking and problem solving.` };
  return Array.from({ length: count }, () => ({ ...q }));
}

async function generateQuiz(subject, count = 5, asked = []) {
  if (!groqClient) return getDemoQuiz(subject, count);
  const fa = Array.isArray(asked) ? asked.filter((x) => typeof x === 'string' && x.trim().length > 5) : [];
  try {
    const res = await groqClient.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: 'You are a quiz generator. Only output valid JSON.' }, { role: 'user', content: `Generate ${count} multiple choice questions for a student learning ${subject}. Avoid repeating: ${fa.slice(-20).join(' | ')}. Return ONLY: [{"question":"...","options":["A)...","B)...","C)...","D)..."],"correct":"A","explanation":"..."}]` }],
      max_tokens: 1024,
    });
    const parsed = parseJsonSafe(res.choices?.[0]?.message?.content || '');
    const data = Array.isArray(parsed) ? parsed : [];
    const unique = data.filter((item) => item?.question && !fa.some((a) => { const q = item.question.toLowerCase(); const at = a.toLowerCase(); return q.includes(at) || at.includes(q); }));
    return (unique.length >= count ? unique : unique.concat(getDemoQuiz(subject, count))).slice(0, count);
  } catch (e) { console.error('Quiz gen failed:', e.message); return getDemoQuiz(subject, count); }
}

async function generateQuizQuestion(subject) {
  const qs = await generateQuiz(subject, 1);
  return qs[0] || { question: `Which best describes ${subject}?`, options: ['A) A fun topic', 'B) Only for experts', 'C) Avoid it', 'D) Has no use'], correct: 'A', explanation: `${subject} helps learners grow.` };
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { if (!body) { resolve({}); return; } try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

// ─── SERVER ───────────────────────────────────────────────────────────────────
const visitorStats = loadStats();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // GET
  if (req.method === 'GET') {
    if (pathname === '/' || pathname === '/index.html') { sendFile(res, path.join(rootDir, 'index.html')); return; }

    const cleanedPath = path.normalize(pathname).replace(/^\.{2,}(?:[/\\]|$)/, '').slice(1);
    const filePath = path.join(rootDir, cleanedPath);
    const ext = path.extname(filePath).toLowerCase();

    if (cleanedPath && ['.css','.js','.png','.svg','.ico','.json','.txt','.xml','.webmanifest'].includes(ext)) { sendFile(res, filePath); return; }
    if (pathname.endsWith('.html')) { sendFile(res, filePath); return; }
    if (pathname === '/health') { sendJson(res, 200, { status: 'ok' }); return; }

    if (pathname === '/api/status') {
      sendJson(res, 200, { status: 'ok', model: MODEL_LABEL, engines: getEngineAvailability(), stats: getStatusSummary() });
      return;
    }

    if (pathname === '/api/admin-stats') {
      const ip = getClientIp(req);
      if (isAdminAuthBlocked(ip)) { sendJson(res, 429, { error: 'Too many failed attempts.' }); return; }
      const key = req.headers['x-admin-key'] || url.searchParams.get('key') || '';
      if (!ADMIN_KEY || !timingSafeEqualString(key, ADMIN_KEY)) { recordAdminAuthFailure(ip); sendJson(res, 401, { error: 'Unauthorized' }); return; }
      adminAuthMap.delete(ip);
      sendJson(res, 200, summarize(visitorStats));
      return;
    }

    if (pathname === '/api/payments/checkout-session') {
      try {
        const sessionId = url.searchParams.get('sessionId') || '';
        const session = await getRapidPayCheckoutSessionStatus(sessionId);
        if (session) { recordPurchase(visitorStats, { sessionId, status: session.status }); saveStats(); }
        sendJson(res, 200, { status: 'ok', session });
      } catch (e) { sendJson(res, 400, { error: e.message || 'Payment status lookup failed' }); }
      return;
    }
  }

  // OPTIONS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Key' });
    res.end();
    return;
  }

  // POST
  if (req.method === 'POST') {
    if (pathname === '/api/visit') {
      try {
        const ip = getClientIp(req);
        if (isRateLimited(ip)) { sendJson(res, 429, { error: 'Rate limit exceeded' }); return; }
        const { visitorId } = await parseRequestBody(req);
        if (visitorId) { recordVisit(visitorStats, visitorId); saveStats(); }
        sendJson(res, 200, { status: 'ok', stats: getStatusSummary() });
      } catch (e) { sendJson(res, 400, { error: e.message }); }
      return;
    }

    if (pathname === '/api/chat') {
      try {
        const ip = getClientIp(req);
        if (isRateLimited(ip)) { sendJson(res, 429, { error: 'Rate limit exceeded' }); return; }
        const payload = await parseRequestBody(req);
        const { visitorId, subject = 'General', userLevel = 'Newbie' } = payload;
        const message = (payload.message || '').trim();
        if (!message) { sendJson(res, 400, { error: 'A message is required.' }); return; }
        const rl = checkAndRecordRateLimit(visitorStats, visitorId);
        if (!rl.allowed) { sendJson(res, 429, { error: "Too many messages. Please wait a moment.", retryAfterMs: rl.retryAfterMs }); return; }
        recordChatStat(visitorStats, visitorId, subject); saveStats();
        const { reply, engine } = await answerSmart({ message, subject, userLevel });
        sendJson(res, 200, { status: 'ok', reply, engine, model: MODEL_LABEL, stats: getStatusSummary() });
      } catch (e) { sendJson(res, 400, { error: e.message }); }
      return;
    }

    if (pathname === '/api/quiz-question') {
      try {
        const ip = getClientIp(req);
        if (isRateLimited(ip)) { sendJson(res, 429, { error: 'Rate limit exceeded' }); return; }
        const { subject = 'Math' } = await parseRequestBody(req);
        sendJson(res, 200, await generateQuizQuestion(subject));
      } catch (e) { sendJson(res, 400, { error: e.message }); }
      return;
    }

    if (pathname === '/api/quiz') {
      try {
        const ip = getClientIp(req);
        if (isRateLimited(ip)) { sendJson(res, 429, { error: 'Rate limit exceeded' }); return; }
        const payload = await parseRequestBody(req);
        sendJson(res, 200, await generateQuiz(payload.subject || 'Math', Number(payload.count) || 5, Array.isArray(payload.askedQuestions) ? payload.askedQuestions : []));
      } catch (e) { sendJson(res, 400, { error: e.message }); }
      return;
    }

    if (pathname === '/api/payments/checkout-session') {
      try {
        const payload = await parseRequestBody(req);
        const result = await createRapidPayCheckoutSession({ planId: payload.plan, customerEmail: payload.customerEmail, customerMobile: payload.customerMobile });
        recordPurchase(visitorStats, { sessionId: result.sessionId, planId: result.plan?.id, customerEmail: payload.customerEmail, amount: result.amount, currency: result.currency, status: 'CREATED' });
        saveStats();
        sendJson(res, 200, { status: 'ok', ...result });
      } catch (e) { sendJson(res, 400, { error: e.message || 'Payment session creation failed' }); }
      return;
    }

    if (pathname === '/api/payments/webhook') {
      try {
        const token = process.env.RAPIDPAY_WEBHOOK_TOKEN || '';
        if (!token) { sendJson(res, 501, { error: 'Webhook not configured.' }); return; }
        if (req.headers['x-webhook-token'] !== token) { sendJson(res, 401, { error: 'Unauthorized' }); return; }
        const payload = await parseRequestBody(req);
        const sessionId = payload.sessionId || payload.data?.sessionId || payload.id;
        if (!sessionId) { sendJson(res, 400, { error: 'sessionId required' }); return; }
        recordPurchase(visitorStats, { sessionId, status: payload.status || payload.data?.status });
        saveStats();
        sendJson(res, 200, { status: 'ok' });
      } catch (e) { sendJson(res, 400, { error: e.message || 'Webhook failed' }); }
      return;
    }
  }

  // 404
  if (pathname.startsWith('/api/')) { sendJson(res, 404, { error: 'Not found' }); return; }
  sendFile(res, path.join(rootDir, '404.html'));
});

server.listen(port, () => {
  console.log(`\n🧠 MindMesh running at http://localhost:${port}`);
  console.log(`   Groq=${Boolean(groqClient)} | OpenAI=${Boolean(openaiClient)} | Anthropic=${Boolean(anthropicClient)}\n`);
});

require('dotenv').config();

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const Groq = require('groq-sdk');
const OpenAI = require('openai');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const STATS_FILE = path.join(ROOT, 'stats.json');
const DB_FILE = path.join(ROOT, 'database', 'mindmesh.db');
const ADMIN_KEY = String(process.env.ADMIN_KEY || '');
const AUTH_SECRET = String(process.env.AUTH_SECRET || 'mindmesh-dev-auth-secret');
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest';
const BODY_LIMIT = 1_000_000;
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const IP_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 60_000);
const IP_MAX = Number(process.env.RATE_MAX || 40);
const VISITOR_WINDOW_MS = Number(process.env.VISITOR_RATE_WINDOW_MS || 60_000);
const VISITOR_MAX = Number(process.env.VISITOR_RATE_MAX || 20);

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const groqClient = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const anthropicClient = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

const ipLimiter = new Map();
const visitorLimiter = new Map();
const conversationMemory = new Map();

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: String(item.content || '').trim(),
    }))
    .filter((item) => item.content)
    .slice(-12);
}

function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      name: String(item.name || 'attachment').slice(0, 120),
      type: String(item.type || 'application/octet-stream').slice(0, 120),
      kind: item.kind === 'image' ? 'image' : 'file',
      textContent: String(item.textContent || '').slice(0, 12000),
      imageDataUrl: String(item.imageDataUrl || '').slice(0, 250000),
      size: Number(item.size || 0),
    }))
    .slice(0, 5);
}

function attachmentToPromptSegment(attachment) {
  const header = `[Attachment: ${attachment.name} | ${attachment.type} | ${Math.max(0, attachment.size)} bytes]`;
  if (attachment.kind === 'image' && attachment.imageDataUrl) {
    return `${header}\nImage data URL provided by student (truncated as needed):\n${attachment.imageDataUrl.slice(0, 1800)}`;
  }
  if (attachment.textContent) {
    return `${header}\nFile text excerpt:\n${attachment.textContent}`;
  }
  return `${header}\nNo parseable text extracted.`;
}

function buildFinalUserMessage(message, attachments) {
  const base = String(message || '').trim();
  if (!attachments.length) return base;
  const sections = attachments.map(attachmentToPromptSegment).join('\n\n');
  return `${base}\n\nStudent uploaded files/images for analysis:\n${sections}`;
}

function updateConversationMemory(visitorId, userMessage, aiReply) {
  if (!visitorId) return;
  const existing = Array.isArray(conversationMemory.get(visitorId)) ? conversationMemory.get(visitorId) : [];
  const next = existing.concat([
    { role: 'user', content: String(userMessage || '').trim() },
    { role: 'assistant', content: String(aiReply || '').trim() },
  ]).filter((item) => item.content).slice(-16);
  conversationMemory.set(visitorId, next);
}

function getConversationMemory(visitorId, incomingHistory) {
  const memory = visitorId && Array.isArray(conversationMemory.get(visitorId))
    ? conversationMemory.get(visitorId)
    : [];
  const merged = memory.concat(incomingHistory || []);
  return merged.slice(-14);
}

function ensureDatabase() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return;
    }
    execFileSync('sqlite3', [DB_FILE, "ALTER TABLE users ADD COLUMN password_hash TEXT;"], { stdio: 'ignore' });
  } catch {
    // ignore if column already exists
  }
  try {
    execFileSync('sqlite3', [DB_FILE, "ALTER TABLE users ADD COLUMN plan_name TEXT;"], { stdio: 'ignore' });
  } catch {}
  try {
    execFileSync('sqlite3', [DB_FILE, "ALTER TABLE users ADD COLUMN plan_price REAL;"], { stdio: 'ignore' });
  } catch {}
  try {
    execFileSync('sqlite3', [DB_FILE, "ALTER TABLE users ADD COLUMN plan_status TEXT DEFAULT 'inactive';"], { stdio: 'ignore' });
  } catch {}
  try {
    execFileSync('sqlite3', [DB_FILE, "ALTER TABLE users ADD COLUMN plan_started TEXT;"], { stdio: 'ignore' });
  } catch {}
}

function sqlEsc(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function dbSelect(sql) {
  try {
    if (!fs.existsSync(DB_FILE)) return [];
    const out = execFileSync('sqlite3', ['-json', DB_FILE, sql], { encoding: 'utf8' }).trim();
    if (!out) return [];
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function dbRun(sql) {
  try {
    if (!fs.existsSync(DB_FILE)) return false;
    execFileSync('sqlite3', [DB_FILE, sql], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, passwordHash) {
  if (!passwordHash || !passwordHash.includes(':')) return false;
  const [salt, hash] = passwordHash.split(':');
  const check = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function issueToken(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function readAuthToken(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return '';
  return header.slice(7).trim();
}

function sanitizeUserRow(user) {
  if (!user) return null;
  return {
    visitorId: String(user.visitor_id || ''),
    name: String(user.name || ''),
    email: String(user.email || ''),
    learningStyle: String(user.learning_style || 'Visual'),
    level: String(user.level || 'Newbie'),
    xp: Number(user.xp || 0),
    planName: String(user.plan_name || ''),
    planPrice: Number(user.plan_price || 0),
    planStatus: String(user.plan_status || 'inactive'),
    planStarted: String(user.plan_started || ''),
  };
}

function safeStatsShape(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    visitors: input.visitors && typeof input.visitors === 'object' ? input.visitors : {},
    dailyChats: input.dailyChats && typeof input.dailyChats === 'object' ? input.dailyChats : {},
    subjects: input.subjects && typeof input.subjects === 'object' ? input.subjects : {},
    totalChats: Number(input.totalChats || 0),
  };
}

function loadStats() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    return safeStatsShape(parsed);
  } catch {
    return safeStatsShape(null);
  }
}

const stats = loadStats();

function persistStats() {
  fs.writeFile(STATS_FILE, JSON.stringify(stats, null, 2), (error) => {
    if (error) {
      console.error('stats.json write failed:', error.message);
    }
  });
}

function isoDay(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function isoMonth(ts) {
  return new Date(ts).toISOString().slice(0, 7);
}

function touchVisitor(visitorId, ts = Date.now()) {
  if (!visitorId) return;
  const existing = stats.visitors[visitorId] || {};
  stats.visitors[visitorId] = {
    first: Number(existing.first || ts),
    last: ts,
  };
}

function recordVisit(visitorId, ts = Date.now()) {
  touchVisitor(visitorId, ts);
}

function recordChat(visitorId, subject, ts = Date.now()) {
  touchVisitor(visitorId, ts);
  const dayKey = isoDay(ts);
  stats.dailyChats[dayKey] = Number(stats.dailyChats[dayKey] || 0) + 1;
  stats.totalChats = Number(stats.totalChats || 0) + 1;
  if (subject) {
    stats.subjects[subject] = Number(stats.subjects[subject] || 0) + 1;
  }
}

function summarizeStats() {
  const now = Date.now();
  const day = isoDay(now);
  const month = isoMonth(now);
  const visitors = Object.values(stats.visitors || {});

  const dau = visitors.filter((entry) => isoDay(Number(entry.last || 0)) === day).length;
  const mau = visitors.filter((entry) => isoMonth(Number(entry.last || 0)) === month).length;
  const activeNow = visitors.filter((entry) => now - Number(entry.last || 0) <= ACTIVE_WINDOW_MS).length;

  return {
    totalVisitors: visitors.length,
    totalChats: Number(stats.totalChats || 0),
    chatsToday: Number(stats.dailyChats[day] || 0),
    dau,
    mau,
    activeNow,
    topSubjects: Object.entries(stats.subjects || {})
      .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
      .slice(0, 10)
      .map(([subject, count]) => ({ subject, count: Number(count || 0) })),
  };
}

function pruneWindow(map, key, windowMs, now = Date.now()) {
  const history = Array.isArray(map.get(key)) ? map.get(key) : [];
  const kept = history.filter((ts) => now - ts < windowMs);
  map.set(key, kept);
  return kept;
}

function checkLimit(map, key, windowMs, max) {
  try {
    const now = Date.now();
    const history = pruneWindow(map, key, windowMs, now);
    if (history.length >= max) {
      const retryAfterMs = Math.max(1000, windowMs - (now - history[0]));
      return { allowed: false, retryAfterMs };
    }
    history.push(now);
    map.set(key, history);
    return { allowed: true, retryAfterMs: 0 };
  } catch {
    return { allowed: true, retryAfterMs: 0 };
  }
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function setCommonHeaders(res, contentType) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Admin-Key,Authorization');
  if (contentType) res.setHeader('Content-Type', contentType);
}

function sendJson(res, statusCode, payload) {
  setCommonHeaders(res, 'application/json; charset=utf-8');
  res.writeHead(statusCode);
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  setCommonHeaders(res, 'text/plain; charset=utf-8');
  res.writeHead(statusCode);
  res.end(text);
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function resolveStaticPath(urlPath) {
  const clean = path.normalize(urlPath).replace(/^([.]{2}[\\/])+/, '');
  const relative = clean.replace(/^\//, '');
  const target = path.resolve(ROOT, relative || 'index.html');
  if (!target.startsWith(ROOT)) return null;
  return target;
}

function isStaticAllowed(urlPath) {
  if (urlPath === '/') return true;
  if (urlPath.endsWith('.html')) return true;
  const ext = path.extname(urlPath).toLowerCase();
  return Object.prototype.hasOwnProperty.call(STATIC_TYPES, ext);
}

function sendFile(res, filePath, statusCode = 200) {
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendText(res, 404, 'Not found');
      return;
    }
    setCommonHeaders(res, STATIC_TYPES[ext] || 'application/octet-stream');
    res.writeHead(statusCode);
    res.end(content);
  });
}

function createSystemPrompt(subject, userLevel) {
  const level = String(userLevel || 'Newbie');
  let tone = 'Use clear explanations.';
  if (level === 'Newbie' || level === 'Learner') {
    tone = 'Use simple words and beginner-friendly steps.';
  } else if (level === 'Explorer' || level === 'Scholar') {
    tone = 'Use detailed structure and useful context.';
  } else if (level === 'Master') {
    tone = 'Use advanced depth and concise rigor.';
  }

  return [
    'You are MindMesh, an AI tutor. You ONLY help with educational topics and you decline off-topic requests by redirecting to learning.',
    `Subject focus: ${subject || 'General'}.`,
    `Learner level: ${level}.`,
    tone,
    'Be concise: 2-4 sentences unless the student asks for or clearly needs a worked example.',
  ].join(' ');
}

function parseCategory(raw) {
  const text = String(raw || '').toUpperCase();
  const allowed = ['MATH', 'EXAMPLES', 'STORY', 'COMPLEX', 'GENERAL'];
  const found = allowed.find((label) => text.includes(label));
  return found || 'GENERAL';
}

async function classifyMessage(message, subject) {
  if (!groqClient) {
    const text = `${subject || ''} ${message || ''}`.toLowerCase();
    if (/story|narrative|analogy|poem/.test(text)) return 'STORY';
    if (/example|real world|real-world|use case/.test(text)) return 'EXAMPLES';
    if (/compare|contrast|multi-part|multiple parts|tradeoff/.test(text)) return 'COMPLEX';
    if (/math|equation|solve|calculate|physics|code|coding|algebra/.test(text)) return 'MATH';
    return 'GENERAL';
  }
  try {
    const response = await groqClient.chat.completions.create({
      model: GROQ_MODEL,
      temperature: 0,
      max_tokens: 5,
      messages: [
        {
          role: 'system',
          content: 'Return EXACTLY one word from this set only: MATH, EXAMPLES, STORY, COMPLEX, GENERAL.',
        },
        {
          role: 'user',
          content: `Subject: ${subject || 'General'}\nMessage: ${String(message || '')}`,
        },
      ],
    });
    return parseCategory(response?.choices?.[0]?.message?.content);
  } catch {
    return 'GENERAL';
  }
}

async function callGroq(message, subject, userLevel, history = []) {
  if (!groqClient) return null;
  const response = await groqClient.chat.completions.create({
    model: GROQ_MODEL,
    temperature: 0.5,
    max_tokens: 700,
    messages: [
      { role: 'system', content: createSystemPrompt(subject, userLevel) },
      ...history,
      { role: 'user', content: message },
    ],
  });
  const reply = String(response?.choices?.[0]?.message?.content || '').trim();
  return reply || null;
}

async function callOpenAI(message, subject, userLevel, history = []) {
  if (!openaiClient) return null;
  const response = await openaiClient.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.5,
    max_tokens: 700,
    messages: [
      { role: 'system', content: createSystemPrompt(subject, userLevel) },
      ...history,
      { role: 'user', content: message },
    ],
  });
  const reply = String(response?.choices?.[0]?.message?.content || '').trim();
  return reply || null;
}

async function callAnthropic(message, subject, userLevel, history = []) {
  if (!anthropicClient) return null;
  const anthropicMessages = history.map((item) => ({
    role: item.role === 'assistant' ? 'assistant' : 'user',
    content: item.content,
  }));
  anthropicMessages.push({ role: 'user', content: message });
  const response = await anthropicClient.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 700,
    temperature: 0.5,
    system: createSystemPrompt(subject, userLevel),
    messages: anthropicMessages,
  });
  const reply = String(
    (response?.content || []).find((block) => block && block.type === 'text')?.text || ''
  ).trim();
  return reply || null;
}

async function safeEngineCall(engineName, message, subject, userLevel, history = []) {
  try {
    if (engineName === 'Reasoner' || engineName === 'Solver') {
      const reply = await callGroq(message, subject, userLevel, history);
      return reply ? { engine: engineName, model: GROQ_MODEL, reply } : null;
    }
    if (engineName === 'Explorer') {
      const reply = await callOpenAI(message, subject, userLevel, history);
      return reply ? { engine: engineName, model: OPENAI_MODEL, reply } : null;
    }
    if (engineName === 'Storyteller') {
      const reply = await callAnthropic(message, subject, userLevel, history);
      return reply ? { engine: engineName, model: ANTHROPIC_MODEL, reply } : null;
    }
    return null;
  } catch {
    return null;
  }
}

function apiUnavailableReply() {
  return 'AI providers are not configured right now. Add at least one API key (GROQ_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY) in the environment and restart the server.';
}

async function buildChat(message, subject, userLevel, excludeEngine, history = []) {
  let category = await classifyMessage(message, subject);

  const categoryToEngine = {
    MATH: 'Solver',
    EXAMPLES: 'Explorer',
    STORY: 'Storyteller',
    GENERAL: 'Reasoner',
  };

  if (excludeEngine && category !== 'COMPLEX') {
    const picked = categoryToEngine[category] || 'Reasoner';
    if (picked === excludeEngine) {
      if (excludeEngine !== 'Storyteller' && anthropicClient) category = 'STORY';
      else if (excludeEngine !== 'Explorer' && openaiClient) category = 'EXAMPLES';
      else if (excludeEngine !== 'Solver') category = 'MATH';
      else category = 'GENERAL';
    }
  }

  if (category === 'COMPLEX') {
    const secondary = anthropicClient ? 'Storyteller' : (openaiClient ? 'Explorer' : 'Solver');
    const [reasonerResult, secondaryResult] = await Promise.all([
      safeEngineCall('Reasoner', message, subject, userLevel, history),
      safeEngineCall(secondary, message, subject, userLevel, history),
    ]);

    const results = [reasonerResult, secondaryResult].filter(Boolean);
    if (results.length > 0) {
      const reply = results
        .map((result) => `**${result.engine}:**\n${result.reply}`)
        .join('\n\n---\n\n');
      return {
        reply,
        engine: results.map((result) => result.engine).join(', '),
        model: results.map((result) => result.model).join(', '),
      };
    }
  } else {
    const target = categoryToEngine[category] || 'Reasoner';
    const primary = await safeEngineCall(target, message, subject, userLevel, history);
    if (primary) {
      return { reply: primary.reply, engine: primary.engine, model: primary.model };
    }
  }

  const reasoner = await safeEngineCall('Reasoner', message, subject, userLevel, history);
  if (reasoner) {
    return { reply: reasoner.reply, engine: reasoner.engine, model: reasoner.model };
  }

  return {
    reply: apiUnavailableReply(),
    engine: 'Unavailable',
    model: 'none',
  };
}

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const raw = String(text || '');
    const arrayMatch = raw.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch {
        return null;
      }
    }
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function createDemoQuestion(subject, index = 0) {
  const options = [
    'It builds problem-solving skills',
    'It only matters for experts',
    'It has no real-world use',
    'It cannot be learned step by step',
  ];
  return {
    question: index === 0
      ? `What is one useful reason to study ${subject}?`
      : `Which statement best matches a strong first step in ${subject}?`,
    options,
    correct: options[0],
    answer: options[0],
    explanation: `${subject} helps learners break down ideas and solve practical problems.`,
  };
}

function normalizeQuestion(raw, fallbackSubject, index) {
  if (!raw || typeof raw !== 'object' || !raw.question || !Array.isArray(raw.options) || raw.options.length < 4) {
    return createDemoQuestion(fallbackSubject, index);
  }
  const options = raw.options.slice(0, 4).map((option) => String(option).trim()).filter(Boolean);
  if (options.length < 4) {
    return createDemoQuestion(fallbackSubject, index);
  }
  const correctValue = String(raw.answer || raw.correct || '').trim();
  let answer = correctValue;
  if (/^[A-D]$/i.test(correctValue)) {
    answer = options[correctValue.toUpperCase().charCodeAt(0) - 65] || options[0];
  }
  if (!options.includes(answer)) {
    answer = options[0];
  }
  return {
    question: String(raw.question).trim(),
    options,
    correct: answer,
    answer,
    explanation: String(raw.explanation || `Review ${fallbackSubject} carefully and compare each option before answering.`).trim(),
  };
}

function dedupeQuestions(questions, askedQuestions) {
  const asked = new Set(
    (Array.isArray(askedQuestions) ? askedQuestions : [])
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)
  );
  return questions.filter((question) => !asked.has(String(question.question || '').trim().toLowerCase()));
}

async function generateQuiz(subject, count, askedQuestions) {
  const safeCount = Math.max(1, Math.min(20, Number(count) || 5));
  if (!groqClient) {
    return Array.from({ length: safeCount }, (_, index) => createDemoQuestion(subject, index));
  }

  try {
    const response = await groqClient.chat.completions.create({
      model: GROQ_MODEL,
      temperature: 0.3,
      max_tokens: 1200,
      messages: [
        { role: 'system', content: 'Return valid JSON only.' },
        {
          role: 'user',
          content: [
            `Generate ${safeCount} multiple-choice questions for ${subject}.`,
            'Each item must be JSON with question, options, correct, and explanation.',
            'Use exactly 4 options per question.',
            `Avoid repeating any of these questions: ${(Array.isArray(askedQuestions) ? askedQuestions : []).slice(-20).join(' | ') || 'none'}.`,
            'Return only a JSON array.',
          ].join(' '),
        },
      ],
    });

    const parsed = extractJson(response?.choices?.[0]?.message?.content || '');
    const normalized = Array.isArray(parsed)
      ? parsed.map((item, index) => normalizeQuestion(item, subject, index))
      : [];
    const unique = dedupeQuestions(normalized, askedQuestions);

    if (unique.length >= safeCount) {
      return unique.slice(0, safeCount);
    }

    const fallback = Array.from({ length: safeCount }, (_, index) => createDemoQuestion(subject, index));
    return unique.concat(fallback).slice(0, safeCount);
  } catch {
    return Array.from({ length: safeCount }, (_, index) => createDemoQuestion(subject, index));
  }
}

async function generateQuizQuestion(subject) {
  const questions = await generateQuiz(subject, 1, []);
  return questions[0] || createDemoQuestion(subject, 0);
}

function enginesStatus() {
  return {
    reasoner: Boolean(groqClient),
    solver: Boolean(groqClient),
    explorer: Boolean(openaiClient),
    storyteller: Boolean(anthropicClient),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    setCommonHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET') {
    if (pathname === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (pathname === '/api/status') {
      sendJson(res, 200, {
        status: 'ok',
        model: GROQ_MODEL,
        engines: enginesStatus(),
        stats: summarizeStats(),
      });
      return;
    }

    if (pathname === '/api/admin-stats') {
      const provided = req.headers['x-admin-key'] || url.searchParams.get('key') || '';
      if (!ADMIN_KEY || !timingSafeEqual(provided, ADMIN_KEY)) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }
      sendJson(res, 200, {
        status: 'ok',
        model: GROQ_MODEL,
        engines: enginesStatus(),
        stats: summarizeStats(),
      });
      return;
    }

    if (pathname === '/api/auth/me') {
      const token = readAuthToken(req);
      const claims = verifyToken(token);
      if (!claims?.visitorId) {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }
      const user = dbSelect(`SELECT visitor_id,name,email,learning_style,level,xp,plan_name,plan_price,plan_status,plan_started FROM users WHERE visitor_id=${sqlEsc(claims.visitorId)} LIMIT 1;`)[0];
      if (!user) {
        sendJson(res, 404, { error: 'User not found' });
        return;
      }
      sendJson(res, 200, { status: 'ok', user: sanitizeUserRow(user) });
      return;
    }

    if (isStaticAllowed(pathname)) {
      const target = resolveStaticPath(pathname === '/' ? '/index.html' : pathname);
      if (!target) {
        sendText(res, 403, 'Forbidden');
        return;
      }

      if (pathname.endsWith('.html')) {
        fs.access(target, fs.constants.F_OK, (error) => {
          if (error) {
            const notFoundPage = path.join(ROOT, '404.html');
            sendFile(res, notFoundPage, 404);
            return;
          }
          sendFile(res, target);
        });
        return;
      }

      sendFile(res, target);
      return;
    }

    sendText(res, 404, 'Not found');
    return;
  }

  if (req.method === 'POST') {
    const ip = getClientIp(req);
    const ipRate = checkLimit(ipLimiter, ip, IP_WINDOW_MS, IP_MAX);
    if (!ipRate.allowed) {
      sendJson(res, 429, { error: 'Rate limit exceeded', retryAfterMs: ipRate.retryAfterMs });
      return;
    }

    try {
      const body = await parseBody(req);

      if (pathname === '/api/visit') {
        const visitorId = String(body.visitorId || '').trim();
        recordVisit(visitorId);
        persistStats();
        sendJson(res, 200, { status: 'ok', stats: summarizeStats() });
        return;
      }

      if (pathname === '/api/auth/signup') {
        const name = String(body.name || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        const learningStyle = String(body.learningStyle || 'Visual').trim() || 'Visual';
        if (name.length < 2 || !email.includes('@') || password.length < 8) {
          sendJson(res, 400, { error: 'Invalid signup payload' });
          return;
        }
        const existing = dbSelect(`SELECT id FROM users WHERE email=${sqlEsc(email)} LIMIT 1;`);
        if (existing.length) {
          sendJson(res, 409, { error: 'Account already exists' });
          return;
        }
        const visitorId = `user-${crypto.randomBytes(8).toString('hex')}`;
        const passwordHash = hashPassword(password);
        const ok = dbRun(
          `INSERT INTO users (visitor_id,name,email,password_hash,learning_style,level,xp,created_at,updated_at)
           VALUES (${sqlEsc(visitorId)},${sqlEsc(name)},${sqlEsc(email)},${sqlEsc(passwordHash)},${sqlEsc(learningStyle)},'Newbie',0,datetime('now'),datetime('now'));`
        );
        if (!ok) {
          sendJson(res, 500, { error: 'Failed to create account' });
          return;
        }
        const user = dbSelect(`SELECT visitor_id,name,email,learning_style,level,xp,plan_name,plan_price,plan_status,plan_started FROM users WHERE visitor_id=${sqlEsc(visitorId)} LIMIT 1;`)[0];
        const token = issueToken({ visitorId, email, issuedAt: Date.now() });
        sendJson(res, 200, { status: 'ok', token, user: sanitizeUserRow(user) });
        return;
      }

      if (pathname === '/api/auth/login') {
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        if (!email || !password) {
          sendJson(res, 400, { error: 'Email and password are required' });
          return;
        }
        const user = dbSelect(`SELECT visitor_id,name,email,password_hash,learning_style,level,xp,plan_name,plan_price,plan_status,plan_started FROM users WHERE email=${sqlEsc(email)} LIMIT 1;`)[0];
        if (!user || !verifyPassword(password, String(user.password_hash || ''))) {
          sendJson(res, 401, { error: 'Invalid credentials' });
          return;
        }
        const token = issueToken({ visitorId: user.visitor_id, email: user.email, issuedAt: Date.now() });
        sendJson(res, 200, { status: 'ok', token, user: sanitizeUserRow(user) });
        return;
      }

      if (pathname === '/api/profile') {
        const token = readAuthToken(req);
        const claims = verifyToken(token);
        if (!claims?.visitorId) {
          sendJson(res, 401, { error: 'Unauthorized' });
          return;
        }
        const name = String(body.name || '').trim();
        const learningStyle = String(body.learningStyle || '').trim();
        const level = String(body.level || '').trim();
        const xp = Number(body.xp || 0);
        const updates = [];
        if (name) updates.push(`name=${sqlEsc(name)}`);
        if (learningStyle) updates.push(`learning_style=${sqlEsc(learningStyle)}`);
        if (level) updates.push(`level=${sqlEsc(level)}`);
        if (Number.isFinite(xp) && xp >= 0) updates.push(`xp=${Math.round(xp)}`);
        updates.push("updated_at=datetime('now')");
        const ok = dbRun(`UPDATE users SET ${updates.join(', ')} WHERE visitor_id=${sqlEsc(claims.visitorId)};`);
        if (!ok) {
          sendJson(res, 500, { error: 'Failed to update profile' });
          return;
        }
        const user = dbSelect(`SELECT visitor_id,name,email,learning_style,level,xp,plan_name,plan_price,plan_status,plan_started FROM users WHERE visitor_id=${sqlEsc(claims.visitorId)} LIMIT 1;`)[0];
        sendJson(res, 200, { status: 'ok', user: sanitizeUserRow(user) });
        return;
      }

      if (pathname === '/api/subscription') {
        const token = readAuthToken(req);
        const claims = verifyToken(token);
        if (!claims?.visitorId) {
          sendJson(res, 401, { error: 'Unauthorized' });
          return;
        }
        const planName = String(body.planName || '').trim();
        const planStatus = String(body.planStatus || 'inactive').trim() || 'inactive';
        const planPrice = Number(body.planPrice || 0);
        const planStarted = String(body.planStarted || new Date().toISOString()).trim();
        if (!planName) {
          sendJson(res, 400, { error: 'planName is required' });
          return;
        }
        const ok = dbRun(
          `UPDATE users SET plan_name=${sqlEsc(planName)}, plan_price=${Number.isFinite(planPrice) ? planPrice : 0}, plan_status=${sqlEsc(planStatus)}, plan_started=${sqlEsc(planStarted)}, updated_at=datetime('now') WHERE visitor_id=${sqlEsc(claims.visitorId)};`
        );
        if (!ok) {
          sendJson(res, 500, { error: 'Failed to update subscription' });
          return;
        }
        const user = dbSelect(`SELECT visitor_id,name,email,learning_style,level,xp,plan_name,plan_price,plan_status,plan_started FROM users WHERE visitor_id=${sqlEsc(claims.visitorId)} LIMIT 1;`)[0];
        sendJson(res, 200, { status: 'ok', user: sanitizeUserRow(user) });
        return;
      }

      if (pathname === '/api/chat') {
        const message = String(body.message || '').trim();
        const subject = String(body.subject || 'General').trim() || 'General';
        const learningStyle = String(body.learningStyle || 'Newbie').trim() || 'Newbie';
        const userLevel = String(body.userLevel || 'Newbie').trim() || 'Newbie';
        const visitorId = String(body.visitorId || '').trim();
        const excludeEngine = String(body.excludeEngine || '').trim();
        const incomingHistory = normalizeHistory(body.history);
        const attachments = normalizeAttachments(body.attachments);

        if (!message) {
          sendJson(res, 400, { error: 'message is required' });
          return;
        }

        if (visitorId) {
          const visitorRate = checkLimit(visitorLimiter, visitorId, VISITOR_WINDOW_MS, VISITOR_MAX);
          if (!visitorRate.allowed) {
            sendJson(res, 429, { error: 'Too many requests for this visitor', retryAfterMs: visitorRate.retryAfterMs });
            return;
          }
        }

        recordChat(visitorId, subject);
        if (visitorId) {
          dbRun(
            `INSERT OR REPLACE INTO visitor_sessions (visitor_id,first_seen,last_seen,ip_address)
             VALUES (
               ${sqlEsc(visitorId)},
               COALESCE((SELECT first_seen FROM visitor_sessions WHERE visitor_id=${sqlEsc(visitorId)}), datetime('now')),
               datetime('now'),
               ${sqlEsc(ip)}
             );`
          );
        }
        persistStats();

        const mergedHistory = getConversationMemory(visitorId, incomingHistory);
        const finalMessage = buildFinalUserMessage(message, attachments);
        const chat = await buildChat(finalMessage, subject, userLevel || learningStyle, excludeEngine || null, mergedHistory);
        updateConversationMemory(visitorId, finalMessage, chat.reply);
        if (visitorId) {
          dbRun(
            `INSERT INTO chats (visitor_id,subject,user_level,learning_style,engine,model,message,reply,created_at)
             VALUES (${sqlEsc(visitorId)},${sqlEsc(subject)},${sqlEsc(userLevel)},${sqlEsc(learningStyle)},${sqlEsc(chat.engine)},${sqlEsc(chat.model)},${sqlEsc(finalMessage)},${sqlEsc(chat.reply)},datetime('now'));`
          );
        }
        sendJson(res, 200, {
          status: 'ok',
          reply: chat.reply,
          engine: chat.engine,
          model: chat.model,
          stats: summarizeStats(),
        });
        return;
      }

      if (pathname === '/api/quiz-question') {
        const subject = String(body.subject || 'Math').trim() || 'Math';
        const question = await generateQuizQuestion(subject);
        sendJson(res, 200, question);
        return;
      }

      if (pathname === '/api/quiz') {
        const subject = String(body.subject || 'Math').trim() || 'Math';
        const count = Number(body.count) || 5;
        const askedQuestions = Array.isArray(body.askedQuestions) ? body.askedQuestions : [];
        const questions = await generateQuiz(subject, count, askedQuestions);
        sendJson(res, 200, questions);
        return;
      }

      sendText(res, 404, 'Not found');
    } catch (error) {
      if (error?.message === 'Request body too large') {
        sendJson(res, 413, { error: 'Request body too large' });
        return;
      }
      if (error?.message === 'Invalid JSON body') {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      sendJson(res, 400, { error: 'Bad request' });
    }
    return;
  }

  sendText(res, 405, 'Method not allowed');
});

ensureDatabase();

server.listen(PORT, () => {
  console.log(`MindMesh server running at http://localhost:${PORT}`);
});

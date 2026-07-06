require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

const port = process.env.PORT || 3000;
const rootDir = __dirname;
const statsFile = path.join(rootDir, 'stats.json');
const ADMIN_KEY = process.env.ADMIN_KEY || '';

const GROQ_MODEL = process.env.GROQ_MODEL || process.env.GROQ_MODEL_NAME || 'llama-3.3-70b-versatile';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MODEL_LABEL = process.env.GROQ_MODEL_LABEL || GROQ_MODEL;

const groqClient = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const anthropicClient = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

const ENGINES = {
  reasoner: { name: 'Reasoner', provider: 'Groq', model: GROQ_MODEL, client: groqClient },
  solver: { name: 'Solver', provider: 'Groq (standing in for Gemini)', model: GROQ_MODEL, client: groqClient },
  explorer: { name: 'Explorer', provider: 'OpenAI', model: OPENAI_MODEL, client: openaiClient },
  storyteller: { name: 'Storyteller', provider: 'Anthropic', model: ANTHROPIC_MODEL, client: anthropicClient },
};

function buildSystemPrompt(subject, userLevel) {
  return `You are Hungter, an AI tutor. You ONLY help with educational topics: schoolwork, academic subjects, study skills, and learning ${subject || 'general topics'}. If the user asks about anything unrelated to learning or education, politely decline and redirect them to ask a study-related question instead - do not answer the off-topic request.

You are helping a student at the "${userLevel || 'Newbie'}" level.
- Newbie/Learner: explain concepts simply with basic examples.
- Explorer/Scholar: give more detailed explanations with worked examples.
- Master: offer advanced insights and complex problem-solving.

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
    model, max_tokens: 400, system: systemPrompt, messages: [{ role: 'user', content: message }],
  });
  const textBlock = response.content?.find((block) => block.type === 'text');
  return textBlock?.text?.trim() || null;
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
    console.error(`${engine.name} (${engine.provider}) call failed:`, error.message);
    return { name: engine.name, reply: null };
  }
}

async function classifyMessage(message, subject) {
  if (!groqClient) return 'GENERAL';
  try {
    const response = await groqClient.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: `Classify the student's message into exactly one category. Reply with ONLY the category word, nothing else.
Categories:
MATH - math, coding, physics, or step-by-step problem solving
EXAMPLES - wants real-world examples, practical applications, or research-style detail
STORY - wants a story, analogy, poem, or creative explanation
COMPLEX - a genuinely hard, multi-part, or ambiguous question that would benefit from more than one perspective
GENERAL - anything else, including simple conceptual questions` },
        { role: 'user', content: `Subject: ${subject || 'General'}\nMessage: ${message}` },
      ],
      max_tokens: 5, temperature: 0,
    });
    const raw = (response.choices?.[0]?.message?.content || '').trim().toUpperCase();
    const categories = ['MATH', 'EXAMPLES', 'STORY', 'COMPLEX', 'GENERAL'];
    return categories.find((c) => raw.includes(c)) || 'GENERAL';
  } catch (error) {
    console.error('Classifier failed:', error.message);
    return 'GENERAL';
  }
}

const CATEGORY_TO_ENGINE = { MATH: 'solver', EXAMPLES: 'explorer', STORY: 'storyteller', GENERAL: 'reasoner' };

async function answerSmart({ message, subject, userLevel, excludeEngine }) {
  const category = await classifyMessage(message, subject);

  if (category === 'COMPLEX') {
    const secondaryKey = ENGINES.storyteller.client ? 'storyteller' : (ENGINES.explorer.client ? 'explorer' : 'solver');
    const [a, b] = await Promise.all([
      callOneEngine('reasoner', message, subject, userLevel),
      callOneEngine(secondaryKey, message, subject, userLevel),
    ]);
    const successful = [a, b].filter((r) => r.reply).filter((r, i, arr) => arr.findIndex((x) => x.name === r.name) === i);
    if (successful.length) {
      const merged = successful.map((r) => `**${r.name}:**\n${r.reply}`).join('\n\n---\n\n');
      return { reply: merged, engines: successful.map((r) => r.name) };
    }
  } else {
    let primaryKey = CATEGORY_TO_ENGINE[category] || 'reasoner';
    if (excludeEngine && ENGINES[primaryKey]?.name === excludeEngine) {
      const alt = ['reasoner', 'explorer', 'storyteller'].find((k) => ENGINES[k].name !== excludeEngine && ENGINES[k].client);
      if (alt) primaryKey = alt;
    }
    const result = await callOneEngine(primaryKey, message, subject, userLevel);
    if (result.reply) return { reply: result.reply, engines: [result.name] };
  }

  const fallback = await callOneEngine('reasoner', message, subject, userLevel);
  if (fallback.reply) return { reply: fallback.reply, engines: [fallback.name] };

  return { reply: `Demo mode answer for ${subject || 'your topic'}: Keep practicing and review one concept at a time to master it!`, engines: ['Reasoner'] };
}

async function runRoundtableDebate({ message, subject, userLevel }) {
  const availableKeys = ['reasoner', 'explorer', 'storyteller'].filter((k) => ENGINES[k].client);
  if (availableKeys.length < 2) {
    const solo = await answerSmart({ message, subject, userLevel });
    return { transcript: [], finalAnswer: solo.reply, engines: solo.engines };
  }
  const basePrompt = buildSystemPrompt(subject, userLevel);

  const round1 = await Promise.all(availableKeys.map(async (key) => {
    const engine = ENGINES[key];
    const prompt = `${message}\n\nGive your take on how to best explain this, in 2-3 sentences.`;
    let text = null;
    try {
      if (key === 'reasoner') text = await callGroq(engine.client, engine.model, basePrompt, prompt);
      else if (key === 'explorer') text = await callOpenAI(engine.client, engine.model, basePrompt, prompt);
      else text = await callAnthropic(engine.client, engine.model, basePrompt, prompt);
    } catch (e) { console.error(`Round 1 (${engine.name}) failed:`, e.message); }
    return { key, name: engine.name, text };
  }));
  const round1Valid = round1.filter((r) => r.text);
  if (!round1Valid.length) return { transcript: [], finalAnswer: `Demo mode answer for ${subject || 'your topic'}: Keep practicing!`, engines: ['Reasoner'] };

  const round2 = await Promise.all(round1Valid.map(async (r) => {
    const engine = ENGINES[r.key];
    const others = round1Valid.filter((o) => o.key !== r.key).map((o) => `${o.name}: ${o.text}`).join('\n');
    const prompt = `Other tutors said, about explaining "${message}":\n${others}\n\nIn 1-2 sentences, briefly agree, disagree, or add something they missed.`;
    let text = null;
    try {
      if (r.key === 'reasoner') text = await callGroq(engine.client, engine.model, basePrompt, prompt);
      else if (r.key === 'explorer') text = await callOpenAI(engine.client, engine.model, basePrompt, prompt);
      else text = await callAnthropic(engine.client, engine.model, basePrompt, prompt);
    } catch (e) { console.error(`Round 2 (${engine.name}) failed:`, e.message); }
    return { key: r.key, name: r.name, text: text || '(no response)' };
  }));

  const fullTranscript = [
    ...round1Valid.map((r) => `${r.name} (Round 1): ${r.text}`),
    ...round2.map((r) => `${r.name} (Round 2): ${r.text}`),
  ].join('\n');

  let finalAnswer = null;
  if (groqClient) {
    try {
      finalAnswer = await callGroq(groqClient, GROQ_MODEL, basePrompt, `Here is a debate between 3 AI tutors about how to answer a student's question: "${message}"\n\n${fullTranscript}\n\nWrite ONE final, clear answer for the student (2-4 sentences), combining the best of what they said.`);
    } catch (e) { console.error('Final synthesis failed:', e.message); }
  }
  if (!finalAnswer) finalAnswer = round1Valid[0].text;

  return {
    transcript: [
      ...round1Valid.map((r) => ({ round: 1, engine: r.name, text: r.text })),
      ...round2.map((r) => ({ round: 2, engine: r.name, text: r.text })),
    ],
    previews: round1Valid.map((r) => ({ engine: r.key, name: r.name, preview: r.text })),
    finalAnswer,
    engines: round1Valid.map((r) => r.name),
  };
}

// Guess Paper generator: 3 engines each write a portion, merged into one original practice paper.
async function generateGuessPaper({ section, subject, paperFormat, chapter }) {
  const chapterFocus = chapter ? ` Focus specifically on the topic: ${chapter}.` : '';
  const basePrompt = `You are helping create an ORIGINAL practice exam paper for a ${section} ${subject} student.${chapterFocus} This is NOT a copy of any real exam board paper - write entirely new, original questions in the style and difficulty of a real ${section} exam. Format: ${paperFormat || 'standard exam paper, mixed question types'}. Always include a separate "Answer Key" section after your questions.`;
  const assignments = [
    { key: 'reasoner', instruction: 'Write 2 calculation/problem-solving questions with an answer key.' },
    { key: 'explorer', instruction: 'Write 2 applied/real-world scenario questions with an answer key.' },
    { key: 'storyteller', instruction: 'Write 2 extended-response/essay-style questions with an answer key.' },
  ];
  const results = await Promise.all(assignments.map(async ({ key, instruction }) => {
    const engine = ENGINES[key];
    if (!engine.client) return null;
    try {
      const fullPrompt = `${basePrompt}\n\n${instruction}`;
      let text;
      if (key === 'reasoner') text = await callGroq(engine.client, engine.model, basePrompt, fullPrompt);
      else if (key === 'explorer') text = await callOpenAI(engine.client, engine.model, basePrompt, fullPrompt);
      else text = await callAnthropic(engine.client, engine.model, basePrompt, fullPrompt);
      return text ? { name: engine.name, text } : null;
    } catch (error) {
      console.error(`Guess paper section (${engine.name}) failed:`, error.message);
      return null;
    }
  }));
  const successful = results.filter(Boolean);
  if (!successful.length) return { paper: 'Unable to generate a guess paper right now - please try again later.', generatedBy: [] };
  const paper = successful.map((r) => r.text).join('\n\n') + `\n\n---\nGenerated by AI (${successful.map((r) => r.name).join(', ')}) — original practice content, not an official exam paper.`;
  return { paper, generatedBy: successful.map((r) => r.name) };
}

const REQUIRE_PRO_FOR_GUESS_PAPERS = false;

function getEngineAvailability() {
  return { reasoner: Boolean(groqClient), solver: false, explorer: Boolean(openaiClient), storyteller: Boolean(anthropicClient) };
}

// ---------- stats / analytics ----------
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 15;

function emptyStats() { return { visitors: {}, dailyChats: {}, subjects: {}, totalChats: 0, rateLimits: {} }; }

function checkAndRecordRateLimit(stats, visitorId, now = Date.now()) {
  if (!stats.rateLimits) stats.rateLimits = {};
  if (!visitorId) return { allowed: true };
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const recent = (stats.rateLimits[visitorId] || []).filter((ts) => ts > windowStart);
  if (recent.length >= RATE_LIMIT_MAX) {
    stats.rateLimits[visitorId] = recent;
    return { allowed: false, retryAfterMs: Math.max(1000, RATE_LIMIT_WINDOW_MS - (now - recent[0])) };
  }
  recent.push(now);
  stats.rateLimits[visitorId] = recent;
  return { allowed: true };
}

function todayKey(date = new Date()) { return date.toISOString().slice(0, 10); }
function monthKey(date = new Date()) { return date.toISOString().slice(0, 7); }
function touchVisitor(stats, visitorId, now = Date.now()) {
  if (!visitorId) return;
  const existing = stats.visitors[visitorId];
  stats.visitors[visitorId] = { first: existing?.first ?? now, last: now };
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
function summarize(stats) {
  const now = Date.now(); const today = todayKey(); const month = monthKey();
  const visitors = Object.values(stats.visitors || {})
    .map((v) => ({
      first: Number(v?.first || 0),
      last: Number(v?.last || 0),
    }))
    .filter((v) => Number.isFinite(v.last) && v.last > 0);
  const activeNow = visitors.filter((v) => now - v.last <= ACTIVE_WINDOW_MS).length;
  const dailyActiveUsers = visitors.filter((v) => todayKey(new Date(v.last)) === today).length;
  const monthlyActiveUsers = visitors.filter((v) => monthKey(new Date(v.last)) === month).length;
  const dailyChats = stats.dailyChats || {};
  const chatsToday = dailyChats[today] || 0;
  const chatsThisMonth = Object.entries(dailyChats).filter(([day]) => day.startsWith(month)).reduce((sum, [, c]) => sum + c, 0);
  const topSubjects = Object.entries(stats.subjects || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([subject, count]) => ({ subject, count }));
  return { totalVisitors: visitors.length, activeNow, dailyActiveUsers, monthlyActiveUsers, totalChats: stats.totalChats || 0, chatsToday, chatsThisMonth, topSubjects };
}

const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 60 * 1000);
const RATE_MAX = Number(process.env.RATE_MAX || 20);
const rateMap = new Map();
function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return xf.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) { rateMap.set(ip, { count: 1, windowStart: now }); return false; }
  entry.count += 1;
  return entry.count > RATE_MAX;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
}
function sendFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      const notFoundPath = path.join(rootDir, '404.html');
      fs.readFile(notFoundPath, (err2, data2) => {
        if (err2) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(data2);
      });
      return;
    }
    const ext = path.extname(filePath);
    const contentType = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType }); res.end(data);
  });
}
function loadStats() {
  try {
    const parsed = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
    return (parsed && typeof parsed.visitors === 'object') ? parsed : emptyStats();
  } catch { return emptyStats(); }
}
function saveStats() { fs.writeFile(statsFile, JSON.stringify(visitorStats, null, 2), (e) => { if (e) console.error('Unable to save stats:', e.message); }); }
function getStatusSummary() { return { ...summarize(visitorStats), model: MODEL_LABEL }; }
function registerVisitor(visitorId) { if (visitorId) { recordVisit(visitorStats, visitorId); saveStats(); } return getStatusSummary(); }
function recordChatEvent(visitorId, subject) { recordChatStat(visitorStats, visitorId, subject); saveStats(); }

function parseJsonSafe(text) {
  try { return JSON.parse(text); } catch {
    const match = text.match(/(\[.*\])/s);
    if (match) { try { return JSON.parse(match[1]); } catch { return null; } }
    return null;
  }
}
function getDemoQuiz(subject, count = 5) {
  const g = { question: `What is the most important idea in ${subject}?`, options: ['A) It helps people solve problems', 'B) It is only interesting for experts', 'C) It cannot be used in real life', 'D) It is always boring'], correct: 'A', explanation: `The best answer is A because ${subject} is useful for real-world thinking and problem solving.` };
  return Array.from({ length: count }, () => ({ ...g }));
}
async function generateQuiz(subject, count = 5, askedQuestions = [], chapter, bookContext) {
  if (!groqClient) return getDemoQuiz(subject, count);
  const filteredAsked = Array.isArray(askedQuestions) ? askedQuestions.filter((i) => typeof i === 'string' && i.trim().length > 5) : [];
  try {
    const chapterPrompt = chapter || bookContext
      ? ` Focus on the topic '${chapter || subject}' as covered in a book like '${bookContext || 'general coursebook'}'. Do not quote or reproduce any text from that book - write entirely original questions.`
      : '';
    const prompt = `Generate ${count} multiple choice questions for a student learning ${subject}.${chapterPrompt} Avoid repeating any questions the student has already answered. Previously asked questions: ${filteredAsked.slice(-20).join(' | ')}. Return ONLY valid JSON in this exact format: [{"question": "...","options": ["A)...","B)...","C)...","D)..."],"correct":"A","explanation":"..."}]`;
    const response = await groqClient.chat.completions.create({ model: GROQ_MODEL, messages: [{ role: 'system', content: 'You are a quiz generator. Only output valid JSON.' }, { role: 'user', content: prompt }], max_tokens: 1024 });
    const content = response.choices?.[0]?.message?.content || '';
    const data = Array.isArray(parseJsonSafe(content)) ? parseJsonSafe(content) : [];
    const unique = data.filter((item) => {
      if (!item || typeof item.question !== 'string') return false;
      const q = item.question.trim().toLowerCase();
      return !filteredAsked.some((a) => { const at = a.trim().toLowerCase(); return q.includes(at) || at.includes(q); });
    });
    if (unique.length >= count) return unique.slice(0, count);
    return unique.concat(getDemoQuiz(subject, count)).slice(0, count);
  } catch (error) { console.error('Quiz generation failed:', error.message); return getDemoQuiz(subject, count); }
}
async function generateQuizQuestion(subject) {
  const questions = await generateQuiz(subject, 1);
  return questions[0] || { question: `Which prompt best describes ${subject}?`, options: ['A) A fun topic', 'B) A topic with no meaning', 'C) A subject to avoid', 'D) A field only for experts'], correct: 'A', explanation: `Answer A because ${subject} is meant to help learners grow.` };
}

async function generateBookFlashcards({ subject, chapter, bookContext }) {
  const topic = chapter || subject;
  const basePrompt = `Create flashcards (front/back pairs) for a student studying "${topic}"${bookContext ? ` from a book like "${bookContext}"` : ''}. Do NOT quote or reproduce any text from that book - write entirely original flashcard content in your own words, testing the same topic. Return ONLY valid JSON: [{"front":"...","back":"..."}]`;
  const assignments = [
    { key: 'reasoner', instruction: 'Write 3 flashcards focused on core definitions/facts.' },
    { key: 'explorer', instruction: 'Write 3 flashcards focused on applied examples.' },
    { key: 'storyteller', instruction: 'Write 3 flashcards focused on memorable analogies.' },
  ];
  const results = await Promise.all(assignments.map(async ({ key, instruction }) => {
    const engine = ENGINES[key];
    if (!engine.client) return [];
    try {
      const fullPrompt = `${basePrompt}\n\n${instruction}`;
      let text;
      if (key === 'reasoner') text = await callGroq(engine.client, engine.model, basePrompt, fullPrompt);
      else if (key === 'explorer') text = await callOpenAI(engine.client, engine.model, basePrompt, fullPrompt);
      else text = await callAnthropic(engine.client, engine.model, basePrompt, fullPrompt);
      const parsed = parseJsonSafe(text || '');
      return Array.isArray(parsed) ? parsed.filter((c) => c && c.front && c.back) : [];
    } catch (error) {
      console.error(`Flashcard generation (${engine.name}) failed:`, error.message);
      return [];
    }
  }));
  const cards = results.flat();
  if (!cards.length) return [{ front: `What is the key idea in ${topic}?`, back: 'Review this topic with the AI tutor chat for a full explanation.' }];
  return cards;
}
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { if (!body) return resolve({}); try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON body')); } });
    req.on('error', reject);
  });
}

const visitorStats = loadStats();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === 'GET') {
    if (pathname === '/' || pathname === '/index.html') return sendFile(res, path.join(rootDir, 'index.html'));
    const cleanedPath = path.normalize(pathname).replace(/^\.{2,}(?:[\/\\]|$)/, '');
    const requestedPath = cleanedPath.slice(1);
    const filePath = path.join(rootDir, requestedPath);
    const ext = path.extname(filePath).toLowerCase();
    if (requestedPath && ['.css', '.js', '.png', '.svg', '.ico', '.json'].includes(ext)) return sendFile(res, filePath);
    if (pathname.endsWith('.html')) return sendFile(res, filePath);
    if (pathname === '/health') return sendJson(res, 200, { status: 'ok' });
    if (pathname === '/api/status') return sendJson(res, 200, { status: 'ok', model: MODEL_LABEL, engines: getEngineAvailability(), stats: getStatusSummary() });
    if (pathname === '/api/admin-stats') {
      const providedKey = req.headers['x-admin-key'] || url.searchParams.get('key') || '';
      if (!ADMIN_KEY || providedKey !== ADMIN_KEY) return sendJson(res, 401, { error: 'Unauthorized' });
      return sendJson(res, 200, { ...summarize(visitorStats), purchases: { count: 0, status: 'Stripe not connected yet' } });
    }
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  if (req.method === 'POST' && pathname === '/api/visit') {
    try {
      if (isRateLimited(getClientIp(req))) return sendJson(res, 429, { error: 'Rate limit exceeded' });
      const payload = await parseRequestBody(req);
      return sendJson(res, 200, { status: 'ok', stats: registerVisitor(payload.visitorId) });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }

  if (req.method === 'POST' && pathname === '/api/chat') {
    try {
      if (isRateLimited(getClientIp(req))) return sendJson(res, 429, { error: 'Rate limit exceeded' });
      const payload = await parseRequestBody(req);
      const message = (payload.message || '').trim();
      const subject = payload.subject || 'General';
      const userLevel = payload.userLevel || 'Newbie';
      if (!message) return sendJson(res, 400, { error: 'A message is required.' });
      const rl = checkAndRecordRateLimit(visitorStats, payload.visitorId);
      if (!rl.allowed) return sendJson(res, 429, { error: "You're sending messages too quickly. Please wait a moment and try again.", retryAfterMs: rl.retryAfterMs });
      recordChatEvent(payload.visitorId, subject);

      const { reply, engines } = await answerSmart({ message, subject, userLevel, excludeEngine: payload.excludeEngine });
      return sendJson(res, 200, { status: 'ok', reply, engine: engines.join(', '), model: MODEL_LABEL, stats: getStatusSummary() });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }

  if (req.method === 'POST' && pathname === '/api/roundtable') {
    try {
      if (isRateLimited(getClientIp(req))) return sendJson(res, 429, { error: 'Rate limit exceeded' });
      const payload = await parseRequestBody(req);
      const message = (payload.message || '').trim();
      if (!message) return sendJson(res, 400, { error: 'A message is required.' });
      const result = await runRoundtableDebate({ message, subject: payload.subject || 'General', userLevel: payload.userLevel || 'Newbie' });
      return sendJson(res, 200, { status: 'ok', ...result });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }

  if (req.method === 'POST' && pathname === '/api/chat-expand') {
    try {
      const payload = await parseRequestBody(req);
      const { engineKey, message, subject, userLevel } = payload;
      if (!engineKey || !message) return sendJson(res, 400, { error: 'engineKey and message are required.' });
      const result = await callOneEngine(engineKey, message, subject, userLevel);
      return sendJson(res, 200, { status: 'ok', reply: result.reply || 'Unable to expand this answer right now.', engine: result.name });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }

  if (req.method === 'POST' && pathname === '/api/explain-check') {
    try {
      const payload = await parseRequestBody(req);
      const { concept, studentExplanation } = payload;
      if (!concept || !studentExplanation) return sendJson(res, 400, { error: 'concept and studentExplanation are required.' });
      if (!groqClient) return sendJson(res, 200, { understood: true, feedback: 'Nice explanation!' });
      const gradingPrompt = `A student is trying to explain this concept back in their own words: "${concept}". Their explanation: "${studentExplanation}". In ONE short sentence, say whether they show real understanding and give one word of encouragement or a gentle correction.`;
      const response = await groqClient.chat.completions.create({ model: GROQ_MODEL, messages: [{ role: 'system', content: 'You are a supportive tutor grading a student explanation briefly.' }, { role: 'user', content: gradingPrompt }], max_tokens: 60, temperature: 0.3 });
      const feedback = response.choices?.[0]?.message?.content?.trim() || 'Good effort!';
      return sendJson(res, 200, { understood: true, feedback });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }

  if (req.method === 'POST' && pathname === '/api/guess-paper') {
    try {
      if (isRateLimited(getClientIp(req))) return sendJson(res, 429, { error: 'Rate limit exceeded' });
      const payload = await parseRequestBody(req);
      if (REQUIRE_PRO_FOR_GUESS_PAPERS && (payload.plan || 'free') !== 'pro') {
        return sendJson(res, 403, { error: 'Guess Papers are a Student Pro feature. Upgrade to unlock.' });
      }
      const { section, subject, paperFormat, chapter } = payload;
      if (!section || !subject) return sendJson(res, 400, { error: 'section and subject are required.' });
      const result = await generateGuessPaper({ section, subject, paperFormat, chapter });
      return sendJson(res, 200, { status: 'ok', ...result });
    } catch (error) {
      console.error('Guess paper endpoint failed:', error.message);
      return sendJson(res, 500, { error: 'Guess paper generation failed. Please try again.' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/book-flashcards') {
    try {
      if (isRateLimited(getClientIp(req))) return sendJson(res, 429, { error: 'Rate limit exceeded' });
      const payload = await parseRequestBody(req);
      const { subject, chapter, bookContext } = payload;
      if (!subject) return sendJson(res, 400, { error: 'subject is required.' });
      const cards = await generateBookFlashcards({ subject, chapter, bookContext });
      return sendJson(res, 200, { status: 'ok', cards });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }

  if (req.method === 'POST' && pathname === '/api/quiz-question') {
    try {
      if (isRateLimited(getClientIp(req))) return sendJson(res, 429, { error: 'Rate limit exceeded' });
      const payload = await parseRequestBody(req);
      return sendJson(res, 200, await generateQuizQuestion(payload.subject || 'Math'));
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }

  if (req.method === 'POST' && pathname === '/api/quiz') {
    try {
      if (isRateLimited(getClientIp(req))) return sendJson(res, 429, { error: 'Rate limit exceeded' });
      const payload = await parseRequestBody(req);
      const questions = await generateQuiz(
        payload.subject || 'Math',
        Number(payload.count) || 5,
        Array.isArray(payload.askedQuestions) ? payload.askedQuestions : [],
        payload.chapter || '',
        payload.bookContext || ''
      );
      return sendJson(res, 200, questions);
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, () => console.log(`Website running at http://localhost:${port}`));

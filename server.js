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

async function callGroq(client, model, systemPrompt, message, history = []) {
  const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: message }];
  const response = await client.chat.completions.create({
    model, messages, max_tokens: 700, temperature: 0.7,
  });
  return response.choices?.[0]?.message?.content?.trim() || null;
}

async function callOpenAI(client, model, systemPrompt, userContent, history = []) {
  const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userContent }];
  const response = await client.chat.completions.create({
    model, messages, max_tokens: 700,
  });
  return response.choices?.[0]?.message?.content?.trim() || null;
}

async function callAnthropic(client, model, systemPrompt, userContent, history = []) {
  const messages = [...history, { role: 'user', content: userContent }];
  const response = await client.messages.create({
    model, max_tokens: 700, system: systemPrompt, messages,
  });
  const textBlock = response.content?.find((block) => block.type === 'text');
  return textBlock?.text?.trim() || null;
}

// Build the user message content — handles text files and vision (images) per provider.
function buildUserContent(message, attachments, provider) {
  const images = (attachments || []).filter((a) => a.kind === 'image' && a.imageDataUrl);
  const files = (attachments || []).filter((a) => a.kind !== 'image' && a.textContent);
  let text = message;
  if (files.length) {
    text += '\n\n' + files.map((f) => `[File: ${f.name}]\n${f.textContent}`).join('\n\n');
  }
  if (!images.length) return text;
  if (provider === 'openai') {
    const content = [{ type: 'text', text }];
    for (const img of images.slice(0, 3)) {
      content.push({ type: 'image_url', image_url: { url: img.imageDataUrl } });
    }
    return content;
  }
  if (provider === 'anthropic') {
    const content = [{ type: 'text', text }];
    for (const img of images.slice(0, 3)) {
      const match = img.imageDataUrl.match(/^data:([^;]+);base64,(.+)$/s);
      if (!match) continue;
      content.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
    }
    return content;
  }
  // Groq / Llama — no vision; embed as a text note
  text += `\n\n[Note: The student attached ${images.length} image(s). Acknowledge this and ask them to describe the key parts in text so you can help.]`;
  return text;
}

async function callOneEngine(key, message, subject, userLevel, history = [], attachments = []) {
  const engine = ENGINES[key];
  if (!engine.client) return { name: engine.name, reply: null };
  const systemPrompt = buildSystemPrompt(subject, userLevel);
  const provider = key === 'explorer' ? 'openai' : key === 'storyteller' ? 'anthropic' : 'groq';
  const userContent = buildUserContent(message, attachments, provider);
  try {
    let reply;
    if (key === 'reasoner' || key === 'solver') reply = await callGroq(engine.client, engine.model, systemPrompt, typeof userContent === 'string' ? userContent : message, history);
    else if (key === 'explorer') reply = await callOpenAI(engine.client, engine.model, systemPrompt, userContent, history);
    else reply = await callAnthropic(engine.client, engine.model, systemPrompt, userContent, history);
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

async function answerSmart({ message, subject, userLevel, excludeEngine, history = [], attachments = [] }) {
  const category = await classifyMessage(message, subject);

  // Route image-containing messages to vision-capable engines first
  const hasImages = attachments.some((a) => a.kind === 'image' && a.imageDataUrl);
  if (hasImages) {
    const visionKey = ENGINES.explorer.client ? 'explorer' : ENGINES.storyteller.client ? 'storyteller' : null;
    if (visionKey) {
      const result = await callOneEngine(visionKey, message, subject, userLevel, history, attachments);
      if (result.reply) return { reply: result.reply, engines: [result.name] };
    }
  }

  if (category === 'COMPLEX') {
    const secondaryKey = ENGINES.storyteller.client ? 'storyteller' : (ENGINES.explorer.client ? 'explorer' : 'solver');
    const [a, b] = await Promise.all([
      callOneEngine('reasoner', message, subject, userLevel, history, attachments),
      callOneEngine(secondaryKey, message, subject, userLevel, history, attachments),
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
    const result = await callOneEngine(primaryKey, message, subject, userLevel, history, attachments);
    if (result.reply) return { reply: result.reply, engines: [result.name] };
  }

  const fallback = await callOneEngine('reasoner', message, subject, userLevel, history, attachments);
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
  if (!successful.length) {
    const topic = chapter || subject;
    const demoPaper = [
      `${section} ${subject} — Practice Paper (Demo Mode)`,
      `Time allowed: ${paperFormat || '60 minutes'}`,
      '',
      `1. Define the key idea of ${topic} in your own words, and give one everyday example.`,
      `2. A student claims ${topic} only matters in exams. Give two real-world situations that prove them wrong.`,
      `3. Explain one common mistake students make when working on ${topic}, and how to avoid it.`,
      `4. Write a short worked example (with steps) involving ${topic}.`,
      '',
      'Answer Key',
      '1-4: Open-ended — compare your answers with the AI tutor in chat for feedback.',
      '',
      '---',
      'Demo paper (no AI engines connected). Set GROQ_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY on the server for full AI-generated papers.',
    ].join('\n');
    return { paper: demoPaper, generatedBy: ['Demo'] };
  }
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

async function generateChapterNotes({ subject, chapter, bookContext, userLevel }) {
  const topic = chapter || subject;
  const systemPrompt = `You are Hungter, an AI tutor writing complete revision notes. Write entirely original explanations in your own words — do NOT quote or reproduce text from any textbook${bookContext ? ` (including "${bookContext}")` : ''}. The student is at the "${userLevel || 'Newbie'}" level; adjust depth accordingly.`;
  const userPrompt = `Write complete revision notes for the topic "${topic}" in ${subject}. Structure them EXACTLY like this, using these headings:

OVERVIEW
2-3 sentences on what this topic is and why it matters.

KEY POINTS
6-10 bullet points covering the main ideas a student must know.

FORMULAS & DEFINITIONS
Every important formula (with each symbol explained) and key term definition. If the topic has no formulas, give the key definitions and rules instead.

COMMON MISTAKES
3-4 mistakes students typically make on this topic and how to avoid them.

EXAM TIPS
2-3 practical tips for answering exam questions on this topic.`;

  // Try the strongest available engine first, fall back through the rest.
  const order = [
    { key: 'storyteller', call: () => anthropicClient.messages.create({ model: ANTHROPIC_MODEL, max_tokens: 1400, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }).then((r) => r.content?.find((b) => b.type === 'text')?.text?.trim() || null) },
    { key: 'explorer', call: () => openaiClient.chat.completions.create({ model: OPENAI_MODEL, max_tokens: 1400, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }).then((r) => r.choices?.[0]?.message?.content?.trim() || null) },
    { key: 'reasoner', call: () => groqClient.chat.completions.create({ model: GROQ_MODEL, max_tokens: 1400, temperature: 0.5, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }).then((r) => r.choices?.[0]?.message?.content?.trim() || null) },
  ];

  for (const engine of order) {
    if (!ENGINES[engine.key]?.client) continue;
    try {
      const notes = await engine.call();
      if (notes) return { notes, engine: ENGINES[engine.key].name };
    } catch (error) {
      console.error(`Chapter notes (${ENGINES[engine.key].name}) failed:`, error.message);
    }
  }

  return {
    notes: [
      `OVERVIEW`,
      `${topic} is a core part of ${subject}. (Demo mode — connect an AI API key for full notes.)`,
      ``,
      `KEY POINTS`,
      `- Ask the AI tutor in chat to explain ${topic} step by step.`,
      `- Take a quiz on this chapter to find your weak spots.`,
      ``,
      `Demo notes (no AI engines connected). Set GROQ_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY for complete AI-generated notes.`,
    ].join('\n'),
    engine: 'Demo',
  };
}
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { if (!body) return resolve({}); try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON body')); } });
    req.on('error', reject);
  });
}

// ---------- lightweight JSON-backed auth (no new npm dependency —
// database/schema.sql + init-db.sh describe a future SQLite version, but
// nothing wired it up yet, so /api/auth/* was 404ing and signup was broken) ----------
const crypto = require('crypto');
const usersFile = path.join(rootDir, 'database', 'users.json');

function loadUsersDb() {
  try {
    const parsed = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    if (!parsed || !Array.isArray(parsed.users)) return { users: [], tokens: {} };
    return { users: parsed.users, tokens: parsed.tokens || {} };
  } catch {
    return { users: [], tokens: {} };
  }
}

function saveUsersDb() {
  fs.mkdir(path.dirname(usersFile), { recursive: true }, () => {
    fs.writeFile(usersFile, JSON.stringify(usersDb, null, 2), (error) => {
      if (error) console.error('Unable to save users db:', error.message);
    });
  });
}

function hashPassword(password, existingSalt) {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, salt, hash) {
  try {
    const check = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

function findUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return usersDb.users.find((u) => u.email === normalized);
}

function findUserById(id) {
  return usersDb.users.find((u) => u.id === id);
}

function publicUser(user) {
  if (!user) return null;
  return {
    visitorId: user.visitorId,
    name: user.name,
    email: user.email,
    learningStyle: user.learningStyle,
    level: user.level,
    xp: user.xp,
    planName: user.planName,
    planPrice: user.planPrice,
    planStatus: user.planStatus,
    planStarted: user.planStarted,
  };
}

function getUserFromRequest(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return null;
  const userId = usersDb.tokens[token];
  if (userId === undefined) return null;
  return findUserById(userId);
}

const usersDb = loadUsersDb();
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
    if (pathname === '/api/auth/me') {
      const user = getUserFromRequest(req);
      if (!user) return sendJson(res, 401, { error: 'Not authenticated.' });
      return sendJson(res, 200, { status: 'ok', user: publicUser(user) });
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

  if (req.method === 'POST' && pathname === '/api/auth/signup') {
    try {
      if (isRateLimited(getClientIp(req))) return sendJson(res, 429, { error: 'Rate limit exceeded' });
      const payload = await parseRequestBody(req);
      const name = String(payload.name || '').trim();
      const email = String(payload.email || '').trim().toLowerCase();
      const password = String(payload.password || '');
      if (!name || name.length < 2) return sendJson(res, 400, { error: 'Please enter your name.' });
      if (!email || !email.includes('@')) return sendJson(res, 400, { error: 'Please enter a valid email.' });
      if (password.length < 8) return sendJson(res, 400, { error: 'Password must be at least 8 characters.' });
      if (findUserByEmail(email)) return sendJson(res, 409, { error: 'An account with this email already exists.' });

      const { hash, salt } = hashPassword(password);
      const user = {
        id: usersDb.users.length ? Math.max(...usersDb.users.map((u) => u.id)) + 1 : 1,
        visitorId: `user-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
        name,
        email,
        passwordHash: hash,
        passwordSalt: salt,
        learningStyle: payload.learningStyle || 'Visual',
        level: 'Newbie',
        xp: 0,
        planName: '',
        planPrice: 0,
        planStatus: 'inactive',
        planStarted: '',
      };
      usersDb.users.push(user);
      const token = crypto.randomBytes(32).toString('hex');
      usersDb.tokens[token] = user.id;
      saveUsersDb();
      return sendJson(res, 200, { status: 'ok', token, user: publicUser(user) });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    try {
      if (isRateLimited(getClientIp(req))) return sendJson(res, 429, { error: 'Rate limit exceeded' });
      const payload = await parseRequestBody(req);
      const email = String(payload.email || '').trim().toLowerCase();
      const password = String(payload.password || '');
      const user = findUserByEmail(email);
      if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
        return sendJson(res, 401, { error: 'Incorrect email or password.' });
      }
      const token = crypto.randomBytes(32).toString('hex');
      usersDb.tokens[token] = user.id;
      saveUsersDb();
      return sendJson(res, 200, { status: 'ok', token, user: publicUser(user) });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }

  if (req.method === 'POST' && pathname === '/api/profile') {
    try {
      const user = getUserFromRequest(req);
      if (!user) return sendJson(res, 401, { error: 'Not authenticated.' });
      const payload = await parseRequestBody(req);
      if (payload.name !== undefined) user.name = String(payload.name).trim();
      if (payload.learningStyle !== undefined) user.learningStyle = payload.learningStyle;
      if (payload.level !== undefined) user.level = payload.level;
      if (payload.xp !== undefined) user.xp = Number(payload.xp) || 0;
      saveUsersDb();
      return sendJson(res, 200, { status: 'ok', user: publicUser(user) });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }

  if (req.method === 'POST' && pathname === '/api/subscription') {
    try {
      const user = getUserFromRequest(req);
      if (!user) return sendJson(res, 401, { error: 'Not authenticated.' });
      const payload = await parseRequestBody(req);
      user.planName = payload.planName || user.planName;
      user.planPrice = Number(payload.planPrice ?? user.planPrice) || 0;
      user.planStatus = payload.planStatus || user.planStatus;
      user.planStarted = payload.planStarted || user.planStarted;
      saveUsersDb();
      return sendJson(res, 200, { status: 'ok', user: publicUser(user) });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }

  if (req.method === 'POST' && pathname === '/api/book-order') {
    try {
      if (isRateLimited(getClientIp(req))) return sendJson(res, 429, { error: 'Rate limit exceeded' });
      const payload = await parseRequestBody(req);
      const bookId = String(payload.bookId || '').trim();
      const bookTitle = String(payload.bookTitle || '').trim();
      const price = Number(payload.price || 0);
      const email = String(payload.email || '').trim().toLowerCase();
      if (!bookId || !bookTitle) return sendJson(res, 400, { error: 'bookId and bookTitle are required.' });
      if (!(price > 0)) return sendJson(res, 400, { error: 'A valid price is required.' });
      if (!email || !email.includes('@')) return sendJson(res, 400, { error: 'Please enter a valid email.' });

      const orderRef = `HB-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
      const order = { orderRef, bookId, bookTitle, price, email, status: 'pending', createdAt: new Date().toISOString() };
      const ordersFile = path.join(rootDir, 'database', 'book-orders.json');
      let orders = [];
      try { orders = JSON.parse(fs.readFileSync(ordersFile, 'utf8')); } catch { orders = []; }
      orders.push(order);
      fs.mkdir(path.dirname(ordersFile), { recursive: true }, () => {
        fs.writeFile(ordersFile, JSON.stringify(orders, null, 2), (error) => {
          if (error) console.error('Unable to save book order:', error.message);
        });
      });

      return sendJson(res, 200, {
        status: 'ok',
        orderRef,
        message: `Order recorded. Real payment processing is not connected yet — we will email you at ${email} with purchase instructions once billing is live.`,
      });
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

      // Normalize conversation history (max 12 turns, sanitized)
      const rawHistory = Array.isArray(payload.history) ? payload.history : [];
      const history = rawHistory
        .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.trim())
        .map((h) => ({ role: h.role, content: String(h.content).slice(0, 4000) }))
        .slice(-12);

      // Normalize attachments (text files + images, max 5)
      const rawAttachments = Array.isArray(payload.attachments) ? payload.attachments : [];
      const attachments = rawAttachments
        .filter((a) => a && (a.textContent || a.imageDataUrl))
        .map((a) => ({
          name: String(a.name || 'attachment').slice(0, 120),
          type: String(a.type || 'application/octet-stream').slice(0, 120),
          kind: a.kind === 'image' ? 'image' : 'file',
          textContent: String(a.textContent || '').slice(0, 12000),
          imageDataUrl: String(a.imageDataUrl || '').slice(0, 250000),
          size: Number(a.size) || 0,
        }))
        .slice(0, 5);

      const { reply, engines } = await answerSmart({ message, subject, userLevel, excludeEngine: payload.excludeEngine, history, attachments });
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

  if (req.method === 'POST' && pathname === '/api/chapter-notes') {
    try {
      if (isRateLimited(getClientIp(req))) return sendJson(res, 429, { error: 'Rate limit exceeded' });
      const payload = await parseRequestBody(req);
      const { subject, chapter, bookContext, userLevel } = payload;
      if (!subject) return sendJson(res, 400, { error: 'subject is required.' });
      const result = await generateChapterNotes({ subject, chapter, bookContext, userLevel });
      return sendJson(res, 200, { status: 'ok', ...result });
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

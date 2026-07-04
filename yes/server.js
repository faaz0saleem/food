require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');

const port = process.env.PORT || 3000;
const rootDir = __dirname;
const statsFile = path.join(rootDir, 'stats.json');
const SESSION_TIMEOUT_MS = 2 * 60 * 1000;
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const conversationHistory = [];

let groqClient = null;
if (process.env.GROQ_API_KEY) {
  groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
}

// Simple in-memory rate limiter (per-IP)
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 60 * 1000);
const RATE_MAX = Number(process.env.RATE_MAX || 20);
const rateMap = new Map(); // ip -> {count, windowStart}

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
    return JSON.parse(contents);
  } catch {
    return {
      totalVisitors: 0,
      dailyVisitors: [],
      actions: [],
    };
  }
}

function saveStats() {
  fs.writeFile(statsFile, JSON.stringify(visitorStats, null, 2), (error) => {
    if (error) {
      console.error('Unable to save stats:', error.message);
    }
  });
}

function cleanupStats() {
  const now = Date.now();
  visitorStats.dailyVisitors = visitorStats.dailyVisitors.filter(
    (visitor) => now - visitor.lastSeen <= DAILY_WINDOW_MS
  );

  if (visitorStats.actions.length > 200) {
    visitorStats.actions = visitorStats.actions.slice(-200);
  }

  for (const [id, session] of activeSessions.entries()) {
    if (now - session.lastSeen > SESSION_TIMEOUT_MS) {
      activeSessions.delete(id);
    }
  }
}

function getStatusSummary() {
  cleanupStats();
  const now = Date.now();
  const dailyChats = visitorStats.actions.filter(
    (action) => action.actionType === 'chat' && now - action.timestamp <= DAILY_WINDOW_MS
  ).length;

  return {
    activeUsers: activeSessions.size,
    dailyVisitors: visitorStats.dailyVisitors.length,
    totalVisitors: visitorStats.totalVisitors,
    totalChats: visitorStats.actions.filter((action) => action.actionType === 'chat').length,
    dailyChats,
    recentActions: visitorStats.actions.slice(-10).reverse(),
  };
}

function registerVisitor(visitorId, userAgent) {
  const now = Date.now();
  if (!visitorId) {
    return getStatusSummary();
  }

  const existing = visitorStats.dailyVisitors.find((visitor) => visitor.visitorId === visitorId);
  if (!existing) {
    visitorStats.totalVisitors += 1;
    visitorStats.dailyVisitors.push({
      visitorId,
      firstSeen: now,
      lastSeen: now,
      userAgent,
      hits: 1,
    });
  } else {
    existing.lastSeen = now;
    existing.hits += 1;
  }

  activeSessions.set(visitorId, { lastSeen: now, userAgent });
  saveStats();
  return getStatusSummary();
}

function addActionRecord(visitorId, actionType, details = {}) {
  const record = {
    timestamp: Date.now(),
    visitorId: visitorId || 'anonymous',
    actionType,
    details,
  };
  visitorStats.actions.push(record);
  saveStats();
  return record;
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
      model: 'llama-3.3-70b-versatile',
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

async function chatWithGroq(message, subject, userLevel) {
  if (!groqClient) {
    return `Demo mode answer for ${subject || 'your topic'}: Keep practicing and review one concept at a time to master it!`;
  }

  const systemPrompt = `You are an expert learning assistant helping a student who is at the "${userLevel}" level study ${subject || 'general topics'}. 
- For Newbie/Learner levels: Explain concepts simply with basic examples
- For Explorer/Scholar levels: Provide more detailed explanations with worked examples
- For Master level: Offer advanced insights and complex problem-solving

Be encouraging, clear, and keep responses concise (2-4 sentences). Use simple language.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.slice(-4), // Keep only last 4 messages for context
    { role: 'user', content: message },
  ];

  try {
    const response = await groqClient.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: 256,
      temperature: 0.7,
    });

    const reply = response.choices?.[0]?.message?.content?.trim() || 'I could not generate a response. Please try again.';
    conversationHistory.push({ role: 'user', content: message });
    conversationHistory.push({ role: 'assistant', content: reply });
    
    // Limit conversation history
    if (conversationHistory.length > 20) {
      conversationHistory.splice(0, 2);
    }
    
    return reply;
  } catch (error) {
    console.error('Groq API Error:', error.message);
    return `I'm having trouble responding right now. Error: ${error.message || 'API timeout'}. Please try again in a moment.`;
  }
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
const activeSessions = new Map();
setInterval(() => {
  cleanupStats();
  saveStats();
}, 20 * 1000);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

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
      sendJson(res, 200, { status: 'ok', stats: getStatusSummary() });
      return;
    }
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
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
      const visitorId = payload.visitorId;
      const userAgent = req.headers['user-agent'] || 'unknown';
      const summary = registerVisitor(visitorId, userAgent);
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
      registerVisitor(visitorId, req.headers['user-agent'] || 'unknown');
      addActionRecord(visitorId, 'chat', { message, subject, userLevel });
      const reply = await chatWithGroq(message, subject, userLevel);
      sendJson(res, 200, { status: 'ok', reply, stats: getStatusSummary() });
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

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, () => {
  console.log(`Website running at http://localhost:${port}`);
});

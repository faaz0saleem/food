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

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
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
  } catch (error) {
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
  return {
    activeUsers: activeSessions.size,
    dailyVisitors: visitorStats.dailyVisitors.length,
    totalVisitors: visitorStats.totalVisitors,
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

function getActionReply(actionType) {
  switch (actionType) {
    case 'show-help':
      return 'I can help you explore the site, answer questions, and guide you to the right section.';
    case 'contact-support':
      return 'Support is ready. You can email support@website.com or ask me to connect you with a help article.';
    case 'clear-chat':
      return 'Chat cleared. Your conversation has been reset and I am ready for your next question.';
    default:
      return `Action received: ${actionType}. Tell me what you would like to do next.`;
  }
}

async function chatWithGroq(userMessage) {
  if (!groqClient) {
    return 'I am running in demo mode because no GROQ_API_KEY is configured. Add your API key to enable live AI replies.';
  }

  conversationHistory.push({ role: 'user', content: userMessage });

  try {
    const response = await groqClient.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: conversationHistory,
      max_tokens: 512,
    });

    const reply = response.choices?.[0]?.message?.content || 'I did not receive a reply.';
    conversationHistory.push({ role: 'assistant', content: reply });
    return reply;
  } catch (error) {
    return `The AI request failed: ${error.message}`;
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

  if (req.method === 'GET' && url.pathname === '/') {
    sendFile(res, path.join(rootDir, 'index.html'));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/styles.css') {
    sendFile(res, path.join(rootDir, 'styles.css'));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/app.js') {
    sendFile(res, path.join(rootDir, 'app.js'));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(port, () => {
  console.log(`Frontend server running at http://localhost:${port}`);
});

require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');

const port = process.env.BACKEND_PORT || 4000;
const statsFile = path.join(__dirname, 'stats.json');
const SESSION_TIMEOUT_MS = 2 * 60 * 1000;
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const conversationHistory = [];

let groqClient = null;
if (process.env.GROQ_API_KEY) {
  groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function sendJson(res, statusCode, payload) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, statusCode, html) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendCorsOptions(res) {
  setCorsHeaders(res);
  res.writeHead(204);
  res.end();
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
      totalChats: 0,
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
    totalChats: visitorStats.totalChats || 0,
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
  visitorStats.actions.push({
    timestamp: Date.now(),
    visitorId: visitorId || 'anonymous',
    actionType,
    details,
  });

  if (actionType === 'chat') {
    visitorStats.totalChats = (visitorStats.totalChats || 0) + 1;
  }

  saveStats();
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
    return 'I am running in demo mode because no GROQ_API_KEY is not configured. Add your API key to enable live AI replies.';
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

  if (req.method === 'OPTIONS') {
    sendCorsOptions(res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') {
    const stats = getStatusSummary();
    sendHtml(res, 200, `<!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Chatbot Backend</title>
          <style>
            body { margin: 0; font-family: system-ui, sans-serif; background: #0b1220; color: #e8f1ff; }
            .page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
            .card { max-width: 620px; width: 100%; padding: 30px; border-radius: 24px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.13); box-shadow: 0 24px 70px rgba(0,0,0,0.35); }
            h1 { margin-top: 0; font-size: 2.2rem; }
            .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin: 24px 0; }
            .metric { padding: 18px 20px; background: rgba(255,255,255,0.08); border-radius: 18px; border: 1px solid rgba(255,255,255,0.12); }
            .metric strong { display: block; margin-top: 10px; font-size: 1.8rem; }
            code { background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 6px; }
            ul { margin: 0; padding-left: 18px; }
            p { color: #b8c7ef; }
            .footer { margin-top: 26px; color: #a0b4d9; font-size: 0.95rem; }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="card">
              <h1>Chatbot Backend</h1>
              <p>This backend records website activity, active visitors, and chat counts for your site.</p>
              <div class="grid">
                <div class="metric"><span>Active Visitors</span><strong>${stats.activeUsers}</strong></div>
                <div class="metric"><span>Visitors in 24h</span><strong>${stats.dailyVisitors}</strong></div>
                <div class="metric"><span>Total Visitors</span><strong>${stats.totalVisitors}</strong></div>
                <div class="metric"><span>Total Chats</span><strong>${stats.totalChats}</strong></div>
                <div class="metric"><span>Chats in 24h</span><strong>${stats.dailyChats}</strong></div>
              </div>
              <p>API endpoints:</p>
              <ul>
                <li><code>/health</code></li>
                <li><code>/api/status</code></li>
                <li><code>/api/visit</code></li>
                <li><code>/api/chat</code></li>
              </ul>
              <div class="footer">Backend running on port ${port}.</div>
            </div>
          </div>
        </body>
      </html>
    `);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    sendJson(res, 200, { status: 'ok', stats: getStatusSummary() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/visit') {
    try {
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

  if (req.method === 'POST' && url.pathname === '/api/track-action') {
    try {
      const payload = await parseRequestBody(req);
      const visitorId = payload.visitorId;
      const actionType = payload.actionType;
      if (!actionType) {
        sendJson(res, 400, { error: 'Action type is required.' });
        return;
      }
      registerVisitor(visitorId, req.headers['user-agent'] || 'unknown');
      addActionRecord(visitorId, actionType, payload.details || {});
      const reply = getActionReply(actionType);
      sendJson(res, 200, { status: 'ok', reply, stats: getStatusSummary() });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat') {
    try {
      const payload = await parseRequestBody(req);
      const visitorId = payload.visitorId;
      const message = (payload.message || '').trim();
      if (!message) {
        sendJson(res, 400, { error: 'A message is required.' });
        return;
      }
      registerVisitor(visitorId, req.headers['user-agent'] || 'unknown');
      addActionRecord(visitorId, 'chat', { message });
      const reply = await chatWithGroq(message);
      sendJson(res, 200, { status: 'ok', reply, stats: getStatusSummary() });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
});

require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const port = process.env.PORT || 3000;
const rootDir = __dirname;
const statsFile = path.join(rootDir, 'stats.json');
const ADMIN_KEY = process.env.ADMIN_KEY || '';

const GROQ_MODEL = process.env.GROQ_MODEL || process.env.GROQ_MODEL_NAME || 'llama-3.3-70b-versatile';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MODEL_LABEL = process.env.GROQ_MODEL_LABEL || GROQ_MODEL;

const groqClient = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const anthropicClient = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const geminiClient = geminiKey ? new GoogleGenerativeAI(geminiKey) : null;
const geminiRequestOptions = process.env.GEMINI_BASE_URL ? { baseUrl: process.env.GEMINI_BASE_URL } : undefined;

// ---------- providers: the raw AI vendors an engine can run on ----------
const PROVIDERS = {
  groq: {
    label: 'Groq Llama 3.3',
    model: () => GROQ_MODEL,
    ready: () => Boolean(groqClient),
    vision: false,
    call: async ({ systemPrompt, userContent, history = [], maxTokens = 700, temperature = 0.7 }) => {
      const text = typeof userContent === 'string' ? userContent : (userContent.find((p) => p.type === 'text')?.text || '');
      const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: text }];
      const response = await groqClient.chat.completions.create({ model: GROQ_MODEL, messages, max_tokens: maxTokens, temperature });
      return response.choices?.[0]?.message?.content?.trim() || null;
    },
  },
  gemini: {
    label: 'Gemini Flash',
    model: () => GEMINI_MODEL,
    ready: () => Boolean(geminiClient),
    vision: true,
    call: async ({ systemPrompt, userContent, history = [], maxTokens = 700, temperature = 0.7 }) => {
      const model = geminiClient.getGenerativeModel({ model: GEMINI_MODEL, systemInstruction: systemPrompt }, geminiRequestOptions);
      const contents = history.map((h) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] }));
      let parts;
      if (typeof userContent === 'string') {
        parts = [{ text: userContent }];
      } else {
        parts = userContent.map((p) => {
          if (p.type === 'text') return { text: p.text };
          const match = (p.image_url?.url || '').match(/^data:([^;]+);base64,(.+)$/s);
          return match ? { inlineData: { mimeType: match[1], data: match[2] } } : null;
        }).filter(Boolean);
      }
      contents.push({ role: 'user', parts });
      const result = await model.generateContent({ contents, generationConfig: { maxOutputTokens: maxTokens, temperature } });
      return result.response?.text()?.trim() || null;
    },
  },
  openai: {
    label: 'GPT-4o',
    model: () => OPENAI_MODEL,
    ready: () => Boolean(openaiClient),
    vision: true,
    call: async ({ systemPrompt, userContent, history = [], maxTokens = 700 }) => {
      const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userContent }];
      const response = await openaiClient.chat.completions.create({ model: OPENAI_MODEL, messages, max_tokens: maxTokens });
      return response.choices?.[0]?.message?.content?.trim() || null;
    },
  },
  anthropic: {
    label: 'Claude Sonnet',
    model: () => ANTHROPIC_MODEL,
    ready: () => Boolean(anthropicClient),
    vision: true,
    call: async ({ systemPrompt, userContent, history = [], maxTokens = 700 }) => {
      let content = userContent;
      if (Array.isArray(userContent)) {
        content = userContent.map((p) => {
          if (p.type === 'text') return { type: 'text', text: p.text };
          const match = (p.image_url?.url || '').match(/^data:([^;]+);base64,(.+)$/s);
          return match ? { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } } : null;
        }).filter(Boolean);
      }
      const messages = [...history, { role: 'user', content }];
      const response = await anthropicClient.messages.create({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, system: systemPrompt, messages });
      const textBlock = response.content?.find((block) => block.type === 'text');
      return textBlock?.text?.trim() || null;
    },
  },
};

// ---------- engines: the 4 tutoring personalities students see ----------
// Each engine has a native provider plus a fallback chain, so every engine can
// answer as long as at least one API key is configured. The persona keeps the
// engines genuinely different even when two of them share a backing provider.
const ENGINES = {
  reasoner: {
    name: 'Groq', icon: '🟢', native: 'groq', fallbacks: ['gemini', 'openai', 'anthropic'],
    persona: 'You are THE REASONER, Hungter\'s deep-reasoning engine. Your specialty: rigorous step-by-step logic. Break the problem into numbered steps and explain WHY each step is true, not just what to do.',
  },
  solver: {
    name: 'Gemini', icon: '🟠', native: 'gemini', fallbacks: ['groq', 'openai', 'anthropic'],
    persona: 'You are THE SOLVER, Hungter\'s math/code/physics engine. Your specialty: precise worked solutions. Show every calculation line by line, state formulas before using them, and double-check the final answer.',
  },
  explorer: {
    name: 'ChatGPT', icon: '🔵', native: 'openai', fallbacks: ['gemini', 'groq', 'anthropic'],
    persona: 'You are THE EXPLORER, Hungter\'s real-world engine. Your specialty: concrete everyday examples. Anchor every explanation in a real situation the student has actually seen or lived.',
  },
  storyteller: {
    name: 'Claude', icon: '🟣', native: 'anthropic', fallbacks: ['gemini', 'groq', 'openai'],
    persona: 'You are THE STORYTELLER, Hungter\'s narrative engine. Your specialty: analogies and mini-stories that make ideas unforgettable. Teach through one vivid analogy or short story, then connect it back to the real concept.',
  },
};

function engineChain(key, { needVision = false } = {}) {
  const engine = ENGINES[key];
  if (!engine) return [];
  let chain = [engine.native, ...engine.fallbacks].filter((p) => PROVIDERS[p].ready());
  if (needVision) {
    const vision = chain.filter((p) => PROVIDERS[p].vision);
    if (vision.length) chain = [...vision, ...chain.filter((p) => !PROVIDERS[p].vision)];
  }
  return chain;
}

function buildSystemPrompt(subject, userLevel, persona = '') {
  return `You are Hungter, an AI tutor. You ONLY help with educational topics: schoolwork, academic subjects, study skills, and learning ${subject || 'general topics'}. If the user asks about anything unrelated to learning or education, politely decline and redirect them to ask a study-related question instead - do not answer the off-topic request.

You are helping a student at the "${userLevel || 'Newbie'}" level.
- Newbie/Learner: explain concepts simply with basic examples.
- Explorer/Scholar: give more detailed explanations with worked examples.
- Master: offer advanced insights and complex problem-solving.

Be encouraging, clear, and keep responses concise (2-4 sentences) unless the question needs a worked example.${persona ? `\n\n${persona}` : ''}`;
}

// Run a plain-text prompt through an engine, walking its provider fallback chain.
async function callEngineText(key, systemPrompt, userPrompt, { maxTokens = 700, temperature = 0.7 } = {}) {
  for (const providerKey of engineChain(key)) {
    try {
      const reply = await PROVIDERS[providerKey].call({ systemPrompt, userContent: userPrompt, maxTokens, temperature });
      if (reply) return reply;
    } catch (error) {
      console.error(`${ENGINES[key].name} via ${providerKey} failed:`, error.message);
    }
  }
  return null;
}

// Build the user message content — text files inline, images as vision parts
// (openai-style; each provider's call() converts to its own format).
function buildUserContent(message, attachments, provider) {
  const images = (attachments || []).filter((a) => a.kind === 'image' && a.imageDataUrl);
  const files = (attachments || []).filter((a) => a.kind !== 'image' && a.textContent);
  let text = message;
  if (files.length) {
    text += '\n\n' + files.map((f) => `[File: ${f.name}]\n${f.textContent}`).join('\n\n');
  }
  if (!images.length) return text;
  if (PROVIDERS[provider]?.vision) {
    const content = [{ type: 'text', text }];
    for (const img of images.slice(0, 3)) {
      content.push({ type: 'image_url', image_url: { url: img.imageDataUrl } });
    }
    return content;
  }
  // Non-vision provider — embed as a text note
  text += `\n\n[Note: The student attached ${images.length} image(s). Acknowledge this and ask them to describe the key parts in text so you can help.]`;
  return text;
}

async function callOneEngine(key, message, subject, userLevel, history = [], attachments = []) {
  const engine = ENGINES[key];
  if (!engine) return { name: 'Unknown', reply: null };
  const systemPrompt = buildSystemPrompt(subject, userLevel, engine.persona);
  const hasImages = (attachments || []).some((a) => a.kind === 'image' && a.imageDataUrl);
  for (const providerKey of engineChain(key, { needVision: hasImages })) {
    const provider = PROVIDERS[providerKey];
    try {
      const userContent = buildUserContent(message, attachments, providerKey);
      const reply = await provider.call({ systemPrompt, userContent, history });
      if (reply) {
        return { name: engine.name, icon: engine.icon, reply, provider: providerKey, providerLabel: provider.label, model: provider.model(), native: providerKey === engine.native };
      }
    } catch (error) {
      console.error(`${engine.name} via ${providerKey} failed:`, error.message);
    }
  }
  return { name: engine.name, icon: engine.icon, reply: null };
}

async function classifyMessage(message, subject) {
  try {
    const raw = await callEngineText('reasoner', `Classify the student's message into exactly one category. Reply with ONLY the category word, nothing else.
Categories:
MATH - math, coding, physics, or step-by-step problem solving
EXAMPLES - wants real-world examples, practical applications, or research-style detail
STORY - wants a story, analogy, poem, or creative explanation
COMPLEX - a genuinely hard, multi-part, or ambiguous question that would benefit from more than one perspective
GENERAL - anything else, including simple conceptual questions`,
    `Subject: ${subject || 'General'}\nMessage: ${message}`, { maxTokens: 5, temperature: 0 });
    const upper = String(raw || '').trim().toUpperCase();
    const categories = ['MATH', 'EXAMPLES', 'STORY', 'COMPLEX', 'GENERAL'];
    return categories.find((c) => upper.includes(c)) || 'GENERAL';
  } catch (error) {
    console.error('Classifier failed:', error.message);
    return 'GENERAL';
  }
}

const CATEGORY_TO_ENGINE = { MATH: 'solver', EXAMPLES: 'explorer', STORY: 'storyteller', GENERAL: 'reasoner' };

function engineTag(result) {
  return result.native ? result.name : `${result.name} (via ${result.providerLabel})`;
}

async function answerSmart({ message, subject, userLevel, learningStyle, excludeEngine, engineMode = 'auto', history = [], attachments = [] }) {
  const mode = String(engineMode || 'auto').toLowerCase();

  // Forced single engine: the student picked one from the chat engine selector.
  if (ENGINES[mode]) {
    const result = await callOneEngine(mode, message, subject, userLevel, history, attachments);
    if (result.reply) return { reply: result.reply, engines: [engineTag(result)] };
  }

  // All-engines mode: every engine answers, each with its own persona.
  if (mode === 'all') {
    const results = await Promise.all(Object.keys(ENGINES).map((key) => callOneEngine(key, message, subject, userLevel, history, attachments)));
    const successful = results.filter((r) => r.reply);
    if (successful.length) {
      const merged = successful.map((r) => `**${r.icon} ${r.name}** · _${r.providerLabel}_\n\n${r.reply}`).join('\n\n---\n\n');
      return { reply: merged, engines: successful.map((r) => engineTag(r)) };
    }
  }

  const category = await classifyMessage(message, subject);

  // Route image-containing messages to vision-capable engines first
  const hasImages = attachments.some((a) => a.kind === 'image' && a.imageDataUrl);
  if (hasImages) {
    const visionKey = Object.keys(ENGINES).find((key) => engineChain(key).some((p) => PROVIDERS[p].vision));
    if (visionKey) {
      const result = await callOneEngine(visionKey, message, subject, userLevel, history, attachments);
      if (result.reply) return { reply: result.reply, engines: [engineTag(result)] };
    }
  }

  if (category === 'COMPLEX') {
    const secondaryKey = engineChain('storyteller').length ? 'storyteller' : (engineChain('explorer').length ? 'explorer' : 'solver');
    const [a, b] = await Promise.all([
      callOneEngine('reasoner', message, subject, userLevel, history, attachments),
      callOneEngine(secondaryKey, message, subject, userLevel, history, attachments),
    ]);
    const successful = [a, b].filter((r) => r.reply).filter((r, i, arr) => arr.findIndex((x) => x.name === r.name) === i);
    if (successful.length) {
      const merged = successful.map((r) => `**${r.icon} ${r.name}:**\n${r.reply}`).join('\n\n---\n\n');
      return { reply: merged, engines: successful.map((r) => engineTag(r)) };
    }
  } else {
    let primaryKey = CATEGORY_TO_ENGINE[category] || 'reasoner';
    // Students who chose story-based learning get the Storyteller for general questions.
    if (primaryKey === 'reasoner' && String(learningStyle || '') === 'Stories') primaryKey = 'storyteller';
    if (excludeEngine && ENGINES[primaryKey]?.name === excludeEngine) {
      const alt = Object.keys(ENGINES).find((k) => ENGINES[k].name !== excludeEngine && engineChain(k).length);
      if (alt) primaryKey = alt;
    }
    const result = await callOneEngine(primaryKey, message, subject, userLevel, history, attachments);
    if (result.reply) return { reply: result.reply, engines: [engineTag(result)] };
  }

  const fallback = await callOneEngine('reasoner', message, subject, userLevel, history, attachments);
  if (fallback.reply) return { reply: fallback.reply, engines: [engineTag(fallback)] };

  return { reply: `Demo mode answer for ${subject || 'your topic'}: Keep practicing and review one concept at a time to master it!`, engines: ['Reasoner'] };
}

async function runRoundtableDebate({ message, subject, userLevel }) {
  const availableKeys = Object.keys(ENGINES).filter((k) => engineChain(k).length);
  if (availableKeys.length < 2) {
    const solo = await answerSmart({ message, subject, userLevel });
    return { transcript: [], finalAnswer: solo.reply, engines: solo.engines };
  }

  const round1 = await Promise.all(availableKeys.map(async (key) => {
    const engine = ENGINES[key];
    const systemPrompt = buildSystemPrompt(subject, userLevel, engine.persona);
    const prompt = `${message}\n\nGive your take on how to best explain this, in 2-3 sentences, using your specialty.`;
    const text = await callEngineText(key, systemPrompt, prompt);
    return { key, name: engine.name, text };
  }));
  const round1Valid = round1.filter((r) => r.text);
  if (!round1Valid.length) return { transcript: [], finalAnswer: `Demo mode answer for ${subject || 'your topic'}: Keep practicing!`, engines: ['Reasoner'] };

  const round2 = await Promise.all(round1Valid.map(async (r) => {
    const engine = ENGINES[r.key];
    const systemPrompt = buildSystemPrompt(subject, userLevel, engine.persona);
    const others = round1Valid.filter((o) => o.key !== r.key).map((o) => `${o.name}: ${o.text}`).join('\n');
    const prompt = `Other tutors said, about explaining "${message}":\n${others}\n\nIn 1-2 sentences, briefly agree, disagree, or add something they missed.`;
    const text = await callEngineText(r.key, systemPrompt, prompt);
    return { key: r.key, name: r.name, text: text || '(no response)' };
  }));

  const fullTranscript = [
    ...round1Valid.map((r) => `${r.name} (Round 1): ${r.text}`),
    ...round2.map((r) => `${r.name} (Round 2): ${r.text}`),
  ].join('\n');

  let finalAnswer = await callEngineText('reasoner', buildSystemPrompt(subject, userLevel),
    `Here is a debate between ${round1Valid.length} AI tutors about how to answer a student's question: "${message}"\n\n${fullTranscript}\n\nWrite ONE final, clear answer for the student (2-4 sentences), combining the best of what they said.`);
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

// Pull the first JSON array out of an LLM reply (tolerates fences + prose).
function extractJsonArray(raw) {
  const text = String(raw || '').replace(/^```(?:json)?\s*|\s*```$/gm, '').trim();
  const start = text.indexOf('[');
  if (start === -1) return [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '[') depth++;
    else if (char === ']') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1));
          return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
      }
    }
  }
  return [];
}

// Guess Paper generator: all four engines write structured, solvable
// questions (mcq + short answer) tagged with topic + author engine.
async function generateGuessPaper({ section, subject, chapter, bookTitle }) {
  const topic = chapter || subject;
  const source = bookTitle
    ? `Base the questions on the kind of material covered by the book "${bookTitle}"${chapter ? `, chapter/topic "${chapter}"` : ''}.`
    : `Focus on the topic "${topic}".`;
  const jsonRules = 'Reply with ONLY a JSON array, no prose, no markdown. Each item: '
    + '{"type":"mcq","question":"...","options":["A","B","C","D"],"correct":0,"explanation":"why","topic":"short topic tag","marks":2} '
    + 'or {"type":"short","question":"...","answer":"model answer in 1-3 sentences","explanation":"marking notes","topic":"short topic tag","marks":4}. '
    + `Questions must be ORIGINAL (never copied from any official paper), at ${section} difficulty, on ${subject}. ${source}`;
  const assignments = [
    { key: 'reasoner', instruction: `Write 2 conceptual multiple-choice questions that test understanding, not memory. ${jsonRules}` },
    { key: 'solver', instruction: `Write 2 calculation questions: 1 as "mcq" with numeric options and 1 as "short" with a fully worked model answer. ${jsonRules}` },
    { key: 'explorer', instruction: `Write 2 applied real-world scenario multiple-choice questions. ${jsonRules}` },
    { key: 'storyteller', instruction: `Write 2 "short" extended-response questions with a clear model answer. ${jsonRules}` },
  ];

  const questions = [];
  const generatedBy = [];
  const results = await Promise.all(assignments.map(async ({ key, instruction }) => {
    const engine = ENGINES[key];
    if (!engineChain(key).length) return null;
    const text = await callEngineText(key, `You are writing exam questions for a ${section} ${subject} student.`, instruction, { maxTokens: 1400, temperature: 0.5 });
    return text ? { key, engine, text } : null;
  }));

  for (const result of results.filter(Boolean)) {
    const items = extractJsonArray(result.text);
    let added = false;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const type = String(item.type || '').toLowerCase();
      const questionText = String(item.question || '').trim();
      if (!questionText || !['mcq', 'short'].includes(type)) continue;
      const entry = {
        id: `q${questions.length + 1}`,
        type,
        question: questionText,
        explanation: String(item.explanation || '').trim(),
        topic: String(item.topic || topic).trim() || topic,
        marks: Math.max(1, Math.min(10, Number(item.marks) || (type === 'mcq' ? 2 : 4))),
        engine: result.engine.name,
        engineIcon: result.engine.icon,
        provider: '',
      };
      if (type === 'mcq') {
        const options = (Array.isArray(item.options) ? item.options : []).map((o) => String(o).trim()).filter(Boolean);
        const correct = Number(item.correct);
        if (options.length < 2 || !Number.isInteger(correct) || correct < 0 || correct >= options.length) continue;
        entry.options = options.slice(0, 5);
        entry.correct = correct;
      } else {
        const answer = String(item.answer || '').trim();
        if (!answer) continue;
        entry.answer = answer;
      }
      questions.push(entry);
      added = true;
    }
    if (added) generatedBy.push(result.engine.name);
  }

  if (!questions.length) {
    questions.push(
      { id: 'q1', type: 'short', question: `Define the core idea of ${topic} in your own words and give one everyday example.`, answer: `A clear definition of ${topic} plus one concrete real-life example.`, explanation: 'Full marks for a correct definition and a relevant example.', topic, marks: 4, engine: 'Hungter', engineIcon: '🧠', provider: '' },
      { id: 'q2', type: 'short', question: `Describe one common mistake students make with ${topic} and how to avoid it.`, answer: 'One realistic misconception and a practical way to avoid it.', explanation: 'Any sensible misconception accepted.', topic, marks: 4, engine: 'Hungter', engineIcon: '🧠', provider: '' },
    );
    generatedBy.push('Hungter offline generator');
  }

  const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);
  return {
    paper: {
      title: `${section} ${subject} — AI Guess Paper`.trim(),
      section, subject, chapter, book: bookTitle || '',
      totalMarks, questionCount: questions.length,
    },
    questions,
    generatedBy: [...new Set(generatedBy)],
  };
}

const REQUIRE_PRO_FOR_GUESS_PAPERS = false;

function getEngineDetails() {
  const details = {};
  for (const [key, engine] of Object.entries(ENGINES)) {
    const chain = engineChain(key);
    const backing = chain[0] || null;
    details[key] = {
      name: engine.name,
      live: Boolean(backing),
      native: backing === engine.native,
      provider: backing ? PROVIDERS[backing].label : null,
      model: backing ? PROVIDERS[backing].model() : null,
    };
  }
  return details;
}

function getEngineAvailability() {
  return Object.fromEntries(Object.entries(getEngineDetails()).map(([key, detail]) => [key, detail.live]));
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
  if (!engineChain('reasoner').length) return getDemoQuiz(subject, count);
  const filteredAsked = Array.isArray(askedQuestions) ? askedQuestions.filter((i) => typeof i === 'string' && i.trim().length > 5) : [];
  try {
    const chapterPrompt = chapter || bookContext
      ? ` Focus on the topic '${chapter || subject}' as covered in a book like '${bookContext || 'general coursebook'}'. Do not quote or reproduce any text from that book - write entirely original questions.`
      : '';
    const prompt = `Generate ${count} multiple choice questions for a student learning ${subject}.${chapterPrompt} Avoid repeating any questions the student has already answered. Previously asked questions: ${filteredAsked.slice(-20).join(' | ')}. Return ONLY valid JSON in this exact format: [{"question": "...","options": ["A)...","B)...","C)...","D)..."],"correct":"A","explanation":"..."}]`;
    const content = await callEngineText('reasoner', 'You are a quiz generator. Only output valid JSON.', prompt, { maxTokens: 1024 }) || '';
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
    { key: 'solver', instruction: 'Write 3 flashcards focused on formulas and worked steps.' },
    { key: 'explorer', instruction: 'Write 3 flashcards focused on applied examples.' },
    { key: 'storyteller', instruction: 'Write 3 flashcards focused on memorable analogies.' },
  ];
  const results = await Promise.all(assignments.map(async ({ key, instruction }) => {
    if (!engineChain(key).length) return [];
    const text = await callEngineText(key, basePrompt, `${basePrompt}\n\n${instruction}`, { maxTokens: 800 });
    const parsed = parseJsonSafe(text || '');
    return Array.isArray(parsed) ? parsed.filter((c) => c && c.front && c.back) : [];
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
  for (const key of ['storyteller', 'explorer', 'solver', 'reasoner']) {
    if (!engineChain(key).length) continue;
    const notes = await callEngineText(key, systemPrompt, userPrompt, { maxTokens: 1400, temperature: 0.5 });
    if (notes) return { notes, engine: ENGINES[key].name };
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
    if (pathname === '/api/status') return sendJson(res, 200, { status: 'ok', model: MODEL_LABEL, engines: getEngineAvailability(), engineDetails: getEngineDetails(), stats: getStatusSummary() });
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

      const { reply, engines } = await answerSmart({
        message, subject, userLevel,
        learningStyle: payload.learningStyle,
        excludeEngine: payload.excludeEngine,
        engineMode: payload.engineMode || payload.engine || 'auto',
        history, attachments,
      });
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
      if (!engineChain('reasoner').length) return sendJson(res, 200, { understood: true, feedback: 'Nice explanation!' });
      const gradingPrompt = `A student is trying to explain this concept back in their own words: "${concept}". Their explanation: "${studentExplanation}". In ONE short sentence, say whether they show real understanding and give one word of encouragement or a gentle correction.`;
      const feedback = await callEngineText('reasoner', 'You are a supportive tutor grading a student explanation briefly.', gradingPrompt, { maxTokens: 60, temperature: 0.3 }) || 'Good effort!';
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
      const { section, subject, chapter, bookTitle } = payload;
      if (!section || !subject) return sendJson(res, 400, { error: 'section and subject are required.' });
      const result = await generateGuessPaper({ section, subject, chapter, bookTitle });
      return sendJson(res, 200, { status: 'ok', creditsCharged: 0, ...result });
    } catch (error) {
      console.error('Guess paper endpoint failed:', error.message);
      return sendJson(res, 500, { error: 'Guess paper generation failed. Please try again.' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/guess-paper-grade') {
    try {
      if (isRateLimited(getClientIp(req))) return sendJson(res, 429, { error: 'Rate limit exceeded' });
      const payload = await parseRequestBody(req);
      const items = Array.isArray(payload.items) ? payload.items.slice(0, 12) : [];
      if (!items.length) return sendJson(res, 400, { error: 'items to grade are required.' });

      let parsed = [];
      if (engineChain('reasoner').length) {
        let prompt = 'Grade these student answers. Reply with ONLY a JSON array, one item per answer, same order: {"score":0.0-1.0,"feedback":"one short sentence"}.\n\n';
        items.forEach((item, i) => {
          prompt += `Q${i + 1}: ${String(item.question || '')}\nModel answer: ${String(item.modelAnswer || '')}\nStudent answer: ${String(item.studentAnswer || '').trim()}\n\n`;
        });
        const reply = await callEngineText('reasoner', 'You are a fair, encouraging exam marker.', prompt, { maxTokens: 800, temperature: 0.2 });
        parsed = extractJsonArray(reply);
      }

      const grades = items.map((item, i) => {
        const aiGrade = parsed[i];
        if (aiGrade && typeof aiGrade === 'object' && 'score' in aiGrade) {
          return {
            score: Math.max(0, Math.min(1, Number(aiGrade.score) || 0)),
            feedback: String(aiGrade.feedback || '').trim() || 'Graded.',
            gradedBy: 'ai',
          };
        }
        const student = String(item.studentAnswer || '').trim();
        const modelWords = String(item.modelAnswer || '').toLowerCase().split(/\W+/).filter((w) => w.length > 3);
        const studentWords = new Set(student.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
        const hits = modelWords.filter((w) => studentWords.has(w)).length;
        const ratio = modelWords.length ? hits / modelWords.length : 0;
        return {
          score: student ? Math.round(Math.max(0.15, Math.min(0.9, ratio * 1.4)) * 100) / 100 : 0,
          feedback: student ? 'Auto-marked by keyword match — compare with the model answer.' : 'No answer given.',
          gradedBy: 'heuristic',
        };
      });

      return sendJson(res, 200, { status: 'ok', grades });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
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

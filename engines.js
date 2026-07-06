const Anthropic = require('@anthropic-ai/sdk');
const Groq = require('groq-sdk');
const OpenAI = require('openai');

const GROQ_MODEL = process.env.GROQ_MODEL || process.env.GROQ_MODEL_NAME || 'llama-3.3-70b-versatile';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest';

const groqClient = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const anthropicClient = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

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
  return 'AI providers are not configured right now. Add at least one API key (GROQ_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY).';
}

async function routeChat({
  message,
  subject = 'General',
  userLevel = 'Newbie',
  learningStyle = 'Newbie',
  excludeEngine = null,
  history = [],
  attachments = [],
}) {
  const normalizedHistory = normalizeHistory(history);
  const normalizedAttachments = normalizeAttachments(attachments);
  const finalMessage = buildFinalUserMessage(message, normalizedAttachments);
  let category = await classifyMessage(finalMessage, subject);

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
      safeEngineCall('Reasoner', finalMessage, subject, userLevel || learningStyle, normalizedHistory),
      safeEngineCall(secondary, finalMessage, subject, userLevel || learningStyle, normalizedHistory),
    ]);

    const results = [reasonerResult, secondaryResult].filter(Boolean);
    if (results.length > 0) {
      const reply = results.map((result) => `**${result.engine}:**\n${result.reply}`).join('\n\n---\n\n');
      return {
        reply,
        engine: results.map((result) => result.engine).join(', '),
        model: results.map((result) => result.model).join(', '),
      };
    }
  } else {
    const target = categoryToEngine[category] || 'Reasoner';
    const primary = await safeEngineCall(target, finalMessage, subject, userLevel || learningStyle, normalizedHistory);
    if (primary) {
      return { reply: primary.reply, engine: primary.engine, model: primary.model };
    }
  }

  const reasoner = await safeEngineCall('Reasoner', finalMessage, subject, userLevel || learningStyle, normalizedHistory);
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

function getEngineAvailability() {
  return {
    reasoner: Boolean(groqClient),
    solver: Boolean(groqClient),
    explorer: Boolean(openaiClient),
    storyteller: Boolean(anthropicClient),
  };
}

module.exports = {
  routeChat,
  getEngineAvailability,
  generateQuiz,
  generateQuizQuestion,
};
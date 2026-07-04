const Groq = require('groq-sdk');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

const GROQ_MODEL = process.env.GROQ_MODEL || process.env.GROQ_MODEL_NAME || 'llama-3.3-70b-versatile';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const groqClient = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const anthropicClient = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

const ENGINES = {
  reasoner: { name: 'Reasoner', provider: 'Groq', model: GROQ_MODEL, client: groqClient },
  solver: { name: 'Solver', provider: 'Groq (standing in for Gemini)', model: GROQ_MODEL, client: groqClient },
  explorer: { name: 'Explorer', provider: 'OpenAI', model: OPENAI_MODEL, client: openaiClient },
  storyteller: { name: 'Storyteller', provider: 'Anthropic', model: ANTHROPIC_MODEL, client: anthropicClient },
};

const MATH_SUBJECTS = new Set(['Math', 'Coding', 'Physics']);

function chooseEngineKey(subject, learningStyle, userLevel) {
  if (learningStyle === 'Stories') return 'storyteller';
  if (MATH_SUBJECTS.has(subject)) return 'solver';
  if (learningStyle === 'Examples') return 'explorer';
  if (userLevel === 'Scholar' || userLevel === 'Master') return 'reasoner';
  return 'reasoner';
}

function buildSystemPrompt(subject, userLevel) {
  return `You are MindMesh, an AI tutor. You ONLY help with educational topics: schoolwork, academic subjects, study skills, and learning ${subject || 'general topics'}. If the user asks about anything unrelated to learning or education, politely decline and redirect them to ask a study-related question instead — do not answer the off-topic request.

You are helping a student at the "${userLevel || 'Newbie'}" level.
- Newbie/Learner: explain concepts simply with basic examples.
- Explorer/Scholar: give more detailed explanations with worked examples.
- Master: offer advanced insights and complex problem-solving.

Be encouraging, clear, and keep responses concise (2-4 sentences) unless the question needs a worked example.`;
}

async function callGroq(client, model, systemPrompt, message) {
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ],
    max_tokens: 400,
    temperature: 0.7,
  });
  return response.choices?.[0]?.message?.content?.trim() || null;
}

async function callOpenAI(client, model, systemPrompt, message) {
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ],
    max_tokens: 400,
  });
  return response.choices?.[0]?.message?.content?.trim() || null;
}

async function callAnthropic(client, model, systemPrompt, message) {
  const response = await client.messages.create({
    model,
    max_tokens: 400,
    thinking: { type: 'disabled' },
    system: systemPrompt,
    messages: [{ role: 'user', content: message }],
  });
  const textBlock = response.content?.find((block) => block.type === 'text');
  return textBlock?.text?.trim() || null;
}

async function callEngine(engineKey, message, subject, userLevel) {
  const engine = ENGINES[engineKey];
  const systemPrompt = buildSystemPrompt(subject, userLevel);

  if (!engine.client) {
    return { reply: null, engine };
  }

  try {
    let reply;
    if (engineKey === 'reasoner' || engineKey === 'solver') {
      reply = await callGroq(engine.client, engine.model, systemPrompt, message);
    } else if (engineKey === 'explorer') {
      reply = await callOpenAI(engine.client, engine.model, systemPrompt, message);
    } else {
      reply = await callAnthropic(engine.client, engine.model, systemPrompt, message);
    }
    return { reply, engine };
  } catch (error) {
    console.error(`${engine.name} (${engine.provider}) call failed:`, error.message);
    return { reply: null, engine, error: error.message };
  }
}

async function routeChat({ message, subject, learningStyle, userLevel }) {
  const primaryKey = chooseEngineKey(subject, learningStyle, userLevel);
  let result = await callEngine(primaryKey, message, subject, userLevel);

  if (!result.reply && primaryKey !== 'reasoner') {
    result = await callEngine('reasoner', message, subject, userLevel);
  }

  if (!result.reply) {
    return {
      reply: `Demo mode answer for ${subject || 'your topic'}: Keep practicing and review one concept at a time to master it!`,
      engine: 'Reasoner',
      model: GROQ_MODEL,
    };
  }

  return { reply: result.reply, engine: result.engine.name, model: result.engine.model };
}

function getEngineAvailability() {
  return {
    reasoner: Boolean(groqClient),
    solver: false, // Gemini isn't wired in yet — Math/Coding/Physics silently falls back to Groq
    explorer: Boolean(openaiClient),
    storyteller: Boolean(anthropicClient),
  };
}

module.exports = { routeChat, ENGINES, getEngineAvailability };

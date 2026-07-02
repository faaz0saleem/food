const { config } = require('dotenv');
config();

const Groq = require('groq-sdk');

const DEFAULT_MODEL = process.env.GROQ_MODEL || process.env.GROQ_MODEL_NAME || 'llama-3.3-70b-versatile';
const client = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const message = (payload.message || '').trim();
    const subject = payload.subject || 'General';
    const userLevel = payload.userLevel || 'Newbie';

    if (!message) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'A message is required.' }),
      };
    }

    if (!client) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'ok',
          reply: `Demo mode answer for ${subject}: Keep practicing and review one concept at a time to master it!`,
          model: DEFAULT_MODEL,
        }),
      };
    }

    const systemPrompt = `You are an expert learning assistant helping a student who is at the "${userLevel}" level study ${subject || 'general topics'}. Keep responses concise and encouraging.`;

    const response = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      max_tokens: 256,
      temperature: 0.7,
    });

    const reply = response.choices?.[0]?.message?.content?.trim() || 'I could not generate a response.';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok', reply, model: DEFAULT_MODEL }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Chat request failed' }),
    };
  }
};

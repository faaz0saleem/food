const { loadStats, summarize } = require('./_store');
const { getEngineAvailability } = require('../../../engines');

const DEFAULT_MODEL = process.env.GROQ_MODEL || process.env.GROQ_MODEL_NAME || 'llama-3.3-70b-versatile';

exports.handler = async function () {
  let summary = {};
  try {
    const stats = await loadStats();
    summary = summarize(stats);
  } catch (error) {
    console.error('Status stats read failed:', error.message);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'ok',
      model: DEFAULT_MODEL,
      engines: getEngineAvailability(),
      stats: { ...summary, model: DEFAULT_MODEL },
    }),
  };
};

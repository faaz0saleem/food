const { loadStats, summarize } = require('./_store');

exports.handler = async function (event) {
  const expected = process.env.ADMIN_KEY || '';
  const provided = event.headers['x-admin-key'] || event.headers['X-Admin-Key'] || event.queryStringParameters?.key || '';

  if (!expected || provided !== expected) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  try {
    const stats = await loadStats();
    const summary = summarize(stats);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...summary,
        purchases: { count: 0, status: 'Stripe not connected yet' },
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Failed to load stats' }),
    };
  }
};

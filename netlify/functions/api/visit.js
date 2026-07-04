const { trackVisit } = require('./_store');

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
    await trackVisit(payload.visitorId);
  } catch (error) {
    console.error('Visit tracking failed:', error.message);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ok' }),
  };
};

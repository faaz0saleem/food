const { trackPurchaseStatusChanged } = require('../_store');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const expectedToken = process.env.RAPIDPAY_WEBHOOK_TOKEN || '';
    if (!expectedToken) {
      return json(501, { error: 'Webhook not configured. Set RAPIDPAY_WEBHOOK_TOKEN.' });
    }

    const providedToken = event.headers['x-webhook-token'] || event.headers['X-Webhook-Token'] || '';
    if (providedToken !== expectedToken) {
      return json(401, { error: 'Unauthorized webhook request' });
    }

    const payload = JSON.parse(event.body || '{}');
    const sessionId = payload.sessionId || payload.data?.sessionId || payload.id;
    const status = payload.status || payload.data?.status;

    if (!sessionId) {
      return json(400, { error: 'sessionId is required in webhook payload' });
    }

    await trackPurchaseStatusChanged(sessionId, status, payload);
    return json(200, { status: 'ok' });
  } catch (error) {
    return json(400, { error: error.message || 'Webhook handling failed' });
  }
};

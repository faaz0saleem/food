const { createRapidPayCheckoutSession, getRapidPayCheckoutSessionStatus } = require('../../../../rapidpay');
const { trackPurchaseCreated, trackPurchaseStatusChanged } = require('../_store');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');
      const result = await createRapidPayCheckoutSession({
        planId: payload.plan,
        customerEmail: payload.customerEmail,
        customerMobile: payload.customerMobile,
      });

      trackPurchaseCreated({
        sessionId: result.sessionId,
        basketId: result.basketId,
        planId: result.plan?.id,
        customerEmail: payload.customerEmail,
        customerMobile: payload.customerMobile,
        amount: result.amount,
        currency: result.currency,
        status: 'CREATED',
        provider: 'RapidPay',
      }).catch((error) => console.error('Purchase tracking create failed:', error.message));

      return json(200, { status: 'ok', ...result });
    }

    if (event.httpMethod === 'GET') {
      const sessionId = event.queryStringParameters?.sessionId || '';
      const session = await getRapidPayCheckoutSessionStatus(sessionId);

      trackPurchaseStatusChanged(sessionId, session?.status, session).catch((error) =>
        console.error('Purchase tracking status update failed:', error.message)
      );

      return json(200, { status: 'ok', session });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    return json(400, { error: error.message || 'Payment request failed' });
  }
};

const RAPIDPAY_BASE_URL = (process.env.RAPIDPAY_BASE_URL || 'https://secure.rapid-gateway.com').replace(/\/$/, '');
const RAPIDPAY_ENVIRONMENT = (process.env.RAPIDPAY_ENVIRONMENT || process.env.RAPIDPAY_ENV || 'TEST').toUpperCase();
const RAPIDPAY_CURRENCY = process.env.RAPIDPAY_CURRENCY || 'PKR';
const RAPIDPAY_MERCHANT_NAME = process.env.RAPIDPAY_MERCHANT_NAME || 'MindMesh';

const RAPIDPAY_CLIENT_ID = process.env.RAPIDPAY_CLIENT_ID || '';
const RAPIDPAY_CLIENT_SECRET = process.env.RAPIDPAY_CLIENT_SECRET || '';
const RAPIDPAY_MERCHANT_ID = Number(process.env.RAPIDPAY_MERCHANT_ID || 384);

const PLAN_CATALOG = {
  student: {
    id: 'student',
    name: 'Student',
    amount: Number(process.env.RAPIDPAY_AMOUNT_STUDENT || 1500),
    currency: RAPIDPAY_CURRENCY,
  },
  family: {
    id: 'family',
    name: 'Family',
    amount: Number(process.env.RAPIDPAY_AMOUNT_FAMILY || 3500),
    currency: RAPIDPAY_CURRENCY,
  },
  school: {
    id: 'school',
    name: 'School',
    amount: Number(process.env.RAPIDPAY_AMOUNT_SCHOOL || 60000),
    currency: RAPIDPAY_CURRENCY,
  },
};

const tokenCache = global.__rapidPayTokenCache || { accessToken: null, expiresAt: 0 };
global.__rapidPayTokenCache = tokenCache;

function requireRapidPayConfig() {
  if (!RAPIDPAY_CLIENT_ID || !RAPIDPAY_CLIENT_SECRET) {
    throw new Error('RapidPay is not configured. Set RAPIDPAY_CLIENT_ID and RAPIDPAY_CLIENT_SECRET.');
  }

  if (!Number.isFinite(RAPIDPAY_MERCHANT_ID) || RAPIDPAY_MERCHANT_ID <= 0) {
    throw new Error('RapidPay is not configured. Set RAPIDPAY_MERCHANT_ID to a valid number.');
  }
}

function resolvePlan(planId) {
  const normalized = String(planId || 'student').trim().toLowerCase();
  return PLAN_CATALOG[normalized] || null;
}

function sanitizeMobile(value) {
  return String(value || '').replace(/[^0-9+]/g, '').slice(0, 20);
}

function buildBasketId(planId) {
  const now = Date.now();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `MM-${planId.toUpperCase()}-${now}-${rand}`;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`RapidPay returned non-JSON response (status ${response.status}).`);
  }
}

async function fetchRapidPayAccessToken() {
  requireRapidPayConfig();

  const now = Date.now();
  if (tokenCache.accessToken && tokenCache.expiresAt - 10_000 > now) {
    return tokenCache.accessToken;
  }

  const credentials = Buffer.from(`${RAPIDPAY_CLIENT_ID}:${RAPIDPAY_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${RAPIDPAY_BASE_URL}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const body = await parseJsonResponse(response);
  if (!response.ok) {
    const details = body.error_description || body.error || body.message || `HTTP ${response.status}`;
    throw new Error(`RapidPay token request failed: ${details}`);
  }

  const accessToken = body.access_token;
  if (!accessToken) {
    throw new Error('RapidPay token response is missing access_token.');
  }

  const expiresIn = Number(body.expires_in || 299);
  tokenCache.accessToken = accessToken;
  tokenCache.expiresAt = now + Math.max(30, expiresIn) * 1000;

  return accessToken;
}

async function createRapidPayCheckoutSession({ planId, customerEmail, customerMobile }) {
  const plan = resolvePlan(planId);
  if (!plan) {
    throw new Error('Invalid plan. Allowed values: student, family, school.');
  }

  const email = String(customerEmail || '').trim();
  const mobile = sanitizeMobile(customerMobile);
  if (!email || !email.includes('@')) {
    throw new Error('A valid customerEmail is required.');
  }
  if (!mobile) {
    throw new Error('A valid customerMobile is required.');
  }

  const accessToken = await fetchRapidPayAccessToken();
  const basketId = buildBasketId(plan.id);
  const payload = {
    merchantId: RAPIDPAY_MERCHANT_ID,
    amount: Number(plan.amount.toFixed(2)),
    currency: plan.currency,
    basketId,
    customerEmail: email,
    customerMobile: mobile,
  };

  const response = await fetch(`${RAPIDPAY_BASE_URL}/v1/checkout-sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Environment': RAPIDPAY_ENVIRONMENT,
    },
    body: JSON.stringify(payload),
  });

  const body = await parseJsonResponse(response);
  if (!response.ok) {
    const details = body.error_description || body.error || body.message || `HTTP ${response.status}`;
    throw new Error(`RapidPay checkout session request failed: ${details}`);
  }

  if (!body.sessionId || !body.clientSecret || !body.publishableKey) {
    throw new Error('RapidPay checkout session response is missing required fields.');
  }

  return {
    sessionId: body.sessionId,
    basketId,
    clientSecret: body.clientSecret,
    publishableKey: body.publishableKey,
    amount: plan.amount,
    currency: plan.currency,
    merchantName: RAPIDPAY_MERCHANT_NAME,
    plan: { id: plan.id, name: plan.name },
  };
}

async function getRapidPayCheckoutSessionStatus(sessionId) {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    throw new Error('sessionId is required.');
  }

  const accessToken = await fetchRapidPayAccessToken();
  const response = await fetch(`${RAPIDPAY_BASE_URL}/v1/checkout-sessions/${encodeURIComponent(normalizedSessionId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Environment': RAPIDPAY_ENVIRONMENT,
    },
  });

  const body = await parseJsonResponse(response);
  if (!response.ok) {
    const details = body.error_description || body.error || body.message || `HTTP ${response.status}`;
    throw new Error(`RapidPay session status request failed: ${details}`);
  }

  return body;
}

module.exports = {
  PLAN_CATALOG,
  createRapidPayCheckoutSession,
  getRapidPayCheckoutSessionStatus,
};

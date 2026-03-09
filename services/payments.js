const crypto = require('crypto');

const createMockPayment = async ({ amount, reservationId }) => {
  return {
    gateway: 'mock',
    status: 'pending',
    checkoutUrl: `/mock-pay/${reservationId}`,
    amount
  };
};

const createJazzCashPayment = async ({ amount, reservationId }) => ({
  gateway: 'jazzcash',
  status: 'pending',
  reservationId,
  merchantId: process.env.PAYMENT_MERCHANT_ID || 'JAZZCASH_MERCHANT_ID_PLACEHOLDER',
  amount
});

const createEasyPaisaPayment = async ({ amount, reservationId }) => ({
  gateway: 'easypaisa',
  status: 'pending',
  reservationId,
  merchantId: process.env.PAYMENT_MERCHANT_ID || 'EASYPAISA_MERCHANT_ID_PLACEHOLDER',
  amount
});

const createDepositPayment = async ({ amount, reservationId }) => {
  const mode = process.env.PAYMENT_MODE || 'mock';
  if (mode === 'jazzcash') return createJazzCashPayment({ amount, reservationId });
  if (mode === 'easypaisa') return createEasyPaisaPayment({ amount, reservationId });
  return createMockPayment({ amount, reservationId });
};

const validatePaymentCallbackSignature = (payload, signature, secret) => {
  if (!signature || !secret) return false;
  const computed = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
};

module.exports = {
  createDepositPayment,
  validatePaymentCallbackSignature
};

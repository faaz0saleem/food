const nodemailer = require('nodemailer');
const twilio = require('twilio');

const isProduction = process.env.NODE_ENV === 'production';

const getTransporter = () => {
  if (!process.env.SMTP_URL) return null;
  return nodemailer.createTransport(process.env.SMTP_URL);
};

const sendEmailConfirmation = async (reservation) => {
  const message = `Reservation confirmed for ${reservation.name} at ${reservation.date} ${reservation.time}.`;

  if (!isProduction || !process.env.SMTP_URL) {
    console.log('[MOCK EMAIL]', message);
    return { mocked: true };
  }

  const transporter = getTransporter();
  return transporter.sendMail({
    from: process.env.EMAIL_FROM || 'no-reply@lahore-table-booking.local',
    to: reservation.email || process.env.FALLBACK_NOTIFICATION_EMAIL,
    subject: 'Reservation Confirmation',
    text: message
  });
};

const sendWhatsAppConfirmation = async (reservation) => {
  const message = `Your table booking is received. Ref: ${reservation._id}`;

  if (!isProduction || !process.env.TWILIO_SID || !process.env.TWILIO_TOKEN) {
    console.log('[MOCK WHATSAPP]', message);
    return { mocked: true };
  }

  const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
  return client.messages.create({
    body: message,
    from: process.env.WHATSAPP_NUMBER,
    to: `whatsapp:${reservation.phone}`
  });
};

const sendReminder = async (reservation, minutesBefore) => {
  const message = `Reminder: booking in ${minutesBefore} minutes for ${reservation.name}.`;
  if (!isProduction) {
    console.log('[MOCK REMINDER]', message);
    return { mocked: true };
  }
  await sendEmailConfirmation(reservation);
  await sendWhatsAppConfirmation(reservation);
  return { sent: true };
};

module.exports = {
  sendEmailConfirmation,
  sendWhatsAppConfirmation,
  sendReminder
};

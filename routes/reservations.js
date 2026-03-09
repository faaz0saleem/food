const express = require('express');
const mongoose = require('mongoose');
const { body, param, validationResult } = require('express-validator');
const Reservation = require('../models/Reservation');
const Restaurant = require('../models/Restaurant');
const Table = require('../models/Table');
const { sendEmailConfirmation, sendWhatsAppConfirmation } = require('../services/notifications');
const { createDepositPayment } = require('../services/payments');
const { reservationLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

router.post(
  '/',
  reservationLimiter,
  [
    body('restaurantId').isMongoId(),
    body('tableId').isMongoId(),
    body('name').trim().isLength({ min: 2, max: 80 }).escape(),
    body('phone').trim().isLength({ min: 8, max: 20 }).escape(),
    body('date').isISO8601(),
    body('time').matches(/^([01]\d|2[0-3]):([0-5]\d)$/),
    body('guests').isInt({ min: 1, max: 20 }),
    body('paymentReference').optional().trim().isLength({ min: 3, max: 120 }).escape()
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { restaurantId, tableId, name, phone, date, time, guests, paymentReference } = req.body;
      const [restaurant, table] = await Promise.all([
        Restaurant.findById(restaurantId).session(session),
        Table.findOne({ _id: tableId, restaurantId }).session(session)
      ]);

      if (!restaurant || !table) {
        await session.abortTransaction();
        return res.status(404).json({ message: 'Restaurant or table not found' });
      }
      if (table.seats < guests) {
        await session.abortTransaction();
        return res.status(400).json({ message: 'Guests exceed table capacity' });
      }

      const existing = await Reservation.findOne({
        tableId,
        date,
        time,
        status: { $in: ['pending', 'confirmed'] },
        expiresAt: { $gt: new Date() }
      }).session(session);

      if (existing) {
        await session.abortTransaction();
        return res.status(409).json({ message: 'Selected table is already reserved for this slot' });
      }

      const expiresMinutes = Number(process.env.DEPOSIT_EXPIRY_MINUTES || 15);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + expiresMinutes * 60 * 1000);

      const reservation = await Reservation.create(
        [{
          restaurantId,
          tableId,
          name,
          phone,
          date,
          time,
          guests,
          paymentReference: paymentReference || null,
          paymentStatus: restaurant.depositRequired ? 'pending' : 'not_required',
          expiresAt,
          status: 'pending'
        }],
        { session }
      );

      table.isAvailable = false;
      table.reservations.push(reservation[0]._id);
      await table.save({ session });

      await session.commitTransaction();

      const payment = restaurant.depositRequired
        ? await createDepositPayment({ amount: restaurant.depositAmount, reservationId: reservation[0]._id })
        : null;

      await sendEmailConfirmation(reservation[0]);
      await sendWhatsAppConfirmation(reservation[0]);

      res.status(201).json({ reservation: reservation[0], payment });
    } catch (error) {
      await session.abortTransaction();
      next(error);
    } finally {
      session.endSession();
    }
  }
);

router.get('/:id', [param('id').isMongoId()], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const reservation = await Reservation.findById(req.params.id).populate('restaurantId tableId');
    if (!reservation) return res.status(404).json({ message: 'Reservation not found' });
    res.json(reservation);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/cancel', [param('id').isMongoId()], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const reservation = await Reservation.findById(req.params.id);
    if (!reservation) return res.status(404).json({ message: 'Reservation not found' });

    if (reservation.status === 'cancelled') return res.json({ reservation, message: 'Already cancelled' });

    const slotDate = new Date(`${reservation.date}T${reservation.time}:00`);
    const refundEligible = slotDate.getTime() - Date.now() >= 24 * 60 * 60 * 1000;

    reservation.status = 'cancelled';
    reservation.cancelledAt = new Date();
    reservation.refundEligible = refundEligible;
    if (refundEligible && reservation.paymentStatus === 'paid') {
      reservation.paymentStatus = 'refunded';
    }

    await reservation.save();
    await Table.findByIdAndUpdate(reservation.tableId, { isAvailable: true });

    res.json({
      message: refundEligible
        ? 'Reservation cancelled. Refund will be processed.'
        : 'Reservation cancelled. Refund not eligible within 24 hours.',
      reservation
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

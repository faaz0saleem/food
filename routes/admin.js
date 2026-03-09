const express = require('express');
const bcrypt = require('bcryptjs');
const { body, param, validationResult } = require('express-validator');
const Reservation = require('../models/Reservation');
const { authenticateAdmin } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiters');
const { signAccessToken, signRefreshToken } = require('../utils/tokens');

const router = express.Router();

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || bcrypt.hashSync('admin12345', 10);

router.post(
  '/login',
  authLimiter,
  [body('username').trim().isLength({ min: 3, max: 60 }), body('password').isLength({ min: 8, max: 128 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { username, password } = req.body;
    if (username !== ADMIN_USER) return res.status(401).json({ message: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

    const accessToken = signAccessToken({ username });
    const refreshToken = signRefreshToken({ username });

    return res.json({ accessToken, refreshToken, expiresIn: '15m' });
  }
);

router.post(
  '/restaurants/:id/confirm',
  authenticateAdmin,
  [param('id').isMongoId(), body('reservationId').isMongoId(), body('action').isIn(['confirm', 'reject'])],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { reservationId, action } = req.body;
      const reservation = await Reservation.findById(reservationId);
      if (!reservation) return res.status(404).json({ message: 'Reservation not found' });

      reservation.status = action === 'confirm' ? 'confirmed' : 'rejected';
      await reservation.save();

      res.json({ message: `Reservation ${action}ed`, reservation });
    } catch (error) {
      next(error);
    }
  }
);

router.get('/dashboard', authenticateAdmin, async (_req, res, next) => {
  try {
    const [totalBookings, noShows, paidReservations] = await Promise.all([
      Reservation.countDocuments(),
      Reservation.countDocuments({ status: 'no_show' }),
      Reservation.find({ paymentStatus: 'paid' })
    ]);

    const revenue = paidReservations.length * Number(process.env.DEFAULT_DEPOSIT_AMOUNT || 1000);

    res.json({ totalBookings, noShows, revenue });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

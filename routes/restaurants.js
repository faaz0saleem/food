const express = require('express');
const { query, param, validationResult } = require('express-validator');
const Restaurant = require('../models/Restaurant');
const Table = require('../models/Table');
const Reservation = require('../models/Reservation');

const router = express.Router();

router.get('/', async (_req, res, next) => {
  try {
    const restaurants = await Restaurant.find().lean();
    res.json(restaurants);
  } catch (error) {
    next(error);
  }
});

router.get(
  '/:id/tables',
  [
    param('id').isMongoId(),
    query('date').isISO8601().withMessage('date must be ISO8601'),
    query('time').matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage('time must be HH:mm')
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { id } = req.params;
      const { date, time } = req.query;

      const [tables, blockedReservations] = await Promise.all([
        Table.find({ restaurantId: id }).lean(),
        Reservation.find({
          restaurantId: id,
          date,
          time,
          status: { $in: ['pending', 'confirmed'] },
          expiresAt: { $gt: new Date() }
        }).lean()
      ]);

      const blockedTableIds = new Set(blockedReservations.map((r) => String(r.tableId)));
      const response = tables.map((table) => ({
        ...table,
        isAvailable: table.isAvailable && !blockedTableIds.has(String(table._id))
      }));

      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;

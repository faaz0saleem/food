const mongoose = require('mongoose');

const tableSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    number: { type: Number, required: true },
    seats: { type: Number, required: true },
    isAvailable: { type: Boolean, default: true },
    reservations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Reservation' }]
  },
  { timestamps: true }
);

tableSchema.index({ restaurantId: 1, number: 1 }, { unique: true });

module.exports = mongoose.model('Table', tableSchema);

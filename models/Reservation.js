const mongoose = require('mongoose');

const reservationSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true, index: true },
    tableId: { type: mongoose.Schema.Types.ObjectId, ref: 'Table', required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    date: { type: String, required: true },
    time: { type: String, required: true },
    guests: { type: Number, required: true, min: 1 },
    paymentReference: { type: String, default: null },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'refunded', 'not_required'],
      default: 'pending'
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'rejected', 'cancelled', 'completed', 'no_show'],
      default: 'pending'
    },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    cancelledAt: { type: Date, default: null },
    refundEligible: { type: Boolean, default: false }
  },
  { timestamps: true, optimisticConcurrency: true }
);

reservationSchema.index({ tableId: 1, date: 1, time: 1, status: 1 });

module.exports = mongoose.model('Reservation', reservationSchema);

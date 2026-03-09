const mongoose = require('mongoose');

const restaurantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    cuisine: { type: String, required: true, trim: true },
    images: [{ type: String }],
    openingHours: { type: String, required: true },
    depositRequired: { type: Boolean, default: true },
    depositAmount: { type: Number, default: 1000 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Restaurant', restaurantSchema);

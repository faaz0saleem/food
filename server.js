require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const { connectDB } = require('./config/db');
const Restaurant = require('./models/Restaurant');
const Reservation = require('./models/Reservation');
const Table = require('./models/Table');
const reservationRoutes = require('./routes/reservations');
const restaurantRoutes = require('./routes/restaurants');
const adminRoutes = require('./routes/admin');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan('dev'));

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', extensions: ['html'] }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/info', (_req, res) => {
  const productionHttpsRequired = process.env.NODE_ENV === 'production';
  res.json({
    app: 'lahore-table-booking',
    productionHttpsRequired,
    message: productionHttpsRequired
      ? 'Deploy behind HTTPS (Cloud Run managed cert or Let’s Encrypt).'
      : 'Running in non-production mode.'
  });
});

app.use('/api/restaurants', restaurantRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/admin', adminRoutes);

app.use(errorHandler);

const releaseExpiredReservations = async () => {
  const now = new Date();
  const expired = await Reservation.find({
    paymentStatus: 'pending',
    status: 'pending',
    expiresAt: { $lte: now }
  });

  for (const reservation of expired) {
    reservation.status = 'cancelled';
    await reservation.save();
    await Table.findByIdAndUpdate(reservation.tableId, { isAvailable: true });
    console.log(`Released expired reservation: ${reservation._id}`);
  }
};

const startServer = async () => {
  await connectDB();

  if ((await Restaurant.countDocuments()) === 0) {
    console.log('No restaurants found. Run npm run seed to populate sample data.');
  }

  setInterval(() => {
    releaseExpiredReservations().catch((error) => console.error('Release job failed', error));
  }, 60 * 1000);

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
};

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Failed to boot server:', error);
    process.exit(1);
  });
}

module.exports = { app, releaseExpiredReservations };

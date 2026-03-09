require('dotenv').config();
const { connectDB } = require('../config/db');
const Restaurant = require('../models/Restaurant');
const Table = require('../models/Table');

const restaurants = [
  { name: 'Haveli Rooftop', address: 'Fort Road, Lahore', cuisine: 'Pakistani', images: ['/images/haveli.jpg'], openingHours: '12:00-23:00', depositRequired: true, depositAmount: 1500 },
  { name: 'Spice Bazaar', address: 'MM Alam Road, Lahore', cuisine: 'Fusion', images: ['/images/spice.jpg'], openingHours: '13:00-23:30', depositRequired: true, depositAmount: 1000 },
  { name: 'Cooco’s Den', address: 'Fort Road, Lahore', cuisine: 'Traditional', images: ['/images/cooco.jpg'], openingHours: '12:00-22:30', depositRequired: false, depositAmount: 0 },
  { name: 'Salt’n Pepper Village', address: 'Liberty, Lahore', cuisine: 'Buffet', images: ['/images/snp.jpg'], openingHours: '12:30-23:00', depositRequired: true, depositAmount: 1200 },
  { name: 'The Poet Boutique', address: 'Gulberg III, Lahore', cuisine: 'Continental', images: ['/images/poet.jpg'], openingHours: '11:00-23:00', depositRequired: true, depositAmount: 1000 },
  { name: 'Andaaz', address: 'Walled City, Lahore', cuisine: 'Fine Dining', images: ['/images/andaaz.jpg'], openingHours: '18:00-23:30', depositRequired: true, depositAmount: 2000 }
];

const seed = async () => {
  await connectDB();
  await Promise.all([Restaurant.deleteMany({}), Table.deleteMany({})]);

  for (const restaurantPayload of restaurants) {
    const restaurant = await Restaurant.create(restaurantPayload);
    const tablePayload = Array.from({ length: 8 }).map((_, idx) => ({
      restaurantId: restaurant._id,
      number: idx + 1,
      seats: idx < 2 ? 2 : idx < 6 ? 4 : 6,
      isAvailable: true,
      reservations: []
    }));
    await Table.insertMany(tablePayload);
  }

  console.log('Seed complete: restaurants and tables created.');
  process.exit(0);
};

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});

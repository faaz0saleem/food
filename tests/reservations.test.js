const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

const { app } = require('../server');
const Restaurant = require('../models/Restaurant');
const Table = require('../models/Table');
const Reservation = require('../models/Reservation');

let mongoServer;
let restaurant;
let table;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  restaurant = await Restaurant.create({
    name: 'Test Restaurant',
    address: 'Lahore',
    cuisine: 'Pakistani',
    openingHours: '10:00-23:00',
    depositRequired: true,
    depositAmount: 1000
  });

  table = await Table.create({
    restaurantId: restaurant._id,
    number: 1,
    seats: 4,
    isAvailable: true,
    reservations: []
  });
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongoServer.stop();
});

test('rejects invalid reservation payload', async () => {
  const res = await request(app).post('/api/reservations').send({});
  expect(res.statusCode).toBe(400);
});

test('creates and cancels reservation and checks db state', async () => {
  const createRes = await request(app).post('/api/reservations').send({
    restaurantId: restaurant._id.toString(),
    tableId: table._id.toString(),
    name: 'Ali',
    phone: '+923001112233',
    date: '2030-12-01',
    time: '20:00',
    guests: 3
  });

  expect(createRes.statusCode).toBe(201);
  const reservationId = createRes.body.reservation._id;

  const created = await Reservation.findById(reservationId);
  expect(created).toBeTruthy();
  expect(created.status).toBe('pending');

  const cancelRes = await request(app).post(`/api/reservations/${reservationId}/cancel`).send({});
  expect(cancelRes.statusCode).toBe(200);

  const cancelled = await Reservation.findById(reservationId);
  expect(cancelled.status).toBe('cancelled');
});

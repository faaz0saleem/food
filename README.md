# lahore-table-booking (MVP)

Production-ready MVP reservation platform for dine-in bookings in Lahore.

## Features
- Restaurant listing with seeded data (6 restaurants).
- Table availability by date/time.
- Reservation create/get/cancel APIs.
- Deposit flow with mock/JazzCash/Easypaisa scaffolding.
- Notifications service (email + WhatsApp) with mock mode in non-production.
- Admin JWT auth, reservation confirm/reject, dashboard stats.
- Auto-release expired unpaid reservations.
- Mobile-first frontend with booking form + QR code confirmation.
- Security controls: helmet, rate limiters, validation/sanitization, bcrypt, JWT.

## API Endpoints
- `GET /api/restaurants`
- `GET /api/restaurants/:id/tables?date=YYYY-MM-DD&time=HH:mm`
- `POST /api/reservations`
- `GET /api/reservations/:id`
- `POST /api/reservations/:id/cancel`
- `POST /admin/login`
- `POST /admin/restaurants/:id/confirm`
- `GET /admin/dashboard`

## Booking Defaults
- Deposit default: Rs 1000 (restaurant-specific; configurable in seed).
- Pending deposit expiry: 15 minutes (`DEPOSIT_EXPIRY_MINUTES`).
- Refund rule: eligible if cancelled 24+ hours before booking time.

## Local Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create env file:
   ```bash
   cp .env.example .env
   ```
3. Install MongoDB locally and run it (default URI: `mongodb://localhost:27017/reservationDB`).
4. Seed restaurants and tables:
   ```bash
   npm run seed
   ```
5. Start server:
   ```bash
   npm start
   ```
6. Open `http://localhost:3000`.

## Tests
```bash
npm test
```
Includes integration flow: create reservation + cancel + DB assertions, and invalid-input rejection.

## Mock vs Production Modes
- `NODE_ENV=development` / `test`: notifications and payment processing run in mock/log mode.
- `NODE_ENV=production`: configure `SMTP_URL`, Twilio variables, and payment credentials.

## Payment Integration Notes
- `services/payments.js` includes placeholders for JazzCash and Easypaisa merchant IDs.
- Add merchant keys using env vars:
  - `PAYMENT_MERCHANT_ID`
  - `PAYMENT_CALLBACK_SECRET`
- Validate callbacks with `validatePaymentCallbackSignature`.

## Security Checklist
- Password hashing via bcrypt (`ADMIN_PASSWORD_HASH`).
- JWT short expiry (15m) + refresh token (7d).
- Input validation/sanitization via `express-validator`.
- Rate limiting on login and reservation endpoints.
- Payment callback signature verification helper.
- HTTPS required in production:
  - Cloud Run: use managed certificates + domain mapping.
  - VM/Nginx: Let’s Encrypt via certbot.

## Docker
Build and run locally:
```bash
docker build -t lahore-booking .
docker run -p 3000:3000 --env-file .env -e MONGO_URI=mongodb://host.docker.internal:27017/reservationDB lahore-booking
```

## Deploy Path 1: Google Cloud Run
1. Enable billing and APIs (`run.googleapis.com`, `cloudbuild.googleapis.com`, `artifactregistry.googleapis.com`).
2. Build with Cloud Build:
   ```bash
   gcloud builds submit --config cloudbuild.yaml
   ```
3. Deploy:
   ```bash
   gcloud run deploy lahore-table-booking --image gcr.io/PROJECT_ID/lahore-booking:COMMIT_SHA --region asia-south1 --allow-unauthenticated
   ```
4. Set secrets (Secret Manager + Cloud Run env):
   ```bash
   gcloud secrets create JWT_SECRET --replication-policy=automatic
   gcloud run services update lahore-table-booking --set-secrets JWT_SECRET=JWT_SECRET:latest
   ```
5. Domain mapping + HTTPS managed cert in Cloud Run console.

### DNS instructions (Cloud Run)
At your registrar, add records from Cloud Run domain mapping screen. Typical form:
- `CNAME` for `www` → `ghs.googlehosted.com`
- `A` records for apex (if provided by Google mapping wizard)

## Deploy Path 2: GitHub → Docker → Render/Vercel
- Render: use `render.yaml` and set env vars in Render dashboard.
- Vercel: use `vercel.json` (for simple Node hosting).

### DNS instructions (Render/Vercel)
- `CNAME` `www` → provider target (given by dashboard)
- `A` apex `@` → provider IP (if required)
- Enable automatic HTTPS in provider settings.

## Operational logging
Important events log to console; replace with centralized logger later (e.g., Winston + GCP Logging/Sentry).

# Deployment Modes

## Option 1: Full Hostinger PHP stack
- Frontend hosted on Hostinger
- PHP API hosted on Hostinger under `/api`
- MySQL hosted on Hostinger
- phpMyAdmin available on Hostinger
- Set `window.HUNGTER_API_BASE = ''`

## Option 2: Hostinger frontend + separate real backend
- Frontend hosted on Hostinger
- Backend hosted elsewhere (VPS, Render, Railway, your own server)
- Real database hosted with that backend or managed MySQL
- Set `/api-config.js` to your backend origin:

```js
window.HUNGTER_API_BASE = 'https://your-backend-domain.com';
```

Requirements for external backend:
- HTTPS enabled
- CORS allowing your Hostinger frontend origin
- Same endpoint contract as current frontend expects
- Persistent database for users, sessions, chat logs, subscriptions, and rate limits

## Recommendation
For real production auth and user data, use a persistent backend server plus MySQL. Hostinger frontend + external backend is fully possible with the current client architecture because pages already read `window.HUNGTER_API_BASE`.

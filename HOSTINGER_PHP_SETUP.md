# Hungter Hostinger + phpMyAdmin Setup

This project now includes:
- PHP API backend in `/api`
- MySQL schema in `/database/schema.mysql.sql`
- phpMyAdmin package in `/phpMyAdmin-5.2.3-all-languages`

## 1) Upload files to Hostinger
1. Open Hostinger hPanel.
2. Go to **Files -> File Manager**.
3. Open `public_html`.
4. Upload this repo contents into `public_html`.

## 2) Create MySQL database/user in Hostinger
1. Go to **Databases -> MySQL Databases**.
2. Create:
- Database name
- Database user
- Strong password
3. Note the values:
- `MYSQL_HOST` (usually `localhost`)
- `MYSQL_PORT` (usually `3306`)
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`

## 3) Import schema with phpMyAdmin
1. In Hostinger hPanel, open **phpMyAdmin** for your database.
2. Select your database.
3. Open **Import**.
4. Import file: `/database/schema.mysql.sql`.

## 4) Configure backend env values
Your PHP API reads env from root `.env`.
Create/edit `.env` in `public_html` with:

```
GROQ_API_KEY=your_groq_key
GROQ_MODEL=llama-3.3-70b-versatile
ADMIN_KEY=your_admin_key

MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_DATABASE=your_db_name
MYSQL_USER=your_db_user
MYSQL_PASSWORD=your_db_password
```

## 5) Configure phpMyAdmin package in project
File: `/phpMyAdmin-5.2.3-all-languages/config.inc.php`
- Set a strong random value for `$cfg['blowfish_secret']`.
- Keep auth type as `cookie`.

## 6) Access URLs
- App: `https://your-domain.com/`
- API status: `https://your-domain.com/api/status`
- phpMyAdmin package: `https://your-domain.com/phpMyAdmin-5.2.3-all-languages/`

## 7) Test checklist
1. Open `/api/status` -> expect JSON with `status: ok`.
2. Open `/api/quiz` via app page and confirm quiz loads.
3. Open `/api/chat` via app page and confirm AI reply.
4. Open phpMyAdmin URL and sign in with Hostinger MySQL username/password.

## 8) Security recommendations
1. Rename phpMyAdmin folder after upload (example: `/db-panel-9f3x/`).
2. Keep `setup/` blocked (already blocked with `.htaccess`).
3. Use a strong unique MySQL password.
4. Never commit production `.env`.

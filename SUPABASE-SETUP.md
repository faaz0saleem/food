# Hungter × Supabase — already wired

This app is pre-configured for the Supabase project **dgakpfautrrfonjnbybh**.
The database driver is Postgres and the tables are created automatically on
first run. You only supply the secret: the DB password.

## The ONE thing to do
Add your Supabase database password to the server `.env` (never commit it):

    SUPABASE_DB_PASSWORD=your-supabase-db-password

Requires the PHP `pdo_pgsql` extension (Hostinger: hPanel → PHP Configuration →
Extensions → enable `pdo_pgsql`).

That's it. On the next request the app connects to Supabase and creates every
table (users, chats, sessions, admins, …) itself.

## IPv4 hosts (Hostinger) — important
The default is Supabase's **Direct** connection, which is IPv6-only. Most shared
hosts (Hostinger) are IPv4-only, so use the **Session pooler** instead. In the
Supabase Connect dialog choose *Session pooler*, then add to `.env`:

    SUPABASE_DB_HOST=aws-0-<your-region>.pooler.supabase.com
    SUPABASE_DB_PORT=5432
    SUPABASE_DB_USER=postgres.dgakpfautrrfonjnbybh
    SUPABASE_DB_PASSWORD=your-supabase-db-password

(Or paste the full pooler URI as `SUPABASE_DB_URL=...`.)

## Verify
- `/api/diag` → the `database` block shows `"provider":"Supabase (Postgres)"`,
  `"connected":true`, and a user count.
- `/admin` → log in with `admin` / `Faaz12345` (the admin row seeds itself).

## Point at a different project later
Set `SUPABASE_DB_URL` (or the `SUPABASE_DB_*` fields) in `.env` — env always
overrides the built-in project defaults.

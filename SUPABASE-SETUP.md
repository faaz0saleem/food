# Connect Hungter to Supabase (Postgres)

The PHP backend now speaks Postgres automatically — you just point it at Supabase.

## 1. Create the tables
Supabase Dashboard → **SQL Editor** → paste all of `supabase/schema.sql` → **Run**.

## 2. Get your connection details
Supabase Dashboard → **Project Settings → Database → Connection info**
(use the **Session/Transaction pooler** for shared hosting like Hostinger).

## 3. Add to your server `.env`
Either one URL:

    SUPABASE_DB_URL=postgres://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:6543/postgres

or the discrete fields:

    SUPABASE_DB_HOST=aws-0-<region>.pooler.supabase.com
    SUPABASE_DB_PORT=6543
    SUPABASE_DB_NAME=postgres
    SUPABASE_DB_USER=postgres.<ref>
    SUPABASE_DB_PASSWORD=<your db password>

Setting any of these switches the whole app to Supabase (no MySQL needed).
Requires the PHP `pdo_pgsql` extension (on by default on most hosts; on Hostinger
enable it in hPanel → PHP Configuration → Extensions).

## 4. Verify
Open `/api/diag` — it reports DB status. Then `/admin` → log in
(`admin` / `Faaz12345`); the seeded admin is created on first login.

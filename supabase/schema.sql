-- Hungter — Supabase (Postgres) schema.
-- Run this ONCE in your Supabase project: Dashboard → SQL Editor → paste → Run.
-- Then set SUPABASE_DB_* (or SUPABASE_DB_URL) in the server .env and the whole
-- PHP backend talks to Supabase automatically.

create table if not exists users (
  id             bigserial primary key,
  visitor_id     varchar(120),
  name           varchar(120),
  email          varchar(190) unique,
  password_hash  varchar(255) not null default '',
  email_verified smallint not null default 0,
  learning_style varchar(60) default 'Visual',
  level          varchar(60) default 'Newbie',
  xp             integer not null default 0,
  plan_name      varchar(60) default '',
  plan_price     numeric(10,2) not null default 0,
  plan_status    varchar(30) not null default 'inactive',
  plan_started   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_users_email on users (email);

create table if not exists visitor_sessions (
  visitor_id  varchar(120) primary key,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  ip_address  varchar(64),
  country     varchar(2)
);
create index if not exists idx_visitor_last_seen on visitor_sessions (last_seen);

create table if not exists chats (
  id             bigserial primary key,
  visitor_id     varchar(120),
  subject        varchar(120) default 'General',
  user_level     varchar(60),
  learning_style varchar(60),
  engine         varchar(120),
  model          varchar(120),
  message        text,
  reply          text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_chats_created_at on chats (created_at);
create index if not exists idx_chats_subject on chats (subject);

create table if not exists auth_sessions (
  token       varchar(128) primary key,
  user_id     bigint not null,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists idx_auth_sessions_user on auth_sessions (user_id);
create index if not exists idx_auth_sessions_expires on auth_sessions (expires_at);

create table if not exists api_rate_limits (
  limiter_key   varchar(160) primary key,
  window_start  timestamptz not null,
  request_count integer not null default 0,
  updated_at    timestamptz not null default now()
);

create table if not exists ai_usage_daily (
  usage_date  date not null,
  scope_key   varchar(190) not null,
  user_id     bigint,
  calls_used  integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (usage_date, scope_key)
);
create index if not exists idx_ai_usage_user on ai_usage_daily (user_id);

create table if not exists auth_challenges (
  id             bigserial primary key,
  user_id        bigint not null references users(id) on delete cascade,
  challenge_type varchar(32) not null,
  code_hash      varchar(255) not null,
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists idx_challenges_user on auth_challenges (user_id);

create table if not exists book_orders (
  id          bigserial primary key,
  order_ref   varchar(40) not null,
  book_id     varchar(120) not null,
  book_title  varchar(255) not null,
  price       numeric(10,2) not null default 0,
  email       varchar(190) not null,
  user_id     bigint,
  status      varchar(30) not null default 'pending',
  created_at  timestamptz not null default now()
);
create index if not exists idx_book_orders_email on book_orders (email);

create table if not exists admins (
  id            bigserial primary key,
  username      varchar(64) not null unique,
  password_hash varchar(255) not null,
  created_at    timestamptz not null default now()
);
-- The first admin (admin / Faaz12345) is seeded automatically by the app on
-- first login. To seed manually, generate a bcrypt hash and insert it here.

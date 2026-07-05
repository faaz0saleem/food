PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT UNIQUE,
  name TEXT,
  email TEXT,
  password_hash TEXT,
  learning_style TEXT DEFAULT 'Visual',
  level TEXT DEFAULT 'Newbie',
  xp INTEGER DEFAULT 0,
  plan_name TEXT,
  plan_price REAL,
  plan_status TEXT DEFAULT 'inactive',
  plan_started TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS visitor_sessions (
  visitor_id TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  ip_address TEXT
);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT,
  subject TEXT NOT NULL DEFAULT 'General',
  user_level TEXT NOT NULL DEFAULT 'Newbie',
  learning_style TEXT,
  engine TEXT,
  model TEXT,
  message TEXT NOT NULL,
  reply TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (visitor_id) REFERENCES users(visitor_id)
);

CREATE TABLE IF NOT EXISTS quiz_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT,
  subject TEXT NOT NULL,
  score INTEGER NOT NULL,
  total_questions INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (visitor_id) REFERENCES users(visitor_id)
);

CREATE TABLE IF NOT EXISTS milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT,
  event TEXT NOT NULL,
  achieved_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (visitor_id) REFERENCES users(visitor_id)
);

CREATE INDEX IF NOT EXISTS idx_chats_visitor_id ON chats(visitor_id);
CREATE INDEX IF NOT EXISTS idx_chats_created_at ON chats(created_at);
CREATE INDEX IF NOT EXISTS idx_quiz_results_visitor_id ON quiz_results(visitor_id);
CREATE INDEX IF NOT EXISTS idx_quiz_results_subject ON quiz_results(subject);

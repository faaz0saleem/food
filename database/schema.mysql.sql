-- Hungter MySQL schema for Hostinger/phpMyAdmin
-- Import this file in phpMyAdmin (SQL tab).

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  visitor_id VARCHAR(120) UNIQUE,
  name VARCHAR(160),
  email VARCHAR(190),
  password_hash VARCHAR(255),
  learning_style VARCHAR(60) DEFAULT 'Visual',
  level VARCHAR(60) DEFAULT 'Newbie',
  xp INT NOT NULL DEFAULT 0,
  plan_name VARCHAR(80),
  plan_price DECIMAL(10,2),
  plan_status VARCHAR(40) DEFAULT 'inactive',
  plan_started DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_visitor_id (visitor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS visitor_sessions (
  visitor_id VARCHAR(120) NOT NULL,
  first_seen DATETIME NOT NULL,
  last_seen DATETIME NOT NULL,
  ip_address VARCHAR(64),
  PRIMARY KEY (visitor_id),
  KEY idx_visitor_sessions_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chats (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  visitor_id VARCHAR(120),
  subject VARCHAR(120) NOT NULL DEFAULT 'General',
  user_level VARCHAR(60) NOT NULL DEFAULT 'Newbie',
  learning_style VARCHAR(60),
  engine VARCHAR(120),
  model VARCHAR(120),
  message TEXT NOT NULL,
  reply MEDIUMTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_chats_visitor_id (visitor_id),
  KEY idx_chats_subject (subject),
  KEY idx_chats_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quiz_results (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  visitor_id VARCHAR(120),
  subject VARCHAR(120) NOT NULL,
  score INT NOT NULL,
  total_questions INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_quiz_results_visitor_id (visitor_id),
  KEY idx_quiz_results_subject (subject),
  KEY idx_quiz_results_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS milestones (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  visitor_id VARCHAR(120),
  event VARCHAR(255) NOT NULL,
  achieved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_milestones_visitor_id (visitor_id),
  KEY idx_milestones_achieved_at (achieved_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

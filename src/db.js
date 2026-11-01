const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(config.mediaDir, { recursive: true });
const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('facebook','instagram')),
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  username TEXT,
  picture_url TEXT,
  access_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (platform, external_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  caption TEXT NOT NULL DEFAULT '',
  media_file TEXT,
  media_type TEXT CHECK (media_type IN ('image','video') OR media_type IS NULL),
  scheduled_at TEXT NOT NULL,          -- ISO 8601 UTC
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS post_targets (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','publishing','published','failed')),
  external_post_id TEXT,
  permalink TEXT,
  error TEXT,
  published_at TEXT,
  likes INTEGER, comments INTEGER, shares INTEGER, views INTEGER,
  stats_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS follower_snapshots (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  followers INTEGER NOT NULL,
  taken_on TEXT NOT NULL,              -- YYYY-MM-DD
  UNIQUE (account_id, taken_on)
);
`);

module.exports = db;

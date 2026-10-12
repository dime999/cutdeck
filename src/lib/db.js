'use strict';
// node:sqlite je ugrađen u Node.js (22.13+). Sakrij upozorenje "experimental".
const origEmit = process.emitWarning;
process.emitWarning = function (w, ...rest) {
  if (String(w && w.message ? w.message : w).includes('SQLite')) return;
  return origEmit.call(process, w, ...rest);
};

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');

for (const dir of [path.join(cfg.dataDir, 'uploads'), cfg.recordingsDir, cfg.shortsDir, cfg.thumbsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
const db = new DatabaseSync(path.join(cfg.dataDir, 'app.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name        TEXT NOT NULL,
  thumbnail   TEXT,
  tokens_enc  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',  -- active | reconnect
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, platform, external_id)
);

CREATE TABLE IF NOT EXISTS uploads (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  used          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  tags          TEXT NOT NULL DEFAULT '[]',
  category_id   TEXT NOT NULL DEFAULT '22',
  privacy       TEXT NOT NULL,
  made_for_kids INTEGER NOT NULL,
  publish_at    TEXT,
  file_deleted  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id              INTEGER PRIMARY KEY,
  video_id        INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  account_id      INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  account_name    TEXT NOT NULL,
  platform        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | uploading | done | failed
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  progress        INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  upload_url      TEXT,
  external_id     TEXT,
  external_url    TEXT,
  finished_at     TEXT,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS jobs_video ON jobs(video_id);

CREATE TABLE IF NOT EXISTS recordings (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  path       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  duration   REAL,
  width      INTEGER,
  height     INTEGER,
  status     TEXT NOT NULL DEFAULT 'pending', -- pending | analyzing | ready | failed
  progress   INTEGER NOT NULL DEFAULT 0,
  error      TEXT,
  waveform   TEXT,                             -- JSON: glasnoća 0–100 po stubiću vremenske trake
  hidden     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS moments (
  id           INTEGER PRIMARY KEY,
  recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  start_s      REAL NOT NULL,
  end_s        REAL NOT NULL,
  score        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS moments_recording ON moments(recording_id);

CREATE TABLE IF NOT EXISTS clips (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recording_id   INTEGER REFERENCES recordings(id) ON DELETE SET NULL,
  recording_name TEXT NOT NULL,
  title          TEXT NOT NULL,
  start_s        REAL NOT NULL,
  end_s          REAL NOT NULL,
  layout         TEXT NOT NULL,
  path           TEXT NOT NULL,
  size           INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | rendering | ready | failed
  progress       INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS clips_status ON clips(status);
`);

// Kolone dodane nakon što je tabela već mogla biti napravljena.
function addColumn(table, column, type) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
addColumn('recordings', 'waveform', 'TEXT');

db.now = () => new Date().toISOString();

db.transaction = (fn) => {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};

module.exports = db;

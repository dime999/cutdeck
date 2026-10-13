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

for (const dir of [cfg.recordingsDir, cfg.shortsDir, cfg.thumbsDir, cfg.thumbnailsDir, cfg.bumpersDir, cfg.videosDir, cfg.tmpDir]) {
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

CREATE TABLE IF NOT EXISTS thumbnails (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recording_id   INTEGER REFERENCES recordings(id) ON DELETE SET NULL,
  recording_name TEXT NOT NULL,
  title          TEXT NOT NULL,
  path           TEXT NOT NULL,
  size           INTEGER NOT NULL,
  created_at     TEXT NOT NULL
);

-- Intro i outro klipovi
CREATE TABLE IF NOT EXISTS bumpers (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  path       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  duration   REAL NOT NULL,
  width      INTEGER,
  height     INTEGER,
  has_audio  INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- Gotovi videi složeni iz dijelova (intro + video + outro)
CREATE TABLE IF NOT EXISTS exports (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  parts      TEXT NOT NULL,                    -- JSON: [{kind, id, name, main?}] redom kojim se spajaju
  path       TEXT NOT NULL,
  size       INTEGER NOT NULL DEFAULT 0,
  duration   REAL,
  width      INTEGER,
  height     INTEGER,
  status     TEXT NOT NULL DEFAULT 'pending', -- pending | rendering | ready | failed
  progress   INTEGER NOT NULL DEFAULT 0,
  error      TEXT,
  created_at TEXT NOT NULL
);

-- Titlovi prepoznati iz govora u Shortu
CREATE TABLE IF NOT EXISTS captions (
  id         INTEGER PRIMARY KEY,
  clip_id    INTEGER NOT NULL UNIQUE REFERENCES clips(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending', -- pending | transcribing | ready | failed
  progress   INTEGER NOT NULL DEFAULT 0,
  error      TEXT,
  lines      TEXT NOT NULL DEFAULT '[]',      -- JSON: [{start, end, text}], vremena u sekundama
  style      TEXT NOT NULL DEFAULT '{}',      -- JSON: font, size, color, position, upper
  created_at TEXT NOT NULL
);

-- Trajna podešavanja po korisniku (npr. zadani stil titlova, zadani tekst paketa za objavu)
CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,                       -- JSON
  PRIMARY KEY (user_id, key)
);

-- Paket za objavu: tekst i thumbnail za jedan Short, video ili snimak
CREATE TABLE IF NOT EXISTS kits (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                  -- clip | video | recording
  item_id      INTEGER NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  hashtags     TEXT NOT NULL DEFAULT '',
  tags         TEXT NOT NULL DEFAULT '',
  thumbnail_id INTEGER REFERENCES thumbnails(id) ON DELETE SET NULL,
  published_at TEXT,
  updated_at   TEXT NOT NULL,
  UNIQUE (user_id, kind, item_id)
);

-- Clipping: pravila jednog briefa i epizoda iz koje se reže
CREATE TABLE IF NOT EXISTS campaigns (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  recording_id  INTEGER REFERENCES recordings(id) ON DELETE SET NULL,
  hashtags      TEXT NOT NULL DEFAULT '',
  tag_youtube   TEXT NOT NULL DEFAULT '',
  tag_tiktok    TEXT NOT NULL DEFAULT '',
  tag_instagram TEXT NOT NULL DEFAULT '',
  tag_x         TEXT NOT NULL DEFAULT '',
  banned        TEXT NOT NULL DEFAULT '',
  min_seconds   INTEGER NOT NULL DEFAULT 7,
  created_at    TEXT NOT NULL
);

-- Transkript cijelog snimka: riječi sa vremenima
CREATE TABLE IF NOT EXISTS transcripts (
  id           INTEGER PRIMARY KEY,
  recording_id INTEGER NOT NULL UNIQUE REFERENCES recordings(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | transcribing | ready | failed
  progress     INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  words        TEXT NOT NULL DEFAULT '[]',      -- JSON: [{s, e, t}], vremena u sekundama
  created_at   TEXT NOT NULL
);

-- Gdje je klip iz kampanje objavljen
CREATE TABLE IF NOT EXISTS posts (
  id        INTEGER PRIMARY KEY,
  clip_id   INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  platform  TEXT NOT NULL,                      -- youtube | tiktok | instagram | x
  url       TEXT NOT NULL DEFAULT '',
  posted_at TEXT,
  UNIQUE (clip_id, platform)
);
`);

// Kolone dodane nakon što je tabela već mogla biti napravljena.
function addColumn(table, column, type) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
addColumn('recordings', 'waveform', 'TEXT');
// Short sa titlovima: iz kojeg Shorta je nastao i sadržaj ASS fajla koji se upisuje u sliku.
addColumn('clips', 'source_clip_id', 'INTEGER');
addColumn('clips', 'subtitles', 'TEXT');
// Lanac „napravi sve“: šta slijedi kad Short bude gotov (JSON), vidi studio.js.
addColumn('clips', 'followup', 'TEXT');
// Natpis koji se crta preko Shorta, npr. { text: 'PART 3', position: 'top' } (JSON).
addColumn('clips', 'label', 'TEXT');
// Klip iz kampanje: kojoj kampanji pripada, iz kojih dijelova izvora je složen (JSON), koliko traje i opis za objavu.
addColumn('clips', 'campaign_id', 'INTEGER');
addColumn('clips', 'edl', 'TEXT');
addColumn('clips', 'length_s', 'REAL');
addColumn('clips', 'caption', 'TEXT');
// Redovi titlova klipa kampanje (JSON), da se riječi mogu ispraviti i klip ponovo napraviti.
addColumn('clips', 'cap_lines', 'TEXT');
// Glasnoća snimka u decibelima za svaku sekundu (JSON); iz nje se biraju hook i prijedlozi klipova.
addColumn('recordings', 'levels', 'TEXT');

db.now = () => new Date().toISOString();

// Aplikacija nema prijavu: sve pripada jednom lokalnom korisniku.
// Ako baza već ima korisnika iz vremena prijave, njegovi snimci ostaju njegovi.
db.localUser = () => {
  const first = db.prepare('SELECT id, name FROM users ORDER BY id LIMIT 1').get();
  if (first) return first;
  const r = db.prepare("INSERT INTO users (email, name, password_hash, created_at) VALUES ('local', 'You', '', ?)").run(db.now());
  return { id: Number(r.lastInsertRowid), name: 'You' };
};

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

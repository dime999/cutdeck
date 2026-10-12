'use strict';
// Snimci i Shorts: skeniranje foldera, analiza i rezanje. Radi jedan ffmpeg posao istovremeno.
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const cfg = require('./config');
const db = require('./db');
const media = require('./media');

const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|webm|avi|mts|ts)$/i;
const MIN_CLIP = 3;
const MAX_CLIP = 180; // YouTube Shorts: najviše 3 minute
let busy = false;

function listVideos(dir, depth = 0) {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {}
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && depth < 5) out.push(...listVideos(full, depth + 1));
    else if (e.isFile() && VIDEO_EXT.test(e.name)) out.push(full);
  }
  return out;
}

/** Dodaje nove fajlove iz foldera sa snimcima. Vraća broj dodanih. */
function scan(userId) {
  const known = db.prepare('SELECT 1 FROM recordings WHERE path=?');
  const insert = db.prepare('INSERT INTO recordings (user_id, path, name, size, created_at) VALUES (?, ?, ?, ?, ?)');
  let added = 0;
  for (const file of listVideos(cfg.recordingsDir)) {
    if (known.get(file)) continue;
    const st = fs.statSync(file);
    if (!st.size || Date.now() - st.mtimeMs < 5000) continue; // fajl se još kopira
    insert.run(userId, file, path.basename(file), st.size, db.now());
    added++;
  }
  tick();
  return added;
}

function createClip(rec, { title, start, end, layout }) {
  const r = db
    .prepare(
      'INSERT INTO clips (user_id, recording_id, recording_name, title, start_s, end_s, layout, path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(rec.user_id, rec.id, rec.name, title, start, end, layout, path.join(cfg.shortsDir, `${crypto.randomBytes(16).toString('hex')}.mp4`), db.now());
  tick();
  return Number(r.lastInsertRowid);
}

const thumbPath = (kind, id) => path.join(cfg.thumbsDir, `${kind}-${id}.jpg`);

function start() {
  // Poslovi prekinuti gašenjem aplikacije kreću ispočetka, a snimci analizirani
  // prije nego što je postojala vremenska traka analiziraju se ponovo.
  db.prepare("UPDATE recordings SET status='pending', progress=0 WHERE status='analyzing' OR (status='ready' AND waveform IS NULL)").run();
  db.prepare("UPDATE clips SET status='pending', progress=0 WHERE status='rendering'").run();
  tick();
}

function tick() {
  if (busy || !media.isAvailable()) return;
  // Shorts imaju prednost: korisnik ih čeka, a analiza novih snimaka može kasnije.
  const clip = db.prepare("SELECT id FROM clips WHERE status='pending' ORDER BY id LIMIT 1").get();
  const rec = clip ? null : db.prepare("SELECT id FROM recordings WHERE status='pending' AND hidden=0 ORDER BY id LIMIT 1").get();
  if (!clip && !rec) return;
  busy = true;
  (clip ? renderClip(clip.id) : analyze(rec.id))
    .catch((e) => console.error('[studio] unexpected error', e))
    .finally(() => {
      busy = false;
      setImmediate(tick);
    });
}

function progressSetter(table, id) {
  const stmt = db.prepare(`UPDATE ${table} SET progress=? WHERE id=?`);
  let last = -1;
  return (fraction) => {
    const pct = Math.floor(fraction * 100);
    if (pct !== last) stmt.run((last = pct), id);
  };
}

async function analyze(id) {
  const rec = db.prepare('SELECT * FROM recordings WHERE id=?').get(id);
  const fail = (msg) => db.prepare("UPDATE recordings SET status='failed', error=? WHERE id=?").run(msg, id);
  if (!fs.existsSync(rec.path)) return fail('The file no longer exists on disk.');
  db.prepare("UPDATE recordings SET status='analyzing', progress=0, error=NULL WHERE id=?").run(id);
  try {
    const info = await media.probe(rec.path);
    db.prepare('UPDATE recordings SET duration=?, width=?, height=? WHERE id=?').run(info.duration, info.width, info.height, id);
    const levels = info.hasAudio ? await media.audioLevels(rec.path, info.duration, progressSetter('recordings', id)) : [];
    const moments = media.findMoments(levels);
    // Sličica iz prvog predloženog trenutka; bez nje stranica i dalje radi.
    const at = moments.length ? moments[0].start + 15 : info.duration * 0.1;
    await media.thumbnail(rec.path, thumbPath('rec', id), at, 480).catch((e) => console.warn(`[studio] thumbnail: ${e.message}`));
    db.transaction(() => {
      db.prepare('UPDATE recordings SET waveform=? WHERE id=?').run(JSON.stringify(media.waveform(levels)), id);
      db.prepare('DELETE FROM moments WHERE recording_id=?').run(id);
      const insert = db.prepare('INSERT INTO moments (recording_id, start_s, end_s, score) VALUES (?, ?, ?, ?)');
      for (const m of moments) insert.run(id, m.start, m.end, m.score);
      db.prepare("UPDATE recordings SET status='ready', progress=100, error=? WHERE id=?").run(
        info.hasAudio ? null : 'This recording has no audio track, so there are no suggestions. Pick the moments by hand.',
        id
      );
    });
    console.log(`[studio] ✔ analyzed "${rec.name}" (${moments.length} moments)`);
  } catch (err) {
    console.warn(`[studio] ✘ analysis of "${rec.name}": ${err.message}`);
    fail(err.message);
  }
}

async function renderClip(id) {
  const clip = db.prepare('SELECT * FROM clips WHERE id=?').get(id);
  const rec = clip.recording_id ? db.prepare('SELECT path FROM recordings WHERE id=?').get(clip.recording_id) : null;
  const fail = (msg) => db.prepare("UPDATE clips SET status='failed', error=? WHERE id=?").run(msg, id);
  if (!rec || !fs.existsSync(rec.path)) return fail('The recording no longer exists on disk.');
  db.prepare("UPDATE clips SET status='rendering', progress=0, error=NULL WHERE id=?").run(id);
  try {
    await media.renderShort(
      { input: rec.path, output: clip.path, start: clip.start_s, duration: clip.end_s - clip.start_s, layout: clip.layout },
      progressSetter('clips', id)
    );
    const length = clip.end_s - clip.start_s;
    await media.thumbnail(clip.path, thumbPath('clip', id), Math.min(1, length / 2), 360).catch((e) => console.warn(`[studio] thumbnail: ${e.message}`));
    db.prepare("UPDATE clips SET status='ready', progress=100, size=? WHERE id=?").run(fs.statSync(clip.path).size, id);
    console.log(`[studio] ✔ Short "${clip.title}"`);
  } catch (err) {
    console.warn(`[studio] ✘ Short "${clip.title}": ${err.message}`);
    fs.rm(clip.path, { force: true }, () => {});
    fail(err.message);
  }
}

module.exports = { MIN_CLIP, MAX_CLIP, thumbPath, scan, createClip, start, tick };

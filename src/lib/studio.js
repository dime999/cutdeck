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
  db.prepare("UPDATE captions SET status='pending', progress=0 WHERE status='transcribing'").run();
  tick();
  db.prepare("UPDATE exports SET status='pending', progress=0 WHERE status='rendering'").run();
  tickExports();
}

function tick() {
  if (busy || !media.isAvailable()) return;
  // Shorts imaju prednost: korisnik ih čeka, a analiza novih snimaka može kasnije.
  const clip = db.prepare("SELECT id FROM clips WHERE status='pending' ORDER BY id LIMIT 1").get();
  const cap = clip ? null : db.prepare("SELECT id FROM captions WHERE status='pending' ORDER BY id LIMIT 1").get();
  const rec = clip || cap ? null : db.prepare("SELECT id FROM recordings WHERE status='pending' AND hidden=0 ORDER BY id LIMIT 1").get();
  if (!clip && !cap && !rec) return;
  busy = true;
  (clip ? renderClip(clip.id) : cap ? transcribeClip(cap.id) : analyze(rec.id))
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
  const fail = (msg) => db.prepare("UPDATE clips SET status='failed', error=? WHERE id=?").run(msg, id);
  // Short sa titlovima nastaje iz već izrezanog Shorta, a običan iz snimka.
  const source = clip.subtitles
    ? db.prepare('SELECT path FROM clips WHERE id=?').get(clip.source_clip_id)
    : db.prepare('SELECT path FROM recordings WHERE id=?').get(clip.recording_id);
  if (!source || !fs.existsSync(source.path)) {
    return fail(clip.subtitles ? 'The original Short no longer exists on disk.' : 'The recording no longer exists on disk.');
  }
  db.prepare("UPDATE clips SET status='rendering', progress=0, error=NULL WHERE id=?").run(id);
  try {
    const length = clip.end_s - clip.start_s;
    const onProgress = progressSetter('clips', id);
    if (clip.subtitles) await media.renderCaptioned({ input: source.path, output: clip.path, subtitles: clip.subtitles, duration: length }, onProgress);
    else await media.renderShort({ input: source.path, output: clip.path, start: clip.start_s, duration: length, layout: clip.layout }, onProgress);
    await media.thumbnail(clip.path, thumbPath('clip', id), Math.min(1, length / 2), 360).catch((e) => console.warn(`[studio] thumbnail: ${e.message}`));
    db.prepare("UPDATE clips SET status='ready', progress=100, size=? WHERE id=?").run(fs.statSync(clip.path).size, id);
    console.log(`[studio] ✔ Short "${clip.title}"`);
  } catch (err) {
    console.warn(`[studio] ✘ Short "${clip.title}": ${err.message}`);
    fs.rm(clip.path, { force: true }, () => {});
    fail(err.message);
  }
}

// ── Intro/outro klipovi i gotovi videi ────────────────────
async function addBumper(userId, file, name, size) {
  const info = await media.probe(file);
  const r = db
    .prepare('INSERT INTO bumpers (user_id, name, path, size, duration, width, height, has_audio, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(userId, name, file, size, info.duration, info.width, info.height, info.hasAudio ? 1 : 0, db.now());
  const id = Number(r.lastInsertRowid);
  await media.thumbnail(file, thumbPath('bumper', id), Math.min(1, info.duration / 2), 480).catch((e) => console.warn(`[studio] thumbnail: ${e.message}`));
  return id;
}

/** `parts` je redoslijed dijelova: [{kind: 'bumper'|'recording'|'clip', id, name, main?}]. */
function createExport(userId, { title, parts }) {
  const file = path.join(cfg.videosDir, `${crypto.randomBytes(16).toString('hex')}.mp4`);
  const r = db
    .prepare('INSERT INTO exports (user_id, title, parts, path, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, title, JSON.stringify(parts), file, db.now());
  tickExports();
  return Number(r.lastInsertRowid);
}

function partFile(part) {
  const table = { bumper: 'bumpers', recording: 'recordings', clip: 'clips' }[part.kind];
  const row = table ? db.prepare(`SELECT path FROM ${table} WHERE id=?`).get(part.id) : null;
  return row && fs.existsSync(row.path) ? row.path : null;
}

// Spajanje dugog snimka može trajati dugo, pa ima svoju traku i ne zaustavlja rezanje Shortsa.
let exporting = null; // { id, controller }
function tickExports() {
  if (exporting || !media.isAvailable()) return;
  const next = db.prepare("SELECT id FROM exports WHERE status='pending' ORDER BY id LIMIT 1").get();
  if (!next) return;
  exporting = { id: next.id, controller: new AbortController() };
  renderExport(next.id, exporting.controller.signal)
    .catch((e) => console.error('[studio] unexpected error', e))
    .finally(() => {
      exporting = null;
      setImmediate(tickExports);
    });
}

/** Prekida video koji se upravo pravi. Vraća false ako taj video nije u toku. */
function cancelExport(id) {
  if (!exporting || exporting.id !== id) return false;
  exporting.controller.abort();
  return true;
}

async function renderExport(id, signal) {
  const exp = db.prepare('SELECT * FROM exports WHERE id=?').get(id);
  db.prepare("UPDATE exports SET status='rendering', progress=0, error=NULL WHERE id=?").run(id);
  try {
    const parts = [];
    for (const part of JSON.parse(exp.parts)) {
      const file = partFile(part);
      if (!file) throw new Error(`“${part.name}” no longer exists on disk.`);
      parts.push({ ...part, path: file, ...(await media.probe(file)) });
    }
    // Glavni dio određuje veličinu i broj sličica; libx264 traži parne dimenzije.
    const main = parts.find((p) => p.main) || parts[0];
    const even = (n) => n - (n % 2);
    await media.renderJoined(
      { parts, output: exp.path, width: even(main.width), height: even(main.height), fps: main.fps },
      progressSetter('exports', id),
      signal
    );
    const out = await media.probe(exp.path);
    const mainStart = parts.slice(0, parts.indexOf(main)).reduce((sum, p) => sum + p.duration, 0);
    await media
      .thumbnail(exp.path, thumbPath('video', id), mainStart + Math.min(5, main.duration / 2), 480)
      .catch((e) => console.warn(`[studio] thumbnail: ${e.message}`));
    db.prepare("UPDATE exports SET status='ready', progress=100, size=?, duration=?, width=?, height=? WHERE id=?").run(
      fs.statSync(exp.path).size,
      out.duration,
      out.width,
      out.height,
      id
    );
    console.log(`[studio] ✔ video "${exp.title}"`);
  } catch (err) {
    const message = signal.aborted ? 'Cancelled.' : err.message;
    console.warn(`[studio] ✘ video "${exp.title}": ${message}`);
    fs.rm(exp.path, { force: true }, () => {});
    db.prepare("UPDATE exports SET status='failed', error=? WHERE id=?").run(message, id);
  }
}

// ── Titlovi ───────────────────────────────────────────────
/** Stavlja prepoznavanje govora za Short u red. Postojeći titlovi tog Shorta se zamjenjuju. */
function requestCaptions(clipId) {
  db.prepare(
    `INSERT INTO captions (clip_id, created_at) VALUES (?, ?)
     ON CONFLICT(clip_id) DO UPDATE SET status='pending', progress=0, error=NULL, lines='[]'`
  ).run(clipId, db.now());
  tick();
}

async function transcribeClip(id) {
  const cap = db.prepare('SELECT * FROM captions WHERE id=?').get(id);
  const clip = db.prepare('SELECT * FROM clips WHERE id=?').get(cap.clip_id);
  const fail = (msg) => db.prepare("UPDATE captions SET status='failed', error=? WHERE id=?").run(msg, id);
  if (!clip || !fs.existsSync(clip.path)) return fail('The Short no longer exists on disk.');
  const problem = media.transcribeProblem();
  if (problem) return fail(problem);
  db.prepare("UPDATE captions SET status='transcribing', progress=0, error=NULL WHERE id=?").run(id);
  try {
    const lines = await media.transcribe(clip.path, clip.end_s - clip.start_s, progressSetter('captions', id));
    db.prepare("UPDATE captions SET status='ready', progress=100, lines=? WHERE id=?").run(JSON.stringify(lines), id);
    console.log(`[studio] ✔ captions for "${clip.title}" (${lines.length} lines)`);
  } catch (err) {
    console.warn(`[studio] ✘ captions for "${clip.title}": ${err.message}`);
    fail(err.message);
  }
}

/** Pravi novi Short: kopiju zadanog sa titlovima upisanim u sliku. */
function createCaptionedClip(clip, lines, style) {
  const subtitles = media.buildAss(lines, style, media.SHORT_SIZE);
  const r = db
    .prepare(
      `INSERT INTO clips (user_id, recording_id, recording_name, title, start_s, end_s, layout, path, source_clip_id, subtitles, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      clip.user_id,
      clip.recording_id,
      clip.recording_name,
      `${clip.title.slice(0, 89)} (captions)`,
      clip.start_s,
      clip.end_s,
      clip.layout,
      path.join(cfg.shortsDir, `${crypto.randomBytes(16).toString('hex')}.mp4`),
      clip.id,
      subtitles,
      db.now()
    );
  tick();
  return Number(r.lastInsertRowid);
}

module.exports = { MIN_CLIP, MAX_CLIP, thumbPath, scan, createClip, addBumper, createExport, cancelExport, requestCaptions, createCaptionedClip, start, tick };

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

function createClip(rec, { title, start, end, layout, followup = null }) {
  const file = path.join(cfg.shortsDir, `${crypto.randomBytes(16).toString('hex')}.mp4`);
  const r = db
    .prepare(
      'INSERT INTO clips (user_id, recording_id, recording_name, title, start_s, end_s, layout, path, followup, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(rec.user_id, rec.id, rec.name, title, start, end, layout, file, followup ? JSON.stringify(followup) : null, db.now());
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

// Posao koji upravo radi u ovoj traci, da se može prekinuti: { kind, id, controller }.
let current = null;

function tick() {
  if (busy || !media.isAvailable()) return;
  // Započeti lanac se prvo dovrši (titlovi, pa njihovo upisivanje), tek onda se reže sljedeći Short.
  // Tako kod dijeljenja snimka dijelovi izlaze gotovi jedan po jedan, a ne svi tek na kraju.
  const pending = (sql) => db.prepare(sql).get();
  const captioned = pending("SELECT id FROM clips WHERE status='pending' AND subtitles IS NOT NULL ORDER BY id LIMIT 1");
  const cap = captioned ? null : pending("SELECT id FROM captions WHERE status='pending' ORDER BY id LIMIT 1");
  const clip = captioned || (cap ? null : pending("SELECT id FROM clips WHERE status='pending' ORDER BY id LIMIT 1"));
  const rec = clip || cap ? null : pending("SELECT id FROM recordings WHERE status='pending' AND hidden=0 ORDER BY id LIMIT 1");
  if (!clip && !cap && !rec) return;
  busy = true;
  const controller = new AbortController();
  current = { kind: clip ? 'clip' : cap ? 'captions' : 'recording', id: (clip || cap || rec).id, controller };
  (clip ? renderClip(clip.id, controller.signal) : cap ? transcribeClip(cap.id, controller.signal) : analyze(rec.id))
    .catch((e) => console.error('[studio] unexpected error', e))
    .finally(() => {
      busy = false;
      current = null;
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

async function renderClip(id, signal) {
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
    if (clip.subtitles) await media.renderCaptioned({ input: source.path, output: clip.path, subtitles: clip.subtitles, duration: length }, onProgress, signal);
    else {
      const overlay = clip.label ? media.buildLabelAss(JSON.parse(clip.label), media.SHORT_SIZE) : null;
      await media.renderShort({ input: source.path, output: clip.path, start: clip.start_s, duration: length, layout: clip.layout, overlay }, onProgress, signal);
    }
    await media.thumbnail(clip.path, thumbPath('clip', id), Math.min(1, length / 2), 360).catch((e) => console.warn(`[studio] thumbnail: ${e.message}`));
    db.prepare("UPDATE clips SET status='ready', progress=100, size=? WHERE id=?").run(fs.statSync(clip.path).size, id);
    console.log(`[studio] ✔ Short "${clip.title}"`);
    advanceClip(id);
  } catch (err) {
    removeFile(clip.path);
    if (signal.aborted) return; // prekinuo ga je korisnik; red je već obrisan
    console.warn(`[studio] ✘ Short "${clip.title}": ${err.message}`);
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

async function transcribeClip(id, signal) {
  const cap = db.prepare('SELECT * FROM captions WHERE id=?').get(id);
  const clip = db.prepare('SELECT * FROM clips WHERE id=?').get(cap.clip_id);
  const fail = (msg) => db.prepare("UPDATE captions SET status='failed', error=? WHERE id=?").run(msg, id);
  if (!clip || !fs.existsSync(clip.path)) return fail('The Short no longer exists on disk.');
  const problem = media.transcribeProblem();
  if (problem) return fail(problem);
  db.prepare("UPDATE captions SET status='transcribing', progress=0, error=NULL WHERE id=?").run(id);
  try {
    const lines = await media.transcribe(clip.path, clip.end_s - clip.start_s, progressSetter('captions', id), signal);
    db.prepare("UPDATE captions SET status='ready', progress=100, lines=? WHERE id=?").run(JSON.stringify(lines), id);
    console.log(`[studio] ✔ captions for "${clip.title}" (${lines.length} lines)`);
    const next = readFollowup(clip);
    if (next && next.captions) {
      // Lanac: titlovi se upisuju bez pregleda, u zadanom stilu. Ako govora nema, ide se dalje bez njih.
      db.prepare('UPDATE captions SET style=? WHERE id=?').run(JSON.stringify(next.style || {}), id);
      if (lines.length) {
        clearFollowup(clip.id);
        createCaptionedClip(clip, lines, next.style, { ...next, captions: false });
      } else finishChain(clip, next);
    }
  } catch (err) {
    if (signal.aborted) return; // prekinuo ih je korisnik zajedno sa lancem
    console.warn(`[studio] ✘ captions for "${clip.title}": ${err.message}`);
    fail(err.message);
    // Lanac se ne prekida zbog titlova: intro i outro se dodaju i bez njih.
    const next = readFollowup(clip);
    if (next && next.captions) finishChain(clip, next);
  }
}

/** Pravi novi Short: kopiju zadanog sa titlovima upisanim u sliku. */
function createCaptionedClip(clip, lines, style, followup = null) {
  const subtitles = media.buildAss(lines, style, media.SHORT_SIZE);
  const r = db
    .prepare(
      `INSERT INTO clips (user_id, recording_id, recording_name, title, start_s, end_s, layout, path, source_clip_id, subtitles, followup, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      followup ? JSON.stringify(followup) : null,
      db.now()
    );
  tick();
  return Number(r.lastInsertRowid);
}

// ── Lanac „napravi sve“ ───────────────────────────────────
// Short može nositi upute šta slijedi kad bude gotov (kolona followup):
// { captions, style, intro, outro, title }. Svaki korak ih predaje sljedećem.
const readFollowup = (clip) => (clip && clip.followup ? JSON.parse(clip.followup) : null);
const clearFollowup = (clipId) => db.prepare('UPDATE clips SET followup=NULL WHERE id=?').run(clipId);

/** Short je gotov: pokreće sljedeći korak lanca, ako ga ima. */
function advanceClip(clipId) {
  const clip = db.prepare('SELECT * FROM clips WHERE id=?').get(clipId);
  const next = readFollowup(clip);
  if (!next) return;
  // Kod dijeljenja snimka: kad je Short sa titlovima gotov, međukorak bez titlova više ne treba.
  if (next.cleanup && clip.subtitles) {
    const source = db.prepare('SELECT * FROM clips WHERE id=?').get(clip.source_clip_id);
    if (source) deleteClip(source);
  }
  if (next.captions && !clip.subtitles && !media.transcribeProblem()) return requestCaptions(clip.id);
  finishChain(clip, next);
}

/** Posljednji korak lanca: intro i outro, ako su traženi i još postoje. */
function finishChain(clip, next) {
  clearFollowup(clip.id);
  const bumper = (id) => (id ? db.prepare('SELECT id, name FROM bumpers WHERE id=? AND user_id=?').get(id, clip.user_id) : null);
  const intro = bumper(next.intro);
  const outro = bumper(next.outro);
  if (!intro && !outro) return;
  const part = (b) => ({ kind: 'bumper', id: b.id, name: b.name });
  createExport(clip.user_id, {
    title: next.title || clip.title,
    parts: [intro && part(intro), { kind: 'clip', id: clip.id, name: clip.title, main: true }, outro && part(outro)].filter(Boolean),
  });
}

// ── Dijeljenje cijelog snimka na Shorts ───────────────────
const MIN_PART = 5; // najkraća dužina dijela koju korisnik može zadati

/**
 * Dijeli snimak na uzastopne dijelove zadane dužine. Kratak ostatak na kraju se
 * pripaja posljednjem dijelu (ako time ne pređe najveću dužinu Shorta), a duži
 * ostatak postaje zaseban, kraći dio.
 */
function splitRanges(duration, length) {
  const full = Math.floor(duration / length);
  if (full === 0) return duration >= MIN_CLIP ? [{ start: 0, end: duration }] : [];
  const ranges = Array.from({ length: full }, (_, i) => ({ start: i * length, end: (i + 1) * length }));
  const rest = duration - full * length;
  if (rest >= Math.max(MIN_CLIP, length * 0.25)) ranges.push({ start: full * length, end: duration });
  else if (rest > 0 && length + rest <= MAX_CLIP) ranges[full - 1].end = duration;
  return ranges;
}

/**
 * Reže cijeli snimak na Shorts. `label` (npr. { word: 'PART', position: 'top' }) upisuje
 * redni broj dijela u sliku; `followup` je lanac koji slijedi za svaki dio.
 */
function splitRecording(rec, { length, layout, prefix, label = null, followup = null }) {
  const ranges = splitRanges(rec.duration, length);
  const insert = db.prepare(
    'INSERT INTO clips (user_id, recording_id, recording_name, title, start_s, end_s, layout, path, label, followup, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  db.transaction(() => {
    ranges.forEach((range, i) => {
      const title = `${prefix} - Part ${i + 1}`.slice(0, 100);
      insert.run(
        rec.user_id,
        rec.id,
        rec.name,
        title,
        range.start,
        range.end,
        layout,
        path.join(cfg.shortsDir, `${crypto.randomBytes(16).toString('hex')}.mp4`),
        label ? JSON.stringify({ text: `${label.word} ${i + 1}`, position: label.position }) : null,
        // Međukorak bez titlova se briše kad Short sa titlovima bude gotov, da ne ostanu dupli.
        followup ? JSON.stringify({ ...followup, title, cleanup: true }) : null,
        db.now()
      );
    });
  });
  tick();
  return ranges.length;
}

/** Briše Short sa diska i iz baze, zajedno sa njegovom sličicom i paketom za objavu. */
function deleteClip(clip) {
  removeFile(clip.path);
  fs.rm(thumbPath('clip', clip.id), { force: true }, () => {});
  db.prepare("DELETE FROM kits WHERE user_id=? AND kind='clip' AND item_id=?").run(clip.user_id, clip.id);
  db.prepare('DELETE FROM clips WHERE id=?').run(clip.id);
}

/** Briše fajl i kad ga ffmpeg još nakratko drži otvorenim (Windows). */
const removeFile = (file) => fs.rm(file, { force: true, maxRetries: 10, retryDelay: 200 }, () => {});

/** Prekida Short koji se upravo pravi ili čeka na red, i uklanja ga. */
function cancelClip(clip) {
  if (current && current.kind === 'clip' && current.id === clip.id) current.controller.abort();
  deleteClip(clip);
}

/**
 * Prekida sve Shortse koji još nisu gotovi i zaustavlja lance (titlove, intro i outro
 * koji su trebali uslijediti). Gotovi Shorts ostaju. Vraća koliko ih je uklonjeno.
 */
function cancelShorts(userId) {
  const unfinished = db.prepare("SELECT * FROM clips WHERE user_id=? AND status IN ('pending', 'rendering')").all(userId);
  const chained = 'SELECT id FROM clips WHERE user_id=? AND followup IS NOT NULL';
  const running = current && current.kind === 'captions' ? db.prepare(`SELECT 1 FROM captions WHERE id=? AND clip_id IN (${chained})`).get(current.id, userId) : null;
  db.prepare(`DELETE FROM captions WHERE status IN ('pending', 'transcribing') AND clip_id IN (${chained})`).run(userId);
  db.prepare('UPDATE clips SET followup=NULL WHERE user_id=?').run(userId);
  if (current && (current.kind === 'clip' || running)) current.controller.abort();
  for (const clip of unfinished) deleteClip(clip);
  return unfinished.length;
}

module.exports = { MIN_CLIP, MAX_CLIP, MIN_PART, thumbPath, scan, createClip, splitRanges, splitRecording, addBumper, createExport, cancelExport, requestCaptions, createCaptionedClip, cancelClip, cancelShorts, start, tick };

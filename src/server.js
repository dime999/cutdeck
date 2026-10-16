'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

const cfg = require('./lib/config');
const db = require('./lib/db');
const media = require('./lib/media');
const studio = require('./lib/studio');
const views = require('./views');

const LOCAL_USER = db.localUser();

// Trajna podešavanja korisnika, čuvana kao JSON.
function getSetting(userId, key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE user_id=? AND key=?').get(userId, key);
  return row ? JSON.parse(row.value) : fallback;
}
// Logo za watermark ili null; fajl koji je nestao sa diska se ne računa.
function currentLogo(userId) {
  const logo = getSetting(userId, 'logo', null);
  return logo && logo.file && fs.existsSync(logo.file) ? logo : null;
}
// Snimak podešavanja loga za Short, ako je u formi označeno „Add my logo“.
function watermarkFor(ctx, form) {
  const logo = form.get('watermark') === '1' ? currentLogo(ctx.user.id) : null;
  return logo ? JSON.stringify(logo) : null;
}
function setSetting(userId, key, value) {
  db.prepare('INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value').run(userId, key, JSON.stringify(value));
}

// ── Mini router ───────────────────────────────────────────
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp(
    '^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$'
  );
  routes.push({ method, re, keys, handler });
}

// Aplikacija nema prijavu. Kolačić služi samo da poruka potvrde preživi preusmjerenje.
const FLASH_COOKIE = 'cutdeck_flash';

function readFlash(req) {
  const m = new RegExp(`(?:^|;\\s*)${FLASH_COOKIE}=([^;]*)`).exec(req.headers.cookie || '');
  if (!m) return null;
  try {
    const f = JSON.parse(decodeURIComponent(m[1]));
    return ['ok', 'bad'].includes(f.type) && typeof f.msg === 'string' ? { type: f.type, msg: f.msg } : null;
  } catch {
    return null;
  }
}

function baseHeaders(ctx, extra = {}) {
  const headers = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin', ...extra };
  const cookie = `${FLASH_COOKIE}=${ctx.flashOut ? encodeURIComponent(JSON.stringify(ctx.flashOut)) : ''}; Path=/; HttpOnly; SameSite=Lax`;
  if (ctx.flashOut) headers['set-cookie'] = cookie;
  else if (ctx.flash) headers['set-cookie'] = `${cookie}; Max-Age=0`; // poruka je prikazana
  return headers;
}

function send(ctx, status, body, type = 'text/html; charset=utf-8') {
  ctx.res.writeHead(status, baseHeaders(ctx, { 'content-type': type }));
  ctx.res.end(body);
}
const html = (ctx, body, status = 200) => send(ctx, status, body);
const json = (ctx, obj, status = 200) => send(ctx, status, JSON.stringify(obj), 'application/json; charset=utf-8');
function redirect(ctx, location) {
  ctx.res.writeHead(303, baseHeaders(ctx, { location }));
  ctx.res.end();
}
function flash(ctx, type, msg) {
  ctx.flashOut = { type, msg };
}

async function readForm(req, limit = 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

// Zaštita od CSRF-a: POST/PUT zahtjevi moraju doći sa iste adrese.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // SameSite=Lax kolačić već štiti klasične forme
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// ── Statički fajlovi ──────────────────────────────────────
const STATIC_DIR = path.join(cfg.root, 'public');
const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
function serveStatic(req, res, pathname) {
  const file = path.join(STATIC_DIR, path.normalize(pathname.replace(/^\/static\//, '')));
  const stat = file.startsWith(STATIC_DIR + path.sep) ? fs.statSync(file, { throwIfNoEntry: false }) : null;
  if (!stat || !stat.isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

// ── Glavni handler ────────────────────────────────────────
async function handle(req, res) {
  const url = new URL(req.url, cfg.baseUrl);
  if (url.pathname.startsWith('/static/')) return serveStatic(req, res, url.pathname);

  const ctx = { req, res, url, path: url.pathname, query: url.searchParams, user: LOCAL_USER, flash: readFlash(req), params: {} };
  ctx.logo = currentLogo(LOCAL_USER.id); // da forme znaju ima li logo za kvačicu „Add my logo“

  if (['POST', 'PUT', 'DELETE'].includes(req.method) && !sameOrigin(req)) {
    return html(ctx, views.errorPage(ctx, 403, 'The request did not come from this site.'), 403);
  }

  const method = req.method === 'HEAD' ? 'GET' : req.method;
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    r.keys.forEach((k, i) => (ctx.params[k] = decodeURIComponent(m[i + 1])));
    return r.handler(ctx);
  }
  html(ctx, views.errorPage(ctx, 404, 'This page does not exist.'), 404);
}

route('GET', '/', (ctx) => redirect(ctx, '/recordings'));

// ── Rute: snimci i Shorts ─────────────────────────────────
const MEDIA_MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.jpg': 'image/jpeg',
};

// Šalje video ili sličicu uz podršku za Range, da player može premotavati.
function sendFile(ctx, file, downloadName) {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || !stat.size) return html(ctx, views.errorPage(ctx, 404, 'The file no longer exists on disk.'), 404);
  let start = 0;
  let end = stat.size - 1;
  const range = /^bytes=(\d*)-(\d*)$/.exec(ctx.req.headers.range || '');
  const partial = Boolean(range && (range[1] || range[2]));
  if (partial) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(end, Number(range[2]));
    } else {
      start = Math.max(0, stat.size - Number(range[2]));
    }
    if (start > end) {
      ctx.res.writeHead(416, baseHeaders(ctx, { 'content-range': `bytes */${stat.size}` }));
      return ctx.res.end();
    }
  }
  const headers = baseHeaders(ctx, {
    'content-type': MEDIA_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': end - start + 1,
    'accept-ranges': 'bytes',
  });
  if (partial) headers['content-range'] = `bytes ${start}-${end}/${stat.size}`;
  if (downloadName) headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
  ctx.res.writeHead(partial ? 206 : 200, headers);
  if (ctx.req.method === 'HEAD') return ctx.res.end();
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => ctx.res.destroy());
  ctx.res.on('close', () => stream.destroy());
  stream.pipe(ctx.res);
}

// "1:02:03", "12:34.5" ili "75" → sekunde (NaN ako nije ispravno).
function parseTime(text) {
  const parts = String(text || '').trim().split(':');
  if (!parts[0] || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

const userRecording = (ctx) =>
  db.prepare('SELECT * FROM recordings WHERE id=? AND user_id=? AND hidden=0').get(Number(ctx.params.id), ctx.user.id);
const userClip = (ctx) => db.prepare('SELECT * FROM clips WHERE id=? AND user_id=?').get(Number(ctx.params.id), ctx.user.id);

route(
  'GET',
  '/recordings',
  (ctx) => {
    const recordings = db.prepare('SELECT * FROM recordings WHERE user_id=? AND hidden=0 ORDER BY id DESC').all(ctx.user.id);
    const momentStmt = db.prepare('SELECT * FROM moments WHERE recording_id=? ORDER BY start_s');
    for (const r of recordings) {
      r.moments = momentStmt.all(r.id);
      r.hasThumb = fs.existsSync(studio.thumbPath('rec', r.id));
    }
    html(ctx, views.recordingsPage(ctx, { recordings, ffmpegOk: media.isAvailable(), folder: cfg.recordingsDir }));
  }
);

route(
  'POST',
  '/recordings/scan',
  (ctx) => {
    const added = studio.scan(ctx.user.id);
    flash(ctx, 'ok', added ? `Added ${added} new ${added === 1 ? 'recording' : 'recordings'}.` : 'No new recordings found in the folder.');
    redirect(ctx, '/recordings');
  }
);

route(
  'GET',
  '/recordings/:id',
  (ctx) => {
    const rec = userRecording(ctx);
    if (!rec) return html(ctx, views.errorPage(ctx, 404, 'This recording does not exist.'), 404);
    const moments = db.prepare('SELECT * FROM moments WHERE recording_id=? ORDER BY start_s').all(rec.id);
    const clips = db.prepare('SELECT * FROM clips WHERE recording_id=? AND user_id=? AND campaign_id IS NULL ORDER BY id DESC').all(rec.id, ctx.user.id);
    rec.hasThumb = fs.existsSync(studio.thumbPath('rec', rec.id));
    const bumpers = db.prepare('SELECT id, name, duration FROM bumpers WHERE user_id=? ORDER BY name COLLATE NOCASE').all(ctx.user.id);
    html(
      ctx,
      views.recordingPage(ctx, { rec, moments, clips: markPublished('clip', withThumbs(clips)), bumpers, captionsProblem: media.transcribeProblem(), ffmpegOk: media.isAvailable() })
    );
  }
);

function withThumbs(clips) {
  for (const c of clips) c.hasThumb = fs.existsSync(studio.thumbPath('clip', c.id));
  return clips;
}

route(
  'GET',
  '/recordings/:id/thumb',
  (ctx) => {
    const rec = userRecording(ctx);
    if (!rec) return html(ctx, views.errorPage(ctx, 404, 'This recording does not exist.'), 404);
    sendFile(ctx, studio.thumbPath('rec', rec.id));
  }
);

route(
  'GET',
  '/clips/:id/thumb',
  (ctx) => {
    const clip = userClip(ctx);
    if (!clip) return html(ctx, views.errorPage(ctx, 404, 'This Short does not exist.'), 404);
    sendFile(ctx, studio.thumbPath('clip', clip.id));
  }
);

route(
  'GET',
  '/recordings/:id/file',
  (ctx) => {
    const rec = userRecording(ctx);
    if (!rec) return html(ctx, views.errorPage(ctx, 404, 'This recording does not exist.'), 404);
    sendFile(ctx, rec.path);
  }
);

route(
  'POST',
  '/recordings/:id/analyze',
  (ctx) => {
    const rec = userRecording(ctx);
    if (!rec) return redirect(ctx, '/recordings');
    if (rec.status === 'failed' || rec.status === 'ready') {
      db.prepare("UPDATE recordings SET status='pending', progress=0, error=NULL WHERE id=?").run(rec.id);
      studio.tick();
    }
    redirect(ctx, `/recordings/${rec.id}`);
  }
);

route(
  'POST',
  '/recordings/:id/remove',
  (ctx) => {
    const rec = userRecording(ctx);
    if (!rec) return redirect(ctx, '/recordings');
    if (rec.status === 'analyzing') {
      flash(ctx, 'bad', 'This recording is being analyzed. Wait for it to finish.');
      return redirect(ctx, '/recordings');
    }
    // Fajl ostaje na disku; zapis se samo sakriva da ga sljedeće skeniranje ne vrati.
    db.transaction(() => {
      db.prepare('DELETE FROM moments WHERE recording_id=?').run(rec.id);
      db.prepare('UPDATE recordings SET hidden=1 WHERE id=?').run(rec.id);
    });
    flash(ctx, 'ok', `“${rec.name}” was removed from the list. The file is still on disk.`);
    redirect(ctx, '/recordings');
  }
);

route(
  'POST',
  '/recordings/:id/clips',
  async (ctx) => {
    const rec = userRecording(ctx);
    if (!rec) return redirect(ctx, '/recordings');
    const form = await readForm(ctx.req);
    const back = `/recordings/${rec.id}`;
    const fail = (msg) => (flash(ctx, 'bad', msg), redirect(ctx, back));

    const start = parseTime(form.get('start'));
    const end = parseTime(form.get('end'));
    const layout = form.get('layout');
    if (!media.isAvailable()) return fail('ffmpeg is not installed, so Shorts cannot be created yet.');
    if (rec.status !== 'ready') return fail('Wait for the analysis of this recording to finish.');
    if (Number.isNaN(start) || Number.isNaN(end)) return fail('Enter the start and end as m:ss, for example 12:34.');
    if (end - start < studio.MIN_CLIP) return fail(`A Short must be at least ${studio.MIN_CLIP} seconds long.`);
    if (end - start > studio.MAX_CLIP) return fail(`A Short can be at most ${studio.MAX_CLIP} seconds long.`);
    if (end > rec.duration + 0.5) return fail('The end is past the end of the recording.');
    if (!media.LAYOUTS.some(([id]) => id === layout)) return fail('Choose a layout.');

    const title = (form.get('title') || '').trim().slice(0, 100) || `${path.parse(rec.name).name} ${views.fmtTime(start)}`.slice(0, 100);
    // „Napravi sve“: titlovi u zadnjem korištenom stilu, pa intro i outro, bez daljih klikova.
    const bumperId = (field) => {
      const b = form.get(field) ? db.prepare('SELECT id FROM bumpers WHERE id=? AND user_id=?').get(Number(form.get(field)), ctx.user.id) : null;
      return b ? b.id : null;
    };
    const captions = form.get('auto_captions') === '1' && !media.transcribeProblem();
    const intro = bumperId('auto_intro');
    const outro = bumperId('auto_outro');
    const followup =
      captions || intro || outro ? { captions, style: getSetting(ctx.user.id, 'caption_style', media.DEFAULT_CAPTION_STYLE), intro, outro, title } : null;
    studio.createClip(rec, { title, start, end: Math.min(end, rec.duration), layout, followup, watermark: watermarkFor(ctx, form) });
    const steps = [captions && 'captions', intro && 'the intro', outro && 'the outro'].filter(Boolean);
    const list = steps.length > 1 ? `${steps.slice(0, -1).join(', ')} and ${steps[steps.length - 1]}` : steps[0];
    flash(
      ctx,
      'ok',
      followup
        ? `Short “${title}” is being created, and ${list} will be added without further clicks. The finished result appears under ${intro || outro ? 'Videos' : 'Shorts'}.`
        : `Short “${title}” is being created.`
    );
    redirect(ctx, back);
  }
);

route(
  'GET',
  '/shorts',
  (ctx) => {
    const clips = db.prepare('SELECT * FROM clips WHERE user_id=? AND campaign_id IS NULL ORDER BY id DESC LIMIT 200').all(ctx.user.id);
    html(ctx, views.shortsPage(ctx, { clips: markPublished('clip', withThumbs(clips)), ffmpegOk: media.isAvailable() }));
  }
);

route(
  'GET',
  '/clips/:id/file',
  (ctx) => {
    const clip = userClip(ctx);
    if (!clip || clip.status !== 'ready') return html(ctx, views.errorPage(ctx, 404, 'This Short does not exist.'), 404);
    sendFile(ctx, clip.path, ctx.query.get('download') ? `${clip.title.replace(/[\\/:*?"<>|]/g, ' ')}.mp4` : null);
  }
);

// Briše sve označene Shortse; oni koji se još prave ili čekaju se prekidaju.
route('POST', '/shorts/delete', async (ctx) => {
  const form = await readForm(ctx.req);
  const ids = [...new Set(form.getAll('ids').map(Number))].filter(Number.isInteger).slice(0, 500);
  const find = db.prepare('SELECT * FROM clips WHERE id=? AND user_id=?');
  let removed = 0;
  for (const id of ids) {
    const clip = find.get(id, ctx.user.id);
    if (!clip) continue;
    if (clip.status === 'pending' || clip.status === 'rendering') studio.cancelClip(clip);
    else studio.deleteClip(clip);
    removed++;
  }
  flash(ctx, removed ? 'ok' : 'bad', removed ? `${removed} ${removed === 1 ? 'Short has' : 'Shorts have'} been deleted.` : 'Select at least one Short to delete.');
  const rec = Number(ctx.query.get('recording'));
  redirect(ctx, rec ? `/recordings/${rec}` : '/shorts');
});

// Prekida jedan Short koji čeka ili se upravo pravi.
route('POST', '/clips/:id/cancel', (ctx) => {
  const clip = userClip(ctx);
  const back = clip && ctx.query.get('from') === 'recording' && clip.recording_id ? `/recordings/${clip.recording_id}` : '/shorts';
  if (clip && clip.status !== 'ready') {
    studio.cancelClip(clip);
    flash(ctx, 'ok', `“${clip.title}” was cancelled.`);
  }
  redirect(ctx, back);
});

// Prekida sve Shortse koji još nisu gotovi, zajedno sa titlovima, introm i outrom koji su trebali uslijediti.
route('POST', '/shorts/cancel', (ctx) => {
  const removed = studio.cancelShorts(ctx.user.id);
  flash(ctx, 'ok', removed ? `Stopped. ${removed} unfinished ${removed === 1 ? 'Short was' : 'Shorts were'} removed; the finished ones are kept.` : 'Stopped. Nothing was waiting.');
  const rec = Number(ctx.query.get('recording'));
  redirect(ctx, rec ? `/recordings/${rec}` : '/shorts');
});

route(
  'POST',
  '/clips/:id/delete',
  (ctx) => {
    const clip = userClip(ctx);
    const back = ctx.query.get('from') === 'recording' && clip && clip.recording_id ? `/recordings/${clip.recording_id}` : '/shorts';
    if (!clip) return redirect(ctx, back);
    if (clip.status === 'rendering') {
      flash(ctx, 'bad', 'This Short is still being created. Wait for it to finish.');
      return redirect(ctx, back);
    }
    fs.rm(clip.path, { force: true }, () => {});
    fs.rm(studio.thumbPath('clip', clip.id), { force: true }, () => {});
    db.prepare('DELETE FROM clips WHERE id=?').run(clip.id);
    deleteKit(ctx.user.id, 'clip', clip.id);
    flash(ctx, 'ok', 'The Short has been deleted.');
    redirect(ctx, back);
  }
);

// Stanje poslova za osvježavanje stranica bez ponovnog učitavanja.
route(
  'GET',
  '/api/studio/status',
  (ctx) => {
    const recId = Number(ctx.query.get('recording')) || null;
    const recs = recId
      ? db.prepare('SELECT id, status, progress FROM recordings WHERE id=? AND user_id=? AND hidden=0').all(recId, ctx.user.id)
      : db.prepare('SELECT id, status, progress FROM recordings WHERE user_id=? AND hidden=0').all(ctx.user.id);
    // Lista klipova odgovara stranici koja pita: jedan snimak, jedna kampanja, sve (bočni meni) ili Shorts bez kampanja.
    const campaignId = Number(ctx.query.get('campaign')) || null;
    const pick = 'SELECT id, status, progress FROM clips WHERE user_id=?';
    const clips = recId
      ? db.prepare(`${pick} AND recording_id=? AND campaign_id IS NULL`).all(ctx.user.id, recId)
      : campaignId
        ? db.prepare(`${pick} AND campaign_id=?`).all(ctx.user.id, campaignId)
        : ctx.query.get('all')
          ? db.prepare(pick).all(ctx.user.id)
          : db.prepare(`${pick} AND campaign_id IS NULL ORDER BY id DESC LIMIT 200`).all(ctx.user.id);
    const transcripts = db
      .prepare('SELECT t.recording_id, t.status, t.progress FROM transcripts t JOIN recordings r ON r.id = t.recording_id WHERE r.user_id=?')
      .all(ctx.user.id);
    const videos = db.prepare('SELECT id, status, progress FROM exports WHERE user_id=? ORDER BY id DESC LIMIT 200').all(ctx.user.id);
    const captions = db
      .prepare('SELECT c.clip_id, c.status, c.progress FROM captions c JOIN clips ON clips.id = c.clip_id WHERE clips.user_id=?')
      .all(ctx.user.id);
    const scans = db.prepare('SELECT a.recording_id, a.status, a.progress FROM activity a JOIN recordings r ON r.id = a.recording_id WHERE r.user_id=?').all(ctx.user.id);
    const sceneScans = db.prepare('SELECT s.recording_id, s.status, s.progress FROM scenes s JOIN recordings r ON r.id = s.recording_id WHERE r.user_id=?').all(ctx.user.id);
    json(ctx, {
      items: [
        ...recs.map((r) => ({ key: `rec:${r.id}`, status: r.status, progress: r.progress })),
        ...clips.map((c) => ({ key: `clip:${c.id}`, status: c.status, progress: c.progress })),
        ...videos.map((v) => ({ key: `video:${v.id}`, status: v.status, progress: v.progress })),
        ...captions.map((c) => ({ key: `captions:${c.clip_id}`, status: c.status, progress: c.progress })),
        ...transcripts.map((t) => ({ key: `transcript:${t.recording_id}`, status: t.status, progress: t.progress })),
        ...scans.map((a) => ({ key: `activity:${a.recording_id}`, status: a.status, progress: a.progress })),
        ...sceneScans.map((s) => ({ key: `scenes:${s.recording_id}`, status: s.status, progress: s.progress })),
      ],
    });
  }
);

// ── Rute: dijeljenje cijelog snimka na Shorts ─────────────
const MAX_SPLIT_PARTS = 300;

route('GET', '/recordings/:id/split', (ctx) => {
  const rec = userRecording(ctx);
  if (!rec) return html(ctx, views.errorPage(ctx, 404, 'This recording does not exist.'), 404);
  if (rec.status !== 'ready') {
    flash(ctx, 'bad', 'Wait for the analysis of this recording to finish.');
    return redirect(ctx, `/recordings/${rec.id}`);
  }
  const bumpers = db.prepare('SELECT id, name, duration FROM bumpers WHERE user_id=? ORDER BY name COLLATE NOCASE').all(ctx.user.id);
  html(ctx, views.splitPage(ctx, { rec, bumpers, captionsProblem: media.transcribeProblem(), ffmpegOk: media.isAvailable() }));
});

route('POST', '/recordings/:id/split', async (ctx) => {
  const rec = userRecording(ctx);
  if (!rec) return redirect(ctx, '/recordings');
  const form = await readForm(ctx.req);
  const fail = (msg) => (flash(ctx, 'bad', msg), redirect(ctx, `/recordings/${rec.id}/split`));

  const length = Number(form.get('length'));
  const layout = form.get('layout');
  if (!media.isAvailable()) return fail('ffmpeg is not installed, so Shorts cannot be created yet.');
  if (rec.status !== 'ready') return fail('Wait for the analysis of this recording to finish.');
  if (!(length >= studio.MIN_PART) || length > studio.MAX_CLIP) return fail(`A part must be between ${studio.MIN_PART} and ${studio.MAX_CLIP} seconds long.`);
  if (!media.LAYOUTS.some(([id]) => id === layout)) return fail('Choose a layout.');
  const count = studio.splitRanges(rec.duration, length).length;
  if (!count) return fail('This recording is too short to split.');
  if (count > MAX_SPLIT_PARTS) return fail(`That would make ${count} Shorts. Choose longer parts, so there are at most ${MAX_SPLIT_PARTS}.`);

  const prefix = (form.get('prefix') || '').replace(/\s+/g, ' ').trim().slice(0, 80) || path.parse(rec.name).name.slice(0, 80);
  // Riječ ispred broja, npr. PART; prazna kvačica znači bez natpisa.
  const word = (form.get('label_word') || '').replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'PART';
  const label = form.get('label') === '1' ? { word, position: form.get('label_position') === 'bottom' ? 'bottom' : 'top' } : null;

  const bumperId = (field) => {
    const b = form.get(field) ? db.prepare('SELECT id FROM bumpers WHERE id=? AND user_id=?').get(Number(form.get(field)), ctx.user.id) : null;
    return b ? b.id : null;
  };
  const captions = form.get('auto_captions') === '1' && !media.transcribeProblem();
  const intro = bumperId('auto_intro');
  const outro = bumperId('auto_outro');
  const followup = captions || intro || outro ? { captions, style: getSetting(ctx.user.id, 'caption_style', media.DEFAULT_CAPTION_STYLE), intro, outro } : null;

  studio.splitRecording(rec, { length, layout, prefix, label, followup, watermark: watermarkFor(ctx, form) });
  flash(ctx, 'ok', `${count} ${count === 1 ? 'Short is' : 'Shorts are'} being created from “${rec.name}”. This page updates as they finish.`);
  redirect(ctx, '/shorts');
});

// ── Rute: titlovi za Shorts ───────────────────────────────
const MAX_CAPTION_LINES = 600;

route('GET', '/clips/:id/captions', (ctx) => {
  const clip = userClip(ctx);
  if (!clip || clip.status !== 'ready') return html(ctx, views.errorPage(ctx, 404, 'This Short does not exist or is not ready yet.'), 404);
  const captions = db.prepare('SELECT * FROM captions WHERE clip_id=?').get(clip.id) || null;
  html(ctx, views.captionsPage(ctx, { clip, captions, problem: media.transcribeProblem() }));
});

route('POST', '/clips/:id/captions/generate', (ctx) => {
  const clip = userClip(ctx);
  if (!clip || clip.status !== 'ready') return redirect(ctx, '/shorts');
  const problem = media.transcribeProblem();
  if (problem) flash(ctx, 'bad', problem);
  else studio.requestCaptions(clip.id);
  redirect(ctx, `/clips/${clip.id}/captions`);
});

// Sprema ispravljene titlove i stil; uz action=render pravi i novi Short sa titlovima u slici.
route('POST', '/clips/:id/captions', async (ctx) => {
  const clip = userClip(ctx);
  if (!clip || clip.status !== 'ready') return redirect(ctx, '/shorts');
  const back = `/clips/${clip.id}/captions`;
  const fail = (msg) => (flash(ctx, 'bad', msg), redirect(ctx, back));
  const captions = db.prepare('SELECT * FROM captions WHERE clip_id=?').get(clip.id);
  if (!captions || captions.status !== 'ready') return fail('Generate the captions first.');

  const form = await readForm(ctx.req);
  const starts = form.getAll('start');
  const ends = form.getAll('end');
  const texts = form.getAll('text');
  const keys = form.getAll('key');
  const previous = JSON.parse(captions.lines); // za izmjerena vremena riječi
  if (starts.length !== texts.length || ends.length !== texts.length || texts.length > MAX_CAPTION_LINES) return fail('The captions could not be read. Reload the page and try again.');
  const length = clip.end_s - clip.start_s;
  const lines = [];
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i].replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!text) continue; // prazan red znači da je titl obrisan
    const start = Number(starts[i]);
    const end = Number(ends[i]);
    if (!(start >= 0) || !(end > start) || end > length + 0.5) return fail(`Check the times of “${text}”: the end must be after the start and inside the video.`);
    lines.push({ start, end, text, words: (previous[Number(keys[i])] || {}).words });
  }
  const style = {
    font: media.CAPTION_FONTS.some(([f]) => f === form.get('font')) ? form.get('font') : media.DEFAULT_CAPTION_STYLE.font,
    size: media.CAPTION_SIZES[form.get('size')] ? form.get('size') : media.DEFAULT_CAPTION_STYLE.size,
    color: /^#[0-9a-f]{6}$/i.test(form.get('color') || '') ? form.get('color') : media.DEFAULT_CAPTION_STYLE.color,
    position: media.CAPTION_POSITIONS.includes(form.get('position')) ? form.get('position') : media.DEFAULT_CAPTION_STYLE.position,
    upper: form.get('upper') === '1',
    // Prazno znači bez isticanja izgovorene riječi.
    highlight: form.get('highlight_on') === '1' && /^#[0-9a-f]{6}$/i.test(form.get('highlight') || '') ? form.get('highlight') : '',
  };
  const tidy = media.tidyLines(lines);
  db.prepare('UPDATE captions SET lines=?, style=? WHERE id=?').run(JSON.stringify(tidy), JSON.stringify(style), captions.id);
  setSetting(ctx.user.id, 'caption_style', style); // isti stil se koristi kad se titlovi dodaju automatski

  if (form.get('action') !== 'render') {
    flash(ctx, 'ok', 'The captions have been saved.');
    return redirect(ctx, back);
  }
  if (!tidy.length) return fail('There are no captions to add. Keep at least one line.');
  studio.createCaptionedClip(clip, tidy, style);
  flash(ctx, 'ok', `A copy of “${clip.title}” with captions is being created.`);
  redirect(ctx, '/shorts');
});

// ── Rute: thumbnailovi ────────────────────────────────────
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
const userThumbnail = (ctx) => db.prepare('SELECT * FROM thumbnails WHERE id=? AND user_id=?').get(Number(ctx.params.id), ctx.user.id);

route('GET', '/thumbnails', (ctx) => {
  const thumbnails = db.prepare('SELECT * FROM thumbnails WHERE user_id=? ORDER BY id DESC LIMIT 200').all(ctx.user.id);
  html(ctx, views.thumbnailsPage(ctx, { thumbnails }));
});

route('GET', '/recordings/:id/thumbnail', (ctx) => {
  const rec = userRecording(ctx);
  if (!rec) return html(ctx, views.errorPage(ctx, 404, 'This recording does not exist.'), 404);
  if (rec.status !== 'ready') {
    flash(ctx, 'bad', 'Wait for the analysis of this recording to finish.');
    return redirect(ctx, `/recordings/${rec.id}`);
  }
  const moments = db.prepare('SELECT * FROM moments WHERE recording_id=? ORDER BY start_s').all(rec.id);
  // Bez zadanog vremena kreće od sredine prvog predloženog trenutka.
  const asked = Number(ctx.query.get('t'));
  const fallback = moments.length ? (moments[0].start_s + moments[0].end_s) / 2 : rec.duration * 0.1;
  const time = ctx.query.get('t') && asked >= 0 && asked <= rec.duration ? asked : fallback;
  html(ctx, views.thumbnailEditorPage(ctx, { rec, moments, time: Math.round(time * 20) / 20 }));
});

// Preglednik šalje gotovu sliku (JPG) koju je iscrtao editor.
route('PUT', '/api/recordings/:id/thumbnails', async (ctx) => {
  const rec = userRecording(ctx);
  if (!rec) return json(ctx, { error: 'This recording does not exist.' }, 404);
  const chunks = [];
  let size = 0;
  // Prevelika slika se pročita do kraja bez čuvanja, da preglednik dobije odgovor umjesto prekinute veze.
  for await (const chunk of ctx.req) {
    size += chunk.length;
    if (size <= MAX_THUMBNAIL_BYTES) chunks.push(chunk);
  }
  if (size > MAX_THUMBNAIL_BYTES) return json(ctx, { error: 'The picture is larger than 5 MB.' }, 413);
  const image = Buffer.concat(chunks);
  if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8) return json(ctx, { error: 'The picture is not a JPG.' }, 400);

  let title = '';
  try {
    title = decodeURIComponent(ctx.req.headers['x-title'] || '');
  } catch {}
  title = title.replace(/\s+/g, ' ').trim().slice(0, 100) || path.parse(rec.name).name.slice(0, 100);
  const file = path.join(cfg.thumbnailsDir, `${crypto.randomBytes(16).toString('hex')}.jpg`);
  fs.writeFileSync(file, image);
  db.prepare('INSERT INTO thumbnails (user_id, recording_id, recording_name, title, path, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    ctx.user.id,
    rec.id,
    rec.name,
    title,
    file,
    image.length,
    db.now()
  );
  flash(ctx, 'ok', `Thumbnail “${title}” has been saved.`);
  json(ctx, { redirect: '/thumbnails' });
});

route('GET', '/thumbnails/:id/file', (ctx) => {
  const thumb = userThumbnail(ctx);
  if (!thumb) return html(ctx, views.errorPage(ctx, 404, 'This thumbnail does not exist.'), 404);
  sendFile(ctx, thumb.path, ctx.query.get('download') ? `${thumb.title.replace(/[\/:*?"<>|]/g, ' ')}.jpg` : null);
});

route('POST', '/thumbnails/:id/delete', (ctx) => {
  const thumb = userThumbnail(ctx);
  if (thumb) {
    fs.rm(thumb.path, { force: true }, () => {});
    db.prepare('DELETE FROM thumbnails WHERE id=?').run(thumb.id);
    flash(ctx, 'ok', 'The thumbnail has been deleted.');
  }
  redirect(ctx, '/thumbnails');
});

// ── Rute: intro/outro klipovi ─────────────────────────────
const BUMPER_EXT = /\.(mp4|mov|m4v|mkv|webm)$/i;
const MAX_BUMPER_BYTES = 1024 ** 3;
const userBumper = (ctx) => db.prepare('SELECT * FROM bumpers WHERE id=? AND user_id=?').get(Number(ctx.params.id), ctx.user.id);

route('GET', '/bumpers', (ctx) => {
  const bumpers = db.prepare('SELECT * FROM bumpers WHERE user_id=? ORDER BY name COLLATE NOCASE').all(ctx.user.id);
  for (const b of bumpers) b.hasThumb = fs.existsSync(studio.thumbPath('bumper', b.id));
  html(ctx, views.bumpersPage(ctx, { bumpers, ffmpegOk: media.isAvailable() }));
});

// Preglednik šalje sirovi video fajl; ffprobe potvrđuje da je zaista video.
route('PUT', '/api/bumpers', async (ctx) => {
  const header = (name) => {
    try {
      return decodeURIComponent(ctx.req.headers[name] || '');
    } catch {
      return '';
    }
  };
  const fileName = path.basename(header('x-file-name') || 'clip');
  const ext = path.extname(fileName).toLowerCase();
  const file = path.join(cfg.bumpersDir, `${crypto.randomBytes(16).toString('hex')}${ext}`);
  const accepted = BUMPER_EXT.test(fileName) && media.isAvailable();

  // Tijelo zahtjeva se uvijek pročita do kraja, da preglednik dobije odgovor umjesto prekinute veze.
  const out = accepted ? fs.createWriteStream(file) : null;
  let size = 0;
  for await (const chunk of ctx.req) {
    size += chunk.length;
    if (out && size <= MAX_BUMPER_BYTES && !out.write(chunk)) await once(out, 'drain');
  }
  if (out) await new Promise((done) => out.end(done));
  const reject = (message, status = 400) => {
    fs.rmSync(file, { force: true });
    return json(ctx, { error: message }, status);
  };

  if (!BUMPER_EXT.test(fileName)) return reject('Choose a video file: MP4, MOV, MKV or WebM.');
  if (!media.isAvailable()) return reject('ffmpeg is not installed, so the clip cannot be checked.');
  if (!size) return reject('The file is empty.');
  if (size > MAX_BUMPER_BYTES) return reject('The file is larger than 1 GB.', 413);

  const name = (header('x-name').replace(/\s+/g, ' ').trim() || path.parse(fileName).name).slice(0, 60);
  try {
    await studio.addBumper(ctx.user.id, file, name, size);
  } catch (err) {
    return reject(`This file could not be read as a video (${err.message}).`);
  }
  flash(ctx, 'ok', `“${name}” has been added.`);
  json(ctx, { redirect: '/bumpers' });
});

route('GET', '/bumpers/:id/thumb', (ctx) => {
  const bumper = userBumper(ctx);
  if (!bumper) return html(ctx, views.errorPage(ctx, 404, 'This clip does not exist.'), 404);
  sendFile(ctx, studio.thumbPath('bumper', bumper.id));
});

route('GET', '/bumpers/:id/file', (ctx) => {
  const bumper = userBumper(ctx);
  if (!bumper) return html(ctx, views.errorPage(ctx, 404, 'This clip does not exist.'), 404);
  sendFile(ctx, bumper.path);
});

route('POST', '/bumpers/:id/delete', (ctx) => {
  const bumper = userBumper(ctx);
  if (bumper) {
    fs.rm(bumper.path, { force: true }, () => {});
    fs.rm(studio.thumbPath('bumper', bumper.id), { force: true }, () => {});
    db.prepare('DELETE FROM bumpers WHERE id=?').run(bumper.id);
    flash(ctx, 'ok', `“${bumper.name}” has been deleted.`);
  }
  redirect(ctx, '/bumpers');
});

// ── Rute: gotovi videi (intro + video + outro) ────────────
const userExport = (ctx) => db.prepare('SELECT * FROM exports WHERE id=? AND user_id=?').get(Number(ctx.params.id), ctx.user.id);

// Glavni video može biti cijeli snimak ili izrezani Short.
function exportSource(userId, kind, id) {
  if (kind === 'recording') {
    const r = db.prepare("SELECT * FROM recordings WHERE id=? AND user_id=? AND hidden=0 AND status='ready'").get(id, userId);
    return r && { kind, id: r.id, name: path.parse(r.name).name, duration: r.duration, width: r.width, height: r.height, back: `/recordings/${r.id}` };
  }
  if (kind === 'clip') {
    const c = db.prepare("SELECT * FROM clips WHERE id=? AND user_id=? AND status='ready'").get(id, userId);
    return c && { kind, id: c.id, name: c.title, duration: c.end_s - c.start_s, width: 1080, height: 1920, back: '/shorts' };
  }
  return null;
}

route('GET', '/videos', (ctx) => {
  const videos = db.prepare('SELECT * FROM exports WHERE user_id=? ORDER BY id DESC LIMIT 200').all(ctx.user.id);
  for (const v of videos) v.hasThumb = fs.existsSync(studio.thumbPath('video', v.id));
  html(ctx, views.videosPage(ctx, { videos: markPublished('video', videos), ffmpegOk: media.isAvailable() }));
});

route('GET', '/videos/new', (ctx) => {
  const kind = ctx.query.get('clip') ? 'clip' : 'recording';
  const source = exportSource(ctx.user.id, kind, Number(ctx.query.get(kind)));
  if (!source) return html(ctx, views.errorPage(ctx, 404, 'This video does not exist or is not ready yet.'), 404);
  const bumpers = db.prepare('SELECT * FROM bumpers WHERE user_id=? ORDER BY name COLLATE NOCASE').all(ctx.user.id);
  html(ctx, views.videoNewPage(ctx, { source, bumpers }));
});

route('POST', '/videos', async (ctx) => {
  const form = await readForm(ctx.req);
  const [kind, id] = (form.get('source') || '').split(':');
  const source = exportSource(ctx.user.id, kind, Number(id));
  if (!source) return html(ctx, views.errorPage(ctx, 404, 'This video does not exist or is not ready yet.'), 404);
  const back = `/videos/new?${kind}=${source.id}`;
  const fail = (msg) => (flash(ctx, 'bad', msg), redirect(ctx, back));

  const pick = (field) => {
    const value = form.get(field);
    return value ? db.prepare('SELECT * FROM bumpers WHERE id=? AND user_id=?').get(Number(value), ctx.user.id) || false : null;
  };
  const intro = pick('intro');
  const outro = pick('outro');
  if (!media.isAvailable()) return fail('ffmpeg is not installed, so videos cannot be created yet.');
  if (intro === false || outro === false) return fail('The chosen clip no longer exists. Choose another one.');
  if (!intro && !outro) return fail('Choose an intro, an outro, or both.');

  const title = (form.get('title') || '').trim().slice(0, 100) || source.name.slice(0, 100);
  const bumperPart = (b) => ({ kind: 'bumper', id: b.id, name: b.name });
  const parts = [intro && bumperPart(intro), { kind: source.kind, id: source.id, name: source.name, main: true }, outro && bumperPart(outro)];
  studio.createExport(ctx.user.id, { title, parts: parts.filter(Boolean) });
  flash(ctx, 'ok', `Video “${title}” is being created.`);
  redirect(ctx, '/videos');
});

// Spajanje više videa: dijelovi mogu biti snimci, Shorts i intro/outro klipovi, bilo kojim redom.
const MAX_MERGE_PARTS = 30;

function mergePart(userId, kind, id) {
  if (kind !== 'bumper') return exportSource(userId, kind, id);
  const b = db.prepare('SELECT * FROM bumpers WHERE id=? AND user_id=?').get(id, userId);
  return b && { kind, id: b.id, name: b.name, duration: b.duration, width: b.width, height: b.height };
}

route('GET', '/videos/merge', (ctx) => {
  const uid = ctx.user.id;
  const recordings = db.prepare("SELECT id FROM recordings WHERE user_id=? AND hidden=0 AND status='ready' ORDER BY id DESC").all(uid);
  const clips = db.prepare("SELECT id FROM clips WHERE user_id=? AND status='ready' ORDER BY id DESC").all(uid);
  const bumpers = db.prepare('SELECT id FROM bumpers WHERE user_id=? ORDER BY name COLLATE NOCASE').all(uid);
  const load = (kind, rows) => rows.map((r) => mergePart(uid, kind, r.id));
  html(
    ctx,
    views.videoMergePage(ctx, {
      groups: [
        ['Recordings', load('recording', recordings)],
        ['Shorts', load('clip', clips)],
        ['Intros and outros', load('bumper', bumpers)],
      ],
      ffmpegOk: media.isAvailable(),
    })
  );
});

route('POST', '/videos/merge', async (ctx) => {
  const form = await readForm(ctx.req);
  const fail = (msg) => (flash(ctx, 'bad', msg), redirect(ctx, '/videos/merge'));
  const chosen = form.getAll('parts');
  if (!media.isAvailable()) return fail('ffmpeg is not installed, so videos cannot be created yet.');
  if (chosen.length < 2) return fail('Add at least two parts to merge.');
  if (chosen.length > MAX_MERGE_PARTS) return fail(`A video can have at most ${MAX_MERGE_PARTS} parts.`);

  const parts = [];
  for (const value of chosen) {
    const [kind, id] = value.split(':');
    const part = mergePart(ctx.user.id, kind, Number(id));
    if (!part) return fail('One of the parts no longer exists or is not ready. Choose the parts again.');
    parts.push({ kind: part.kind, id: part.id, name: part.name });
  }
  // Dio koji određuje veličinu kadra; ako nije zadan, prvi.
  const main = Number(form.get('main'));
  parts[Number.isInteger(main) && main >= 0 && main < parts.length ? main : 0].main = true;

  const title = (form.get('title') || '').trim().slice(0, 100) || `${parts[0].name} + ${parts.length - 1} more`.slice(0, 100);
  studio.createExport(ctx.user.id, { title, parts });
  flash(ctx, 'ok', `Video “${title}” is being created.`);
  redirect(ctx, '/videos');
});

route('GET', '/videos/:id/file', (ctx) => {
  const video = userExport(ctx);
  if (!video || video.status !== 'ready') return html(ctx, views.errorPage(ctx, 404, 'This video does not exist.'), 404);
  sendFile(ctx, video.path, ctx.query.get('download') ? `${video.title.replace(/[\\/:*?"<>|]/g, ' ')}.mp4` : null);
});

route('GET', '/videos/:id/thumb', (ctx) => {
  const video = userExport(ctx);
  if (!video) return html(ctx, views.errorPage(ctx, 404, 'This video does not exist.'), 404);
  sendFile(ctx, studio.thumbPath('video', video.id));
});

route('POST', '/videos/:id/cancel', (ctx) => {
  const video = userExport(ctx);
  if (video && studio.cancelExport(video.id)) flash(ctx, 'ok', `Creating “${video.title}” was cancelled.`);
  redirect(ctx, '/videos');
});

route('POST', '/videos/:id/delete', (ctx) => {
  const video = userExport(ctx);
  if (!video) return redirect(ctx, '/videos');
  if (video.status === 'rendering') {
    flash(ctx, 'bad', 'This video is still being created. Cancel it first.');
    return redirect(ctx, '/videos');
  }
  fs.rm(video.path, { force: true }, () => {});
  fs.rm(studio.thumbPath('video', video.id), { force: true }, () => {});
  db.prepare('DELETE FROM exports WHERE id=?').run(video.id);
  deleteKit(ctx.user.id, 'video', video.id);
  flash(ctx, 'ok', 'The video has been deleted.');
  redirect(ctx, '/videos');
});

// ── Rute: paket za objavu ─────────────────────────────────
// Naslov, opis, hashtagovi, tagovi i thumbnail za jedan video, spremni za kopiranje u YouTube Studio.
function kitItem(userId, kind, id) {
  if (kind === 'clip') {
    const c = db.prepare("SELECT * FROM clips WHERE id=? AND user_id=? AND status='ready'").get(id, userId);
    return c && { kind, id: c.id, name: c.title.replace(/ \(captions\)$/, ''), file: `/clips/${c.id}/file`, poster: `/clips/${c.id}/thumb`, vertical: true, recordingId: c.recording_id, back: '/shorts' };
  }
  if (kind === 'video') {
    const v = db.prepare("SELECT * FROM exports WHERE id=? AND user_id=? AND status='ready'").get(id, userId);
    return v && { kind, id: v.id, name: v.title, file: `/videos/${v.id}/file`, poster: `/videos/${v.id}/thumb`, vertical: v.height > v.width, recordingId: null, back: '/videos' };
  }
  if (kind === 'recording') {
    const r = db.prepare("SELECT * FROM recordings WHERE id=? AND user_id=? AND hidden=0 AND status='ready'").get(id, userId);
    return r && { kind, id: r.id, name: path.parse(r.name).name, file: `/recordings/${r.id}/file`, poster: `/recordings/${r.id}/thumb`, vertical: r.height > r.width, recordingId: r.id, back: `/recordings/${r.id}` };
  }
  return null;
}

// Označava redove za koje je u paketu za objavu zabilježeno da su objavljeni.
function markPublished(kind, rows) {
  const stmt = db.prepare('SELECT published_at FROM kits WHERE user_id=? AND kind=? AND item_id=?');
  for (const row of rows) row.published = Boolean((stmt.get(row.user_id, kind, row.id) || {}).published_at);
  return rows;
}

const deleteKit = (userId, kind, id) => db.prepare('DELETE FROM kits WHERE user_id=? AND kind=? AND item_id=?').run(userId, kind, id);

route('GET', '/publish/:kind/:id', (ctx) => {
  const item = kitItem(ctx.user.id, ctx.params.kind, Number(ctx.params.id));
  if (!item) return html(ctx, views.errorPage(ctx, 404, 'This video does not exist or is not ready yet.'), 404);
  const saved = db.prepare('SELECT * FROM kits WHERE user_id=? AND kind=? AND item_id=?').get(ctx.user.id, item.kind, item.id);
  const defaults = getSetting(ctx.user.id, 'kit_defaults', {});
  const kit = saved || {
    title: item.name.slice(0, 100),
    description: defaults.description || '',
    hashtags: defaults.hashtags ?? (item.vertical ? '#Shorts' : ''),
    tags: defaults.tags || '',
    thumbnail_id: null,
    published_at: null,
  };
  // Thumbnailovi istog snimka idu prvi.
  const thumbnails = item.vertical
    ? []
    : db.prepare('SELECT id, title FROM thumbnails WHERE user_id=? ORDER BY (recording_id IS ?) DESC, id DESC LIMIT 60').all(ctx.user.id, item.recordingId);
  html(ctx, views.kitPage(ctx, { item, kit, thumbnails, isNew: !saved }));
});

route('POST', '/publish/:kind/:id', async (ctx) => {
  const item = kitItem(ctx.user.id, ctx.params.kind, Number(ctx.params.id));
  if (!item) return html(ctx, views.errorPage(ctx, 404, 'This video does not exist or is not ready yet.'), 404);
  const form = await readForm(ctx.req);
  const text = (name, max) => (form.get(name) || '').replace(/\r\n/g, '\n').trim().slice(0, max);
  const kit = { title: text('title', 100), description: text('description', 5000), hashtags: text('hashtags', 500), tags: text('tags', 500) };
  const thumb = form.get('thumbnail') ? db.prepare('SELECT id FROM thumbnails WHERE id=? AND user_id=?').get(Number(form.get('thumbnail')), ctx.user.id) : null;
  const before = db.prepare('SELECT published_at FROM kits WHERE user_id=? AND kind=? AND item_id=?').get(ctx.user.id, item.kind, item.id);
  const publishedAt = form.get('published') === '1' ? (before && before.published_at) || db.now() : null;

  db.prepare(
    `INSERT INTO kits (user_id, kind, item_id, title, description, hashtags, tags, thumbnail_id, published_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, kind, item_id) DO UPDATE SET
       title=excluded.title, description=excluded.description, hashtags=excluded.hashtags, tags=excluded.tags,
       thumbnail_id=excluded.thumbnail_id, published_at=excluded.published_at, updated_at=excluded.updated_at`
  ).run(ctx.user.id, item.kind, item.id, kit.title, kit.description, kit.hashtags, kit.tags, thumb ? thumb.id : null, publishedAt, db.now());

  if (form.get('action') === 'defaults') {
    setSetting(ctx.user.id, 'kit_defaults', { description: kit.description, hashtags: kit.hashtags, tags: kit.tags });
    flash(ctx, 'ok', 'Saved. New kits will start with this description, these hashtags and these tags.');
  } else {
    flash(ctx, 'ok', 'The publish kit has been saved.');
  }
  redirect(ctx, `/publish/${item.kind}/${item.id}`);
});

// ── Sekcija Clipping (vlastiti fajlovi: clipping-routes.js, clipping-views.js, lib/clipping.js) ──
// ── Logo (watermark) ─────────────────────────────────────
const MAX_LOGO_BYTES = 10 * 1024 ** 2;
// Prepoznaje sliku po prvim bajtovima, ne po imenu fajla.
function imageType(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return '.webp';
  return null;
}

route('GET', '/logo', (ctx) => html(ctx, views.logoPage(ctx, { logo: getSetting(ctx.user.id, 'logo', null), ffmpegOk: media.isAvailable() })));

route('GET', '/logo/file', (ctx) => {
  const logo = currentLogo(ctx.user.id);
  if (!logo) return html(ctx, views.errorPage(ctx, 404, 'No logo has been added yet.'), 404);
  sendFile(ctx, logo.file);
});

route('PUT', '/api/logo', async (ctx) => {
  // Tijelo se pročita do kraja i kad je preveliko, da preglednik dobije odgovor umjesto prekinute veze.
  const chunks = [];
  let size = 0;
  for await (const chunk of ctx.req) {
    size += chunk.length;
    if (size <= MAX_LOGO_BYTES) chunks.push(chunk);
  }
  if (!size) return json(ctx, { error: 'The file is empty.' }, 400);
  if (size > MAX_LOGO_BYTES) return json(ctx, { error: 'The logo is larger than 10 MB.' }, 413);
  const buf = Buffer.concat(chunks);
  const ext = imageType(buf);
  if (!ext) return json(ctx, { error: 'Choose a PNG, JPG or WebP image. PNG with a transparent background looks best.' }, 400);

  const file = path.join(cfg.brandDir, `logo-${crypto.randomBytes(8).toString('hex')}${ext}`);
  fs.writeFileSync(file, buf);
  const old = getSetting(ctx.user.id, 'logo', null);
  setSetting(ctx.user.id, 'logo', { ...media.DEFAULT_LOGO, ...(old || {}), file });
  // Stari fajl se briše samo ako ga ne koristi nijedan Short koji još čeka na red.
  if (old && old.file && old.file !== file && !db.prepare("SELECT 1 FROM clips WHERE status IN ('pending', 'rendering') AND watermark LIKE ?").get(`%${path.basename(old.file)}%`)) {
    fs.rm(old.file, { force: true }, () => {});
  }
  flash(ctx, 'ok', 'Your logo has been added. Tick “Add my logo” when you create a Short to put it on the video.');
  json(ctx, { redirect: '/logo' });
});

route('POST', '/logo', async (ctx) => {
  const form = await readForm(ctx.req);
  const logo = getSetting(ctx.user.id, 'logo', null);
  if (!logo) return redirect(ctx, '/logo');
  const position = media.LOGO_POSITIONS.some(([id]) => id === form.get('position')) ? form.get('position') : logo.position;
  const size = form.get('size') in media.LOGO_SIZES ? form.get('size') : logo.size;
  const opacity = Math.round(Math.max(10, Math.min(100, Number(form.get('opacity')) || logo.opacity)));
  setSetting(ctx.user.id, 'logo', { ...logo, position, size, opacity });
  flash(ctx, 'ok', 'Saved. New Shorts with your logo use these settings; Shorts already created stay as they are.');
  redirect(ctx, '/logo');
});

route('POST', '/logo/delete', (ctx) => {
  const logo = getSetting(ctx.user.id, 'logo', null);
  db.prepare("DELETE FROM settings WHERE user_id=? AND key='logo'").run(ctx.user.id);
  if (logo && logo.file && !db.prepare("SELECT 1 FROM clips WHERE status IN ('pending', 'rendering') AND watermark LIKE ?").get(`%${path.basename(logo.file)}%`)) {
    fs.rm(logo.file, { force: true }, () => {});
  }
  flash(ctx, 'ok', 'The logo has been removed. Shorts already created keep it.');
  redirect(ctx, '/logo');
});

require('./scenes-routes')({ route, html, redirect, flash, readForm, userRecording, watermarkFor, getSetting });
require('./autoedit-routes')({ route, html, redirect, flash, readForm, sendFile, userRecording, watermarkFor });
require('./meme-routes')({ route, html, redirect, flash, readForm, json, sendFile, userClip });
require('./clipping-routes')({ route, html, redirect, flash, readForm, getSetting, watermarkFor });

// ── Javne stranice ────────────────────────────────────────
route('GET', '/privacy', (ctx) => html(ctx, views.privacyPage(ctx)));
route('GET', '/terms', (ctx) => html(ctx, views.termsPage(ctx)));
route('GET', '/healthz', (ctx) => json(ctx, { ok: true }));

// ── Pokretanje ────────────────────────────────────────────
const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('[server]', err);
    if (!res.headersSent) {
      res.writeHead(err.status || 500, { 'content-type': 'text/plain; charset=utf-8' });
    }
    res.end(err.status ? err.message : 'Server error.');
  });
});

server.listen(cfg.port, cfg.host, () => {
  console.log(`\n  ${cfg.appName} is running at ${cfg.baseUrl}`);
  if (!media.isAvailable()) console.log('  ⚠ ffmpeg was not found: recordings cannot be analyzed or cut into Shorts.');
  console.log('');
  studio.start();
});

function shutdown() {
  console.log('\nShutting down…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

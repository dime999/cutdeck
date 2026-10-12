'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const cfg = require('./lib/config');
const db = require('./lib/db');
const media = require('./lib/media');
const studio = require('./lib/studio');
const views = require('./views');

const LOCAL_USER = db.localUser();

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
    const clips = db.prepare('SELECT * FROM clips WHERE recording_id=? AND user_id=? ORDER BY id DESC').all(rec.id, ctx.user.id);
    rec.hasThumb = fs.existsSync(studio.thumbPath('rec', rec.id));
    html(ctx, views.recordingPage(ctx, { rec, moments, clips: withThumbs(clips), ffmpegOk: media.isAvailable() }));
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
    studio.createClip(rec, { title, start, end: Math.min(end, rec.duration), layout });
    flash(ctx, 'ok', `Short “${title}” is being created.`);
    redirect(ctx, back);
  }
);

route(
  'GET',
  '/shorts',
  (ctx) => {
    const clips = db.prepare('SELECT * FROM clips WHERE user_id=? ORDER BY id DESC LIMIT 200').all(ctx.user.id);
    html(ctx, views.shortsPage(ctx, { clips: withThumbs(clips), ffmpegOk: media.isAvailable() }));
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
    const clips = db.prepare('SELECT id, status, progress FROM clips WHERE user_id=?').all(ctx.user.id);
    json(ctx, {
      items: [
        ...recs.map((r) => ({ key: `rec:${r.id}`, status: r.status, progress: r.progress })),
        ...clips.map((c) => ({ key: `clip:${c.id}`, status: c.status, progress: c.progress })),
      ],
    });
  }
);

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

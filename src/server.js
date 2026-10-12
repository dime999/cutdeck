'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const cfg = require('./lib/config');
const db = require('./lib/db');
const yt = require('./lib/youtube');
const worker = require('./lib/worker');
const sec = require('./lib/security');
const views = require('./views');

// ── Mini router ───────────────────────────────────────────
const routes = [];
function route(method, pattern, handler, { auth = false } = {}) {
  const keys = [];
  const re = new RegExp(
    '^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$'
  );
  routes.push({ method, re, keys, handler, auth });
}

const SESSION_COOKIE = 'mp_session';
const SESSION_DAYS = 30;

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(session) {
  const value = sec.signSession({ ...session, exp: Date.now() + SESSION_DAYS * 864e5 });
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${cfg.secureCookies ? '; Secure' : ''}`;
}

function baseHeaders(ctx, extra = {}) {
  return {
    'set-cookie': sessionCookie(ctx.session),
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin',
    ...extra,
  };
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
  ctx.session.flash = { type, msg };
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

  const session = sec.readSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  const user = session.uid ? db.prepare('SELECT id, name, email FROM users WHERE id=?').get(session.uid) : null;
  if (!user) delete session.uid;
  const flashMsg = session.flash;
  delete session.flash;
  const ctx = { req, res, url, path: url.pathname, query: url.searchParams, session, user, flash: flashMsg, params: {} };

  if (['POST', 'PUT', 'DELETE'].includes(req.method) && !sameOrigin(req)) {
    return html(ctx, views.errorPage(ctx, 403, 'The request did not come from this site.'), 403);
  }

  const method = req.method === 'HEAD' ? 'GET' : req.method;
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    r.keys.forEach((k, i) => (ctx.params[k] = decodeURIComponent(m[i + 1])));
    if (r.auth && !user) {
      if (url.pathname.startsWith('/api/')) return json(ctx, { error: 'Your session has expired. Refresh the page.' }, 401);
      return redirect(ctx, '/login');
    }
    return r.handler(ctx);
  }
  html(ctx, views.errorPage(ctx, 404, 'This page does not exist.'), 404);
}

// ── Rute: prijava ─────────────────────────────────────────
route('GET', '/', (ctx) => redirect(ctx, ctx.user ? '/dashboard' : '/login'));

route('GET', '/login', (ctx) => (ctx.user ? redirect(ctx, '/dashboard') : html(ctx, views.loginPage(ctx))));

const loginAttempts = new Map();
route('POST', '/login', async (ctx) => {
  const form = await readForm(ctx.req);
  const email = (form.get('email') || '').trim();
  const ip = ctx.req.socket.remoteAddress;
  const a = loginAttempts.get(ip) || { n: 0, until: 0 };
  if (a.until > Date.now()) {
    return html(ctx, views.loginPage(ctx, { email, error: 'Too many attempts. Wait a minute and try again.' }), 429);
  }
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!u || !sec.verifyPassword(form.get('password') || '', u.password_hash)) {
    a.n += 1;
    if (a.n >= 5) Object.assign(a, { n: 0, until: Date.now() + 60000 });
    loginAttempts.set(ip, a);
    return html(ctx, views.loginPage(ctx, { email, error: 'Wrong email or password.' }), 401);
  }
  loginAttempts.delete(ip);
  ctx.session = { uid: u.id };
  redirect(ctx, '/dashboard');
});

function registrationNeedsInvite() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  return count > 0;
}

route('GET', '/register', (ctx) => {
  if (ctx.user) return redirect(ctx, '/dashboard');
  const needsInvite = registrationNeedsInvite();
  if (needsInvite && !cfg.inviteCode) {
    return html(ctx, views.errorPage(ctx, 403, 'Sign-up is closed. The administrator needs to set INVITE_CODE in the .env file.'), 403);
  }
  html(ctx, views.registerPage(ctx, { needsInvite }));
});

route('POST', '/register', async (ctx) => {
  const form = await readForm(ctx.req);
  const values = Object.fromEntries(['name', 'email', 'invite'].map((k) => [k, (form.get(k) || '').trim()]));
  const password = form.get('password') || '';
  const needsInvite = registrationNeedsInvite();
  const fail = (error) => html(ctx, views.registerPage(ctx, { values, error, needsInvite }), 400);

  if (needsInvite && (!cfg.inviteCode || values.invite !== cfg.inviteCode)) return fail('The invite code is not valid.');
  if (!values.name) return fail('Enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return fail('The email address is not valid.');
  if (password.length < 8) return fail('The password must be at least 8 characters long.');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(values.email)) return fail('An account with this email already exists.');

  const r = db
    .prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(values.email, values.name.slice(0, 60), sec.hashPassword(password), db.now());
  ctx.session = { uid: Number(r.lastInsertRowid) };
  flash(ctx, 'ok', `Welcome, ${values.name}! Start by connecting your YouTube channels.`);
  redirect(ctx, '/accounts');
});

route('POST', '/logout', (ctx) => {
  ctx.session = {};
  redirect(ctx, '/login');
});

// ── Rute: kanali ──────────────────────────────────────────
route(
  'GET',
  '/accounts',
  (ctx) => {
    const accounts = db.prepare('SELECT * FROM accounts WHERE user_id=? ORDER BY name COLLATE NOCASE').all(ctx.user.id);
    html(ctx, views.accountsPage(ctx, { accounts, configured: yt.isConfigured() }));
  },
  { auth: true }
);

route(
  'GET',
  '/oauth/youtube/start',
  (ctx) => {
    if (!yt.isConfigured()) {
      flash(ctx, 'bad', 'Google access is not configured in the .env file.');
      return redirect(ctx, '/accounts');
    }
    const state = sec.randomId();
    ctx.session.oauthState = state;
    redirect(ctx, yt.authUrl(state));
  },
  { auth: true }
);

route(
  'GET',
  '/oauth/youtube/callback',
  async (ctx) => {
    const { query, session } = ctx;
    const expected = session.oauthState;
    delete session.oauthState;

    if (query.get('error')) {
      flash(ctx, 'bad', query.get('error') === 'access_denied' ? 'Connecting was cancelled.' : `Google error: ${query.get('error')}`);
      return redirect(ctx, '/accounts');
    }
    if (!expected || query.get('state') !== expected) {
      flash(ctx, 'bad', 'The connection session has expired. Try again.');
      return redirect(ctx, '/accounts');
    }

    try {
      const tokens = await yt.exchangeCode(query.get('code') || '');
      if (!tokens.scope.includes('youtube.upload')) {
        await yt.revoke(tokens);
        flash(ctx, 'bad', 'Without the upload permission the app cannot publish. Connect again and tick all permissions.');
        return redirect(ctx, '/accounts');
      }
      const channel = await yt.getMyChannel(tokens.access_token);
      if (!channel) {
        await yt.revoke(tokens);
        flash(ctx, 'bad', 'This Google account has no YouTube channel. Create a channel on youtube.com and try again.');
        return redirect(ctx, '/accounts');
      }

      const existing = db
        .prepare("SELECT id, tokens_enc FROM accounts WHERE user_id=? AND platform='youtube' AND external_id=?")
        .get(ctx.user.id, channel.id);
      if (existing) {
        if (!tokens.refresh_token) {
          tokens.refresh_token = JSON.parse(sec.decrypt(existing.tokens_enc)).refresh_token;
        }
        db.prepare("UPDATE accounts SET name=?, thumbnail=?, tokens_enc=?, status='active' WHERE id=?").run(
          channel.title,
          channel.thumbnail,
          sec.encrypt(JSON.stringify(tokens)),
          existing.id
        );
        flash(ctx, 'ok', `Channel “${channel.title}” has been reconnected.`);
      } else {
        db.prepare(
          "INSERT INTO accounts (user_id, platform, external_id, name, thumbnail, tokens_enc, status, created_at) VALUES (?, 'youtube', ?, ?, ?, ?, 'active', ?)"
        ).run(ctx.user.id, channel.id, channel.title, channel.thumbnail, sec.encrypt(JSON.stringify(tokens)), db.now());
        flash(ctx, 'ok', `Channel “${channel.title}” has been connected.`);
      }
    } catch (err) {
      console.error('[oauth]', err);
      flash(ctx, 'bad', `Connecting failed: ${err.message}`);
    }
    redirect(ctx, '/accounts');
  },
  { auth: true }
);

route(
  'POST',
  '/accounts/:id/disconnect',
  async (ctx) => {
    const acc = db.prepare('SELECT * FROM accounts WHERE id=? AND user_id=?').get(Number(ctx.params.id), ctx.user.id);
    if (!acc) return redirect(ctx, '/accounts');
    const uploading = db.prepare("SELECT 1 FROM jobs WHERE account_id=? AND status='uploading'").get(acc.id);
    if (uploading) {
      flash(ctx, 'bad', 'A video is being uploaded to this channel right now. Wait for it to finish, then disconnect.');
      return redirect(ctx, '/accounts');
    }
    try {
      await yt.revoke(JSON.parse(sec.decrypt(acc.tokens_enc)));
    } catch {}
    db.transaction(() => {
      db.prepare("UPDATE jobs SET status='failed', error='The channel was disconnected.' WHERE account_id=? AND status='pending'").run(acc.id);
      db.prepare('DELETE FROM accounts WHERE id=?').run(acc.id);
    });
    flash(ctx, 'ok', `Channel “${acc.name}” has been disconnected and access revoked.`);
    redirect(ctx, '/accounts');
  },
  { auth: true }
);

// ── Rute: upload ──────────────────────────────────────────
route(
  'GET',
  '/upload',
  (ctx) => {
    const accounts = db.prepare('SELECT * FROM accounts WHERE user_id=? ORDER BY name COLLATE NOCASE').all(ctx.user.id);
    html(ctx, views.uploadPage(ctx, { accounts }));
  },
  { auth: true }
);

const VIDEO_EXT = /\.(mp4|mov|m4v|avi|wmv|flv|mkv|webm|mpeg|mpg|3gp|mts)$/i;

// Korak 1: preglednik šalje sirovi fajl (bez multipart-a) i dobija fileId.
route(
  'PUT',
  '/api/files',
  async (ctx) => {
    const { req } = ctx;
    const name = decodeURIComponent(req.headers['x-file-name'] || 'video');
    const mime = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0];
    const size = Number(req.headers['content-length'] || 0);

    if (!mime.startsWith('video/') && !VIDEO_EXT.test(name)) return json(ctx, { error: 'The file is not a video.' }, 400);
    if (!size) return json(ctx, { error: 'The file is empty.' }, 400);
    if (size > cfg.maxUploadBytes) return json(ctx, { error: 'The file is larger than 20 GB.' }, 413);

    const id = sec.randomId();
    const ext = (path.extname(name).match(/^\.[a-z0-9]{1,5}$/i) || [''])[0];
    const dest = path.join(cfg.dataDir, 'uploads', id + ext);
    try {
      await pipeline(req, fs.createWriteStream(dest));
    } catch (err) {
      fs.rm(dest, { force: true }, () => {});
      return json(ctx, { error: 'The file transfer was interrupted.' }, 400);
    }
    const written = fs.statSync(dest).size;
    if (written !== size) {
      fs.rm(dest, { force: true }, () => {});
      return json(ctx, { error: 'The file did not arrive completely. Try again.' }, 400);
    }
    db.prepare('INSERT INTO uploads (id, user_id, path, original_name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id,
      ctx.user.id,
      dest,
      name.slice(0, 255),
      mime.startsWith('video/') ? mime : 'video/*',
      written,
      db.now()
    );
    json(ctx, { fileId: id });
  },
  { auth: true }
);

function validateVideo(form, userId) {
  const errors = [];
  const title = (form.get('title') || '').trim();
  const description = (form.get('description') || '').trim();
  const privacy = form.get('privacy');
  const mfk = form.get('made_for_kids');
  const category = form.get('category') || '22';
  const publishAt = form.get('publish_at') || '';

  if (!title) errors.push('Enter a title.');
  if (title.length > 100) errors.push('The title can be at most 100 characters long.');
  if (/[<>]/.test(title) || /[<>]/.test(description)) errors.push('YouTube does not allow the characters < and > in the title and description.');
  if (Buffer.byteLength(description, 'utf8') > 5000) errors.push('The description is too long (5000 bytes at most).');
  if (!['public', 'unlisted', 'private'].includes(privacy)) errors.push('Choose the video visibility.');
  if (!['yes', 'no'].includes(mfk)) errors.push('Answer whether the video is made for kids.');
  if (!yt.CATEGORIES.some(([id]) => id === category)) errors.push('The category is not valid.');

  const tags = [...new Set((form.get('tags') || '').split(',').map((t) => t.trim().replace(/[<>]/g, '')).filter(Boolean))];
  const tagChars = tags.reduce((n, t) => n + t.length + (t.includes(' ') ? 2 : 0), 0) + Math.max(0, tags.length - 1);
  if (tagChars > 500) errors.push('Tags can be at most 500 characters in total.');

  let publishIso = null;
  if (publishAt) {
    const d = new Date(publishAt);
    if (Number.isNaN(d.getTime())) errors.push('The scheduled time is not valid.');
    else if (d.getTime() < Date.now() + 15 * 60000) errors.push('The scheduled time must be at least 15 minutes in the future.');
    else if (privacy !== 'public') errors.push('To schedule a post, choose “Public”.');
    else publishIso = d.toISOString();
  }

  const ids = [...new Set(form.getAll('accounts').map(Number))];
  const accounts = ids.length
    ? db
        .prepare(`SELECT id, name, platform FROM accounts WHERE user_id=? AND status='active' AND id IN (${ids.map(() => '?').join(',')})`)
        .all(userId, ...ids)
    : [];
  if (!accounts.length) errors.push('Select at least one channel.');
  else if (accounts.length !== ids.length) errors.push('Some of the selected channels are no longer active. Refresh the page.');

  const upload = db.prepare('SELECT * FROM uploads WHERE id=? AND user_id=? AND used=0').get(form.get('fileId') || '', userId);
  if (!upload) errors.push('The video file was not found. Choose it again.');

  return { errors, data: { title, description, privacy, mfk, category, tags, publishIso, accounts, upload } };
}

// Korak 2: metapodaci + izbor kanala → video i poslovi u redu.
route(
  'POST',
  '/upload',
  async (ctx) => {
    const form = await readForm(ctx.req);
    const { errors, data } = validateVideo(form, ctx.user.id);
    if (errors.length) return json(ctx, { errors }, 400);

    const { upload, accounts } = data;
    const now = db.now();
    db.transaction(() => {
      const v = db
        .prepare(
          `INSERT INTO videos (user_id, path, original_name, mime, size, title, description, tags, category_id, privacy, made_for_kids, publish_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          ctx.user.id,
          upload.path,
          upload.original_name,
          upload.mime,
          upload.size,
          data.title,
          data.description,
          JSON.stringify(data.tags),
          data.category,
          data.privacy,
          data.mfk === 'yes' ? 1 : 0,
          data.publishIso,
          now
        );
      const videoId = Number(v.lastInsertRowid);
      const insertJob = db.prepare(
        "INSERT INTO jobs (video_id, account_id, account_name, platform, status, updated_at) VALUES (?, ?, ?, ?, 'pending', ?)"
      );
      for (const a of accounts) insertJob.run(videoId, a.id, a.name, a.platform, now);
      db.prepare('UPDATE uploads SET used=1 WHERE id=?').run(upload.id);
    });
    worker.tick();
    flash(ctx, 'ok', `Video “${data.title}” is queued for publishing to ${accounts.length} ${accounts.length === 1 ? 'channel' : 'channels'}.`);
    json(ctx, { redirect: '/dashboard' });
  },
  { auth: true }
);

// ── Rute: objave ──────────────────────────────────────────
route(
  'GET',
  '/dashboard',
  (ctx) => {
    const videos = db.prepare('SELECT * FROM videos WHERE user_id=? ORDER BY id DESC LIMIT 50').all(ctx.user.id);
    const jobStmt = db.prepare('SELECT * FROM jobs WHERE video_id=? ORDER BY account_name COLLATE NOCASE');
    for (const v of videos) v.jobs = jobStmt.all(v.id);
    html(ctx, views.dashboardPage(ctx, { videos, uploadsToday: worker.uploadsTodayPT() }));
  },
  { auth: true }
);

route(
  'POST',
  '/jobs/:id/retry',
  (ctx) => {
    const job = db
      .prepare('SELECT jobs.* FROM jobs JOIN videos ON videos.id = jobs.video_id WHERE jobs.id=? AND videos.user_id=?')
      .get(Number(ctx.params.id), ctx.user.id);
    if (job && job.status === 'failed') {
      db.prepare("UPDATE jobs SET status='pending', attempts=0, next_attempt_at=NULL, error=NULL, progress=0, updated_at=? WHERE id=?").run(
        db.now(),
        job.id
      );
      worker.tick();
      flash(ctx, 'ok', `Retry for “${job.account_name}” is queued.`);
    }
    redirect(ctx, '/dashboard');
  },
  { auth: true }
);

route(
  'POST',
  '/videos/:id/delete',
  (ctx) => {
    const v = db.prepare('SELECT * FROM videos WHERE id=? AND user_id=?').get(Number(ctx.params.id), ctx.user.id);
    if (!v) return redirect(ctx, '/dashboard');
    if (db.prepare("SELECT 1 FROM jobs WHERE video_id=? AND status='uploading'").get(v.id)) {
      flash(ctx, 'bad', 'The video is still uploading. Wait for it to finish.');
      return redirect(ctx, '/dashboard');
    }
    fs.rm(v.path, { force: true }, () => {});
    db.prepare('DELETE FROM videos WHERE id=?').run(v.id);
    flash(ctx, 'ok', 'The record has been deleted.');
    redirect(ctx, '/dashboard');
  },
  { auth: true }
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
server.requestTimeout = 0; // veliki video fajlovi mogu se slati dugo

server.listen(cfg.port, () => {
  console.log(`\n  ${cfg.appName} is running at ${cfg.baseUrl}`);
  if (!yt.isConfigured()) console.log('  ⚠ GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in .env');
  if (!cfg.ytAudited) console.log('  ⚠ Project is not audited: YouTube will lock videos as private.');
  console.log(`  OAuth redirect URI: ${yt.redirectUri()}\n`);
  worker.start();
});

function shutdown() {
  console.log('\nShutting down…');
  worker.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

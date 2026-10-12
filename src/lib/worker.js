'use strict';
// Pozadinski red poslova: svaki posao = jedan video na jedan kanal.
const fs = require('node:fs');
const cfg = require('./config');
const db = require('./db');
const yt = require('./youtube');
const { encrypt, decrypt } = require('./security');

const MAX_ATTEMPTS = 5;
let running = 0;
let timer = null;

function start() {
  // Poslovi prekinuti gašenjem aplikacije nastavljaju gdje su stali.
  db.prepare("UPDATE jobs SET status='pending', next_attempt_at=NULL WHERE status='uploading'").run();
  cleanupStaleUploads();
  timer = setInterval(tick, 3000);
  tick();
}

function stop() {
  if (timer) clearInterval(timer);
}

function tick() {
  while (running < cfg.concurrency) {
    const now = db.now();
    const job = db
      .prepare(
        "SELECT id FROM jobs WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY id LIMIT 1"
      )
      .get(now);
    if (!job) break;
    db.prepare("UPDATE jobs SET status='uploading', attempts=attempts+1, updated_at=? WHERE id=?").run(now, job.id);
    running++;
    runJob(job.id)
      .catch((e) => console.error('[worker] neočekivana greška', e))
      .finally(() => {
        running--;
        setImmediate(tick);
      });
  }
}

function setJob(id, fields) {
  const keys = Object.keys(fields);
  const sql = `UPDATE jobs SET ${keys.map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`;
  db.prepare(sql).run(...keys.map((k) => fields[k]), db.now(), id);
}

function fail(jobId, message) {
  setJob(jobId, { status: 'failed', error: message, next_attempt_at: null });
}

async function runJob(jobId) {
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  const video = db.prepare('SELECT * FROM videos WHERE id=?').get(job.video_id);
  const account = job.account_id ? db.prepare('SELECT * FROM accounts WHERE id=?').get(job.account_id) : null;

  if (!account) return fail(job.id, 'Kanal je odspojen iz aplikacije.');
  if (account.status !== 'active') return fail(job.id, 'Kanal treba ponovo povezati (stranica „Kanali“).');
  if (video.file_deleted || !fs.existsSync(video.path)) return fail(job.id, 'Video fajl više ne postoji na disku.');

  let tokens = JSON.parse(decrypt(account.tokens_enc));
  const saveTokens = () =>
    db.prepare('UPDATE accounts SET tokens_enc=? WHERE id=?').run(encrypt(JSON.stringify(tokens)), account.id);
  const getToken = async () => {
    const r = await yt.ensureFresh(tokens);
    if (r.changed) {
      tokens = r.tokens;
      saveTokens();
    }
    return tokens.access_token;
  };

  const size = fs.statSync(video.path).size;
  let lastPct = -1;
  const onProgress = (fraction) => {
    const pct = Math.min(100, Math.floor(fraction * 100));
    if (pct - lastPct >= 2 || pct === 100) {
      lastPct = pct;
      setJob(job.id, { progress: pct });
    }
  };

  try {
    let result = null;
    let uploadUrl = job.upload_url;
    let offset = 0;

    if (uploadUrl) {
      const st = await yt.queryStatus(uploadUrl, size, await getToken());
      if (st.done) result = st.video;
      else if (st.expired) uploadUrl = null;
      else offset = st.offset;
    }
    if (!result) {
      if (!uploadUrl) {
        uploadUrl = await yt.startUpload(await getToken(), video, size);
        setJob(job.id, { upload_url: uploadUrl, progress: 0 });
        offset = 0;
      }
      result = await yt.uploadChunks(uploadUrl, video.path, size, offset, getToken, onProgress);
    }

    const now = db.now();
    setJob(job.id, {
      status: 'done',
      progress: 100,
      error: null,
      upload_url: null,
      next_attempt_at: null,
      external_id: result.id,
      external_url: `https://www.youtube.com/watch?v=${result.id}`,
      finished_at: now,
    });
    console.log(`[worker] ✔ "${video.title}" → ${account.name} (${result.id})`);
    cleanupVideo(video.id);
  } catch (err) {
    handleError(job.id, account, err, () => {
      tokens.expires_at = 0;
      saveTokens();
    });
  }
}

function handleError(jobId, account, err, invalidateToken) {
  const { attempts } = db.prepare('SELECT attempts FROM jobs WHERE id=?').get(jobId);
  console.warn(`[worker] ✘ posao #${jobId} (${account.name}): ${err.reason || ''} ${err.message}`);

  if (err.reconnect) {
    db.prepare("UPDATE accounts SET status='reconnect' WHERE id=?").run(account.id);
    return fail(jobId, 'Pristup kanalu je istekao ili je opozvan. Ponovo poveži kanal pa klikni „Pokušaj ponovo“.');
  }

  const reason = err.reason || '';
  if (['quotaExceeded', 'dailyLimitExceeded'].includes(reason)) {
    return setJob(jobId, {
      status: 'pending',
      attempts: attempts - 1,
      next_attempt_at: nextPacificMidnight(),
      error: 'Dnevna API kvota je potrošena. Upload se automatski nastavlja nakon ponoći po pacifičkom vremenu (09:00 kod nas).',
    });
  }
  if (reason === 'uploadLimitExceeded') {
    return setJob(jobId, {
      status: 'pending',
      attempts: attempts - 1,
      next_attempt_at: inMinutes(12 * 60),
      error: 'Ovaj kanal je dostigao YouTube dnevni limit uploada. Novi pokušaj za 12 sati.',
    });
  }
  if (['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason) || err.status === 429) {
    return setJob(jobId, {
      status: 'pending',
      attempts: attempts - 1,
      next_attempt_at: inMinutes(15),
      error: 'YouTube traži da usporimo. Novi pokušaj za 15 minuta.',
    });
  }
  if (err.status === 401) invalidateToken();

  const permanent = err.status >= 400 && err.status < 500 && ![401, 408, 429].includes(err.status);
  if (permanent || attempts >= MAX_ATTEMPTS) return fail(jobId, humanize(err));

  const wait = Math.min(2 ** attempts, 60);
  setJob(jobId, {
    status: 'pending',
    next_attempt_at: inMinutes(wait),
    error: `Pokušaj ${attempts}/${MAX_ATTEMPTS} nije uspio (${humanize(err)}). Novi pokušaj za ${wait} min.`,
  });
}

function humanize(err) {
  const map = {
    youtubeSignupRequired: 'Ovaj Google nalog nema YouTube kanal.',
    invalidTitle: 'YouTube je odbio naslov.',
    invalidDescription: 'YouTube je odbio opis.',
    invalidTags: 'YouTube je odbio tagove.',
    invalidCategoryId: 'Kategorija nije dostupna za ovaj kanal.',
    invalidPublishAt: 'Vrijeme zakazane objave nije ispravno.',
    invalidVideoMetadata: 'Podaci o videu nisu ispravni.',
    mediaBodyRequired: 'Video fajl nije poslan.',
    forbidden: 'YouTube je odbio zahtjev (nema dozvole za ovaj kanal).',
    insufficientPermissions: 'Kanal nije dao dozvolu za upload. Ponovo ga poveži i označi sve dozvole.',
  };
  if (map[err.reason]) return map[err.reason];
  if (err instanceof TypeError) return 'Nema veze sa internetom ili je veza prekinuta.';
  return err.message || 'Nepoznata greška.';
}

function inMinutes(min) {
  return new Date(Date.now() + min * 60000).toISOString();
}

function nextPacificMidnight() {
  const now = new Date();
  const ptNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const diff = now.getTime() - ptNow.getTime();
  const midnight = new Date(ptNow);
  midnight.setHours(24, 10, 0, 0);
  return new Date(midnight.getTime() + diff).toISOString();
}

/** Kad je video objavljen na svim kanalima, briše se lokalna kopija. */
function cleanupVideo(videoId) {
  const left = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE video_id=? AND status!='done'").get(videoId).n;
  if (left > 0) return;
  const video = db.prepare('SELECT path, file_deleted FROM videos WHERE id=?').get(videoId);
  if (!video || video.file_deleted) return;
  fs.rm(video.path, { force: true }, () => {});
  db.prepare('UPDATE videos SET file_deleted=1 WHERE id=?').run(videoId);
}

/** Briše fajlove koji su poslani, a nikad nisu pretvoreni u objavu (stariji od 24h). */
function cleanupStaleUploads() {
  const cutoff = new Date(Date.now() - 24 * 3600e3).toISOString();
  const stale = db.prepare('SELECT id, path FROM uploads WHERE used=0 AND created_at < ?').all(cutoff);
  for (const u of stale) {
    fs.rm(u.path, { force: true }, () => {});
    db.prepare('DELETE FROM uploads WHERE id=?').run(u.id);
  }
}

/** Broj uspješnih uploada danas (po pacifičkom vremenu, kad Google resetuje kvotu). */
function uploadsTodayPT() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' });
  const today = fmt.format(new Date());
  const since = new Date(Date.now() - 48 * 3600e3).toISOString();
  return db
    .prepare("SELECT finished_at FROM jobs WHERE status='done' AND finished_at >= ?")
    .all(since)
    .filter((r) => fmt.format(new Date(r.finished_at)) === today).length;
}

module.exports = { start, stop, tick, cleanupVideo, uploadsTodayPT };

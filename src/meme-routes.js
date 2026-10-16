'use strict';
// Rute za memove: biblioteka i postavljanje memova u Short. server.js ih samo priključuje.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const cfg = require('./lib/config');
const db = require('./lib/db');
const media = require('./lib/media');
const effects = require('./lib/effects');
const studio = require('./lib/studio');
const views = require('./views');
const pages = require('./meme-views');

const MEME_EXT = /\.(mp4|mov|m4v|mkv|webm|gif|mp3|wav|ogg|oga|m4a|aac|opus|flac)$/i;
const MAX_MEME_BYTES = 100 * 1024 ** 2;
const MAX_MEME_SECONDS = 20;
const MAX_PLACEMENTS = 10;

module.exports = function register({ route, html, redirect, flash, readForm, json, sendFile, userClip }) {
  const userMeme = (ctx, id = ctx.params.id) => db.prepare('SELECT * FROM memes WHERE id=? AND user_id=?').get(Number(id), ctx.user.id);
  const userMemes = (userId) => db.prepare('SELECT * FROM memes WHERE user_id=? ORDER BY name COLLATE NOCASE').all(userId);
  const notFound = (ctx, what) => html(ctx, views.errorPage(ctx, 404, `This ${what} does not exist.`), 404);

  route('GET', '/memes', (ctx) => {
    const memes = userMemes(ctx.user.id);
    for (const m of memes) m.hasThumb = fs.existsSync(studio.thumbPath('meme', m.id));
    html(ctx, pages.memesPage(ctx, { memes, ffmpegOk: media.isAvailable() }));
  });

  route('PUT', '/api/memes', async (ctx) => {
    const header = (name) => {
      try {
        return decodeURIComponent(ctx.req.headers[name] || '');
      } catch {
        return '';
      }
    };
    const fileName = path.basename(header('x-file-name') || 'meme');
    const file = path.join(cfg.memesDir, `${crypto.randomBytes(16).toString('hex')}${path.extname(fileName).toLowerCase()}`);
    const accepted = MEME_EXT.test(fileName) && media.isAvailable();
    // Tijelo se uvijek pročita do kraja, da preglednik dobije odgovor umjesto prekinute veze.
    const out = accepted ? fs.createWriteStream(file) : null;
    let size = 0;
    for await (const chunk of ctx.req) {
      size += chunk.length;
      if (out && size <= MAX_MEME_BYTES && !out.write(chunk)) await once(out, 'drain');
    }
    if (out) await new Promise((done) => out.end(done));
    const reject = (message, status = 400) => {
      fs.rmSync(file, { force: true });
      return json(ctx, { error: message }, status);
    };
    if (!MEME_EXT.test(fileName)) return reject('Choose a video, a GIF or a sound: MP4, MOV, WebM, MKV, GIF, MP3, WAV, OGG or M4A.');
    if (!media.isAvailable()) return reject('ffmpeg is not installed, so the meme cannot be checked.');
    if (!size) return reject('The file is empty.');
    if (size > MAX_MEME_BYTES) return reject('The file is larger than 100 MB.', 413);

    const name = (header('x-name').replace(/\s+/g, ' ').trim() || path.parse(fileName).name).slice(0, 60);
    try {
      const info = await media.probe(file, { audioOnly: true });
      if (!(info.duration > 0.2)) return reject('This file is too short to be used.');
      if (info.duration > MAX_MEME_SECONDS) return reject(`A meme can be at most ${MAX_MEME_SECONDS} seconds long; this one is ${Math.round(info.duration)} s. Trim it first.`);
      await studio.addMeme(ctx.user.id, file, name, size, info);
    } catch (err) {
      return reject(`This file could not be read as a video or a sound (${err.message}).`);
    }
    flash(ctx, 'ok', `“${name}” has been added to your memes.`);
    json(ctx, { redirect: '/memes' });
  });

  route('GET', '/memes/:id/file', (ctx) => {
    const meme = userMeme(ctx);
    if (!meme) return notFound(ctx, 'meme');
    sendFile(ctx, meme.path);
  });

  route('GET', '/memes/:id/thumb', (ctx) => {
    const meme = userMeme(ctx);
    if (!meme) return notFound(ctx, 'meme');
    sendFile(ctx, studio.thumbPath('meme', meme.id));
  });

  // Ime i efekat koji prati mem.
  route('POST', '/memes/:id/rename', async (ctx) => {
    const meme = userMeme(ctx);
    const form = await readForm(ctx.req);
    const name = (form.get('name') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const effect = effects.EFFECT_IDS.includes(form.get('effect')) ? form.get('effect') : meme && meme.effect;
    if (meme && name) {
      db.prepare('UPDATE memes SET name=?, effect=? WHERE id=?').run(name, effect, meme.id);
      flash(ctx, 'ok', `Saved “${name}”.`);
    }
    redirect(ctx, '/memes');
  });

  route('POST', '/memes/:id/delete', (ctx) => {
    const meme = userMeme(ctx);
    if (meme) {
      studio.deleteMeme(meme);
      flash(ctx, 'ok', `“${meme.name}” has been deleted.`);
    }
    redirect(ctx, '/memes');
  });

  // ── Memovi u jednom Shortu ──
  const clipLength = (clip) => clip.length_s || clip.end_s - clip.start_s;

  route('GET', '/clips/:id/memes', async (ctx) => {
    const clip = userClip(ctx);
    if (!clip || clip.status !== 'ready') return notFound(ctx, 'Short');
    const memes = userMemes(ctx.user.id);
    const duration = clipLength(clip);
    let placements = [];
    const suggested = ctx.query.get('suggest') === '1' && memes.length > 0;
    if (suggested && fs.existsSync(clip.path)) {
      // Glasni trenuci Shorta; memovi se dijele redom, pomjereno po Shortu da svaki Short ne počne istim.
      const levels = await media.audioLevels(clip.path, duration, () => {}).catch(() => []);
      placements = media.suggestMemeSpots(levels, duration).map((at, i) => {
        const meme = memes[(clip.id + i) % memes.length];
        return { meme_id: meme.id, at, position: 'center', size: 'medium', effect: meme.effect || 'none' };
      });
    }
    html(ctx, pages.clipMemesPage(ctx, { clip, memes, placements, suggested, duration, ffmpegOk: media.isAvailable() }));
  });

  route('POST', '/clips/:id/memes', async (ctx) => {
    const clip = userClip(ctx);
    if (!clip || clip.status !== 'ready') return redirect(ctx, '/shorts');
    const back = `/clips/${clip.id}/memes`;
    const fail = (msg) => (flash(ctx, 'bad', msg), redirect(ctx, back));
    if (!media.isAvailable()) return fail('ffmpeg is not installed, so the Short cannot be created yet.');
    const form = await readForm(ctx.req);
    const duration = clipLength(clip);
    const ids = form.getAll('meme_id');
    const ats = form.getAll('at');
    const positions = form.getAll('position');
    const sizes = form.getAll('size');
    const chosen = form.getAll('effect');
    if (!ids.length) return fail('Add at least one meme.');
    if (ids.length > MAX_PLACEMENTS) return fail(`A Short can have at most ${MAX_PLACEMENTS} memes.`);
    const placements = [];
    for (let i = 0; i < ids.length; i++) {
      const meme = userMeme(ctx, ids[i]);
      const at = Number(ats[i]);
      if (!meme) return fail('One of the memes no longer exists. Choose another one.');
      if (!(at >= 0) || at > duration - 0.5) return fail(`Meme ${i + 1} starts after the end of the Short (${duration.toFixed(1)} s).`);
      placements.push({
        meme_id: meme.id,
        at: Math.round(at * 10) / 10,
        position: media.MEME_POSITIONS.some(([id]) => id === positions[i]) ? positions[i] : 'center',
        size: sizes[i] in media.MEME_SIZES ? sizes[i] : 'medium',
        effect: effects.EFFECT_IDS.includes(chosen[i]) ? chosen[i] : meme.effect || 'none',
      });
    }
    placements.sort((a, b) => a.at - b.at);
    studio.createMemeClip(clip, placements);
    flash(ctx, 'ok', `A Short with ${placements.length} ${placements.length === 1 ? 'meme' : 'memes'} is being created. It appears under Shorts; the original stays as it is.`);
    redirect(ctx, '/shorts');
  });
};

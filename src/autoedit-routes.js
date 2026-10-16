'use strict';
// Rute za Auto edit dugog videa. server.js ih samo priključuje.
const path = require('node:path');
const cfg = require('./lib/config');
const db = require('./lib/db');
const media = require('./lib/media');
const studio = require('./lib/studio');
const autoedit = require('./lib/autoedit');
const longvideo = require('./lib/longvideo');
const views = require('./views');
const pages = require('./autoedit-views');

module.exports = function register({ route, html, redirect, flash, readForm, sendFile, userRecording, watermarkFor }) {
  const activityOf = (rec) => db.prepare('SELECT * FROM activity WHERE recording_id=?').get(rec.id);

  // Izbor iz forme (ili adrese) u opcije plana.
  function readOptions(get, rec) {
    const target = Number(get('target'));
    return {
      target: autoedit.TARGETS.some(([t]) => t === target) ? target : 0,
      tightness: get('tightness') in autoedit.TIGHTNESS ? get('tightness') : 'normal',
      // Najava je uključena dok je korisnik izričito ne isključi.
      hook: get('set') || get('hook') !== null ? get('hook') === '1' : true,
      title: `${path.parse(rec.name).name} – No Commentary`.slice(0, 100),
    };
  }

  async function analysisOf(rec, activity) {
    return {
      duration: rec.duration,
      levels: await studio.recordingLevels(rec),
      motion: JSON.parse(activity.motion),
      black: JSON.parse(activity.black),
    };
  }

  route('GET', '/recordings/:id/autoedit', async (ctx) => {
    const rec = userRecording(ctx);
    if (!rec || rec.status !== 'ready') return redirect(ctx, rec ? `/recordings/${rec.id}` : '/recordings');
    let activity = activityOf(rec);
    if (!activity) {
      studio.requestActivity(rec.id);
      activity = activityOf(rec);
    }
    const options = readOptions((k) => ctx.query.get(k), rec);
    let plan = null;
    let moments = [];
    if (activity.status === 'ready') {
      const analysis = await analysisOf(rec, activity);
      plan = autoedit.buildPlan(analysis, options);
      moments = autoedit.thumbnailMoments(analysis, plan);
    }
    const bumpers = db.prepare('SELECT * FROM bumpers WHERE user_id=? ORDER BY name COLLATE NOCASE').all(ctx.user.id);
    html(
      ctx,
      pages.autoeditPage(ctx, { rec, activity, plan, names: plan ? autoedit.chapterNames(plan) : [], options, bumpers, moments, ffmpegOk: media.isAvailable() })
    );
  });

  route('POST', '/recordings/:id/autoedit/analyze', (ctx) => {
    const rec = userRecording(ctx);
    if (rec) studio.requestActivity(rec.id, true);
    redirect(ctx, rec ? `/recordings/${rec.id}/autoedit` : '/recordings');
  });

  route('POST', '/recordings/:id/autoedit', async (ctx) => {
    const rec = userRecording(ctx);
    if (!rec) return redirect(ctx, '/recordings');
    const back = `/recordings/${rec.id}/autoedit`;
    const form = await readForm(ctx.req);
    const activity = activityOf(rec);
    if (!activity || activity.status !== 'ready') return redirect(ctx, back);
    if (!media.isAvailable()) {
      flash(ctx, 'bad', 'ffmpeg is not installed, so the video cannot be created yet.');
      return redirect(ctx, back);
    }
    const options = readOptions((k) => form.get(k), rec);
    const plan = autoedit.buildPlan(await analysisOf(rec, activity), { ...options, hook: form.get('hook') === '1' });
    const names = autoedit.chapterNames(plan, form.getAll('chapter'));
    const title = (form.get('title') || '').replace(/\s+/g, ' ').trim().slice(0, 100) || options.title;
    const bumper = (field) => (form.get(field) ? db.prepare('SELECT id, name FROM bumpers WHERE id=? AND user_id=?').get(Number(form.get(field)), ctx.user.id) : null) || null;
    const watermark = watermarkFor(ctx, form);
    studio.createAutoEdit(rec, {
      title,
      plan,
      names,
      description: autoedit.description(title, plan, names),
      intro: bumper('intro'),
      outro: bumper('outro'),
      logo: watermark ? JSON.parse(watermark) : null,
      quality: form.get('quality') === 'source' ? 'source' : '1080',
    });
    flash(ctx, 'ok', `“${title}” is being created (${views.fmtTime(plan.length)}). It appears under Videos with its publish kit filled in.`);
    redirect(ctx, '/videos');
  });

  // Kadar snimka za prijedloge thumbnaila (pravi se jednom i čuva).
  route('GET', '/recordings/:id/frame/:sec', async (ctx) => {
    const rec = userRecording(ctx);
    const sec = Math.floor(Number(ctx.params.sec));
    if (!rec || !(sec >= 0) || sec > rec.duration) return html(ctx, views.errorPage(ctx, 404, 'This frame does not exist.'), 404);
    const file = path.join(cfg.thumbsDir, `frame-${rec.id}-${sec}.jpg`);
    try {
      await longvideo.frame(rec.path, sec, file, await longvideo.isHdr(rec.path));
    } catch {
      return html(ctx, views.errorPage(ctx, 404, 'This frame could not be read.'), 404);
    }
    sendFile(ctx, file);
  });
};


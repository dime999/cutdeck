'use strict';
// Rute za "Shorts from scenes". server.js ih samo priključuje.
const path = require('node:path');
const db = require('./lib/db');
const media = require('./lib/media');
const studio = require('./lib/studio');
const scenes = require('./lib/scenes');
const pages = require('./scenes-views');

module.exports = function register({ route, html, redirect, flash, readForm, userRecording, watermarkFor, getSetting }) {
  const scanOf = (rec) => db.prepare('SELECT * FROM scenes WHERE recording_id=?').get(rec.id);
  const readOptions = (get, rec) => ({
    sensitivity: get('sensitivity') in scenes.SENSITIVITY ? get('sensitivity') : 'normal',
    minLength: scenes.MIN_LENGTHS.some(([m]) => m === Number(get('min'))) ? Number(get('min')) : scenes.MIN_SHORT,
    prefix: path.parse(rec.name).name.slice(0, 80),
  });
  const listOf = (rec, scan, options) => scenes.buildScenes({ duration: rec.duration, cuts: JSON.parse(scan.cuts), black: JSON.parse(scan.black) }, options);

  route('GET', '/recordings/:id/scenes', (ctx) => {
    const rec = userRecording(ctx);
    if (!rec || rec.status !== 'ready') return redirect(ctx, rec ? `/recordings/${rec.id}` : '/recordings');
    let scan = scanOf(rec);
    if (!scan) {
      studio.requestScenes(rec.id);
      scan = scanOf(rec);
    }
    const options = readOptions((k) => ctx.query.get(k), rec);
    const list = scan.status === 'ready' ? listOf(rec, scan, options) : null;
    html(ctx, pages.scenesPage(ctx, { rec, scan, scenes: list, options, captionsProblem: media.transcribeProblem(), ffmpegOk: media.isAvailable() }));
  });

  route('POST', '/recordings/:id/scenes/scan', (ctx) => {
    const rec = userRecording(ctx);
    if (rec) studio.requestScenes(rec.id, true);
    redirect(ctx, rec ? `/recordings/${rec.id}/scenes` : '/recordings');
  });

  route('POST', '/recordings/:id/scenes', async (ctx) => {
    const rec = userRecording(ctx);
    if (!rec) return redirect(ctx, '/recordings');
    const back = `/recordings/${rec.id}/scenes`;
    const fail = (msg) => (flash(ctx, 'bad', msg), redirect(ctx, back));
    if (!media.isAvailable()) return fail('ffmpeg is not installed, so Shorts cannot be created yet.');
    const form = await readForm(ctx.req);
    const scan = scanOf(rec);
    if (!scan || scan.status !== 'ready') return redirect(ctx, back);
    const layout = media.LAYOUTS.some(([id]) => id === form.get('layout')) ? form.get('layout') : 'blur';

    // Ista lista scena kao na stranici (ista podešavanja stižu u skrivenim poljima), pa izbor po rednom broju.
    const options = readOptions((k) => form.get(k), rec);
    const list = listOf(rec, scan, options);
    const picked = new Set(form.getAll('scene').map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < list.length));
    const chosen = scenes.pickScenes(list, { picked, joins: form.getAll('join').map(Number), min: options.minLength });
    if (!chosen.length) return fail('No scene was selected, so no Shorts were created.');

    const prefix = (form.get('prefix') || '').replace(/\s+/g, ' ').trim().slice(0, 80) || path.parse(rec.name).name.slice(0, 80);
    const captions = form.get('auto_captions') === '1' && !media.transcribeProblem();
    const watermark = watermarkFor(ctx, form);
    let count = 0;
    chosen.forEach((scene, n) => {
      for (const part of scenes.shortsFor(scene)) {
        const title = `${prefix} #${n + 1}${part.part ? ` (${part.part}/${part.parts})` : ''}`.slice(0, 100);
        // Uz titlove ostaje samo Short sa titlovima; međukorak bez njih se briše.
        const followup = captions ? { captions: true, style: getSetting(ctx.user.id, 'caption_style', media.DEFAULT_CAPTION_STYLE), intro: null, outro: null, title, cleanup: true } : null;
        studio.createClip(rec, { title, start: part.start, end: part.end, layout, followup, watermark });
        count++;
      }
    });
    const extras = [captions && 'captions', watermark && 'your logo'].filter(Boolean);
    flash(ctx, 'ok', `${count} ${count === 1 ? 'Short is' : 'Shorts are'} being created, one per scene${extras.length ? `, with ${extras.join(' and ')}` : ''}. They appear under Shorts.`);
    redirect(ctx, '/shorts');
  });
};

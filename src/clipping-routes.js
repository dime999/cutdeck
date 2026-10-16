'use strict';
// Rute sekcije Clipping. Odvojene su od ostatka aplikacije; server.js ih samo priključuje.
const fs = require('node:fs');
const db = require('./lib/db');
const media = require('./lib/media');
const studio = require('./lib/studio');
const clipping = require('./lib/clipping');
const views = require('./views');
const pages = require('./clipping-views');

const MAX_CLIP = studio.MAX_CLIP;
const MAX_HOOK = 5; // hook duži od ovoga više nije hook nego druga scena
const SUGGEST_COUNTS = [5, 10, 15, 20];
const SUGGEST_LENGTHS = [15, 30, 45]; // približna dužina predložene scene, u sekundama

// "1:02:03", "12:34.5" ili "75" → sekunde (NaN ako nije ispravno).
function parseTime(text) {
  const parts = String(text || '').trim().split(':');
  if (!parts[0] || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

// Riječi transkripta složene u redove za čitanje: red se zatvara na kraju rečenice, nakon pauze ili kad je dug.
function transcriptLines(words) {
  const lines = [];
  let current = [];
  const close = () => {
    if (current.length) lines.push({ start: current[0].s, end: current[current.length - 1].e, text: current.map((w) => w.t).join(' ') });
    current = [];
  };
  for (const word of words) {
    const pause = current.length ? word.s - current[current.length - 1].e : 0;
    const length = current.reduce((n, w) => n + w.t.length + 1, 0);
    if (current.length && (pause > 0.8 || length > 70)) close();
    current.push(word);
    if (/[.!?]$/.test(word.t) && length > 20) close();
  }
  close();
  return lines;
}

module.exports = function register({ route, html, redirect, flash, readForm, getSetting, watermarkFor }) {
  const notFound = (ctx, what) => html(ctx, views.errorPage(ctx, 404, `This ${what} does not exist.`), 404);
  const userCampaign = (ctx, id = ctx.params.id) => db.prepare('SELECT * FROM campaigns WHERE id=? AND user_id=?').get(Number(id), ctx.user.id);
  const readyRecordings = (userId) =>
    db.prepare("SELECT id, name, duration FROM recordings WHERE user_id=? AND hidden=0 AND status='ready' ORDER BY id DESC").all(userId);
  const campaignClips = (campaign) => db.prepare('SELECT * FROM clips WHERE campaign_id=? AND user_id=? ORDER BY id DESC').all(campaign.id, campaign.user_id);

  // Pravila kampanje iz forme; vraća poruku o grešci ili očišćene vrijednosti.
  function readCampaign(form, userId) {
    const text = (name, max) => (form.get(name) || '').replace(/\s+/g, ' ').trim().slice(0, max);
    const rec = db.prepare("SELECT id FROM recordings WHERE id=? AND user_id=? AND hidden=0 AND status='ready'").get(Number(form.get('recording_id')), userId);
    const min = Number(form.get('min_seconds'));
    if (!text('name', 80)) return { error: 'Give the campaign a name.' };
    if (!rec) return { error: 'Choose the episode to clip from.' };
    if (!(min >= 1) || min > MAX_CLIP) return { error: `The shortest clip must be between 1 and ${MAX_CLIP} seconds.` };
    return {
      values: {
        name: text('name', 80),
        recording_id: rec.id,
        hashtags: clipping.withPrefix(text('hashtags', 200), '#').join(' '),
        tag_youtube: clipping.withPrefix(text('tag_youtube', 60), '@').join(' '),
        tag_tiktok: clipping.withPrefix(text('tag_tiktok', 60), '@').join(' '),
        tag_instagram: clipping.withPrefix(text('tag_instagram', 60), '@').join(' '),
        tag_x: clipping.withPrefix(text('tag_x', 60), '@').join(' '),
        banned: clipping.bannedList({ banned: text('banned', 300) }).join(', '),
        min_seconds: Math.round(min),
      },
    };
  }
  const FIELDS = ['name', 'recording_id', 'hashtags', 'tag_youtube', 'tag_tiktok', 'tag_instagram', 'tag_x', 'banned', 'min_seconds'];

  route('GET', '/clipping', (ctx) => {
    const campaigns = db
      .prepare(
        `SELECT c.*, r.name AS recording_name,
           (SELECT COUNT(*) FROM clips WHERE campaign_id = c.id) AS clips,
           (SELECT COUNT(DISTINCT p.clip_id) FROM posts p JOIN clips ON clips.id = p.clip_id WHERE clips.campaign_id = c.id AND p.posted_at IS NOT NULL) AS posted
         FROM campaigns c LEFT JOIN recordings r ON r.id = c.recording_id AND r.hidden = 0
         WHERE c.user_id=? ORDER BY c.id DESC`
      )
      .all(ctx.user.id);
    html(ctx, pages.campaignsPage(ctx, { campaigns, recordings: readyRecordings(ctx.user.id) }));
  });

  route('POST', '/clipping', async (ctx) => {
    const { error, values } = readCampaign(await readForm(ctx.req), ctx.user.id);
    if (error) {
      flash(ctx, 'bad', error);
      return redirect(ctx, '/clipping');
    }
    const r = db
      .prepare(`INSERT INTO campaigns (user_id, ${FIELDS.join(', ')}, created_at) VALUES (?, ${FIELDS.map(() => '?').join(', ')}, ?)`)
      .run(ctx.user.id, ...FIELDS.map((f) => values[f]), db.now());
    flash(ctx, 'ok', `Campaign “${values.name}” has been created.`);
    redirect(ctx, `/clipping/${Number(r.lastInsertRowid)}`);
  });

  route('GET', '/clipping/:id', (ctx) => {
    const campaign = userCampaign(ctx);
    if (!campaign) return notFound(ctx, 'campaign');
    const rec = db.prepare("SELECT * FROM recordings WHERE id=? AND user_id=? AND hidden=0 AND status='ready'").get(campaign.recording_id, ctx.user.id) || null;
    const transcript = rec ? db.prepare('SELECT * FROM transcripts WHERE recording_id=?').get(rec.id) || null : null;
    const lines = transcript && transcript.status === 'ready' ? transcriptLines(media.cleanWords(JSON.parse(transcript.words), 't')) : [];
    const clips = campaignClips(campaign);
    const posted = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE clip_id=? AND posted_at IS NOT NULL');
    for (const c of clips) {
      c.hasThumb = fs.existsSync(studio.thumbPath('clip', c.id));
      c.posted = posted.get(c.id).n;
    }
    html(
      ctx,
      pages.campaignPage(ctx, {
        campaign,
        rec,
        transcript,
        lines,
        clips,
        recordings: readyRecordings(ctx.user.id),
        // „Make a variation“ otvara ovu stranicu sa već upisanim početkom i krajem.
        prefill: { start: ctx.query.get('start') || '', end: ctx.query.get('end') || '' },
        problem: media.transcribeProblem(),
        ffmpegOk: media.isAvailable(),
      })
    );
  });

  route('POST', '/clipping/:id', async (ctx) => {
    const campaign = userCampaign(ctx);
    if (!campaign) return notFound(ctx, 'campaign');
    const { error, values } = readCampaign(await readForm(ctx.req), ctx.user.id);
    if (error) flash(ctx, 'bad', error);
    else {
      db.prepare(`UPDATE campaigns SET ${FIELDS.map((f) => `${f}=?`).join(', ')} WHERE id=?`).run(...FIELDS.map((f) => values[f]), campaign.id);
      flash(ctx, 'ok', 'The campaign rules have been saved.');
    }
    redirect(ctx, `/clipping/${campaign.id}`);
  });

  route('POST', '/clipping/:id/delete', (ctx) => {
    const campaign = userCampaign(ctx);
    if (!campaign) return redirect(ctx, '/clipping');
    for (const clip of campaignClips(campaign)) {
      if (clip.status === 'pending' || clip.status === 'rendering') studio.cancelClip(clip);
      else studio.deleteClip(clip);
    }
    db.prepare('DELETE FROM campaigns WHERE id=?').run(campaign.id);
    flash(ctx, 'ok', `Campaign “${campaign.name}” and its clips have been deleted.`);
    redirect(ctx, '/clipping');
  });

  route('POST', '/clipping/:id/transcribe', (ctx) => {
    const campaign = userCampaign(ctx);
    if (!campaign) return redirect(ctx, '/clipping');
    const problem = media.transcribeProblem();
    if (problem) flash(ctx, 'bad', problem);
    else studio.requestTranscript(campaign.recording_id);
    redirect(ctx, `/clipping/${campaign.id}`);
  });

  const campaignRecording = (campaign) =>
    db.prepare("SELECT * FROM recordings WHERE id=? AND user_id=? AND hidden=0 AND status='ready'").get(campaign.recording_id, campaign.user_id);
  const transcriptWords = (rec) => {
    const row = db.prepare("SELECT words FROM transcripts WHERE recording_id=? AND status='ready'").get(rec.id);
    return row ? media.cleanWords(JSON.parse(row.words), 't') : null; // i transkripti nastali prije čišćenja
  };

  // Hook iz forme: { hook } (null ako su oba polja prazna) ili { error }.
  function readHook(form, rec) {
    if (!(form.get('hook_start') || '').trim() && !(form.get('hook_end') || '').trim()) return { hook: null };
    const from = parseTime(form.get('hook_start'));
    const to = parseTime(form.get('hook_end'));
    if (Number.isNaN(from) || Number.isNaN(to)) return { error: 'Enter both ends of the hook as m:ss, or leave both empty.' };
    if (to - from < 0.5 || to - from > MAX_HOOK) return { error: `A hook is between half a second and ${MAX_HOOK} seconds long.` };
    if (to > rec.duration + 0.5) return { error: 'The hook is past the end of the episode.' };
    return { hook: { start: from, end: Math.min(to, rec.duration) } };
  }

  // Scena iz forme: { start, end } ili { error }.
  function readScene(form, rec) {
    const start = parseTime(form.get('start'));
    const end = parseTime(form.get('end'));
    if (Number.isNaN(start) || Number.isNaN(end)) return { error: 'Enter the start and end as m:ss, for example 12:34.' };
    if (end - start < studio.MIN_CLIP) return { error: `The scene must be at least ${studio.MIN_CLIP} seconds long.` };
    if (end > rec.duration + 0.5) return { error: 'The end is past the end of the episode.' };
    return { start, end: Math.min(end, rec.duration) };
  }

  /**
   * Sve što klipu treba prije rezanja: dijelovi izvora, dužina i titlovi iz transkripta.
   * Bez zadanog hooka, uz `autoHook`, hook se bira po glasnoći (`levels`).
   */
  function planClip({ words, levels = [], style, start, end, hook = null, autoHook = false, trimSilence }) {
    if (!hook && autoHook) hook = clipping.pickHook({ start, end, words, levels });
    const edl = clipping.buildEdl({ start, end, hook, trimSilence, words });
    const lines = media.linesFromWords(clipping.mapWords(edl, words));
    return { edl, hook, length: clipping.edlLength(edl), lines, subtitles: lines.length ? media.buildAss(lines, style, media.SHORT_SIZE) : null };
  }
  const lengthProblem = (campaign, length) =>
    length > MAX_CLIP
      ? `The clip would be ${Math.round(length)} seconds long; the longest allowed is ${MAX_CLIP}.`
      : length < campaign.min_seconds
        ? `The clip would be ${length.toFixed(1)} seconds long, shorter than the ${campaign.min_seconds} seconds this campaign asks for. Choose a longer scene.`
        : null;

  route('POST', '/clipping/:id/clips', async (ctx) => {
    const campaign = userCampaign(ctx);
    if (!campaign) return redirect(ctx, '/clipping');
    const back = `/clipping/${campaign.id}`;
    const fail = (msg) => (flash(ctx, 'bad', msg), redirect(ctx, back));
    const form = await readForm(ctx.req);
    const rec = campaignRecording(campaign);
    if (!rec) return fail('The episode of this campaign is missing. Choose another one in the campaign rules.');
    if (!media.isAvailable()) return fail('ffmpeg is not installed, so clips cannot be created yet.');

    const scene = readScene(form, rec);
    if (scene.error) return fail(scene.error);
    const layout = form.get('layout');
    if (!media.LAYOUTS.some(([id]) => id === layout)) return fail('Choose a layout.');
    const asked = readHook(form, rec);
    if (asked.error) return fail(asked.error);

    const words = transcriptWords(rec);
    const autoHook = !asked.hook && form.get('auto_hook') === '1' && Boolean(words);
    const plan = planClip({
      words: words || [],
      levels: autoHook ? await studio.recordingLevels(rec) : [],
      style: getSetting(ctx.user.id, 'caption_style', media.DEFAULT_CAPTION_STYLE),
      ...scene,
      hook: asked.hook,
      autoHook,
      trimSilence: form.get('trim_silence') === '1',
    });
    const problem = lengthProblem(campaign, plan.length);
    if (problem) return fail(problem);

    const title = (form.get('title') || '').replace(/\s+/g, ' ').trim().slice(0, 100) || `${campaign.name} ${views.fmtTime(scene.start)}`.slice(0, 100);
    const repeated = clipping.overlapShare(scene.start, scene.end, campaignClips(campaign).map((c) => ({ start: c.start_s, end: c.end_s })));
    studio.createCampaignClip(rec, { campaignId: campaign.id, title, ...scene, layout, edl: plan.edl, length: plan.length, subtitles: plan.subtitles, lines: plan.lines, watermark: watermarkFor(ctx, form) });
    const notes = [
      autoHook && (plan.hook ? `It opens with a hook from ${views.fmtTime(plan.hook.start)}.` : 'No part of this scene stands out enough to be a hook, so it has none.'),
      !words && 'The episode is not transcribed, so this clip has no captions.',
      words && !plan.lines.length && 'No speech was found in this part, so this clip has no captions.',
      repeated >= 0.5 && `${Math.round(repeated * 100)}% of this scene is already in another clip of this campaign.`,
    ].filter(Boolean);
    flash(ctx, 'ok', [`Clip “${title}” is being created (${plan.length.toFixed(1)} s).`, ...notes].join(' '));
    redirect(ctx, back);
  });

  // ── Prijedlozi: aplikacija izabere scene iz transkripta, korisnik ih pregleda, pa nastaju klipovi ──
  // Vraća { rec, words } ili poruku zašto prijedloga ne može biti.
  function suggestSource(campaign) {
    const rec = campaignRecording(campaign);
    if (!rec) return { error: 'The episode of this campaign is missing. Choose another one in the campaign rules.' };
    const words = transcriptWords(rec);
    if (!words) return { error: 'Transcribe the episode first. Suggestions are chosen from what is said.' };
    return { rec, words };
  }

  route('GET', '/clipping/:id/suggest', async (ctx) => {
    const campaign = userCampaign(ctx);
    if (!campaign) return notFound(ctx, 'campaign');
    const fail = (msg) => (flash(ctx, 'bad', msg), redirect(ctx, `/clipping/${campaign.id}`));
    const { rec, words, error } = suggestSource(campaign);
    if (error) return fail(error);
    const count = Number(ctx.query.get('count'));
    const target = Number(ctx.query.get('length'));
    if (!SUGGEST_COUNTS.includes(count) || !SUGGEST_LENGTHS.includes(target)) return fail('Choose how many clips and how long.');

    const levels = await studio.recordingLevels(rec);
    const scenes = clipping
      .suggestScenes({
        words,
        waveform: levels.length ? media.waveform(levels, levels.length) : [],
        duration: rec.duration,
        count,
        target,
        min: Math.max(campaign.min_seconds, studio.MIN_CLIP),
        used: campaignClips(campaign).map((c) => ({ start: c.start_s, end: c.end_s })),
      })
      .map((scene) => {
        const hook = clipping.pickHook({ start: scene.start, end: scene.end, words, levels });
        return { ...scene, said: clipping.saidBetween(words, scene.start, scene.end), hook, hookSaid: hook ? clipping.saidBetween(words, hook.start, hook.end) : '' };
      });
    if (!scenes.length) return fail('No new scenes were found. The episode may have too little speech, or its best parts are already in your clips.');
    html(ctx, pages.suggestPage(ctx, { campaign, rec, scenes, count, target, ffmpegOk: media.isAvailable() }));
  });

  route('POST', '/clipping/:id/suggest', async (ctx) => {
    const campaign = userCampaign(ctx);
    if (!campaign) return redirect(ctx, '/clipping');
    const back = `/clipping/${campaign.id}`;
    const fail = (msg) => (flash(ctx, 'bad', msg), redirect(ctx, back));
    const form = await readForm(ctx.req);
    const { rec, words, error } = suggestSource(campaign);
    if (error) return fail(error);
    if (!media.isAvailable()) return fail('ffmpeg is not installed, so clips cannot be created yet.');
    const layout = form.get('layout');
    if (!media.LAYOUTS.some(([id]) => id === layout)) return fail('Choose a layout.');

    // Izabrane scene stižu kao "početak-kraj" u sekundama izvora.
    const scenes = [];
    for (const value of form.getAll('scene').slice(0, Math.max(...SUGGEST_COUNTS))) {
      const m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(value);
      if (!m) continue;
      const [start, end] = [Number(m[1]), Number(m[2])];
      if (end - start >= studio.MIN_CLIP && end <= rec.duration + 0.5 && !scenes.some((s) => start < s.end && end > s.start)) scenes.push({ start, end });
    }
    if (!scenes.length) return fail('No scene was selected, so no clips were created.');

    const autoHook = form.get('auto_hook') === '1';
    const levels = autoHook ? await studio.recordingLevels(rec) : [];
    const style = getSetting(ctx.user.id, 'caption_style', media.DEFAULT_CAPTION_STYLE);
    let made = 0;
    let hooks = 0;
    for (const scene of scenes) {
      const plan = planClip({ words, levels, style, ...scene, autoHook, trimSilence: form.get('trim_silence') === '1' });
      if (lengthProblem(campaign, plan.length)) continue;
      // Naslov je početak onoga što se u sceni kaže; korisnik ga mijenja na stranici klipa.
      const said = clipping.saidBetween(words, scene.start, scene.end).replace(/["“”]/g, '');
      const title = (said.length > 60 ? `${said.slice(0, 57).replace(/\s+\S*$/, '')}…` : said.replace(/[\s.,!?…]+$/, '')) || `${campaign.name} ${views.fmtTime(scene.start)}`.slice(0, 100);
      studio.createCampaignClip(rec, { campaignId: campaign.id, title, ...scene, layout, edl: plan.edl, length: plan.length, subtitles: plan.subtitles, lines: plan.lines, watermark: watermarkFor(ctx, form) });
      made++;
      if (plan.hook) hooks++;
    }
    if (!made) return fail('None of the selected scenes is long enough for this campaign once the pauses are cut out.');
    flash(
      ctx,
      'ok',
      `${made} ${made === 1 ? 'clip is' : 'clips are'} being created${autoHook ? `, ${hooks} of them with a hook` : ''}. Watch each one before posting.`
    );
    redirect(ctx, back);
  });

  // Brisanje više označenih klipova odjednom.
  route('POST', '/clipping/:id/clips/delete', async (ctx) => {
    const campaign = userCampaign(ctx);
    if (!campaign) return redirect(ctx, '/clipping');
    const form = await readForm(ctx.req);
    const ids = new Set(form.getAll('ids').map(Number));
    const picked = campaignClips(campaign).filter((c) => ids.has(c.id));
    for (const clip of picked) {
      if (clip.status === 'pending' || clip.status === 'rendering') studio.cancelClip(clip);
      else studio.deleteClip(clip);
    }
    flash(ctx, picked.length ? 'ok' : 'bad', picked.length ? `${picked.length} ${picked.length === 1 ? 'clip has' : 'clips have'} been deleted.` : 'No clip was selected.');
    redirect(ctx, `/clipping/${campaign.id}`);
  });

  // Prekid: uklanja klipove kampanje koji još nisu gotovi.
  route('POST', '/clipping/:id/cancel', (ctx) => {
    const campaign = userCampaign(ctx);
    if (!campaign) return redirect(ctx, '/clipping');
    const unfinished = campaignClips(campaign).filter((c) => c.status === 'pending' || c.status === 'rendering');
    for (const clip of unfinished) studio.cancelClip(clip);
    flash(ctx, 'ok', unfinished.length ? `Stopped. ${unfinished.length} unfinished ${unfinished.length === 1 ? 'clip was' : 'clips were'} removed; finished clips stay.` : 'Nothing was being created.');
    redirect(ctx, `/clipping/${campaign.id}`);
  });

  // ── Jedan klip: provjera pravila, tekst za objavu, evidencija objava i izmjena ──
  const campaignClip = (ctx) => {
    const clip = db.prepare('SELECT * FROM clips WHERE id=? AND user_id=? AND campaign_id IS NOT NULL').get(Number(ctx.params.id), ctx.user.id);
    return clip ? { clip, campaign: userCampaign(ctx, clip.campaign_id) } : {};
  };
  // Redovi titlova klipa; klipovi nastali prije nego što su se čuvali dobiju ih iz transkripta.
  const clipLines = (clip, words) => (clip.cap_lines ? JSON.parse(clip.cap_lines) : words ? media.linesFromWords(clipping.mapWords(JSON.parse(clip.edl), words)) : []);

  route('GET', '/clipping/clips/:id', (ctx) => {
    const { clip, campaign } = campaignClip(ctx);
    if (!clip || !campaign || clip.status !== 'ready') return notFound(ctx, 'clip');
    const posts = db.prepare('SELECT * FROM posts WHERE clip_id=?').all(clip.id);
    const rec = campaignRecording({ ...campaign, recording_id: clip.recording_id });
    html(ctx, pages.clipPage(ctx, { campaign, clip, posts, lines: clipLines(clip, rec && transcriptWords(rec)), canEdit: Boolean(rec) && media.isAvailable() }));
  });

  route('POST', '/clipping/clips/:id', async (ctx) => {
    const { clip, campaign } = campaignClip(ctx);
    if (!clip || !campaign) return redirect(ctx, '/clipping');
    const form = await readForm(ctx.req);
    const title = (form.get('title') || '').replace(/\s+/g, ' ').trim().slice(0, 100) || clip.title;
    const caption = (form.get('caption') || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    db.prepare('UPDATE clips SET title=?, caption=? WHERE id=?').run(title, caption, clip.id);

    const save = db.prepare(
      `INSERT INTO posts (clip_id, platform, url, posted_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(clip_id, platform) DO UPDATE SET url=excluded.url, posted_at=excluded.posted_at`
    );
    const before = db.prepare('SELECT posted_at FROM posts WHERE clip_id=? AND platform=?');
    for (const [platform] of clipping.PLATFORMS) {
      const url = (form.get(`url_${platform}`) || '').trim().slice(0, 300);
      const was = before.get(clip.id, platform);
      const postedAt = form.get(`posted_${platform}`) === '1' ? (was && was.posted_at) || db.now() : null;
      save.run(clip.id, platform, /^https?:\/\//i.test(url) ? url : '', postedAt);
    }
    flash(ctx, 'ok', 'Saved. The texts below now use the new caption.');
    redirect(ctx, `/clipping/clips/${clip.id}`);
  });

  // Izmjena gotovog klipa: novi rez, hook, raspored ili ispravljeni titlovi; klip se pravi iznova.
  route('POST', '/clipping/clips/:id/edit', async (ctx) => {
    const { clip, campaign } = campaignClip(ctx);
    if (!clip || !campaign) return redirect(ctx, '/clipping');
    const back = `/clipping/clips/${clip.id}`;
    const fail = (msg) => (flash(ctx, 'bad', msg), redirect(ctx, back));
    if (clip.status !== 'ready') return redirect(ctx, `/clipping/${campaign.id}`);
    const form = await readForm(ctx.req);
    const rec = campaignRecording({ ...campaign, recording_id: clip.recording_id });
    if (!rec) return fail('The episode this clip was cut from is no longer in your recordings.');
    if (!media.isAvailable()) return fail('ffmpeg is not installed, so the clip cannot be created again.');

    const scene = readScene(form, rec);
    if (scene.error) return fail(scene.error);
    const layout = form.get('layout');
    if (!media.LAYOUTS.some(([id]) => id === layout)) return fail('Choose a layout.');
    const asked = readHook(form, rec);
    if (asked.error) return fail(asked.error);

    const words = transcriptWords(rec) || [];
    const watermark = watermarkFor(ctx, form);
    const style = getSetting(ctx.user.id, 'caption_style', media.DEFAULT_CAPTION_STYLE);
    const plan = planClip({ words, style, ...scene, hook: asked.hook, trimSilence: form.get('trim_silence') === '1' });
    const problem = lengthProblem(campaign, plan.length);
    if (problem) return fail(problem);

    // Isti rez: vrijede ispravke teksta iz forme. Drugačiji rez: titlovi se slažu iznova iz transkripta.
    const sameCut = JSON.stringify(plan.edl) === clip.edl;
    let { lines, subtitles } = plan;
    if (sameCut) {
      const old = clipLines(clip, words);
      lines = media.tidyLines(old.map((line, i) => ({ ...line, text: (form.get(`line_${i}`) ?? line.text).slice(0, 200) })));
      subtitles = lines.length ? media.buildAss(lines, style, media.SHORT_SIZE) : null;
      if (layout === clip.layout && Boolean(watermark) === Boolean(clip.watermark) && JSON.stringify(lines.map((l) => l.text)) === JSON.stringify(old.map((l) => l.text))) {
        flash(ctx, 'ok', 'Nothing was changed, so the clip stays as it is.');
        return redirect(ctx, back);
      }
    }
    studio.rerenderCampaignClip(clip.id, { ...scene, layout, edl: plan.edl, length: plan.length, subtitles, lines, watermark });
    flash(ctx, 'ok', `Clip “${clip.title}” is being created again (${plan.length.toFixed(1)} s).${sameCut ? '' : ' The cut changed, so its captions were taken from the transcript again.'}`);
    redirect(ctx, `/clipping/${campaign.id}`);
  });

  route('POST', '/clipping/clips/:id/delete', (ctx) => {
    const { clip } = campaignClip(ctx);
    if (!clip) return redirect(ctx, '/clipping');
    if (clip.status === 'pending' || clip.status === 'rendering') studio.cancelClip(clip);
    else studio.deleteClip(clip);
    flash(ctx, 'ok', `Clip “${clip.title}” has been deleted.`);
    redirect(ctx, `/clipping/${clip.campaign_id}`);
  });
};

module.exports.transcriptLines = transcriptLines;
module.exports.parseTime = parseTime;
module.exports.SUGGEST_COUNTS = SUGGEST_COUNTS;
module.exports.SUGGEST_LENGTHS = SUGGEST_LENGTHS;

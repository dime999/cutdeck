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

module.exports = function register({ route, html, redirect, flash, readForm, getSetting }) {
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
    const lines = transcript && transcript.status === 'ready' ? transcriptLines(JSON.parse(transcript.words)) : [];
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

  route('POST', '/clipping/:id/clips', async (ctx) => {
    const campaign = userCampaign(ctx);
    if (!campaign) return redirect(ctx, '/clipping');
    const back = `/clipping/${campaign.id}`;
    const fail = (msg) => (flash(ctx, 'bad', msg), redirect(ctx, back));
    const form = await readForm(ctx.req);
    const rec = db.prepare("SELECT * FROM recordings WHERE id=? AND user_id=? AND hidden=0 AND status='ready'").get(campaign.recording_id, ctx.user.id);
    if (!rec) return fail('The episode of this campaign is missing. Choose another one in the campaign rules.');
    if (!media.isAvailable()) return fail('ffmpeg is not installed, so clips cannot be created yet.');

    const start = parseTime(form.get('start'));
    const end = parseTime(form.get('end'));
    const layout = form.get('layout');
    if (Number.isNaN(start) || Number.isNaN(end)) return fail('Enter the start and end as m:ss, for example 12:34.');
    if (end - start < studio.MIN_CLIP) return fail(`The scene must be at least ${studio.MIN_CLIP} seconds long.`);
    if (end > rec.duration + 0.5) return fail('The end is past the end of the episode.');
    if (!media.LAYOUTS.some(([id]) => id === layout)) return fail('Choose a layout.');

    let hook = null;
    if ((form.get('hook_start') || '').trim() || (form.get('hook_end') || '').trim()) {
      const from = parseTime(form.get('hook_start'));
      const to = parseTime(form.get('hook_end'));
      if (Number.isNaN(from) || Number.isNaN(to)) return fail('Enter both ends of the hook as m:ss, or leave both empty.');
      if (to - from < 0.5 || to - from > MAX_HOOK) return fail(`A hook is between half a second and ${MAX_HOOK} seconds long.`);
      if (to > rec.duration + 0.5) return fail('The hook is past the end of the episode.');
      hook = { start: from, end: Math.min(to, rec.duration) };
    }

    const transcript = db.prepare("SELECT words FROM transcripts WHERE recording_id=? AND status='ready'").get(rec.id);
    const words = transcript ? JSON.parse(transcript.words) : [];
    const edl = clipping.buildEdl({ start, end: Math.min(end, rec.duration), hook, trimSilence: form.get('trim_silence') === '1', words });
    const length = clipping.edlLength(edl);
    if (length > MAX_CLIP) return fail(`The clip would be ${Math.round(length)} seconds long; the longest allowed is ${MAX_CLIP}.`);
    if (length < campaign.min_seconds) return fail(`The clip would be ${length.toFixed(1)} seconds long, shorter than the ${campaign.min_seconds} seconds this campaign asks for. Choose a longer scene.`);

    // Titlovi se prave iz transkripta, preslikanog na vrijeme gotovog klipa.
    const lines = media.linesFromWords(clipping.mapWords(edl, words));
    const style = getSetting(ctx.user.id, 'caption_style', media.DEFAULT_CAPTION_STYLE);
    const subtitles = lines.length ? media.buildAss(lines, style, media.SHORT_SIZE) : null;
    const title = (form.get('title') || '').replace(/\s+/g, ' ').trim().slice(0, 100) || `${campaign.name} ${views.fmtTime(start)}`.slice(0, 100);
    const repeated = clipping.overlapShare(start, end, campaignClips(campaign).map((c) => ({ start: c.start_s, end: c.end_s })));

    studio.createCampaignClip(rec, { campaignId: campaign.id, title, start, end: Math.min(end, rec.duration), layout, edl, length, subtitles });
    const notes = [
      !transcript && 'The episode is not transcribed, so this clip has no captions.',
      transcript && !lines.length && 'No speech was found in this part, so this clip has no captions.',
      repeated >= 0.5 && `${Math.round(repeated * 100)}% of this scene is already in another clip of this campaign.`,
    ].filter(Boolean);
    flash(ctx, 'ok', [`Clip “${title}” is being created (${length.toFixed(1)} s).`, ...notes].join(' '));
    redirect(ctx, back);
  });

  // Prijedlozi: aplikacija sama izabere scene iz transkripta i od svake napravi gotov klip s titlovima.
  route('POST', '/clipping/:id/suggest', async (ctx) => {
    const campaign = userCampaign(ctx);
    if (!campaign) return redirect(ctx, '/clipping');
    const back = `/clipping/${campaign.id}`;
    const fail = (msg) => (flash(ctx, 'bad', msg), redirect(ctx, back));
    const form = await readForm(ctx.req);
    const rec = db.prepare("SELECT * FROM recordings WHERE id=? AND user_id=? AND hidden=0 AND status='ready'").get(campaign.recording_id, ctx.user.id);
    if (!rec) return fail('The episode of this campaign is missing. Choose another one in the campaign rules.');
    if (!media.isAvailable()) return fail('ffmpeg is not installed, so clips cannot be created yet.');
    const transcript = db.prepare("SELECT words FROM transcripts WHERE recording_id=? AND status='ready'").get(rec.id);
    if (!transcript) return fail('Transcribe the episode first. Suggestions are chosen from what is said.');

    const count = Number(form.get('count'));
    const target = Number(form.get('length'));
    const layout = form.get('layout');
    if (!SUGGEST_COUNTS.includes(count) || !SUGGEST_LENGTHS.includes(target)) return fail('Choose how many clips and how long.');
    if (!media.LAYOUTS.some(([id]) => id === layout)) return fail('Choose a layout.');

    const words = JSON.parse(transcript.words);
    const scenes = clipping.suggestScenes({
      words,
      waveform: rec.waveform ? JSON.parse(rec.waveform) : [],
      duration: rec.duration,
      count,
      target,
      min: Math.max(campaign.min_seconds, studio.MIN_CLIP),
      used: campaignClips(campaign).map((c) => ({ start: c.start_s, end: c.end_s })),
    });
    const style = getSetting(ctx.user.id, 'caption_style', media.DEFAULT_CAPTION_STYLE);
    let made = 0;
    for (const scene of scenes) {
      const edl = clipping.buildEdl({ start: scene.start, end: scene.end, trimSilence: form.get('trim_silence') === '1', words });
      const length = clipping.edlLength(edl);
      if (length < campaign.min_seconds || length > MAX_CLIP) continue;
      const lines = media.linesFromWords(clipping.mapWords(edl, words));
      // Naslov je početak onoga što se u sceni kaže; korisnik ga mijenja na stranici klipa.
      const said = scene.text.replace(/[\s.,!?…]+$/, '');
      const title = (said.length > 60 ? `${said.slice(0, 57).replace(/\s+\S*$/, '')}…` : said) || `${campaign.name} ${views.fmtTime(scene.start)}`.slice(0, 100);
      studio.createCampaignClip(rec, { campaignId: campaign.id, title, start: scene.start, end: scene.end, layout, edl, length, subtitles: lines.length ? media.buildAss(lines, style, media.SHORT_SIZE) : null });
      made++;
    }
    if (!made) return fail('No new scenes were found. The episode may have too little speech, or its best parts are already in your clips.');
    flash(
      ctx,
      'ok',
      `${made} ${made === 1 ? 'clip is' : 'clips are'} being created${made < count ? ` (only ${made} ${made === 1 ? 'scene' : 'scenes'} of this length did not overlap)` : ''}. Watch each one before posting: the choice is based on loudness and how much is said, not on what is funny.`
    );
    redirect(ctx, back);
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

  // ── Jedan klip: provjera pravila, tekst za objavu i evidencija objava ──
  const campaignClip = (ctx) => {
    const clip = db.prepare('SELECT * FROM clips WHERE id=? AND user_id=? AND campaign_id IS NOT NULL').get(Number(ctx.params.id), ctx.user.id);
    return clip ? { clip, campaign: userCampaign(ctx, clip.campaign_id) } : {};
  };

  route('GET', '/clipping/clips/:id', (ctx) => {
    const { clip, campaign } = campaignClip(ctx);
    if (!clip || !campaign || clip.status !== 'ready') return notFound(ctx, 'clip');
    const posts = db.prepare('SELECT * FROM posts WHERE clip_id=?').all(clip.id);
    html(ctx, pages.clipPage(ctx, { campaign, clip, posts }));
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

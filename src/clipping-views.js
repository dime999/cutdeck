'use strict';
// Stranice sekcije Clipping: kampanje, radni prostor jedne kampanje i stranica klipa.
const { h, icon, crumb, menu, emptyState, meta, layout, fmtTime, fmtSize, progressBar, studioPoll } = require('./views');
const { LAYOUTS } = require('./lib/media');
const { PLATFORMS, withPrefix, bannedList, checkClip, platformCaption } = require('./lib/clipping');

// Vrijeme sa desetinkom, kakvo forma za klip prima i prikazuje.
const fmtExact = (t) => {
  const whole = Math.floor(t * 10) / 10;
  const sec = (whole % 60).toFixed(1).padStart(4, '0');
  const min = Math.floor((whole % 3600) / 60);
  return whole >= 3600 ? `${Math.floor(whole / 3600)}:${String(min).padStart(2, '0')}:${sec}` : `${min}:${sec}`;
};

// Vrijeme sa stotinkom: forma za izmjenu klipa mora vratiti tačno isti rez da bi se prepoznalo da nije mijenjan.
const fmtFine = (t) => {
  const cs = Math.round(t * 100);
  const sec = ((cs % 6000) / 100).toFixed(2).padStart(5, '0');
  const min = Math.floor(cs / 6000) % 60;
  return cs >= 360000 ? `${Math.floor(cs / 360000)}:${String(min).padStart(2, '0')}:${sec}` : `${min}:${sec}`;
};

// Polja pravila kampanje; koristi ih i forma za novu kampanju i forma za izmjenu.
function campaignFields(c, recordings) {
  const value = (key) => h(c[key] ?? '');
  return `<label>Name<input name="name" maxlength="80" value="${value('name')}" placeholder="HardScope - R3born Episode 1" required></label>
    <label>Episode to clip from
      <select name="recording_id" required>
        <option value="">Choose a recording</option>
        ${recordings.map((r) => `<option value="${r.id}"${r.id === c.recording_id ? ' selected' : ''}>${h(r.name)} (${fmtTime(r.duration)})</option>`).join('')}
      </select>
    </label>
    <label>Hashtags for every post <span class="muted">(separated by spaces)</span><input name="hashtags" maxlength="200" value="${value('hashtags')}" placeholder="#r3born"></label>
    <div class="cap-style">
      <label>Tag on YouTube<input name="tag_youtube" maxlength="60" value="${value('tag_youtube')}" placeholder="@HardScopeTV"></label>
      <label>Tag on TikTok<input name="tag_tiktok" maxlength="60" value="${value('tag_tiktok')}" placeholder="@hardscope"></label>
      <label>Tag on Instagram<input name="tag_instagram" maxlength="60" value="${value('tag_instagram')}" placeholder="@hardscope"></label>
    </div>
    <label>Tag on X <span class="muted">(leave empty if the brief gives none)</span><input name="tag_x" maxlength="60" value="${value('tag_x')}"></label>
    <label>Banned words <span class="muted">(separated by commas; checked in the title, caption and captions in the video)</span><input name="banned" maxlength="300" value="${value('banned')}" placeholder="FaZe"></label>
    <label>Shortest allowed clip, in seconds<input type="number" name="min_seconds" min="1" max="180" step="1" value="${h(c.min_seconds ?? 7)}" required></label>`;
}

function campaignsPage(ctx, { campaigns, recordings }) {
  const rows = campaigns
    .map(
      (c) => `<li class="rec camp">
      <div class="rec-body">
        <div class="rec-head">
          <a class="rec-title" href="/clipping/${c.id}">${h(c.name)}</a>
          <a class="button" href="/clipping/${c.id}">Open</a>
        </div>
        ${meta(
          c.recording_name ? h(c.recording_name) : 'Episode missing',
          `${c.clips} ${c.clips === 1 ? 'clip' : 'clips'}`,
          `${c.posted} posted`,
          withPrefix(c.hashtags, '#').join(' ')
        )}
      </div>
    </li>`
    )
    .join('');
  const form = recordings.length
    ? `<form method="post" action="/clipping" class="stack">
      ${campaignFields({}, recordings)}
      <div><button class="primary">${icon('plus')}Create campaign</button></div>
    </form>`
    : emptyState('recordings', 'Add the episode first', 'Copy the episode you will clip from into your recordings folder and scan it. Then come back to set up the campaign.', '<a class="button" href="/recordings">Go to Recordings</a>');
  return layout(
    ctx,
    'Clipping',
    `<div class="page-head">
  <h1>Clipping</h1>
</div>
<p class="folder-hint lead">A campaign holds the rules of one brief: which episode to clip, the tags and hashtags every post needs, the words you must not use and the shortest clip allowed. Every clip you make in it is checked against those rules.</p>
${campaigns.length ? `<ul class="recs">${rows}</ul>` : ''}
<section class="card form-card camp-new">
  <h2>New campaign</h2>
  ${form}
</section>`
  );
}

// Transkript kao lista kratkih redova; red nosi vrijeme izvora, a već iskorišteni dijelovi su označeni.
function transcriptList(lines, used) {
  return `<ol class="tr-lines" id="tr-lines">${lines
    .map((l) => {
      const taken = used.some((u) => l.start < u.end && l.end > u.start);
      return `<li data-s="${l.start}" data-e="${l.end}"${taken ? ' class="is-used" title="Already used in a clip"' : ''}><button type="button" class="tr-time">${fmtTime(l.start)}</button><span>${h(l.text)}</span></li>`;
    })
    .join('')}</ol>`;
}

function campaignPage(ctx, { campaign, rec, transcript, lines, clips, recordings, prefill, problem, ffmpegOk }) {
  const used = clips.map((c) => ({ start: c.start_s, end: c.end_s }));
  let source;
  if (!rec) {
    source = `<section class="card">${emptyState('recordings', 'The episode is missing', 'The recording this campaign clips from is no longer in your library. Choose another one in the campaign rules below.')}</section>`;
  } else {
    const status = transcript ? transcript.status : 'none';
    let panel;
    if (status === 'ready') {
      panel = `<div class="tr-tools">
        <label class="tr-search">Search what is said<input type="search" id="tr-search" placeholder="Type a word or a phrase" autocomplete="off"></label>
        <span class="muted small" id="tr-count"></span>
      </div>
      <div class="tr-actions" id="tr-actions" hidden>
        <span class="muted small" id="tr-picked"></span>
        <div class="tl-group" role="group" aria-label="Use the selected line">
          <button type="button" data-tr="start">Start here</button>
          <button type="button" data-tr="end">End here</button>
          <button type="button" data-tr="hook">Use as hook</button>
        </div>
      </div>
      ${lines.length ? transcriptList(lines, used) : '<p class="muted">No speech was found in this episode, so there is nothing to search. Set the start and end from the player.</p>'}`;
    } else if (status === 'pending' || status === 'transcribing') {
      panel = `<p class="muted">Listening to the whole episode. A one-hour episode takes several minutes.</p>${progressBar(transcript.progress)}`;
    } else {
      panel = `${status === 'failed' ? `<p class="error">${h(transcript.error || 'The episode could not be transcribed.')}</p>` : ''}
      <p>Transcribe the episode once to search it by what is said, jump to any line, and get captions on every clip.</p>
      ${problem ? `<div class="notice warn"><strong>Transcription is not available yet.</strong> ${h(problem)}</div>` : ''}
      <form method="post" action="/clipping/${campaign.id}/transcribe"><button class="primary"${problem ? ' disabled' : ''}>${icon('captions')}${status === 'failed' ? 'Try again' : 'Transcribe the episode'}</button></form>`;
    }
    const busy = status === 'pending' || status === 'transcribing';
    source = `<div class="grid">
  <section class="card">
    <video class="player" id="clipping-player" src="/recordings/${rec.id}/file" controls preload="metadata"></video>
    <div id="live-transcript" data-live data-rev="${h(status)}" data-poll-key="transcript:${rec.id}" data-state="${h(status)}">
      ${panel}
      ${studioPoll(busy && ffmpegOk, '', '')}
    </div>
  </section>

  <section class="card">
    <h2>Make a clip</h2>
    <form method="post" action="/clipping/${campaign.id}/clips" class="stack" id="clipping-form" data-min="${campaign.min_seconds}" data-used="${h(JSON.stringify(used))}">
      <div class="row">
        <label>Start<input name="start" id="cl-start" placeholder="12:34" value="${h(prefill.start)}" required autocomplete="off"></label>
        <button type="button" data-cl-set="cl-start">Set from player</button>
      </div>
      <div class="row">
        <label>End<input name="end" id="cl-end" placeholder="12:52" value="${h(prefill.end)}" required autocomplete="off"></label>
        <button type="button" data-cl-set="cl-end">Set from player</button>
      </div>
      <p class="muted small" id="cl-summary" aria-live="polite"></p>

      <h2>Hook</h2>
      <p class="muted small">The strongest second or two of the scene, played first. Leave both fields empty and the app picks the loudest line, or switch that off for no hook.</p>
      <div class="cap-style cl-hook">
        <label>From<input name="hook_start" id="cl-hook-start" placeholder="12:47" autocomplete="off"></label>
        <label>To<input name="hook_end" id="cl-hook-end" placeholder="12:49" autocomplete="off"></label>
        <button type="button" data-cl-hook>2 s from player</button>
      </div>

      <label class="check"><input type="checkbox" name="auto_hook" value="1" data-remember="clip-autohook" checked> Pick the hook for me when the fields are empty</label>

      <h2>Edit</h2>
      <label class="check"><input type="checkbox" name="trim_silence" value="1" data-remember="clip-trim" checked> Cut out pauses in the talking</label>
      <label>Layout
        <select name="layout" data-remember="clip-layout">${LAYOUTS.map(([id, n]) => `<option value="${id}">${h(n)}</option>`).join('')}</select>
      </label>
      <label>Title <span class="muted">(optional)</span><input name="title" maxlength="100"></label>
      <p class="muted small">Captions come from the transcript and are drawn in the style you last saved on a captions page. The clip is vertical, 1080×1920.</p>
      <button class="primary big">${icon('split')}Create clip</button>
    </form>
  </section>
</div>`;
  }

  const tiles = clips
    .map((c) => {
      let frame;
      if (c.status === 'ready') {
        frame = `<a class="short-frame" href="/clipping/clips/${c.id}" title="Open “${h(c.title)}”">
        <video muted loop playsinline preload="none"${c.hasThumb ? ` poster="/clips/${c.id}/thumb"` : ''} src="/clips/${c.id}/file"></video>
        <span class="short-len">${fmtTime(c.length_s || 0)}</span>
      </a>`;
      } else if (c.status === 'failed') {
        frame = `<div class="short-frame is-failed"><p>${h(c.error || 'This clip could not be created.')}</p></div>`;
      } else {
        frame = `<div class="short-frame is-busy"><p>${c.status === 'rendering' ? 'Creating…' : 'Waiting its turn'}</p>${c.status === 'rendering' ? progressBar(c.progress) : ''}</div>`;
      }
      const issues = c.status === 'ready' ? checkClip(campaign, c).filter((k) => !k.ok).length : 0;
      const state =
        c.status !== 'ready'
          ? ''
          : issues
            ? `<span class="chip warn">${issues} ${issues === 1 ? 'thing' : 'things'} to fix</span>`
            : '<span class="chip ok">Ready to post</span>';
      return `<li class="short" data-poll-key="clip:${c.id}" data-state="${h(c.status)}">
      ${frame}
      <strong class="short-title">${h(c.title)}</strong>
      ${meta(state, c.posted ? `<span class="chip info">Posted on ${c.posted} of ${PLATFORMS.length}</span>` : '', `from ${fmtTime(c.start_s)}`)}
      <div class="short-actions">
        ${c.status === 'ready' ? `<a class="button primary" href="/clipping/clips/${c.id}">Check and post</a>` : ''}
        <form method="post" action="/clipping/clips/${c.id}/delete" data-confirm="Delete the clip “${h(c.title)}”? Its video file is deleted too."><button class="danger-outline">${icon('trash')}Delete</button></form>
      </div>
    </li>`;
    })
    .join('');
  const clipsBusy = clips.some((c) => c.status === 'pending' || c.status === 'rendering');

  return layout(
    ctx,
    campaign.name,
    `<div class="page-head">
  <div class="head-title">${crumb('/clipping', 'Clipping')}<h1>${h(campaign.name)}</h1></div>
  <div class="head-actions">
    ${menu(
      'More actions for this campaign',
      `<form method="post" action="/clipping/${campaign.id}/delete" data-confirm="Delete the campaign “${h(campaign.name)}”? Its ${clips.length} ${clips.length === 1 ? 'clip is' : 'clips are'} deleted too. The episode stays in your recordings."><button class="danger-outline">${icon('trash')}Delete campaign</button></form>`,
      'drop-down'
    )}
  </div>
</div>
${rec ? meta(h(rec.name), fmtTime(rec.duration), `shortest clip ${campaign.min_seconds} s`, withPrefix(campaign.hashtags, '#').join(' '), bannedList(campaign).length ? `never say: ${h(bannedList(campaign).join(', '))}` : '').replace('class="meta"', 'class="meta camp-rules"') : ''}
${source}
${
  rec
    ? `<section class="card cl-suggest">
  <h2>Suggest clips</h2>
  <p class="muted small">The app picks the loudest, most talkative scenes of the episode and cuts each on sentence ends. You look through them and choose which become clips. Scenes already in your clips are skipped. Transcribe the episode first.</p>
  <form method="get" action="/clipping/${campaign.id}/suggest" class="cl-suggest-form">
    <label>How many
      <select name="count" data-remember="suggest-count">${[5, 10, 15, 20].map((n) => `<option value="${n}"${n === 10 ? ' selected' : ''}>${n} clips</option>`).join('')}</select>
    </label>
    <label>Length of each
      <select name="length" data-remember="suggest-length">${[15, 30, 45].map((n) => `<option value="${n}"${n === 30 ? ' selected' : ''}>About ${n} s</option>`).join('')}</select>
    </label>
    <button class="primary">${icon('split')}Find scenes</button>
  </form>
</section>`
    : ''
}

<div id="live-clips" data-live>
  <div class="list-head">
    <h2>Clips in this campaign</h2>
    ${clipsBusy ? `<form method="post" action="/clipping/${campaign.id}/cancel" data-confirm="Stop creating clips? Unfinished clips are removed. Finished clips stay."><button class="danger-outline">Stop creating clips</button></form>` : ''}
  </div>
  ${clips.length ? `<ul class="shorts">${tiles}</ul>` : emptyState('shorts', 'No clips yet', 'Pick a scene above and select “Create clip”. Each clip is checked against the campaign rules before you post it.')}
  ${studioPoll(clipsBusy && ffmpegOk, '', 'clip')}
</div>

<details class="card camp-edit">
  <summary>Campaign rules</summary>
  <form method="post" action="/clipping/${campaign.id}" class="stack">
    ${campaignFields(campaign, recordings)}
    <div><button class="primary">Save rules</button></div>
  </form>
</details>`
  );
}

// Pregled predloženih scena: korisnik ih presluša, odznači slabe i tek tada nastaju klipovi.
function suggestPage(ctx, { campaign, rec, scenes, count, target, ffmpegOk }) {
  const rows = scenes
    .map(
      (s, i) => `<li class="sg-row">
      <label class="sg-pick"><input type="checkbox" name="scene" value="${s.start}-${s.end}" checked aria-label="Make a clip of scene ${i + 1}"></label>
      <div class="sg-body">
        <div class="sg-head">
          <strong>${fmtTime(s.start)} to ${fmtTime(s.end)}</strong>
          <span class="muted small">${(s.end - s.start).toFixed(1)} s</span>
          <button type="button" data-scene-play="${s.start}" data-scene-end="${s.end}">Play</button>
        </div>
        <p class="sg-said">${h(s.said)}</p>
        ${s.hook ? `<p class="muted small sg-hook"><button type="button" class="link" data-scene-play="${s.hook.start}" data-scene-end="${s.hook.end}">Hook</button> “${h(s.hookSaid)}”</p>` : '<p class="muted small sg-hook">No line stands out as a hook.</p>'}
      </div>
    </li>`
    )
    .join('');
  return layout(
    ctx,
    'Suggested scenes',
    `<div class="page-head">
  <div class="head-title">${crumb(`/clipping/${campaign.id}`, h(campaign.name))}<h1>Suggested scenes</h1></div>
</div>
<p class="folder-hint lead">${scenes.length} ${scenes.length === 1 ? 'scene' : 'scenes'} of about ${target} s${scenes.length < count ? ` (you asked for ${count}; no more of this length were free)` : ''}. They are chosen by loudness and how much is said, so listen to each and untick the weak ones. Nothing is created until you select the button.</p>
<div class="grid">
  <section class="card sg-player">
    <video class="player" id="suggest-player" src="/recordings/${rec.id}/file" controls preload="metadata"></video>
  </section>
  <section class="card">
    <form method="post" action="/clipping/${campaign.id}/suggest" class="stack" id="suggest-form">
      <ol class="sg-list">${rows}</ol>
      <h2>For every clip</h2>
      <label class="check"><input type="checkbox" name="auto_hook" value="1" data-remember="clip-autohook" checked> Open with the hook shown under each scene</label>
      <label class="check"><input type="checkbox" name="trim_silence" value="1" data-remember="clip-trim" checked> Cut out pauses in the talking</label>
      <label>Layout
        <select name="layout" data-remember="clip-layout">${LAYOUTS.map(([id, n]) => `<option value="${id}">${h(n)}</option>`).join('')}</select>
      </label>
      ${ffmpegOk ? '' : '<div class="notice warn">ffmpeg is not installed, so clips cannot be created yet.</div>'}
      <button class="primary big" id="suggest-submit"${ffmpegOk ? '' : ' disabled'}>${icon('split')}<span>Create ${scenes.length} ${scenes.length === 1 ? 'clip' : 'clips'}</span></button>
    </form>
  </section>
</div>`
  );
}

function clipPage(ctx, { campaign, clip, posts, lines, canEdit }) {
  const edl = JSON.parse(clip.edl);
  const hook = edl.find((p) => p.hook);
  const scene = edl.filter((p) => !p.hook);
  const trimmed = !(scene.length === 1 && scene[0].start === clip.start_s && scene[0].end === clip.end_s);
  const checks = checkClip(campaign, clip);
  const problems = checks.filter((c) => !c.ok).length;
  const postOf = (platform) => posts.find((p) => p.platform === platform) || {};
  const blocks = PLATFORMS.map(([id, name]) => {
    const post = postOf(id);
    return `<div class="post-block${post.posted_at ? ' is-posted' : ''}">
      <div class="post-head">
        <strong>${name}</strong>
        ${post.posted_at ? '<span class="chip ok">Posted</span>' : ''}
        <button type="button" data-copy="post-${id}">Copy</button>
      </div>
      <textarea id="post-${id}" rows="2" readonly>${h(platformCaption(campaign, clip, id))}</textarea>
      <div class="row">
        <label>Link to your post <span class="muted">(optional)</span><input name="url_${id}" type="url" maxlength="300" value="${h(post.url || '')}" placeholder="https://"></label>
        <label class="check post-check"><input type="checkbox" name="posted_${id}" value="1"${post.posted_at ? ' checked' : ''}> Posted</label>
      </div>
    </div>`;
  }).join('');

  return layout(
    ctx,
    clip.title,
    `<div class="page-head">
  <div class="head-title">${crumb(`/clipping/${campaign.id}`, h(campaign.name))}<h1>${h(clip.title)}</h1></div>
  <div class="head-actions">
    <a class="button primary" href="/clips/${clip.id}/file?download=1">${icon('download')}Download</a>
    ${menu(
      'More actions for this clip',
      `<a href="/clipping/${campaign.id}?start=${fmtExact(clip.start_s)}&end=${fmtExact(clip.end_s)}">${icon('split')}Make a variation</a>
      <hr>
      <form method="post" action="/clipping/clips/${clip.id}/delete" data-confirm="Delete the clip “${h(clip.title)}”? Its video file is deleted too."><button class="danger-outline">${icon('trash')}Delete</button></form>`,
      'drop-down'
    )}
  </div>
</div>
<div class="cap-layout">
  <section class="card">
    <video class="kit-video" id="clip-player" src="/clips/${clip.id}/file?v=${clip.size}" poster="/clips/${clip.id}/thumb?v=${clip.size}" controls preload="none" playsinline></video>
    ${meta(`${(clip.length_s || 0).toFixed(1)} s`, fmtSize(clip.size), `from ${fmtTime(clip.start_s)} to ${fmtTime(clip.end_s)}`, hook ? `hook from ${fmtTime(hook.start)}` : 'no hook')}
    <details class="clip-edit">
      <summary>Edit this clip</summary>
      ${
        canEdit
          ? `<form method="post" action="/clipping/clips/${clip.id}/edit" class="stack">
        <p class="muted small">Times are positions in the episode. Saving creates the clip again; your caption and posts stay.</p>
        <div class="cap-style">
          <label>Start<input name="start" value="${fmtFine(clip.start_s)}" required autocomplete="off"></label>
          <label>End<input name="end" value="${fmtFine(clip.end_s)}" required autocomplete="off"></label>
        </div>
        <div class="cap-style">
          <label>Hook from<input name="hook_start" value="${hook ? fmtFine(hook.start) : ''}" autocomplete="off"></label>
          <label>Hook to<input name="hook_end" value="${hook ? fmtFine(hook.end) : ''}" autocomplete="off"></label>
        </div>
        <label class="check"><input type="checkbox" name="trim_silence" value="1"${trimmed ? ' checked' : ''}> Cut out pauses in the talking</label>
        <label>Layout
          <select name="layout">${LAYOUTS.map(([id, n]) => `<option value="${id}"${id === clip.layout ? ' selected' : ''}>${h(n)}</option>`).join('')}</select>
        </label>
        ${
          lines.length
            ? `<h3>Captions</h3>
        <p class="muted small">Fix words that were heard wrong; empty a line to remove it. If you change the times above, the captions are taken from the transcript again and these fixes are lost.</p>
        <ol class="cap-fix">${lines.map((l, i) => `<li><span class="muted small">${fmtTime(l.start)}</span><input name="line_${i}" value="${h(l.text)}" maxlength="200" data-seek="${l.start}" aria-label="Caption at ${fmtTime(l.start)}"></li>`).join('')}</ol>`
            : ''
        }
        <div><button class="primary">${icon('split')}Save and create again</button></div>
      </form>`
          : '<p class="muted small">This clip cannot be changed: its episode is no longer in your recordings, or ffmpeg is missing.</p>'
      }
    </details>
  </section>
  <section class="card">
    <h2>Campaign rules ${problems ? `<span class="chip warn">${problems} to fix</span>` : '<span class="chip ok">All passed</span>'}</h2>
    <ul class="checks">${checks
      .map((c) => `<li class="${c.ok ? 'is-ok' : 'is-bad'}"><span class="check-mark" aria-hidden="true">${c.ok ? '✓' : '!'}</span><div><strong>${h(c.label)}</strong><p class="muted small">${h(c.detail)}</p></div></li>`)
      .join('')}</ul>
    <p class="muted small">The tags and hashtags of the campaign are added to every text below, so they cannot be forgotten. What the app cannot check: that the footage is from the right episode, that the clip is not posted to another campaign, and that the caption is fair to the show.</p>

    <form method="post" action="/clipping/clips/${clip.id}" class="stack">
      <h2>Caption</h2>
      <label>Title<input name="title" maxlength="100" value="${h(clip.title)}" required></label>
      <label>What happens on screen <span class="muted">(short, in your own words)</span>
        <textarea name="caption" rows="2" maxlength="300" placeholder="he really thought that was a warm-up">${h(clip.caption || '')}</textarea>
      </label>

      <h2>Post it</h2>
      <p class="muted small">Copy the text for each platform, post the downloaded clip there yourself, then tick it off here.</p>
      ${blocks}
      <div><button class="primary">Save</button></div>
    </form>
  </section>
</div>`
  );
}

module.exports = { campaignsPage, campaignPage, suggestPage, clipPage, fmtExact, fmtFine };

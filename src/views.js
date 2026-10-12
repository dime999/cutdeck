'use strict';
// HTML šabloni. Sve vrijednosti od korisnika prolaze kroz h() (escape).
const cfg = require('./lib/config');
const { CATEGORIES } = require('./lib/youtube');
const { LAYOUTS } = require('./lib/media');

const h = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const YT_TOS = 'https://www.youtube.com/t/terms';
const GOOGLE_PRIVACY = 'https://policies.google.com/privacy';
const GOOGLE_PERMISSIONS = 'https://myaccount.google.com/connections';

function layout(ctx, title, body) {
  const user = ctx.user;
  const nav = (href, label) =>
    `<a href="${href}" class="${ctx.path.startsWith(href) ? 'active' : ''}">${label}</a>`;
  const flash = ctx.flash
    ? `<div class="flash ${h(ctx.flash.type)}" role="status">${h(ctx.flash.msg)}</div>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(title)} · ${h(cfg.appName)}</title>
<link rel="stylesheet" href="/static/style.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>▶</text></svg>">
</head>
<body>
<header class="top">
  <a class="brand" href="/">${h(cfg.appName)}</a>
  ${
    user
      ? `<nav>${nav('/upload', 'New video')}${nav('/dashboard', 'Posts')}${nav('/recordings', 'Recordings')}${nav('/shorts', 'Shorts')}${nav('/accounts', 'Channels')}</nav>
         <form method="post" action="/logout" class="logout"><span class="who">${h(user.name)}</span><button class="link">Log out</button></form>`
      : ''
  }
</header>
<main>
${flash}
${body}
</main>
<footer class="foot">
  <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a>
</footer>
<script src="/static/app.js" defer></script>
</body>
</html>`;
}

// ── Prijava i registracija ─────────────────────────────────
function loginPage(ctx, { email = '', error = '' } = {}) {
  return layout(
    ctx,
    'Log in',
    `<section class="card narrow">
  <h1>Log in</h1>
  ${error ? `<p class="error">${h(error)}</p>` : ''}
  <form method="post" action="/login" class="stack">
    <label>Email<input type="email" name="email" value="${h(email)}" required autofocus autocomplete="email"></label>
    <label>Password<input type="password" name="password" required autocomplete="current-password"></label>
    <button class="primary">Log in</button>
  </form>
  <p class="muted">Don't have an account? <a href="/register">Sign up</a></p>
</section>`
  );
}

function registerPage(ctx, { values = {}, error = '', needsInvite = true } = {}) {
  return layout(
    ctx,
    'Sign up',
    `<section class="card narrow">
  <h1>Sign up</h1>
  ${error ? `<p class="error">${h(error)}</p>` : ''}
  <form method="post" action="/register" class="stack">
    <label>Name<input name="name" value="${h(values.name)}" required maxlength="60" autocomplete="name"></label>
    <label>Email<input type="email" name="email" value="${h(values.email)}" required autocomplete="email"></label>
    <label>Password <span class="muted">(at least 8 characters)</span><input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
    ${needsInvite ? `<label>Invite code<input name="invite" value="${h(values.invite)}" required></label>` : ''}
    <button class="primary">Create account</button>
  </form>
  <p class="muted">Already have an account? <a href="/login">Log in</a></p>
</section>`
  );
}

// ── Kanali ────────────────────────────────────────────────
function accountsPage(ctx, { accounts, configured }) {
  const rows = accounts
    .map(
      (a) => `<li class="account">
    ${a.thumbnail ? `<img src="${h(a.thumbnail)}" alt="" width="40" height="40">` : '<span class="avatar"></span>'}
    <div class="grow">
      <strong>${h(a.name)}</strong>
      <span class="muted small">YouTube · connected <time data-local="${h(a.created_at)}">${h(a.created_at)}</time></span>
    </div>
    ${
      a.status === 'active'
        ? '<span class="chip ok">Active</span>'
        : `<span class="chip warn">Needs reconnecting</span><a class="button" href="/oauth/youtube/start">Reconnect</a>`
    }
    <form method="post" action="/accounts/${a.id}/disconnect" data-confirm="Disconnect the channel “${h(a.name)}”? The app will lose access to this channel.">
      <button class="danger-outline">Disconnect</button>
    </form>
  </li>`
    )
    .join('');

  return layout(
    ctx,
    'Channels',
    `<div class="page-head">
  <h1>Connected channels</h1>
  ${configured ? '<a class="button primary" href="/oauth/youtube/start">+ Connect YouTube channel</a>' : ''}
</div>
${
  configured
    ? ''
    : `<div class="notice warn"><strong>Google access is not configured.</strong> Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in <code>.env</code> and restart the app (see README, step 1).</div>`
}
${
  accounts.length
    ? `<ul class="list">${rows}</ul>`
    : '<div class="empty">No channels connected yet.</div>'
}
<div class="notice">
  <p><strong>Several channels on one Google account?</strong> Click “Connect YouTube channel” once for each channel and pick the channel you want (brand account) on Google's screen.</p>
  <p>You can also revoke access directly in your <a href="${GOOGLE_PERMISSIONS}" target="_blank" rel="noopener">Google Account settings</a>.</p>
  ${
    cfg.ytAudited
      ? ''
      : '<p><strong>Note:</strong> until Google approves the audit, the sign-in expires after 7 days and the channel has to be reconnected.</p>'
  }
</div>`
  );
}

// ── Novi video ────────────────────────────────────────────
function uploadPage(ctx, { accounts, preset = null, title = '' }) {
  const active = accounts.filter((a) => a.status === 'active');
  const channelList = active
    .map(
      (a) => `<label class="channel">
      <input type="checkbox" name="accounts" value="${a.id}">
      ${a.thumbnail ? `<img src="${h(a.thumbnail)}" alt="" width="28" height="28">` : '<span class="avatar sm"></span>'}
      <span>${h(a.name)}</span>
    </label>`
    )
    .join('');

  const auditBanner = cfg.ytAudited
    ? ''
    : `<div class="notice warn"><strong>This project has not passed the Google audit yet.</strong> YouTube will lock every video as private, whatever you choose below. Use a test channel until the audit is approved.</div>`;

  if (!active.length) {
    return layout(
      ctx,
      'New video',
      `<h1>New video</h1>${auditBanner}
<div class="empty">Connect at least one channel first. <a class="button primary" href="/accounts">Go to Channels</a></div>`
    );
  }

  return layout(
    ctx,
    'New video',
    `<h1>New video</h1>
${auditBanner}
<form id="upload-form" class="grid" novalidate>
  <section class="card">
    <h2>1. Video</h2>
    <label class="drop${preset ? ' has-file' : ''}" id="drop">
      <input type="file" name="file" id="file" accept="video/*"${preset ? '' : ' required'}>
      <span id="drop-text">${
        preset
          ? `<strong>${h(preset.original_name)}</strong> · ${fmtSize(preset.size)}`
          : '<strong>Choose a video</strong> or drag it here'
      }</span>
    </label>
    ${preset ? `<input type="hidden" id="preset-file" value="${h(preset.id)}">` : ''}

    <h2>2. Details</h2>
    <label>Title <span class="counter" data-for="title" data-max="100"></span>
      <input name="title" id="title" maxlength="100" value="${h(preset ? title : '')}" required>
    </label>
    <label>Description <span class="counter" data-for="description" data-max="5000"></span>
      <textarea name="description" id="description" rows="6" maxlength="5000"></textarea>
    </label>
    <label>Tags <span class="muted">(comma-separated)</span>
      <input name="tags" placeholder="e.g. vlog, travel, sarajevo">
    </label>
    <label>Category
      <select name="category">${CATEGORIES.map(([id, n]) => `<option value="${id}">${h(n)}</option>`).join('')}</select>
    </label>

    <fieldset>
      <legend>Visibility</legend>
      <label class="radio"><input type="radio" name="privacy" value="public" required> <span><strong>Public</strong> – everyone can watch</span></label>
      <label class="radio"><input type="radio" name="privacy" value="unlisted"> <span><strong>Unlisted</strong> – only people with the link</span></label>
      <label class="radio"><input type="radio" name="privacy" value="private"> <span><strong>Private</strong> – only you</span></label>
    </fieldset>

    <fieldset>
      <legend>Is this video made for kids?</legend>
      <label class="radio"><input type="radio" name="made_for_kids" value="no" required> <span>No, it's not made for kids</span></label>
      <label class="radio"><input type="radio" name="made_for_kids" value="yes"> <span>Yes, it's made for kids</span></label>
      <p class="muted small">This is required by law (COPPA) and by YouTube's rules.</p>
    </fieldset>

    <details>
      <summary>Schedule (optional)</summary>
      <label>Publish date and time
        <input type="datetime-local" name="schedule" id="schedule">
      </label>
      <p class="muted small">The video is uploaded right away as private and becomes public automatically at the set time. To schedule, choose “Public”.</p>
    </details>
  </section>

  <section class="card">
    <h2>3. Channels</h2>
    <label class="channel all"><input type="checkbox" id="select-all"> <span>Select all (${active.length})</span></label>
    <div class="channels">${channelList}</div>

    <p class="legal">
      By publishing you confirm that you accept the <a href="${YT_TOS}" target="_blank" rel="noopener">YouTube Terms of Service</a>
      and that Google data is processed under the <a href="${GOOGLE_PRIVACY}" target="_blank" rel="noopener">Google Privacy Policy</a>.
      The video is published only to the channels you selected.
    </p>

    <p class="error" id="form-error" hidden></p>
    <div class="progress" id="progress" hidden><div class="bar"></div><span class="label"></span></div>
    <button class="primary big" id="submit">Publish to selected channels</button>
  </section>
</form>`
  );
}

// ── Objave ────────────────────────────────────────────────
const STATUS = {
  pending: ['Pending', 'muted'],
  uploading: ['Uploading', 'info'],
  done: ['Published', 'ok'],
  failed: ['Failed', 'bad'],
};
const PRIVACY = { public: 'Public', unlisted: 'Unlisted', private: 'Private' };

function fmtSize(bytes) {
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function dashboardPage(ctx, { videos, uploadsToday }) {
  const active = videos.some((v) => v.jobs.some((j) => j.status === 'uploading' || j.status === 'pending'));

  const cards = videos
    .map((v) => {
      const busy = v.jobs.some((j) => j.status === 'uploading');
      const jobs = v.jobs
        .map((j) => {
          const [label, cls] = STATUS[j.status] || [j.status, 'muted'];
          return `<li class="job">
          <div class="grow">
            <strong>${h(j.account_name)}</strong>
            ${j.status === 'uploading' ? `<div class="progress small"><div class="bar" style="width:${j.progress}%"></div><span class="label">${j.progress}%</span></div>` : ''}
            ${j.error ? `<p class="small ${j.status === 'failed' ? 'error' : 'muted'}">${h(j.error)}</p>` : ''}
          </div>
          <span class="chip ${cls}">${label}</span>
          ${j.external_url ? `<a class="button" href="${h(j.external_url)}" target="_blank" rel="noopener">Open</a>` : ''}
          ${
            j.status === 'failed'
              ? `<form method="post" action="/jobs/${j.id}/retry"><button>Retry</button></form>`
              : ''
          }
        </li>`;
        })
        .join('');
      const done = v.jobs.filter((j) => j.status === 'done').length;
      return `<article class="card video">
      <div class="video-head">
        <div class="grow">
          <h2>${h(v.title)}</h2>
          <p class="muted small">
            ${PRIVACY[v.privacy] || h(v.privacy)}
            ${v.publish_at ? ` · scheduled for <time data-local="${h(v.publish_at)}">${h(v.publish_at)}</time>` : ''}
            · ${fmtSize(v.size)} · <time data-local="${h(v.created_at)}">${h(v.created_at)}</time>
            · ${done}/${v.jobs.length} published
          </p>
        </div>
        ${
          busy
            ? ''
            : `<form method="post" action="/videos/${v.id}/delete" data-confirm="Delete this record from the app? Videos already on YouTube stay there."><button class="danger-outline">Delete record</button></form>`
        }
      </div>
      <ul class="jobs">${jobs}</ul>
    </article>`;
    })
    .join('');

  return layout(
    ctx,
    'Posts',
    `<div class="page-head">
  <h1>Posts</h1>
  <a class="button primary" href="/upload">+ New video</a>
</div>
<p class="muted small quota">Uploads today (the Google quota resets at midnight Pacific Time): <strong>${uploadsToday}</strong> / ~100</p>
${videos.length ? cards : '<div class="empty">No posts yet. <a href="/upload">Publish your first video</a></div>'}
${active ? '<div data-autorefresh="4000" hidden></div>' : ''}`
  );
}

// ── Snimci i Shorts ───────────────────────────────────────
const REC_STATUS = {
  pending: ['Waiting for analysis', 'muted'],
  analyzing: ['Analyzing', 'info'],
  ready: ['Ready', 'ok'],
  failed: ['Analysis failed', 'bad'],
};
function fmtTime(seconds) {
  const s = Math.floor(seconds);
  const mmss = `${String(Math.floor((s % 3600) / 60)).padStart(s >= 3600 ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mmss}` : mmss;
}

const progressBar = (pct) =>
  `<div class="progress small"><div class="bar" style="width:${pct}%"></div><span class="label">${pct}%</span></div>`;

const ffmpegNotice = (ok) =>
  ok
    ? ''
    : `<div class="notice warn"><strong>ffmpeg is not installed.</strong> The app needs it to analyze recordings and cut Shorts. Install it (on Windows: <code>winget install Gyan.FFmpeg</code>), then restart the app.</div>`;

// Element koji uključuje osvježavanje stanja dok neki posao traje.
const studioPoll = (busy, recordingId = '') => (busy ? `<div data-studio-poll="${recordingId}" hidden></div>` : '');

const meta = (...parts) => `<p class="meta">${parts.filter(Boolean).map((p) => `<span>${p}</span>`).join('')}</p>`;

/**
 * Vremenska traka snimka: stubići glasnoće, predloženi trenuci i već izrezani Shorts.
 * U interaktivnoj varijanti trenuci su dugmad, a traka ima playhead i okvir izbora.
 */
function timeline(rec, moments, { clips = [], interactive = false } = {}) {
  const wave = JSON.parse(rec.waveform || '[]');
  const duration = rec.duration || 1;
  const span = (from, to) => `left:${((from / duration) * 100).toFixed(3)}%;width:${(((to - from) / duration) * 100).toFixed(3)}%`;
  const bars = wave.map((v, i) => `M${i} 100v-${Math.max(2, v)}h.72v${Math.max(2, v)}z`).join('');
  const marks = moments
    .map((m) => {
      const range = `${fmtTime(m.start_s)} – ${fmtTime(m.end_s)}`;
      return interactive
        ? `<button type="button" class="tl-mark" style="${span(m.start_s, m.end_s)}" data-pick data-start="${m.start_s}" data-end="${m.end_s}" title="${range}" aria-label="Preview and use ${range}"></button>`
        : `<span class="tl-mark" style="${span(m.start_s, m.end_s)}"></span>`;
    })
    .join('');
  const made = clips
    .filter((c) => c.status === 'ready')
    .map((c) => `<span class="tl-made" style="${span(c.start_s, c.end_s)}" title="Short: ${h(c.title)}"></span>`)
    .join('');
  return `<div class="tl${interactive ? ' tl-live' : ''}"${interactive ? ` id="timeline" data-duration="${duration}"` : ''}>
    <svg class="tl-wave" viewBox="0 0 ${Math.max(1, wave.length)} 100" preserveAspectRatio="none" aria-hidden="true"><path d="${bars}"/></svg>
    ${marks}${made}
    ${interactive ? '<span class="tl-selection" id="tl-selection" hidden></span><span class="tl-playhead" id="tl-playhead"></span>' : ''}
  </div>`;
}

function shortTiles(clips, { from = '' } = {}) {
  const tiles = clips
    .map((c) => {
      let frame;
      if (c.status === 'ready') {
        frame = `<a class="short-frame" href="/clips/${c.id}/file" target="_blank" rel="noopener" title="Watch “${h(c.title)}”">
        <video muted loop playsinline preload="none"${c.hasThumb ? ` poster="/clips/${c.id}/thumb"` : ''} src="/clips/${c.id}/file"></video>
        <span class="short-len">${fmtTime(c.end_s - c.start_s)}</span>
      </a>`;
      } else if (c.status === 'failed') {
        frame = `<div class="short-frame is-failed"><p>${h(c.error || 'This Short could not be created.')}</p></div>`;
      } else {
        frame = `<div class="short-frame is-busy"><p>${c.status === 'rendering' ? 'Creating…' : 'Waiting its turn'}</p>${c.status === 'rendering' ? progressBar(c.progress) : ''}</div>`;
      }
      return `<li class="short" data-poll-key="clip:${c.id}" data-state="${h(c.status)}">
      ${frame}
      <strong class="short-title">${h(c.title)}</strong>
      ${meta(`${h(c.recording_name)} at ${fmtTime(c.start_s)}`, c.size ? fmtSize(c.size) : '')}
      <div class="short-actions">
        ${
          c.status === 'ready'
            ? `<form method="post" action="/clips/${c.id}/publish"><button class="primary">Publish</button></form>
               <a class="button" href="/clips/${c.id}/file?download=1">Download</a>`
            : ''
        }
        ${
          c.status === 'rendering'
            ? ''
            : `<form method="post" action="/clips/${c.id}/delete${from ? `?from=${from}` : ''}" data-confirm="Delete the Short “${h(c.title)}”? Its video file will be deleted too."><button class="danger-outline">Delete</button></form>`
        }
      </div>
    </li>`;
    })
    .join('');
  return `<ul class="shorts">${tiles}</ul>`;
}

function recordingsPage(ctx, { recordings, ffmpegOk, folder }) {
  const rows = recordings
    .map((r) => {
      const [label, cls] = REC_STATUS[r.status] || [r.status, 'muted'];
      let state;
      if (r.status === 'ready') {
        state = timeline(r, r.moments);
      } else if (r.status === 'failed') {
        state = `<p class="small error">${h(r.error || 'The analysis failed.')}</p>`;
      } else {
        state = `<p class="small muted">${r.status === 'analyzing' ? 'Listening for the loudest moments…' : 'Waiting to be analyzed.'}</p>${r.status === 'analyzing' ? progressBar(r.progress) : ''}`;
      }
      const found = r.moments.length === 1 ? '1 loud moment found' : `${r.moments.length} loud moments found`;
      return `<li class="rec" data-poll-key="rec:${r.id}" data-state="${h(r.status)}">
      <a class="rec-thumb" href="/recordings/${r.id}" tabindex="-1" aria-hidden="true">
        ${r.hasThumb ? `<img src="/recordings/${r.id}/thumb" alt="" loading="lazy">` : ''}
        ${r.duration ? `<span class="rec-len">${fmtTime(r.duration)}</span>` : ''}
      </a>
      <div class="rec-body">
        <div class="rec-head">
          <a class="rec-title" href="/recordings/${r.id}">${h(r.name)}</a>
          ${r.status === 'ready' ? '' : `<span class="chip ${cls}">${label}</span>`}
          ${
            r.status === 'analyzing'
              ? ''
              : `<form method="post" action="/recordings/${r.id}/remove" data-confirm="Remove “${h(r.name)}” from the list? The file stays on disk."><button class="danger-outline">Remove</button></form>`
          }
        </div>
        ${meta(
          r.status === 'ready' ? found : '',
          r.width ? `${r.width}×${r.height}` : '',
          fmtSize(r.size),
          `added <time data-local="${h(r.created_at)}">${h(r.created_at)}</time>`
        )}
        ${state}
      </div>
    </li>`;
    })
    .join('');
  const busy = recordings.some((r) => r.status === 'pending' || r.status === 'analyzing');

  return layout(
    ctx,
    'Recordings',
    `<div class="page-head">
  <h1>Recordings</h1>
  <form method="post" action="/recordings/scan"><button class="primary">Scan folder</button></form>
</div>
${ffmpegNotice(ffmpegOk)}
<div id="live-recordings" data-live>
${
  recordings.length
    ? `<ul class="recs">${rows}</ul>`
    : `<div class="empty">Copy a gameplay recording into the folder below, then select “Scan folder”.</div>`
}
${studioPoll(busy && ffmpegOk)}
</div>
<p class="folder-hint">Recordings folder: <code>${h(folder)}</code>. Subfolders are scanned too. Highlighted ranges on each timeline are the loudest 30 seconds of the recording.</p>`
  );
}

function recordingPage(ctx, { rec, moments, clips, ffmpegOk }) {
  const [label, cls] = REC_STATUS[rec.status] || [rec.status, 'muted'];
  let analysis;
  if (rec.status === 'pending' || rec.status === 'analyzing') {
    analysis = `<p class="muted">Listening to the recording to find its loudest moments…</p>${progressBar(rec.progress)}`;
  } else if (rec.status === 'failed') {
    analysis = `<p class="error">${h(rec.error || 'The analysis failed.')}</p>
<form method="post" action="/recordings/${rec.id}/analyze"><button>Analyze again</button></form>`;
  } else {
    const quarter = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span>${fmtTime(rec.duration * f)}</span>`).join('');
    analysis = `${timeline(rec, moments, { clips, interactive: true })}
<div class="tl-scale" aria-hidden="true">${quarter}</div>
${
  moments.length
    ? `<p class="small muted">Highlighted ranges are the loudest moments. Select one to watch it and load it into the form.</p>
<ul class="moments">${moments
        .map(
          (m) =>
            `<li><button type="button" class="moment" data-pick data-start="${m.start_s}" data-end="${m.end_s}" title="Loudness ${m.score}% of the loudest moment">${fmtTime(m.start_s)} – ${fmtTime(m.end_s)}</button></li>`
        )
        .join('')}</ul>`
    : `<p class="small muted">${h(rec.error || 'No moment stands out in this recording. Play it and set the start and end yourself.')}</p>`
}`;
  }
  const busy = rec.status === 'pending' || rec.status === 'analyzing' || clips.some((c) => c.status === 'pending' || c.status === 'rendering');

  return layout(
    ctx,
    rec.name,
    `<div class="page-head">
  <h1>${h(rec.name)}</h1>
  <a class="button" href="/recordings">All recordings</a>
</div>
${ffmpegNotice(ffmpegOk)}
<div class="grid">
  <section class="card">
    <video class="player" id="player" src="/recordings/${rec.id}/file"${rec.hasThumb ? ` poster="/recordings/${rec.id}/thumb"` : ''} controls preload="metadata"></video>
    <div id="live-moments" data-live data-poll-key="rec:${rec.id}" data-state="${h(rec.status)}">
      ${rec.status === 'ready' ? '' : `<p><span class="chip ${cls}">${label}</span></p>`}
      ${analysis}
    </div>
  </section>

  <section class="card">
    <h2>Create a Short</h2>
    <form method="post" action="/recordings/${rec.id}/clips" class="stack">
      <div class="row">
        <label>Start<input name="start" id="clip-start" placeholder="12:34" required autocomplete="off"></label>
        <button type="button" data-set="clip-start">Set from player</button>
      </div>
      <div class="row">
        <label>End<input name="end" id="clip-end" placeholder="13:04" required autocomplete="off"></label>
        <button type="button" data-set="clip-end">Set from player</button>
      </div>
      <label>Layout
        <select name="layout">${LAYOUTS.map(([id, n]) => `<option value="${id}">${h(n)}</option>`).join('')}</select>
      </label>
      <label>Title <span class="muted">(optional)</span><input name="title" maxlength="100"></label>
      <p class="muted small">3 to 180 seconds. The result is a vertical 1080×1920 video.</p>
      <button class="primary big">Create Short</button>
    </form>
  </section>
</div>

<div id="live-clips" data-live>
  <h2>Shorts from this recording</h2>
  ${clips.length ? shortTiles(clips, { from: 'recording' }) : '<div class="empty">Pick a moment above and select “Create Short”.</div>'}
  ${studioPoll(busy && ffmpegOk, rec.id)}
</div>`
  );
}

function shortsPage(ctx, { clips, ffmpegOk }) {
  const busy = clips.some((c) => c.status === 'pending' || c.status === 'rendering');
  return layout(
    ctx,
    'Shorts',
    `<div class="page-head">
  <h1>Shorts</h1>
  <a class="button primary" href="/recordings">Create from a recording</a>
</div>
${ffmpegNotice(ffmpegOk)}
<div id="live-clips" data-live>
${clips.length ? shortTiles(clips) : '<div class="empty">Open a recording, pick a moment and create your first Short.</div>'}
${studioPoll(busy && ffmpegOk)}
</div>`
  );
}

// ── Pravne stranice (trebaju za Google audit) ──────────────
function privacyPage(ctx) {
  const contact = cfg.contactEmail ? `<a href="mailto:${h(cfg.contactEmail)}">${h(cfg.contactEmail)}</a>` : 'the app administrator';
  return layout(
    ctx,
    'Privacy Policy',
    `<article class="card prose">
<h1>Privacy Policy</h1>
<p class="muted">Last updated: October 12, 2026.</p>

<p>${h(cfg.appName)} is an app that lets users publish one video to several of their YouTube channels at once. This policy explains what data the app uses and why.</p>

<h2>YouTube API Services</h2>
<p>${h(cfg.appName)} uses YouTube API Services. By using the app you agree to the <a href="${YT_TOS}" target="_blank" rel="noopener">YouTube Terms of Service</a>. Data received from Google is also processed in line with the <a href="${GOOGLE_PRIVACY}" target="_blank" rel="noopener">Google Privacy Policy</a>.</p>

<h2>What data we collect</h2>
<ul>
  <li><strong>Account data:</strong> name, email address and password (stored only as a cryptographic hash).</li>
  <li><strong>YouTube channel data:</strong> channel ID, channel name and thumbnail, fetched through the YouTube API when you connect a channel.</li>
  <li><strong>OAuth tokens:</strong> access tokens issued by Google, stored encrypted (AES-256-GCM).</li>
  <li><strong>Video content:</strong> the video file, title, description, tags and settings you enter.</li>
</ul>

<h2>How we use data</h2>
<p>We use the data only to upload a video, at your explicit request, to the channels you selected and to show the status of the post. The app does not read, analyze or change anything else on your channels. The permissions we request are <code>youtube.upload</code> (publishing videos) and <code>youtube.readonly</code> (showing the channel name and thumbnail).</p>

<h2>Data sharing</h2>
<p>We do not sell data and do not share it with third parties. The only party data is sent to is Google/YouTube, and only to publish a video you started yourself.</p>

<h2>Retention and deletion</h2>
<ul>
  <li>The video file is deleted from the app's server automatically as soon as it is published to all selected channels.</li>
  <li>When you disconnect a channel, the app revokes Google access and deletes the stored tokens.</li>
  <li>You can also revoke access at any time on the <a href="${GOOGLE_PERMISSIONS}" target="_blank" rel="noopener">Google Account security settings</a> page.</li>
  <li>To delete your whole account and all data, contact ${contact}.</li>
</ul>

<h2>Cookies</h2>
<p>The app uses one cookie that is required for signing in. We do not use cookies for tracking or advertising.</p>

<h2>Contact</h2>
<p>Privacy questions: ${contact}.</p>
</article>`
  );
}

function termsPage(ctx) {
  return layout(
    ctx,
    'Terms of Service',
    `<article class="card prose">
<h1>Terms of Service</h1>
<p class="muted">Last updated: October 12, 2026.</p>
<p>By using ${h(cfg.appName)} you accept these terms.</p>
<ol>
  <li>The app uses YouTube API Services. By using the app you agree to be bound by the <a href="${YT_TOS}" target="_blank" rel="noopener">YouTube Terms of Service</a>.</li>
  <li>You may only connect channels you own or have the owner's permission to use.</li>
  <li>You are responsible for the content you publish, including copyright and the YouTube Community Guidelines.</li>
  <li>Using the app for spam, deceptive behavior or getting around YouTube's rules is prohibited.</li>
  <li>The app is provided “as is”, with no guarantee that every post will succeed.</li>
  <li>We may remove access for an account that breaks these terms.</li>
</ol>
<p>Data processing is described in the <a href="/privacy">Privacy Policy</a>.</p>
</article>`
  );
}

function errorPage(ctx, status, message) {
  return layout(
    ctx,
    'Error',
    `<section class="card narrow"><h1>${status === 404 ? 'Page not found' : 'Something went wrong'}</h1><p>${h(message)}</p><p><a href="/">Back to home</a></p></section>`
  );
}

module.exports = {
  h,
  fmtTime,
  loginPage,
  registerPage,
  accountsPage,
  uploadPage,
  dashboardPage,
  recordingsPage,
  recordingPage,
  shortsPage,
  privacyPage,
  termsPage,
  errorPage,
};

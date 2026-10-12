'use strict';
// HTML šabloni. Sve vrijednosti od korisnika prolaze kroz h() (escape).
const cfg = require('./lib/config');
const { LAYOUTS } = require('./lib/media');

const h = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function layout(ctx, title, body) {
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
  <nav>${nav('/recordings', 'Recordings')}${nav('/shorts', 'Shorts')}${nav('/thumbnails', 'Thumbnails')}</nav>
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

function fmtSize(bytes) {
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
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
    ${
      interactive
        ? `<div class="tl-selection" id="tl-selection" tabindex="0" role="group" aria-label="Selected part. Arrow keys move it by one second." hidden>
        <span class="tl-handle" data-edge="start"></span><span class="tl-handle" data-edge="end"></span>
      </div>
      <span class="tl-playhead" id="tl-playhead"></span>`
        : ''
    }
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
            ? `<a class="button primary" href="/clips/${c.id}/file?download=1">Download</a>`
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
    const lengths = [[15, '15 s'], [30, '30 s'], [45, '45 s'], [60, '1 min']];
    analysis = `<div class="tl-tools">
  <div class="tl-group" role="group" aria-label="Length of the selected part">
    ${lengths.map(([s, label]) => `<button type="button" data-length="${s}">${label}</button>`).join('')}
  </div>
  <button type="button" data-play-selection>Play selection</button>
  <div class="tl-group tl-zoom" role="group" aria-label="Timeline zoom">
    <button type="button" data-zoom="out" aria-label="Zoom out">−</button>
    <button type="button" data-zoom="fit">Zoom to selection</button>
    <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
  </div>
</div>
<div class="tl-scroll" id="tl-scroll">
  <div class="tl-inner" id="tl-inner">
    ${timeline(rec, moments, { clips, interactive: true })}
    <div class="tl-scale" id="tl-scale" aria-hidden="true">${quarter}</div>
  </div>
</div>
<p class="small muted">Drag across the timeline to select a part. Drag the selection to move it, or its edges to trim it. A length button resizes it from its start.</p>
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
  <div class="head-actions">
    ${rec.status === 'ready' ? `<a class="button" href="/recordings/${rec.id}/thumbnail" id="thumb-link">Create thumbnail</a>` : ''}
    <a class="button" href="/recordings">All recordings</a>
  </div>
</div>
${ffmpegNotice(ffmpegOk)}
<div class="grid">
  <section class="card">
    <video class="player" id="player" src="/recordings/${rec.id}/file"${rec.hasThumb ? ` poster="/recordings/${rec.id}/thumb"` : ''} controls preload="metadata"></video>
    <div id="live-moments" data-live data-rev="${h(rec.status)}:${clips.filter((c) => c.status === 'ready').map((c) => c.id).join(',')}" data-poll-key="rec:${rec.id}" data-state="${h(rec.status)}">
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

// ── Thumbnailovi ──────────────────────────────────────────
const THUMB_COLORS = [
  ['#ffffff', 'White'],
  ['#ffe600', 'Yellow'],
  ['#ff3b30', 'Red'],
  ['#39e75f', 'Green'],
  ['#33c6ff', 'Blue'],
];

function thumbnailsPage(ctx, { thumbnails }) {
  const tiles = thumbnails
    .map(
      (t) => `<li class="thumb">
      <a class="thumb-frame" href="/thumbnails/${t.id}/file" target="_blank" rel="noopener" title="Open “${h(t.title)}” full size">
        <img src="/thumbnails/${t.id}/file" alt="" loading="lazy">
      </a>
      <strong class="short-title">${h(t.title)}</strong>
      ${meta(h(t.recording_name), fmtSize(t.size), `<time data-local="${h(t.created_at)}">${h(t.created_at)}</time>`)}
      <div class="short-actions">
        <a class="button primary" href="/thumbnails/${t.id}/file?download=1">Download</a>
        <form method="post" action="/thumbnails/${t.id}/delete" data-confirm="Delete the thumbnail “${h(t.title)}”?"><button class="danger-outline">Delete</button></form>
      </div>
    </li>`
    )
    .join('');
  return layout(
    ctx,
    'Thumbnails',
    `<div class="page-head">
  <h1>Thumbnails</h1>
  <a class="button primary" href="/recordings">Create from a recording</a>
</div>
${thumbnails.length ? `<ul class="thumbs">${tiles}</ul>` : '<div class="empty">Open a recording and select “Create thumbnail” to make the first one.</div>'}`
  );
}

function thumbnailEditorPage(ctx, { rec, moments, time }) {
  const range = (id, label, min, max, value, step = 1) =>
    `<label>${label}<input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" data-default="${value}"></label>`;
  const steps = [[-1, '−1 s'], [-0.1, '−0.1 s'], [0.1, '+0.1 s'], [1, '+1 s']];
  return layout(
    ctx,
    'Create thumbnail',
    `<div class="page-head">
  <h1>Create thumbnail</h1>
  <a class="button" href="/recordings/${rec.id}">Back to the recording</a>
</div>
<div class="grid">
  <section class="card">
    <canvas class="thumb-canvas" id="thumb-canvas" width="1280" height="720" data-recording="${rec.id}" data-name="${h(rec.name.replace(/\.[^.]+$/, ''))}"></canvas>
    <video class="thumb-source" id="thumb-video" src="/recordings/${rec.id}/file" preload="auto" muted playsinline></video>
    <p class="small muted">Drag the text to place it. When zoomed in, drag the picture to choose what stays in the frame.</p>

    <h2>Frame</h2>
    ${timeline(rec, moments)}
    <input type="range" id="thumb-time" min="0" max="${rec.duration}" step="0.05" value="${time}" aria-label="Time of the frame">
    <div class="tl-tools">
      <div class="tl-group" role="group" aria-label="Move the frame">
        ${steps.map(([s, label]) => `<button type="button" data-step="${s}">${label}</button>`).join('')}
      </div>
      <span class="muted small" id="thumb-time-label"></span>
    </div>
  </section>

  <section class="card">
    <form id="thumb-form" class="stack">
      <h2>Text</h2>
      <label>Text <span class="muted">(optional, up to two lines)</span>
        <textarea id="thumb-text" rows="2" maxlength="80" placeholder="FIRST HEIST GONE WRONG"></textarea>
      </label>
      <label class="check"><input type="checkbox" id="thumb-upper" checked> Write it in capitals</label>
      <label>Font
        <select id="thumb-font">
          <option value="Impact, 'Arial Black', sans-serif">Impact</option>
          <option value="'Arial Black', Arial, sans-serif">Arial Black</option>
        </select>
      </label>
      ${range('thumb-size', 'Size', 50, 260, 130)}
      <div>
        <span class="field-label">Color</span>
        <div class="swatches" role="group" aria-label="Text color">
          ${THUMB_COLORS.map(([c, name], i) => `<button type="button" class="swatch${i ? '' : ' is-picked'}" data-color="${c}" style="background:${c}" title="${name}" aria-label="${name}"></button>`).join('')}
        </div>
      </div>
      <label class="check"><input type="checkbox" id="thumb-shade" checked> Darken the picture behind the text</label>

      <h2>Picture</h2>
      ${range('thumb-zoom', 'Zoom', 1, 3, 1, 0.01)}
      ${range('thumb-brightness', 'Brightness', 60, 150, 100)}
      ${range('thumb-contrast', 'Contrast', 70, 160, 100)}
      ${range('thumb-saturation', 'Color strength', 40, 200, 100)}
      <button type="button" id="thumb-reset">Reset picture</button>

      <p class="error" id="thumb-error" hidden></p>
      <button class="primary big" id="thumb-save">Save thumbnail</button>
      <p class="muted small">Saved as a 1280×720 JPG, the size YouTube asks for.</p>
    </form>
  </section>
</div>`
  );
}

// ── Pravne stranice ───────────────────────────────────────
function privacyPage(ctx) {
  const contact = cfg.contactEmail ? `<a href="mailto:${h(cfg.contactEmail)}">${h(cfg.contactEmail)}</a>` : 'the person who runs this copy of the app';
  return layout(
    ctx,
    'Privacy Policy',
    `<article class="card prose">
<h1>Privacy Policy</h1>
<p class="muted">Last updated: October 12, 2026.</p>

<p>${h(cfg.appName)} is an app for turning gameplay recordings into videos that are ready to publish. It runs on the computer of the person who installed it, and everything it stores stays on that computer.</p>

<h2>What the app stores</h2>
<ul>
  <li><strong>Your recordings:</strong> the video files you copy into the recordings folder, plus what the app works out from them: length, resolution, loudness over time and a thumbnail.</li>
  <li><strong>What you create:</strong> the Shorts you cut, the thumbnails you make and the titles you give them.</li>
</ul>

<h2>How the data is used</h2>
<p>The data is used only to show you your recordings and to create the videos you ask for. The app does not upload your videos anywhere and does not send any data to third parties.</p>

<h2>Deleting data</h2>
<ul>
  <li>Deleting a Short deletes its video file.</li>
  <li>Removing a recording takes it off the list and leaves the original file on disk.</li>
</ul>

<h2>Cookies</h2>
<p>The app sets one short-lived cookie to show a confirmation message after an action. It does not use cookies for tracking or advertising.</p>

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
  <li>You may only work with recordings you made yourself or have permission to use.</li>
  <li>You are responsible for what you publish, including copyright and the rules of the platform you publish on.</li>
  <li>The app is provided “as is”, with no guarantee that every video will be created successfully.</li>
</ol>
<p>Data handling is described in the <a href="/privacy">Privacy Policy</a>.</p>
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
  recordingsPage,
  recordingPage,
  shortsPage,
  thumbnailsPage,
  thumbnailEditorPage,
  privacyPage,
  termsPage,
  errorPage,
};

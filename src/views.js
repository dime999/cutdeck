'use strict';
// HTML šabloni. Sve vrijednosti od korisnika prolaze kroz h() (escape).
const cfg = require('./lib/config');
const { LAYOUTS, CAPTION_FONTS, DEFAULT_CAPTION_STYLE } = require('./lib/media');

const h = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Ikone bočnog menija (16×16, linije u boji teksta).
const ICONS = {
  recordings: '<path d="M2.5 4h11v8h-11zM5.25 4v8M10.75 4v8M2.5 8h2.75M10.75 8h2.75"/>',
  shorts: '<rect x="4.5" y="2" width="7" height="12" rx="1.5"/><path d="M7.1 6.4v3.2L9.8 8z" fill="currentColor"/>',
  thumbnails: '<rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M2.5 11l3.2-3.2 2.4 2.4 1.9-1.9 3.5 3.5"/>',
  videos: '<rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M6.7 6.1v3.8L10.1 8z" fill="currentColor"/>',
  bumpers: '<path d="M3 3.5v9M13 3.5v9"/><rect x="5.5" y="5.5" width="5" height="5" rx="1"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
// Znak aplikacije: jedan blok presječen na dva dijela.
const BRAND_MARK = '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M3 4.5A1.5 1.5 0 0 1 4.5 3H11l-3 14H4.5A1.5 1.5 0 0 1 3 15.5z" fill="#ffb02e"/><path d="M13 3h2.5A1.5 1.5 0 0 1 17 4.5v11a1.5 1.5 0 0 1-1.5 1.5H10z" fill="#6cb6ff"/></svg>';

function layout(ctx, title, body) {
  // Stavka je aktivna i na podstranicama; `also` su adrese koje joj pripadaju a ne počinju isto.
  const nav = (href, label, name, also = []) => {
    const active = [href, ...also].some((p) => ctx.path.startsWith(p));
    return `<a href="${href}"${active ? ' class="active" aria-current="page"' : ''}>${icon(name)}<span>${label}</span></a>`;
  };
  const flash = ctx.flash
    ? `<div class="flash ${h(ctx.flash.type)}" role="status">${h(ctx.flash.msg)}</div>`
    : '';
  const favicon = encodeURIComponent(BRAND_MARK.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${h(title)} · ${h(cfg.appName)}</title>
<link rel="stylesheet" href="/static/style.css">
<link rel="icon" href="data:image/svg+xml,${favicon}">
</head>
<body>
<div class="shell">
  <aside class="side">
    <a class="brand" href="/">${BRAND_MARK}<span>${h(cfg.appName)}</span></a>
    <nav class="side-nav" aria-label="Main">
      <p class="side-label">Library</p>
      ${nav('/recordings', 'Recordings', 'recordings')}
      <p class="side-label">Create</p>
      ${nav('/shorts', 'Shorts', 'shorts', ['/clips'])}
      ${nav('/thumbnails', 'Thumbnails', 'thumbnails')}
      ${nav('/videos', 'Videos', 'videos')}
      <p class="side-label">Assets</p>
      ${nav('/bumpers', 'Intros and outros', 'bumpers')}
    </nav>
    <p class="side-foot"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></p>
  </aside>
  <main>
${flash}
${body}
  </main>
</div>
<script src="/static/app.js" defer></script>
</body>
</html>`;
}

function fmtSize(bytes) {
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
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
            ? `<a class="button primary" href="/clips/${c.id}/file?download=1">Download</a>
               <a class="button" href="/videos/new?clip=${c.id}">Add intro and outro</a>
               <a class="button" href="/clips/${c.id}/captions">Add captions</a>`
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
    ${rec.status === 'ready' ? `<a class="button" href="/recordings/${rec.id}/thumbnail" id="thumb-link">Create thumbnail</a>
    <a class="button" href="/videos/new?recording=${rec.id}">Add intro and outro</a>` : ''}
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

// ── Intro, outro i gotovi videi ───────────────────────────
function bumpersPage(ctx, { bumpers, ffmpegOk }) {
  const tiles = bumpers
    .map(
      (b) => `<li class="thumb">
      <a class="thumb-frame" href="/bumpers/${b.id}/file" target="_blank" rel="noopener" title="Watch “${h(b.name)}”">
        ${b.hasThumb ? `<img src="/bumpers/${b.id}/thumb" alt="" loading="lazy">` : ''}
        <span class="rec-len">${fmtTime(b.duration)}</span>
      </a>
      <strong class="short-title">${h(b.name)}</strong>
      ${meta(`${b.width}×${b.height}`, fmtSize(b.size), b.has_audio ? '' : 'no sound')}
      <div class="short-actions">
        <form method="post" action="/bumpers/${b.id}/delete" data-confirm="Delete “${h(b.name)}”? Videos already created with it stay as they are."><button class="danger-outline">Delete</button></form>
      </div>
    </li>`
    )
    .join('');
  return layout(
    ctx,
    'Intros and outros',
    `<div class="page-head">
  <h1>Intros and outros</h1>
</div>
${ffmpegNotice(ffmpegOk)}
<section class="card">
  <h2>Add a clip</h2>
  <form id="bumper-form" class="stack">
    <label>Video file<input type="file" id="bumper-file" accept="video/*" required></label>
    <label>Name <span class="muted">(optional)</span><input id="bumper-name" maxlength="60" placeholder="Channel intro"></label>
    <p class="error" id="bumper-error" hidden></p>
    <div class="progress" id="bumper-progress" hidden><div class="bar"></div><span class="label"></span></div>
    <div><button class="primary">Add clip</button></div>
  </form>
</section>
${
  bumpers.length
    ? `<ul class="thumbs">${tiles}</ul>`
    : '<div class="empty">Add the intro and outro clips you made for your channel. Any clip can be used at the start or at the end of a video.</div>'
}`
  );
}

function videoNewPage(ctx, { source, bumpers }) {
  const options = bumpers.map((b) => `<option value="${b.id}">${h(b.name)} (${fmtTime(b.duration)})</option>`).join('');
  return layout(
    ctx,
    'Add intro and outro',
    `<div class="page-head">
  <h1>Add intro and outro</h1>
  <a class="button" href="${source.back}">Back</a>
</div>
<section class="card form-card">
  <p class="form-source"><strong>${h(source.name)}</strong></p>
  ${meta(fmtTime(source.duration), `${source.width}×${source.height}`, source.kind === 'clip' ? 'Short' : 'Recording')}
  ${
    bumpers.length
      ? `<form method="post" action="/videos" class="stack">
    <input type="hidden" name="source" value="${source.kind}:${source.id}">
    <label>Intro<select name="intro"><option value="">No intro</option>${options}</select></label>
    <label>Outro<select name="outro"><option value="">No outro</option>${options}</select></label>
    <label>Title<input name="title" maxlength="100" value="${h(source.name)}"></label>
    <p class="muted small">The result keeps the size of this video. A clip with a different shape is fitted into the frame with black bars. The whole video is encoded again, so a long recording takes a while.</p>
    <button class="primary big">Create video</button>
  </form>`
      : '<div class="empty">Add an intro or outro clip first. <a class="button primary" href="/bumpers">Go to Intros and outros</a></div>'
  }
</section>`
  );
}

function videoMergePage(ctx, { groups, ffmpegOk }) {
  const available = groups
    .filter(([, items]) => items.length)
    .map(
      ([label, items]) => `<h3 class="pick-group">${label}</h3>
    <ul class="pick-list">${items
      .map(
        (p) => `<li>
        <div class="grow">
          <strong>${h(p.name)}</strong>
          ${meta(fmtTime(p.duration), `${p.width}×${p.height}`)}
        </div>
        <button type="button" data-add="${p.kind}:${p.id}" data-name="${h(p.name)}" data-duration="${p.duration}" data-size="${p.width}×${p.height}">Add</button>
      </li>`
      )
      .join('')}</ul>`
    )
    .join('');
  return layout(
    ctx,
    'Merge videos',
    `<div class="page-head">
  <h1>Merge videos</h1>
  <a class="button" href="/videos">Back</a>
</div>
${ffmpegNotice(ffmpegOk)}
${
  available
    ? `<div class="grid">
  <section class="card">
    <h2>Add parts</h2>
    <p class="muted small">Add the parts in the order you want them. The same part can be added more than once.</p>
    ${available}
  </section>

  <section class="card">
    <h2>Order</h2>
    <form method="post" action="/videos/merge" id="merge-form" class="stack">
      <ol class="merge-list" id="merge-list"></ol>
      <p class="muted" id="merge-empty">Nothing added yet. The parts are joined from top to bottom.</p>
      <p class="meta" id="merge-total" hidden></p>
      <label>Frame size
        <select name="main" id="merge-main"></select>
      </label>
      <label>Title <span class="muted">(optional)</span><input name="title" maxlength="100"></label>
      <p class="muted small">The video takes the size of the part you pick under “Frame size”. Parts with a different shape are fitted into the frame with black bars. Everything is encoded again, so long videos take a while.</p>
      <button class="primary big" id="merge-submit" disabled>Create video</button>
    </form>
  </section>
</div>`
    : '<div class="empty">There is nothing to merge yet. Scan a recording or create a Short first. <a class="button primary" href="/recordings">Go to Recordings</a></div>'
}`
  );
}

function videosPage(ctx, { videos, ffmpegOk }) {
  const tiles = videos
    .map((v) => {
      const parts = JSON.parse(v.parts).map((p) => h(p.name)).join(' + ');
      let frame;
      if (v.status === 'ready') {
        frame = `<a class="thumb-frame" href="/videos/${v.id}/file" target="_blank" rel="noopener" title="Watch “${h(v.title)}”">
        ${v.hasThumb ? `<img class="fit" src="/videos/${v.id}/thumb" alt="" loading="lazy">` : ''}
        <span class="rec-len">${fmtTime(v.duration)}</span>
      </a>`;
      } else if (v.status === 'failed') {
        frame = `<div class="thumb-frame is-failed"><p>${h(v.error || 'This video could not be created.')}</p></div>`;
      } else {
        frame = `<div class="thumb-frame is-busy"><p>${v.status === 'rendering' ? 'Creating…' : 'Waiting its turn'}</p>${v.status === 'rendering' ? progressBar(v.progress) : ''}</div>`;
      }
      let actions;
      if (v.status === 'ready') actions = `<a class="button primary" href="/videos/${v.id}/file?download=1">Download</a>`;
      else if (v.status === 'rendering') actions = `<form method="post" action="/videos/${v.id}/cancel"><button>Cancel</button></form>`;
      else actions = '';
      return `<li class="thumb" data-poll-key="video:${v.id}" data-state="${h(v.status)}">
      ${frame}
      <strong class="short-title">${h(v.title)}</strong>
      ${meta(parts, v.size ? fmtSize(v.size) : '', v.width ? `${v.width}×${v.height}` : '')}
      <div class="short-actions">
        ${actions}
        ${
          v.status === 'rendering'
            ? ''
            : `<form method="post" action="/videos/${v.id}/delete" data-confirm="Delete the video “${h(v.title)}”? Its file will be deleted too."><button class="danger-outline">Delete</button></form>`
        }
      </div>
    </li>`;
    })
    .join('');
  const busy = videos.some((v) => v.status === 'pending' || v.status === 'rendering');
  return layout(
    ctx,
    'Videos',
    `<div class="page-head">
  <h1>Videos</h1>
  <div class="head-actions">
    <a class="button" href="/bumpers">Intros and outros</a>
    <a class="button primary" href="/videos/merge">Merge videos</a>
  </div>
</div>
${ffmpegNotice(ffmpegOk)}
<div id="live-videos" data-live>
${videos.length ? `<ul class="thumbs">${tiles}</ul>` : '<div class="empty">Select “Merge videos” to join several videos into one, or open a recording or a Short and select “Add intro and outro”.</div>'}
${studioPoll(busy && ffmpegOk)}
</div>`
  );
}

// ── Titlovi ───────────────────────────────────────────────
function captionsPage(ctx, { clip, captions, problem }) {
  const status = captions ? captions.status : 'none';
  const style = { ...DEFAULT_CAPTION_STYLE, ...(captions ? JSON.parse(captions.style || '{}') : {}) };
  const select = (name, label, options) =>
    `<label>${label}<select name="${name}" id="cap-${name}">${options
      .map(([value, text]) => `<option value="${h(value)}"${style[name] === value ? ' selected' : ''}>${h(text)}</option>`)
      .join('')}</select></label>`;
  const generate = (label) =>
    `<form method="post" action="/clips/${clip.id}/captions/generate"><button class="primary"${problem ? ' disabled' : ''}>${label}</button></form>`;

  let panel;
  if (status === 'pending' || status === 'transcribing') {
    panel = `<h2>Captions</h2>
<p class="muted">Listening to the voice in this Short…</p>${progressBar(captions.progress)}`;
  } else if (status === 'ready') {
    const lines = JSON.parse(captions.lines);
    panel = `<form method="post" action="/clips/${clip.id}/captions" id="cap-form" class="stack">
  <h2>Style</h2>
  <div class="cap-style">
    ${select('font', 'Font', CAPTION_FONTS)}
    ${select('size', 'Size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])}
    ${select('position', 'Position', [['bottom', 'Bottom'], ['middle', 'Middle'], ['top', 'Top']])}
  </div>
  <div>
    <span class="field-label">Color</span>
    <div class="swatches" role="group" aria-label="Caption color">
      ${THUMB_COLORS.map(([c, name]) => `<button type="button" class="swatch${c === style.color ? ' is-picked' : ''}" data-cap-color="${c}" style="background:${c}" title="${name}" aria-label="${name}"></button>`).join('')}
    </div>
    <input type="hidden" name="color" id="cap-color" value="${h(style.color)}">
  </div>
  <label class="check"><input type="checkbox" name="upper" id="cap-upper" value="1"${style.upper ? ' checked' : ''}> Write the captions in capitals</label>

  <h2>Lines</h2>
  ${
    lines.length
      ? `<p class="muted small">Fix any word that was heard wrong. The two numbers are the seconds when a line appears and disappears. Select a line to jump to it in the video.</p>
  <ol class="cap-lines" id="cap-lines">${lines
          .map(
            (l) => `<li>
      <input type="number" name="start" value="${l.start}" min="0" step="0.01" aria-label="Appears at, in seconds">
      <input type="number" name="end" value="${l.end}" min="0" step="0.01" aria-label="Disappears at, in seconds">
      <input name="text" value="${h(l.text)}" maxlength="120" aria-label="Caption text">
      <button type="button" class="danger-outline" data-cap-remove aria-label="Remove this line" title="Remove this line">×</button>
    </li>`
          )
          .join('')}</ol>`
      : '<p class="muted">No speech was found in this Short. Captions are made from your voice, not from the sound of the game.</p>'
  }
  <div class="cap-actions">
    <button name="action" value="save">Save changes</button>
    <button class="primary" name="action" value="render"${lines.length ? '' : ' disabled'}>Create Short with captions</button>
  </div>
  <p class="muted small">The captions are drawn into a copy of this Short. The original stays as it is.</p>
</form>
<form method="post" action="/clips/${clip.id}/captions/generate" data-confirm="Listen to the Short again? Your changes to the lines will be replaced."><button class="link">Generate the captions again</button></form>`;
  } else {
    panel = `<h2>Captions</h2>
${status === 'failed' ? `<p class="error">${h(captions.error || 'The captions could not be generated.')}</p>` : ''}
<p>The app listens to the English speech in this Short and writes it out as captions. You can fix the text before it is drawn into the video.</p>
${problem ? `<div class="notice warn"><strong>Captions are not available yet.</strong> ${h(problem)}</div>` : ''}
${generate(status === 'failed' ? 'Try again' : 'Generate captions')}`;
  }
  const busy = status === 'pending' || status === 'transcribing';

  return layout(
    ctx,
    'Captions',
    `<div class="page-head">
  <h1>Captions</h1>
  <a class="button" href="/shorts">Back to Shorts</a>
</div>
<div class="cap-layout">
  <section class="card">
    <p class="form-source"><strong>${h(clip.title)}</strong></p>
    <div class="cap-stage" id="cap-stage">
      <video id="cap-video" src="/clips/${clip.id}/file" controls preload="metadata" playsinline></video>
      <div class="cap-overlay" id="cap-overlay" aria-hidden="true"></div>
    </div>
  </section>
  <section class="card" id="live-captions" data-live data-rev="${h(status)}" data-poll-key="captions:${clip.id}" data-state="${h(status)}">
    ${panel}
    ${studioPoll(busy && !problem)}
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
  <li><strong>What you create:</strong> the Shorts you cut, the thumbnails and videos you make, your intro and outro clips, and the titles you give them.</li>
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
  bumpersPage,
  videoNewPage,
  videoMergePage,
  captionsPage,
  videosPage,
  privacyPage,
  termsPage,
  errorPage,
};

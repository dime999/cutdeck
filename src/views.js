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
  download: '<path d="M8 2.5v8M4.8 7.5 8 10.7l3.2-3.2M3 13.5h10"/>',
  upload: '<path d="M8 10.5v-8M4.8 5.7 8 2.5l3.2 3.2M3 13.5h10"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v3.5M9.2 7v3.5"/>',
  more: '<circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none"/>',
  scan: '<path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.8v2.6h-2.6"/>',
  split: '<circle cx="4" cy="4.5" r="1.7"/><circle cx="4" cy="11.5" r="1.7"/><path d="M5.4 5.6 13 12M5.4 10.4 13 4"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  back: '<path d="M9.5 3.5 5 8l4.5 4.5"/>',
  external: '<path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5"/>',
  merge: '<path d="M8 2.5 13.5 5.5 8 8.5 2.5 5.5zM2.5 8.5 8 11.5l5.5-3M2.5 11 8 14l5.5-3"/>',
  captions: '<rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M4.5 9.8h3M9 9.8h2.5M4.5 7.5h1.5M7.5 7.5h4"/>',
  kit: '<path d="M13.5 2.5 7 9M13.5 2.5 9.5 13.5 7 9 2.5 6.5z"/>',
  stop: '<rect x="4" y="4" width="8" height="8" rx="1.5"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
// Link nazad iznad naslova stranice.
const crumb = (href, label) => `<a class="crumb" href="${href}">${icon('back')}${label}</a>`;
// Meni sa dodatnim akcijama iza dugmeta sa tri tačke. `items` su linkovi i forme.
const menu = (label, items, cls = '') =>
  `<details class="menu${cls ? ` ${cls}` : ''}"><summary class="button icon-only" aria-label="${label}" title="More actions">${icon('more')}</summary><div class="menu-list">${items}</div></details>`;
// Prazna lista: ikona, šta ovdje nastaje i kako početi.
const emptyState = (iconName, title, text, action = '') =>
  `<div class="empty">${icon(iconName)}<strong>${title}</strong><p>${text}</p>${action}</div>`;

// Znak aplikacije: jedan blok presječen na dva dijela.
const BRAND_MARK = '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M3 4.5A1.5 1.5 0 0 1 4.5 3H11l-3 14H4.5A1.5 1.5 0 0 1 3 15.5z" fill="#ffb02e"/><path d="M13 3h2.5A1.5 1.5 0 0 1 17 4.5v11a1.5 1.5 0 0 1-1.5 1.5H10z" fill="#6cb6ff"/></svg>';

function layout(ctx, title, body) {
  // Stavka je aktivna i na podstranicama; `also` su adrese koje joj pripadaju a ne počinju isto.
  const nav = (href, label, name, also = []) => {
    const active = [href, ...also].some((p) => ctx.path.startsWith(p));
    return `<a href="${href}"${active ? ' class="active" aria-current="page"' : ''}>${icon(name)}<span>${label}</span></a>`;
  };
  const flash = ctx.flash
    ? `<div class="toast ${h(ctx.flash.type)}" role="status"><p>${h(ctx.flash.msg)}</p><button type="button" data-toast-close aria-label="Dismiss">${icon('close')}</button></div>`
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
<a class="skip" href="#main">Skip to content</a>
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
      <p class="side-label">Clipping</p>
      ${nav('/clipping', 'Campaigns', 'kit')}
    </nav>
    <a class="side-activity" id="side-activity" href="/shorts" hidden><span class="spinner"></span><span id="side-activity-text"></span></a>
    <p class="side-foot"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></p>
  </aside>
  <main id="main">
${body}
  </main>
</div>
<div class="toasts" id="toasts" aria-live="polite">${flash}</div>
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
// `kinds` su vrste stavki koje stranica nabraja (npr. 'clip'), da preglednik primijeti kad se neka pojavi ili nestane.
const studioPoll = (busy, recordingId = '', kinds = '') => (busy ? `<div data-studio-poll="${recordingId}" data-poll-kinds="${kinds}" hidden></div>` : '');

// Short je u toku dok se pravi ili dok ga još čekaju titlovi, intro ili outro.
const inProgress = (c) => c.status === 'pending' || c.status === 'rendering' || Boolean(c.followup);

// Traka iznad pločica dok se Shorts prave, sa dugmetom za prekid.
function queueBar(clips, recordingId = '') {
  const unfinished = clips.filter((c) => c.status === 'pending' || c.status === 'rendering').length;
  const chained = clips.filter((c) => c.status === 'ready' && c.followup).length;
  if (!unfinished && !chained) return '';
  const what = [unfinished && `${unfinished} ${unfinished === 1 ? 'Short' : 'Shorts'} still to be created`, chained && `${chained} waiting for captions, intro or outro`].filter(Boolean).join(', ');
  return `<div class="queue-bar">
    <span><span class="spinner"></span>${what}.</span>
    <form method="post" action="/shorts/cancel${recordingId ? `?recording=${recordingId}` : ''}" data-confirm="Stop creating Shorts? The ones that are not finished are removed, and no more captions, intros or outros are added. Finished Shorts stay."><button class="danger-outline">${icon('stop')}Stop creating Shorts</button></form>
  </div>`;
}

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

const PUBLISHED = '<span class="chip ok">Published</span>';

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
      const remove = `<form method="post" action="/clips/${c.id}/delete${from ? `?from=${from}` : ''}" data-confirm="Delete the Short “${h(c.title)}”? Its video file will be deleted too."><button class="danger-outline">${icon('trash')}Delete</button></form>`;
      return `<li class="short" data-poll-key="clip:${c.id}" data-state="${h(c.status)}">
      <label class="pick"><input type="checkbox" name="ids" value="${c.id}" form="bulk-form" aria-label="Select “${h(c.title)}”"></label>
      ${frame}
      <strong class="short-title">${h(c.title)}</strong>
      ${meta(c.published ? PUBLISHED : '', c.status === 'ready' && c.followup ? '<span class="chip info">More steps coming</span>' : '', `${h(c.recording_name)} at ${fmtTime(c.start_s)}`, c.size ? fmtSize(c.size) : '')}
      <div class="short-actions">
        ${
          c.status === 'ready'
            ? `<a class="button primary" href="/clips/${c.id}/file?download=1">Download</a>
               <a class="button" href="/publish/clip/${c.id}">Publish kit</a>
               ${menu(
                 `More actions for “${h(c.title)}”`,
                 `<a href="/clips/${c.id}/captions">${icon('captions')}Captions</a>
                 <a href="/videos/new?clip=${c.id}">${icon('bumpers')}Intro and outro</a>
                 <hr>
                 ${remove}`
               )}`
            : c.status === 'failed'
              ? remove
              : `<form method="post" action="/clips/${c.id}/cancel${from ? `?from=${from}` : ''}"><button>${icon('stop')}Cancel</button></form>`
        }
      </div>
    </li>`;
    })
    .join('');
  // Traka za označavanje: kvačica na svakoj pločici pripada ovoj formi (atribut form).
  const recording = from === 'recording' && clips.length ? clips[0].recording_id : '';
  return `<form method="post" action="/shorts/delete${recording ? `?recording=${recording}` : ''}" id="bulk-form" class="bulk-bar" data-confirm="Delete the selected Shorts?">
    <label class="check"><input type="checkbox" id="bulk-all"> Select all</label>
    <span class="muted" id="bulk-count">None selected</span>
    <button class="danger-outline" id="bulk-delete" disabled>${icon('trash')}Delete selected</button>
  </form>
  <ul class="shorts">${tiles}</ul>`;
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
  <form method="post" action="/recordings/scan"><button class="primary">${icon('scan')}Scan folder</button></form>
</div>
${ffmpegNotice(ffmpegOk)}
<div id="live-recordings" data-live>
${
  recordings.length
    ? `<ul class="recs">${rows}</ul>`
    : emptyState('recordings', 'No recordings yet', 'Copy a gameplay recording into the folder below, then select “Scan folder”.')
}
${studioPoll(busy && ffmpegOk)}
</div>
<p class="folder-hint">Recordings folder: <code>${h(folder)}</code>. Subfolders are scanned too. Highlighted ranges on each timeline are the loudest 30 seconds of the recording.</p>`
  );
}

function recordingPage(ctx, { rec, moments, clips, bumpers, captionsProblem, ffmpegOk }) {
  const bumperOptions = bumpers.map((b) => `<option value="${b.id}">${h(b.name)} (${fmtTime(b.duration)})</option>`).join('');
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
  const busy = rec.status === 'pending' || rec.status === 'analyzing' || clips.some(inProgress);

  return layout(
    ctx,
    rec.name,
    `<div class="page-head">
  <div class="head-title">${crumb('/recordings', 'Recordings')}<h1>${h(rec.name)}</h1></div>
  <div class="head-actions">
    ${
      rec.status === 'ready'
        ? `<a class="button primary" href="/recordings/${rec.id}/split">${icon('split')}Split into Shorts</a>
    <a class="button" href="/recordings/${rec.id}/thumbnail" id="thumb-link">${icon('thumbnails')}Create thumbnail</a>
    ${menu(
      'More actions for this recording',
      `<a href="/videos/new?recording=${rec.id}">${icon('bumpers')}Add intro and outro</a>
      <a href="/publish/recording/${rec.id}">${icon('kit')}Publish kit</a>`,
      'drop-down'
    )}`
        : ''
    }
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
      <h2>Then, without more clicks</h2>
      <label class="check"><input type="checkbox" name="auto_captions" value="1" data-remember="auto-captions"${captionsProblem ? ' disabled' : ''}> Add captions from the voice</label>
      ${captionsProblem ? `<p class="muted small">Captions are not available yet: ${h(captionsProblem)}</p>` : ''}
      <label>Intro<select name="auto_intro" data-remember="auto-intro"><option value="">No intro</option>${bumperOptions}</select></label>
      <label>Outro<select name="auto_outro" data-remember="auto-outro"><option value="">No outro</option>${bumperOptions}</select></label>
      <p class="muted small">3 to 180 seconds, vertical 1080×1920. Captions use the style you last saved on a captions page. With an intro or outro the finished video appears under Videos; otherwise under Shorts.</p>
      <button class="primary big">${icon('split')}Create Short</button>
    </form>
  </section>
</div>

<div id="live-clips" data-live>
  <h2>Shorts from this recording</h2>
  ${queueBar(clips, rec.id)}
  ${clips.length ? shortTiles(clips, { from: 'recording' }) : emptyState('shorts', 'No Shorts from this recording yet', 'Pick a moment above and select “Create Short”.')}
  ${studioPoll(busy && ffmpegOk, rec.id, 'clip')}
</div>`
  );
}

function shortsPage(ctx, { clips, ffmpegOk }) {
  const busy = clips.some(inProgress);
  return layout(
    ctx,
    'Shorts',
    `<div class="page-head">
  <h1>Shorts</h1>
  <a class="button primary" href="/recordings">${icon('plus')}Create from a recording</a>
</div>
${ffmpegNotice(ffmpegOk)}
<div id="live-clips" data-live>
${queueBar(clips)}
${clips.length ? shortTiles(clips) : emptyState('shorts', 'No Shorts yet', 'Open a recording, pick a moment and create your first Short.', '<a class="button" href="/recordings">Go to Recordings</a>')}
${studioPoll(busy && ffmpegOk, '', 'clip')}
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
        <a class="button primary" href="/thumbnails/${t.id}/file?download=1">${icon('download')}Download</a>
        <form method="post" action="/thumbnails/${t.id}/delete" data-confirm="Delete the thumbnail “${h(t.title)}”?"><button class="danger-outline">${icon('trash')}Delete</button></form>
      </div>
    </li>`
    )
    .join('');
  return layout(
    ctx,
    'Thumbnails',
    `<div class="page-head">
  <h1>Thumbnails</h1>
  <a class="button primary" href="/recordings">${icon('plus')}Create from a recording</a>
</div>
${thumbnails.length ? `<ul class="thumbs">${tiles}</ul>` : emptyState('thumbnails', 'No thumbnails yet', 'Open a recording and select “Create thumbnail” to make the first one.', '<a class="button" href="/recordings">Go to Recordings</a>')}`
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
  <div class="head-title">${crumb(`/recordings/${rec.id}`, 'Back to the recording')}<h1>Create thumbnail</h1></div>
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
        <form method="post" action="/bumpers/${b.id}/delete" data-confirm="Delete “${h(b.name)}”? Videos already created with it stay as they are."><button class="danger-outline">${icon('trash')}Delete</button></form>
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
    <label class="drop" id="bumper-drop">${icon('upload')}<strong id="bumper-drop-text">Choose a video or drag it here</strong><span id="bumper-drop-hint">MP4, MOV, MKV or WebM, up to 1 GB</span><input type="file" id="bumper-file" accept="video/*" required aria-label="Video file"></label>
    <label>Name <span class="muted">(optional)</span><input id="bumper-name" maxlength="60" placeholder="Channel intro"></label>
    <p class="error" id="bumper-error" hidden></p>
    <div class="progress" id="bumper-progress" hidden><div class="bar"></div><span class="label"></span></div>
    <div><button class="primary">${icon('plus')}Add clip</button></div>
  </form>
</section>
${
  bumpers.length
    ? `<ul class="thumbs">${tiles}</ul>`
    : emptyState('bumpers', 'No intro or outro clips yet', 'Add the clips you made for your channel. Any clip can be used at the start or at the end of a video.')
}`
  );
}

function videoNewPage(ctx, { source, bumpers }) {
  const options = bumpers.map((b) => `<option value="${b.id}">${h(b.name)} (${fmtTime(b.duration)})</option>`).join('');
  return layout(
    ctx,
    'Add intro and outro',
    `<div class="page-head">
  <div class="head-title">${crumb(source.back, 'Back')}<h1>Add intro and outro</h1></div>
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
  <div class="head-title">${crumb('/videos', 'Videos')}<h1>Merge videos</h1></div>
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
      const remove = `<form method="post" action="/videos/${v.id}/delete" data-confirm="Delete the video “${h(v.title)}”? Its file will be deleted too."><button class="danger-outline">${icon('trash')}Delete</button></form>`;
      if (v.status === 'ready') {
        actions = `<a class="button primary" href="/videos/${v.id}/file?download=1">${icon('download')}Download</a>
        <a class="button" href="/publish/video/${v.id}">Publish kit</a>
        ${menu(`More actions for “${h(v.title)}”`, remove)}`;
      }
      else if (v.status === 'rendering') actions = `<form method="post" action="/videos/${v.id}/cancel"><button>${icon('stop')}Cancel</button></form>`;
      else actions = remove;
      return `<li class="thumb" data-poll-key="video:${v.id}" data-state="${h(v.status)}">
      ${frame}
      <strong class="short-title">${h(v.title)}</strong>
      <p class="tile-desc">${parts}</p>
      <button type="button" class="link tile-more" aria-expanded="false" hidden>Show all</button>
      ${meta(v.published ? PUBLISHED : '', v.size ? fmtSize(v.size) : '', v.width ? `${v.width}×${v.height}` : '')}
      <div class="short-actions">
        ${actions}
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
    <a class="button" href="/bumpers">${icon('bumpers')}Intros and outros</a>
    <a class="button primary" href="/videos/merge">${icon('merge')}Merge videos</a>
  </div>
</div>
${ffmpegNotice(ffmpegOk)}
<div id="live-videos" data-live>
${videos.length ? `<ul class="thumbs">${tiles}</ul>` : emptyState('videos', 'No videos yet', 'Select “Merge videos” to join several videos into one, or open a recording or a Short and add an intro and outro.')}
${studioPoll(busy && ffmpegOk)}
</div>`
  );
}

// ── Titlovi ───────────────────────────────────────────────
function captionsPage(ctx, { clip, captions, problem }) {
  const status = captions ? captions.status : 'none';
  const style = { ...DEFAULT_CAPTION_STYLE, ...(captions ? JSON.parse(captions.style || '{}') : {}) };
  // Kad je isticanje isključeno, izbor boje i dalje nudi zadanu.
  const highlightColor = style.highlight || DEFAULT_CAPTION_STYLE.highlight;
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
  <label class="check"><input type="checkbox" name="highlight_on" id="cap-highlight-on" value="1"${style.highlight ? ' checked' : ''}> Highlight each word as it is spoken</label>
  <div>
    <span class="field-label">Highlight color</span>
    <div class="swatches" role="group" aria-label="Color of the spoken word">
      ${THUMB_COLORS.map(([c, name]) => `<button type="button" class="swatch${c === highlightColor ? ' is-picked' : ''}" data-cap-highlight="${c}" style="background:${c}" title="${name}" aria-label="${name}"></button>`).join('')}
    </div>
    <input type="hidden" name="highlight" id="cap-highlight" value="${h(highlightColor)}">
  </div>

  <h2>Lines</h2>
  ${
    lines.length
      ? `<p class="muted small">Fix any word that was heard wrong. The two numbers are the seconds when a line appears and disappears. Select a line to jump to it in the video.</p>
  <ol class="cap-lines" id="cap-lines">${lines
          .map(
            (l, i) => `<li data-words="${h(JSON.stringify(l.words || []))}">
      <input type="number" name="start" value="${l.start}" min="0" step="0.01" aria-label="Appears at, in seconds">
      <input type="number" name="end" value="${l.end}" min="0" step="0.01" aria-label="Disappears at, in seconds">
      <input name="text" value="${h(l.text)}" maxlength="120" aria-label="Caption text">
      <button type="button" class="danger-outline" data-cap-remove aria-label="Remove this line" title="Remove this line">×</button>
      <input type="hidden" name="key" value="${i}">
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
  <div class="head-title">${crumb('/shorts', 'Shorts')}<h1>Captions</h1></div>
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

// ── Paket za objavu ───────────────────────────────────────
function kitPage(ctx, { item, kit, thumbnails, isNew }) {
  const counter = (id, max) => `<span class="muted" data-count="${id}" data-max="${max}"></span>`;
  const copy = (id, label = 'Copy', withId = '') => `<button type="button" data-copy="${id}"${withId ? ` data-copy-with="${withId}"` : ''}>${label}</button>`;
  let thumbnail;
  if (item.vertical) {
    thumbnail = '<p class="muted small">A Short takes its thumbnail from a frame of the video, so there is no picture to upload.</p>';
  } else if (thumbnails.length) {
    thumbnail = `<div>
      <span class="field-label">Thumbnail</span>
      <div class="kit-thumbs">
        <label class="kit-thumb"><input type="radio" name="thumbnail" value=""${kit.thumbnail_id ? '' : ' checked'}><span>None</span></label>
        ${thumbnails
          .map(
            (t) =>
              `<label class="kit-thumb" title="${h(t.title)}"><input type="radio" name="thumbnail" value="${t.id}"${t.id === kit.thumbnail_id ? ' checked' : ''}><img src="/thumbnails/${t.id}/file" alt="${h(t.title)}" loading="lazy"></label>`
          )
          .join('')}
      </div>
      <a class="button" id="kit-thumb-download" href="#" hidden>Download thumbnail</a>
    </div>`;
  } else {
    thumbnail = `<p class="muted small">No thumbnails yet. ${
      item.recordingId ? `<a href="/recordings/${item.recordingId}/thumbnail">Create one from the recording</a>` : 'Open a recording and select “Create thumbnail”'
    }, then come back to pick it here.</p>`;
  }

  return layout(
    ctx,
    'Publish kit',
    `<div class="page-head">
  <div class="head-title">${crumb(item.back, 'Back')}<h1>Publish kit</h1></div>
  <div class="head-actions">
    <a class="button" href="https://studio.youtube.com" target="_blank" rel="noopener">${icon('external')}Open YouTube Studio</a>
  </div>
</div>
<div class="cap-layout${item.vertical ? '' : ' kit-wide'}">
  <section class="card">
    <p class="form-source"><strong>${h(item.name)}</strong></p>
    <video class="kit-video" src="${item.file}" poster="${item.poster}" controls preload="none" playsinline></video>
    <a class="button primary" href="${item.file}?download=1">${icon('download')}Download video</a>
  </section>
  <section class="card">
    <form method="post" action="/publish/${item.kind}/${item.id}" class="stack">
      <p class="muted small">Write the text once, then copy each field into YouTube Studio. Nothing is uploaded from here.${isNew ? ' This kit has not been saved yet.' : ''}</p>
      <div>
        <label for="kit-title">Title ${counter('kit-title', 100)}</label>
        <div class="row"><input id="kit-title" name="title" maxlength="100" value="${h(kit.title)}">${copy('kit-title')}</div>
      </div>
      <div>
        <label for="kit-description">Description ${counter('kit-description', 5000)}</label>
        <textarea id="kit-description" name="description" rows="7" maxlength="5000">${h(kit.description)}</textarea>
      </div>
      <div>
        <label for="kit-hashtags">Hashtags <span class="muted">(added under the description when you copy it)</span></label>
        <input id="kit-hashtags" name="hashtags" maxlength="500" value="${h(kit.hashtags)}" placeholder="#GTA6 #gaming">
        <p class="kit-copy">${copy('kit-description', 'Copy description and hashtags', 'kit-hashtags')}</p>
      </div>
      <div>
        <label for="kit-tags">Tags <span class="muted">(separated by commas)</span> ${counter('kit-tags', 500)}</label>
        <div class="row"><input id="kit-tags" name="tags" maxlength="500" value="${h(kit.tags)}" placeholder="gta 6, gameplay, heist">${copy('kit-tags')}</div>
      </div>
      ${thumbnail}
      <label class="check"><input type="checkbox" name="published" value="1"${kit.published_at ? ' checked' : ''}> I have published this on YouTube</label>
      <div class="cap-actions">
        <button class="primary" name="action" value="save">Save</button>
        <button name="action" value="defaults">Save and reuse for new kits</button>
      </div>
      <p class="muted small">“Save and reuse” also keeps the description, hashtags and tags as the starting point of every new kit.</p>
    </form>
  </section>
</div>`
  );
}

// ── Dijeljenje cijelog snimka na Shorts ───────────────────
function splitPage(ctx, { rec, bumpers, captionsProblem, ffmpegOk }) {
  const bumperOptions = bumpers.map((b) => `<option value="${b.id}">${h(b.name)} (${fmtTime(b.duration)})</option>`).join('');
  const presets = [[15, '15 s'], [30, '30 s'], [45, '45 s'], [60, '1 min'], [90, '1 min 30 s'], [180, '3 min']];
  return layout(
    ctx,
    'Split into Shorts',
    `<div class="page-head">
  <div class="head-title">${crumb(`/recordings/${rec.id}`, 'Back to the recording')}<h1>Split into Shorts</h1></div>
</div>
${ffmpegNotice(ffmpegOk)}
<section class="card form-card">
  <p class="form-source"><strong>${h(rec.name)}</strong></p>
  ${meta(fmtTime(rec.duration), `${rec.width}×${rec.height}`)}
  <form method="post" action="/recordings/${rec.id}/split" class="stack" id="split-form" data-duration="${rec.duration}">
    <div>
      <label for="split-length">Length of each part, in seconds</label>
      <div class="row">
        <input type="number" name="length" id="split-length" min="5" max="180" step="1" value="60" required>
        <div class="tl-group" role="group" aria-label="Common lengths">
          ${presets.map(([s, label]) => `<button type="button" data-split-length="${s}">${label}</button>`).join('')}
        </div>
      </div>
      <p class="muted small" id="split-count" aria-live="polite"></p>
    </div>
    <label>Layout
      <select name="layout" data-remember="split-layout">${LAYOUTS.map(([id, n]) => `<option value="${id}">${h(n)}</option>`).join('')}</select>
    </label>
    <label>Title <span class="muted">(each Short gets “- Part 1”, “- Part 2”… after it)</span>
      <input name="prefix" maxlength="80" value="${h(rec.name.replace(/\.[^.]+$/, ''))}">
    </label>

    <h2>Part number on the video</h2>
    <label class="check"><input type="checkbox" name="label" value="1" data-remember="split-label" checked> Write the part number on each Short</label>
    <div class="cap-style">
      <label>Word<input name="label_word" maxlength="20" value="PART" data-remember="split-word"></label>
      <label>Position
        <select name="label_position" data-remember="split-position"><option value="top">Top</option><option value="bottom">Bottom</option></select>
      </label>
    </div>
    <p class="muted small">Shown for the whole Short as “PART 1”, “PART 2” and so on. Keep it away from the captions: they use the position you saved on a captions page.</p>

    <h2>Then, without more clicks</h2>
    <label class="check"><input type="checkbox" name="auto_captions" value="1" data-remember="auto-captions"${captionsProblem ? ' disabled' : ''}> Add captions from the voice</label>
    ${captionsProblem ? `<p class="muted small">Captions are not available yet: ${h(captionsProblem)}</p>` : ''}
    <label>Intro<select name="auto_intro" data-remember="auto-intro"><option value="">No intro</option>${bumperOptions}</select></label>
    <label>Outro<select name="auto_outro" data-remember="auto-outro"><option value="">No outro</option>${bumperOptions}</select></label>

    <p class="muted small">Every part is cut and encoded as its own video, so a long recording takes a while. A leftover of a few seconds at the end is added to the last part.</p>
    <button class="primary big" id="split-submit">Create Shorts</button>
  </form>
</section>`
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
  icon,
  crumb,
  menu,
  emptyState,
  meta,
  layout,
  fmtTime,
  fmtSize,
  progressBar,
  studioPoll,
  recordingsPage,
  recordingPage,
  shortsPage,
  thumbnailsPage,
  thumbnailEditorPage,
  bumpersPage,
  videoNewPage,
  videoMergePage,
  captionsPage,
  kitPage,
  splitPage,
  videosPage,
  privacyPage,
  termsPage,
  errorPage,
};

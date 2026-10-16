'use strict';
// Stranice za memove: biblioteka memova i postavljanje memova u Short.
const { h, icon, crumb, emptyState, meta, layout, fmtTime, fmtSize } = require('./views');
const { MEME_POSITIONS, MEME_SIZES, MEME_MAX_SHOW, MEME_SOUND_MAX } = require('./lib/media');
const { EFFECTS } = require('./lib/effects');
const effectOptions = (value) => EFFECTS.map(([id, name]) => `<option value="${id}"${id === value ? ' selected' : ''}>${h(name)}</option>`).join('');

const notice = (ok) => (ok ? '' : '<div class="notice warn"><strong>ffmpeg is not installed.</strong> Memes can be added, but Shorts with memes cannot be created yet.</div>');

function memesPage(ctx, { memes, ffmpegOk }) {
  const tiles = memes
    .map(
      (m) => `<li class="thumb">
      ${
        m.width
          ? `<a class="thumb-frame meme-frame" href="/memes/${m.id}/file" target="_blank" rel="noopener" title="Watch “${h(m.name)}”">
        ${m.hasThumb ? `<img src="/memes/${m.id}/thumb" alt="" loading="lazy" class="fit">` : ''}
        <span class="rec-len">${m.duration.toFixed(1)} s</span>
      </a>`
          : `<div class="thumb-frame meme-frame meme-sound">${icon('memes')}<button type="button" class="meme-play" data-play-sound="/memes/${m.id}/file" aria-label="Play “${h(m.name)}”">Play</button><span class="rec-len">${m.duration.toFixed(1)} s</span></div>`
      }
      <form method="post" action="/memes/${m.id}/rename" class="meme-name"><input name="name" value="${h(m.name)}" maxlength="60" aria-label="Name of the meme" required><select name="effect" aria-label="Effect on the video">${effectOptions(m.effect || 'none')}</select><button>Save</button></form>
      ${meta(m.width ? `${m.width}×${m.height}` : '<span class="chip info">sound only</span>', fmtSize(m.size), !m.width ? '' : m.has_audio ? 'with sound' : '<span class="chip">no sound</span>')}
      <div class="short-actions">
        <form method="post" action="/memes/${m.id}/delete" data-confirm="Delete the meme “${h(m.name)}”? Shorts already created with it stay as they are."><button class="danger-outline">${icon('trash')}Delete</button></form>
      </div>
    </li>`
    )
    .join('');
  return layout(
    ctx,
    'Memes',
    `<div class="page-head">
  <h1>Memes</h1>
</div>
<p class="folder-hint lead">Your meme library. Add short reaction clips and meme sounds here once, and choose the effect each one brings to the video (a zoom for Vine boom, a shake for the metal pipe…); then open any Short, choose “Memes” and the app pops them in at the loud moments, or you place them yourself.</p>
${notice(ffmpegOk)}
<section class="card form-card">
  <h2>Add a meme</h2>
  <form id="meme-upload" class="stack">
    <label class="drop" id="meme-drop">${icon('upload')}<strong id="meme-drop-text">Choose a video, GIF or sound, or drag it here</strong><span>MP4, MOV, WebM, MKV, GIF, MP3, WAV, OGG or M4A, up to 20 seconds and 100 MB. A sound is only heard, nothing pops up.</span><input type="file" id="meme-file" accept="video/*,image/gif,audio/*" required aria-label="Meme file"></label>
    <label>Name <span class="muted">(optional)</span><input id="meme-name" maxlength="60" placeholder="Vine boom"></label>
    <p class="error" id="meme-error" hidden></p>
    <div class="progress" id="meme-progress" hidden><div class="bar"></div><span class="label"></span></div>
    <div><button class="primary">${icon('plus')}Add meme</button></div>
  </form>
</section>
${
  memes.length
    ? `<ul class="thumbs">${tiles}</ul>`
    : emptyState('memes', 'No memes yet', 'Add the reaction clips you like to use. Short ones (1 to 4 seconds) with sound work best.')
}`
  );
}

// Jedan red postavke: koji mem, kada, gdje i koliki.
function placementRow(memes, p = {}) {
  const opt = (list, value) => list.map(([id, name]) => `<option value="${id}"${String(id) === String(value) ? ' selected' : ''}>${h(name)}</option>`).join('');
  return `<li class="meme-row">
    <label>Meme<select name="meme_id" required>${[
      ['Clips', memes.filter((m) => m.width)],
      ['Sounds', memes.filter((m) => !m.width)],
    ]
      .filter(([, list]) => list.length)
      .map(
        ([group, list]) =>
          `<optgroup label="${group}">${list
            .map((m) => `<option value="${m.id}" data-src="/memes/${m.id}/file" data-duration="${m.duration}"${m.width ? '' : ' data-sound="1"'} data-effect="${m.effect || 'none'}"${m.id === Number(p.meme_id) ? ' selected' : ''}>${h(m.name)} (${m.duration.toFixed(1)} s)</option>`)
            .join('')}</optgroup>`
      )
      .join('')}</select></label>
    <div class="meme-at">
      <label>At (seconds)<input name="at" type="number" min="0" step="0.1" value="${p.at ?? ''}" required></label>
      <button type="button" data-meme-now title="Use the time of the player">Now</button>
    </div>
    <label>Where<select name="position">${opt(MEME_POSITIONS, p.position || 'center')}</select></label>
    <label>Size<select name="size">${opt(Object.keys(MEME_SIZES).map((k) => [k, k[0].toUpperCase() + k.slice(1)]), p.size || 'medium')}</select></label>
    <label>Effect<select name="effect">${effectOptions(p.effect || (memes.find((m) => m.id === Number(p.meme_id)) || memes[0] || {}).effect || 'none')}</select></label>
    <button type="button" class="icon-only meme-remove" data-meme-remove aria-label="Remove this meme">${icon('close')}</button>
  </li>`;
}

function clipMemesPage(ctx, { clip, memes, placements, suggested, duration, ffmpegOk }) {
  const body = !memes.length
    ? emptyState('memes', 'Your meme library is empty', 'Add a few reaction clips first; then come back to put them in this Short.', '<a class="button primary" href="/memes">Go to Memes</a>')
    : `<div class="cap-layout">
  <section class="card">
    <div class="meme-stage" id="meme-stage">
      <video class="kit-video" id="meme-player" src="/clips/${clip.id}/file" controls preload="metadata" playsinline></video>
    </div>
    ${meta(`${duration.toFixed(1)} s`, 'the memes play over the video as a preview')}
  </section>
  <section class="card">
    <form method="post" action="/clips/${clip.id}/memes" class="stack" id="meme-form" data-duration="${duration}" data-max-show="${MEME_MAX_SHOW}" data-max-sound="${MEME_SOUND_MAX}">
      <div class="list-head">
        <h2>Memes in this Short</h2>
        <a class="button" href="/clips/${clip.id}/memes?suggest=1">${icon('scan')}Suggest spots</a>
      </div>
      ${suggested ? `<p class="notice">${placements.length ? `The app picked ${placements.length} loud ${placements.length === 1 ? 'moment' : 'moments'} and a meme for each. Play the Short to see them, then change what you like.` : 'No loud moment stands out in this Short. Place the memes yourself.'}</p>` : ''}
      <ol class="meme-rows" id="meme-rows">${placements.map((p) => placementRow(memes, p)).join('')}</ol>
      <p class="muted small" id="meme-empty"${placements.length ? ' hidden' : ''}>No memes yet. Pause the video where one should pop in and select “Add meme here”.</p>
      <div><button type="button" id="meme-add">${icon('plus')}Add meme here</button></div>
      <p class="muted small">Each meme pops in with a short slide and fade, plays for up to ${MEME_MAX_SHOW} seconds over the game, and the game sound is lowered while it plays. A sound only plays (up to ${MEME_MAX_SHOW + 3} seconds); where and size do not matter for it. Put a sound and a clip at the same second to combine them. The effect (zoom, shake…) moves the game picture itself while the meme plays; each meme brings its usual effect, which you can change here. A new Short is created; this one stays as it is.</p>
      <button class="primary big"${ffmpegOk ? '' : ' disabled'}>${icon('split')}Create Short with memes</button>
    </form>
    <template id="meme-row-template">${placementRow(memes)}</template>
  </section>
</div>`;
  return layout(
    ctx,
    `Memes · ${clip.title}`,
    `<div class="page-head">
  <div class="head-title">${crumb('/shorts', 'Shorts')}<h1>Memes</h1></div>
</div>
<p class="folder-hint lead">${h(clip.title)}</p>
${notice(ffmpegOk)}
${body}`
  );
}

module.exports = { memesPage, clipMemesPage, fmtTime };

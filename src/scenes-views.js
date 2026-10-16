'use strict';
// Stranica "Shorts from scenes": kompilacija razbijena na scene, svaka scena postaje Short svoje dužine.
const { h, icon, crumb, emptyState, layout, fmtTime, progressBar, studioPoll, watermarkCheck } = require('./views');
const { LAYOUTS } = require('./lib/media');
const { SENSITIVITY, MIN_LENGTHS, MAX_SHORT } = require('./lib/scenes');

function scenesPage(ctx, { rec, scan, scenes, options, captionsProblem, ffmpegOk }) {
  const status = scan ? scan.status : 'pending';
  const busy = status === 'pending' || status === 'scanning';
  const option = (list, value) => list.map(([id, name]) => `<option value="${id}"${String(id) === String(value) ? ' selected' : ''}>${h(name)}</option>`).join('');
  let body;
  if (status === 'failed') {
    body = `<section class="card">${emptyState('recordings', 'The video could not be scanned', h(scan.error || 'Unknown error.'), `<form method="post" action="/recordings/${rec.id}/scenes/scan"><button class="primary">Try again</button></form>`)}</section>`;
  } else if (!scenes) {
    body = `<section class="card" data-poll-key="scenes:${rec.id}" data-state="${h(status)}">
    <h2>Finding the cuts</h2>
    <p class="muted">The app looks at every frame for the cuts between clips. A ten-minute compilation takes about a minute; you can leave this page.</p>
    ${progressBar(scan ? scan.progress : 0)}
    ${studioPoll(busy && ffmpegOk, '', '')}
  </section>`;
  } else {
    const rows = scenes
      .map((s, i) => {
        const length = s.end - s.start;
        const long = length > MAX_SHORT;
        return `<li class="sc-row">
        <label class="sc-pick"><input type="checkbox" name="scene" value="${i}" checked aria-label="Make a Short of scene ${i + 1}"></label>
        <button type="button" class="sc-thumb" data-scene-play="${s.start}" data-scene-end="${s.end}" title="Play scene ${i + 1}"><img src="/recordings/${rec.id}/frame/${Math.min(Math.floor(rec.duration), Math.floor(s.start + Math.min(1, length / 2)))}" alt="" loading="lazy"><span>${icon('shorts')}</span></button>
        <div class="sc-body">
          <strong>Scene ${i + 1}</strong>
          <span class="muted small">${fmtTime(s.start)} – ${fmtTime(s.end)}</span>
          <span class="chip${long ? ' warn' : ''}">${length.toFixed(1)} s${long ? ` → ${Math.ceil(length / MAX_SHORT)} Shorts` : ''}</span>
        </div>
        ${i < scenes.length - 1 ? `<label class="check sc-join" title="Use when one funny clip was split in two"><input type="checkbox" name="join" value="${i}"> Join with the next</label>` : ''}
      </li>`;
      })
      .join('');
    body = `<form method="get" action="/recordings/${rec.id}/scenes" class="card ae-options">
    <label>Cuts<select name="sensitivity">${option(Object.entries(SENSITIVITY).map(([id, s]) => [id, s.label]), options.sensitivity)}</select></label>
    <label>Shortest Short<select name="min">${option(MIN_LENGTHS, options.minLength)}</select></label>
    <span></span>
    <button>${icon('scan')}Find the scenes again</button>
  </form>

  <form method="post" action="/recordings/${rec.id}/scenes" class="grid" id="scene-form">
    <input type="hidden" name="sensitivity" value="${h(options.sensitivity)}">
    <input type="hidden" name="min" value="${options.minLength}">
    <section class="card sg-player stack">
      <video class="player" id="scene-player" src="/recordings/${rec.id}/file" controls preload="metadata"></video>
      <h2>Every Short gets</h2>
      ${
        captionsProblem
          ? `<p class="muted small wm-off">${icon('captions')}Captions are not available yet: ${h(captionsProblem)}</p>`
          : '<label class="check"><input type="checkbox" name="auto_captions" value="1" data-remember="scene-captions" checked> Captions from the voice <span class="muted">(in the style you last saved)</span></label>'
      }
      ${watermarkCheck(ctx, true, 'scene-logo')}
      <div class="cap-style two">
        <label>Layout<select name="layout" data-remember="clip-layout">${option(LAYOUTS, 'blur')}</select></label>
        <label>Title <span class="muted">(+ #1, #2…)</span><input name="prefix" maxlength="80" value="${h(options.prefix)}"></label>
      </div>
      <p class="muted small">No Short is shorter than ${options.minLength} s: a shorter scene is joined with its shorter neighbour, also when you untick that one. A scene longer than 3 minutes is split into equal parts. The Shorts appear under Shorts, finished, where you can add memes.</p>
      <button class="primary big" id="scene-submit"${ffmpegOk ? '' : ' disabled'}>${icon('split')}<span>Create ${scenes.length} Shorts</span></button>
    </section>
    <section class="card">
      <div class="list-head"><h2>${scenes.length} ${scenes.length === 1 ? 'scene' : 'scenes'}</h2><label class="check"><input type="checkbox" id="scene-all" checked> All</label></div>
      <p class="muted small">Select a picture to play that scene. If one clip was cut in two, tick “Join with the next”; untick scenes you do not want.</p>
      <ol class="sc-list">${rows}</ol>
    </section>
  </form>`;
  }
  return layout(
    ctx,
    `Shorts from scenes · ${rec.name}`,
    `<div class="page-head">
  <div class="head-title">${crumb(`/recordings/${rec.id}`, 'Back to the recording')}<h1>Shorts from scenes</h1></div>
</div>
<p class="folder-hint lead">${h(rec.name)} · ${fmtTime(rec.duration)}. For compilations: the app finds where one clip ends and the next begins, and every clip becomes its own Short, as long as the clip itself.</p>
${body}`
  );
}

module.exports = { scenesPage };

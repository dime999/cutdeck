'use strict';
// Stranica Auto edit: plan dugog videa bez komentara (šta ostaje, najava, poglavlja) i pravljenje videa.
const { h, icon, crumb, emptyState, meta, layout, fmtTime, progressBar, studioPoll, watermarkCheck } = require('./views');
const { TIGHTNESS, TARGETS, stamp } = require('./lib/autoedit');

const pct = (t, total) => `${((t / total) * 100).toFixed(3)}%`;

function autoeditPage(ctx, { rec, activity, plan, names, options, bumpers, moments, ffmpegOk }) {
  const status = activity ? activity.status : 'pending';
  const busy = status === 'pending' || status === 'scanning';
  let body;
  if (status === 'failed') {
    body = `<section class="card">${emptyState('recordings', 'The recording could not be analyzed', h(activity.error || 'Unknown error.'), `<form method="post" action="/recordings/${rec.id}/autoedit/analyze"><button class="primary">Try again</button></form>`)}</section>`;
  } else if (!plan) {
    body = `<section class="card" data-poll-key="activity:${rec.id}" data-state="${h(status)}">
    <h2>Looking through the recording</h2>
    <p class="muted">The app checks every second for movement, loading screens and menus. A one-hour recording takes a few minutes; you can leave this page.</p>
    ${progressBar(activity ? activity.progress : 0)}
    ${studioPoll(busy && ffmpegOk, '', '')}
  </section>`;
  } else {
    const total = plan.duration;
    const kept = plan.segments
      .map((s) => `<span class="ae-keep" style="left:${pct(s.start, total)};width:${pct(s.end - s.start, total)}" title="${fmtTime(s.start)} – ${fmtTime(s.end)}"></span>`)
      .join('');
    const hook = plan.hook ? `<span class="ae-hook" style="left:${pct(plan.hook.start, total)};width:${pct(plan.hook.end - plan.hook.start, total)}" title="Hook: ${fmtTime(plan.hook.start)}"></span>` : '';
    const marks = plan.chapters
      .filter((c) => !c.highlight)
      .map((c) => `<span class="ae-mark" style="left:${pct(c.source, total)}"></span>`)
      .join('');
    const option = (list, value) => list.map(([id, name]) => `<option value="${id}"${String(id) === String(value) ? ' selected' : ''}>${h(name)}</option>`).join('');
    const bumperOptions = (value) => `<option value="">None</option>${bumpers.map((b) => `<option value="${b.id}"${String(b.id) === String(value) ? ' selected' : ''}>${h(b.name)} (${fmtTime(b.duration)})</option>`).join('')}`;
    const removedShare = Math.round((plan.removed / plan.duration) * 100);

    body = `<form method="get" action="/recordings/${rec.id}/autoedit" class="card ae-options" id="ae-options">
    <label>Length<select name="target">${option(TARGETS, options.target)}</select></label>
    <label>How much to cut<select name="tightness">${option(Object.entries(TIGHTNESS).map(([id, t]) => [id, t.label]), options.tightness)}</select></label>
    <label class="check"><input type="checkbox" name="hook" value="1"${options.hook ? ' checked' : ''}> Open with a ${12}-second hook</label>
    <input type="hidden" name="set" value="1">
    <button>${icon('scan')}Update the plan</button>
  </form>

  <section class="card">
    <div class="ae-stats">
      <div><span class="muted small">Recording</span><strong>${fmtTime(plan.duration)}</strong></div>
      <div><span class="muted small">Video</span><strong>${fmtTime(plan.length)}</strong></div>
      <div><span class="muted small">Cut out</span><strong>${fmtTime(plan.removed)} <span class="muted">(${removedShare}%)</span></strong></div>
      <div><span class="muted small">Cuts</span><strong>${plan.segments.length}</strong></div>
    </div>
    <div class="ae-bar" aria-label="What stays from the recording">${kept}${hook}${marks}</div>
    <p class="muted small ae-legend"><span class="ae-dot keep"></span>Stays <span class="ae-dot cut"></span>Cut out (loading, menus, idle walking) ${plan.hook ? '<span class="ae-dot hook"></span>Hook, shown first' : ''} <span class="ae-dot mark"></span>New chapter</p>
    <p class="muted small">Watch the recording on its page if a cut looks wrong; the plan only looks at movement and game sound, it cannot tell a cutscene you want from idle time.</p>
  </section>

  <form method="post" action="/recordings/${rec.id}/autoedit" class="grid">
    <input type="hidden" name="target" value="${h(options.target)}">
    <input type="hidden" name="tightness" value="${h(options.tightness)}">
    <input type="hidden" name="hook" value="${options.hook ? '1' : ''}">
    <section class="card">
      <h2>Chapters</h2>
      <p class="muted small">They go into the description, so viewers can jump to a mission. Name them after the missions; YouTube shows chapters when there are at least three.</p>
      <ol class="ae-chapters">${plan.chapters
        .map((c, i) => `<li><span class="ae-time">${stamp(c.at)}</span><input name="chapter" value="${h(names[i])}" maxlength="80" aria-label="Chapter at ${stamp(c.at)}"></li>`)
        .join('')}</ol>
      ${
        moments.length
          ? `<h2>Thumbnail ideas</h2>
      <p class="muted small">The busiest moments of the video. Open one in the thumbnail editor to add text.</p>
      <div class="ae-thumbs">${moments
        .map((s) => `<a href="/recordings/${rec.id}/thumbnail?t=${s}" title="Make a thumbnail from ${fmtTime(s)}"><img src="/recordings/${rec.id}/frame/${s}" alt="Frame at ${fmtTime(s)}" loading="lazy"><span>${fmtTime(s)}</span></a>`)
        .join('')}</div>`
          : ''
      }
    </section>
    <section class="card stack">
      <h2>The video</h2>
      <label>Title<input name="title" maxlength="100" value="${h(options.title)}" required></label>
      ${watermarkCheck(ctx)}
      <div class="cap-style two">
        <label>Intro<select name="intro" data-remember="ae-intro">${bumperOptions('')}</select></label>
        <label>Outro<select name="outro" data-remember="ae-outro">${bumperOptions('')}</select></label>
      </div>
      <label>Quality<select name="quality" data-remember="ae-quality">
        <option value="1080">1080p (faster)</option>
        <option value="source">Same as the recording, up to 4K (slow)</option>
      </select></label>
      <p class="muted small">The game sound is evened out to the loudness YouTube recommends. HDR recordings (PS5) are converted so the colours do not look washed out. The finished video appears under Videos, with its publish kit already filled in (title, description with chapters).</p>
      <button class="primary big"${ffmpegOk ? '' : ' disabled'}>${icon('split')}Create the video (${fmtTime(plan.length)})</button>
    </section>
  </form>`;
  }

  return layout(
    ctx,
    `Auto edit · ${rec.name}`,
    `<div class="page-head">
  <div class="head-title">${crumb(`/recordings/${rec.id}`, 'Back to the recording')}<h1>Auto edit</h1></div>
</div>
<p class="folder-hint lead">${h(rec.name)} · ${fmtTime(rec.duration)}. A long no-commentary video: loading screens, menus and idle stretches are cut out, the best moment opens the video, and the missions become chapters.</p>
${body}`
  );
}

module.exports = { autoeditPage, meta };

'use strict';

// Lokalno vrijeme za sve <time data-local>
function localizeTimes(root) {
  for (const el of root.querySelectorAll('time[data-local]')) {
    const d = new Date(el.dataset.local);
    if (!Number.isNaN(d.getTime())) {
      el.textContent = d.toLocaleString(undefined, { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  }
}
localizeTimes(document);

// Potvrda prije opasnih akcija
document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-confirm]');
  if (form && !confirm(form.dataset.confirm)) e.preventDefault();
});

// ── Snimci i Shorts ───────────────────────────────────────
// Dok neki posao traje, osvježava trake napretka; kad se stanje promijeni,
// zamjenjuje samo [data-live] dijelove da forma i player ostanu netaknuti.
const studioPoll = document.querySelector('[data-studio-poll]');
if (studioPoll) {
  const id = studioPoll.dataset.studioPoll;
  const statusUrl = `/api/studio/status${id ? `?recording=${id}` : ''}`;

  async function refreshLive() {
    const r = await fetch(location.href);
    if (!r.ok) return;
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    for (const el of document.querySelectorAll('[data-live]')) {
      const fresh = doc.getElementById(el.id);
      if (!fresh) continue;
      if (fresh.dataset.state) el.dataset.state = fresh.dataset.state;
      // Dio koji se nije promijenio ostaje netaknut, da se ne prekine rad na traci.
      if (fresh.dataset.rev && fresh.dataset.rev === el.dataset.rev) continue;
      el.innerHTML = fresh.innerHTML;
      if (fresh.dataset.rev) el.dataset.rev = fresh.dataset.rev;
      localizeTimes(el);
    }
    document.dispatchEvent(new Event('live:refresh'));
  }

  const timer = setInterval(async () => {
    try {
      const r = await fetch(statusUrl);
      if (!r.ok) return;
      let changed = false;
      for (const item of (await r.json()).items) {
        const el = document.querySelector(`[data-poll-key="${item.key}"]`);
        if (!el) continue;
        if (el.dataset.state !== item.status) changed = true;
        const bar = el.querySelector('.progress .bar');
        if (bar) {
          bar.style.width = `${item.progress}%`;
          el.querySelector('.progress .label').textContent = `${item.progress}%`;
        }
      }
      if (changed) await refreshLive();
      if (!document.querySelector('[data-studio-poll]')) clearInterval(timer);
    } catch {}
  }, 2000);
}

const player = document.getElementById('player');
if (player) {
  const MIN_LENGTH = 3; // isto ograničenje kao na serveru
  const MAX_LENGTH = 180;
  const MAX_ZOOM = 64;

  const fmtTime = (t, decimals = 0) => {
    const unit = 10 ** decimals;
    t = Math.floor(t * unit + 1e-6) / unit; // bez zaokruživanja naviše, da ne ispadne „0:60“
    const sec = (t % 60).toFixed(decimals).padStart(decimals ? decimals + 3 : 2, '0');
    const min = Math.floor((t % 3600) / 60);
    return t >= 3600 ? `${Math.floor(t / 3600)}:${String(min).padStart(2, '0')}:${sec}` : `${min}:${sec}`;
  };
  const parseTime = (text) => {
    const parts = text.trim().split(':');
    if (!parts[0] || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
    return parts.reduce((total, p) => total * 60 + Number(p), 0);
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const startInput = document.getElementById('clip-start');
  const endInput = document.getElementById('clip-end');
  // Traka se zamjenjuje pri osvježavanju, pa se njeni dijelovi traže svaki put iznova.
  const el = (id) => document.getElementById(id);
  const duration = () => Number(el('timeline')?.dataset.duration) || 0;

  // Izbor je ono što piše u formi; traka ga samo prikazuje i mijenja.
  function selection() {
    const start = parseTime(startInput.value);
    const end = parseTime(endInput.value);
    return end > start ? { start, end } : null;
  }

  function setSelection(start, end) {
    const d = duration();
    const length = clamp(end - start, MIN_LENGTH, Math.min(MAX_LENGTH, d));
    start = clamp(start, 0, d - length);
    startInput.value = fmtTime(start, 1);
    endInput.value = fmtTime(start + length, 1);
    showSelection();
  }

  function showSelection() {
    const box = el('tl-selection');
    if (!box) return;
    const sel = selection();
    box.hidden = !sel || !duration();
    if (!box.hidden) {
      box.style.left = `${(sel.start / duration()) * 100}%`;
      box.style.width = `${((sel.end - sel.start) / duration()) * 100}%`;
      // Preuzak izbor nema mjesta za ručke: može se samo pomjerati dok se traka ne uveća.
      box.classList.toggle('is-narrow', box.offsetWidth < 30);
    }
    for (const m of document.querySelectorAll('.moment')) {
      m.classList.toggle('is-picked', Boolean(sel) && Number(m.dataset.start) === sel.start && Number(m.dataset.end) === sel.end);
    }
    for (const b of document.querySelectorAll('[data-length]')) {
      b.classList.toggle('is-picked', Boolean(sel) && Math.abs(sel.end - sel.start - Number(b.dataset.length)) < 0.05);
    }
  }
  startInput.addEventListener('input', showSelection);
  endInput.addEventListener('input', showSelection);

  // ── Zum: traka se širi unutar okvira koji se vodoravno pomjera ──
  let zoom = 1;
  function applyZoom(next, centerTime) {
    const scroll = el('tl-scroll');
    const inner = el('tl-inner');
    if (!scroll || !inner) return;
    zoom = clamp(next, 1, MAX_ZOOM);
    inner.style.width = `${zoom * 100}%`;
    if (centerTime !== undefined && duration()) {
      scroll.scrollLeft = (centerTime / duration()) * inner.scrollWidth - scroll.clientWidth / 2;
    }
    drawScale();
    showSelection();
  }

  // Oznake vremena: razmak se bira tako da ih u vidljivom dijelu bude oko osam.
  function drawScale() {
    const scale = el('tl-scale');
    const d = duration();
    if (!scale || !d) return;
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
    const step = steps.find((s) => s >= d / zoom / 8) || 3600;
    scale.textContent = '';
    for (let t = 0; t < d - step * 0.4; t += step) {
      const tick = document.createElement('span');
      tick.textContent = fmtTime(t);
      tick.style.left = `${(t / d) * 100}%`;
      scale.append(tick);
    }
    scale.classList.add('is-drawn');
  }

  const timeAt = (clientX) => {
    const box = el('timeline').getBoundingClientRect();
    return clamp(((clientX - box.left) / box.width) * duration(), 0, duration());
  };

  // ── Reprodukcija ──
  let stopAt = null;
  let lastSeek = 0;
  // Dok se vuče, player prikazuje kadar na rubu koji se pomjera.
  function scrub(time) {
    if (Date.now() - lastSeek < 120) return;
    lastSeek = Date.now();
    stopAt = null;
    player.pause();
    player.currentTime = time;
  }
  function playSelection() {
    const sel = selection();
    if (!sel) return;
    player.currentTime = sel.start;
    stopAt = sel.end;
    player.play().catch(() => {});
  }
  player.addEventListener('timeupdate', () => {
    const head = el('tl-playhead');
    if (head && duration()) head.style.left = `${Math.min(100, (player.currentTime / duration()) * 100)}%`;
    if (stopAt !== null && player.currentTime >= stopAt) {
      player.pause();
      stopAt = null;
    }
    // Uvećana traka prati reprodukciju.
    const scroll = el('tl-scroll');
    if (scroll && head && !drag && !player.paused && zoom > 1) {
      const x = head.offsetLeft - scroll.scrollLeft;
      if (x < 0 || x > scroll.clientWidth) scroll.scrollLeft = head.offsetLeft - scroll.clientWidth * 0.1;
    }
  });

  // ── Vučenje po traci: novi izbor, pomjeranje ili skraćivanje ──
  let drag = null;
  document.addEventListener('pointerdown', (e) => {
    const bar = e.target.closest('#timeline');
    if (!bar || e.button !== 0 || e.target.closest('.tl-mark')) return;
    const sel = selection();
    const handle = e.target.closest('.tl-handle');
    const time = timeAt(e.clientX);
    if (handle && sel) drag = { mode: handle.dataset.edge, sel };
    else if (e.target.closest('#tl-selection') && sel) drag = { mode: 'move', sel, grab: time - sel.start };
    else drag = { mode: 'new', anchor: time, x: e.clientX, moved: false };
    e.preventDefault();
    try {
      bar.setPointerCapture(e.pointerId);
    } catch {} // vučenje radi i bez hvatanja pokazivača, dok je miš iznad stranice
  });

  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const scroll = el('tl-scroll');
    const edge = scroll.getBoundingClientRect();
    if (e.clientX < edge.left + 24) scroll.scrollLeft -= 12;
    if (e.clientX > edge.right - 24) scroll.scrollLeft += 12;

    const time = timeAt(e.clientX);
    const d = duration();
    if (drag.mode === 'new') {
      if (!drag.moved && Math.abs(e.clientX - drag.x) < 5) return;
      drag.moved = true;
      // Sidro ostaje na mjestu; izbor raste na stranu na koju se vuče.
      const length = clamp(Math.abs(time - drag.anchor), MIN_LENGTH, MAX_LENGTH);
      const start = time >= drag.anchor ? drag.anchor : drag.anchor - length;
      setSelection(start, start + length);
      scrub(time >= drag.anchor ? start + length : start);
    } else if (drag.mode === 'move') {
      const length = drag.sel.end - drag.sel.start;
      const start = clamp(time - drag.grab, 0, d - length);
      setSelection(start, start + length);
      scrub(start);
    } else if (drag.mode === 'start') {
      const start = clamp(time, Math.max(0, drag.sel.end - MAX_LENGTH), drag.sel.end - MIN_LENGTH);
      setSelection(start, drag.sel.end);
      scrub(start);
    } else {
      const end = clamp(time, drag.sel.start + MIN_LENGTH, Math.min(d, drag.sel.start + MAX_LENGTH));
      setSelection(drag.sel.start, end);
      scrub(end);
    }
  });

  const endDrag = (e) => {
    if (!drag) return;
    const finished = drag;
    drag = null;
    lastSeek = 0;
    if (finished.mode === 'new' && !finished.moved) {
      // Običan klik: premotaj na to mjesto.
      stopAt = null;
      player.currentTime = timeAt(e.clientX);
    } else {
      const sel = selection();
      if (sel) player.currentTime = finished.mode === 'end' ? sel.end : sel.start;
    }
  };
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  // Strelice pomjeraju izbor za sekundu (uz Shift za desetinku).
  document.addEventListener('keydown', (e) => {
    if (e.target.id !== 'tl-selection' || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const sel = selection();
    if (!sel) return;
    const step = (e.shiftKey ? 0.1 : 1) * (e.key === 'ArrowLeft' ? -1 : 1);
    setSelection(sel.start + step, sel.end + step);
    player.currentTime = selection().start;
    e.preventDefault();
  });

  document.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    const sel = selection();
    if (button.hasAttribute('data-pick')) {
      // Predloženi trenutak: upiši ga u formu i pusti ga do kraja.
      startInput.value = fmtTime(Number(button.dataset.start));
      endInput.value = fmtTime(Number(button.dataset.end));
      showSelection();
      playSelection();
    } else if (button.dataset.set) {
      el(button.dataset.set).value = fmtTime(player.currentTime, 1);
      showSelection();
    } else if (button.dataset.length) {
      // Zadana dužina: od početka izbora, ili od mjesta gdje je player ako izbora nema.
      const start = sel ? sel.start : player.currentTime;
      setSelection(start, start + Number(button.dataset.length));
      player.currentTime = selection().start;
    } else if (button.hasAttribute('data-play-selection')) {
      playSelection();
    } else if (button.dataset.zoom === 'fit') {
      // Izbor zauzme oko 40% vidljive trake.
      if (sel) applyZoom((duration() * 0.4) / (sel.end - sel.start), (sel.start + sel.end) / 2);
    } else if (button.dataset.zoom) {
      applyZoom(button.dataset.zoom === 'in' ? zoom * 2 : zoom / 2, sel ? (sel.start + sel.end) / 2 : player.currentTime);
    }
  });

  // Traka je upravo iscrtana ili zamijenjena: vrati joj zum i izbor.
  const setupTimeline = () => {
    applyZoom(zoom);
    showSelection();
  };
  document.addEventListener('live:refresh', setupTimeline);
  setupTimeline();
}

// Pregled Shorta dok je miš iznad njega
document.addEventListener(
  'mouseenter',
  (e) => {
    const video = e.target.matches?.('.short-frame') && e.target.querySelector('video');
    if (video) video.play().catch(() => {});
  },
  true
);
document.addEventListener(
  'mouseleave',
  (e) => {
    const video = e.target.matches?.('.short-frame') && e.target.querySelector('video');
    if (video) {
      video.pause();
      video.load(); // vraća sličicu
    }
  },
  true
);


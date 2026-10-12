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
      el.innerHTML = fresh.innerHTML;
      if (fresh.dataset.state) el.dataset.state = fresh.dataset.state;
      localizeTimes(el);
    }
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
  const fmtTime = (t, decimals = 0) => {
    const unit = 10 ** decimals;
    t = Math.floor(t * unit) / unit; // bez zaokruživanja naviše, da ne ispadne „0:60“
    const sec = (t % 60).toFixed(decimals).padStart(decimals ? decimals + 3 : 2, '0');
    const min = Math.floor((t % 3600) / 60);
    return t >= 3600 ? `${Math.floor(t / 3600)}:${String(min).padStart(2, '0')}:${sec}` : `${min}:${sec}`;
  };
  const parseTime = (text) => {
    const parts = text.trim().split(':');
    if (!parts[0] || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
    return parts.reduce((total, p) => total * 60 + Number(p), 0);
  };
  const startInput = document.getElementById('clip-start');
  const endInput = document.getElementById('clip-end');
  // Traka se zamjenjuje pri osvježavanju, pa se njeni dijelovi traže svaki put iznova.
  const duration = () => Number((document.getElementById('timeline') || {}).dataset?.duration) || 0;

  // Okvir na traci prati početak i kraj upisane u formu.
  function showSelection() {
    const box = document.getElementById('tl-selection');
    if (!box) return;
    const start = parseTime(startInput.value);
    const end = parseTime(endInput.value);
    box.hidden = !(end > start) || !duration();
    if (!box.hidden) {
      box.style.left = `${(start / duration()) * 100}%`;
      box.style.width = `${((end - start) / duration()) * 100}%`;
    }
    for (const m of document.querySelectorAll('.moment')) {
      m.classList.toggle('is-picked', Number(m.dataset.start) === start && Number(m.dataset.end) === end);
    }
  }
  startInput.addEventListener('input', showSelection);
  endInput.addEventListener('input', showSelection);

  let stopAt = null;
  player.addEventListener('timeupdate', () => {
    const head = document.getElementById('tl-playhead');
    if (head && duration()) head.style.left = `${Math.min(100, (player.currentTime / duration()) * 100)}%`;
    if (stopAt !== null && player.currentTime >= stopAt) {
      player.pause();
      stopAt = null;
    }
  });

  document.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (button && button.hasAttribute('data-pick')) {
      // Predloženi trenutak: upiši ga u formu i pusti ga do kraja.
      startInput.value = fmtTime(Number(button.dataset.start));
      endInput.value = fmtTime(Number(button.dataset.end));
      showSelection();
      player.currentTime = Number(button.dataset.start);
      stopAt = Number(button.dataset.end);
      player.play().catch(() => {});
    } else if (button && button.dataset.set) {
      document.getElementById(button.dataset.set).value = fmtTime(player.currentTime, 1);
      showSelection();
    } else if (!button) {
      const bar = e.target.closest('#timeline');
      if (!bar) return;
      const box = bar.getBoundingClientRect();
      stopAt = null;
      player.currentTime = ((e.clientX - box.left) / box.width) * duration();
    }
  });
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


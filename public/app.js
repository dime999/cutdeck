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

// Potvrda prije opasnih akcija: prozor u stilu aplikacije umjesto sistemskog.
// Tekst iz data-confirm se dijeli na pitanje (do prvog upitnika) i objašnjenje.
const confirmDialog = document.createElement('dialog');
confirmDialog.className = 'confirm';
confirmDialog.innerHTML = `<form method="dialog">
  <h2 id="confirm-title"></h2>
  <p id="confirm-text"></p>
  <div class="confirm-actions">
    <button value="cancel">Cancel</button>
    <button value="ok" id="confirm-ok"></button>
  </div>
</form>`;
confirmDialog.setAttribute('aria-labelledby', 'confirm-title');
document.body.append(confirmDialog);

let confirmed = null; // forma čije je slanje korisnik upravo potvrdio
document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-confirm]');
  if (!form) return;
  if (confirmed === form) {
    confirmed = null;
    return;
  }
  e.preventDefault();
  const submitter = e.submitter;
  const message = form.dataset.confirm;
  const cut = message.indexOf('?') + 1;
  confirmDialog.querySelector('#confirm-title').textContent = cut ? message.slice(0, cut) : message;
  confirmDialog.querySelector('#confirm-text').textContent = cut ? message.slice(cut).trim() : '';
  const ok = confirmDialog.querySelector('#confirm-ok');
  // Dugme za potvrdu nosi naziv akcije koju potvrđuje, npr. „Delete“.
  ok.textContent = (submitter && submitter.textContent.trim()) || 'Continue';
  ok.className = submitter && submitter.classList.contains('danger-outline') ? 'danger' : 'primary';
  confirmDialog.onclose = () => {
    if (confirmDialog.returnValue !== 'ok') return;
    confirmed = form;
    form.requestSubmit(submitter && submitter.form === form ? submitter : undefined);
  };
  confirmDialog.returnValue = '';
  confirmDialog.showModal();
  confirmDialog.querySelector('button[value="cancel"]').focus(); // sigurniji izbor je unaprijed označen
});

// ── Tabovi: dijelovi jedne stranice; izabrani se pamti u adresi (#ime) ──
for (const bar of document.querySelectorAll('[data-tabs]')) {
  const tabs = [...bar.querySelectorAll('[data-tab]')];
  const names = tabs.map((t) => t.dataset.tab);
  const show = (name, remember) => {
    for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
    for (const n of names) {
      const panel = document.querySelector(`[data-panel="${n}"]`);
      if (!panel) continue;
      panel.hidden = n !== name;
      if (n !== name) for (const media of panel.querySelectorAll('video')) media.pause();
    }
    if (remember) history.replaceState(null, '', `${location.pathname}${location.search}#${name}`);
  };
  const asked = location.hash.slice(1);
  show(names.includes(asked) ? asked : bar.dataset.default || names[0], false);
  window.addEventListener('hashchange', () => {
    if (names.includes(location.hash.slice(1))) show(location.hash.slice(1), false);
  });
  bar.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) show(tab.dataset.tab, true);
  });
  // Dugme u sadržaju koje vodi na drugi tab, npr. iz prazne liste.
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-tab-go]');
    if (go && names.includes(go.dataset.tabGo)) {
      show(go.dataset.tabGo, true);
      bar.scrollIntoView({ block: 'nearest' });
    }
  });
}

// ── Označavanje više Shortsa za brisanje ──────────────────
function updateBulk() {
  const form = document.getElementById('bulk-form');
  if (!form) return;
  const boxes = [...document.querySelectorAll('input[name="ids"][form="bulk-form"]')];
  const picked = boxes.filter((b) => b.checked).length;
  for (const b of boxes) b.closest('.short')?.classList.toggle('is-selected', b.checked);
  const all = document.getElementById('bulk-all');
  all.checked = boxes.length > 0 && picked === boxes.length;
  all.indeterminate = picked > 0 && picked < boxes.length;
  document.getElementById('bulk-count').textContent = picked ? `${picked} selected` : 'None selected';
  document.getElementById('bulk-delete').disabled = !picked;
  const noun = form.dataset.noun || 'Short';
  form.dataset.confirm = `Delete ${picked} ${picked === 1 ? noun : `${noun}s`}? The video ${picked === 1 ? 'file is' : 'files are'} deleted too, and any that are still being created are cancelled.`;
}
document.addEventListener('change', (e) => {
  if (e.target.id === 'bulk-all') {
    for (const b of document.querySelectorAll('input[name="ids"][form="bulk-form"]')) b.checked = e.target.checked;
  }
  if (e.target.id === 'bulk-all' || e.target.name === 'ids') updateBulk();
});
document.addEventListener('live:refresh', updateBulk);
updateBulk();

// ── Snimci i Shorts ───────────────────────────────────────
// Dok neki posao traje, osvježava trake napretka; kad se stanje promijeni,
// zamjenjuje samo [data-live] dijelove da forma i player ostanu netaknuti.
const studioPoll = document.querySelector('[data-studio-poll]');
if (studioPoll) {
  const id = studioPoll.dataset.studioPoll;
  // Stranica kampanje pita samo za svoje klipove.
  const campaign = document.getElementById('clipping-form')?.action.match(/\/clipping\/(\d+)\//)?.[1] || location.pathname.match(/^\/clipping\/(\d+)$/)?.[1];
  const statusUrl = `/api/studio/status${id ? `?recording=${id}` : campaign ? `?campaign=${campaign}` : ''}`;

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
      // Označene kvačice (npr. Shorts izabrani za brisanje) preživljavaju osvježavanje.
      const checked = [...el.querySelectorAll('input[type="checkbox"]:checked')].map((b) => `${b.name}=${b.value}`);
      el.innerHTML = fresh.innerHTML;
      for (const b of el.querySelectorAll('input[type="checkbox"]')) if (checked.includes(`${b.name}=${b.value}`)) b.checked = true;
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
      const items = (await r.json()).items;
      // Stavka vrste koju ova stranica nabraja a nema je na stranici (ili obrnuto) znači da se lista promijenila:
      // npr. pojavio se Short sa titlovima ili je međukorak obrisan.
      const marker = document.querySelector('[data-studio-poll]');
      const kinds = (marker?.dataset.pollKinds || '').split(',').filter(Boolean);
      const listed = (key) => kinds.includes(key.split(':')[0]);
      const known = new Set(items.map((item) => item.key));
      for (const el of document.querySelectorAll('[data-poll-key]')) {
        if (listed(el.dataset.pollKey) && !known.has(el.dataset.pollKey)) changed = true;
      }
      for (const item of items) {
        const el = document.querySelector(`[data-poll-key="${item.key}"]`);
        if (!el && listed(item.key)) changed = true;
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

// ── Editor thumbnaila ─────────────────────────────────────
// Kadar iz snimka i tekst iscrtavaju se na canvas 1280×720, koji se sprema kao JPG.
const thumbCanvas = document.getElementById('thumb-canvas');
if (thumbCanvas) {
  const W = thumbCanvas.width;
  const H = thumbCanvas.height;
  const ctx = thumbCanvas.getContext('2d');
  const video = document.getElementById('thumb-video');
  const get = (id) => document.getElementById(id);
  const num = (id) => Number(get(id).value);
  const timeInput = get('thumb-time');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Položaj teksta (sredina) i pomak slike, u pikselima canvasa.
  const state = { textX: W / 2, textY: H * 0.78, panX: 0, panY: 0, color: '#ffffff' };
  let textBox = null; // gdje je tekst iscrtan, da se zna da li ga miš hvata

  const lines = () => {
    const text = get('thumb-text').value.trim();
    return (get('thumb-upper').checked ? text.toUpperCase() : text)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 2);
  };

  function draw() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (video.readyState >= 2) {
      // Slika uvijek prekriva cijeli canvas; zum je uvećava, a pomak bira koji dio ostaje.
      const scale = Math.max(W / video.videoWidth, H / video.videoHeight) * num('thumb-zoom');
      const dw = video.videoWidth * scale;
      const dh = video.videoHeight * scale;
      state.panX = clamp(state.panX, -(dw - W) / 2, (dw - W) / 2);
      state.panY = clamp(state.panY, -(dh - H) / 2, (dh - H) / 2);
      ctx.filter = `brightness(${num('thumb-brightness')}%) contrast(${num('thumb-contrast')}%) saturate(${num('thumb-saturation')}%)`;
      ctx.drawImage(video, (W - dw) / 2 + state.panX, (H - dh) / 2 + state.panY, dw, dh);
      ctx.filter = 'none';
    }

    const text = lines();
    textBox = null;
    if (!text.length) return;
    const size = num('thumb-size');
    const lineHeight = size * 1.08;
    ctx.font = `${size}px ${get('thumb-font').value}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const width = Math.max(...text.map((l) => ctx.measureText(l).width));
    const height = lineHeight * text.length;
    state.textX = clamp(state.textX, 0, W);
    state.textY = clamp(state.textY, 0, H);

    if (get('thumb-shade').checked) {
      // Zatamnjenje ide od ruba bližeg tekstu prema sredini slike.
      const top = state.textY < H / 2;
      const shade = ctx.createLinearGradient(0, top ? 0 : H, 0, top ? H * 0.6 : H * 0.4);
      shade.addColorStop(0, 'rgba(0, 0, 0, 0.75)');
      shade.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.16;
    ctx.strokeStyle = '#000';
    ctx.fillStyle = state.color;
    text.forEach((line, i) => {
      const y = state.textY + (i - (text.length - 1) / 2) * lineHeight;
      ctx.strokeText(line, state.textX, y);
      ctx.fillText(line, state.textX, y);
    });
    textBox = { left: state.textX - width / 2, right: state.textX + width / 2, top: state.textY - height / 2, bottom: state.textY + height / 2 };
  }

  // ── Izbor kadra ──
  const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
  function seek(time) {
    const t = clamp(time, 0, Number(timeInput.max));
    timeInput.value = t;
    syncRange(timeInput);
    get('thumb-time-label').textContent = fmt(t);
    video.currentTime = t;
  }
  // Nakon premotavanja preglednik javi „seeked“ prije nego što je kadar zaista dostupan za crtanje,
  // pa se crta i kad kadar stigne (requestVideoFrameCallback) i još jednom malo kasnije.
  const frameChanged = () => {
    draw();
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(draw);
    setTimeout(draw, 200);
  };
  for (const type of ['seeked', 'loadeddata', 'canplay']) video.addEventListener(type, frameChanged);
  if (video.readyState >= 1) seek(Number(timeInput.value));
  else video.addEventListener('loadedmetadata', () => seek(Number(timeInput.value)), { once: true });
  timeInput.addEventListener('input', () => seek(Number(timeInput.value)));

  for (const input of document.querySelectorAll('#thumb-form input, #thumb-form select, #thumb-form textarea')) {
    input.addEventListener('input', draw);
  }

  document.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    if (button.dataset.step) seek(Number(timeInput.value) + Number(button.dataset.step));
    else if (button.dataset.color) {
      state.color = button.dataset.color;
      for (const s of document.querySelectorAll('.swatch')) s.classList.toggle('is-picked', s === button);
      draw();
    } else if (button.id === 'thumb-reset') {
      for (const id of ['thumb-zoom', 'thumb-brightness', 'thumb-contrast', 'thumb-saturation']) {
        get(id).value = get(id).dataset.default;
        syncRange(get(id));
      }
      state.panX = state.panY = 0;
      draw();
    }
  });

  // ── Vučenje: tekst se premješta, a uvećana slika pomjera ──
  const toCanvas = (e) => {
    const box = thumbCanvas.getBoundingClientRect();
    return { x: ((e.clientX - box.left) / box.width) * W, y: ((e.clientY - box.top) / box.height) * H };
  };
  let dragging = null;
  thumbCanvas.addEventListener('pointerdown', (e) => {
    const p = toCanvas(e);
    const onText = textBox && p.x >= textBox.left && p.x <= textBox.right && p.y >= textBox.top && p.y <= textBox.bottom;
    dragging = { what: onText ? 'text' : 'pan', x: p.x, y: p.y };
    e.preventDefault();
    try {
      thumbCanvas.setPointerCapture(e.pointerId);
    } catch {}
  });
  thumbCanvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const p = toCanvas(e);
    state[`${dragging.what}X`] += p.x - dragging.x;
    state[`${dragging.what}Y`] += p.y - dragging.y;
    dragging.x = p.x;
    dragging.y = p.y;
    draw();
  });
  const stopDragging = () => (dragging = null);
  thumbCanvas.addEventListener('pointerup', stopDragging);
  thumbCanvas.addEventListener('pointercancel', stopDragging);

  // ── Spremanje ──
  const errorBox = get('thumb-error');
  const saveButton = get('thumb-save');
  get('thumb-form').addEventListener('submit', (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    const fail = (message) => {
      errorBox.textContent = message;
      errorBox.hidden = false;
      saveButton.disabled = false;
    };
    if (video.readyState < 2) return fail('The frame has not loaded yet. Wait a moment and save again.');
    saveButton.disabled = true;
    draw();
    thumbCanvas.toBlob(
      async (blob) => {
        try {
          const title = lines().join(' ') || thumbCanvas.dataset.name;
          const r = await fetch(`/api/recordings/${thumbCanvas.dataset.recording}/thumbnails`, {
            method: 'PUT',
            headers: { 'content-type': 'image/jpeg', 'x-title': encodeURIComponent(title) },
            body: blob,
          });
          const data = await r.json().catch(() => ({}));
          if (r.ok && data.redirect) location.href = data.redirect;
          else fail(data.error || `The thumbnail could not be saved (error ${r.status}).`);
        } catch {
          fail('The thumbnail could not be saved because the app did not respond.');
        }
      },
      'image/jpeg',
      0.92
    );
  });
}

// Dugme „Create thumbnail“ otvara editor na kadru koji je trenutno u playeru.
const thumbLink = document.getElementById('thumb-link');
if (thumbLink) {
  thumbLink.addEventListener('click', () => {
    const video = document.getElementById('player');
    if (video && video.currentTime > 0) thumbLink.href = `${thumbLink.pathname}?t=${video.currentTime.toFixed(2)}`;
  });
}

// ── Dodavanje intro/outro klipa ───────────────────────────
const bumperForm = document.getElementById('bumper-form');
if (bumperForm) {
  const errorBox = document.getElementById('bumper-error');
  const progress = document.getElementById('bumper-progress');
  const button = bumperForm.querySelector('button');
  bumperForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const file = document.getElementById('bumper-file').files[0];
    if (!file) return;
    errorBox.hidden = true;
    button.disabled = true;
    const fail = (message) => {
      errorBox.textContent = message;
      errorBox.hidden = false;
      progress.hidden = true;
      button.disabled = false;
    };
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/bumpers');
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
    xhr.setRequestHeader('x-name', encodeURIComponent(document.getElementById('bumper-name').value));
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const pct = Math.round((ev.loaded / ev.total) * 100);
      progress.hidden = false;
      progress.querySelector('.bar').style.width = `${pct}%`;
      progress.querySelector('.label').textContent = pct < 100 ? `Copying the clip… ${pct}%` : 'Checking the clip…';
    };
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 200 && data.redirect) location.href = data.redirect;
      else fail(data.error || `The clip could not be added (error ${xhr.status}).`);
    };
    xhr.onerror = () => fail('The clip could not be added because the app did not respond.');
    xhr.send(file);
  });
}

// ── Logo (watermark): slanje slike i pregled položaja ─────
const logoForm = document.getElementById('logo-form');
if (logoForm) {
  const errorBox = document.getElementById('logo-error');
  const button = logoForm.querySelector('button');
  const input = document.getElementById('logo-file');
  input.addEventListener('change', () => {
    const file = input.files[0];
    document.getElementById('logo-drop-text').textContent = file ? file.name : 'Choose an image or drag it here';
    document.getElementById('logo-drop').classList.toggle('has-file', Boolean(file));
  });
  logoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = input.files[0];
    if (!file) return;
    errorBox.hidden = true;
    button.disabled = true;
    try {
      const res = await fetch('/api/logo', { method: 'PUT', body: file });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.redirect) return (location.href = data.redirect);
      errorBox.textContent = data.error || `The logo could not be added (error ${res.status}).`;
    } catch {
      errorBox.textContent = 'The logo could not be added because the app did not respond.';
    }
    errorBox.hidden = false;
    button.disabled = false;
  });
}
const wmForm = document.getElementById('wm-form');
if (wmForm) {
  const preview = document.getElementById('wm-preview');
  const logo = document.getElementById('wm-logo');
  const sizes = { small: 14, medium: 20, large: 28 };
  const show = () => {
    preview.dataset.position = wmForm.position.value;
    logo.style.width = `${sizes[wmForm.size.value]}%`;
    logo.style.opacity = wmForm.opacity.value / 100;
    document.getElementById('wm-opacity-value').textContent = `${wmForm.opacity.value}%`;
  };
  wmForm.addEventListener('input', show);
  wmForm.addEventListener('change', show);
}

// ── Memovi: dodavanje u biblioteku ────────────────────────
const memeUpload = document.getElementById('meme-upload');
if (memeUpload) {
  const errorBox = document.getElementById('meme-error');
  const progress = document.getElementById('meme-progress');
  const button = memeUpload.querySelector('button');
  const input = document.getElementById('meme-file');
  input.addEventListener('change', () => {
    document.getElementById('meme-drop-text').textContent = input.files[0] ? input.files[0].name : 'Choose a video, GIF or sound, or drag it here';
    document.getElementById('meme-drop').classList.toggle('has-file', Boolean(input.files[0]));
  });
  memeUpload.addEventListener('submit', (e) => {
    e.preventDefault();
    const file = input.files[0];
    if (!file) return;
    errorBox.hidden = true;
    button.disabled = true;
    const fail = (message) => {
      errorBox.textContent = message;
      errorBox.hidden = false;
      progress.hidden = true;
      button.disabled = false;
    };
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/memes');
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
    xhr.setRequestHeader('x-name', encodeURIComponent(document.getElementById('meme-name').value));
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const pct = Math.round((ev.loaded / ev.total) * 100);
      progress.hidden = false;
      progress.querySelector('.bar').style.width = `${pct}%`;
      progress.querySelector('.label').textContent = pct < 100 ? `Copying… ${pct}%` : 'Checking the meme…';
    };
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 200 && data.redirect) location.href = data.redirect;
      else fail(data.error || `The meme could not be added (error ${xhr.status}).`);
    };
    xhr.onerror = () => fail('The meme could not be added because the app did not respond.');
    xhr.send(file);
  });
}

// Zvučni mem u biblioteci: dugme ga pusti, drugi klik ga zaustavi.
let soundPlayer = null;
document.addEventListener('click', (e) => {
  const button = e.target.closest('[data-play-sound]');
  if (!button) return;
  const again = soundPlayer && soundPlayer.button === button && !soundPlayer.paused;
  if (soundPlayer) {
    soundPlayer.pause();
    soundPlayer.button.classList.remove('is-playing');
    soundPlayer.button.textContent = 'Play';
  }
  if (again) return;
  soundPlayer = new Audio(button.dataset.playSound);
  soundPlayer.button = button;
  button.classList.add('is-playing');
  button.textContent = 'Stop';
  soundPlayer.addEventListener('ended', () => {
    button.classList.remove('is-playing');
    button.textContent = 'Play';
  });
  soundPlayer.play().catch(() => {});
});

// ── Memovi u Shortu: redovi postavki i pregled preko playera ──
const memeForm = document.getElementById('meme-form');
if (memeForm) {
  const player = document.getElementById('meme-player');
  const stage = document.getElementById('meme-stage');
  const rows = document.getElementById('meme-rows');
  const maxShow = Number(memeForm.dataset.maxShow);
  const maxSound = Number(memeForm.dataset.maxSound);
  const duration = Number(memeForm.dataset.duration);
  const empty = () => (document.getElementById('meme-empty').hidden = rows.children.length > 0);
  const addRow = (at) => {
    rows.insertAdjacentHTML('beforeend', document.getElementById('meme-row-template').innerHTML);
    rows.lastElementChild.querySelector('[name="at"]').value = Math.min(at, Math.max(0, duration - 1)).toFixed(1);
    empty();
  };
  document.getElementById('meme-add').addEventListener('click', () => addRow(player.currentTime));
  // Izbor mema postavi i efekat koji ga obično prati.
  memeForm.addEventListener('change', (e) => {
    if (e.target.name !== 'meme_id') return;
    const option = e.target.selectedOptions[0];
    if (option) e.target.closest('.meme-row').querySelector('[name="effect"]').value = option.dataset.effect || 'none';
  });
  memeForm.addEventListener('click', (e) => {
    if (e.target.closest('[data-meme-remove]')) {
      e.target.closest('.meme-row').remove();
      empty();
    } else if (e.target.closest('[data-meme-now]')) {
      e.target.closest('.meme-row').querySelector('[name="at"]').value = player.currentTime.toFixed(1);
    }
  });

  // Pregled: dok Short ide, mem iskače preko playera na svom mjestu, s istom animacijom kao u gotovom videu.
  const shown = new Map(); // red → element mema
  const sizes = { small: 50, medium: 68, large: 90 };
  const sync = () => {
    const t = player.currentTime;
    const live = new Set();
    let effect = '';
    for (const row of rows.querySelectorAll('.meme-row')) {
      const option = row.querySelector('[name="meme_id"]').selectedOptions[0];
      const at = Number(row.querySelector('[name="at"]').value);
      if (!option || Number.isNaN(at)) continue;
      const sound = option.dataset.sound === '1';
      const show = Math.min(Number(option.dataset.duration), sound ? maxSound : maxShow);
      if (t < at || t >= at + show) continue;
      const fx = row.querySelector('[name="effect"]').value;
      if (fx && fx !== 'none') effect = fx;
      live.add(row);
      let el = shown.get(row);
      const src = option.dataset.src;
      if (!el || el.dataset.src !== src) {
        if (el) el.remove();
        // Zvuk se samo pusti (nevidljivi element), video i GIF iskaču preko playera.
        el = document.createElement(sound ? 'audio' : /\.gif$/i.test(option.textContent) ? 'img' : 'video');
        el.className = sound ? 'meme-audio' : 'meme-pop';
        el.dataset.src = src;
        el.src = src;
        if (el.tagName !== 'IMG') {
          el.playsInline = true;
          el.currentTime = t - at;
          el.play().catch(() => {});
        }
        stage.append(el);
        shown.set(row, el);
      }
      // Na pauzi mem ostaje vidljiv, da se vidi gdje stoji; njegov video stoji zajedno sa Shortom.
      if (el.tagName !== 'IMG') {
        if (player.paused) el.pause();
        else if (el.paused) el.play().catch(() => {});
      }
      el.dataset.position = row.querySelector('[name="position"]').value;
      el.style.width = `${sizes[row.querySelector('[name="size"]').value] || 68}%`;
    }
    // Efekat na snimku u pregledu: CSS na playeru (zum, trešnja, boje), isti trenutak kao u gotovom videu.
    if ((stage.dataset.fx || '') !== effect) {
      if (effect) stage.dataset.fx = effect;
      else delete stage.dataset.fx;
    }
    for (const [row, el] of shown) {
      if (!live.has(row) || !row.isConnected) {
        el.remove();
        shown.delete(row);
      }
    }
  };
  player.addEventListener('timeupdate', sync);
  player.addEventListener('pause', sync);
  player.addEventListener('seeked', sync);
  // Klik na vrijeme reda pusti Short od tog mjesta, da se mem odmah vidi.
  memeForm.addEventListener('focusin', (e) => {
    if (e.target.name === 'at' && e.target.value !== '') player.currentTime = Math.max(0, Number(e.target.value) - 0.5);
  });
}

// ── Shorts from scenes: pusti scenu, broj označenih ───────
const sceneForm = document.getElementById('scene-form');
if (sceneForm) {
  const video = document.getElementById('scene-player');
  const button = document.getElementById('scene-submit');
  const canCreate = !button.disabled;
  const count = () => {
    const boxes = [...sceneForm.querySelectorAll('input[name="scene"]')];
    for (const box of boxes) box.closest('.sc-row').classList.toggle('is-off', !box.checked);
    const n = boxes.filter((b) => b.checked).length;
    document.getElementById('scene-all').checked = n === boxes.length;
    button.querySelector('span').textContent = n ? `Create ${n} ${n === 1 ? 'Short' : 'Shorts'}` : 'Select at least one scene';
    button.disabled = !canCreate || !n;
  };
  sceneForm.addEventListener('change', (e) => {
    if (e.target.id === 'scene-all') for (const b of sceneForm.querySelectorAll('input[name="scene"]')) b.checked = e.target.checked;
    count();
  });
  count();
  let stopAt = null;
  let row = null;
  const done = () => {
    if (row) row.classList.remove('is-playing');
    stopAt = row = null;
  };
  sceneForm.addEventListener('click', (e) => {
    const play = e.target.closest('[data-scene-play]');
    if (!play) return;
    done();
    row = play.closest('.sc-row');
    row.classList.add('is-playing');
    stopAt = Number(play.dataset.sceneEnd);
    video.currentTime = Number(play.dataset.scenePlay);
    video.play().catch(() => {});
  });
  video.addEventListener('timeupdate', () => {
    if (stopAt !== null && video.currentTime >= stopAt) {
      video.pause();
      done();
    }
  });
}

// ── Spajanje više videa ───────────────────────────────────
const mergeForm = document.getElementById('merge-form');
if (mergeForm) {
  const list = document.getElementById('merge-list');
  const mainSelect = document.getElementById('merge-main');
  const total = document.getElementById('merge-total');
  const parts = []; // redom kojim se spajaju; `main` određuje veličinu kadra
  const fmt = (t) => {
    const s = Math.round(t);
    const mmss = `${String(Math.floor((s % 3600) / 60)).padStart(s >= 3600 ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;
    return s >= 3600 ? `${Math.floor(s / 3600)}:${mmss}` : mmss;
  };
  const make = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };

  function render() {
    if (parts.length && !parts.some((p) => p.main)) parts[0].main = true;
    list.textContent = '';
    mainSelect.textContent = '';
    parts.forEach((p, i) => {
      const move = (label, text, to) => make('button', { type: 'button', ariaLabel: `${label} “${p.name}”`, title: label, disabled: to < 0 || to >= parts.length, onclick: () => swap(i, to) }, text);
      list.append(
        make(
          'li',
          {},
          make('div', { className: 'grow' }, make('strong', {}, p.name), make('p', { className: 'meta' }, make('span', {}, fmt(p.duration)), make('span', {}, p.size))),
          make('div', { className: 'tl-group' }, move('Move up', '↑', i - 1), move('Move down', '↓', i + 1)),
          make('button', { type: 'button', className: 'danger-outline', onclick: () => remove(i) }, 'Remove'),
          make('input', { type: 'hidden', name: 'parts', value: p.value })
        )
      );
      mainSelect.append(make('option', { value: String(i), selected: Boolean(p.main) }, `${i + 1}. ${p.name} (${p.size})`));
    });
    document.getElementById('merge-empty').hidden = parts.length > 0;
    total.hidden = parts.length === 0;
    total.textContent = `${parts.length} ${parts.length === 1 ? 'part' : 'parts'}, ${fmt(parts.reduce((sum, p) => sum + p.duration, 0))} in total`;
    document.getElementById('merge-submit').disabled = parts.length < 2;
  }
  function swap(i, j) {
    [parts[i], parts[j]] = [parts[j], parts[i]];
    render();
  }
  function remove(i) {
    parts.splice(i, 1);
    render();
  }

  mainSelect.addEventListener('change', () => parts.forEach((p, i) => (p.main = i === Number(mainSelect.value))));
  document.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-add]');
    if (!button) return;
    parts.push({ value: button.dataset.add, name: button.dataset.name, duration: Number(button.dataset.duration), size: button.dataset.size, main: false });
    render();
  });
  render();
}

// ── Titlovi: pregled preko videa i uređivanje redova ──────
const capVideo = document.getElementById('cap-video');
if (capVideo) {
  const overlay = document.getElementById('cap-overlay');
  const SIZES = { small: 0.038, medium: 0.05, large: 0.064 }; // udio visine videa, kao pri upisivanju u sliku
  // Desni dio stranice se zamjenjuje kad prepoznavanje završi, pa se polja traže svaki put iznova.
  const value = (id, fallback) => document.getElementById(id)?.value ?? fallback;
  const field = (row, name) => row.querySelector(`input[name="${name}"]`);
  const lines = () =>
    [...document.querySelectorAll('#cap-lines li')].map((row) => ({
      start: Number(field(row, 'start').value),
      end: Number(field(row, 'end').value),
      text: field(row, 'text').value.trim().replace(/\s+/g, ' '),
      measured: JSON.parse(row.dataset.words || '[]'),
    }));

  // Vremena riječi u redu, isto kao na serveru: izmjerena ako se broj riječi nije promijenio,
  // inače podijeljena po dužini riječi.
  function wordTimes(line) {
    const tokens = line.text.split(' ').filter(Boolean);
    const old = line.measured;
    const span = old.length === tokens.length ? old[old.length - 1].end - old[0].start : 0;
    if (span > 0) {
      const scale = (line.end - line.start) / span;
      return tokens.map((text, i) => ({ text, start: line.start + (old[i].start - old[0].start) * scale }));
    }
    const total = tokens.reduce((n, t) => n + t.length, 0);
    let at = line.start;
    return tokens.map((text) => {
      const start = at;
      at += ((line.end - line.start) * text.length) / total;
      return { text, start };
    });
  }

  function showCaption() {
    const t = capVideo.currentTime;
    const line = lines().find((l) => l.text && t >= l.start && t < l.end);
    const upper = document.getElementById('cap-upper')?.checked;
    const highlight = document.getElementById('cap-highlight-on')?.checked ? value('cap-highlight', '') : '';
    overlay.textContent = '';
    if (line) {
      const words = wordTimes(line);
      // Izgovorena riječ je posljednja čije je vrijeme već počelo.
      const spoken = words.reduce((found, w, i) => (t >= w.start ? i : found), 0);
      words.forEach((w, i) => {
        const span = document.createElement('span');
        span.textContent = upper ? w.text.toUpperCase() : w.text;
        if (highlight && i === spoken) span.style.color = highlight;
        overlay.append(span, ' ');
      });
    }
    const size = capVideo.clientHeight * (SIZES[value('cap-size', 'medium')] || SIZES.medium);
    overlay.style.fontSize = `${size}px`;
    overlay.style.fontFamily = `${value('cap-font', 'Impact')}, 'Arial Black', sans-serif`;
    overlay.style.color = value('cap-color', '#ffffff');
    overlay.style.webkitTextStroke = `${size * 0.16}px #000`;
    overlay.dataset.position = value('cap-position', 'bottom');
  }
  for (const type of ['timeupdate', 'seeked', 'loadedmetadata']) capVideo.addEventListener(type, showCaption);
  for (const type of ['input', 'change']) {
    document.addEventListener(type, (e) => {
      if (e.target.closest('#cap-form')) showCaption();
    });
  }
  document.addEventListener('live:refresh', showCaption);

  // Ulazak u tekst reda (klikom ili tipkom Tab) premota video na taj red.
  const jumpToRow = (e) => {
    const row = e.target.closest?.('#cap-lines li');
    if (!row || e.target.name !== 'text') return;
    capVideo.pause();
    capVideo.currentTime = Number(field(row, 'start').value) + 0.01;
  };
  document.addEventListener('focusin', jumpToRow);
  document.addEventListener('click', jumpToRow);

  document.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-cap-remove')) {
      button.closest('li').remove();
      showCaption();
    } else if (button.dataset.capColor || button.dataset.capHighlight) {
      // Dva reda boja: boja teksta i boja izgovorene riječi.
      const kind = button.dataset.capColor ? 'capColor' : 'capHighlight';
      document.getElementById(kind === 'capColor' ? 'cap-color' : 'cap-highlight').value = button.dataset[kind];
      for (const s of button.parentElement.querySelectorAll('.swatch')) s.classList.toggle('is-picked', s === button);
      showCaption();
    }
  });
}

// ── Paket za objavu: kopiranje polja i brojači znakova ────
document.addEventListener('click', async (e) => {
  const button = e.target.closest('button[data-copy]');
  if (!button) return;
  let text = document.getElementById(button.dataset.copy).value.trim();
  if (button.dataset.copyWith) {
    // Hashtagovi idu ispod opisa, odvojeni praznim redom.
    const extra = document.getElementById(button.dataset.copyWith).value.trim();
    if (extra) text = text ? `${text}\n\n${extra}` : extra;
  }
  const label = button.dataset.label || (button.dataset.label = button.textContent);
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Could not copy';
  }
  setTimeout(() => (button.textContent = label), 1500);
});

for (const counter of document.querySelectorAll('[data-count]')) {
  const input = document.getElementById(counter.dataset.count);
  const update = () => (counter.textContent = `${input.value.length}/${counter.dataset.max}`);
  input.addEventListener('input', update);
  update();
}

// Dugme za skidanje prati izabrani thumbnail.
const kitThumbDownload = document.getElementById('kit-thumb-download');
if (kitThumbDownload) {
  const update = () => {
    const picked = document.querySelector('input[name="thumbnail"]:checked');
    kitThumbDownload.hidden = !picked || !picked.value;
    if (picked && picked.value) kitThumbDownload.href = `/thumbnails/${picked.value}/file?download=1`;
  };
  document.addEventListener('change', (e) => e.target.name === 'thumbnail' && update());
  update();
}

// ── „Napravi sve“: izbor koraka nakon rezanja pamti se u pregledniku ──
const chainFields = [...document.querySelectorAll('[data-remember]')];
for (const field of chainFields) {
  const key = `cutdeck:${field.dataset.remember}`;
  const saved = localStorage.getItem(key);
  if (saved !== null && !field.disabled) {
    if (field.type === 'checkbox') field.checked = saved === '1';
    else if (!field.options || [...field.options].some((o) => o.value === saved)) field.value = saved; // lista: samo ako ta opcija još postoji
  }
  field.addEventListener('change', () => localStorage.setItem(key, field.type === 'checkbox' ? (field.checked ? '1' : '0') : field.value));
}

// ── Dijeljenje snimka: koliko će Shortsa nastati ──────────
const splitForm = document.getElementById('split-form');
if (splitForm) {
  const duration = Number(splitForm.dataset.duration);
  const lengthInput = document.getElementById('split-length');
  const count = document.getElementById('split-count');
  const submit = document.getElementById('split-submit');
  // Isto pravilo kao na serveru (studio.js, splitRanges).
  function parts(length) {
    if (!(length >= 5) || length > 180) return 0;
    const full = Math.floor(duration / length);
    if (full === 0) return duration >= 3 ? 1 : 0;
    const rest = duration - full * length;
    return full + (rest >= Math.max(3, length * 0.25) ? 1 : 0);
  }
  function update() {
    const length = Number(lengthInput.value);
    const n = parts(length);
    for (const b of document.querySelectorAll('[data-split-length]')) b.classList.toggle('is-picked', Number(b.dataset.splitLength) === length);
    count.textContent = n ? `This makes ${n} ${n === 1 ? 'Short' : 'Shorts'}.` : 'Enter a length between 5 and 180 seconds.';
    submit.textContent = n ? `Create ${n} ${n === 1 ? 'Short' : 'Shorts'}` : 'Create Shorts';
    submit.disabled = !n;
  }
  lengthInput.addEventListener('input', update);
  document.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-split-length]');
    if (!button) return;
    lengthInput.value = button.dataset.splitLength;
    update();
  });
  update();
}

// ── Poruke u uglu ─────────────────────────────────────────
// Potvrda uspjeha sama nestane; greška ostaje dok je korisnik ne zatvori.
function dismissToast(toast) {
  toast.classList.add('is-leaving');
  setTimeout(() => toast.remove(), 220);
}
for (const toast of document.querySelectorAll('.toast')) {
  if (!toast.classList.contains('bad')) setTimeout(() => dismissToast(toast), 6000);
}
document.addEventListener('click', (e) => {
  const close = e.target.closest('[data-toast-close]');
  if (close) dismissToast(close.closest('.toast'));
});

// ── Meniji sa dodatnim akcijama ───────────────────────────
// Otvoren je najviše jedan; zatvara ga klik sa strane ili Esc.
document.addEventListener('click', (e) => {
  for (const menu of document.querySelectorAll('details.menu[open]')) {
    if (!menu.contains(e.target)) menu.open = false;
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const menu = document.querySelector('details.menu[open]');
  if (!menu) return;
  menu.open = false;
  menu.querySelector('summary').focus();
});

// ── Dugme pokazuje da je zahtjev poslan ───────────────────
// Sprječava i dvostruki klik. Forme koje šalju same (fetch) ili čekaju potvrdu su već zaustavile slanje.
document.addEventListener('submit', (e) => {
  if (e.defaultPrevented || e.target.method === 'dialog') return;
  const button = e.submitter || e.target.querySelector('button:not([type="button"])');
  if (!button) return;
  button.classList.add('is-loading');
  button.setAttribute('aria-busy', 'true');
  setTimeout(() => (button.disabled = true)); // tek nakon slanja, da ime i vrijednost dugmeta odu sa formom
});
// Povratak na stranicu dugmetom „nazad“ ne smije ostaviti dugme zaključano.
window.addEventListener('pageshow', () => {
  for (const button of document.querySelectorAll('.is-loading')) {
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
    button.disabled = false;
  }
});

// ── Klizači: obojeni dio trake prati vrijednost ───────────
function syncRange(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  input.style.setProperty('--fill', `${max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0}%`);
}
document.addEventListener('input', (e) => {
  if (e.target.type === 'range') syncRange(e.target);
});
for (const input of document.querySelectorAll('input[type="range"]')) syncRange(input);

// ── Zona za fajl: pokazuje šta je izabrano ────────────────
const bumperDrop = document.getElementById('bumper-drop');
if (bumperDrop) {
  const input = bumperDrop.querySelector('input');
  input.addEventListener('change', () => {
    const file = input.files[0];
    bumperDrop.classList.toggle('has-file', Boolean(file));
    if (!file) return;
    document.getElementById('bumper-drop-text').textContent = file.name;
    const mb = file.size / 1024 ** 2;
    document.getElementById('bumper-drop-hint').textContent = mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;
  });
  for (const type of ['dragenter', 'dragover']) bumperDrop.addEventListener(type, () => bumperDrop.classList.add('is-over'));
  for (const type of ['dragleave', 'drop']) bumperDrop.addEventListener(type, () => bumperDrop.classList.remove('is-over'));
}

// ── Šta se pravi u pozadini (bočni meni) ──────────────────
const sideActivity = document.getElementById('side-activity');
if (sideActivity) {
  const WORKING = ['pending', 'rendering', 'analyzing', 'transcribing'];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  async function refreshActivity() {
    if (document.hidden) return;
    try {
      const r = await fetch('/api/studio/status?all=1');
      if (!r.ok) return;
      const count = { clip: 0, video: 0, rec: 0, captions: 0, transcript: 0 };
      for (const item of (await r.json()).items) {
        if (WORKING.includes(item.status)) count[item.key.split(':')[0]]++;
      }
      const parts = [
        count.clip && `creating ${plural(count.clip, 'Short', 'Shorts')}`,
        count.captions && `captioning ${plural(count.captions, 'Short', 'Shorts')}`,
        count.video && `creating ${plural(count.video, 'video', 'videos')}`,
        count.rec && `analyzing ${plural(count.rec, 'recording', 'recordings')}`,
        count.transcript && `transcribing ${plural(count.transcript, 'episode', 'episodes')}`,
      ].filter(Boolean);
      sideActivity.hidden = parts.length === 0;
      if (!parts.length) return;
      const text = parts.join(', ');
      document.getElementById('side-activity-text').textContent = text[0].toUpperCase() + text.slice(1);
      sideActivity.href = count.clip || count.captions ? '/shorts' : count.video ? '/videos' : '/recordings';
    } catch {}
  }
  refreshActivity();
  setInterval(refreshActivity, 4000);
}

// ── Opis pločice: „Show all“ samo ako je tekst zaista odsječen ──
function markLongDescriptions() {
  for (const desc of document.querySelectorAll('.tile-desc')) {
    const more = desc.nextElementSibling;
    if (!more || !more.classList.contains('tile-more')) continue;
    if (desc.classList.contains('is-open')) continue;
    // Poredi visinu sa dva reda i visinu cijelog teksta; scrollHeight ovdje nije pouzdan.
    const clamped = desc.getBoundingClientRect().height;
    desc.classList.add('is-open');
    const full = desc.getBoundingClientRect().height;
    desc.classList.remove('is-open');
    more.hidden = full <= clamped + 1;
  }
}
document.addEventListener('click', (e) => {
  const more = e.target.closest('.tile-more');
  if (!more) return;
  const open = more.previousElementSibling.classList.toggle('is-open');
  more.textContent = open ? 'Show less' : 'Show all';
  more.setAttribute('aria-expanded', String(open));
});
document.addEventListener('live:refresh', markLongDescriptions);
window.addEventListener('resize', markLongDescriptions);
markLongDescriptions();

// ── Clipping: pregled predloženih scena ───────────────────
const suggestForm = document.getElementById('suggest-form');
if (suggestForm) {
  const video = document.getElementById('suggest-player');
  const button = document.getElementById('suggest-submit');
  const label = button.querySelector('span');
  const canCreate = !button.disabled;
  const count = () => {
    const boxes = [...suggestForm.querySelectorAll('input[name="scene"]')];
    for (const box of boxes) box.closest('.sg-row').classList.toggle('is-off', !box.checked);
    const n = boxes.filter((b) => b.checked).length;
    label.textContent = n ? `Create ${n} ${n === 1 ? 'clip' : 'clips'}` : 'Select at least one scene';
    button.disabled = !canCreate || !n;
  };
  suggestForm.addEventListener('change', count);
  count();

  // „Play“ pusti samo tu scenu (ili njen hook) i stane na njenom kraju.
  let stopAt = null;
  let row = null;
  const done = () => {
    if (row) row.classList.remove('is-playing');
    stopAt = row = null;
  };
  suggestForm.addEventListener('click', (e) => {
    const play = e.target.closest('[data-scene-play]');
    if (!play) return;
    done();
    row = play.closest('.sg-row');
    row.classList.add('is-playing');
    stopAt = Number(play.dataset.sceneEnd);
    video.currentTime = Number(play.dataset.scenePlay);
    video.play().catch(() => {});
  });
  video.addEventListener('timeupdate', () => {
    if (stopAt !== null && video.currentTime >= stopAt) {
      video.pause();
      done();
    }
  });
}

// ── Clipping: izmjena klipa, fokus na red titla premota video na njega ──
const clipPlayer = document.getElementById('clip-player');
if (clipPlayer) {
  document.addEventListener('focusin', (e) => {
    if (e.target.dataset && e.target.dataset.seek) clipPlayer.currentTime = Number(e.target.dataset.seek);
  });
}

// ── Clipping: transkript, pretraga i forma za klip ────────
const clippingForm = document.getElementById('clipping-form');
if (clippingForm) {
  const video = document.getElementById('clipping-player');
  const get = (id) => document.getElementById(id);
  const minSeconds = Number(clippingForm.dataset.min);
  const used = JSON.parse(clippingForm.dataset.used || '[]');
  const parseTime = (text) => {
    const parts = text.trim().split(':');
    if (!parts[0] || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
    return parts.reduce((total, p) => total * 60 + Number(p), 0);
  };
  const fmt = (t) => {
    t = Math.floor(t * 10 + 1e-6) / 10;
    const sec = (t % 60).toFixed(1).padStart(4, '0');
    const min = Math.floor((t % 3600) / 60);
    return t >= 3600 ? `${Math.floor(t / 3600)}:${String(min).padStart(2, '0')}:${sec}` : `${min}:${sec}`;
  };
  const setField = (id, time) => {
    get(id).value = fmt(time);
    summarize();
  };

  // Ispod polja: koliko traje scena, da li je dovoljno duga i da li je već iskorištena.
  function summarize() {
    const start = parseTime(get('cl-start').value);
    const end = parseTime(get('cl-end').value);
    const hookFrom = parseTime(get('cl-hook-start').value);
    const hookTo = parseTime(get('cl-hook-end').value);
    const out = get('cl-summary');
    if (!(end > start)) {
      out.textContent = '';
      return;
    }
    const hook = hookTo > hookFrom ? hookTo - hookFrom : 0;
    const notes = [`Scene ${(end - start).toFixed(1)} s${hook ? `, plus a ${hook.toFixed(1)} s hook` : ''}.`];
    const tooShort = end - start + hook < minSeconds;
    if (tooShort) notes.push(`This campaign asks for at least ${minSeconds} s.`);
    const share = Math.max(0, ...used.map((u) => Math.max(0, Math.min(end, u.end) - Math.max(start, u.start)) / (end - start)));
    if (share >= 0.5) notes.push(`${Math.round(share * 100)}% of this scene is already in another clip of this campaign.`);
    out.textContent = notes.join(' ');
    out.classList.toggle('error', tooShort);
  }
  for (const id of ['cl-start', 'cl-end', 'cl-hook-start', 'cl-hook-end']) get(id).addEventListener('input', summarize);
  summarize();

  // Red transkripta izabran klikom; iz njega se postavljaju početak, kraj ili hook.
  let picked = null;
  function pick(row) {
    for (const r of document.querySelectorAll('#tr-lines li.is-active')) r.classList.remove('is-active');
    picked = row;
    row.classList.add('is-active');
    get('tr-actions').hidden = false;
    get('tr-picked').textContent = `${fmt(Number(row.dataset.s))} selected`;
    video.currentTime = Number(row.dataset.s);
    video.play().catch(() => {});
  }

  document.addEventListener('click', (e) => {
    const row = e.target.closest('#tr-lines li');
    if (row) return pick(row);
    const button = e.target.closest('button');
    if (!button) return;
    if (button.dataset.clSet) setField(button.dataset.clSet, video.currentTime);
    else if (button.hasAttribute('data-cl-hook')) {
      setField('cl-hook-start', video.currentTime);
      setField('cl-hook-end', video.currentTime + 2);
    } else if (button.dataset.tr && picked) {
      const from = Number(picked.dataset.s);
      const to = Number(picked.dataset.e);
      if (button.dataset.tr === 'start') setField('cl-start', from);
      else if (button.dataset.tr === 'end') setField('cl-end', to);
      else {
        setField('cl-hook-start', from);
        setField('cl-hook-end', Math.min(to, from + 2));
      }
    }
  });

  // Pretraga: ostaju samo redovi u kojima se traženi tekst izgovara.
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'tr-search') return;
    const query = e.target.value.trim().toLowerCase();
    let shown = 0;
    for (const row of document.querySelectorAll('#tr-lines li')) {
      const match = !query || row.lastElementChild.textContent.toLowerCase().includes(query);
      row.classList.toggle('is-hidden', !match);
      if (match) shown++;
    }
    get('tr-count').textContent = query ? `${shown} ${shown === 1 ? 'line matches' : 'lines match'}` : '';
  });

  // Red koji se upravo čuje je označen dok video ide.
  let rows = null; // lista se učita kad zatreba, i ponovo nakon što transkript stigne
  document.addEventListener('live:refresh', () => (rows = null));
  let playing = null;
  video.addEventListener('timeupdate', () => {
    rows ||= [...document.querySelectorAll('#tr-lines li')].map((el) => ({ el, s: Number(el.dataset.s), e: Number(el.dataset.e) }));
    const t = video.currentTime;
    const now = rows.find((r) => t >= r.s && t < r.e);
    if (now === playing) return;
    if (playing) playing.el.classList.remove('is-playing');
    if (now) now.el.classList.add('is-playing');
    playing = now;
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


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

// Automatsko osvježavanje stranice „Objave“ dok se nešto šalje
const auto = document.querySelector('[data-autorefresh]');
if (auto) setTimeout(() => location.reload(), Number(auto.dataset.autorefresh));

// Brojači znakova
for (const c of document.querySelectorAll('.counter')) {
  const input = document.getElementById(c.dataset.for);
  const max = Number(c.dataset.max);
  const update = () => {
    c.textContent = `${input.value.length}/${max}`;
    c.classList.toggle('over', input.value.length > max * 0.95);
  };
  input.addEventListener('input', update);
  update();
}

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

// ── Forma za upload ───────────────────────────────────────
const form = document.getElementById('upload-form');
if (form) {
  const fileInput = document.getElementById('file');
  const preset = document.getElementById('preset-file'); // Short poslan sa stranice „Shorts“
  const drop = document.getElementById('drop');
  const dropText = document.getElementById('drop-text');
  const errorBox = document.getElementById('form-error');
  const progress = document.getElementById('progress');
  const bar = progress.querySelector('.bar');
  const label = progress.querySelector('.label');
  const submit = document.getElementById('submit');
  const selectAll = document.getElementById('select-all');
  const boxes = [...form.querySelectorAll('input[name="accounts"]')];
  const title = document.getElementById('title');
  let uploadedFor = null; // {file, fileId} – da isti fajl ne šaljemo dvaput ako forma vrati grešku

  const fmt = (b) => (b > 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`);

  function showFile() {
    const f = fileInput.files[0];
    if (!f) return;
    dropText.innerHTML = '';
    const strong = document.createElement('strong');
    strong.textContent = f.name;
    dropText.append(strong, ` · ${fmt(f.size)}`);
    drop.classList.add('has-file');
    if (!title.value) {
      title.value = f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').slice(0, 100);
      title.dispatchEvent(new Event('input'));
    }
  }
  fileInput.addEventListener('change', showFile);
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.add('over'))));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      showFile();
    }
  });

  selectAll.addEventListener('change', () => boxes.forEach((b) => (b.checked = selectAll.checked)));
  boxes.forEach((b) => b.addEventListener('change', () => (selectAll.checked = boxes.every((x) => x.checked))));

  function showErrors(list) {
    errorBox.hidden = false;
    errorBox.innerHTML = '';
    const ul = document.createElement('ul');
    for (const msg of list) {
      const li = document.createElement('li');
      li.textContent = msg;
      ul.append(li);
    }
    errorBox.append(ul);
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function setProgress(pct, text) {
    progress.hidden = false;
    bar.style.width = `${pct}%`;
    label.textContent = text;
  }

  function sendFile(file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', '/api/files');
      xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
      xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setProgress(pct, `Uploading video to the app… ${pct}% (${fmt(e.loaded)} / ${fmt(e.total)})`);
        }
      };
      xhr.onload = () => {
        let data = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status === 200 && data.fileId) resolve(data.fileId);
        else reject(new Error(data.error || `Error ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('The connection to the app was interrupted.'));
      xhr.send(file);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;

    const errs = [];
    const file = fileInput.files[0];
    if (!file && !preset) errs.push('Choose a video file.');
    if (!title.value.trim()) errs.push('Enter a title.');
    if (!form.querySelector('input[name="privacy"]:checked')) errs.push('Choose the video visibility.');
    if (!form.querySelector('input[name="made_for_kids"]:checked')) errs.push('Answer whether the video is made for kids.');
    if (!boxes.some((b) => b.checked)) errs.push('Select at least one channel.');
    if (errs.length) return showErrors(errs);

    submit.disabled = true;
    try {
      let fileId;
      if (!file) fileId = preset.value;
      else if (uploadedFor && uploadedFor.file === file) fileId = uploadedFor.fileId;
      else {
        fileId = await sendFile(file);
        uploadedFor = { file, fileId };
      }
      setProgress(100, 'Preparing the post…');

      const body = new URLSearchParams(new FormData(form));
      body.delete('file');
      body.delete('schedule');
      body.set('fileId', fileId);
      const schedule = document.getElementById('schedule').value;
      if (schedule) body.set('publish_at', new Date(schedule).toISOString());

      const r = await fetch('/upload', { method: 'POST', body });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.redirect) {
        location.href = data.redirect;
        return;
      }
      progress.hidden = true;
      showErrors(data.errors || [data.error || `Error ${r.status}`]);
    } catch (err) {
      progress.hidden = true;
      showErrors([err.message]);
    }
    submit.disabled = false;
  });
}

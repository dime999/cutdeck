'use strict';

// Lokalno vrijeme za sve <time data-local>
for (const el of document.querySelectorAll('time[data-local]')) {
  const d = new Date(el.dataset.local);
  if (!Number.isNaN(d.getTime())) {
    el.textContent = d.toLocaleString('bs-BA', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}

// Potvrda prije opasnih akcija
for (const form of document.querySelectorAll('form[data-confirm]')) {
  form.addEventListener('submit', (e) => {
    if (!confirm(form.dataset.confirm)) e.preventDefault();
  });
}

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

// ── Forma za upload ───────────────────────────────────────
const form = document.getElementById('upload-form');
if (form) {
  const fileInput = document.getElementById('file');
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
          setProgress(pct, `Šaljem video u aplikaciju… ${pct}% (${fmt(e.loaded)} / ${fmt(e.total)})`);
        }
      };
      xhr.onload = () => {
        let data = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status === 200 && data.fileId) resolve(data.fileId);
        else reject(new Error(data.error || `Greška ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('Veza sa aplikacijom je prekinuta.'));
      xhr.send(file);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;

    const errs = [];
    const file = fileInput.files[0];
    if (!file) errs.push('Izaberi video fajl.');
    if (!title.value.trim()) errs.push('Upiši naslov.');
    if (!form.querySelector('input[name="privacy"]:checked')) errs.push('Izaberi vidljivost videa.');
    if (!form.querySelector('input[name="made_for_kids"]:checked')) errs.push('Odgovori da li je video napravljen za djecu.');
    if (!boxes.some((b) => b.checked)) errs.push('Označi barem jedan kanal.');
    if (errs.length) return showErrors(errs);

    submit.disabled = true;
    try {
      let fileId;
      if (uploadedFor && uploadedFor.file === file) fileId = uploadedFor.fileId;
      else {
        fileId = await sendFile(file);
        uploadedFor = { file, fileId };
      }
      setProgress(100, 'Pripremam objavu…');

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
      showErrors(data.errors || [data.error || `Greška ${r.status}`]);
    } catch (err) {
      progress.hidden = true;
      showErrors([err.message]);
    }
    submit.disabled = false;
  });
}

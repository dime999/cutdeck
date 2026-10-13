'use strict';
// ffmpeg / ffprobe: analiza zvuka, prijedlog zanimljivih trenutaka i rezanje u 9:16.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const cfg = require('./config');

const RATE = 8000; // uzoraka u sekundi za analizu zvuka
const OUT_W = 1080;
const OUT_H = 1920;
const SHORT_SIZE = { width: OUT_W, height: OUT_H };
const LAYOUTS = [
  ['blur', 'Whole frame on a blurred background'],
  ['center', 'Crop to the center'],
  ['left', 'Crop to the left side'],
  ['right', 'Crop to the right side'],
];

let available = false;
function isAvailable() {
  if (!available) {
    available = [cfg.ffmpeg, cfg.ffprobe].every((bin) => {
      const r = spawnSync(bin, ['-version'], { stdio: 'ignore', windowsHide: true });
      return !r.error && r.status === 0;
    });
  }
  return available;
}

function run(bin, args, onStdout, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, signal });
    let errTail = '';
    child.stdout.on('data', (d) => onStdout && onStdout(d));
    child.stderr.on('data', (d) => (errTail = (errTail + d).slice(-2000)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      const lines = errTail.trim().split(/\r?\n/);
      reject(new Error(lines[lines.length - 1] || `${bin} exited with code ${code}`));
    });
  });
}

/** Vraća {duration, width, height, fps, hasAudio}. `fps` je razlomak kakav daje ffprobe, npr. "60000/1001". */
async function probe(file) {
  const chunks = [];
  await run(
    cfg.ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,avg_frame_rate', '-of', 'json', file],
    (d) => chunks.push(d)
  );
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const streams = data.streams || [];
  const video = streams.find((s) => s.codec_type === 'video');
  if (!video) throw new Error('The file has no video track.');
  const duration = Number(data.format && data.format.duration);
  if (!(duration > 0)) throw new Error('Could not read the video duration.');
  return {
    duration,
    width: video.width || null,
    height: video.height || null,
    fps: /^[1-9]\d*\/[1-9]\d*$/.test(video.avg_frame_rate || '') ? video.avg_frame_rate : '30/1',
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  };
}

/** Glasnoća (dB) za svaku sekundu snimka. */
async function audioLevels(file, duration, onProgress) {
  const levels = [];
  let sum = 0;
  let n = 0;
  let carry = null; // neparan bajt sa kraja prethodnog dijela
  const push = () => {
    levels.push(sum > 0 ? 10 * Math.log10(sum / n / 32768 ** 2) : -100);
    sum = 0;
    n = 0;
  };
  await run(
    cfg.ffmpeg,
    ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'],
    (chunk) => {
      const buf = carry ? Buffer.concat([carry, chunk]) : chunk;
      const even = buf.length - (buf.length % 2);
      for (let i = 0; i < even; i += 2) {
        const s = buf.readInt16LE(i);
        sum += s * s;
        if (++n === RATE) push();
      }
      carry = even < buf.length ? buf.subarray(even) : null;
      onProgress(Math.min(1, levels.length / duration));
    }
  );
  if (n > RATE / 2) push();
  return levels;
}

/**
 * Bira najglasnije dijelove snimka. Prozor se ocjenjuje po tome koliko je
 * glasniji od uobičajene glasnoće cijelog snimka (medijana), a izabrani se ne preklapaju.
 * `levels` ima jednu vrijednost po sekundi, pa su `start` i `end` u sekundama.
 */
function findMoments(levels, { length = 30, count = 8, gap = 10 } = {}) {
  const n = levels.length;
  if (n < 10) return [];
  length = Math.min(length, n);
  const median = [...levels].sort((a, b) => a - b)[Math.floor(n / 2)];
  const excitement = levels.map((db) => Math.max(0, db - median));
  // Sredina prozora vrijedi više od rubova, pa glasan dio završi u sredini klipa.
  const weights = Array.from({ length }, (_, i) => 0.6 + 0.4 * Math.sin((Math.PI * (i + 0.5)) / length));

  const windows = [];
  for (let s = 0; s + length <= n; s++) {
    let score = 0;
    for (let i = 0; i < length; i++) score += excitement[s + i] * weights[i];
    windows.push({ start: s, score: score / length });
  }
  windows.sort((a, b) => b.score - a.score);

  // Prozori znatno tiši od najglasnijeg nisu vrijedni prijedloga.
  const minScore = windows.length ? windows[0].score * 0.3 : 0;
  const picked = [];
  for (const w of windows) {
    if (picked.length >= count || w.score <= 0 || w.score < minScore) break;
    if (picked.every((p) => Math.abs(p.start - w.start) >= length + gap)) picked.push(w);
  }
  const best = picked.length ? picked[0].score : 1;
  return picked
    .map((w) => ({ start: w.start, end: w.start + length, score: Math.round((w.score / best) * 100) }))
    .sort((a, b) => a.start - b.start);
}

/** Sažima glasnoću po sekundi u `buckets` stubića visine 0–100 za prikaz vremenske trake. */
function waveform(levels, buckets = 240) {
  if (!levels.length) return [];
  const size = Math.max(1, Math.ceil(levels.length / buckets));
  const peaks = [];
  for (let i = 0; i < levels.length; i += size) peaks.push(Math.max(...levels.slice(i, i + size)));
  const sorted = [...peaks].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.05)];
  const range = sorted[sorted.length - 1] - floor || 1;
  return peaks.map((db) => Math.round(Math.max(0, Math.min(1, (db - floor) / range)) * 100));
}

/** Sprema jedan kadar videa kao JPG. */
function thumbnail(input, output, at, width) {
  return run(cfg.ffmpeg, [
    '-hide_banner', '-nostdin', '-v', 'error', '-y',
    '-ss', String(at), '-i', input, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', output,
  ]);
}

function shortFilter(layout) {
  const fill = `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase`;
  if (layout === 'blur') {
    return (
      `[0:v]split[a][b];[a]${fill},crop=${OUT_W}:${OUT_H},boxblur=24:4[bg];` +
      `[b]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease[fg];` +
      '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]'
    );
  }
  const x = { left: '0', center: '(iw-ow)/2', right: 'iw-ow' }[layout];
  return `[0:v]${fill},crop=${OUT_W}:${OUT_H}:${x}:0,setsar=1[v]`;
}

function renderArgs({ input, output, start, duration, layout, overlayFile = null }) {
  // Natpis (npr. PART 1) se crta preko gotovog vertikalnog kadra.
  const filter = overlayFile ? shortFilter(layout).replace(/\[v\]$/, `,ass=${filterPath(overlayFile)}[v]`) : shortFilter(layout);
  return [
    '-hide_banner', '-nostdin', '-v', 'error', '-y',
    '-ss', String(start), '-i', input, '-t', String(duration),
    '-filter_complex', filter, '-map', '[v]', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats', output,
  ];
}

// ffmpeg uz -progress ispisuje dokle je stigao; ovo to pretvara u udio od ukupnog trajanja.
const progressParser = (total, onProgress) => (chunk) => {
  const m = /out_time_(?:us|ms)=(\d+)/.exec(chunk.toString('utf8'));
  if (m) onProgress(Math.min(1, Number(m[1]) / 1e6 / total));
};

/** Reže dio snimka u vertikalni 1080×1920 MP4. `job.overlay` je sadržaj ASS fajla koji se crta preko slike. */
async function renderShort(job, onProgress, signal) {
  const overlayFile = job.overlay ? path.join(cfg.tmpDir, `label-${crypto.randomBytes(8).toString('hex')}.ass`) : null;
  if (overlayFile) fs.writeFileSync(overlayFile, job.overlay);
  try {
    await run(cfg.ffmpeg, renderArgs({ ...job, overlayFile }), progressParser(job.duration, onProgress), signal);
  } finally {
    if (overlayFile) fs.rm(overlayFile, { force: true }, () => {});
  }
}

/**
 * Argumenti za spajanje dijelova u jedan video. Svaki dio se uklapa u zadanu veličinu
 * (sa crnim rubovima ako je drugačijeg oblika) i dobija isti broj sličica i isti format
 * zvuka, jer ih concat filter inače ne može spojiti. Dio bez zvuka dobija tišinu.
 */
function joinArgs({ parts, output, width, height, fps }) {
  const inputs = [];
  const filters = [];
  parts.forEach((p, i) => {
    inputs.push('-i', p.path);
    filters.push(
      `[${i}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${i}]`,
      p.hasAudio
        ? `[${i}:a:0]aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`
        : `anullsrc=r=48000:cl=stereo,atrim=duration=${p.duration}[a${i}]`
    );
  });
  filters.push(`${parts.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${parts.length}:v=1:a=1[v][a]`);
  return [
    '-hide_banner', '-nostdin', '-v', 'error', '-y',
    ...inputs,
    '-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats', output,
  ];
}

/** Spaja dijelove (npr. intro, glavni video, outro) u jedan MP4. `signal` prekida posao. */
async function renderJoined(job, onProgress, signal) {
  const total = job.parts.reduce((sum, p) => sum + p.duration, 0);
  await run(cfg.ffmpeg, joinArgs(job), progressParser(total, onProgress), signal);
}

// ── Titlovi: prepoznavanje govora i upisivanje u sliku ────
const CAPTION_CHARS = 20; // najviše znakova u jednom titlu: kratki redovi se na Shortu lakše čitaju
const CAPTION_FONTS = [
  ['Impact', 'Impact'],
  ['Arial Black', 'Arial Black'],
];
const CAPTION_SIZES = { small: 0.038, medium: 0.05, large: 0.064 }; // udio visine videa
const CAPTION_POSITIONS = ['bottom', 'middle', 'top'];
const DEFAULT_CAPTION_STYLE = { font: 'Impact', size: 'medium', color: '#ffffff', position: 'bottom', upper: true, highlight: '#ffe600' };

// Putanja kao vrijednost opcije filtera: dvotačka se mora označiti, a navodnici čuvaju razmake.
function filterPath(p) {
  if (p.includes("'")) throw new Error(`The path ${p} contains an apostrophe, which ffmpeg filters cannot read.`);
  return `'${p.replace(/\\/g, '/').replace(/:/g, '\\:')}'`;
}

let whisperFilter = null;
/** Vraća razlog zbog kojeg prepoznavanje govora ne može raditi, ili null ako može. */
function transcribeProblem() {
  if (!isAvailable()) return 'ffmpeg is not installed.';
  if (whisperFilter === null) {
    const r = spawnSync(cfg.ffmpeg, ['-hide_banner', '-h', 'filter=whisper'], { windowsHide: true });
    whisperFilter = !r.error && String(r.stdout).includes('whisper AVOptions');
  }
  if (!whisperFilter) return 'This ffmpeg build has no speech recognition (the whisper filter). Install a full build, version 8 or newer.';
  if (!fs.existsSync(cfg.whisperModel)) return `The speech model is missing. Download it to ${cfg.whisperModel} (see the README).`;
  return null;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Vremena riječi za jedan red. Ako red ima isti broj riječi kao prije, izmjerena vremena
 * se zadržavaju (i uklapaju u možda pomjeren raspon reda); inače se trajanje reda
 * dijeli po dužini riječi.
 */
function fitWords(text, start, end, old) {
  const tokens = text.split(' ').filter(Boolean);
  const measured = Array.isArray(old) && old.length === tokens.length && old.every((w) => Number.isFinite(w.start) && Number.isFinite(w.end));
  const span = measured ? old[old.length - 1].end - old[0].start : 0;
  if (span > 0) {
    const scale = (end - start) / span;
    return tokens.map((t, i) => ({
      text: t,
      start: round2(start + (old[i].start - old[0].start) * scale),
      end: round2(start + (old[i].end - old[0].start) * scale),
    }));
  }
  const total = tokens.reduce((n, t) => n + t.length, 0);
  let at = start;
  return tokens.map((t) => {
    const from = at;
    at += ((end - start) * t.length) / total;
    return { text: t, start: round2(from), end: round2(at) };
  });
}

/** Sprječava preklapanje titlova, izbacuje prazne redove i oznake poput [BLANK_AUDIO] i računa vremena riječi. */
function tidyLines(lines) {
  const out = [];
  for (const line of [...lines].sort((a, b) => a.start - b.start)) {
    const text = String(line.text || '').replace(/\s+/g, ' ').trim();
    if (!text || /^[[(].*[\])]$/.test(text)) continue;
    const start = round2(Math.max(line.start, out.length ? out[out.length - 1].end : 0));
    const end = round2(Math.max(line.end, start + 0.2));
    out.push({ start, end, text, words: fitWords(text, start, end, line.words) });
  }
  return out;
}

/** Slaže prepoznate riječi u kratke redove: red se zatvara kad je pun, na kraju rečenice ili nakon pauze. */
function groupWords(words) {
  const lines = [];
  let current = [];
  const close = () => {
    if (current.length) lines.push({ start: current[0].start, end: current[current.length - 1].end, text: current.map((w) => w.text).join(' '), words: current });
    current = [];
  };
  for (const word of words) {
    const length = current.reduce((n, w) => n + w.text.length + 1, 0) + word.text.length;
    const pause = current.length ? word.start - current[current.length - 1].end : 0;
    if (current.length && (length > CAPTION_CHARS || pause > 0.7)) close();
    current.push(word);
    if (/[.!?]$/.test(word.text)) close();
  }
  close();
  return lines;
}

/** Prepoznaje engleski govor u videu. Vraća riječi [{start, end, text}] sa vremenima u sekundama. */
/**
 * Jedan red izlaza filtera whisper: {"start":120,"end":480,"text":" word"}.
 * ffmpeg ne označava navodnike u tekstu, pa red s izgovorenim citatom nije ispravan JSON;
 * tada se tekst uzima onakav kakav jeste. Red koji se ne može pročitati se preskače (null).
 */
function parseWhisperRow(row) {
  try {
    return JSON.parse(row);
  } catch {
    const m = /^\s*\{\s*"start"\s*:\s*(-?\d+)\s*,\s*"end"\s*:\s*(-?\d+)\s*,\s*"text"\s*:\s*"(.*)"\s*\}\s*$/.exec(row);
    return m ? { start: Number(m[1]), end: Number(m[2]), text: m[3].replace(/\\(["\\/])/g, '$1') } : null;
  }
}

async function recognizeWords(file, duration, onProgress, signal) {
  const out = path.join(cfg.tmpDir, `captions-${crypto.randomBytes(8).toString('hex')}.json`);
  // max_len=1 daje jedan zapis po riječi.
  const options = [`model=${filterPath(cfg.whisperModel)}`, 'language=en', 'queue=20', 'max_len=1', `destination=${filterPath(out)}`, 'format=json'];
  try {
    await run(
      cfg.ffmpeg,
      ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-vn', '-af', `whisper=${options.join(':')}`, '-progress', 'pipe:1', '-nostats', '-f', 'null', '-'],
      progressParser(duration, onProgress),
      signal
    );
    const text = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    const words = [];
    for (const row of text.split(/\r?\n/)) {
      if (!row.trim()) continue;
      const item = parseWhisperRow(row);
      if (!item) continue;
      const word = String(item.text || '').trim();
      if (!word || /^[[(].*[\])]$/.test(word)) continue;
      words.push({ start: item.start / 1000, end: item.end / 1000, text: word });
    }
    return words;
  } finally {
    fs.rm(out, { force: true }, () => {});
  }
}

/** Riječi složene u redove titlova [{start, end, text, words}]. */
const linesFromWords = (words) => tidyLines(groupWords(words));

/** Prepoznaje govor u videu i vraća ga kao redove titlova. */
async function transcribe(file, duration, onProgress, signal) {
  return linesFromWords(await recognizeWords(file, duration, onProgress, signal));
}

const assTime = (t) => {
  const cs = Math.round(t * 100);
  const pad = (n) => String(n).padStart(2, '0');
  return `${Math.floor(cs / 360000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
};

/** Pravi ASS fajl sa titlovima u zadanom stilu za video veličine width×height. */
function buildAss(lines, style, { width, height }) {
  const s = { ...DEFAULT_CAPTION_STYLE, ...style };
  const size = Math.round(height * (CAPTION_SIZES[s.size] || CAPTION_SIZES.medium));
  // ASS piše boje obrnutim redom: plava, zelena, crvena.
  const bgr = (hex, fallback) => {
    const m = /^#(..)(..)(..)$/.exec(hex || '');
    return m ? `${m[3]}${m[2]}${m[1]}` : fallback;
  };
  const primary = bgr(s.color, 'ffffff');
  const highlight = bgr(s.highlight, null);
  const alignment = { bottom: 2, middle: 5, top: 8 }[s.position] || 2;
  // Dolje se ostavlja mjesta za naslov i dugmad koje YouTube crta preko Shorta.
  const marginV = Math.round(height * (s.position === 'top' ? 0.1 : 0.2));
  const clean = (text) => (s.upper ? text.toUpperCase() : text).replace(/[{}]/g, '').replace(/\\/g, '/').replace(/\s+/g, ' ');
  const dialogue = (start, end, text) => `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${text}`;
  const events = lines.flatMap((l) => {
    if (!highlight || !l.words || !l.words.length) return [dialogue(l.start, l.end, clean(l.text))];
    // Isticanje: po jedan događaj za svaku riječ, sa cijelim redom i tom riječju u drugoj boji.
    return l.words.map((word, i) => {
      const from = i === 0 ? l.start : word.start;
      const to = i === l.words.length - 1 ? l.end : l.words[i + 1].start;
      const text = l.words.map((w, j) => (j === i ? `{\\c&H${highlight}&}${clean(w.text)}{\\c&H${primary}&}` : clean(w.text))).join(' ');
      return dialogue(from, Math.max(to, from + 0.01), text);
    });
  });
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${s.font},${size},&H00${primary},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,${Math.round(size * 0.08)},0,${alignment},${Math.round(width * 0.06)},${Math.round(width * 0.06)},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}

/** ASS fajl sa jednim natpisom koji stoji cijelo vrijeme, npr. „PART 3“. */
function buildLabelAss({ text, position }, { width, height }) {
  const size = Math.round(height * 0.058);
  const top = position !== 'bottom';
  // Gore se ostavlja mjesta za ikone koje YouTube crta preko Shorta.
  const marginV = Math.round(height * (top ? 0.07 : 0.12));
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Impact,${size},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,${Math.round(size * 0.09)},0,${top ? 8 : 2},40,40,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 0,0:00:00.00,9:59:59.00,Default,,0,0,0,,${String(text).replace(/[{}\\]/g, '')}`,
    '',
  ].join('\n');
}

/**
 * Argumenti za klip složen iz više dijelova istog izvora (npr. hook, pa scena bez pauza).
 * Dijelovi se režu i spajaju, pa se rezultat pretvara u vertikalni kadar i dobija titlove.
 */
function edlArgs({ input, output, edl, layout, overlayFile = null }) {
  // Čita se samo raspon izvora koji dijelovi pokrivaju; vremena dijelova se računaju od njegovog početka.
  const from = Math.min(...edl.map((p) => p.start));
  const to = Math.max(...edl.map((p) => p.end));
  const cuts = edl.map((p, i) => {
    const range = `start=${(p.start - from).toFixed(3)}:end=${(p.end - from).toFixed(3)}`;
    return `[0:v]trim=${range},setpts=PTS-STARTPTS[v${i}];[0:a:0]atrim=${range},asetpts=PTS-STARTPTS[a${i}]`;
  });
  const joined = `${edl.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${edl.length}:v=1:a=1[cv][ca]`;
  let frame = shortFilter(layout).replace('[0:v]', '[cv]');
  if (overlayFile) frame = frame.replace(/\[v\]$/, `,ass=${filterPath(overlayFile)}[v]`);
  return [
    '-hide_banner', '-nostdin', '-v', 'error', '-y',
    '-ss', from.toFixed(3), '-to', to.toFixed(3), '-i', input,
    '-filter_complex', [...cuts, joined, frame].join(';'), '-map', '[v]', '-map', '[ca]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats', output,
  ];
}

/** Pravi vertikalni klip iz dijelova izvora. `job.overlay` je sadržaj ASS fajla sa titlovima. */
async function renderEdl(job, onProgress, signal) {
  const overlayFile = job.overlay ? path.join(cfg.tmpDir, `clip-${crypto.randomBytes(8).toString('hex')}.ass`) : null;
  if (overlayFile) fs.writeFileSync(overlayFile, job.overlay);
  const length = job.edl.reduce((sum, p) => sum + (p.end - p.start), 0);
  try {
    await run(cfg.ffmpeg, edlArgs({ ...job, overlayFile }), progressParser(length, onProgress), signal);
  } finally {
    if (overlayFile) fs.rm(overlayFile, { force: true }, () => {});
  }
}

/** Upisuje titlove (sadržaj ASS fajla) u sliku videa. Zvuk se prenosi bez promjene. */
async function renderCaptioned({ input, output, subtitles, duration }, onProgress, signal) {
  const assFile = path.join(cfg.tmpDir, `captions-${crypto.randomBytes(8).toString('hex')}.ass`);
  fs.writeFileSync(assFile, subtitles);
  try {
    await run(
      cfg.ffmpeg,
      [
        '-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', input,
        '-vf', `ass=${filterPath(assFile)}`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'copy', '-movflags', '+faststart',
        '-progress', 'pipe:1', '-nostats', output,
      ],
      progressParser(duration, onProgress),
      signal
    );
  } finally {
    fs.rm(assFile, { force: true }, () => {});
  }
}

module.exports = {
  LAYOUTS,
  SHORT_SIZE,
  CAPTION_FONTS,
  CAPTION_SIZES,
  CAPTION_POSITIONS,
  DEFAULT_CAPTION_STYLE,
  isAvailable,
  probe,
  audioLevels,
  findMoments,
  waveform,
  thumbnail,
  renderArgs,
  renderShort,
  joinArgs,
  renderJoined,
  transcribeProblem,
  recognizeWords,
  linesFromWords,
  transcribe,
  tidyLines,
  buildAss,
  buildLabelAss,
  renderCaptioned,
  edlArgs,
  renderEdl,
};

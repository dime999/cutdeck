'use strict';
// ffmpeg / ffprobe: analiza zvuka, prijedlog zanimljivih trenutaka i rezanje u 9:16.
const { spawn, spawnSync } = require('node:child_process');
const cfg = require('./config');

const RATE = 8000; // uzoraka u sekundi za analizu zvuka
const OUT_W = 1080;
const OUT_H = 1920;
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

function renderArgs({ input, output, start, duration, layout }) {
  return [
    '-hide_banner', '-nostdin', '-v', 'error', '-y',
    '-ss', String(start), '-i', input, '-t', String(duration),
    '-filter_complex', shortFilter(layout), '-map', '[v]', '-map', '0:a:0?',
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

/** Reže dio snimka u vertikalni 1080×1920 MP4. */
async function renderShort(job, onProgress) {
  await run(cfg.ffmpeg, renderArgs(job), progressParser(job.duration, onProgress));
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

module.exports = { LAYOUTS, isAvailable, probe, audioLevels, findMoments, waveform, thumbnail, renderArgs, renderShort, joinArgs, renderJoined };

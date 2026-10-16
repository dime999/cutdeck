'use strict';
// ffmpeg za dugi video: analiza pokreta, rezanje dijelova u isti format i spajanje uz ujednačenu glasnoću.
const fs = require('node:fs');
const cfg = require('./config');
const media = require('./media');

const FRAME_W = 64;
const FRAME_H = 36;

/**
 * Pokret slike i crna slika po sekundi. Prvo čita samo ključne sličice (brzo); ako ih snimak ima
 * premalo (ključna sličica rjeđe od svake ~2 s), čita sve. Vraća { motion: [0–255], black: [bool] }.
 */
async function activityScan(file, duration, onProgress, signal) {
  const pass = async (keyframesOnly) => {
    const seconds = Math.max(1, Math.ceil(duration));
    const motion = new Array(seconds).fill(null);
    const black = new Array(seconds).fill(false);
    const size = FRAME_W * FRAME_H;
    let carry = Buffer.alloc(0);
    let index = 0;
    let last = null;
    let distinct = 0;
    const take = (frame) => {
      let sum = 0;
      for (let i = 0; i < size; i++) sum += frame[i];
      if (index < seconds) black[index] = sum / size < 16;
      // Promjena prema prethodnoj sekundi; ista slika znači da se ništa ne miče (ili da nije bilo nove ključne sličice).
      if (last) {
        let diff = 0;
        for (let i = 0; i < size; i++) diff += Math.abs(frame[i] - last[i]);
        if (index < seconds) motion[index] = diff / size;
        if (diff) distinct++;
      }
      last = Buffer.from(frame);
      index++;
      onProgress(Math.min(1, index / seconds));
    };
    await runRaw(
      ['-hide_banner', '-nostdin', '-v', 'error', ...(keyframesOnly ? ['-skip_frame', 'nokey'] : []), '-i', file, '-an', '-vf', `fps=1,scale=${FRAME_W}:${FRAME_H},format=gray`, '-f', 'rawvideo', '-'],
      (chunk) => {
        carry = Buffer.concat([carry, chunk]);
        while (carry.length >= size) {
          take(carry.subarray(0, size));
          carry = carry.subarray(size);
        }
      },
      signal
    );
    let prev = 0;
    for (let s = 0; s < seconds; s++) motion[s] = motion[s] ?? prev, (prev = motion[s]);
    if (motion[0] === null || motion[0] === undefined) motion[0] = motion[1] ?? 0;
    return { motion: motion.map((m) => Math.round((m ?? 0) * 10) / 10), black, distinct, seconds };
  };
  let result = await pass(true);
  // Premalo ključnih sličica (svaka druga sekunda ponavlja staru): čita se sve, sporije ali tačno.
  if (result.distinct < result.seconds * 0.4) result = await pass(false);
  return { motion: result.motion, black: result.black };
}

const runRaw = (args, onStdout, signal) => media.run(cfg.ffmpeg, args, onStdout, signal);

/**
 * Rezovi u videu: svaka sličica čija je promjena slike (0–1) barem 0,15, uz crnu sliku po sekundi.
 * Čuvaju se i slabiji rezovi, da se osjetljivost može mijenjati bez ponovnog pregleda.
 * Vraća { cuts: [{ t, score }], black: [bool po sekundi] }.
 */
async function sceneScan(file, duration, onProgress, signal) {
  const cuts = [];
  const seconds = Math.max(1, Math.ceil(duration));
  const black = new Array(seconds).fill(false);
  let text = '';
  // Ispis filtera metadata: red "frame:… pts_time:12.5", pa vrijednosti te sličice (scene_score, YAVG…)
  // nekim redom. Sličica se obradi kad počne sljedeća. Uz rezove se uzima i svaka deseta sličica,
  // za crnu sliku (prosječna svjetlina YAVG).
  let frame = null;
  const flush = () => {
    if (!frame) return;
    if (frame.score !== null && frame.score >= 0.15) cuts.push({ t: Math.round(frame.time * 100) / 100, score: Math.round(frame.score * 1000) / 1000 });
    if (frame.yavg !== null && frame.yavg < 18 && Math.floor(frame.time) < seconds) black[Math.floor(frame.time)] = true;
    frame = null;
  };
  await runRaw(
    [
      '-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-an',
      '-vf', "scale=320:-2,signalstats,select='gte(scene,0.15)+not(mod(n,10))',metadata=print:file=-",
      '-f', 'null', '-',
    ],
    (chunk) => {
      text += chunk.toString('utf8');
      const lines = text.split('\n');
      text = lines.pop();
      for (const line of lines) {
        const pts = /pts_time:([\d.]+)/.exec(line);
        if (pts) {
          flush();
          frame = { time: Number(pts[1]), score: null, yavg: null };
          onProgress(Math.min(1, frame.time / duration));
          continue;
        }
        if (!frame) continue;
        const s = /lavfi\.scene_score=([\d.]+)/.exec(line);
        if (s) frame.score = Number(s[1]);
        const y = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line);
        if (y) frame.yavg = Number(y[1]);
      }
    },
    signal
  );
  flush();
  return { cuts, black };
}

/** HDR snimak (npr. PS5) se pretvara u običnu sliku da boje ne ispadnu isprane. */
const TONEMAP = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv';

const LOGO_SIZES = { small: 0.08, medium: 0.11, large: 0.15 };

/**
 * Jedan dio dugog videa, uvijek u istom formatu (veličina, sličice, zvuk), da se dijelovi poslije
 * spoje bez ponovnog kodiranja slike. `fadeIn`/`fadeOut` su sekunde zatamnjenja na rubu.
 */
function segmentArgs({ input, output, start = 0, duration, width, height, fps, hdr = false, hasAudio = true, fadeIn = 0, fadeOut = 0, logo = null }) {
  const d = duration.toFixed(3);
  const fades = [fadeIn && `fade=t=in:st=0:d=${fadeIn}`, fadeOut && `fade=t=out:st=${Math.max(0, duration - fadeOut).toFixed(3)}:d=${fadeOut}`].filter(Boolean);
  const video = [
    ...(hdr ? [TONEMAP] : []),
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    'setsar=1',
    `fps=${fps}`,
    'format=yuv420p',
    ...fades,
  ].join(',');
  const filters = [];
  if (logo) {
    const w = Math.round((width * (LOGO_SIZES[logo.size] || LOGO_SIZES.medium)) / 2) * 2;
    const m = Math.round(width * 0.025);
    const x = String(logo.position).endsWith('left') ? `${m}` : `W-w-${m}`;
    const y = String(logo.position).startsWith('bottom') ? `H-h-${m}` : `${m}`;
    const alpha = Math.max(0.1, Math.min(1, Number(logo.opacity) / 100 || 0.85)).toFixed(2);
    filters.push(`[0:v]${video}[base]`, `[1:v]scale=${w}:-1,format=rgba,colorchannelmixer=aa=${alpha}[lg]`, `[base][lg]overlay=${x}:${y}[v]`);
  } else {
    filters.push(`[0:v]${video}[v]`);
  }
  const afades = [`afade=t=in:st=0:d=${Math.max(0.03, fadeIn)}`, `afade=t=out:st=${Math.max(0, duration - Math.max(0.03, fadeOut)).toFixed(3)}:d=${Math.max(0.03, fadeOut)}`];
  filters.push(
    hasAudio
      ? `[0:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,${afades.join(',')}[a]`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${d}[a]`
  );
  const gop = Math.max(2, Math.round(Number(String(fps).split('/')[0]) / Number(String(fps).split('/')[1] || 1)) * 2);
  return [
    '-hide_banner', '-nostdin', '-v', 'error', '-y',
    '-ss', start.toFixed(3), '-t', d, '-i', input,
    ...(logo ? ['-i', logo.file] : []),
    '-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[a]', '-t', d,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-g', String(gop),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-progress', 'pipe:1', '-nostats', output,
  ];
}

const progressOf = (total, onProgress) => (chunk) => {
  const m = /out_time_(?:us|ms)=(\d+)/.exec(chunk.toString('utf8'));
  if (m) onProgress(Math.min(1, Number(m[1]) / 1e6 / total));
};

async function renderSegment(job, onProgress, signal) {
  await media.run(cfg.ffmpeg, segmentArgs(job), progressOf(job.duration, onProgress), signal);
}

/** Spaja dijelove (slika se samo kopira) i ujednačava glasnoću na −14 LUFS, koliko YouTube preporučuje. */
async function joinSegments({ listFile, output, duration }, onProgress, signal) {
  await media.run(
    cfg.ffmpeg,
    [
      '-hide_banner', '-nostdin', '-v', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', listFile,
      '-c:v', 'copy', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output,
    ],
    progressOf(duration, onProgress),
    signal
  );
}

/** Lista za concat demuxer; putanje sa apostrofom se označavaju. */
const concatList = (files) => files.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n';

/** Da li je snimak HDR (PQ ili HLG). */
async function isHdr(file) {
  const chunks = [];
  await media.run(cfg.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_transfer', '-of', 'csv=p=0', file], (d) => chunks.push(d));
  return /smpte2084|arib-std-b67/.test(Buffer.concat(chunks).toString('utf8'));
}

/** Mali JPG jednog kadra, za prijedloge thumbnaila. */
// Kadrovi koji se upravo prave, da dva zahtjeva za isti kadar ne čitaju napola napisan fajl.
const framing = new Map();
function frame(file, at, output, hdr = false) {
  if (fs.existsSync(output)) return Promise.resolve();
  if (!framing.has(output)) {
    const part = `${output}.part.jpg`;
    const job = media
      .run(cfg.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', `${hdr ? `${TONEMAP},` : ''}scale=480:-2,format=yuvj420p`, '-q:v', '4', part])
      .then(() => fs.renameSync(part, output)) // tek gotov fajl dobija svoje ime
      .finally(() => framing.delete(output));
    framing.set(output, job);
  }
  return framing.get(output);
}

module.exports = { sceneScan, activityScan, segmentArgs, renderSegment, joinSegments, concatList, isHdr, frame, LOGO_SIZES };

'use strict';
// Clipping: pravila kampanje, sastavljanje klipa iz dijelova izvora i tekst za objavu po platformama.
// Ovdje nema ni baze ni ffmpeg-a, samo računanje, da se može provjeriti bez pokretanja aplikacije.

const PLATFORMS = [
  ['youtube', 'YouTube Shorts'],
  ['tiktok', 'TikTok'],
  ['instagram', 'Instagram Reels'],
  ['x', 'X'],
];

const round2 = (n) => Math.round(n * 100) / 100;

/** "r3born, #clips" → ['#r3born', '#clips']; isto za tagove sa znakom @. */
function withPrefix(text, prefix) {
  return [...new Set(String(text || '').split(/[\s,]+/).map((t) => t.replace(/^[#@]+/, '')).filter(Boolean))].map((t) => prefix + t);
}

const bannedList = (campaign) => String(campaign.banned || '').split(',').map((w) => w.trim()).filter(Boolean);

/**
 * Dijelovi scene bez dugih pauza u govoru. Riječi imaju vremena izvora { s, e, t };
 * dio bez govora duži od `maxGap` se izbacuje, a oko govora ostaje malo prostora.
 */
function removePauses(start, end, words, { maxGap = 0.6, pad = 0.15 } = {}) {
  const spoken = words.filter((w) => w.e > start && w.s < end);
  if (!spoken.length) return [{ start, end }];
  const parts = [];
  let from = Math.max(start, spoken[0].s - pad);
  let lastEnd = spoken[0].e;
  for (const word of spoken.slice(1)) {
    if (word.s - lastEnd > maxGap) {
      parts.push({ start: from, end: Math.min(end, lastEnd + pad) });
      from = Math.max(start, word.s - pad);
    }
    lastEnd = Math.max(lastEnd, word.e);
  }
  parts.push({ start: from, end: Math.min(end, lastEnd + pad) });
  return parts.map((p) => ({ start: round2(p.start), end: round2(p.end) })).filter((p) => p.end - p.start >= 0.2);
}

/**
 * Lista dijelova izvora redom kojim ulaze u klip: hook (ako je zadan), pa scena.
 * Uz `trimSilence` iz scene se izbacuju pauze.
 */
function buildEdl({ start, end, hook = null, trimSilence = false, words = [] }) {
  const scene = trimSilence ? removePauses(start, end, words) : [{ start, end }];
  return hook ? [{ start: hook.start, end: hook.end, hook: true }, ...scene] : scene;
}

const edlLength = (edl) => round2(edl.reduce((sum, part) => sum + (part.end - part.start), 0));

/** Riječi izvora preslikane na vrijeme gotovog klipa, za titlove. */
function mapWords(edl, words) {
  const out = [];
  let offset = 0;
  for (const part of edl) {
    for (const w of words) {
      const middle = (w.s + w.e) / 2;
      if (middle < part.start || middle >= part.end) continue;
      out.push({ start: offset + Math.max(0, w.s - part.start), end: offset + Math.min(part.end, w.e) - part.start, text: w.t });
    }
    offset += part.end - part.start;
  }
  return out;
}

/** Udio raspona [start, end] koji je već pokriven nekim od ranijih klipova. */
function overlapShare(start, end, used) {
  const length = end - start;
  if (!(length > 0)) return 0;
  return Math.max(0, ...used.map((u) => Math.max(0, Math.min(end, u.end) - Math.max(start, u.start)) / length));
}

/** Riječi složene u rečenice: rečenica se zatvara na tački, upitniku, uzvičniku ili pauzi dužoj od `maxGap`. */
function sentences(words, maxGap = 0.8) {
  const out = [];
  let current = null;
  for (const w of words) {
    if (current && w.s - current.end > maxGap) current = null;
    if (!current) out.push((current = { start: w.s, end: w.e, words: 0, text: '', strong: false }));
    current.end = Math.max(current.end, w.e);
    current.words++;
    current.text += (current.text ? ' ' : '') + w.t;
    if (/[.!?]["')\]]?$/.test(w.t)) {
      current.strong = /[!?]/.test(w.t);
      current = null;
    }
  }
  return out;
}

/**
 * Prijedlozi scena za klipove: nizovi cijelih rečenica dužine oko `target` sekundi, poredani po tome
 * koliko su glasni i koliko se u njima govori. Scene se međusobno ne preklapaju i preskaču dijelove
 * koji su već u klipovima (`used`). `waveform` je glasnoća 0–100 u jednakim odsječcima cijelog snimka.
 */
function suggestScenes({ words, waveform = [], duration, count, target, min = 0, used = [] }) {
  const list = sentences(words);
  const lower = Math.max(min, target * 0.6);
  const upper = target * 1.5;
  const loudness = (start, end) => {
    if (!waveform.length || !(duration > 0)) return 0;
    const from = Math.max(0, Math.floor((start / duration) * waveform.length));
    const to = Math.min(waveform.length - 1, Math.floor((end / duration) * waveform.length));
    let sum = 0;
    for (let i = from; i <= to; i++) sum += waveform[i];
    return sum / (to - from + 1) / 100;
  };
  const candidates = [];
  for (let i = 0; i < list.length; i++) {
    let spoken = 0;
    let strong = 0;
    for (let j = i; j < list.length; j++) {
      if (j > i && list[j].start - list[j - 1].end > 4) break; // scena ne prelazi preko duge tišine
      const start = Math.max(0, list[i].start - 0.15);
      const end = Math.min(duration || Infinity, list[j].end + 0.25);
      if (end - start > upper) break;
      spoken += list[j].words;
      strong += list[j].strong ? 1 : 0;
      if (end - start < lower) continue;
      const length = end - start;
      const fit = 1 - Math.abs(length - target) / target; // scene bliže traženoj dužini imaju prednost
      const score = 0.5 * loudness(start, end) + 0.3 * Math.min(1, spoken / length / 3.5) + 0.1 * (strong / (j - i + 1)) + 0.1 * fit;
      candidates.push({ start: round2(start), end: round2(end), score, text: list[i].text });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (overlapShare(c.start, c.end, used) >= 0.5) continue;
    if (picked.some((p) => c.start < p.end && c.end > p.start)) continue;
    picked.push(c);
  }
  return picked.sort((a, b) => a.start - b.start);
}

/**
 * Hook za scenu: do tri sekunde govora koje su glasnije od ostatka scene, da se puste prve.
 * `levels` je glasnoća cijelog snimka u decibelima, po jedna vrijednost za svaku sekundu.
 * Prve tri sekunde scene se ne uzimaju (klip ionako počinje njima). Vraća { start, end } ili null.
 */
function pickHook({ start, end, words, levels = [] }) {
  if (!levels.length) return null;
  const level = (from, to) => {
    // Prosjek po sekundama, svaka s težinom dijela koji upada u raspon.
    let sum = 0;
    let span = 0;
    for (let s = Math.floor(from); s < to && s < levels.length; s++) {
      const part = Math.min(to, s + 1) - Math.max(from, s);
      sum += levels[s] * part;
      span += part;
    }
    return span ? sum / span : -100;
  };
  const inside = words.filter((w) => w.s >= start && w.e <= end);
  let best = null;
  for (const [i, first] of inside.entries()) {
    if (first.s < start + 3) continue;
    let last = first;
    for (let j = i; j < inside.length && inside[j].s < first.s + 2 && inside[j].e <= first.s + 3; j++) last = inside[j];
    const from = Math.max(start, first.s - 0.1);
    const to = Math.min(end, last.e + 0.15);
    if (to - from < 1) continue;
    const score = level(from, to);
    if (!best || score > best.score) best = { start: round2(from), end: round2(to), score };
  }
  return best && best.score > level(start, end) + 1 ? { start: best.start, end: best.end } : null;
}

/** Šta se kaže između dva vremena izvora. */
const saidBetween = (words, start, end) => words.filter((w) => (w.s + w.e) / 2 >= start && (w.s + w.e) / 2 < end).map((w) => w.t).join(' ');

/** Tekst titlova bez ASS oznaka, za provjeru zabranjenih riječi. */
const subtitleText = (ass) =>
  String(ass || '')
    .split('\n')
    .filter((line) => line.startsWith('Dialogue:'))
    .map((line) => line.split(',').slice(9).join(',').replace(/\{[^}]*\}/g, ''))
    .join(' ');

/**
 * Provjera klipa prema pravilima kampanje. Vraća listu { ok, label, detail }.
 * Tagovi i hashtagovi se ne provjeravaju: aplikacija ih sama dodaje u tekst za objavu.
 */
function checkClip(campaign, clip) {
  const checks = [];
  const length = clip.length_s || 0;
  const min = campaign.min_seconds || 0;
  checks.push({
    ok: length >= min,
    label: `At least ${min} seconds long`,
    detail: `This clip is ${length.toFixed(1)} s.`,
  });
  const hasCaptions = String(clip.subtitles || '').includes('Dialogue:');
  checks.push({
    ok: hasCaptions,
    label: 'Has captions',
    detail: hasCaptions ? 'Captions are drawn into the video.' : 'No speech was found in this part, so the clip has no captions.',
  });
  const texts = [
    ['title', clip.title],
    ['caption', clip.caption],
    ['captions in the video', subtitleText(clip.subtitles)],
  ];
  const found = [];
  for (const word of bannedList(campaign)) {
    const pattern = new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    for (const [where, text] of texts) if (pattern.test(String(text || ''))) found.push(`“${word}” in the ${where}`);
  }
  checks.push({
    ok: found.length === 0,
    label: 'No banned words',
    detail: found.length ? `Found ${found.join(', ')}.` : bannedList(campaign).length ? `Checked for: ${bannedList(campaign).join(', ')}.` : 'This campaign has no banned words.',
  });
  checks.push({
    ok: Boolean(String(clip.caption || '').trim()),
    label: 'Has a caption to post',
    detail: 'A short line in your own words about what happens on screen.',
  });
  return checks;
}

/** Tekst za objavu na jednoj platformi: opis, obavezni tag te platforme i hashtagovi kampanje. */
function platformCaption(campaign, clip, platform) {
  const tags = withPrefix(campaign[`tag_${platform}`], '@');
  const hashtags = withPrefix(campaign.hashtags, '#');
  return [String(clip.caption || '').trim(), [...tags, ...hashtags].join(' ')].filter(Boolean).join(' ');
}

module.exports = { PLATFORMS, withPrefix, bannedList, removePauses, buildEdl, edlLength, mapWords, overlapShare, sentences, suggestScenes, pickHook, saidBetween, subtitleText, checkClip, platformCaption };

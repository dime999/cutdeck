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

module.exports = { PLATFORMS, withPrefix, bannedList, removePauses, buildEdl, edlLength, mapWords, overlapShare, subtitleText, checkClip, platformCaption };

'use strict';
// Auto edit dugog videa bez komentara: iz glasnoće i pokreta po sekundi odlučuje šta ostaje,
// gdje su poglavlja i koji dio ide kao najava na početak. Ovdje nema ni baze ni ffmpeg-a.

const TIGHTNESS = {
  // low: ispod kojeg dijela aktivnosti je sekunda "mirna"; maxLow: koliko mirnog hoda smije ostati zaredom
  gentle: { label: 'Gentle: only loading screens, menus and long idle stretches', low: 0.12, maxLow: 30 },
  normal: { label: 'Normal: also trims slow walking and driving', low: 0.22, maxLow: 14 },
  tight: { label: 'Tight: keeps mostly the action', low: 0.32, maxLow: 7 },
};
const TARGETS = [
  [0, 'Keep all the action'],
  [45 * 60, 'About 45 minutes'],
  [30 * 60, 'About 30 minutes'],
  [20 * 60, 'About 20 minutes'],
  [12 * 60, 'About 12 minutes'],
];
const HOOK_SECONDS = 12;
const EDGE = 2; // koliko mirnog dijela ostaje na rubovima izbačenog hoda, da rez ne bude grub
const MIN_SEGMENT = 2;
const CHAPTER_GAP = 20; // izbačen dio barem ovoliko dug obično je prelaz → novo poglavlje
const CHAPTER_DEAD = 5; // ili izbačeno učitavanje/meni (crna ili mirna slika) od barem ovoliko sekundi
const MIN_CHAPTER = 60;

const round2 = (n) => Math.round(n * 100) / 100;

/** Vrijednost na mjestu `p` (0–1) u sortiranom nizu. */
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/**
 * Aktivnost 0–1 po sekundi: pola glasnoća igre, pola pokret slike, izglađeno na 3 s.
 * `levels` su decibeli po sekundi, `motion` prosječna promjena slike (0–255) po sekundi.
 */
function activity(levels, motion, seconds) {
  const lv = Array.from({ length: seconds }, (_, s) => levels[s] ?? -100);
  const mv = Array.from({ length: seconds }, (_, s) => motion[s] ?? 0);
  const lo = percentile([...lv].sort((a, b) => a - b), 0.05);
  const hi = percentile([...lv].sort((a, b) => a - b), 0.98);
  const mhi = percentile([...mv].sort((a, b) => a - b), 0.95) || 1;
  const raw = lv.map((db, s) => 0.5 * Math.max(0, Math.min(1, (db - lo) / (hi - lo || 1))) + 0.5 * Math.min(1, mv[s] / mhi));
  return raw.map((_, s) => {
    let sum = 0;
    let n = 0;
    for (let k = s - 1; k <= s + 1; k++) if (k >= 0 && k < raw.length) (sum += raw[k]), n++;
    return sum / n;
  });
}

/** Sekunde koje se sigurno izbacuju: crna slika i slika koja stoji barem 3 s (učitavanje, meni, pauza). */
function deadSeconds(motion, black, seconds) {
  const dead = Array.from({ length: seconds }, (_, s) => Boolean(black[s]));
  let run = 0;
  for (let s = 0; s <= seconds; s++) {
    const still = s < seconds && (motion[s] ?? 0) < 1.2;
    if (still) run++;
    if (!still || s === seconds) {
      if (run >= 3) for (let k = s - run; k < s; k++) dead[k] = true;
      run = 0;
    }
  }
  return dead;
}

/** Niz true/false po sekundi u dijelove [{ start, end }]. */
function toRanges(keep) {
  const out = [];
  let from = -1;
  keep.forEach((k, s) => {
    if (k && from < 0) from = s;
    if (!k && from >= 0) (out.push({ start: from, end: s }), (from = -1));
  });
  if (from >= 0) out.push({ start: from, end: keep.length });
  return out;
}

/**
 * Plan edita. `analysis`: { duration, levels, motion, black }. `options`: { target, tightness, hook }.
 * Vraća dijelove izvora koji ostaju, poglavlja i najavu, sa vremenima i u izvoru i u gotovom videu.
 */
function buildPlan(analysis, options = {}) {
  const duration = analysis.duration;
  const seconds = Math.floor(duration);
  const t = TIGHTNESS[options.tightness] || TIGHTNESS.normal;
  const act = activity(analysis.levels || [], analysis.motion || [], seconds);
  const dead = deadSeconds(analysis.motion || [], analysis.black || [], seconds);
  const sorted = [...act].sort((a, b) => a - b);
  const lowLine = percentile(sorted, t.low);
  const keep = dead.map((d) => !d);

  // Dug miran dio (hodanje, vožnja bez akcije): ostaju samo rubovi.
  let run = 0;
  for (let s = 0; s <= seconds; s++) {
    const quiet = s < seconds && keep[s] && act[s] <= lowLine;
    if (quiet) run++;
    if (!quiet || s === seconds) {
      if (run > t.maxLow) for (let k = s - run + EDGE; k < s - EDGE; k++) keep[k] = false;
      run = 0;
    }
  }

  // Ciljana dužina: izbacuju se najmirniji blokovi od 5 s dok video ne stane u nju.
  const target = Number(options.target) || 0;
  let kept = keep.filter(Boolean).length;
  if (target > 0 && kept > target) {
    const blocks = [];
    for (let s = 0; s < seconds; s += 5) {
      const idx = [];
      for (let k = s; k < Math.min(seconds, s + 5); k++) if (keep[k]) idx.push(k);
      if (idx.length) blocks.push({ idx, score: idx.reduce((sum, k) => sum + act[k], 0) / idx.length });
    }
    blocks.sort((a, b) => a.score - b.score);
    for (const b of blocks) {
      if (kept <= target) break;
      for (const k of b.idx) keep[k] = false;
      kept -= b.idx.length;
    }
  }

  // Kratke rupe se popune, prekratki dijelovi izbace.
  let ranges = toRanges(keep);
  const merged = [];
  for (const r of ranges) {
    const prev = merged[merged.length - 1];
    if (prev && r.start - prev.end < 1.5) prev.end = r.end;
    else merged.push({ ...r });
  }
  ranges = merged.filter((r) => r.end - r.start >= MIN_SEGMENT).map((r) => ({ start: r.start, end: Math.min(duration, r.end) }));
  if (!ranges.length) ranges = [{ start: 0, end: round2(duration) }];

  // Najava: najaktivnijih 12 s unutar jednog dijela, ne iz prvog minuta.
  let hook = null;
  if (options.hook !== false) {
    let best = -1;
    for (const r of ranges) {
      for (let s = Math.max(r.start, 60); s + HOOK_SECONDS <= r.end; s++) {
        let sum = 0;
        for (let k = s; k < s + HOOK_SECONDS; k++) sum += act[k] || 0;
        if (sum > best) (best = sum), (hook = { start: s, end: s + HOOK_SECONDS });
      }
    }
  }
  const offset = hook ? HOOK_SECONDS : 0;

  // Vrijeme u gotovom videu za svaki dio i poglavlja na mjestima dugih izbačenih prelaza.
  let at = offset;
  const segments = ranges.map((r) => {
    const s = { start: r.start, end: r.end, at: round2(at) };
    at += r.end - r.start;
    return s;
  });
  const chapters = [{ at: 0, source: segments[0].start }];
  segments.forEach((s, i) => {
    if (!i) return;
    const gap = s.start - segments[i - 1].end;
    let loading = 0;
    for (let k = Math.floor(segments[i - 1].end); k < s.start; k++) if (dead[k]) loading++;
    const sinceLast = s.at - chapters[chapters.length - 1].at;
    if ((gap >= CHAPTER_GAP || loading >= CHAPTER_DEAD) && sinceLast >= MIN_CHAPTER) chapters.push({ at: s.at, source: s.start });
  });
  // Posljednje poglavlje mora biti dovoljno dugo, inače se spaja sa prethodnim.
  if (chapters.length > 1 && at - chapters[chapters.length - 1].at < MIN_CHAPTER) chapters.pop();
  if (hook) chapters.forEach((c, i) => (c.at = i ? c.at : offset));

  return {
    duration: round2(duration),
    length: round2(at),
    removed: round2(duration - (at - offset)),
    segments,
    hook,
    chapters: [...(hook ? [{ at: 0, source: hook.start, highlight: true }] : []), ...chapters],
  };
}

/** "1:02:03" ili "4:05" za poglavlja u opisu. */
function stamp(t) {
  t = Math.floor(t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Imena poglavlja: najava, pa Part 1, Part 2… dok ih korisnik ne preimenuje. */
function chapterNames(plan, names = []) {
  let part = 0;
  return plan.chapters.map((c, i) => {
    if (!c.highlight) part++; // broj dijela ostaje isti i kad je neki preimenovan
    return (names[i] || '').replace(/\s+/g, ' ').trim().slice(0, 80) || (c.highlight ? 'Highlights' : `Part ${part}`);
  });
}

/** Opis za YouTube: naslov i poglavlja (YouTube ih prepozna kad počinju sa 0:00 i ima ih barem tri). */
function description(title, plan, names) {
  const list = plan.chapters.map((c, i) => `${stamp(c.at)} ${names[i]}`);
  return [title, '', ...(plan.chapters.length >= 3 ? ['Chapters:', ...list, ''] : []), 'No commentary gameplay.'].join('\n');
}

/** Sekunde izvora sa najviše akcije, razmaknute, za prijedloge thumbnaila. */
function thumbnailMoments(analysis, plan, count = 4) {
  const act = activity(analysis.levels || [], analysis.motion || [], Math.floor(analysis.duration));
  const keptSeconds = plan.segments.flatMap((s) => Array.from({ length: Math.floor(s.end - s.start) }, (_, k) => s.start + k));
  const picked = [];
  for (const s of keptSeconds.sort((a, b) => act[b] - act[a])) {
    if (picked.length >= count) break;
    if (picked.every((p) => Math.abs(p - s) > 60)) picked.push(s);
  }
  return picked.sort((a, b) => a - b);
}

module.exports = { TIGHTNESS, TARGETS, HOOK_SECONDS, activity, deadSeconds, buildPlan, stamp, chapterNames, description, thumbnailMoments };

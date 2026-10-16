'use strict';
// Kompilacija u scene: iz rezova koje je ffmpeg našao (vrijeme i jačina promjene slike)
// pravi listu scena za Shortse. Ovdje nema ni baze ni ffmpeg-a.

const SENSITIVITY = {
  // Najmanja jačina promjene slike (0–1) koja se računa kao novi klip.
  sensitive: { label: 'Sensitive: every cut, also inside a clip', score: 0.2 },
  normal: { label: 'Normal: clear cuts between clips', score: 0.32 },
  strict: { label: 'Strict: only very clear cuts', score: 0.45 },
};
// Short ne smije biti kraći od 15 s; kraća scena se spaja sa susjednom.
const MIN_SHORT = 15;
const MIN_LENGTHS = [
  [15, 'At least 15 s (shorter scenes are joined)'],
  [20, 'At least 20 s'],
  [30, 'At least 30 s'],
];
const MAX_SHORT = 180; // YouTube Short traje najviše 3 minute
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Scene: [{ start, end }]. `cuts`: [{ t, score }] iz analize, `black`: sekunde crne slike.
 * Rez slabiji od praga se ne računa. Scena kraća od `minLength` se pripoji susjednoj
 * (kratki kadrovi su obično rezovi unutar istog klipa). Crni prelazi između klipova se izbace.
 */
function buildScenes({ duration, cuts = [], black = [] }, { sensitivity = 'normal', minLength = MIN_SHORT } = {}) {
  minLength = Math.max(MIN_SHORT, minLength);
  const line = (SENSITIVITY[sensitivity] || SENSITIVITY.normal).score;
  const points = [0, ...cuts.filter((c) => c.score >= line && c.t > 0.3 && c.t < duration - 0.3).map((c) => c.t), duration];
  let scenes = [];
  for (let i = 1; i < points.length; i++) if (points[i] - points[i - 1] > 0.05) scenes.push({ start: points[i - 1], end: points[i] });

  // Crni dijelovi (prelazi, "fade to black") ne idu ni u jedan Short.
  const isBlack = (s) => {
    let n = 0;
    let all = 0;
    for (let k = Math.floor(s.start); k < Math.ceil(s.end); k++, all++) if (black[k]) n++;
    return all > 0 && n / all > 0.7;
  };
  scenes = scenes.filter((s) => !(s.end - s.start < 3 && isBlack(s)));

  // Prekratke scene se pripajaju kraćoj od dvije susjedne, dok sve ne budu dovoljno duge.
  let changed = true;
  while (changed && scenes.length > 1) {
    changed = false;
    const i = scenes.findIndex((s) => s.end - s.start < minLength);
    if (i < 0) break;
    const prev = scenes[i - 1];
    const next = scenes[i + 1];
    const into = !prev ? 'next' : !next ? 'prev' : prev.end - prev.start <= next.end - next.start ? 'prev' : 'next';
    if (into === 'prev') prev.end = scenes[i].end;
    else next.start = scenes[i].start;
    scenes.splice(i, 1);
    changed = true;
  }
  return scenes.map((s) => ({ start: round2(s.start), end: round2(s.end) }));
}

/**
 * Šta postaje Short: izabrane scene (indeksi u `list`), uz spajanja `joins` (scena i sa sljedećom).
 * Izabrana scena kraća od `min` se spaja sa kraćom susjednom (i kad ta nije izabrana), dok nije dovoljno duga.
 * Vraća [{ start, end }] redom.
 */
function pickScenes(list, { picked, joins = [], min = MIN_SHORT }) {
  let groups = list.map((s, i) => ({ start: s.start, end: s.end, picked: picked.has(i) }));
  for (const i of [...new Set(joins)].filter((j) => j >= 0 && j < list.length - 1).sort((a, b) => b - a)) {
    const a = groups[i];
    const b = groups[i + 1];
    groups.splice(i, 2, { start: a.start, end: b.end, picked: a.picked || b.picked });
  }
  for (;;) {
    const i = groups.findIndex((g) => g.picked && g.end - g.start < min);
    if (i < 0 || groups.length < 2) break;
    const prev = groups[i - 1];
    const next = groups[i + 1];
    const withPrev = !next || (prev && prev.end - prev.start <= next.end - next.start);
    const j = withPrev ? i - 1 : i + 1;
    const [a, b] = [groups[Math.min(i, j)], groups[Math.max(i, j)]];
    groups.splice(Math.min(i, j), 2, { start: a.start, end: b.end, picked: true });
  }
  groups = groups.filter((g) => g.picked);
  return groups.map((g) => ({ start: round2(g.start), end: round2(g.end) }));
}

/** Scena duža od 3 minute se dijeli na jednake dijelove, jer Short ne može biti duži. */
function shortsFor(scene) {
  const length = scene.end - scene.start;
  const parts = Math.max(1, Math.ceil(length / MAX_SHORT));
  const step = length / parts;
  return Array.from({ length: parts }, (_, i) => ({ start: round2(scene.start + i * step), end: round2(i === parts - 1 ? scene.end : scene.start + (i + 1) * step), part: parts > 1 ? i + 1 : 0, parts }));
}

module.exports = { SENSITIVITY, MIN_LENGTHS, MIN_SHORT, MAX_SHORT, buildScenes, pickScenes, shortsFor };

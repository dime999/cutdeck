'use strict';
// Efekti na samom snimku koji prate meme zvuk: zum, trešnja, boje… Ovdje se samo slaže ffmpeg filter.

const EFFECTS = [
  ['none', 'No effect'],
  ['punch', 'Punch zoom'],
  ['shake', 'Screen shake'],
  ['hype', 'Hype: shake, pulse and colour'],
  ['damage', 'Zoom with dark edges'],
  ['sad', 'Sad: black and white, slow zoom'],
  ['glitch', 'Glitch'],
];
const EFFECT_IDS = EFFECTS.map(([id]) => id);

/** Efekat koji se uz mem podrazumijeva, po imenu: Vine boom → zum, metal pipe → trešnja… Klipovi su bez efekta. */
function guessEffect(name, isSound) {
  if (!isSound) return 'none';
  const n = String(name).toLowerCase();
  if (/boom|bruh|thud|wow/.test(n)) return 'punch';
  if (/pipe|clang|bonk|punch|crash|fall/.test(n)) return 'shake';
  if (/air ?horn|mlg|hype|dj/.test(n)) return 'hype';
  if (/damage|oof|hurt/.test(n)) return 'damage';
  if (/sad|violin|cry/.test(n)) return 'sad';
  if (/err|glitch|windows|xp|fail/.test(n)) return 'glitch';
  return 'punch';
}

const num = (n) => Number(n).toFixed(2);
// Omotnica 0–1: raste za `a` s na početku, pada za `r` s na kraju prozora [T, E] (vrijeme `v`).
const env = (v, T, E, a, r) => `min(max((${v}-${num(T)})/${a},0),1)*min(max((${num(E)}-${v})/${r},0),1)`;

/**
 * Lanac filtera za efekte na videu (ulaz `[from]`, izlaz `[to]`), ili null kad efekata nema.
 * `items`: [{ at, show, effect }]. Zum i trešnja idu kroz jedan \`zoompan\` (stalna veličina kadra),
 * boje i bljeskovi kroz filtere sa \`enable\` za vrijeme efekta.
 */
function effectChain(items, { width, height, fps, from, to }) {
  const zoom = [];
  const dx = [];
  const dy = [];
  const extra = [];
  const it = 'it'; // vrijeme ulazne sličice u zoompan izrazima
  for (const p of items) {
    const T = p.at;
    const E = p.at + p.show;
    const on = `enable='between(t,${num(T)},${num(E)})'`;
    switch (p.effect) {
      case 'punch':
        zoom.push(`0.3*${env(it, T, E, 0.08, 0.15)}`);
        break;
      case 'shake': {
        const e = env(it, T, E, 0.02, 0.1);
        const fade = `max(0,1-(${it}-${num(T)})/${num(Math.min(p.show, 0.9))})`;
        zoom.push(`0.08*${e}`);
        dx.push(`34*${e}*${fade}*sin((${it}-${num(T)})*95)`);
        dy.push(`26*${e}*${fade}*sin((${it}-${num(T)})*71+1)`);
        break;
      }
      case 'hype': {
        const e = env(it, T, E, 0.05, 0.15);
        zoom.push(`0.06*${e}+0.12*${e}*abs(sin((${it}-${num(T)})*PI*4))`);
        dx.push(`18*${e}*sin((${it}-${num(T)})*80)`);
        dy.push(`14*${e}*sin((${it}-${num(T)})*63+2)`);
        extra.push(`eq=saturation=1.7:contrast=1.12:${on}`);
        break;
      }
      case 'damage':
        zoom.push(`0.22*${env(it, T, E, 0.1, 0.2)}`);
        extra.push(`vignette=angle=PI/3.2:${on}`, `eq=brightness=-0.05:${on}`);
        break;
      case 'sad':
        zoom.push(`0.14*min(max((${it}-${num(T)})/${num(p.show)},0),1)*${env(it, T, E, 0.3, 0.25)}`);
        extra.push(`hue=s=0:${on}`);
        break;
      case 'glitch': {
        const g = Math.min(p.show, 0.35);
        const e = env(it, T, T + g, 0.01, 0.05);
        zoom.push(`0.09*${e}`);
        dx.push(`40*${e}*(2*gt(sin((${it}-${num(T)})*140),0)-1)`);
        extra.push(`rgbashift=rh=14:bh=-14:enable='between(t,${num(T)},${num(T + g)})'`);
        extra.push(`drawbox=x=0:y=0:w=iw:h=ih:color=red@0.22:t=fill:enable='between(t,${num(T)},${num(T + 0.07)})'`);
        break;
      }
      default:
        break;
    }
  }
  const steps = [];
  if (zoom.length) {
    const z = `1+${zoom.join('+')}`;
    const x = `iw/2-iw/zoom/2${dx.length ? `+(${dx.join('+')})` : ''}`;
    const y = `ih/2-ih/zoom/2${dy.length ? `+(${dy.join('+')})` : ''}`;
    steps.push(`zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${width}x${height}:fps=${fps}`);
  }
  steps.push(...extra);
  return steps.length ? `[${from}]${steps.join(',')}[${to}]` : null;
}

module.exports = { EFFECTS, EFFECT_IDS, guessEffect, effectChain };

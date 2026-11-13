// The view settings that change the drawing (hidden lines, lines through nodes, the theme) and
// the URL hash that carries them, plus the view rectangle, so a link shows the same map:
//   #hide=A,B&through=all&theme=dark&view=x,y,w,h
// theme null = the DOT file's own theme, else light.
// `?src=` stays in the query; the hash is written with history.replaceState (no history spam).

import { THEME_NAMES } from '@linemap/core';

const MODES = ['file', 'all', 'none'];

const emptySettings = () => ({ hidden: new Set(), mode: 'file', theme: null });

// One settings object, replaced (never mutated) on every change, and one change event.
export function createState(initial = emptySettings()) {
  let settings = initial;
  const listeners = new Set();
  return {
    get: () => settings,
    set(patch) {
      settings = { ...settings, ...patch };
      for (const fn of listeners) fn(settings);
    },
    reset() { this.set(emptySettings()); },
    onChange(fn) { listeners.add(fn); },
  };
}

const enc = (s) => encodeURIComponent(s);
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

// Hash -> { settings, view }. Unknown or malformed parts are ignored.
export function readHash(hash = location.hash) {
  const settings = emptySettings();
  let view = null;
  for (const part of hash.replace(/^#/, '').split('&')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const [k, v] = [part.slice(0, i), part.slice(i + 1)];
    if (k === 'hide') settings.hidden = new Set(v.split(',').filter(Boolean).map(dec));
    else if (k === 'through' && MODES.includes(v)) settings.mode = v;
    else if (k === 'theme' && THEME_NAMES.includes(v)) settings.theme = v;
    else if (k === 'view') {
      const n = v.split(',').map(Number);
      if (n.length === 4 && n.every(Number.isFinite) && n[2] > 0 && n[3] > 0) view = { x: n[0], y: n[1], w: n[2], h: n[3] };
    }
  }
  return { settings, view };
}

function hashOf(settings, view) {
  const parts = [];
  if (settings.hidden.size) parts.push(`hide=${[...settings.hidden].map(enc).join(',')}`);
  if (settings.mode !== 'file') parts.push(`through=${settings.mode}`);
  if (settings.theme) parts.push(`theme=${settings.theme}`);
  if (view) parts.push(`view=${[view.x, view.y, view.w, view.h].map((v) => Math.round(v)).join(',')}`);
  return parts.length ? `#${parts.join('&')}` : '';
}

// Writes the hash; calls within `delay` ms of each other collapse into one write.
export function hashWriter(delay = 250) {
  let timer = 0;
  return (settings, view) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const h = hashOf(settings, view);
      if (h === location.hash || (!h && !location.hash)) return;
      try { history.replaceState(null, '', location.pathname + location.search + h); } catch { /* sandboxed pages */ }
    }, delay);
  };
}

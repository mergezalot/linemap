// The public API of @linemap/core: DOT text in, SVG string out. Other packages import only this
// file; the stage modules under src/ are internal.
import { parseFlow, STYLE, canThrough } from './src/model.mjs';
import { place, crowding } from './src/place.mjs';
import { route } from './src/route.mjs';
import { bundle, markColor } from './src/bundle.mjs';
import { inside } from './src/inside.mjs';
import { render } from './src/render.mjs';
import { THEMES, THEME_NAMES, DEFAULT_THEME, PALETTE, themeCss, paintLines } from './src/theme.mjs';

export { parseFlow, crowding, render, canThrough, STYLE, markColor, THEMES, THEME_NAMES, DEFAULT_THEME, PALETTE, themeCss, paintLines };

// Every stage between parsing and rendering, in order. Mutates and returns the model.
// Route, bundle and inside do not move items, so `crowding` gives the same answer after this.
// Options (all optional; none = the drawing the DOT file describes):
//   hiddenLines  Set of line ids to leave out. Edges left with no line are dropped; nodes stay.
//   through      { mode: 'file' | 'all' | 'none', nodes: Map id -> bool } overrides `through`;
//                `nodes` wins over `mode`, nodes whose shape cannot carry lines are left alone.
//   fixed        Map id -> {x, y}: positions for unpinned items, so a rerun keeps them in place.
// Routing (MSAGL) comes after placement, so it never moves a box.
export function layout(model, { hiddenLines, through, fixed } = {}) {
  // Stages write into the model (positions, paths, strands), so a second run would build on the
  // first one's results.
  if (model.laidOut) throw new Error('layout: this model is already laid out; parse the DOT text again');
  model.laidOut = true;

  if (through) {
    const { mode = 'file', nodes } = through;
    if (!['file', 'all', 'none'].includes(mode)) throw new Error(`layout: through.mode must be file, all or none, not "${mode}"`);
    for (const n of model.nodes) {
      if (!canThrough(n)) continue;
      n.through = nodes?.get(n.id) ?? (mode === 'all' ? true : mode === 'none' ? false : n.through);
    }
  }
  for (const [id, p] of fixed ?? []) {
    const n = model.items.get(id);
    if (n && !n.pinned) [n.x, n.y] = [p.x, p.y];
  }

  place(model);
  // Hidden lines go after placement, so hiding a line never moves anything.
  if (hiddenLines?.size) {
    for (const l of model.lines) l.hidden = hiddenLines.has(l.id);
    for (const e of model.edges) e.lines = e.lines.filter((l) => !l.hidden);
    model.edges = model.edges.filter((e) => e.lines.length);
  }
  route(model);
  bundle(model);
  inside(model);
  return model;
}

// Computed positions of unpinned nodes and notes, for pinning them in the DOT file.
export const positions = (model) =>
  [...model.items.values()].filter((n) => !n.pinned).map(({ id, x, y }) => ({ id, x, y }));

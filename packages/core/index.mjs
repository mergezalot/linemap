// The public API of @linemap/core: DOT text in, SVG string out. Other packages import only this
// file; the stage modules under src/ are internal.
import { parseFlow, STYLE, canThrough, LEGEND_ID, LEGEND_ANCHORS } from './src/model.mjs';
import { place, crowding } from './src/place.mjs';
import { route } from './src/route.mjs';
import { bundle, markColor } from './src/bundle.mjs';
import { inside } from './src/inside.mjs';
import { render, frame, legendCentre } from './src/render.mjs';
import { editDot, labelSource } from './src/edit.mjs';
import { statementsOf } from './src/dot.mjs';
import { THEMES, THEME_NAMES, DEFAULT_THEME, PALETTE, themeCss, paintLines } from './src/theme.mjs';

export { editDot, labelSource, statementsOf, parseFlow, crowding, render, canThrough, LEGEND_ANCHORS, STYLE, markColor, THEMES, THEME_NAMES, DEFAULT_THEME, PALETTE, themeCss, paintLines };

// Every stage between parsing and rendering, in order. Mutates and returns the model.
// Route, bundle and inside do not move items, so `crowding` gives the same answer after this.
// Options (all optional; none = the drawing the DOT file describes):
//   hiddenLines  Set of line ids to leave out. Edges left with no line are dropped; nodes stay.
//   through      { mode: 'file' | 'all' | 'none', nodes: Map id -> bool } overrides `through`;
//                `nodes` wins over `mode`, nodes whose shape cannot carry lines are left alone.
//   fixed        Map id -> {x, y}: positions for unpinned items, so a rerun keeps them in place.
//   notes        'show' (default) or 'hide': lay out and route the map as if the notes were not
//                there, so boxes and lines may take their room. The notes left out move to
//                `model.hiddenNotes`, unplaced; render draws none of them, unless asked for icons.
//   diagonals    true or false overrides the file's `diagonals` (experimental: 45° corners).
//   legend       false: `legendpos` is ignored, so nothing keeps clear of it; for an SVG without
//                a legend (render with { legend: false }), or one whose legend is drawn elsewhere.
//                A legend rendered anyway goes outside the map, by its `legend` anchor.
// Routing (MSAGL) comes after placement, so it never moves a box.
export const NOTE_MODES = ['show', 'hide'];
export function layout(model, { hiddenLines, through, fixed, notes = 'show', legend = true, diagonals } = {}) {
  // Stages write into the model (positions, paths, strands), so a second run would build on the
  // first one's results.
  if (model.laidOut) throw new Error('layout: this model is already laid out; parse the DOT text again');
  model.laidOut = true;
  if (!NOTE_MODES.includes(notes)) throw new Error(`layout: notes must be ${NOTE_MODES.join(' or ')}, not "${notes}"`);
  model.hiddenNotes = [];
  if (notes === 'hide') {
    model.hiddenNotes = model.notes;
    model.notes = [];
    for (const n of model.hiddenNotes) model.items.delete(n.id);
  }

  if (through) {
    const { mode = 'file', nodes } = through;
    if (!['file', 'all', 'none'].includes(mode)) throw new Error(`layout: through.mode must be file, all or none, not "${mode}"`);
    for (const n of model.nodes) {
      if (!canThrough(n)) continue;
      n.through = nodes?.get(n.id) ?? (mode === 'all' ? true : mode === 'none' ? false : n.through);
    }
  }
  if (diagonals !== undefined) model.diagonals = !!diagonals;
  if (!legend) {
    model.items.delete(LEGEND_ID);
    model.legend.at = null;
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

// Where render puts the legend's centre, rounded, for pinning it with `legendpos`; null when it
// has one already, or when there are no lines (and so no legend).
export function legendPosition(model) {
  if (model.legend.at || !model.lines.length) return null;
  const [x, y] = legendCentre(model.legend, frame(model));
  return { x: Math.round(x), y: Math.round(y) };
}

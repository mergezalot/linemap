// Turns each routed edge (one centre path) into one drawn path per line, side by side.
// Lines keep the same order on every edge (the order of `subgraph lines`), counted from the
// left of the direction of travel, so a line keeps its lane along a chain.
import { STYLE, groupRects, rectOf, textWidth, edgeLabelSize } from './model.mjs';
import { placeLabels } from './msagl.mjs';
import { f, sub, len, unit } from './geom.mjs';

const CORNER = 32;   // corner radius of the bundle centre line
// Direction triangles are drawn inside the line, so their size follows the line width.
const MARK_LEN = STYLE.lineWidth * 1.15;
const MARK_HALF = STYLE.lineWidth * 0.3;

const left = (u) => ({ x: u.y, y: -u.x }); // left of travel on screen (y points down)

// Offset an orthogonal polyline by d (positive = left of travel).
function offset(pts, d) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const nIn = i > 0 ? left(unit(sub(pts[i], pts[i - 1]))) : null;
    const nOut = i < pts.length - 1 ? left(unit(sub(pts[i + 1], pts[i]))) : null;
    let n;
    if (nIn && nOut) {
      // corner: move along both normals (exact for right angles, close enough otherwise)
      const dot = nIn.x * nOut.x + nIn.y * nOut.y;
      n = dot > 0.99 ? nIn : { x: nIn.x + nOut.x, y: nIn.y + nOut.y };
    } else n = nIn ?? nOut;
    out.push({ x: pts[i].x + n.x * d, y: pts[i].y + n.y * d });
  }
  return out;
}

// SVG path with rounded corners. Inner lanes get tighter corners than outer ones,
// so the bundle bends like a set of rails.
function roundedPath(pts, d) {
  if (pts.length < 2) return '';
  let s = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const u1 = unit(sub(b, a)), u2 = unit(sub(c, b));
    const cross = u1.x * u2.y - u1.y * u2.x; // > 0: right turn on screen
    const r = Math.max(2, Math.min(CORNER + Math.sign(cross) * d, len(sub(b, a)) / 2, len(sub(c, b)) / 2));
    const p = { x: b.x - u1.x * r, y: b.y - u1.y * r };
    const q = { x: b.x + u2.x * r, y: b.y + u2.y * r };
    s += ` L${f(p.x)},${f(p.y)} Q${f(b.x)},${f(b.y)} ${f(q.x)},${f(q.y)}`;
  }
  const z = pts[pts.length - 1];
  return s + ` L${f(z.x)},${f(z.y)}`;
}

export function bundle(model) {
  for (const e of model.edges) {
    const pts = e.path;
    const startIn = diamondInset(model.items.get(e.from), pts[0], pts[1], n0(e));
    const endIn = diamondInset(model.items.get(e.to), pts[pts.length - 1], pts[pts.length - 2], n0(e));
    const lines = [...e.lines].sort((a, b) => a.index - b.index);
    const n = lines.length;
    e.width = n * STYLE.linePitch;
    // Triangle spots are chosen once on the centre line, so every lane gets them side by side.
    const spots = markerSpots(pts, n, startIn, endIn);
    // At a diamond corner the lanes run on under the diamond, which is drawn on top and
    // cuts them along its slanted edges.
    const drawn = extendEnds(pts, startIn ? startIn + 2 : 0, endIn ? endIn + 2 : 0);
    e.strands = lines.map((line, i) => {
      const d = (i - (n - 1) / 2) * STYLE.linePitch;
      const o = offset(drawn, -d); // first line on the left of travel
      const marks = spots.map(({ p, u }) => {
        const nl = left(u);
        return triangle({ x: p.x - nl.x * d, y: p.y - nl.y * d }, u);
      });
      // where this lane meets the shapes at either end, and its direction of travel there
      const k = o.length - 1;
      const start = { p: o[0], u: unit(sub(o[1], o[0])) };
      const end = { p: o[k], u: unit(sub(o[k], o[k - 1])) };
      return { line, d: roundedPath(o, -d), marks, start, end };
    });
    e.casing = roundedPath(drawn, 0);
  }
  labels(model);
  return model;
}

// Edge labels go beside their bundle where they cover nothing, by MSAGL's edge label placement:
// it walks along the bundle from its middle and takes the first spot clear of other labels,
// then of boxes, notes and container titles, then of lines. MSAGL sees lines as thin (and samples
// them sparsely), so every bundle is also given to it in pieces LINE_STEP px long, and every label
// as its pill grown by half the widest bundle (plus a gap) all round: then a pill that clears the
// lines comes no closer to any bundle than that.
const LINE_STEP = 12;
const LABEL_GAP = 6;
function labels(model) {
  const labelled = model.edges.filter((e) => e.label);
  if (!labelled.length) return;
  const pad = Math.max(...model.edges.map((e) => e.width)) / 2 + LABEL_GAP;
  const obstacles = [...model.items.values()].map((n) => rectOf(n));
  for (const [id, r] of groupRects(model)) {
    const { label, style } = model.groupById.get(id);
    if (label) obstacles.push({ x0: r.x0, y0: r.y0, x1: r.x0 + 30 + textWidth(label, style.fontSize), y1: r.y0 + 44 });
  }
  const pieces = [];
  for (const e of model.edges) {
    for (let i = 1; i < e.path.length; i++) {
      const [a, b] = [e.path[i - 1], e.path[i]];
      const n = Math.max(1, Math.round(len(sub(b, a)) / LINE_STEP));
      for (let k = 0; k < n; k++) {
        const at = (t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        pieces.push({ path: [at(k / n), at((k + 1) / n)] });
      }
    }
  }
  const spots = placeLabels({
    obstacles,
    edges: [...model.edges.map((e) => ({ path: e.path, label: e.label && edgeLabelSize(e.label) })), ...pieces],
    pad,
  });
  // MSAGL leaves room for the widest bundle; move each pill in to LABEL_GAP from its own one
  model.edges.forEach((e, i) => {
    if (!spots.has(i)) return;
    const c = spots.get(i);
    const { w, h } = edgeLabelSize(e.label);
    let best = null;
    for (let k = 1; k < e.path.length; k++) {
      const [a, b] = [e.path[k - 1], e.path[k]];
      const t = Math.max(0, Math.min(1, ((c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y)) / (len(sub(b, a)) ** 2 || 1)));
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const d = len(sub(c, p));
      if (!best || d < best.d) best = { d, p, horizontal: Math.abs(b.y - a.y) < Math.abs(b.x - a.x) };
    }
    const keep = e.width / 2 + LABEL_GAP;
    const { p, horizontal } = best;
    e.labelAt = horizontal
      ? { x: c.x, y: p.y + Math.sign(c.y - p.y || 1) * Math.min(Math.abs(c.y - p.y), keep + h / 2) }
      : { x: p.x + Math.sign(c.x - p.x || 1) * Math.min(Math.abs(c.x - p.x), keep + w / 2), y: c.y };
  });
}
const n0 = (e) => e.lines.length;

// How far the outermost lane is cut back by the slanted edge where a bundle meets a
// diamond corner. Zero for every other shape.
function diamondInset(shape, end, next, lanes) {
  if (!shape || shape.shape !== 'diamond' || !next) return 0;
  const half = (lanes * STYLE.linePitch) / 2;
  const horizontal = Math.abs(next.x - end.x) > Math.abs(next.y - end.y);
  return horizontal ? half * (shape.w / shape.h) : half * (shape.h / shape.w);
}

// Lengthen the first and last segment of a polyline (into the shapes at either end).
function extendEnds(pts, a, b) {
  const out = pts.map((p) => ({ ...p }));
  if (a) {
    const u = unit(sub(out[1], out[0]));
    out[0] = { x: out[0].x - u.x * a, y: out[0].y - u.y * a };
  }
  if (b) {
    const k = out.length - 1;
    const u = unit(sub(out[k], out[k - 1]));
    out[k] = { x: out[k].x + u.x * b, y: out[k].y + u.y * b };
  }
  return out;
}

function triangle(p, u) {
  const n = left(u);
  const tip = { x: p.x + u.x * MARK_LEN / 2, y: p.y + u.y * MARK_LEN / 2 };
  const base = { x: p.x - u.x * MARK_LEN / 2, y: p.y - u.y * MARK_LEN / 2 };
  return [tip, { x: base.x + n.x * MARK_HALF, y: base.y + n.y * MARK_HALF },
    { x: base.x - n.x * MARK_HALF, y: base.y - n.y * MARK_HALF }];
}

// Spots on the centre line for direction triangles: one just before the end, and more every
// markerSpacing px on straight stretches, away from corners (the outer lane of an n-lane bundle
// curves furthest, so the clearance grows with n).
function markerSpots(pts, n, startIn = 0, endIn = 0) {
  const clear = CORNER + ((n + 1) / 2) * STYLE.linePitch;
  const tri = (p, u) => ({ p, u });
  const out = [];
  const last = pts.length - 2;
  for (let i = 0; i <= last; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = len(sub(b, a));
    const u = unit(sub(b, a));
    const startClear = i === 0 ? startIn + 4 : clear;
    const endClear = i === last ? 0 : clear;
    const at = (t) => ({ x: a.x + u.x * t, y: a.y + u.y * t });
    if (i === last) {
      // always one at the end, where an arrowhead would be
      const t = L - endIn - MARK_LEN / 2 - 6;
      if (t > startClear) out.push(tri(at(t), u));
      for (let t2 = t - STYLE.markerSpacing; t2 > startClear + MARK_LEN; t2 -= STYLE.markerSpacing) out.push(tri(at(t2), u));
    } else {
      const usable = L - startClear - endClear;
      const k = Math.floor(usable / STYLE.markerSpacing);
      for (let j = 1; j <= k; j++) out.push(tri(at(startClear + (usable * j) / (k + 1)), u));
    }
  }
  return out;
}

// Triangles must stand out on every line colour: white on dark lines, dark on light ones.
// `hex` is #rrggbb (model.mjs checks line colours).
export function markColor(hex) {
  const v = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? 'rgba(0,0,0,0.6)' : '#ffffff';
}

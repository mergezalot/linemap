// Turns a flow (DOT text) into the in-memory model used by every later stage. No I/O here:
// the caller reads the file, so the same code runs in the browser.
import { readDot } from './dot.mjs';
import { autoColor, THEMES } from './theme.mjs';

export const STYLE = {
  font: 15,
  lineHeight: 19,
  notePad: 12,
  groupPad: 60,
  lineWidth: 9,
  linePitch: 9, // distance between line centres inside a bundle; equal to lineWidth = no gap
  markerSpacing: 240, // distance between direction triangles along a line
};

// Every box is a node; its size and type come from its shape and its DOT attributes. Precedence,
// lowest first: BASE, the shape's defaults, the attributes (including `node [...]` defaults).
// Colours come from the theme (theme.mjs) unless the DOT file sets them.
const BASE = { 'font-size': 15 };
const SHAPES = {
  box: { size: [250, 170] },
  diamond: { size: [300, 200] },
  person: { size: [140, 140], bold: true },
  cylinder: { size: [250, 170] },
  queue: { size: [250, 170] },
  // A note is sized from its text and left-aligned.
  note: { 'font-size': 13, italic: true },
};
const SHAPE_ALIASES = { rect: 'box', rectangle: 'box' };
// Shapes whose inside is a plain rectangle, so lines can be drawn through them (`through=true`).
const THROUGH_SHAPES = ['box', 'queue', 'cylinder'];
export const canThrough = (node) => node.kind === 'node' && THROUGH_SHAPES.includes(node.shape);
// A cluster subgraph is a container; its box is computed from its members.
// Its `color` is an accent: the theme derives a tinted fill, border and title from it.
const CONTAINER = { 'font-size': 18, bold: true };

// Style attributes, with Graphviz's names and units (fontsize in points = px).
const STYLE_ATTRS = ['color', 'fillcolor', 'fontcolor', 'fontsize'];
const DOT_ATTRS = {
  graph: ['label', 'theme'],
  cluster: ['label', 'class', ...STYLE_ATTRS],
  line: ['label', 'color'],
  node: ['label', 'class', 'shape', 'pos', 'width', 'height', 'through', 'URL', 'href', ...STYLE_ATTRS],
  edge: ['label', 'lines', 'via'],
};
// Attributes that only Graphviz uses. They are accepted, so the file still previews well in
// Graphviz tools, and otherwise ignored.
const GRAPHVIZ_ONLY = new Set(['style', 'arrowhead', 'arrowtail', 'arrowsize', 'dir', 'rankdir', 'splines',
  'penwidth', 'fontname', 'margin', 'ranksep', 'nodesep', 'compound', 'constraint', 'weight', 'labeljust',
  'labelloc', 'tooltip', 'bgcolor', 'newrank', 'concentrate', 'fixedsize']);

const check = (kind, id, attrs) => {
  for (const k of Object.keys(attrs)) {
    if (!DOT_ATTRS[kind].includes(k) && !GRAPHVIZ_ONLY.has(k)) throw new Error(`${kind} ${id}: unknown attribute "${k}"`);
  }
};
const px = (v, what) => {
  const m = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(v);
  if (!m) throw new Error(`${what}: expected a number of px, got "${v}"`);
  return Number(m[1]);
};
// Sizes are in inches, as in Graphviz, so a Graphviz preview gets them right. 1 in = 72 px.
const inches = (v, what) => {
  const m = /^\d+(?:\.\d+)?$/.exec(v);
  if (!m || !(Number(v) > 0)) throw new Error(`${what}: expected a number of inches above zero, got "${v}"`);
  return Math.round(Number(v) * 72);
};
// "x,y" (Graphviz's "x,y!" is accepted too), in px, y pointing down.
const point = (v, what) => {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*!?\s*$/.exec(v);
  if (!m) throw new Error(`${what}: expected "x,y", got "${v}"`);
  return [Number(m[1]), Number(m[2])];
};
// Colours are hex only (#rgb or #rrggbb), returned as lower-case #rrggbb. Hex is valid Graphviz
// too, and a fixed form means no DOT value ever reaches the SVG as anything but six hex digits.
const color = (v, what) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (!m) throw new Error(`${what}: expected a colour like #1565c0, got "${v}"`);
  return `#${(m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]).toLowerCase()}`;
};
// Links: http(s), mailto or relative (no scheme), so a URL can never run script.
const url = (v, what) => {
  if (/^(https?:|mailto:)/i.test(v) || !/^[^/?#]*:/.test(v)) return v;
  throw new Error(`${what}: URL must be http(s), mailto or relative, got "${v}"`);
};

// DOT style attributes -> the property names the rest of the pipeline uses.
function styleProps(attrs, what) {
  const p = {};
  if (attrs.color !== undefined) p.stroke = color(attrs.color, `${what}: color`);
  if (attrs.fillcolor !== undefined) p.fill = color(attrs.fillcolor, `${what}: fillcolor`);
  if (attrs.fontcolor !== undefined) p['font-color'] = color(attrs.fontcolor, `${what}: fontcolor`);
  if (attrs.fontsize !== undefined) p['font-size'] = px(attrs.fontsize, `${what}: fontsize`);
  if (attrs.width !== undefined) p.width = inches(attrs.width, `${what}: width`);
  if (attrs.height !== undefined) p.height = inches(attrs.height, `${what}: height`);
  return p;
}

// Rough text width; good enough for sizing notes without a font engine.
export const textWidth = (s, size) => s.length * size * 0.56;

// Size of an edge label's pill.
export const edgeLabelSize = (label) => {
  const rows = label.split('\n');
  return { w: Math.max(...rows.map((r) => textWidth(r, 12))) + 18, h: rows.length * 15 + 8 };
};

// fill, stroke and fontColor: only when the DOT file sets them, otherwise the theme's.
const pickStyle = (p) => ({
  fill: p.fill, stroke: p.stroke, fontColor: p['font-color'],
  fontSize: p['font-size'], lineHeight: Math.round(p['font-size'] * 1.27),
  italic: !!p.italic, bold: !!p.bold,
});

export function parseFlow(text) {
  const dot = readDot(text);
  check('graph', dot.id, dot.attrs);
  const theme = dot.attrs.theme ?? null;
  if (theme && !THEMES[theme]) throw new Error(`graph: unknown theme "${theme}" (known: ${Object.keys(THEMES).join(', ')})`);

  const lines = dot.lines.map((l, index) => {
    check('line', l.id, l.attrs);
    // no colour: the next one from the palette
    // (`auto`: its palette number, for render to paint it in the theme's palette)
    if (l.attrs.color === undefined) return { id: l.id, index, label: l.attrs.label ?? l.id, color: autoColor(index), auto: index };
    return { id: l.id, index, label: l.attrs.label ?? l.id, color: color(l.attrs.color, `line ${l.id}: color`) };
  });
  const lineById = new Map(lines.map((l) => [l.id, l]));

  const groups = dot.clusters.map((c) => {
    check('cluster', c.id, c.attrs);
    const { stroke: accent, ...own } = styleProps(c.attrs, `cluster ${c.id}`);
    return {
      id: c.id,
      label: c.attrs.label ?? c.id.replace(/^cluster_?/, ''),
      accent: accent ?? null,
      parent: c.parent?.id ?? null,
      classes: c.attrs.class ?? '',
      style: pickStyle({ ...CONTAINER, ...own }),
    };
  });

  const nodes = [];
  const notes = [];
  for (const n of dot.nodes) {
    check('node', n.id, n.attrs);
    const shape = SHAPE_ALIASES[n.attrs.shape] ?? n.attrs.shape ?? 'box';
    if (!SHAPES[shape]) throw new Error(`node ${n.id}: unknown shape "${shape}" (known: ${Object.keys(SHAPES).join(', ')})`);
    const own = styleProps(n.attrs, `node ${n.id}`);
    const style = pickStyle({ ...BASE, ...SHAPES[shape], ...own });
    const at = n.attrs.pos !== undefined ? point(n.attrs.pos, `node ${n.id}: pos`) : null;
    const through = n.attrs.through === undefined ? false : n.attrs.through === 'true' ? true
      : n.attrs.through === 'false' ? false : null;
    if (through === null) throw new Error(`node ${n.id}: through must be true or false, got "${n.attrs.through}"`);
    if (through && !THROUGH_SHAPES.includes(shape)) {
      throw new Error(`node ${n.id}: through=true needs one of the shapes ${THROUGH_SHAPES.join(', ')}, not ${shape}`);
    }
    const link = n.attrs.href ?? n.attrs.URL; // synonyms in Graphviz; href wins
    const item = {
      id: n.id, shape, label: n.attrs.label ?? n.id, style,
      classes: n.attrs.class ?? '',
      url: link !== undefined ? url(link, `node ${n.id}`) : null,
      group: n.cluster?.id ?? null,
      pinned: !!at,
      through,
      x: at?.[0], y: at?.[1], // centre
    };
    if (shape === 'note') {
      const rows = item.label.split('\n');
      const pad = STYLE.notePad;
      item.kind = 'note';
      item.attach = null;
      item.w = own.width ?? Math.ceil(Math.max(...rows.map((r) => textWidth(r, style.fontSize)))) + 2 * pad;
      item.h = own.height ?? rows.length * style.lineHeight + 2 * pad;
      notes.push(item);
    } else {
      item.kind = 'node';
      item.w = own.width ?? SHAPES[shape].size[0];
      item.h = own.height ?? SHAPES[shape].size[1];
      nodes.push(item);
    }
  }
  if (!nodes.length && !notes.length) throw new Error('the graph has no nodes');
  const items = new Map([...nodes, ...notes].map((n) => [n.id, n]));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const inGroup = (item, gid) => {
    for (let g = item.group; g; g = groupById.get(g).parent) if (g === gid) return true;
    return false;
  };

  // An edge end may also be a cluster id: the edge then ends at the container's border.
  // An edge to or from a note attaches the note. Every other edge carries the lines listed in its
  // `lines` attribute. The same pair of nodes may appear in several edge statements: their lines
  // are merged into one edge, and their labels must agree. Edge order = first appearance.
  const edgeById = new Map();
  for (const x of dot.edges) {
    const id = `${x.from}->${x.to}`;
    check('edge', id, x.attrs);
    const [a, b] = [items.get(x.from) ?? groupById.get(x.from), items.get(x.to) ?? groupById.get(x.to)];
    if (x.from === x.to) throw new Error(`DOT line ${x.line}: edge ${id} is a loop`);
    for (const [g, other] of [[a, b], [b, a]]) {
      if (groupById.has(g.id) && (inGroup(other, g.id) || (groupById.has(other.id) && inGroup({ group: other.parent }, g.id)))) {
        throw new Error(`DOT line ${x.line}: edge ${id} links container ${g.id} to something inside it`);
      }
    }
    if (a.kind === 'note' || b.kind === 'note') {
      if (groupById.has(a.id) || groupById.has(b.id)) throw new Error(`DOT line ${x.line}: edge ${id}: a note attaches to a node, not a container`);
      if (a.kind === b.kind) throw new Error(`DOT line ${x.line}: edge ${id} links two notes`);
      if (x.attrs.lines) throw new Error(`DOT line ${x.line}: edge ${id} attaches a note, so it cannot carry lines`);
      const [note, target] = a.kind === 'note' ? [a, b] : [b, a];
      if (note.attach && note.attach !== target.id) throw new Error(`note ${note.id}: attached to both ${note.attach} and ${target.id}`);
      note.attach = target.id;
      continue;
    }
    const lineIds = (x.attrs.lines ?? '').split(/[\s,]+/).filter(Boolean);
    if (!lineIds.length) throw new Error(`DOT line ${x.line}: edge ${id} has no lines; set lines="..." on it or with edge [lines="..."]`);
    if (!edgeById.has(id)) edgeById.set(id, { id, from: x.from, to: x.to, lines: [], label: null, via: [] });
    const e = edgeById.get(id);
    for (const lid of lineIds) {
      const l = lineById.get(lid);
      if (!l) throw new Error(`DOT line ${x.line}: edge ${id}: unknown line "${lid}"`);
      if (!e.lines.includes(l)) e.lines.push(l);
    }
    const label = x.attrs.label;
    if (label) {
      if (e.label && e.label !== label) throw new Error(`edge ${id}: label "${label}" conflicts with "${e.label}"`);
      e.label = label;
    }
    if (x.attrs.via) e.via = x.attrs.via.trim().split(/\s+/).map((p) => point(p, `edge ${id}: via`));
  }
  // Lane order inside a bundle follows the order of the line declarations.
  for (const e of edgeById.values()) e.lines.sort((a, b) => a.index - b.index);
  const edges = [...edgeById.values()];

  return { theme, lines, groups, groupById, nodes, notes, items, edges, legend: {} };
}

// The containers an item is in, innermost first.
export function containersOf(model, item) {
  const out = new Set();
  for (let g = item?.group; g; g = model.groupById.get(g).parent) out.add(g);
  return out;
}

export const rectOf = (n, pad = 0) => ({
  x0: n.x - n.w / 2 - pad, y0: n.y - n.h / 2 - pad,
  x1: n.x + n.w / 2 + pad, y1: n.y + n.h / 2 + pad,
});

// Container rectangles are derived from their members (and nested containers), so they never
// need positions.
export function groupRects(model) {
  const out = new Map();
  const rectFor = (g) => {
    if (out.has(g.id)) return out.get(g.id);
    const rs = [...model.nodes, ...model.notes]
      .filter((n) => n.group === g.id && n.x !== undefined)
      .map((n) => rectOf(n, STYLE.groupPad));
    for (const c of model.groups.filter((c) => c.parent === g.id)) {
      const r = rectFor(c);
      if (r) rs.push(rectOf({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2, w: r.x1 - r.x0, h: r.y1 - r.y0 }, STYLE.groupPad / 2));
    }
    const r = rs.length ? {
      x0: Math.min(...rs.map((q) => q.x0)), y0: Math.min(...rs.map((q) => q.y0)),
      x1: Math.max(...rs.map((q) => q.x1)), y1: Math.max(...rs.map((q) => q.y1)),
    } : null;
    out.set(g.id, r);
    return r;
  };
  for (const g of model.groups) rectFor(g);
  for (const [id, r] of out) if (!r) out.delete(id);
  return out;
}

// Themes: how a map is painted. A theme never changes the layout, only colours, strokes and type,
// so switching it is a re-render. Each theme compiles to a CSS block inside the SVG; every drawn
// element carries an `lm-*` class, so extra CSS (render's `css` option) can restyle any part.
// Colours set in the DOT file are inline styles, which win over the theme.
// No CSS variables for colours, so simple SVG converters (resvg, rsvg-convert) draw the colours
// right. (The travelling arrows of `line.flow` use them, and fall back to still triangles there.)

// Line colours for lines without `color`, in order of declaration. Mid-tone and saturated, so they
// read on light and dark backgrounds alike, and spread around the colour wheel so the first few
// are far apart.
export const PALETTE = [
  '#2563eb', // blue
  '#e0362c', // red
  '#16a34a', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#0ea5b7', // cyan
  '#ec4899', // pink
  '#64748b', // slate
  '#8b5a2b', // brown
  '#f97316', // orange
  '#84cc16', // lime
  '#0f766e', // teal
];
// The i-th palette colour: the theme's own `palette` if it has one, else PALETTE.
export const autoColor = (i, t) => {
  const p = t?.palette ?? PALETTE;
  return p[i % p.length];
};
// Lines without `color` keep their palette number (`auto`); painting them for a theme gives them
// that theme's colour, so switching theme can recolour them.
export function paintLines(lines, t) {
  for (const l of lines) if (l.auto !== undefined) l.color = autoColor(l.auto, t);
  return lines;
}

const SANS = "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif";

// Tokens per theme. `accent` mixes a container's `color` with the theme: how much of the
// background goes into its fill and border, and how much ink into its title. `radius`: corner
// radii in px. `node.sheen`: a tint over the top of each box, fading out over `depth` px. `shadow`: drop shadows for nodes, containers and small things (notes, labels, the
// legend), each a list of layers { dx, dy, blur, color, opacity }; blur 0 = a hard print shadow.
// `palette`: colours for lines without `color` in place of PALETTE. `group.tabInk`: the text on
// a container's tab (default: the background). `line.glow`: wider, faint copies of each line under it, as [{ grow, opacity }] (px added to the
// line width). `line.flow`: arrows travelling along each line in its direction, in place of the
// still triangles: one about every `period` px, `length` long and `half` wide to each side,
// moving at `speed` px a second. They are a CSS animation inside the SVG (motion paths), so they
// run wherever a browser shows it; a renderer without motion paths draws the still triangles.
const SOFT = (color, k = 1) => ({
  node: [{ dy: 1, blur: 1.2, color, opacity: 0.1 * k }, { dy: 6, blur: 10, color, opacity: 0.12 * k }],
  group: [{ dy: 2, blur: 8, color, opacity: 0.05 * k }],
  small: [{ dy: 1, blur: 2, color, opacity: 0.1 * k }],
});
export const THEMES = {
  light: {
    label: 'Light',
    font: SANS,
    bg: '#ffffff', ink: '#1f2933', muted: '#6b7683',
    node: { fill: '#ffffff', stroke: '#2b343f', width: 2, weight: 500 },
    person: '#596573',
    note: { fill: '#f7f8fa', stroke: '#dfe3e8', ink: '#6b7683' },
    group: { fill: '#f3f5f7', stroke: '#dbe0e6', title: '#4b5663', width: 1.25 },
    accent: { fill: 0.93, stroke: 0.55, title: 0.3 },
    edgeLabel: { fill: '#ffffff', stroke: '#cfd5dc', ink: '#1f2933' },
    noteLink: '#b9c0c8',
    legend: { fill: '#ffffff', stroke: '#dbe0e6' },
    radius: { node: 14, group: 22, note: 8, label: 99 },
    shadow: SOFT('#0f1a2a'),
  },
  dark: {
    label: 'Dark',
    font: SANS,
    bg: '#10141a', ink: '#e6e9ed', muted: '#8f99a5',
    node: { fill: '#1a2029', stroke: '#9aa5b3', width: 1.75, weight: 500, sheen: { color: '#ffffff', opacity: 0.07, depth: 44 } },
    person: '#9aa5b3',
    note: { fill: '#151a21', stroke: '#2b323c', ink: '#8f99a5' },
    group: { fill: '#151a21', stroke: '#2b323c', title: '#aeb7c2', width: 1.25, titles: 'tab' },
    accent: { fill: 0.92, stroke: 0.5, title: 0.6 },
    edgeLabel: { fill: '#1a2029', stroke: '#3a434f', ink: '#e6e9ed' },
    noteLink: '#4a5461',
    legend: { fill: '#151a21', stroke: '#2b323c' },
    radius: { node: 14, group: 22, note: 8, label: 99 },
    shadow: SOFT('#000000', 4),
  },
  // No outlines: white cards with soft shadows on a light grey, containers as tinted areas.
  minimal: {
    label: 'Minimal',
    font: SANS,
    bg: '#f1f3f6', ink: '#1d2530', muted: '#6b7683',
    node: { fill: '#ffffff', stroke: 'none', inner: '#d5dbe3', width: 1.5, weight: 500, sheen: { color: '#f1f4f8', opacity: 1, depth: 44 } },
    person: '#4f5b69',
    note: { fill: '#fafbfc', stroke: 'none', ink: '#6b7683' },
    // containers keep a faint border, so nested ones stay apart
    group: { fill: '#e4e8ee', stroke: '#d3d9e1', title: '#3d4855', width: 1, titles: 'tab' },
    accent: { fill: 0.86, stroke: 0.7, title: 0.25 },
    edgeLabel: { fill: '#ffffff', stroke: 'none', ink: '#1d2530' },
    noteLink: '#b4bcc6',
    legend: { fill: '#ffffff', stroke: 'none' },
    radius: { node: 16, group: 24, note: 10, label: 99 },
    shadow: {
      node: [{ dy: 1, blur: 1, color: '#0f1a2a', opacity: 0.08 }, { dy: 8, blur: 14, color: '#0f1a2a', opacity: 0.12 }],
      small: [{ dy: 1, blur: 2.5, color: '#0f1a2a', opacity: 0.14 }],
    },
  },
  // Y2K futurism by day: the logo's colours (electric blue boxes, hot magenta labels, acid lime
  // containers) on icy white with a blueprint grid, neon lines with a halo and pulses running
  // along them. Lime is too pale to draw thin lines with on white, so containers wear it as a wash
  // and a bright tab with dark text, and the line palette uses deeper cuts of the same neons.
  neon: {
    label: 'Neon',
    font: SANS,
    bg: '#f4f5ff', ink: '#12103a', muted: '#5a5f9e',
    grid: { minor: 'rgba(61, 90, 254, 0.08)', major: 'rgba(255, 0, 212, 0.13)', step: 40 },
    palette: ['#3d5afe', '#ff00d4', '#5fb800', '#00a8e0', '#9d00ff', '#ff5a00', '#00b86b', '#ff1f6b', '#0072ff', '#d4a000', '#d100ff', '#009c9c'],
    node: { fill: '#ffffff', stroke: '#3d5afe', width: 2.25, weight: 500, sheen: { color: '#00e5ff', opacity: 0.16, depth: 40 } },
    person: '#3d5afe',
    note: { fill: '#fdf5ff', stroke: '#ff9cf0', ink: '#7a2a8f' },
    group: { fill: '#f1ffcf', stroke: '#9ee000', title: '#c6ff00', tabInk: '#12103a', width: 1.75, titles: 'tab' },
    accent: { fill: 0.92, stroke: 0.3, title: 0.1 },
    edgeLabel: { fill: '#ff00d4', stroke: '#ff00d4', ink: '#ffffff' },
    noteLink: '#ff7ae6',
    legend: { fill: '#ffffff', stroke: '#3d5afe' },
    radius: { node: 12, group: 18, note: 6, label: 99 },
    // glows, not shadows: each thing haloed in its own neon
    shadow: {
      node: [{ blur: 1.5, color: '#3d5afe', opacity: 0.5 }, { blur: 9, color: '#00e5ff', opacity: 0.35 }],
      group: [{ blur: 10, color: '#c6ff00', opacity: 0.45 }],
      small: [{ blur: 4, color: '#ff00d4', opacity: 0.45 }],
    },
    line: {
      glow: [{ grow: 6, opacity: 0.3 }, { grow: 16, opacity: 0.12 }],
      flow: { color: '#ffffff', opacity: 0.95, length: 11, half: 3.3, period: 72, speed: 48 },
    },
  },
  // Glowing tubes at night: the same neons at full strength on violet-black, a magenta grid,
  // lines with a halo and pulses of light running along them.
  neond: {
    label: 'Neon dark',
    font: SANS,
    bg: '#08031a', ink: '#f2f0ff', muted: '#a49cdc',
    grid: { minor: 'rgba(61, 90, 254, 0.09)', major: 'rgba(255, 0, 212, 0.14)', step: 40 },
    palette: ['#00e5ff', '#ff00d4', '#c6ff00', '#5c7cff', '#ffe600', '#b026ff', '#ff6a00', '#00ffa3', '#ff2d75', '#7df9ff', '#e600ff', '#9dff00'],
    node: { fill: '#0f0a33', stroke: '#3d5afe', width: 2.25, weight: 500, sheen: { color: '#00e5ff', opacity: 0.16, depth: 40 } },
    person: '#00e5ff',
    note: { fill: '#14082a', stroke: '#8a2b9c', ink: '#e7a8ff' },
    group: { fill: '#0c0d1a', stroke: '#c6ff00', title: '#c6ff00', tabInk: '#08031a', width: 1.5, titles: 'tab' },
    accent: { fill: 0.88, stroke: 0.2, title: 0.3 },
    edgeLabel: { fill: '#ff00d4', stroke: '#ff7ae6', ink: '#ffffff' },
    noteLink: '#8a2b9c',
    legend: { fill: '#0f0a33', stroke: '#3d5afe' },
    radius: { node: 12, group: 18, note: 6, label: 99 },
    // shadows as light: boxes and labels glow in the colour of their outline
    shadow: {
      node: [{ blur: 2, color: '#3d5afe', opacity: 0.8 }, { blur: 10, color: '#00e5ff', opacity: 0.4 }],
      group: [{ blur: 10, color: '#c6ff00', opacity: 0.28 }],
      small: [{ blur: 5, color: '#ff00d4', opacity: 0.6 }],
    },
    line: {
      glow: [{ grow: 7, opacity: 0.35 }, { grow: 18, opacity: 0.15 }],
      flow: { color: '#ffffff', opacity: 0.9, length: 11, half: 3.3, period: 72, speed: 48 },
    },
  },
};
export const THEME_NAMES = Object.keys(THEMES);

export function getTheme(name = 'light') {
  const t = THEMES[name];
  if (!t) throw new Error(`unknown theme "${name}" (known: ${THEME_NAMES.join(', ')})`);
  return t;
}

// ---- colour helpers: every colour is #rrggbb (model.mjs checks the DOT file's, themes use them) ----

const parseHex = (c) => {
  const v = parseInt(c.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const hex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

// a with t of b mixed in (t = 0: a, t = 1: b).
const mix = (a, b, t) => {
  const [x, y] = [parseHex(a), parseHex(b)];
  return hex(x.map((v, i) => v + (y[i] - v) * t));
};

// A container's colours from its accent (`color` in DOT), for this theme.
export function accentStyle(theme, accent) {
  return {
    fill: mix(accent, theme.bg, theme.accent.fill),
    stroke: theme.accent.stroke == null ? undefined : mix(accent, theme.bg, theme.accent.stroke),
    title: mix(accent, theme.ink, theme.accent.title),
  };
}

const lum = (c) => {
  const [r, g, b] = parseHex(c);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};
// Text on a container's tab filled `fill` (an accent's title colour): the theme's tab text if it
// reads there, else whichever of ink and background stands out more.
export function tabText(t, fill) {
  const own = t.group.tabInk ?? t.bg;
  if (Math.abs(lum(own) - lum(fill)) >= 0.45) return own;
  return Math.abs(lum(t.ink) - lum(fill)) > Math.abs(lum(t.bg) - lum(fill)) ? t.ink : t.bg;
}

// The theme as CSS. Selectors are classes only (lm-*), so the block is harmless when the SVG is
// inlined into a page.
export function themeCss(t) {
  const r = [];
  const rule = (sel, props) => r.push(`${sel}{${Object.entries(props).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}:${v}`).join(';')}}`);
  rule('.lm-root', { 'font-family': t.font, fill: t.ink });
  rule('.lm-bg', { fill: t.bg });
  rule('.lm-group-box', { fill: t.group.fill, stroke: t.group.stroke, 'stroke-width': t.group.width, 'stroke-dasharray': t.group.dash });
  rule('.lm-group-title', { fill: t.group.title, 'font-weight': 700 });
  rule('.lm-shape', { fill: t.node.fill, stroke: t.node.stroke, 'stroke-width': t.node.width, 'stroke-linejoin': 'round' });
  rule('.lm-shape-line', { fill: 'none', stroke: t.node.inner ?? t.node.stroke, 'stroke-width': t.node.width });
  rule('.lm-sheen', { stroke: 'none', 'pointer-events': 'none' });
  rule('.lm-group-tab', { fill: t.group.title, stroke: 'none' });
  rule('.lm-group-title-tab', { fill: t.group.tabInk ?? t.bg, 'font-weight': 600 });
  rule('.lm-person', { fill: t.person, stroke: 'none' });
  rule('.lm-label', { fill: t.ink, 'font-weight': t.node.weight });
  // a halo in the colour of what is behind the text, so it stays readable over lines
  // (paint-order and the stroke width are attributes on the text, which simple converters read
  // where they would ignore them in CSS)
  rule('.lm-halo', { stroke: t.bg });
  rule('.lm-halo-in', { stroke: t.node.fill });
  rule('.lm-note-box', { fill: t.note.fill, stroke: t.note.stroke, 'stroke-width': 1, 'stroke-dasharray': t.note.dash });
  rule('.lm-note-text', { fill: t.note.ink, 'font-style': 'italic' });
  rule('.lm-note-link', { fill: 'none', stroke: t.noteLink, 'stroke-width': 1.2, 'stroke-dasharray': '5 4' });
  rule('.lm-casing', { fill: 'none', stroke: t.bg, 'stroke-linejoin': 'round' });
  rule('.lm-casing-in', { stroke: t.node.fill });
  rule('.lm-strand', { fill: 'none', 'stroke-linejoin': 'round' });
  rule('.lm-edge-label-box', { fill: t.edgeLabel.fill, stroke: t.edgeLabel.stroke, 'stroke-width': 1 });
  rule('.lm-edge-label', { fill: t.edgeLabel.ink, 'font-weight': 600 });
  rule('.lm-legend-box', { fill: t.legend.fill, stroke: t.legend.stroke, 'stroke-width': 1 });
  rule('.lm-legend-title', { fill: t.muted, 'font-weight': 700, 'letter-spacing': '0.12em' });
  rule('.lm-legend-text', { fill: t.ink });
  if (t.grid) {
    rule('.lm-grid-minor', { fill: 'none', stroke: t.grid.minor, 'stroke-width': 1 });
    rule('.lm-grid-major', { fill: 'none', stroke: t.grid.major, 'stroke-width': 1 });
  }
  if (t.line?.glow) rule('.lm-glow', { fill: 'none', 'stroke-linejoin': 'round', 'pointer-events': 'none' });
  if (t.line?.flow) {
    // Each arrow is drawn at the origin, pointing right, and put on its lane by a motion path.
    // The lane's group sets --lm-p (the path), --lm-s (the share of the path between two arrows)
    // and --lm-t (the time an arrow takes for that); the arrow sets --lm-i, its number. Every
    // arrow moves one step on and starts again, so the row seems to run without end; the first
    // one fades in and the last one out. Without motion paths none of this applies, and the
    // arrows stay hidden behind the still triangles.
    const { color, opacity } = t.line.flow;
    const run = 'var(--lm-t) linear infinite';
    rule('.lm-arrow', { fill: color, 'fill-opacity': opacity, 'pointer-events': 'none' });
    r.push("@supports (offset-path:path('M0,0')){");
    rule('.lm-marks', { display: 'none' });
    rule('.lm-arrows', { visibility: 'visible' });
    rule('.lm-arrow', { 'offset-path': 'var(--lm-p)', 'offset-rotate': 'auto', 'offset-distance': 'calc(var(--lm-i)*var(--lm-s))', animation: `lm-arrow ${run}` });
    rule('.lm-arrow-in', { animation: `lm-arrow ${run},lm-arrow-in ${run}` });
    rule('.lm-arrow-out', { animation: `lm-arrow ${run},lm-arrow-out ${run}` });
    rule('.lm-arrow-in.lm-arrow-out', { animation: `lm-arrow ${run},lm-arrow-in ${run},lm-arrow-out ${run}` });
    r.push('@keyframes lm-arrow{to{offset-distance:calc((var(--lm-i) + 1)*var(--lm-s))}}');
    r.push('@keyframes lm-arrow-in{from{opacity:0}30%{opacity:1}}');
    r.push('@keyframes lm-arrow-out{70%{opacity:1}to{opacity:0}}');
    r.push('@media (prefers-reduced-motion:reduce){.lm-arrow{animation:none}}');
    r.push('}');
  }
  return r.join('\n');
}

// SVG filters for the theme's shadows: { defs, filter(kind) -> ' filter="url(#...)"' or '' }.
// Ids carry the theme name, so two maps in one page never pick up each other's filters.
export function shadowFilters(t, name) {
  const defs = [];
  const ids = {};
  for (const [kind, layers] of Object.entries(t.shadow ?? {})) {
    if (!layers?.length) continue;
    const id = `lm-shadow-${name}-${kind}`;
    ids[kind] = id;
    const parts = layers.map((l, i) =>
      (l.blur ? `<feGaussianBlur in="SourceAlpha" stdDeviation="${l.blur}" result="b${i}"/>` : '') +
      `<feOffset in="${l.blur ? `b${i}` : 'SourceAlpha'}" dx="${l.dx ?? 0}" dy="${l.dy ?? 0}" result="o${i}"/>` +
      `<feFlood flood-color="${l.color}" flood-opacity="${l.opacity}"/>` +
      `<feComposite in2="o${i}" operator="in" result="s${i}"/>`).join('');
    const merge = layers.map((_, i) => `<feMergeNode in="s${i}"/>`).join('') + '<feMergeNode in="SourceGraphic"/>';
    defs.push(`<filter id="${id}" x="-20%" y="-20%" width="140%" height="150%" color-interpolation-filters="sRGB">${parts}<feMerge>${merge}</feMerge></filter>`);
  }
  return {
    defs: defs.length ? `<defs>${defs.join('')}</defs>` : '',
    filter: (kind) => (ids[kind] ? ` filter="url(#${ids[kind]})"` : ''),
  };
}

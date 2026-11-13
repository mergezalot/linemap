// Draws the placed, routed and bundled model as one standalone SVG.
import { STYLE, groupRects, textWidth, edgeLabelSize } from './model.mjs';
import { markColor } from './bundle.mjs';
import { f } from './geom.mjs';
import { getTheme, DEFAULT_THEME, themeCss, accentStyle, shadowFilters, paintLines, tabText } from './theme.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// For attribute values: also keep newlines and tabs, which a parser would turn into spaces.
const attr = (s) => esc(s).replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;');

function multilineText(text, x, y, { size = STYLE.font, lh = STYLE.lineHeight, anchor = 'middle', attrs = '' } = {}) {
  const rows = String(text).split('\n');
  const y0 = y - ((rows.length - 1) * lh) / 2;
  const spans = rows.map((r, i) => `<tspan x="${f(x)}" y="${f(y0 + i * lh)}">${esc(r)}</tspan>`).join('');
  return `<text font-size="${size}" text-anchor="${anchor}" dominant-baseline="central" ${attrs}>${spans}</text>`;
}

// Inline style for colours set in the DOT file: inline styles win over the theme's CSS.
const inline = (props) => {
  const set = Object.entries(props).filter(([, v]) => v !== undefined && v !== null);
  return set.length ? ` style="${esc(set.map(([k, v]) => `${k}:${v}`).join(';'))}"` : '';
};

// Text attributes from a node's style; `cls` are the text's classes, `extra` more inline style.
const HALO = ' stroke-width="5" stroke-linejoin="round" paint-order="stroke"';
const font = (s, cls = 'lm-label', extra = {}) => ({
  size: s.fontSize, lh: s.lineHeight,
  attrs: `class="${cls}"${cls.includes('lm-halo') ? HALO : ''}${s.italic ? ' font-style="italic"' : ''}${inline({ fill: s.fontColor, 'font-weight': s.bold ? 600 : undefined, ...extra })}`,
});

// The person's label goes below it, unless an edge leaves from there: then beside or above it.
function personLabel(n, model) {
  const sides = new Set();
  for (const e of model.edges) {
    const p = e.from === n.id ? e.path[0] : e.to === n.id ? e.path[e.path.length - 1] : null;
    if (!p) continue;
    const dx = (p.x - n.x) / n.w, dy = (p.y - n.y) / n.h;
    sides.add(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top'));
  }
  const rows = String(n.label).split('\n');
  const tw = Math.max(...rows.map((r) => textWidth(r, n.style.fontSize)));
  const th = rows.length * n.style.lineHeight;
  const x0 = n.x - n.w / 2, y0 = n.y - n.h / 2;
  const at = {
    bottom: { x: n.x, y: y0 + n.h + 8 + th / 2, anchor: 'middle', box: { x0: n.x - tw / 2, y0: y0 + n.h, x1: n.x + tw / 2, y1: y0 + n.h + 8 + th } },
    right: { x: x0 + n.w * 0.86 + 6, y: n.y + n.h * 0.18, anchor: 'start', box: { x0: x0 + n.w, y0: n.y, x1: x0 + n.w * 0.86 + 6 + tw, y1: n.y + th } },
    left: { x: x0 + n.w * 0.14 - 6, y: n.y + n.h * 0.18, anchor: 'end', box: { x0: x0 + n.w * 0.14 - 6 - tw, y0: n.y, x1: x0, y1: n.y + th } },
    top: { x: n.x, y: y0 - 8 - th / 2, anchor: 'middle', box: { x0: n.x - tw / 2, y0: y0 - 8 - th, x1: n.x + tw / 2, y1: y0 } },
    // every side taken: below, beside the lanes that leave from the middle of the bottom
    under: { x: n.x + n.w * 0.2, y: y0 + n.h + 8 + th / 2, anchor: 'start', box: { x0: n.x, y0: y0 + n.h, x1: n.x + n.w * 0.2 + tw, y1: y0 + n.h + 8 + th } },
  };
  return at[['bottom', 'right', 'left', 'top'].find((s) => !sides.has(s)) ?? 'under'];
}

// The theme's travelling arrows along one lane (see themeCss): `d` is the lane's path, `length`
// about how long it is. Hidden unless the theme's CSS can move them.
function arrows(d, length, line, flow) {
  if (length < 2.5 * flow.length) return '';
  const n = Math.max(1, Math.round(length / flow.period));
  const step = Math.floor(1e5 / n) / 1e3; // % of the path, rounded down so the last arrow stays on it
  const points = `${f(flow.length / 2)},0 ${f(-flow.length / 2)},${f(-flow.half)} ${f(-flow.length / 2)},${f(flow.half)}`;
  const one = (i) => `<polygon points="${points}" class="lm-arrow${i === 0 ? ' lm-arrow-in' : ''}${i === n - 1 ? ' lm-arrow-out' : ''}" style="--lm-i:${i}"/>`;
  return `<g class="lm-arrows" data-line="${attr(line.id)}" visibility="hidden" style="--lm-p:path('${d}');--lm-s:${step}%;--lm-t:${(length / n / flow.speed).toFixed(2)}s">` +
    `${Array.from({ length: n }, (_, i) => one(i)).join('')}</g>`;
}
const pathLength = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);

// Paint context of one render: corner radii and the shadow filters of the theme.
const FLAT = { radius: { node: 10, group: 16, note: 6, label: 99 }, fx: { filter: () => '' } };

// ctx: the paint context, plus haloFill behind the node (the container's fill, if any) and
// personAt for persons.
function shape(n, ctx = FLAT) {
  const { x, y, w, h, style } = n;
  const x0 = x - w / 2, y0 = y - h / 2;
  const st = `class="lm-shape"${inline({ fill: style.fill, stroke: style.stroke })}${ctx.fx.filter('node')}`;
  const line = `class="lm-shape-line"${inline({ stroke: style.stroke })}`;
  const multiline = (text, tx, ty) => multilineText(text, tx, ty, font(style));
  // the outline, then the theme's tint over its top (the same geometry, a fading gradient)
  const sheen = ctx.sheen?.(h);
  const body = (tag, geom) => `<${tag} ${geom} ${st}/>` + (sheen ? `<${tag} ${geom} class="lm-sheen" fill="url(#${sheen})"/>` : '');
  switch (n.shape) {
    case 'diamond':
      return body('polygon', `points="${f(x)},${f(y0)} ${f(x0 + w)},${f(y)} ${f(x)},${f(y0 + h)} ${f(x0)},${f(y)}"`) +
        multiline(n.label, x, y);
    case 'cylinder': {
      const ry = 14;
      return body('path', `d="M${f(x0)},${f(y0 + ry)} A${w / 2},${ry} 0 0 1 ${f(x0 + w)},${f(y0 + ry)} V${f(y0 + h - ry)} A${w / 2},${ry} 0 0 1 ${f(x0)},${f(y0 + h - ry)} Z"`) +
        `<path d="M${f(x0)},${f(y0 + ry)} A${w / 2},${ry} 0 0 0 ${f(x0 + w)},${f(y0 + ry)}" ${line}/>` +
        multiline(n.label, x, y + ry / 2);
    }
    case 'queue': {
      const rx = 16;
      return body('path', `d="M${f(x0 + rx)},${f(y0)} H${f(x0 + w - rx)} A${rx},${h / 2} 0 0 1 ${f(x0 + w - rx)},${f(y0 + h)} H${f(x0 + rx)} A${rx},${h / 2} 0 0 1 ${f(x0 + rx)},${f(y0)} Z"`) +
        `<path d="M${f(x0 + w - rx)},${f(y0)} A${rx},${h / 2} 0 0 0 ${f(x0 + w - rx)},${f(y0 + h)}" ${line}/>` +
        multiline(n.label, x - rx / 2, y);
    }
    case 'person': {
      const r = w * 0.17;
      const hy = y0 + h * 0.3;
      const body = `M${f(x - w * 0.36)},${f(y0 + h)} V${f(y0 + h * 0.78)} Q${f(x - w * 0.36)},${f(y0 + h * 0.52)} ${f(x)},${f(y0 + h * 0.52)} Q${f(x + w * 0.36)},${f(y0 + h * 0.52)} ${f(x + w * 0.36)},${f(y0 + h * 0.78)} V${f(y0 + h)} Z`;
      const fill = inline({ fill: style.fill });
      const at = ctx.personAt ?? { x, y: y0 + h + 16, anchor: 'middle' };
      return `<circle cx="${f(x)}" cy="${f(hy)}" r="${f(r)}" class="lm-person"${fill}/>` +
        `<path d="${body}" class="lm-person"${fill}/>` +
        multilineText(n.label, at.x, at.y, { ...font(style, 'lm-label lm-halo', { stroke: ctx.haloFill }), anchor: at.anchor });
    }
    default:
      return body('rect', `x="${f(x0)}" y="${f(y0)}" width="${w}" height="${h}" rx="${f(Math.min(ctx.radius.node, w / 2, h / 2))}"`) + multiline(n.label, x, y);
  }
}

// A node with lines through it (`through=true`): its shape, the lines inside (see inside.mjs),
// and its label where the lines leave room, with a halo so it stays readable over the lines.
function throughNode(n, ctx) {
  const out = [shape({ ...n, label: '' }, ctx)];
  const inFill = inline({ stroke: n.style.fill });
  for (const group of n.inside.subBundles) {
    for (const c of group) out.push(`<path d="${c.casing}" class="lm-casing lm-casing-in" stroke-width="${STYLE.lineWidth + 4}"${inFill}/>`);
    for (const c of group) out.push(`<path d="${c.d}" class="lm-strand" stroke="${attr(c.line.color)}" stroke-width="${STYLE.lineWidth}" data-line="${attr(c.line.id)}"><title>${esc(c.line.label)}</title></path>`);
  }
  for (const t of n.inside.termini) {
    out.push(`<path d="${t.d}" class="lm-strand" stroke="${attr(t.line.color)}" stroke-width="${STYLE.lineWidth}" data-line="${attr(t.line.id)}"/>`);
    out.push(`<path d="${t.bar}" class="lm-strand" stroke="${attr(t.line.color)}" stroke-width="4" stroke-linecap="round" data-line="${attr(t.line.id)}"/>`);
  }
  // the theme's travelling arrows carry on through the node (the curves run from the way in to the way out)
  if (ctx.line?.flow) for (const c of n.inside.subBundles.flat()) out.push(arrows(c.d, pathLength(c.pts), c.line, ctx.line.flow));
  const { x, y } = n.inside.labelAt;
  out.push(multilineText(n.label, x, y, font({ ...n.style, bold: true }, 'lm-label lm-halo lm-halo-in', { stroke: n.style.fill })));
  return out.join('');
}

// Note text: one tspan per row, left-aligned.
function note(n, ctx = FLAT) {
  const x0 = n.x - n.w / 2, y0 = n.y - n.h / 2;
  const s = n.style;
  const rows = n.label.split('\n').map((row, i) => {
    const y = y0 + STYLE.notePad + s.lineHeight * (i + 0.5);
    return `<tspan x="${f(x0 + STYLE.notePad)}" y="${f(y)}">${esc(row)}</tspan>`;
  });
  const t = font({ ...s, italic: false }, 'lm-note-text');
  return `<rect x="${f(x0)}" y="${f(y0)}" width="${n.w}" height="${n.h}" rx="${ctx.radius.note}" class="lm-note-box"${inline({ fill: s.fill, stroke: s.stroke })}${ctx.fx.filter('small')}/>` +
    `<text font-size="${t.size}" ${t.attrs} dominant-baseline="central">${rows.join('')}</text>`;
}

function legend(model, box, ctx = FLAT) {
  const rowH = 28, pad = 18;
  const w = 96 + Math.max(...model.lines.map((l) => textWidth(l.label ?? l.id, 14))) + pad;
  const h = model.lines.length * rowH + 2 * pad + 22;
  const at = model.legend.at ?? [box.x0 + w / 2, box.y1 + 60 + h / 2];
  const x0 = at[0] - w / 2, y0 = at[1] - h / 2;
  const rows = model.lines.map((l, i) => {
    const y = y0 + pad + 32 + i * rowH;
    // a hidden line (layout's `hiddenLines`) stays in the legend, greyed
    return `<g class="legend-row" data-line="${attr(l.id)}"${l.hidden ? ' opacity="0.35"' : ''}><line x1="${f(x0 + pad + 4)}" y1="${f(y)}" x2="${f(x0 + pad + 56)}" y2="${f(y)}" stroke="${attr(l.color)}" stroke-width="${STYLE.lineWidth}" stroke-linecap="round"/>` +
      `<polygon points="${f(x0 + pad + 35)},${f(y)} ${f(x0 + pad + 25)},${f(y - STYLE.lineWidth * 0.3)} ${f(x0 + pad + 25)},${f(y + STYLE.lineWidth * 0.3)}" fill="${attr(markColor(l.color))}"/>` +
      `<text x="${f(x0 + pad + 74)}" y="${f(y)}" font-size="14" class="lm-legend-text" dominant-baseline="central">${esc(l.label ?? l.id)}</text></g>`;
  });
  return {
    svg: `<g class="legend"><rect x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${h}" rx="${Math.min(ctx.radius.group, 12)}" class="lm-legend-box"${ctx.fx.filter('small')}/>` +
      `<text x="${f(x0 + pad)}" y="${f(y0 + pad + 4)}" font-size="12" class="lm-legend-title" dominant-baseline="central">LINES</text>${rows.join('')}</g>`,
    rect: { x0, y0, x1: x0 + w, y1: y0 + h },
  };
}

// Options:
//   legend  false leaves out the legend and the room for it
//   theme   a theme name (theme.mjs); default: the DOT file's `theme`, else minimal
//   css     more CSS, after the theme's: restyle any lm-* class
// Elements carry data-* attributes (line ids, labels, shapes) for scripts; they change nothing drawn.
export function render(model, { legend: withLegend = true, theme, css = '' } = {}) {
  // the CSS goes inside <style>, so it must not be able to end that element
  if (/<\/style/i.test(css)) throw new Error('css: must not contain "</style"');
  const themeName = theme ?? model.theme ?? DEFAULT_THEME;
  const T = getTheme(themeName);
  paintLines(model.lines, T);
  const fx = shadowFilters(T, themeName);
  // The tint over the top of a box fades out over the same depth whatever the box's height: one
  // gradient per (rounded) share of the height.
  const sheens = new Map();
  const sheen = T.node.sheen ? (h) => {
    const to = Math.min(0.6, Math.round((T.node.sheen.depth / h) * 20) / 20 || 0.05);
    if (!sheens.has(to)) sheens.set(to, `lm-sheen-${attr(themeName)}-${Math.round(to * 100)}`);
    return sheens.get(to);
  } : null;
  const paint = { radius: { ...FLAT.radius, ...T.radius }, fx, sheen, line: T.line };
  const groups = groupRects(model);
  const personAt = new Map(model.nodes.filter((n) => n.shape === 'person').map((n) => [n.id, personLabel(n, model)]));
  const rects = [...model.items.values()].map((n) => ({ x0: n.x - n.w / 2, y0: n.y - n.h / 2, x1: n.x + n.w / 2, y1: n.y + n.h / 2 }));
  for (const p of personAt.values()) rects.push(p.box);
  for (const e of model.edges) for (const p of e.path) rects.push({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  rects.push(...groups.values());
  const box = {
    x0: Math.min(...rects.map((r) => r.x0)), y0: Math.min(...rects.map((r) => r.y0)),
    x1: Math.max(...rects.map((r) => r.x1)), y1: Math.max(...rects.map((r) => r.y1)),
  };
  const leg = withLegend ? legend(model, box, paint) : null;
  if (leg) {
    for (const k of ['x0', 'y0']) box[k] = Math.min(box[k], leg.rect[k]);
    for (const k of ['x1', 'y1']) box[k] = Math.max(box[k], leg.rect[k]);
  }
  const M = 40;
  const vb = [box.x0 - M, box.y0 - M, box.x1 - box.x0 + 2 * M, box.y1 - box.y0 + 2 * M].map(f);

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${vb[2]}" height="${vb[3]}" class="linemap lm-root lm-theme-${attr(themeName)}" data-theme="${attr(themeName)}" font-family="${esc(T.font)}" fill="${T.ink}">`);
  out.push(`<style>\n${themeCss(T)}${css ? `\n${css}` : ''}\n</style>`);
  if (fx.defs) out.push(fx.defs);
  const sheenAt = out.length; // the gradients go here once the boxes have asked for them
  out.push('');
  out.push(`<rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" class="lm-bg" fill="${T.bg}"/>`);
  if (T.grid) {
    // a grid of fine lines, every fifth one stronger, aligned to the origin
    const g = T.grid.step;
    const lines = (step, cls) => {
      const d = [];
      for (let x = Math.ceil(vb[0] / step) * step; x <= vb[0] + vb[2]; x += step) d.push(`M${x},${vb[1]}V${f(vb[1] + vb[3])}`);
      for (let y = Math.ceil(vb[1] / step) * step; y <= vb[1] + vb[3]; y += step) d.push(`M${vb[0]},${y}H${f(vb[0] + vb[2])}`);
      return `<path class="${cls}" d="${d.join('')}"/>`;
    };
    out.push(`<g class="lm-grid">${lines(g, 'lm-grid-minor')}${lines(g * 5, 'lm-grid-major')}</g>`);
  }

  // containers: an accent colour is turned into fill, border and title by the theme
  const groupFill = new Map();
  const tabs = [], tabSvg = [];
  for (const g of model.groups) {
    const r = groups.get(g.id);
    if (!r) continue;
    const s = g.style;
    const a = g.accent ? accentStyle(T, g.accent) : {};
    const fill = s.fill ?? a.fill;
    groupFill.set(g.id, fill ?? T.group.fill);
    out.push(`<g class="${esc(['group', g.classes].filter(Boolean).join(' '))}" id="${attr(g.id)}" data-label="${attr(g.label)}">`);
    out.push(`<rect x="${f(r.x0)}" y="${f(r.y0)}" width="${f(r.x1 - r.x0)}" height="${f(r.y1 - r.y0)}" rx="${paint.radius.group}" class="lm-group-box"${inline({ fill, stroke: a.stroke })}${fx.filter('group')}/>`);
    const italic = s.italic ? ' font-style="italic"' : '';
    if (T.group.titles === 'tab') {
      // a tab on the top border, in the container's title colour, with the name in the background
      // colour; drawn after the lines (below), so a line along the border never hides it
      const size = Math.round(s.fontSize * 0.78);
      const th = size + 12, tw = textWidth(g.label, size) * 1.1 + 22; // semibold runs wider
      let tx = r.x0 + Math.max(18, paint.radius.group);
      // a nested container's tab slides right, past the tabs it would cover
      for (let moved = true; moved;) {
        moved = false;
        for (const t of tabs) {
          if (tx < t.x1 + 8 && tx + tw > t.x0 - 8 && Math.abs(r.y0 - t.y) < th + 4) { tx = t.x1 + 8; moved = true; }
        }
      }
      tabs.push({ x0: tx, x1: tx + tw, y: r.y0 });
      tabSvg.push(`<g class="group-tab" data-group="${attr(g.id)}"><rect x="${f(tx)}" y="${f(r.y0 - th / 2)}" width="${f(tw)}" height="${th}" rx="${f(Math.min(th / 2, paint.radius.label))}" class="lm-group-tab"${inline({ fill: a.title })}${fx.filter('small')}/>` +
        `<text x="${f(tx + 11)}" y="${f(r.y0)}" font-size="${size}" dominant-baseline="central" class="lm-group-title lm-group-title-tab"${italic}${inline({ fill: s.fontColor ?? (a.title && tabText(T, a.title)), 'font-weight': s.bold ? undefined : 500 })}>${esc(g.label)}</text></g>`);
    } else {
      out.push(`<text x="${f(r.x0 + 20)}" y="${f(r.y0 + 28)}" font-size="${s.fontSize}" class="lm-group-title"${italic}${inline({ fill: s.fontColor ?? a.title, 'font-weight': s.bold ? undefined : 400 })}>${esc(g.label)}</text>`);
    }
    out.push('</g>');
  }

  for (const l of model.noteLinks) {
    const d = l.path.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)},${f(p.y)}`).join(' ');
    out.push(`<path d="${d}" class="lm-note-link"/>`);
  }

  // Each bundle sits on a casing in the background colour, so a bundle crossing another shows a
  // clean gap.
  for (const e of model.edges) {
    const label = e.label ? ` data-label="${attr(e.label)}"` : '';
    out.push(`<g class="edge" data-from="${attr(e.from)}" data-to="${attr(e.to)}" data-lines="${attr(e.strands.map((s) => s.line.id).join(' '))}"${label}>`);
    out.push(`<path d="${e.casing}" class="lm-casing" stroke-width="${f(e.width + 5)}"/>`);
    // the theme's glow: wider, faint copies of every lane, under all of them
    if (T.line?.glow) {
      out.push('<g class="lm-glows">');
      for (const { grow, opacity } of T.line.glow) {
        for (const s of e.strands) out.push(`<path d="${s.d}" class="lm-glow" stroke="${attr(s.line.color)}" stroke-width="${STYLE.lineWidth + grow}" stroke-opacity="${opacity}" data-line="${attr(s.line.id)}"/>`);
      }
      out.push('</g>');
    }
    for (const s of e.strands) {
      out.push(`<path d="${s.d}" class="lm-strand" stroke="${attr(s.line.color)}" stroke-width="${STYLE.lineWidth}" data-line="${attr(s.line.id)}"><title>${esc(s.line.label ?? s.line.id)}</title></path>`);
    }
    // triangles after all lanes, so a neighbouring lane never paints over them
    for (const s of e.strands) {
      const fill = markColor(s.line.color);
      if (!s.marks.length) continue;
      out.push(`<g class="lm-marks" data-line="${attr(s.line.id)}">`);
      for (const m of s.marks) out.push(`<polygon points="${m.map((p) => `${f(p.x)},${f(p.y)}`).join(' ')}" fill="${attr(fill)}"/>`);
      out.push('</g>');
    }
    // the theme's travelling arrows: as many on every lane of the bundle, so they run side by side
    if (T.line?.flow) for (const s of e.strands) out.push(arrows(s.d, pathLength(e.path), s.line, T.line.flow));
    out.push('</g>');
  }

  out.push(...tabSvg);

  // ids and classes from the DOT file, so the SVG can be styled or scripted further
  const cls = (kind, n) => esc([kind, n.classes].filter(Boolean).join(' '));
  const data = (n) => `id="${attr(n.id)}" data-label="${attr(n.label)}"${n.url ? ` data-url="${attr(n.url)}"` : ''}`;
  // a node's URL (or href) makes its drawing a link, as in Graphviz's SVG
  const link = (n, svg) => (n.url ? `<a href="${attr(n.url)}">${svg}</a>` : svg);
  for (const n of model.nodes) {
    const ctx = { ...paint, personAt: personAt.get(n.id), haloFill: n.group ? groupFill.get(n.group) : undefined };
    out.push(n.through
      ? `<g class="${cls('node through', n)}" ${data(n)} data-shape="${attr(n.shape)}" data-through="true">${link(n, throughNode(n, paint))}</g>`
      : `<g class="${cls('node', n)}" ${data(n)} data-shape="${attr(n.shape)}">${link(n, shape(n, ctx))}</g>`);
  }
  for (const n of model.notes) out.push(`<g class="${cls('note', n)}" ${data(n)}>${link(n, note(n, paint))}</g>`);

  // edge labels: pills beside the bundle (placed in bundle.mjs)
  for (const e of model.edges) {
    if (!e.labelAt) continue;
    const { w, h } = edgeLabelSize(e.label);
    const { x: cx, y: cy } = e.labelAt;
    out.push(`<g class="lm-edge-label-group"><rect x="${f(cx - w / 2)}" y="${f(cy - h / 2)}" width="${f(w)}" height="${h}" rx="${f(Math.min(h / 2, paint.radius.label))}" class="lm-edge-label-box"${fx.filter('small')}/>`);
    out.push(multilineText(e.label, cx, cy, { size: 12, lh: 15, attrs: 'class="lm-edge-label"' }) + '</g>');
  }

  if (leg) out.push(leg.svg);
  if (sheens.size) {
    const { color, opacity } = T.node.sheen;
    out[sheenAt] = `<defs>${[...sheens].map(([to, id]) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="${to}" stop-color="${color}" stop-opacity="0"/></linearGradient>`).join('')}</defs>`;
  }
  out.push('</svg>');
  return out.filter(Boolean).join('\n');
}

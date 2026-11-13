// Small geometry helpers shared by the stages. Points are {x, y}; rectangles {x0, y0, x1, y1}.

// SVG coordinates are written to a tenth of a px.
export const f = (v) => Math.round(v * 10) / 10;

export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k });
export const len = (v) => Math.hypot(v.x, v.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const unit = (v) => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l }; };

export const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
export const contains = (outer, inner) =>
  inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1;

// Does segment a-b touch rectangle r? (Liang-Barsky)
export function segHitsRect(a, b, r) {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - r.x0], [dx, r.x1 - a.x], [-dy, a.y - r.y0], [dy, r.y1 - a.y]]) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

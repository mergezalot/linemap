// Draws lines through nodes marked `through=true`, as a small problem of its own: global routing
// stops at the node's outline, and the bundles say exactly where each lane meets it. Here each
// node is handled alone, with no obstacles: every lane arriving on a line is joined to every lane
// leaving on that line, by a curve that continues both lanes smoothly. One in and several out is
// a bifurcation, several in and one out a merge. A line that only arrives (or only leaves) ends
// in a terminus bar inside the node.
import { STYLE } from './model.mjs';
import { f, add, dist, segHitsRect } from './geom.mjs';

const TRIM = 12;       // casings stop this far from the ports, so neighbouring lanes stay joined
const SHARED = 0.4;    // share of a branch, from a port it shares, that gets no casing
const TERMINUS = 26;   // length of a line that ends inside a node


// How far one can go from p in direction u before leaving the node's rectangle.
function depth(n, p, u) {
  const r = { x0: n.x - n.w / 2, x1: n.x + n.w / 2, y0: n.y - n.h / 2, y1: n.y + n.h / 2 };
  const ds = [];
  if (u.x > 1e-6) ds.push((r.x1 - p.x) / u.x);
  if (u.x < -1e-6) ds.push((r.x0 - p.x) / u.x);
  if (u.y > 1e-6) ds.push((r.y1 - p.y) / u.y);
  if (u.y < -1e-6) ds.push((r.y0 - p.y) / u.y);
  return Math.max(0, Math.min(...ds));
}

// Cubic curve from an arriving lane (p0, travelling along u0) to a leaving one (p3, along u3).
// A turn becomes a rounded corner around the point where the two lanes would meet; a lane that
// keeps its direction but shifts sideways becomes an S; a U-turn bulges into the node.
const K = 0.55; // control distance as a share of the corner leg (a quarter circle is ~0.55)
function curve(n, p0, u0, p3, u3) {
  const dot = u0.x * u3.x + u0.y * u3.y;
  const cross = u0.x * u3.y - u0.y * u3.x;
  const d = { x: p3.x - p0.x, y: p3.y - p0.y };
  let k0, k3;
  if (Math.abs(cross) > 0.5) {
    // turn: corner = p0 + u0*a = p3 - u3*b
    const a = (d.x * u3.y - d.y * u3.x) / cross;
    const b = (d.x * u0.y - d.y * u0.x) / cross;
    if (a > 0 && b > 0) [k0, k3] = [a * K, b * K];
    else [k0, k3] = [Math.max(18, Math.hypot(d.x, d.y) * 0.5), Math.max(18, Math.hypot(d.x, d.y) * 0.5)];
  } else if (dot > 0) {
    // same direction: an S over the distance travelled
    const along = Math.max(18, d.x * u0.x + d.y * u0.y);
    [k0, k3] = [along / 2, along / 2];
  } else {
    // U-turn: a half circle, bulging in by about half the width of the turn
    const wide = Math.max(24, Math.hypot(d.x, d.y));
    [k0, k3] = [wide * 0.65, wide * 0.65];
  }
  k0 = Math.min(k0, depth(n, p0, u0) * 0.9);
  k3 = Math.min(k3, depth(n, p3, { x: -u3.x, y: -u3.y }) * 0.9);
  return [p0, add(p0, u0, k0), add(p3, u3, -k3), p3];
}

// The part of a cubic between parameters t0 and t1 (de Casteljau).
function part(c, t0, t1) {
  const at = (q, t) => {
    const l = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const [a, b, d, e] = q;
    const ab = l(a, b), bd = l(b, d), de = l(d, e), abd = l(ab, bd), bde = l(bd, de), m = l(abd, bde);
    return [[a, ab, abd, m], [m, bde, de, e]];
  };
  const right = at(c, t0)[1];
  return at(right, (t1 - t0) / (1 - t0))[0];
}

const pathOf = (c) => `M${f(c[0].x)},${f(c[0].y)} C${f(c[1].x)},${f(c[1].y)} ${f(c[2].x)},${f(c[2].y)} ${f(c[3].x)},${f(c[3].y)}`;

const sample = (c, steps = 24) => Array.from({ length: steps + 1 }, (_, i) => {
  const t = i / steps, s = 1 - t;
  return {
    x: s * s * s * c[0].x + 3 * s * s * t * c[1].x + 3 * s * t * t * c[2].x + t * t * t * c[3].x,
    y: s * s * s * c[0].y + 3 * s * s * t * c[1].y + 3 * s * t * t * c[2].y + t * t * t * c[3].y,
  };
});

// Where the label goes: the freest spot inside the node. Candidates lie on a grid over the
// inside; each scores the length of line running under its box (a lane crossing it costs less
// than one running along it). Ties go to the spot nearest the top centre.
function labelSpot(n, lines) {
  const rows = n.label.split('\n');
  const lw = Math.max(...rows.map((r) => r.length)) * n.style.fontSize * 0.58 + 8;
  const lh = rows.length * n.style.lineHeight + 4;
  const pad = STYLE.lineWidth / 2 + 3;
  const x0 = n.x - n.w / 2 + 10 + lw / 2 + (n.shape === 'queue' ? 6 : 0);
  const x1 = n.x + n.w / 2 - 10 - lw / 2 - (n.shape === 'queue' ? 22 : 0);
  const y0 = n.y - n.h / 2 + 8 + lh / 2 + (n.shape === 'cylinder' ? 14 : 0);
  const y1 = n.y + n.h / 2 - 8 - lh / 2;
  const steps = (a, b, k) => (b <= a ? [(a + b) / 2] : Array.from({ length: k + 1 }, (_, i) => a + ((b - a) * i) / k));
  const xs = steps(x0, x1, 6), ys = steps(y0, y1, Math.max(4, Math.round((y1 - y0) / 18)));
  let best = null;
  for (const y of ys) {
    for (const x of xs) {
      const r = { x0: x - lw / 2 - pad, x1: x + lw / 2 + pad, y0: y - lh / 2 - pad, y1: y + lh / 2 + pad };
      // how much line runs under the label: a lane crossing it is better than one along it
      let under = 0;
      for (const pts of lines) {
        for (let i = 1; i < pts.length; i++) {
          if (segHitsRect(pts[i - 1], pts[i], r)) under += Math.min(dist(pts[i], pts[i - 1]), lw);
        }
      }
      const score = [Math.round(under / 12), Math.abs(y - y0) + Math.abs(x - n.x) * 0.5];
      if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) best = { x, y, score };
    }
  }
  return { x: best.x, y: best.y };
}

export function inside(model) {
  for (const n of model.nodes) {
    if (!n.through) continue;
    // ports: lanes arriving on edges into the node, lanes leaving on edges out of it
    const ins = model.edges.filter((e) => e.to === n.id)
      .flatMap((e) => e.strands.map((s) => ({ e, line: s.line, p: s.end.p, u: s.end.u })));
    const outs = model.edges.filter((e) => e.from === n.id)
      .flatMap((e) => e.strands.map((s) => ({ e, line: s.line, p: s.start.p, u: s.start.u })));

    // Curves joining the same pair of edges form a sub-bundle. Each sub-bundle is drawn as its
    // casings, then its lines, so a later one cuts a clean gap where it crosses an earlier one.
    const groups = new Map();
    // Where a line splits (or merges), its branches share a port and run together for a while;
    // their casings start further from that port, so one branch does not cut the other.
    const fanOut = (a) => outs.filter((o) => o.line === a.line).length;
    const fanIn = (b) => ins.filter((i) => i.line === b.line).length;
    for (const a of ins) {
      for (const b of outs.filter((o) => o.line === a.line)) {
        const key = `${a.e.id} ${b.e.id}`;
        if (!groups.has(key)) groups.set(key, []);
        const c = curve(n, a.p, a.u, b.p, b.u);
        const len = dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3]);
        const t = Math.min(0.3, TRIM / Math.max(len, 1));
        const t0 = fanOut(a) > 1 ? SHARED : t;
        const t1 = fanIn(b) > 1 ? 1 - SHARED : 1 - t;
        groups.get(key).push({ line: a.line, d: pathOf(c), casing: pathOf(part(c, t0, t1)), pts: sample(c) });
      }
    }
    // wide sub-bundles first, so branches cross over trunks
    const subBundles = [...groups.values()].sort((a, b) => b.length - a.length);

    // lines that start or end here
    const termini = [];
    const stub = (port, inward) => {
      const u = inward ? port.u : { x: -port.u.x, y: -port.u.y };
      const L = Math.min(TERMINUS, depth(n, port.p, u) * 0.6);
      const q = add(port.p, u, L);
      const w = { x: -u.y, y: u.x };
      const half = STYLE.lineWidth * 0.9;
      termini.push({
        line: port.line, pts: [port.p, q],
        d: `M${f(port.p.x)},${f(port.p.y)} L${f(q.x)},${f(q.y)}`,
        bar: `M${f(q.x - w.x * half)},${f(q.y - w.y * half)} L${f(q.x + w.x * half)},${f(q.y + w.y * half)}`,
      });
    };
    for (const a of ins) if (!outs.some((o) => o.line === a.line)) stub(a, true);
    for (const b of outs) if (!ins.some((i) => i.line === b.line)) stub(b, false);

    n.inside = { subBundles, termini, labelAt: labelSpot(n, [...subBundles.flat().map((c) => c.pts), ...termini.map((t) => t.pts)]) };
  }
  return model;
}

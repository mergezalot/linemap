// Routes every edge (one connector per bundle) and every note link with MSAGL's rectilinear
// router (msagl.mjs). This file decides where ends go and hands msagl.mjs one request of shapes,
// ports and connections, answered with one polyline per connection; afterwards it snaps the ends
// back onto their ports, clips them to the shapes and slides off short doglegs.
// Nodes, notes and containers are obstacles; a container holds its members, and routes stay out
// of containers that are not theirs where they can. Each connector attaches to a shape's centre
// (or a port of its own) and is clipped to the shape outline afterwards, so an edge to a
// container ends on its border. `via` points split an edge into a chain of connectors, which is
// how a route is changed by hand.
//
// The request:
//   shapes   [{ id, x, y, w, h, diamond, exclusive, ports: [{ id, side, at }], children }]
//            `children`: the ids of the shapes a container holds.
//            A diamond connects at one of its four corners, chosen by msagl.mjs; with
//            `exclusive` each corner takes one end at most. A port is a fixed point on a side
//            (left/right/top/bottom), `at` being its y (left, right) or x (top, bottom).
//   conns    [{ from: end, to: end }], an end being { shape, toward } (the shape's centre, or a
//            diamond corner; `toward` is where the connection heads), { shape, port } or
//            { point: {x, y} } (a free point).
//   padding  clearance around shapes; spacing: distance between parallel routes.
// The answer: [{ path: [{x, y}], pins: [start?, end?] }], `pins` being the points MSAGL
// meant a route's ends to be at, where nudging may have moved them off.
import { msagl } from './msagl.mjs';
import { STYLE, groupRects, rectOf, textWidth } from './model.mjs';

const CORNER_KEEP = 40; // container ends keep this far from its corners

export function outline(n) {
  const { x, y, w, h } = n;
  if (n.shape === 'diamond') {
    return [{ x, y: y - h / 2 }, { x: x + w / 2, y }, { x, y: y + h / 2 }, { x: x - w / 2, y }];
  }
  return [
    { x: x - w / 2, y: y - h / 2 }, { x: x + w / 2, y: y - h / 2 },
    { x: x + w / 2, y: y + h / 2 }, { x: x - w / 2, y: y + h / 2 },
  ];
}

// Intersections of segment a-b with a closed polygon, as parameters t along a-b.
function hits(a, b, poly) {
  const ts = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const d = (b.x - a.x) * (q.y - p.y) - (b.y - a.y) * (q.x - p.x);
    if (Math.abs(d) < 1e-9) continue;
    const t = ((p.x - a.x) * (q.y - p.y) - (p.y - a.y) * (q.x - p.x)) / d;
    const u = ((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / d;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) ts.push(t);
  }
  return ts;
}

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Cut the parts of a polyline that lie inside the start and end shapes.
function clip(pts, startShape, endShape) {
  let out = pts.slice();
  if (startShape) {
    const poly = outline(startShape);
    for (let i = 0; i < out.length - 1; i++) {
      const ts = hits(out[i], out[i + 1], poly);
      if (ts.length) {
        out = [lerp(out[i], out[i + 1], Math.max(...ts)), ...out.slice(i + 1)];
        break;
      }
    }
  }
  if (endShape) {
    const poly = outline(endShape);
    for (let i = out.length - 1; i > 0; i--) {
      const ts = hits(out[i - 1], out[i], poly);
      if (ts.length) {
        out = [...out.slice(0, i), lerp(out[i - 1], out[i], Math.min(...ts))];
        break;
      }
    }
  }
  return dedupe(out);
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q.x - p.x) < 0.01 && Math.abs(q.y - p.y) < 0.01) continue;
    // drop the middle of three collinear points
    const r = out[out.length - 2];
    if (q && r && ((Math.abs(r.x - q.x) < 0.01 && Math.abs(q.x - p.x) < 0.01) ||
                   (Math.abs(r.y - q.y) < 0.01 && Math.abs(q.y - p.y) < 0.01))) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

// the router nudges routes that end at free points, so a route to a stub tip may end beside it.
// Move the end back onto the tip, and the segment next to it along, so the route stays orthogonal.
function snap(pts, i, j, tip) {
  if (pts.length > 1) {
    const horizontal = Math.abs(pts[i].y - pts[j].y) < Math.abs(pts[i].x - pts[j].x);
    if (horizontal) pts[j] = { ...pts[j], y: tip.y };
    else pts[j] = { ...pts[j], x: tip.x };
  }
  pts[i] = tip;
}

// A route that ends in a short dogleg (at most JOG px) at a box can meet the box a little further
// along its side instead, and lose the dogleg. (Diamonds connect at fixed corners, so they keep theirs.)
const JOG = 30;
function slideEnds(pts, startShape, endShape) {
  const slide = (p, shape) => {
    if (!shape || shape.shape === 'diamond' || p.length < 4) return p;
    const n = p.length;
    const [a, b, c, z] = [p[n - 4], p[n - 3], p[n - 2], p[n - 1]];
    const vertical = Math.abs(a.x - b.x) < 0.5 && Math.abs(c.x - z.x) < 0.5 && Math.abs(b.y - c.y) < 0.5;
    const horizontal = Math.abs(a.y - b.y) < 0.5 && Math.abs(c.y - z.y) < 0.5 && Math.abs(b.x - c.x) < 0.5;
    if (vertical && Math.abs(b.x - c.x) <= JOG && Math.abs(a.x - shape.x) <= shape.w / 2 - STYLE.linePitch) {
      return [...p.slice(0, n - 3), { x: a.x, y: z.y }];
    }
    if (horizontal && Math.abs(b.y - c.y) <= JOG && Math.abs(a.y - shape.y) <= shape.h / 2 - STYLE.linePitch) {
      return [...p.slice(0, n - 3), { x: z.x, y: a.y }];
    }
    return p;
  };
  return slide(slide(pts, endShape).reverse(), startShape).reverse();
}

// Put an elbow into any segment that is neither horizontal nor vertical.
function orthogonal(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1], b = pts[i];
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) out.push({ x: b.x, y: a.y });
    out.push(b);
  }
  return out;
}

export function route(model) {
  const widest = Math.max(1, ...model.edges.map((e) => e.lines.length)) * STYLE.linePitch;
  // Clearance around shapes. Two clearances must fit in the smallest gap between shapes
  // (60 px in the grid used so far), or the router treats the gap as blocked and detours.
  const padding = Math.min(widest / 2 + 4, 24);
  const spacing = widest + 6;

  // Containers are shapes too, holding their members: MSAGL keeps routes out of containers that
  // are not their own where it can, and an edge to a container is routed to its centre (or a
  // port of its own, see sidePorts) and cut at its border, like an edge to a node.
  const containers = new Map();
  for (const [id, r] of groupRects(model)) {
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    containers.set(id, { id, x: r.x0 + w / 2, y: r.y0 + h / 2, w, h, shape: 'box' });
  }
  for (const e of model.edges) {
    for (const id of [e.from, e.to]) {
      if (model.groupById.has(id) && !containers.has(id)) throw new Error(`edge ${e.id}: container ${id} has no members to draw it around`);
    }
  }
  const shapeOf = (id) => model.items.get(id) ?? containers.get(id);

  // What an edge end at a node heads for: its nearest `via` point, or the other end.
  const near = (e, key) => {
    const v = key === 'from' ? e.via[0] : e.via[e.via.length - 1];
    return v && { x: v[0], y: v[1] };
  };
  const toward = (e, key) => {
    const other = key === 'from' ? 'to' : 'from';
    const n = near(e, key) ?? shapeOf(e[other]);
    return n && { x: n.x, y: n.y };
  };

  // Ports level with the other end. An edge end at a through node or a container whose other end
  // (or nearest `via` point) lies beside one of its sides, level with it, gets a port of its own
  // on that side, so the bundle runs straight in rather than bending towards the centre. A node
  // is aimed at its centre, a container at the stretch both sides share. Ports on one side are
  // spread apart so their bundles do not overlap; ends with no such side use the centre.
  const ports = new Set(); // "edge-id from|to" of ends that have a port of their own
  // The stretch of a shape's sides where an end `width` wide may go: a node's sides less a little
  // at the corners; a container's less more at the corners, below its title band on the left
  // and right, and right of its title on top (`top`: where the top side's stretch starts).
  const usable = (n, width) => {
    const box = rectOf(n);
    const group = model.groupById.get(n.id);
    const m = (group ? CORNER_KEEP : 6) + width / 2;
    const r = { box, x0: box.x0 + m, x1: box.x1 - m, y0: box.y0 + m, y1: box.y1 - m, top: box.x0 + m };
    if (group) {
      r.y0 = Math.max(r.y0, box.y0 + 26 + group.style.fontSize + 24 + width / 2);
      r.top = Math.max(r.top, box.x0 + 20 + textWidth(group.label, group.style.fontSize) + 16 + width / 2);
    }
    return r;
  };
  const sidePorts = (n) => {
    const ends = [];
    for (const e of model.edges) {
      for (const key of ['from', 'to']) {
        if (e[key] !== n.id) continue;
        const width = e.lines.length * STYLE.linePitch;
        const u = usable(n, width);
        const { box } = u;
        // what the end faces: its nearest `via` point, a node's centre, or a container's usable
        // stretch (the same on both sides, so container-to-container ends line up)
        const other = shapeOf(key === 'from' ? e.to : e.from);
        const v = near(e, key);
        const point = v ?? (containers.has(other.id) ? null : other);
        const o = point ? { x0: point.x, x1: point.x, y0: point.y, y1: point.y, box: { x0: point.x, x1: point.x, y0: point.y, y1: point.y } }
          : usable(other, width);
        let side = null, at, lo, hi;
        const [y0, y1] = [Math.max(u.y0, o.y0), Math.min(u.y1, o.y1)];
        if (y0 <= y1 && (o.box.x1 < box.x0 || o.box.x0 > box.x1)) {
          [side, at, lo, hi] = [o.box.x1 < box.x0 ? 'left' : 'right', (y0 + y1) / 2, u.y0, u.y1];
        } else if (o.box.y1 < box.y0 || o.box.y0 > box.y1) {
          side = o.box.y1 < box.y0 ? 'top' : 'bottom';
          // on our top side we face the other's bottom; on our bottom side, its top
          [lo, hi] = [side === 'top' ? u.top : u.x0, u.x1];
          const [x0, x1] = [Math.max(lo, side === 'bottom' && !point ? o.top : o.x0), Math.min(hi, o.x1)];
          if (x0 <= x1) at = (x0 + x1) / 2; else side = null;
        }
        if (side && lo <= hi) ends.push({ id: `${e.id} ${key}`, side, at, width, lo, hi });
      }
    }
    for (const list of Map.groupBy(ends, (p) => p.side).values()) {
      list.sort((p, q) => p.at - q.at);
      for (let i = 1; i < list.length; i++) {
        list[i].at = Math.max(list[i].at, list[i - 1].at + (list[i - 1].width + list[i].width) / 2 + 16);
      }
      // if that ran past the far corner, shift the whole row back
      const over = list[list.length - 1].at - list[list.length - 1].hi;
      if (over > 0) for (const p of list) p.at = Math.max(p.lo, p.at - over);
    }
    for (const p of ends) ports.add(p.id);
    return ends.map(({ id, side, at }) => ({ id, side, at }));
  };

  const shapes = [];
  for (const n of model.items.values()) {
    const s = { id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, outline: outline(n), ports: [] };
    if (n.shape === 'diamond') {
      // Diamonds connect at their four corners. With at most four connections each one gets
      // its own corner, so the branches of a decision never share one.
      const uses = model.edges.filter((e) => e.from === n.id || e.to === n.id).length +
        model.notes.filter((o) => o.attach === n.id).length;
      Object.assign(s, { diamond: true, exclusive: uses <= 4 });
    } else if (n.kind === 'node' && n.shape !== 'person') {
      // bundles from a level neighbour run straight in
      s.ports = sidePorts(n);
    }
    shapes.push(s);
  }
  for (const c of containers.values()) {
    const children = [...model.items.values()].filter((n) => n.group === c.id).map((n) => n.id)
      .concat(model.groups.filter((g) => g.parent === c.id && containers.has(g.id)).map((g) => g.id));
    // MSAGL keeps `padding` clear around every shape, containers too; hand it the container shrunk
    // by that much, so routes may run right along the drawn border (members are further in). Ends
    // are cut at the drawn border afterwards.
    const inner = { ...c, w: c.w - 2 * padding, h: c.h - 2 * padding };
    shapes.push({ ...inner, outline: outline(inner), ports: sidePorts(c), children });
  }

  const edgeEnd = (e, key) => {
    const id = `${e.id} ${key}`;
    if (ports.has(id)) return { shape: e[key], port: id };
    return { shape: e[key], toward: toward(e, key) };
  };
  const conns = [];
  const jobs = model.edges.map((e) => {
    const stops = [edgeEnd(e, 'from'), ...e.via.map(([x, y]) => ({ point: { x, y } })), edgeEnd(e, 'to')];
    const first = conns.length;
    for (let i = 0; i < stops.length - 1; i++) conns.push({ from: stops[i], to: stops[i + 1] });
    return { e, first, count: stops.length - 1 };
  });
  const notes = model.notes.filter((n) => n.attach).map((n) => {
    const at = model.items.get(n.attach);
    conns.push({ from: { shape: n.id, toward: { x: at.x, y: at.y } }, to: { shape: n.attach, toward: { x: n.x, y: n.y } } });
    return { note: n, index: conns.length - 1 };
  });

  const routes = msagl({ shapes, conns, padding, spacing });

  for (const { e, first, count } of jobs) {
    const pieces = routes.slice(first, first + count);
    // pin every piece of the chain back onto the points it starts and ends at: `via` points, and
    // the points MSAGL meant its ends to be at
    const fixed = [pieces[0].pins?.[0], ...e.via.map(([x, y]) => ({ x, y })), pieces[count - 1].pins?.[1]];
    const pts = pieces.flatMap(({ path }, i) => {
      let piece = path.slice();
      const [s0, s1] = [fixed[i], fixed[i + 1]];
      // two `via` points in line: the author asked for a straight piece, even if the router would
      // rather detour round a crossing (ports in line are left to the router, which may have
      // detoured round a box)
      if (i > 0 && i < count - 1 && (Math.abs(s0.x - s1.x) < 0.5 || Math.abs(s0.y - s1.y) < 0.5)) piece = [s0, s1];
      if (piece.length === 2) {
        if (s0) piece[0] = s0;
        if (s1) piece[1] = s1;
      } else {
        if (s0) snap(piece, 0, 1, s0);
        if (s1) snap(piece, piece.length - 1, piece.length - 2, s1);
      }
      return i ? piece.slice(1) : piece;
    });
    e.path = clip(orthogonal(pts), shapeOf(e.from), shapeOf(e.to));
    e.path = slideEnds(e.path, shapeOf(e.from), shapeOf(e.to));
  }
  model.noteLinks = notes.map(({ note, index }) => {
    const { path, pins } = routes[index];
    const pts = path.slice();
    if (pts.length > 1) {
      if (pins?.[0]) snap(pts, 0, 1, pins[0]);
      if (pins?.[1]) snap(pts, pts.length - 1, pts.length - 2, pins[1]);
    }
    return { from: note.id, to: note.attach, path: clip(pts, note, model.items.get(note.attach)) };
  });
  return model;
}

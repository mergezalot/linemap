// Places every node and note that has no `pos`.
// MSAGL's layered layout lays out every node, containers included, top to bottom. With nothing
// pinned that is the placement. Otherwise that layout is scaled and shifted to fit the pinned
// nodes as well as it can, which gives each unpinned node a target; pinned items never move, so
// each unpinned item then tries spots around its target (a note: around its node) and takes the
// cheapest one that overlaps nothing and keeps out of containers it is not part of.
import { STYLE, rectOf, groupRects, containersOf } from './model.mjs';
import { overlaps, contains, segHitsRect } from './geom.mjs';
import { layeredLayout } from './msagl.mjs';

const GAP = 64;        // free space kept around placed items; must exceed two router clearances
const STEP = 60;       // distance between candidate rings
const RINGS = 14;
const CLEAR = 40;      // distance kept from the border of a container an item is not part of
// MSAGL's layout gets every box this much larger on each side: it packs pieces of a container
// that share no edge only 20 px apart, which leaves the router no room between them.
const HALO = 40;
const SEP = 2 * GAP - 2 * HALO; // distance between neighbouring (enlarged) boxes, and between layers

// Spots on a grid around a target, the target itself included.
function around(target) {
  const out = [];
  const r = RINGS;
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) out.push({ x: target.x + i * STEP, y: target.y + j * STEP });
  return out;
}

// Where MSAGL's layered layout would put each node (Map id -> {x, y}), fitted onto the nodes that
// already have a position: the scale and shift that bring them closest (least squares).
function targets(model) {
  const nodes = [...model.items.values()].filter((n) => !(n.kind === 'note' && n.attach));
  const ids = new Set([...nodes.map((n) => n.id), ...model.groups.map((g) => g.id)]);
  const layout = layeredLayout({
    items: nodes.map((n) => ({ id: n.id, w: n.w + 2 * HALO, h: n.h + 2 * HALO, group: n.group })),
    groups: model.groups.map((g) => ({ id: g.id, parent: g.parent, margin: STYLE.groupPad - HALO, title: g.style.fontSize + 26 })),
    links: model.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to).map((e) => [e.from, e.to]),
    sep: SEP,
  });
  const fixed = nodes.filter((n) => n.x !== undefined);
  let scale = 1, dx = 0, dy = 0;
  if (fixed.length) {
    const mean = (f) => fixed.reduce((s, n) => s + f(n), 0) / fixed.length;
    const [px, py] = [mean((n) => layout.get(n.id).x), mean((n) => layout.get(n.id).y)];
    const [qx, qy] = [mean((n) => n.x), mean((n) => n.y)];
    const num = fixed.reduce((s, n) => s + (layout.get(n.id).x - px) * (n.x - qx) + (layout.get(n.id).y - py) * (n.y - qy), 0);
    const den = fixed.reduce((s, n) => s + (layout.get(n.id).x - px) ** 2 + (layout.get(n.id).y - py) ** 2, 0);
    if (den > 0 && num > 0) scale = num / den;
    [dx, dy] = [qx - scale * px, qy - scale * py];
  }
  return new Map([...layout].map(([id, p]) => [id, { x: p.x * scale + dx, y: p.y * scale + dy }]));
}

function candidates(anchor, item) {
  // Spots touching the anchor on each side first, then rings further out.
  const out = [];
  const ax = anchor.w / 2 + item.w / 2 + GAP;
  const ay = anchor.h / 2 + item.h / 2 + GAP;
  for (let ring = 0; ring < RINGS; ring++) {
    const d = ring * STEP;
    const offsets = [
      [ax + d, 0], [-(ax + d), 0], [0, ay + d], [0, -(ay + d)],
      [ax + d, ay + d], [-(ax + d), ay + d], [ax + d, -(ay + d)], [-(ax + d), -(ay + d)],
    ];
    // slide along each side as well, so a note can sit beside a crowded row
    for (const s of [-1, 1]) {
      offsets.push([ax + d, s * (item.h / 2 + d)], [-(ax + d), s * (item.h / 2 + d)]);
      offsets.push([s * (item.w / 2 + d), ay + d], [s * (item.w / 2 + d), -(ay + d)]);
    }
    for (const [dx, dy] of offsets) out.push({ x: anchor.x + dx, y: anchor.y + dy, ring });
  }
  return out;
}

export function place(model) {
  const placed = () => [...model.items.values()].filter((n) => n.x !== undefined);

  // Unpinned plain nodes first (they may anchor notes), then notes. Items that already have a
  // position (`layout`'s `fixed` option) are left where they are.
  const todo = [
    ...model.nodes.filter((n) => !n.pinned && n.x === undefined),
    ...model.notes.filter((n) => !n.pinned && n.x === undefined),
  ];

  const target = todo.length ? targets(model) : new Map();
  // Nothing pinned: MSAGL's layout is the placement (it has no overlaps). Only notes beside their
  // node are left to the search below.
  if (![...model.items.values()].some((n) => n.x !== undefined)) {
    for (const n of todo.filter((t) => target.has(t.id))) [n.x, n.y] = [Math.round(target.get(n.id).x), Math.round(target.get(n.id).y)];
    todo.splice(0, todo.length, ...todo.filter((t) => t.x === undefined));
  }

  for (const item of todo) {
    const groups = groupRects(model);
    const note = item.kind === 'note' && item.attach;
    const anchor = note ? model.items.get(item.attach) : { ...target.get(item.id), w: 0, h: 0 };

    const others = placed().filter((n) => n !== item).map((n) => rectOf(n, GAP));
    // edges between items, as straight segments (an edge to a container ends on its border,
    // so its centre says little about where it runs)
    const straight = model.edges
      .map((e) => [model.items.get(e.from), model.items.get(e.to)])
      .filter(([a, b]) => a?.x !== undefined && b?.x !== undefined && a !== item && b !== item);
    const anchorGroup = anchor.group ? groups.get(anchor.group) : null;
    const homes = containersOf(model, item);

    let best = null;
    for (const c of note ? candidates(anchor, item) : around(anchor)) {
      const r = rectOf({ ...item, x: c.x, y: c.y });
      const rc = rectOf({ ...item, x: c.x, y: c.y }, CLEAR);
      if (others.some((o) => overlaps(o, r))) continue;
      let cost = Math.hypot(c.x - anchor.x, c.y - anchor.y);
      // crossing an existing connection makes the drawing harder to read
      cost += 600 * straight.filter(([a, b]) => segHitsRect(a, b, rectOf({ ...item, x: c.x, y: c.y }, 10))).length;
      if (item.kind === 'note') {
        // a note should sit either well inside or well outside each container
        for (const [gid, g] of groups) {
          if (overlaps(g, rc) && !contains(g, rc)) cost += 400;
          else if (contains(g, r) && anchorGroup && g !== anchorGroup) cost += 300;
        }
      } else {
        // a node must stay clear of containers it does not belong to
        for (const [gid, g] of groups) if (overlaps(g, rc) && !homes.has(gid)) cost += 2000;
      }
      if (!best || cost < best.cost) best = { ...c, cost };
    }
    if (!best) throw new Error(`could not place ${item.id}: no free spot near ${anchor.id ?? 'its neighbours'}`);
    item.x = Math.round(best.x);
    item.y = Math.round(best.y);
  }
  // a slip anywhere above should surface here, not as a stack trace from the router
  for (const n of model.items.values()) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) throw new Error(`could not place ${n.id}`);
  }
  return model;
}

// Pinned items that touch or crowd a container they are not part of (closer than CLEAR px),
// as messages. Containers grow around their members, so this is easy to cause by hand.
export function crowding(model) {
  const groups = groupRects(model);
  const out = [];
  for (const n of model.items.values()) {
    if (!n.pinned) continue;
    const homes = containersOf(model, n);
    // a note may sit inside its node's containers
    if (n.kind === 'note' && n.attach) for (const g of containersOf(model, model.items.get(n.attach))) homes.add(g);
    for (const [gid, g] of groups) {
      if (homes.has(gid)) continue;
      const r = rectOf(n);
      const gap = Math.max(r.x0 - g.x1, g.x0 - r.x1, r.y0 - g.y1, g.y0 - r.y1);
      if (gap < CLEAR && !contains(g, rectOf(n, CLEAR))) {
        out.push(`${n.id} is ${gap < 0 ? `${-Math.round(gap)} px into` : `${Math.round(gap)} px from`} container ${gid}`);
      }
    }
  }
  return out;
}

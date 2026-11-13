// MSAGL (Microsoft's Automatic Graph Layout, pure JS, bundled into vendor/msagl.mjs on install
// by scripts/build-msagl.mjs): its layered layout for placement (`layeredLayout`) and its
// rectilinear edge router (`msagl`, see route.mjs for the request).
//
// MSAGL wants every port on its shape before the router is made, and has no pins the router
// chooses among, so diamond corners are chosen here (`diamondCorners`). Nudging may move a route
// off a port, so the ports' points come back as `pins` and route.mjs snaps the ends back on.
import {
  RectilinearEdgeRouter, Shape, GeomEdge, FloatingPort, RelativeFloatingPort, Point, Polyline,
  layoutGeomGraph, SugiyamaLayoutSettings, LayerDirectionEnum, EdgeRoutingMode, Size,
  EdgeLabelPlacement, GeomLabel, Label,
  Graph, Node, Edge, GeomGraph, GeomNode, CurveFactory,
} from '../vendor/msagl.mjs';

// Which diamond corner each end uses: the one facing where it heads. With `exclusive` each one
// gets its own corner, so the branches of a decision never share one.
const CORNERS = [[0, -0.5], [0.5, 0], [0, 0.5], [-0.5, 0]]; // top, right, bottom, left (fractions of w, h)
function diamondCorners(n, ends) {
  const taken = new Set();
  const out = new Map();
  // ends with the clearest preference choose first
  const ranked = ends.map((end) => {
    const dx = end.toward.x - n.x, dy = end.toward.y - n.y;
    const len = Math.hypot(dx, dy) || 1;
    const scores = CORNERS.map(([fx, fy]) => (fx * 2 * dx + fy * 2 * dy) / len);
    const order = [...scores.keys()].sort((i, j) => scores[j] - scores[i]);
    return { end, order, margin: scores[order[0]] - scores[order[1]] };
  }).sort((p, q) => q.margin - p.margin);
  for (const { end, order } of ranked) {
    const i = n.exclusive ? order.find((k) => !taken.has(k)) ?? order[0] : order[0];
    taken.add(i);
    out.set(end, i);
  }
  return out;
}

export function msagl(req) {
  const shapes = new Map();
  const portOf = new Map(); // request end -> MSAGL port, for ends on a shape
  const pinOf = new Map();  // request end -> the point it is meant to be at, for ports of their own
  const portAt = (s, n, dx, dy) => {
    const p = new RelativeFloatingPort(() => s.BoundaryCurve, () => new Point(n.x, n.y), new Point(dx, dy));
    s.Ports.add(p);
    return p;
  };
  const shapeEnds = Map.groupBy(req.conns.flatMap((c) => [c.from, c.to]).filter((e) => e.shape !== undefined), (e) => e.shape);
  for (const n of req.shapes) {
    const s = new Shape(Polyline.mkClosedFromPoints(n.outline.map((p) => new Point(p.x, p.y))));
    shapes.set(n.id, s);
    const centre = portAt(s, n, 0, 0);
    const ends = shapeEnds.get(n.id) ?? [];
    const ports = new Map((n.ports ?? []).map((p) => [p.id, p]));
    for (const end of ends) {
      const p = ports.get(end.port);
      if (!p) { portOf.set(end, centre); continue; }
      const [dx, dy] = p.side === 'left' || p.side === 'right'
        ? [(p.side === 'left' ? -1 : 1) * n.w / 2, p.at - n.y]
        : [p.at - n.x, (p.side === 'top' ? -1 : 1) * n.h / 2];
      portOf.set(end, portAt(s, n, dx, dy));
      pinOf.set(end, { x: n.x + dx, y: n.y + dy });
    }
    if (n.diamond) {
      for (const [end, i] of diamondCorners(n, ends.filter((e) => e.port === undefined && e.toward))) {
        const [dx, dy] = [CORNERS[i][0] * n.w, CORNERS[i][1] * n.h];
        portOf.set(end, portAt(s, n, dx, dy));
        pinOf.set(end, { x: n.x + dx, y: n.y + dy });
      }
    }
  }

  for (const n of req.shapes) for (const c of n.children ?? []) shapes.get(n.id).AddChild(shapes.get(c));

  const port = (e) => (e.point ? new FloatingPort(null, new Point(e.point.x, e.point.y)) : portOf.get(e));
  const edges = req.conns.map(({ from, to }) => {
    const g = new GeomEdge(null);
    g.sourcePort = port(from);
    g.targetPort = port(to);
    return g;
  });
  const router = new RectilinearEdgeRouter([...shapes.values()], req.padding, 0);
  // MSAGL keeps parallel segments 2 * edgeSeparatian apart (sic)
  router.edgeSeparatian = req.spacing / 2;
  for (const g of edges) router.AddEdgeGeometryToRoute(g);
  router.run();

  return edges.map((g, i) => ({
    path: g.curve ? Array.from(g.curve, (p) => ({ x: p.x, y: p.y })) : [],
    pins: [pinOf.get(req.conns[i].from), pinOf.get(req.conns[i].to)],
  }));
}

// MSAGL's layered (Sugiyama) layout of the whole flow: boxes in layers from top to bottom,
// containers laid out first and then placed as one box in their parent, so
// nothing overlaps. MSAGL's y points up; positions come back with y down. No edges are routed.
//   items   [{ id, w, h, group }]
//   groups  [{ id, parent, margin, title }]  margin: free space kept inside a container's border,
//           title: height of its title band
//   links   [[id, id]]  item or container ids
//   sep     distance between neighbouring boxes, and between layers
// Returns Map id -> {x, y}, centres of the items.
export function layeredLayout({ items, groups, links, sep }) {
  const root = new GeomGraph(new Graph('__root__'));
  const geom = new Map();
  const parentOf = (id) => (id ? geom.get(id) : root);
  const sorted = [];
  const visit = (g) => { if (!sorted.includes(g)) { if (g.parent) visit(groups.find((p) => p.id === g.parent)); sorted.push(g); } };
  groups.forEach(visit);
  for (const g of sorted) {
    const sub = new Graph(g.id);
    parentOf(g.parent).graph.addNode(sub);
    const gg = new GeomGraph(sub);
    gg.labelSize = new Size(0, g.title);
    gg.margins = { left: g.margin, right: g.margin, top: g.margin, bottom: g.margin };
    geom.set(g.id, gg);
  }
  for (const n of items) {
    const node = new Node(n.id);
    parentOf(n.group).graph.addNode(node);
    const gn = new GeomNode(node);
    gn.boundaryCurve = CurveFactory.mkRectangleWithRoundedCorners(n.w, n.h, 0, 0, new Point(0, 0));
    geom.set(n.id, gn);
  }
  for (const [a, b] of links) new GeomEdge(new Edge(geom.get(a).node ?? geom.get(a).graph, geom.get(b).node ?? geom.get(b).graph));
  const settings = new SugiyamaLayoutSettings();
  settings.layerDirection = LayerDirectionEnum.TB;
  settings.commonSettings.NodeSeparation = sep;
  settings.LayerSeparation = sep;
  settings.commonSettings.edgeRoutingSettings.EdgeRoutingMode = EdgeRoutingMode.None;
  root.layoutSettings = settings;
  layoutGeomGraph(root);
  return new Map(items.map((n) => { const c = geom.get(n.id).center; return [n.id, { x: c.x, y: -c.y }]; }));
}

// MSAGL's edge label placement. Each edge is a polyline; labelled ones get a label of the given
// size grown by `pad` all round, placed beside the line where it overlaps nothing (else where it
// overlaps the least), searching from the start of the line. `obstacles` are rectangles to keep
// clear of.
//   edges  [{ path: [{x, y}], label: { w, h } | undefined }]
// Returns Map edge index -> {x, y}, the centre of each placed label.
export function placeLabels({ obstacles, edges, pad }) {
  const box = (r) => {
    const gn = new GeomNode(new Node(''));
    gn.boundaryCurve = CurveFactory.mkRectangleWithRoundedCorners(r.x1 - r.x0, r.y1 - r.y0, 0, 0, new Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2));
    return gn;
  };
  const geomEdges = edges.map(({ path, label }) => {
    const [s, t] = [new GeomNode(new Node('')), new GeomNode(new Node(''))];
    const edge = new Edge(s.node, t.node);
    const ge = new GeomEdge(edge);
    ge.curve = Polyline.mkFromPoints(path.map((p) => new Point(p.x, p.y)));
    if (label) {
      edge.label = new Label(edge);
      ge.label = new GeomLabel(edge.label, new Size(label.w + 2 * pad, label.h + 2 * pad));
    }
    return ge;
  });
  const placer = new EdgeLabelPlacement(obstacles.map(box), geomEdges);
  // every line is an obstacle; only the labelled edges get a label
  placer.edges = geomEdges.filter((g) => g.label);
  for (const g of placer.edges) placer.edgeInfos.get(g).placementOffset = 0;
  placer.run();
  const out = new Map();
  geomEdges.forEach((g, i) => { if (g.label) out.set(i, { x: g.label.center.x, y: g.label.center.y }); });
  return out;
}

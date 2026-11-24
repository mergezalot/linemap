// Edit mode: change the flow right on the map. Drag a node or note to move it (it gets a `pos`);
// drag an edge to bend it through a new via point, drag a via point to move it, double-click it
// (or select it and press Delete) to remove it; drag an end of a selected edge onto another node
// or container to reattach it; drag the handle beside a selected node onto another to connect
// them; double-click the background (or use Add node) to add a node; Delete removes the selection.
// Clicking the selection again switches its mode: a node between moving and resizing (handles on
// its corners and sides; the side across from the one dragged stays put, and the node is pinned),
// an edge between its whole bundle and the one line clicked (whose ends move only that line to
// another box, and Delete takes only it off the edge). Lines… picks the lines of the edge.
// Several boxes: Shift+click adds or removes one, Shift+drag on the background adds those in the
// rectangle, Shift+click on a container adds the boxes in it; dragging one of them moves them all.
// A container: a click on it (its body or its title) selects the container itself, outlined; a
// second click selects the boxes in it (as several boxes, so Group, Ungroup, Merge, Split and Edit
// text work on them), a third the container again. A drag on a selected container (anywhere on it,
// containers inside it too) moves everything in it: its boxes at any depth and the notes attached
// to them, by the drag (snapped as the first box in it), all pinned where they end up, in one edit;
// its box follows the pointer. A drag on a container not selected pans, so large containers never
// get in the way of panning. Its adorner: Delete (the container only, its boxes stay, edges to its
// box go; also Del) · Delete with contents (asks first, naming what goes: its boxes, notes,
// containers in it and every edge to them) · Pin/Unpin all of its boxes (P) · Edit text (its
// label); and the connect handle `+` beside it, for an edge from its box to a box or container.
// Their adorner sits above them all: Delete · Pin/Unpin all (unpin when every box is pinned,
// else pin them all) · Resize. A click on one of them (or Resize) resizes them all: the handles
// are on that box, the others are outlined; while it is dragged every box takes its width and
// height around its own centre (the dragged one keeps its opposite side, as for one box), and
// all are pinned, in one edit. Another click on one of them, or Escape, goes back to moving.
// Container actions follow in that adorner (and the edit bar), each only where it applies; each is
// one edit (one undo), and afterwards the boxes of the new or kept container are selected:
//   Group    a new container (asks its label) around them, inside the innermost container they
//            all share; not when they are all of that one. Containers left empty go.
//   Merge    they come from two or more containers (one inside another counts as the outer one):
//            the container of the box selected first keeps its id and label, the boxes of the
//            others (at any depth: containers inside them are flattened) move into it, and the
//            others go; edges to their boxes move onto the one kept where that is still valid.
//   Split    all from one container, not all of it: they leave it for a new container (asks its
//            label) beside it, in the same parent.
//   Ungroup  they are exactly a container's boxes (the one clicked twice; else the innermost): it goes,
//            the boxes stay where they are. Edges to its box go with it.
// A note moves with the node it is attached to. No drag changes which container a box is in.
// Align… in that adorner (and the edit bar) opens a small menu (main.mjs; Escape, a click
// elsewhere or a choice closes it): align their left sides, centres, right sides, tops, middles or
// bottoms on that line of their bounding box (the line on the grid), or distribute them
// horizontally or vertically (three or more: the outermost two stay, the others go between them
// with equal gaps, in the order of their centres). Every box selected is pinned where it ends up
// (also those that did not move, so the line holds), in one edit (one undo); they stay selected.
// A plain drag on the background pans (viewport.mjs), as do the middle button (over boxes too),
// the wheel and one finger on a touch screen.
// Every change is an editDot op on the flow's text, laid out by check(text) (an error refuses it)
// and handed to commit(text); while something is dragged, preview(text) draws the map as it would
// be, without keeping it: only once the pointer rests (a layout of a big map takes ~100 ms), and
// meanwhile dashed stand-ins run straight from the dragged box (or through the via points) and
// the routes they stand in for fade. Boxes may overlap each other and containers they are not in;
// a drag never changes which container a box is in. Undo and redo step through the texts committed
// here, and the texts the source sidebar commits (commitText: one pause in typing, one step);
// any other change of the text (a reload, another file) forgets them.
// The adorner, a small toolbar above the selection (below it when there is no room on screen):
// for a node or note Delete · Pin/Unpin · Resize, for an edge or one of its lines Delete · Lines….
// A node's adorner also has Add note: it asks for the text (several lines) and adds a note,
// unpinned, in the node's container, attached by an edge without lines, as one edit (one undo);
// the note is then selected. Text with <b>, <i>, <u>, <s>, <br/> or <font color="…"> is written as
// an HTML-like label (label=<…>, line breaks as <br/>), any other text as a quoted string.
// Edit text (adorner, edit bar, F2 or Enter in main.mjs, a double-click on a box or note, or on a
// container's title): the text dialog, opened with the label as written (a note's HTML-like
// label as its source, with its tags; line breaks as real ones), sets the label of the node, note
// or container (`label` op), one edit, one undo; the selection stays. A container's text is
// offered when it is selected, or exactly its boxes are by a second click on it (sel.group). A
// text left blank or unchanged changes nothing.
// Pin/Unpin shows the state (the pin, highlighted, when pinned; a struck-out pin when not) and
// switches it: pinning writes `pos` where the box is, unpinning lets the layout place it. It
// hides while something is dragged. The edit bar keeps the same actions for the keyboard.
// Every pinned node and note carries a pin mark inside its top-right corner (not while it is
// resized, nor when the box is too small on screen); a click on the mark unpins the box, a drag
// from it moves the box like a drag anywhere on it.
// Cursors (style.css), one meaning each, in view and edit mode: grab on the background (a drag
// pans; grabbing only while a pan runs, over anything); pointer on what a click selects or pins
// (edges, bundles and lines, container titles, edit-mode containers, legend rows, adorner buttons,
// pin marks, view-mode nodes); move on what a drag moves (edit-mode boxes, a selected container and
// those in it, edge ends, bend points); a resize arrow on
// size handles; crosshair on the connect handle `+` (a drag draws an edge) and during a Shift+drag
// rectangle; copy over the whole map while Add node waits for its click. A drag keeps the cursor
// it started with until it ends (--drag-cursor on the host). The source sidebar's edge: ew-resize.
// The overlay (selection, handles, adorner, pin marks) is drawn into the map's SVG in map units, after every
// render; it keeps its size on screen.
import { editDot, labelSource, parseFlow } from '@linemap/core';
import { arrange, DISTRIBUTES } from './arrange.mjs';

const NS = 'http://www.w3.org/2000/svg';
const SNAP = 10;        // positions snap to this grid (Alt: no snapping)
const DRAG_START = 4;   // screen px before a press becomes a drag
const PREVIEW_DELAY = 120; // ms the pointer rests before a drag lays the map out again
const HANDLE = 6;       // handle radius, screen px
const MIN_SIZE = 20;    // a node resized is at least this wide and high, map px
const SIZE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const TOOL = 26;        // adorner button, screen px
const TOOL_GAP = 8;     // adorner to the selection, screen px (keeps clear of the connect handle)
const PIN = 8;          // pin mark radius, screen px
const PIN_IN = 13;      // pin mark centre from the box's top and right sides, screen px (clear of the corner handles)

export function createEditor({ host, getText, commit, check, preview, cancelPreview, toast, askLabel, askLines, askNote, askConfirm, openAlign, onChange }) {
  let on = false;
  let svg = null, model = null;
  // { kind: 'node', id, mode: 'move' | 'size' } | { kind: 'edge', from, to, line? } (line: that
  // line alone, not the bundle) | { kind: 'via', from, to, i } | { kind: 'nodes', ids, mode?, main?,
  // group? } (two or more; mode 'size': all take one size, the handles are on box `main`; group:
  // the container they were selected as) | { kind: 'group', id } (a container itself)
  let sel = null;
  let drag = null;
  let adding = false; // Add node: the next click on the map places one
  let swallowClick = false; // the click that ends a press handled already (a rectangle, an adorner button, a pin mark)
  // the click that follows this release finds the overlay drawn again: it is not a click on the map
  const swallow = () => { swallowClick = true; setTimeout(() => { swallowClick = false; }, 0); };
  let lastClick = null; // { key, t }: a second click on the same handle soon after is a double click
  const undo = [], redo = [];

  // ---------- geometry ----------
  const ctm = () => svg?.getScreenCTM();
  const toMap = (e) => {
    const m = ctm();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const unit = () => 1 / (ctm()?.a || 1); // map units per screen px
  const snap = (p, e) => (e.altKey ? { x: Math.round(p.x), y: Math.round(p.y) }
    : { x: Math.round(p.x / SNAP) * SNAP, y: Math.round(p.y / SNAP) * SNAP });
  const edgeOf = (from, to) => model?.edges.find((e) => e.from === from && e.to === to);
  const itemOf = (id) => model?.items.get(id);
  // the boxes selected, and a selection of these ids
  const selectedIds = () => (sel?.kind === 'node' ? [sel.id] : sel?.kind === 'nodes' ? sel.ids : []);
  const selectIds = (ids) => {
    ids = [...new Set(ids)].filter((id) => itemOf(id) && itemOf(id).kind !== 'legend');
    sel = !ids.length ? null : ids.length === 1 ? { kind: 'node', id: ids[0], mode: 'move' } : { kind: 'nodes', ids };
  };
  // the boxes ids are exactly those of container g
  const exactly = (g, ids) => { const m = membersOf(g); return m.length === ids.length && m.every((id) => ids.includes(id)); };
  // the boxes and notes in a container, at any depth
  function membersOf(group) {
    const inside = (id) => { for (let g = id; g; g = model.groups.find((x) => x.id === g)?.parent) if (g === group) return true; return false; };
    return [...model.items.values()].filter((n) => n.kind !== 'legend' && inside(n.group)).map((n) => n.id);
  }
  const isGroup = (id) => !!model?.groups.some((g) => g.id === id);
  // container id and the containers in it, at any depth
  const groupsIn = (id) => model.groups.map((g) => g.id).filter((g) => within(g, id));
  // what moving container id takes along: its boxes at any depth, and the notes attached to them
  function groupLoad(id) {
    const out = new Set(membersOf(id));
    for (const n of model.items.values()) if (n.kind === 'note' && n.attach && out.has(n.attach)) out.add(n.id);
    return [...out];
  }
  // a container's box as drawn now (map units): { x0, y0, x1, y1 }, or null (not drawn)
  function groupBox(id) {
    const b = svg?.querySelector(`g.group[id="${CSS.escape(id)}"] > rect.lm-group-box`)?.getBBox();
    return b ? { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height } : null;
  }
  const lineLabel = (id) => model?.lines.find((l) => l.id === id)?.label ?? id;

  // the line of an edge's bundle under a pointer event: the strand hit, else the nearest one
  function lineAt(edgeG, e) {
    const hit = e.target.closest?.('[data-line]');
    if (hit && edgeG.contains(hit)) return hit.getAttribute('data-line');
    const p = toMap(e);
    let best = { d: Infinity, id: null };
    for (const path of edgeG.querySelectorAll(':scope > path.lm-strand[data-line]')) {
      const len = path.getTotalLength();
      for (let s = 0; s <= len; s += 4) {
        const q = path.getPointAtLength(s);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < best.d) best = { d, id: path.getAttribute('data-line') };
      }
    }
    return best.id;
  }

  // distance along a polyline to the point on it nearest p
  function along(path, p) {
    let best = { d: Infinity, s: 0 }, s = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len)));
      const d = Math.hypot(a.x + t * (b.x - a.x) - p.x, a.y + t * (b.y - a.y) - p.y);
      if (d < best.d) best = { d, s: s + t * len };
      s += len;
    }
    return best.s;
  }
  // where a new via point at p goes among the edge's via points: in order along its route
  function viaIndex(e, p) {
    const at = along(e.path, p);
    return e.via.filter(([x, y]) => along(e.path, { x, y }) < at).length;
  }

  // the node, note or container under a screen point (not the overlay, not badges)
  function targetAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (!svg?.contains(el) || el.closest('.lm-edit')) continue;
      const tab = el.closest('g.group-tab');
      if (tab) return tab.dataset.group;
      const g = el.closest('g.node, g.note:not(.lm-note-folded), g.group');
      if (g) return g.id;
    }
    return null;
  }
  // the innermost container around a map point
  function containerAt(p) {
    let best = null;
    for (const g of svg.querySelectorAll('g.group')) {
      const b = g.querySelector('rect')?.getBBox();
      if (!b || p.x < b.x || p.x > b.x + b.width || p.y < b.y || p.y > b.y + b.height) continue;
      if (!best || b.width * b.height < best.area) best = { id: g.id, area: b.width * b.height };
    }
    return best?.id ?? null;
  }

  // ---------- changes ----------
  // expect(flow): an error message when the edited flow does not come out as the edit meant
  function apply(ops, { quiet = false, expect } = {}) {
    const text = getText();
    let next;
    try {
      next = editDot(text, ops);
      const why = expect?.(parseFlow(next));
      if (why) throw new Error(why);
    } catch (err) {
      if (!quiet) toast(`Not changed: ${err.message}`);
      return false;
    }
    if (next === text) return false;
    const err = check(next);
    if (err) {
      if (!quiet) toast(`Not changed: ${err}`);
      return false;
    }
    undo.push(text);
    redo.length = 0;
    commit(next);
    onChange?.();
    return true;
  }
  // The drag moved on: the map shown is stale until the pointer rests and it is laid out again.
  // (drag.shown: the drag.version the map on screen was laid out for)
  let previewTimer = 0;
  function moved() {
    clearTimeout(previewTimer);
    drag.version = (drag.version ?? 0) + 1;
  }
  const stale = () => drag?.moved && drag.base && drag.shown !== drag.version;
  function tryPreview(ops) {
    const d = drag;
    previewTimer = setTimeout(() => {
      if (drag !== d) return;
      d.requested = d.version;
      try { preview(editDot(d.base, ops)); } catch { /* shown on release */ }
    }, PREVIEW_DELAY);
  }
  function step(from, to) {
    if (!from.length) return;
    const text = getText();
    to.push(text);
    commit(from.pop());
    sel = null;
    onChange?.();
  }

  // the edge from -> to carries exactly `lines` afterwards (an edge default could add others)
  const carries = (from, to, lines) => (flow) => {
    const e = flow.edges.find((x) => x.from === from && x.to === to);
    const got = e ? e.lines.map((l) => l.id).sort().join(' ') : '';
    return got === [...lines].sort().join(' ') ? null : `the lines of ${from} -> ${to} are also set elsewhere (an edge default?); edit them in the file`;
  };
  // ops that take one line off an edge (the edge goes with its last line)
  function lineOff(e, line) {
    const rest = e.lines.map((l) => l.id).filter((id) => id !== line);
    return rest.length ? { op: 'lines', from: e.from, to: e.to, lines: rest } : { op: 'removeEdge', from: e.from, to: e.to };
  }

  function remove() {
    if (!sel) return;
    if (sel.kind === 'node') apply({ op: 'removeNode', id: sel.id });
    // a container: only it, its boxes stay (in its parent); edges to its box go
    else if (sel.kind === 'group') apply({ op: 'removeGroup', id: sel.id });
    else if (sel.kind === 'nodes') apply(sel.ids.map((id) => ({ op: 'removeNode', id })));
    else if (sel.kind === 'edge' && sel.line) {
      const e = edgeOf(sel.from, sel.to);
      const op = e && lineOff(e, sel.line);
      if (op) apply(op, op.op === 'lines' ? { expect: carries(e.from, e.to, op.lines) } : {});
    } else if (sel.kind === 'edge') apply({ op: 'removeEdge', from: sel.from, to: sel.to });
    else if (sel.kind === 'via') {
      const e = edgeOf(sel.from, sel.to);
      if (e) apply({ op: 'via', from: e.from, to: e.to, points: e.via.filter((_, i) => i !== sel.i) });
    }
    sel = null;
    draw();
    onChange?.();
  }
  // Delete with contents: the selected container with everything in it (deep removeGroup), once the
  // dialog naming what goes is confirmed
  async function removeDeep() {
    if (sel?.kind !== 'group' || !isGroup(sel.id)) return;
    const id = sel.id;
    const load = groupLoad(id).map(itemOf).filter(Boolean);
    const count = (k, one, many) => (k === 1 ? `1 ${one}` : `${k} ${many}`);
    const boxes = load.filter((n) => n.kind !== 'note').length, notes = load.length - boxes, inner = groupsIn(id).length - 1;
    const parts = [count(boxes, 'box', 'boxes'), notes && count(notes, 'note', 'notes'), inner && count(inner, 'container', 'containers')].filter(Boolean);
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
    const ok = await askConfirm?.({
      heading: `Delete ${groupLabel(id)} with everything in it?`,
      text: `The container, ${list} in it, and every edge to them go. Ctrl+Z brings them back.`,
      ok: `Delete ${count(boxes, 'box', 'boxes')}`,
    });
    if (!ok || sel?.kind !== 'group' || sel.id !== id) return;
    if (apply({ op: 'removeGroup', id, deep: true })) sel = null;
    draw();
    onChange?.();
  }

  // an id from a label: lower case, words joined by _, unique among nodes, containers and lines
  // (prefix: put before it, as `cluster_` for a container)
  function newId(label, prefix = '') {
    const base = label.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'node';
    const stem = prefix + (/^[a-z_]/.test(base) ? base : `n_${base}`);
    const taken = new Set([...model.items.keys(), ...model.hiddenNotes.map((n) => n.id), ...model.groups.map((g) => g.id), ...model.lines.map((l) => l.id)]);
    let id = stem;
    for (let i = 2; taken.has(id); i++) id = `${stem}_${i}`;
    return id;
  }
  async function addNodeAt(p) {
    adding = false;
    host.classList.remove('adding');
    onChange?.();
    const label = await askLabel();
    if (!label) return;
    const id = newId(label);
    const at = snap(p, {});
    if (apply({ op: 'addNode', id, label, x: at.x, y: at.y, group: containerAt(p) ?? undefined })) sel = { kind: 'node', id, mode: 'move' };
  }
  async function connect(from, to) {
    const a = itemOf(from), b = itemOf(to);
    let lines = [];
    // an edge to or from a note attaches it; any other carries lines
    if (a?.kind !== 'note' && b?.kind !== 'note') {
      const carried = new Set(model.edges.filter((e) => e.from === from || e.to === from).flatMap((e) => e.lines.map((l) => l.id)));
      const name = (id) => itemOf(id)?.label ?? model.groups.find((g) => g.id === id)?.label ?? id;
      lines = await askLines(model.lines, carried, `${name(from)} → ${name(to)}`);
      if (!lines?.length) return;
    }
    if (apply({ op: 'addEdge', from, to, lines })) sel = { kind: 'edge', from, to };
  }
  // a note for the selected node: unpinned (the layout puts it beside the node), in the node's
  // container (so the container grows around it), attached by an edge without lines
  async function addNote() {
    const n = sel?.kind === 'node' && itemOf(sel.id);
    if (n?.kind !== 'node') return;
    const text = await askNote(`A note on ${n.label}`);
    if (!text) return;
    const id = newId(`note_${n.id}`);
    if (apply([{ op: 'addNode', id, label: text, shape: 'note', group: n.group ?? undefined }, { op: 'addEdge', from: n.id, to: id }])) {
      sel = { kind: 'node', id, mode: 'move' };
      draw();
      onChange?.();
    }
  }
  // pick the lines of the selected edge
  async function editLines() {
    if (sel?.kind !== 'edge' && sel?.kind !== 'via') return;
    const e = edgeOf(sel.from, sel.to);
    if (!e) return;
    const label = (id) => itemOf(id)?.label ?? model.groups.find((g) => g.id === id)?.label ?? id;
    const lines = await askLines(model.lines, new Set(e.lines.map((l) => l.id)), `${label(e.from)} → ${label(e.to)}`, { heading: 'Lines on the edge', ok: 'Set' });
    if (!lines) return;
    if (!lines.length) { toast('An edge carries at least one line; Del removes it'); return; }
    if (apply({ op: 'lines', from: e.from, to: e.to, lines }, { expect: carries(e.from, e.to, lines) })) {
      sel = { kind: 'edge', from: e.from, to: e.to };
    }
    draw();
    onChange?.();
  }

  // ---------- text ----------
  // What Edit text would edit: { kind: 'node' | 'note' | 'group', id }, or null. A container: when
  // it is selected, or exactly its boxes are, by a second click on it.
  function textTarget() {
    if (!model) return null;
    if (sel?.kind === 'group') return isGroup(sel.id) ? { kind: 'group', id: sel.id } : null;
    if (sel?.kind === 'node') {
      const n = itemOf(sel.id);
      return n && n.kind !== 'legend' ? { kind: n.kind, id: n.id } : null;
    }
    if (sel?.kind === 'nodes' && sel.group && model.groups.some((g) => g.id === sel.group) && exactly(sel.group, sel.ids)) return { kind: 'group', id: sel.group };
    return null;
  }
  // The text dialog for a node, note or container (target: what textTarget gives), its label set
  // as one edit; the selection as it was
  async function editText(target = textTarget()) {
    if (!target) return false;
    const { kind, id } = target;
    const label = kind === 'group' ? groupLabel(id) : itemOf(id)?.label ?? id;
    let current;
    try { current = labelSource(getText(), id); } catch { current = label; }
    const first = label.split('\n')[0];
    const what = kind === 'group' ? { heading: 'Rename the container', placeholder: 'Its label', title: `Container ${id}` }
      : kind === 'note' ? { heading: 'Edit the note', placeholder: 'Text of the note', title: `Note ${id}` }
        : { heading: 'Edit the text of the box', placeholder: 'Text of the box', title: `Box ${id}${first !== id ? ` (${first})` : ''}` };
    const keep = sel;
    const text = await askNote(what.title, { heading: what.heading, ok: 'Save', placeholder: what.placeholder, value: current, rich: kind === 'note' });
    if (text == null || text === current) return true;
    if (apply({ op: 'label', id, text })) {
      sel = keep;
      draw();
      onChange?.();
    }
    return true;
  }

  // ---------- containers ----------
  const parentOf = (g) => model.groups.find((x) => x.id === g)?.parent ?? null;
  // container g is container `outer` or inside it
  const within = (g, outer) => { for (; g; g = parentOf(g)) if (g === outer) return true; return false; };
  const chainOf = (g) => { const c = []; for (; g; g = parentOf(g)) c.unshift(g); return c; };
  const groupLabel = (g) => model.groups.find((x) => x.id === g)?.label || g;
  // the boxes a move takes along: a note goes with the node it is attached to, and that node's
  // other notes with it (as editDot's moveTo does)
  function withNotes(ids) {
    const out = new Set(ids);
    for (let more = true; more;) {
      more = false;
      for (const n of model.items.values()) {
        if (n.kind !== 'note' || !n.attach) continue;
        if (out.has(n.id) && !out.has(n.attach) && itemOf(n.attach)) { out.add(n.attach); more = true; }
        if (out.has(n.attach) && !out.has(n.id)) { out.add(n.id); more = true; }
      }
    }
    return out;
  }
  // What the container actions would do with the boxes selected (two or more), each only where it
  // applies: { group: { parent }, merge: { keep, others }, split: { from }, ungroup: { id } }.
  function containerPlan() {
    if (sel?.kind !== 'nodes' || !model) return {};
    const ids = sel.ids.filter((id) => itemOf(id) && itemOf(id).kind !== 'legend');
    if (ids.length < 2) return {};
    const moved = withNotes(ids);
    const all = (g) => { const m = membersOf(g); return m.length > 0 && m.every((id) => moved.has(id)); };
    const plan = {};
    // Group: inside the innermost container they all share (not when they are all of it: that
    // would only wrap it again)
    const chains = [...moved].map((id) => chainOf(itemOf(id)?.group ?? null));
    let shared = chains[0];
    for (const c of chains) shared = shared.slice(0, [...shared, null].findIndex((g, i) => g !== c[i]));
    const parent = shared.at(-1) ?? null;
    if (!parent || !all(parent)) plan.group = { parent };
    // Merge: the boxes come from two or more containers (a container inside another one of them
    // counts as that one); the one of the box clicked first stays
    const direct = ids.map((id) => itemOf(id).group);
    if (direct.every(Boolean)) {
      const tops = [...new Set(direct)].filter((g, _, gs) => !gs.some((h) => h !== g && within(g, h)));
      if (tops.length > 1) {
        const keep = tops.find((t) => within(direct[0], t));
        plan.merge = { keep, others: tops.filter((t) => t !== keep) };
      }
    }
    // Split: all from one container, not all of it
    if (direct[0] && direct.every((g) => g === direct[0]) && !all(direct[0])) plan.split = { from: direct[0] };
    // Ungroup: exactly a container's boxes (the one clicked, else the innermost such one)
    const same = (g) => exactly(g, ids);
    const ung = sel.group && model.groups.some((g) => g.id === sel.group) && same(sel.group) ? sel.group
      : model.groups.filter((g) => same(g.id)).sort((a, b) => chainOf(b.id).length - chainOf(a.id).length)[0]?.id;
    if (ung) plan.ungroup = { id: ung };
    return plan;
  }
  // Edges to the boxes of containers that go are moved onto container `to`, where they still make
  // sense (not a loop, nor a link between a container and something inside it); the rest go with
  // the containers. inside(id): the box or container ends up inside `to`.
  function edgesOnto(gone, to, inside) {
    const above = chainOf(parentOf(to));
    const ops = [];
    for (const e of model.edges) {
      const [a, b] = [gone.has(e.from), gone.has(e.to)];
      if (a === b) continue;
      const other = a ? e.to : e.from;
      if (other === to || inside(other) || above.includes(other)) continue;
      ops.push({ op: 'moveEdge', from: e.from, to: e.to, newFrom: a ? to : e.from, newTo: a ? e.to : to });
    }
    return ops;
  }
  // after the change: `ids` selected, `group` the container they are (for Ungroup)
  function selectAfter(ids, group) {
    selectIds(ids);
    if (sel?.kind === 'nodes' && group) sel.group = group;
    draw();
    onChange?.();
  }
  // Group: a new container around the boxes; containers they leave empty go (edges to those
  // containers move onto the new one)
  async function groupSel() {
    const p = containerPlan().group;
    if (!p) return;
    const ids = [...sel.ids], moved = withNotes(ids);
    const label = await askLabel({ heading: 'New container', ok: 'Group', placeholder: 'Its label' });
    if (!label) return;
    const id = newId(label, 'cluster_');
    const emptied = new Set(model.groups.map((g) => g.id).filter((g) => g !== p.parent && within(g, p.parent) && membersOf(g).length && membersOf(g).every((m) => moved.has(m))));
    const ops = [
      { op: 'group', id, label, ids: [...moved], parent: p.parent ?? undefined },
      ...edgesOnto(emptied, id, (x) => moved.has(x) || emptied.has(x)),
      ...[...emptied].map((g) => ({ op: 'removeGroup', id: g })),
    ];
    if (apply(ops)) selectAfter([...ids, ...moved], id);
  }
  // Split: the boxes leave their container for a new one beside it
  async function splitSel() {
    const p = containerPlan().split;
    if (!p) return;
    const ids = [...sel.ids], moved = withNotes(ids);
    const label = await askLabel({ heading: 'Split into a new container', ok: 'Split', placeholder: 'Its label', hint: `Out of ${groupLabel(p.from)}, beside it` });
    if (!label) return;
    const id = newId(label, 'cluster_');
    if (apply({ op: 'group', id, label, ids: [...moved], parent: parentOf(p.from) ?? undefined })) selectAfter([...ids, ...moved], id);
  }
  // Merge: the other containers' boxes (at any depth) move into the one kept; they and the
  // containers in them go, and edges to them move onto the one kept
  function mergeSel() {
    const p = containerPlan().merge;
    if (!p) return;
    const ids = [...sel.ids];
    const gone = new Set(model.groups.map((g) => g.id).filter((g) => p.others.some((o) => within(g, o))));
    const moving = withNotes(p.others.flatMap(membersOf));
    const ops = [
      ...edgesOnto(gone, p.keep, (x) => moving.has(x) || within(itemOf(x)?.group ?? null, p.keep) || (x !== p.keep && within(x, p.keep))),
      { op: 'moveTo', ids: [...moving], group: p.keep },
      ...[...gone].sort((a, b) => chainOf(a).length - chainOf(b).length).map((g) => ({ op: 'removeGroup', id: g })),
    ];
    const keep = membersOf(p.keep);
    if (apply(ops)) selectAfter([...ids, ...keep, ...moving], p.keep);
  }
  // Ungroup: the container goes, its boxes stay where they are (and selected)
  function ungroupSel() {
    const p = containerPlan().ungroup;
    if (!p) return;
    const ids = [...sel.ids];
    if (apply({ op: 'removeGroup', id: p.id })) selectAfter(ids, null);
  }
  const containerActs = { group: groupSel, merge: mergeSel, split: splitSel, ungroup: ungroupSel };

  // Align / distribute (arrange.mjs): every box of the selection is pinned where it ends up (the
  // aligned line on the grid), in one edit; the selection stays
  const arrangeable = () => (sel?.kind === 'nodes' ? sel.ids.map(itemOf).filter((n) => n && n.kind !== 'legend') : []);
  function alignSel(how) {
    const ns = arrangeable();
    if (ns.length < (DISTRIBUTES.includes(how) ? 3 : 2)) return false;
    const ids = [...sel.ids], group = sel.group;
    const ops = arrange(ns, how, SNAP).map(({ id, x, y }) => ({ op: 'pos', id, x, y }));
    if (apply(ops)) selectAfter(ids, group);
    return true;
  }

  // ---------- overlay ----------
  const el = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    parent?.append(n);
    return n;
  };
  function draw() {
    if (!svg) return;
    svg.querySelector(':scope > g.lm-edit')?.remove();
    // one line of a bundle selected: the others of that edge fade
    for (const x of svg.querySelectorAll('.lm-edit-dim')) x.classList.remove('lm-edit-dim');
    const standins = stale() ? staleEdges() : [];
    for (const { e } of standins) edgeG(e)?.classList.add('lm-edit-dim');
    if (on && sel?.kind === 'edge' && sel.line) {
      const ge = edgeG(sel);
      for (const x of ge?.querySelectorAll('[data-line]') ?? []) if (x.getAttribute('data-line') !== sel.line) x.classList.add('lm-edit-dim');
    }
    // a selected container, and those in it: a drag on them moves it (the move cursor, style.css)
    for (const x of svg.querySelectorAll('.lm-edit-on')) x.classList.remove('lm-edit-on');
    if (on && sel?.kind === 'group' && isGroup(sel.id)) {
      for (const id of groupsIn(sel.id)) {
        for (const x of svg.querySelectorAll(`g.group[id="${CSS.escape(id)}"], g.group-tab[data-group="${CSS.escape(id)}"]`)) x.classList.add('lm-edit-on');
      }
    }
    if (!on) return;
    const u = unit(), r = HANDLE * u;
    const g = el('g', { class: 'lm-edit' }, svg);
    pinMarks(g, u);
    if (sel?.kind === 'group') {
      // (while it is dragged: where the pointer has it)
      const b = drag?.moved && drag.group === sel.id ? movedBox(drag, sel.id) : groupBox(sel.id);
      if (b) {
        const pad = 6 * u;
        el('rect', { class: 'lm-edit-sel', x: b.x0 - pad, y: b.y0 - pad, width: b.x1 - b.x0 + 2 * pad, height: b.y1 - b.y0 + 2 * pad, rx: 10 * u }, g);
        connectHandle(g, b.x1 + pad + 14 * u, (b.y0 + b.y1) / 2, r);
      }
    }
    if (sel?.kind === 'node' && itemOf(sel.id)) {
      // (while it is dragged or resized: where the pointer has it)
      const dragged = drag?.moved && drag.id === sel.id && (drag.kind !== 'move' || drag.ids.length === 1);
      const n = dragged && drag.kind === 'move' ? { ...itemOf(sel.id), ...drag.at }
        : dragged && drag.kind === 'size' ? { ...itemOf(sel.id), ...drag.at, ...drag.size } : itemOf(sel.id);
      const sizing = sel.mode === 'size';
      const pad = (sizing ? 0 : 6) * u;
      el('rect', { class: `lm-edit-sel${sizing ? ' sizing' : ''}`, x: n.x - n.w / 2 - pad, y: n.y - n.h / 2 - pad, width: n.w + 2 * pad, height: n.h + 2 * pad, rx: sizing ? 0 : 8 * u }, g);
      if (sizing) sizeHandles(g, n, r);
      else if (n.kind !== 'legend') connectHandle(g, n.x + n.w / 2 + pad + 14 * u, n.y, r);
    }
    if (sel?.kind === 'nodes') {
      // in size mode: each box outlined, the handles on the main one; while resized, each at the
      // dragged size around its own centre (the main one where the pointer has it)
      const sizing = sel.mode === 'size';
      const pad = (sizing ? 0 : 6) * u;
      const moving = drag?.kind === 'move' && drag.moved;
      const resized = drag?.kind === 'size' && drag.moved && drag.size;
      for (const id of sel.ids) {
        let n = itemOf(id);
        if (!n) continue;
        if (moving && drag.orig.has(id)) n = { ...n, ...dragAt(drag, id) };
        if (resized && drag.ids.includes(id)) n = { ...n, ...drag.size, ...(id === drag.id ? drag.at : {}) };
        el('rect', { class: `lm-edit-sel${sizing ? ' sizing' : ''}`, x: n.x - n.w / 2 - pad, y: n.y - n.h / 2 - pad, width: n.w + 2 * pad, height: n.h + 2 * pad, rx: sizing ? 0 : 8 * u }, g);
        if (sizing && id === sel.main) sizeHandles(g, n, r);
      }
    }
    if (drag?.kind === 'box' && drag.moved) {
      const { a, b } = drag;
      el('rect', { class: 'lm-edit-box', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }, g);
    }
    for (const e of model.edges) {
      const picked = sel && sel.kind !== 'node' && sel.kind !== 'nodes' && sel.from === e.from && sel.to === e.to;
      const strand = picked && sel.line ? e.strands?.find((s) => s.line.id === sel.line) : null;
      if (strand) {
        // one line of the bundle: its lane, and handles on its ends
        el('path', { d: strand.d, class: 'lm-edit-route lm-edit-lane', 'stroke-width': e.width / e.strands.length + 8 * u }, g);
        for (const [end, p] of [['from', strand.start.p], ['to', strand.end.p]]) {
          el('circle', { cx: p.x, cy: p.y, r: r * 1.2, class: 'lm-edit-handle lm-edit-end', 'data-handle': 'end', 'data-end': end, 'data-from': e.from, 'data-to': e.to, 'data-line': sel.line }, g);
        }
      } else if (picked) {
        const d = e.path.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('');
        el('path', { d, class: 'lm-edit-route', 'stroke-width': e.width + 10 * u }, g);
        for (const [end, p] of [['from', e.path[0]], ['to', e.path.at(-1)]]) {
          el('circle', { cx: p.x, cy: p.y, r: r * 1.2, class: 'lm-edit-handle lm-edit-end', 'data-handle': 'end', 'data-end': end, 'data-from': e.from, 'data-to': e.to }, g);
        }
      }
      e.via.forEach(([x, y], i) => {
        const s = (picked ? 1.2 : 0.9) * r;
        const hot = sel?.kind === 'via' && sel.i === i && picked;
        el('rect', { x: x - s, y: y - s, width: 2 * s, height: 2 * s, transform: `rotate(45 ${x} ${y})`, class: `lm-edit-handle lm-edit-via${hot ? ' on' : ''}`, 'data-handle': 'via', 'data-from': e.from, 'data-to': e.to, 'data-i': i }, g);
      });
    }
    for (const { pts } of standins) el('path', { d: pts.map((q, i) => `${i ? 'L' : 'M'}${q.x},${q.y}`).join(''), class: 'lm-edit-standin' }, g);
    if (drag?.ghost) el('path', { d: `M${drag.ghost.a.x},${drag.ghost.a.y}L${drag.ghost.b.x},${drag.ghost.b.y}`, class: 'lm-edit-ghost' }, g);
    if (drag?.kind === 'via' && drag.moved) {
      const [x, y] = drag.points[drag.i];
      const s = 1.2 * r;
      el('rect', { x: x - s, y: y - s, width: 2 * s, height: 2 * s, transform: `rotate(45 ${x} ${y})`, class: 'lm-edit-handle lm-edit-via on' }, g);
    }
    if (!drag?.moved) adorner(g, u);
  }

  // the connect handle `+` at cx, cy: a drag from it draws a new edge
  function connectHandle(g, cx, cy, r) {
    const c = el('g', { class: 'lm-edit-handle lm-edit-connect', 'data-handle': 'connect' }, g);
    el('circle', { cx, cy, r: r * 1.5 }, c);
    el('path', { d: `M${cx - r * 0.8},${cy}H${cx + r * 0.8}M${cx},${cy - r * 0.8}V${cy + r * 0.8}`, class: 'lm-edit-plus' }, c);
  }
  // the eight size handles on a box's corners and sides
  function sizeHandles(g, n, r) {
    const s = r * 0.85;
    for (const dir of SIZE_DIRS) {
      const x = n.x + (dir.includes('w') ? -1 : dir.includes('e') ? 1 : 0) * n.w / 2;
      const y = n.y + (dir.includes('n') ? -1 : dir.includes('s') ? 1 : 0) * n.h / 2;
      el('rect', { x: x - s, y: y - s, width: 2 * s, height: 2 * s, class: `lm-edit-handle lm-edit-size lm-edit-size-${dir}`, 'data-handle': 'size', 'data-dir': dir }, g);
    }
  }
  // A pin mark on every pinned box, under the other handles: where a drag has the box now.
  function pinMarks(g, u) {
    const pr = PIN * u, inset = PIN_IN * u;
    for (const n of model.items.values()) {
      if (!n.pinned || n.kind === 'legend') continue;
      if ((sel?.mode === 'size' && selectedIds().includes(n.id)) || (drag?.kind === 'size' && drag.ids.includes(n.id))) continue;
      // too small on screen: the mark would cover it
      if (n.w < 2 * (PIN_IN + PIN) * u || n.h < 2 * (PIN_IN + PIN) * u) continue;
      const at = drag?.kind === 'move' && drag.moved && drag.orig.has(n.id) ? dragAt(drag, n.id) : n;
      const cx = at.x + n.w / 2 - inset, cy = at.y - n.h / 2 + inset;
      const m = el('g', { class: 'lm-edit-handle lm-edit-pin', 'data-handle': 'pin', 'data-id': n.id }, g);
      el('title', {}, m).textContent = 'Pinned here: click to unpin it, so the layout places it (P); drag to move it';
      el('circle', { cx, cy, r: pr }, m);
      const s = 12 * u;
      el('use', { href: '#i-pin', x: cx - s / 2, y: cy - s / 2, width: s, height: s }, m);
    }
  }

  // ---------- adorner ----------
  // The buttons for the selection, and the map rectangle to put them by (x0, y0, x1, y1).
  function tools() {
    if (sel?.kind === 'node') {
      const n = itemOf(sel.id);
      if (!n || n.kind === 'legend') return null;
      const pad = sel.mode === 'size' ? 0 : 6 * unit();
      const sizing = sel.mode === 'size';
      return {
        at: { x0: n.x - n.w / 2 - pad, y0: n.y - n.h / 2 - pad, x1: n.x + n.w / 2 + pad, y1: n.y + n.h / 2 + pad },
        list: [
          { act: 'delete', icon: 'i-trash', title: `Delete the ${n.kind === 'note' ? 'note' : 'box and its edges'} (Del)` },
          n.pinned ? { act: 'unpin', icon: 'i-pin', on: true, title: 'Pinned here: click to unpin it, so the layout places it (P)' }
            : { act: 'pin', icon: 'i-unpin', title: 'Not pinned: click to pin it where it is (P)' },
          { act: 'resize', icon: 'i-resize', on: sizing, title: sizing ? 'Resizing: click to move it again (or click the box)' : 'Resize (or click the box again)' },
          ...(n.kind === 'node' ? [{ act: 'note', icon: 'i-note-add', title: 'Add a note to this box' }] : []),
          { act: 'text', icon: 'i-text-edit', title: `Edit the text of the ${n.kind === 'note' ? 'note' : 'box'} (F2, Enter or double-click)` },
        ],
      };
    }
    if (sel?.kind === 'nodes') {
      // above the bounding box of the boxes
      const ns = sel.ids.map(itemOf).filter(Boolean);
      if (!ns.length) return null;
      const sizing = sel.mode === 'size';
      const pad = sizing ? 0 : 6 * unit();
      const all = ns.every((n) => n.pinned);
      return {
        at: {
          x0: Math.min(...ns.map((n) => n.x - n.w / 2)) - pad, y0: Math.min(...ns.map((n) => n.y - n.h / 2)) - pad,
          x1: Math.max(...ns.map((n) => n.x + n.w / 2)) + pad, y1: Math.max(...ns.map((n) => n.y + n.h / 2)) + pad,
        },
        list: [
          { act: 'delete', icon: 'i-trash', title: `Delete the ${ns.length} boxes and their edges (Del)` },
          all ? { act: 'unpin', icon: 'i-pin', on: true, title: 'All pinned: click to unpin them, so the layout places them (P)' }
            : { act: 'pin', icon: 'i-unpin', title: `${ns.some((n) => n.pinned) ? 'Not all' : 'None'} pinned: click to pin them all where they are (P)` },
          { act: 'resize', icon: 'i-resize', on: sizing, title: sizing ? 'Resizing all to one size: click to move them again (or click one of them)' : 'Resize them all to one size (or click one of them again)' },
          ...(openAlign ? [{ act: 'align', icon: 'i-align-left', title: 'Align or distribute them…' }] : []),
          ...containerTools(),
          ...(textTarget()?.kind === 'group' ? [{ act: 'text', icon: 'i-text-edit', title: `Rename ${groupLabel(sel.group)} (F2, Enter or double-click its title)` }] : []),
        ],
      };
    }
    if (sel?.kind === 'group') {
      const b = isGroup(sel.id) && groupBox(sel.id);
      if (!b) return null;
      const pad = 6 * unit(), name = groupLabel(sel.id);
      const ns = groupLoad(sel.id).map(itemOf).filter((n) => n && n.kind !== 'legend');
      const all = ns.length > 0 && ns.every((n) => n.pinned);
      return {
        at: { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad },
        list: [
          { act: 'delete', icon: 'i-trash', title: `Delete ${name} only: its boxes stay, edges to the container go (Del)` },
          { act: 'deleteAll', icon: 'i-trash-all', title: `Delete ${name} with everything in it…` },
          all ? { act: 'unpin', icon: 'i-pin', on: true, title: 'All its boxes are pinned: click to unpin them, so the layout places them (P)' }
            : { act: 'pin', icon: 'i-unpin', title: `${ns.some((n) => n.pinned) ? 'Not all' : 'None'} of its boxes pinned: click to pin them all where they are (P)` },
          { act: 'text', icon: 'i-text-edit', title: `Rename ${name} (F2, Enter or double-click its title)` },
        ],
      };
    }
    if (sel?.kind === 'edge') {
      const e = edgeOf(sel.from, sel.to);
      if (!e?.path?.length) return null;
      const p = midpoint(e.path), h = e.width / 2 + 4 * unit();
      return {
        at: { x0: p.x, y0: p.y - h, x1: p.x, y1: p.y + h },
        list: [
          { act: 'delete', icon: 'i-trash', title: sel.line ? `Take line ${lineLabel(sel.line)} off this edge (Del)` : 'Delete the edge (Del)' },
          { act: 'lines', icon: 'i-menu', title: 'Lines…: pick the lines the edge carries (L)' },
        ],
      };
    }
    return null;
  }
  // the point halfway along a polyline
  function midpoint(path) {
    const lens = path.slice(1).map((b, i) => Math.hypot(b.x - path[i].x, b.y - path[i].y));
    let half = lens.reduce((a, b) => a + b, 0) / 2;
    for (let i = 0; i < lens.length; i++) {
      if (half <= lens[i]) { const t = lens[i] ? half / lens[i] : 0; return { x: path[i].x + t * (path[i + 1].x - path[i].x), y: path[i].y + t * (path[i + 1].y - path[i].y) }; }
      half -= lens[i];
    }
    return path[0];
  }
  function adorner(g, u) {
    const t = tools();
    if (!t) return;
    const b = TOOL * u, w = t.list.length * b + 4 * u, h = b + 4 * u, gap = TOOL_GAP * u;
    // above the selection, else below it (off the map's top, or under a floating panel: the edit
    // bar, the hint, the legend); within the visible map sideways
    const m = ctm(), view = host.getBoundingClientRect();
    let x = (t.at.x0 + t.at.x1) / 2 - w / 2;
    x = Math.max(x, (view.left + 4 - m.e) / m.a);
    x = Math.min(x, (view.right - 4 - m.e) / m.a - w);
    const panels = [...document.querySelectorAll('.panel, .edit-hint')].filter((p) => !p.hidden).map((p) => p.getBoundingClientRect());
    const sx0 = x * m.a + m.e, sx1 = sx0 + w * m.a;
    const free = (y) => {
      const sy0 = y * m.d + m.f, sy1 = sy0 + h * m.d;
      return sy0 >= view.top + 4 && sy1 <= view.bottom - 4 && !panels.some((r) => r.width && sx0 < r.right && r.left < sx1 && sy0 < r.bottom && r.top < sy1);
    };
    const above = t.at.y0 - gap - h, below = t.at.y1 + gap;
    const y = free(above) || !free(below) ? above : below;
    const a = el('g', { class: 'lm-edit-adorner', role: 'toolbar' }, g);
    el('rect', { x, y, width: w, height: h, rx: 6 * u }, a);
    t.list.forEach((tl, i) => {
      const bx = x + 2 * u + i * b, by = y + 2 * u;
      const btn = el('g', { class: `lm-edit-tool${tl.on ? ' on' : ''}`, 'data-handle': 'tool', 'data-act': tl.act }, a);
      el('title', {}, btn).textContent = tl.title;
      el('rect', { x: bx, y: by, width: b, height: b, rx: 4 * u }, btn);
      const s = 16 * u;
      el('use', { href: `#${tl.icon}`, x: bx + (b - s) / 2, y: by + (b - s) / 2, width: s, height: s }, btn);
    });
  }
  // the container actions that apply to the selection, as adorner buttons
  function containerTools() {
    const p = containerPlan(), out = [];
    if (p.group) out.push({ act: 'group', icon: 'i-group', title: `Group: a new container around them${p.group.parent ? `, in ${groupLabel(p.group.parent)}` : ''}` });
    if (p.merge) out.push({ act: 'merge', icon: 'i-merge', title: `Merge their containers into ${groupLabel(p.merge.keep)} (the one clicked first)` });
    if (p.split) out.push({ act: 'split', icon: 'i-split', title: `Split: they leave ${groupLabel(p.split.from)} for a new container beside it` });
    if (p.ungroup) out.push({ act: 'ungroup', icon: 'i-ungroup', title: `Ungroup: ${groupLabel(p.ungroup.id)} goes, its boxes stay` });
    return out;
  }
  function tool(act) {
    if (containerActs[act]) return containerActs[act]();
    if (act === 'delete') return remove();
    if (act === 'deleteAll') return removeDeep();
    if (act === 'lines') return editLines();
    if (act === 'note') return addNote();
    if (act === 'text') return editText();
    // the menu (main.mjs) is put by the button
    if (act === 'align') return openAlign?.(svg.querySelector('.lm-edit-tool[data-act="align"]'));
    if (act === 'pin' || act === 'unpin') return togglePin();
    if (act === 'resize' && sel?.kind === 'node') sel = { ...sel, mode: sel.mode === 'size' ? 'move' : 'size' };
    if (act === 'resize' && sel?.kind === 'nodes') sel = sel.mode === 'size' ? { kind: 'nodes', ids: sel.ids } : { ...sel, mode: 'size', main: sel.ids[0] };
    if (act === 'resize') {
      draw();
      onChange?.();
    }
  }
  // pin the selected boxes where they are, or unpin them when all are pinned; false when nothing
  // pinnable is selected (a container: what a drag on it moves)
  function togglePin() {
    const ns = (sel?.kind === 'group' && isGroup(sel.id) ? groupLoad(sel.id) : selectedIds()).map(itemOf).filter((n) => n && n.kind !== 'legend');
    if (!ns.length) return false;
    apply(ns.every((n) => n.pinned) ? ns.map((n) => ({ op: 'unpin', id: n.id }))
      : ns.filter((n) => !n.pinned).map((n) => ({ op: 'pos', id: n.id, x: n.x, y: n.y })));
    draw();
    onChange?.();
    return true;
  }
  const edgeG = (e) => svg.querySelector(`g.edge[data-from="${CSS.escape(e.from)}"][data-to="${CSS.escape(e.to)}"]`);
  // While the map is stale: the edges the drag changes, each with a straight stand-in route from
  // where its ends are (the dragged box's centre) through its via points.
  function staleEdges() {
    const out = [];
    if (drag.kind === 'move' || drag.kind === 'size') {
      const centre = (b) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
      const at = (id) => (drag.kind === 'size' ? (id === drag.id ? drag.at : drag.ids.includes(id) ? itemOf(id) : null)
        : drag.orig.has(id) ? dragAt(drag, id) : drag.boxes?.has(id) ? centre(movedBox(drag, id)) : null);
      for (const e of model.edges) {
        const af = at(e.from), bt = at(e.to);
        if (!af && !bt) continue;
        const a = af ?? e.path[0], b = bt ?? e.path.at(-1);
        out.push({ e, pts: [a, ...e.via.map(([x, y]) => ({ x, y })), b] });
      }
    } else if (drag.kind === 'via') {
      const e = edgeOf(drag.from, drag.to);
      if (e) out.push({ e, pts: [e.path[0], ...drag.points.map(([x, y]) => ({ x, y })), e.path.at(-1)] });
    }
    return out;
  }
  // where a move drag has box `id`: where it was, moved as far as the box pressed
  const dragAt = (d, id) => {
    const o = d.orig.get(id), a = d.orig.get(d.id);
    return { x: o.x + d.at.x - a.x, y: o.y + d.at.y - a.y };
  };
  // where a container drag has the box of container `id` (the one dragged or one in it)
  const movedBox = (d, id) => {
    const b = d.boxes.get(id), a = d.orig.get(d.id), dx = d.at.x - a.x, dy = d.at.y - a.y;
    return { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy };
  };
  // the nodes being dragged sit where the pointer put them, also on a map drawn for an earlier spot
  // (a container dragged: its box and those in it too, with their titles)
  function placeDragged() {
    if (drag?.kind !== 'move' || !drag.moved) return;
    for (const id of drag.ids) {
      const n = itemOf(id), g = svg.querySelector(`:is(g.node, g.note)[id="${CSS.escape(id)}"]`);
      if (!n || !g) continue;
      const at = dragAt(drag, id);
      g.setAttribute('transform', `translate(${at.x - n.x} ${at.y - n.y})`);
    }
    for (const id of drag.boxes?.keys() ?? []) {
      const now = groupBox(id), want = movedBox(drag, id);
      if (!now) continue;
      const t = `translate(${want.x0 - now.x0} ${want.y0 - now.y0})`;
      for (const x of svg.querySelectorAll(`g.group[id="${CSS.escape(id)}"], g.group-tab[data-group="${CSS.escape(id)}"]`)) x.setAttribute('transform', t);
    }
  }
  const moveOps = (d) => d.ids.map((id) => ({ op: 'pos', id, ...dragAt(d, id) }));

  // ---------- pointer ----------
  host.addEventListener('pointerdown', (e) => {
    if (!on || !svg || e.button !== 0 || !(e.target instanceof Element)) return;
    const t = e.target;
    const p = toMap(e);
    const start = { x: e.clientX, y: e.clientY };
    const handle = t.closest('[data-handle]');
    const base = getText();
    if (handle?.dataset.handle === 'tool') {
      drag = { kind: 'tool', start, act: handle.dataset.act };
    } else if (adding) {
      e.stopPropagation();
      drag = { kind: 'add', start, p };
    } else if (handle?.dataset.handle === 'via') {
      const ed = edgeOf(handle.dataset.from, handle.dataset.to);
      if (!ed) return;
      drag = { kind: 'via', start, base, from: ed.from, to: ed.to, i: Number(handle.dataset.i), points: ed.via.map((q) => [...q]) };
    } else if (handle?.dataset.handle === 'size' && (sel?.kind === 'node' || (sel?.kind === 'nodes' && sel.mode === 'size'))) {
      // (several boxes: the main one is dragged, the others take its size)
      const id = sel.kind === 'node' ? sel.id : sel.main, n = itemOf(id);
      if (!n) return;
      drag = { kind: 'size', start, base, id, ids: sel.kind === 'nodes' ? [...sel.ids] : [id], dir: handle.dataset.dir, rect: { x0: n.x - n.w / 2, y0: n.y - n.h / 2, x1: n.x + n.w / 2, y1: n.y + n.h / 2 } };
    } else if (handle?.dataset.handle === 'end') {
      const ed = edgeOf(handle.dataset.from, handle.dataset.to);
      if (!ed) return;
      const line = handle.dataset.line || null;
      const strand = line && ed.strands?.find((s) => s.line.id === line);
      const fixed = strand ? (handle.dataset.end === 'from' ? strand.end.p : strand.start.p) : handle.dataset.end === 'from' ? ed.path.at(-1) : ed.path[0];
      drag = { kind: 'end', start, from: ed.from, to: ed.to, line, end: handle.dataset.end, ghost: { a: fixed, b: p } };
    } else if (handle?.dataset.handle === 'connect' && sel?.kind === 'node') {
      const n = itemOf(sel.id);
      drag = { kind: 'connect', start, from: sel.id, ghost: { a: { x: n.x, y: n.y }, b: p } };
    } else if (handle?.dataset.handle === 'connect' && sel?.kind === 'group') {
      // from the container's box: the ghost starts on its right side, by the handle
      const b = groupBox(sel.id);
      if (!b) return;
      drag = { kind: 'connect', start, from: sel.id, ghost: { a: { x: b.x1, y: (b.y0 + b.y1) / 2 }, b: p } };
    } else {
      // a pin mark is pressed like its box: a drag moves it, a click (in end()) unpins it
      const unpin = handle?.dataset.handle === 'pin' ? handle.dataset.id : null;
      const g = unpin ? { id: unpin } : t.closest('g.node, g.note:not(.lm-note-folded)');
      const edge = !g && t.closest('g.edge');
      const tab = !g && !edge && t.closest('g.group-tab');
      const grp = tab ? tab.dataset.group : !g && !edge ? t.closest('g.group')?.id : null;
      if (g && itemOf(g.id) && itemOf(g.id).kind !== 'legend') {
        const n = itemOf(g.id);
        // a box of the selection takes the others along (with Shift, any box does)
        const chosen = selectedIds();
        const ids = chosen.includes(g.id) ? chosen : e.shiftKey ? [...chosen, g.id] : [g.id];
        const orig = new Map(ids.map((id) => [id, { x: itemOf(id).x, y: itemOf(id).y }]));
        drag = { kind: 'move', start, base, id: g.id, ids, orig, shift: e.shiftKey, off: { x: p.x - n.x, y: p.y - n.y }, at: { x: n.x, y: n.y }, unpin };
      } else if (edge) {
        drag = { kind: 'bend', start, base, from: edge.dataset.from, to: edge.dataset.to, p, line: lineAt(edge, e) };
      } else if (!e.shiftKey && grp && sel?.kind === 'group' && isGroup(sel.id) && isGroup(grp) && within(grp, sel.id)) {
        // the selected container (or one in it): a drag moves all it holds, snapped as its first
        // box; a click (end() leaves it to the click handler) selects as a click on it does.
        // (A container not selected pans: see below.)
        const ids = groupLoad(sel.id).filter((id) => itemOf(id) && itemOf(id).kind !== 'legend');
        if (!ids.length) return;
        const first = ids.find((id) => itemOf(id).kind === 'node') ?? ids[0], n = itemOf(first);
        const orig = new Map(ids.map((id) => [id, { x: itemOf(id).x, y: itemOf(id).y }]));
        const boxes = new Map(groupsIn(sel.id).map((id) => [id, groupBox(id)]).filter(([, b]) => b));
        drag = { kind: 'move', start, base, id: first, ids, orig, group: sel.id, boxes, off: { x: p.x - n.x, y: p.y - n.y }, at: { x: n.x, y: n.y } };
      } else if (e.shiftKey && e.pointerType !== 'touch') {
        // Shift on the background: select a rectangle (a click adds a container's boxes)
        drag = { kind: 'box', start, a: p, b: p, shift: true };
      } else {
        // the background, or a container not selected: a pan (a click clears the selection, or
        // selects the container)
        return;
      }
    }
    e.stopPropagation(); // no pan
    e.preventDefault();
    // preventDefault keeps the focus where it was: a toolbar button would then take Enter (and
    // Space) meant for the selection
    const f = document.activeElement;
    if (f && f !== document.body && !host.contains(f)) f.blur();
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag || drag.kind === 'tool') return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y) < DRAG_START) return;
      drag.moved = true;
      host.classList.add('dragging');
      if (drag.kind === 'bend') {
        // a drag on an edge bends it: a new via point where it was pressed, dragged from there
        const ed = edgeOf(drag.from, drag.to);
        if (!ed) { drag = null; return; }
        const i = viaIndex(ed, drag.p);
        drag = { ...drag, kind: 'via', i, points: [...ed.via.slice(0, i), [drag.p.x, drag.p.y], ...ed.via.slice(i)].map((q) => [...q]) };
        sel = { kind: 'via', from: ed.from, to: ed.to, i };
      }
      host.style.setProperty('--drag-cursor', dragCursor(drag));
    }
    const p = toMap(e);
    if (drag.kind === 'move') {
      const at = snap({ x: p.x - drag.off.x, y: p.y - drag.off.y }, e);
      if (at.x === drag.at.x && at.y === drag.at.y) return;
      drag.at = at;
      moved();
      if (drag.group) { /* the container stays selected */ } else if (drag.ids.length > 1) { if (sel?.kind !== 'nodes' || sel.ids.length !== drag.ids.length) selectIds(drag.ids); }
      else if (sel?.kind !== 'node' || sel.id !== drag.id) sel = { kind: 'node', id: drag.id, mode: 'move' };
      placeDragged();
      draw();
      tryPreview(moveOps(drag));
    } else if (drag.kind === 'size') {
      // the sides the handle names follow the pointer; the others stay
      const q = snap(p, e), r = { ...drag.rect }, dir = drag.dir;
      if (dir.includes('w')) r.x0 = Math.min(q.x, r.x1 - MIN_SIZE);
      if (dir.includes('e')) r.x1 = Math.max(q.x, r.x0 + MIN_SIZE);
      if (dir.includes('n')) r.y0 = Math.min(q.y, r.y1 - MIN_SIZE);
      if (dir.includes('s')) r.y1 = Math.max(q.y, r.y0 + MIN_SIZE);
      const size = { w: Math.round(r.x1 - r.x0), h: Math.round(r.y1 - r.y0) };
      const at = { x: Math.round((r.x0 + r.x1) / 2), y: Math.round((r.y0 + r.y1) / 2) };
      if (drag.size && size.w === drag.size.w && size.h === drag.size.h && at.x === drag.at.x && at.y === drag.at.y) return;
      Object.assign(drag, { size, at });
      moved();
      draw();
      tryPreview(sizeOps(drag));
    } else if (drag.kind === 'via') {
      const at = snap(p, e);
      const [x, y] = drag.points[drag.i];
      if (at.x === x && at.y === y) return;
      drag.points[drag.i] = [at.x, at.y];
      moved();
      draw();
      tryPreview({ op: 'via', from: drag.from, to: drag.to, points: drag.points });
    } else if (drag.kind === 'box') {
      drag.b = p;
      draw();
    } else if (drag.ghost) {
      drag.ghost.b = p;
      draw();
    }
  });

  // the cursor a drag keeps until it ends: that of the handle or thing pressed (style.css)
  const RESIZE = { n: 'ns', s: 'ns', e: 'ew', w: 'ew', nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw' };
  const dragCursor = (d) => (d.kind === 'size' ? `${RESIZE[d.dir]}-resize` : d.kind === 'box' || d.kind === 'connect' ? 'crosshair' : d.kind === 'add' ? 'copy' : 'move');

  // every box resized is pinned: the dragged one where the pointer has it, the others at their centres
  const sizeOps = (d) => d.ids.filter((id) => itemOf(id)).flatMap((id) => {
    const at = id === d.id ? d.at : { x: Math.round(itemOf(id).x), y: Math.round(itemOf(id).y) };
    return [{ op: 'size', id, w: d.size.w, h: d.size.h }, { op: 'pos', id, x: at.x, y: at.y }];
  });
  function end(e) {
    if (!drag) return;
    clearTimeout(previewTimer);
    const d = drag;
    drag = null;
    host.classList.remove('dragging');
    if (e.type === 'pointercancel') { if (d.base) cancelPreview(); draw(); return; }
    if (d.kind === 'add') { if (!d.moved) addNodeAt(d.p); return; }
    if (d.kind === 'tool') {
      swallow();
      tool(d.act);
      return;
    }
    if (!d.moved && d.unpin) {
      // a click on a pin mark: unpin that box, the selection stays
      swallow();
      apply({ op: 'unpin', id: d.unpin });
      draw();
      onChange?.();
      return;
    }
    // a click on the selected container: the click handler selects (its boxes, or one in it)
    if (!d.moved && d.group) return;
    if (!d.moved) {
      // a click: select. (The overlay is drawn again on every click, so the browser's dblclick
      // never reaches a handle: a second click on the same via point soon after removes it.)
      const key = d.kind === 'via' ? `${d.from} ${d.to} ${d.i}` : null;
      const twice = key && lastClick?.key === key && performance.now() - lastClick.t < 450;
      lastClick = key && !twice ? { key, t: performance.now() } : null;
      if (twice) { sel = { kind: 'via', from: d.from, to: d.to, i: d.i }; remove(); return; }
      // a click on the selection switches its mode
      const again = sel && sel.kind !== 'via' && (d.kind === 'move' ? sel.id === d.id : sel.from === d.from && sel.to === d.to);
      if (d.kind === 'move' && d.shift) {
        // Shift+click: the box joins the selection, or leaves it
        const ids = selectedIds();
        selectIds(ids.includes(d.id) ? ids.filter((x) => x !== d.id) : [...ids, d.id]);
      } else if (d.kind === 'move' && sel?.kind === 'nodes' && sel.ids.includes(d.id)) {
        // a box of the selection: all of them to size mode (handles on this one), or back to moving
        sel = sel.mode === 'size' ? { kind: 'nodes', ids: sel.ids } : { kind: 'nodes', ids: sel.ids, mode: 'size', main: d.id };
      } else if (d.kind === 'move' && sel?.kind === 'nodes') {
        sel = { kind: 'node', id: d.id, mode: 'move' };
      } else if (d.kind === 'move') {
        const sizable = itemOf(d.id)?.kind !== 'legend';
        sel = { kind: 'node', id: d.id, mode: again && sel.mode !== 'size' && sizable ? 'size' : 'move' };
      } else if (d.kind === 'bend') {
        const many = (edgeOf(d.from, d.to)?.lines.length ?? 0) > 1;
        // the bundle -> the line clicked -> (another line clicked: that one) -> the bundle
        const line = again && many && d.line && sel.kind === 'edge' && sel.line !== d.line ? d.line : null;
        sel = { kind: 'edge', from: d.from, to: d.to, ...(line ? { line } : {}) };
      }
      else if (d.kind === 'via') sel = { kind: 'via', from: d.from, to: d.to, i: d.i };
      else if (d.kind === 'end') sel = { kind: 'edge', from: d.from, to: d.to };
      draw();
      onChange?.();
      return;
    }
    if (d.kind === 'box') {
      const x0 = Math.min(d.a.x, d.b.x), x1 = Math.max(d.a.x, d.b.x), y0 = Math.min(d.a.y, d.b.y), y1 = Math.max(d.a.y, d.b.y);
      const inside = [...model.items.values()].filter((n) => n.kind !== 'legend' && n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1).map((n) => n.id);
      selectIds([...(d.shift ? selectedIds() : []), ...inside]);
      // the click that ends this drag selects nothing else, nor clears the selection
      swallow();
    } else if (d.kind === 'move') {
      if (!apply(moveOps(d))) cancelPreview();
      // the click that ends a container's drag does not select again
      if (d.group) swallow();
    } else if (d.kind === 'size') {
      if (!d.size || !apply(sizeOps(d))) cancelPreview();
    } else if (d.kind === 'via') {
      if (apply({ op: 'via', from: d.from, to: d.to, points: d.points })) sel = { kind: 'via', from: d.from, to: d.to, i: d.i };
      else cancelPreview();
    } else if (d.kind === 'end') {
      const id = targetAt(e.clientX, e.clientY);
      const old = d.end === 'from' ? d.from : d.to;
      if (id && id !== old) {
        const [nf, nt] = d.end === 'from' ? [id, d.to] : [d.from, id];
        const ed = edgeOf(d.from, d.to);
        if (d.line && ed?.lines.length > 1) {
          // only this line: off this edge, onto the new one (added to its lines if it is there)
          const off = lineOff(ed, d.line);
          const there = edgeOf(nf, nt)?.lines.map((l) => l.id) ?? [];
          const ops = [off, there.length ? { op: 'lines', from: nf, to: nt, lines: [...new Set([...there, d.line])] } : { op: 'addEdge', from: nf, to: nt, lines: [d.line] }];
          if (apply(ops, { expect: (f) => carries(d.from, d.to, off.lines)(f) ?? carries(nf, nt, [...new Set([...there, d.line])])(f) })) {
            sel = { kind: 'edge', from: nf, to: nt, line: d.line };
          }
        } else if (apply({ op: 'moveEdge', from: d.from, to: d.to, newFrom: nf, newTo: nt })) sel = { kind: 'edge', from: nf, to: nt };
      }
    } else if (d.kind === 'connect') {
      const id = targetAt(e.clientX, e.clientY);
      if (id && id !== d.from) connect(d.from, id);
    }
    draw();
    onChange?.();
  }
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);

  // in edit mode a click never pins lines or follows a node's link
  host.addEventListener('click', (e) => {
    if (!on) return;
    e.preventDefault();
    e.stopPropagation();
    if (swallowClick) { swallowClick = false; return; }
    if (!(e.target instanceof Element)) return;
    const hit = e.target.closest('[data-handle], g.node, g.note, g.edge');
    if (hit) return;
    // a container (its box or its title): the container; clicked again, the boxes in it; again, the
    // container. With Shift: its boxes added to the selection
    const group = e.target.closest('g.group, g.group-tab');
    const id = group?.classList.contains('group-tab') ? group.dataset.group : group?.id;
    if (id && isGroup(id)) {
      if (e.shiftKey) selectIds([...selectedIds(), ...membersOf(id)]);
      else if (sel?.kind === 'group' && sel.id === id && membersOf(id).length) {
        selectIds(membersOf(id));
        if (sel?.kind === 'nodes') sel.group = id;
      } else sel = { kind: 'group', id };
      draw();
      onChange?.();
    } else if (sel && !e.shiftKey) { sel = null; draw(); onChange?.(); }
  }, true);
  host.addEventListener('dblclick', (e) => {
    if (!on || !svg || !(e.target instanceof Element)) return;
    e.stopPropagation(); // no zoom
    e.preventDefault();
    // a box or note: edit its text (the second click of the two switched it to resizing: back to
    // moving); a container's title: its label
    const box = e.target.closest('g.node, g.note:not(.lm-note-folded)');
    const tab = e.target.closest('g.group-tab'), title = tab ? tab.dataset.group : e.target.closest('g.group > text')?.parentNode.id;
    if (box && !e.target.closest('.lm-edit') && itemOf(box.id) && itemOf(box.id).kind !== 'legend') {
      sel = { kind: 'node', id: box.id, mode: 'move' };
      draw();
      onChange?.();
      editText();
    } else if (title && isGroup(title) && !e.shiftKey) {
      // (its two clicks selected the container, then its boxes: the container again)
      sel = { kind: 'group', id: title };
      draw();
      onChange?.();
      editText({ kind: 'group', id: title });
    } else if (!e.target.closest('g.node, g.note, g.edge, .lm-edit')) {
      addNodeAt(toMap(e));
    }
  });

  return {
    // after every render
    index(el, m) {
      svg = el;
      model = m;
      // a selection whose node or edge is gone
      if (sel?.kind === 'node' && !itemOf(sel.id)) sel = null;
      if (sel?.kind === 'nodes') {
        // boxes gone leave the selection; size mode stays (on the first box when the main one went)
        // (and the container they were selected as, for Ungroup)
        const { mode, main, group } = sel;
        selectIds(sel.ids);
        if (mode === 'size' && sel) sel = sel.kind === 'nodes' ? { ...sel, mode, main: sel.ids.includes(main) ? main : sel.ids[0] } : { ...sel, mode };
        if (group && sel?.kind === 'nodes') sel.group = group;
      }
      if (sel?.kind === 'group' && !isGroup(sel.id)) sel = null;
      if (sel && sel.kind !== 'node' && sel.kind !== 'nodes' && sel.kind !== 'group' && !edgeOf(sel.from, sel.to)) sel = null;
      if (sel?.line && !edgeOf(sel.from, sel.to)?.lines.some((l) => l.id === sel.line)) sel = { kind: 'edge', from: sel.from, to: sel.to };
      if (sel?.kind === 'via' && !edgeOf(sel.from, sel.to)?.via[sel.i]) sel = { kind: 'edge', from: sel.from, to: sel.to };
      // the preview asked for last is the map now
      if (drag?.requested !== undefined) drag.shown = drag.requested;
      draw();
      placeDragged();
    },
    // the view changed: handles keep their size on screen
    view: () => { if (on) draw(); },
    setOn(v) {
      on = v;
      sel = null;
      adding = false;
      host.classList.toggle('editing', on);
      host.classList.remove('adding');
      draw();
      onChange?.();
    },
    on: () => on,
    // the text changed by something other than an edit here
    forget() { undo.length = 0; redo.length = 0; sel = null; onChange?.(); },
    // a text typed in the source sidebar (sourcepanel.mjs), checked already: one undo step
    commitText(text) {
      const cur = getText();
      if (text === cur) return;
      undo.push(cur);
      redo.length = 0;
      commit(text);
      onChange?.();
    },
    undo: () => step(undo, redo),
    redo: () => step(redo, undo),
    canUndo: () => undo.length > 0,
    canRedo: () => redo.length > 0,
    remove,
    // Delete with contents, for the container selected (asks first)
    removeDeep,
    // a container's label (its id when it has none), for the hint
    groupLabel: (id) => (model ? groupLabel(id) : id),
    editLines,
    // the text dialog for the one box, note or container selected (false: nothing to edit); what
    // it would edit (textTarget: { kind: 'node' | 'note' | 'group', id } or null)
    editText: () => editText(),
    textTarget,
    selection: () => sel,
    // select what a statement of the source is about (main.mjs, from the caret in the sidebar):
    // { kind: 'node', id } | { kind: 'edge', from, to } | { kind: 'group', id } (the container
    // itself) | null (nothing). Something not on the map leaves the selection as it is.
    select(t) {
      if (!on || !model) return;
      if (t?.kind === 'node') {
        if (!itemOf(t.id) || itemOf(t.id).kind === 'legend') return;
        selectIds([t.id]);
      } else if (t?.kind === 'edge') {
        if (!edgeOf(t.from, t.to)) return;
        sel = { kind: 'edge', from: t.from, to: t.to };
      } else if (t?.kind === 'group') {
        if (!isGroup(t.id)) return;
        sel = { kind: 'group', id: t.id };
      } else if (!t) {
        if (!sel) return;
        sel = null;
      } else return;
      draw();
      onChange?.();
    },
    // the label of the line selected alone, for the hint
    lineLabel,
    adding: () => adding,
    startAdding() {
      adding = !adding;
      host.classList.toggle('adding', adding);
      onChange?.();
    },
    togglePin,
    // the container actions that apply to the selection (group, merge, split, ungroup), and one done
    containerActions: () => Object.keys(containerPlan()),
    containerAction: (act) => containerActs[act]?.(),
    // align ('left', 'center', 'right', 'top', 'middle', 'bottom') or distribute ('hspace',
    // 'vspace') the boxes selected; how many boxes that takes (0: no several boxes selected)
    align: alignSel,
    arrangeable: () => (arrangeable().length >= 2 ? arrangeable().length : 0),
    // unpin every node and note: the layout places them
    unpinAll() {
      const ops = [...model.items.values()].filter((n) => n.pinned && n.kind !== 'legend').map((n) => ({ op: 'unpin', id: n.id }));
      if (!ops.length) { toast('Nothing is pinned'); return; }
      if (apply(ops)) toast(`Unpinned ${ops.length} item${ops.length === 1 ? '' : 's'}`);
    },
    // pin every node and note where it is now
    pinAll() {
      const ops = [...model.items.values()].filter((n) => !n.pinned && n.kind !== 'legend').map((n) => ({ op: 'pos', id: n.id, x: n.x, y: n.y }));
      if (!ops.length) { toast('Every node and note is pinned already'); return; }
      if (apply(ops)) toast(`Pinned ${ops.length} item${ops.length === 1 ? '' : 's'}`);
    },
    // Escape: stop adding, else drop the selection; false when there was nothing to drop
    escape() {
      if (drag) { clearTimeout(previewTimer); const d = drag; drag = null; host.classList.remove('dragging'); if (d.base && d.moved) cancelPreview(); draw(); return true; }
      if (adding) { adding = false; host.classList.remove('adding'); onChange?.(); return true; }
      // a mode of the selection: back to the plain one
      if (sel?.line || sel?.mode === 'size') {
        sel = sel.line ? { kind: 'edge', from: sel.from, to: sel.to } : sel.kind === 'nodes' ? { kind: 'nodes', ids: sel.ids } : { ...sel, mode: 'move' };
        draw(); onChange?.(); return true;
      }
      if (sel) { sel = null; draw(); onChange?.(); return true; }
      return false;
    },
  };
}

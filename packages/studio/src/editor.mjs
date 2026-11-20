// Edit mode: change the flow right on the map. Drag a node or note to move it (it gets a `pos`);
// drag an edge to bend it through a new via point, drag a via point to move it, double-click it
// (or select it and press Delete) to remove it; drag an end of a selected edge onto another node
// or container to reattach it; drag the handle beside a selected node onto another to connect
// them; double-click the background (or use Add node) to add a node; Delete removes the selection.
// Every change is an editDot op on the flow's text, laid out by check(text) (an error refuses it)
// and handed to commit(text); while something is dragged, preview(text) draws the map as it would
// be, without keeping it. A box may not land on another box, nor on a container it is not in. Undo and redo step through the texts committed here; any other change of the text
// (a reload, another file) forgets them.
// The overlay (selection, handles) is drawn into the map's SVG in map units, after every render;
// handles keep their size on screen.
import { editDot, parseFlow } from '@linemap/core';

const NS = 'http://www.w3.org/2000/svg';
const SNAP = 10;        // positions snap to this grid (Alt: no snapping)
const DRAG_START = 4;   // screen px before a press becomes a drag
const HANDLE = 6;       // handle radius, screen px

export function createEditor({ host, getText, commit, check, preview, cancelPreview, toast, askLabel, askLines, onChange }) {
  let on = false;
  let svg = null, model = null;
  let sel = null;    // { kind: 'node', id } | { kind: 'edge', from, to } | { kind: 'via', from, to, i }
  let drag = null;
  let adding = false; // Add node: the next click on the map places one
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

  // Would item `id` at `at` sit on another box, or on a container it is not in? Its rectangle with
  // a margin, against the boxes and containers drawn now.
  function blocked(id, at) {
    const n = itemOf(id);
    const m = 8;
    const r = { x0: at.x - n.w / 2 - m, y0: at.y - n.h / 2 - m, x1: at.x + n.w / 2 + m, y1: at.y + n.h / 2 + m };
    const hit = (b) => r.x0 < b.x1 && b.x0 < r.x1 && r.y0 < b.y1 && b.y0 < r.y1;
    for (const o of model.items.values()) {
      if (o.id === id || o.kind === 'legend') continue;
      if (hit({ x0: o.x - o.w / 2, y0: o.y - o.h / 2, x1: o.x + o.w / 2, y1: o.y + o.h / 2 })) return true;
    }
    const homes = new Set();
    for (let g = n.group; g; g = model.groups.find((x) => x.id === g)?.parent) homes.add(g);
    // a note may sit inside the containers of its node
    if (n.kind === 'note' && n.attach) for (let g = itemOf(n.attach)?.group; g; g = model.groups.find((x) => x.id === g)?.parent) homes.add(g);
    for (const g of svg.querySelectorAll('g.group')) {
      if (homes.has(g.id)) continue;
      const b = g.querySelector('rect')?.getBBox();
      if (b && hit({ x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height })) return true;
    }
    return false;
  }

  // ---------- changes ----------
  function apply(ops, { quiet = false } = {}) {
    const text = getText();
    let next;
    try {
      next = editDot(text, ops);
      parseFlow(next);
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
  const tryPreview = (ops) => {
    try { preview(editDot(drag.base, ops)); } catch { /* shown on release */ }
  };
  function step(from, to) {
    if (!from.length) return;
    const text = getText();
    to.push(text);
    commit(from.pop());
    sel = null;
    onChange?.();
  }

  function remove() {
    if (!sel) return;
    if (sel.kind === 'node') apply({ op: 'removeNode', id: sel.id });
    else if (sel.kind === 'edge') apply({ op: 'removeEdge', from: sel.from, to: sel.to });
    else if (sel.kind === 'via') {
      const e = edgeOf(sel.from, sel.to);
      if (e) apply({ op: 'via', from: e.from, to: e.to, points: e.via.filter((_, i) => i !== sel.i) });
    }
    sel = null;
    draw();
    onChange?.();
  }

  // an id from a label: lower case, words joined by _, unique among nodes, containers and lines
  function newId(label) {
    const base = label.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'node';
    const stem = /^[a-z_]/.test(base) ? base : `n_${base}`;
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
    if (apply({ op: 'addNode', id, label, x: at.x, y: at.y, group: containerAt(p) ?? undefined })) sel = { kind: 'node', id };
  }
  async function connect(from, to) {
    const a = itemOf(from), b = itemOf(to);
    let lines = [];
    // an edge to or from a note attaches it; any other carries lines
    if (a?.kind !== 'note' && b?.kind !== 'note') {
      const carried = new Set(model.edges.filter((e) => e.from === from || e.to === from).flatMap((e) => e.lines.map((l) => l.id)));
      lines = await askLines(model.lines, carried, `${a?.label ?? from} → ${b?.label ?? model.groups.find((g) => g.id === to)?.label ?? to}`);
      if (!lines?.length) return;
    }
    if (apply({ op: 'addEdge', from, to, lines })) sel = { kind: 'edge', from, to };
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
    if (!on) return;
    const u = unit(), r = HANDLE * u;
    const g = el('g', { class: 'lm-edit' }, svg);
    if (sel?.kind === 'node' && itemOf(sel.id)) {
      // (while it is dragged: where the pointer has it)
      const n = drag?.kind === 'move' && drag.moved && drag.id === sel.id ? { ...itemOf(sel.id), ...drag.at } : itemOf(sel.id);
      const pad = 6 * u;
      el('rect', { class: 'lm-edit-sel', x: n.x - n.w / 2 - pad, y: n.y - n.h / 2 - pad, width: n.w + 2 * pad, height: n.h + 2 * pad, rx: 8 * u }, g);
      if (n.kind !== 'legend') {
        const c = el('g', { class: 'lm-edit-handle lm-edit-connect', 'data-handle': 'connect' }, g);
        const cx = n.x + n.w / 2 + pad + 14 * u;
        el('circle', { cx, cy: n.y, r: r * 1.5 }, c);
        el('path', { d: `M${cx - r * 0.8},${n.y}H${cx + r * 0.8}M${cx},${n.y - r * 0.8}V${n.y + r * 0.8}`, class: 'lm-edit-plus' }, c);
      }
    }
    for (const e of model.edges) {
      const picked = sel && sel.kind !== 'node' && sel.from === e.from && sel.to === e.to;
      if (picked) {
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
    if (drag?.ghost) el('path', { d: `M${drag.ghost.a.x},${drag.ghost.a.y}L${drag.ghost.b.x},${drag.ghost.b.y}`, class: 'lm-edit-ghost' }, g);
    if (drag?.kind === 'via' && drag.moved) {
      const [x, y] = drag.points[drag.i];
      const s = 1.2 * r;
      el('rect', { x: x - s, y: y - s, width: 2 * s, height: 2 * s, transform: `rotate(45 ${x} ${y})`, class: 'lm-edit-handle lm-edit-via on' }, g);
    }
  }
  // a node being dragged sits where the pointer put it, also on a map drawn for an earlier spot
  function placeDragged() {
    if (drag?.kind !== 'move' || !drag.moved) return;
    const n = itemOf(drag.id), g = [...svg.querySelectorAll('g.node, g.note')].find((x) => x.id === drag.id);
    if (n && g) {
      g.setAttribute('transform', `translate(${drag.at.x - n.x} ${drag.at.y - n.y})`);
      g.classList.toggle('lm-edit-bad', !!drag.bad);
    }
  }

  // ---------- pointer ----------
  host.addEventListener('pointerdown', (e) => {
    if (!on || !svg || e.button !== 0 || !(e.target instanceof Element)) return;
    const t = e.target;
    const p = toMap(e);
    const start = { x: e.clientX, y: e.clientY };
    const handle = t.closest('[data-handle]');
    const base = getText();
    if (adding) {
      e.stopPropagation();
      drag = { kind: 'add', start, p };
    } else if (handle?.dataset.handle === 'via') {
      const ed = edgeOf(handle.dataset.from, handle.dataset.to);
      if (!ed) return;
      drag = { kind: 'via', start, base, from: ed.from, to: ed.to, i: Number(handle.dataset.i), points: ed.via.map((q) => [...q]) };
    } else if (handle?.dataset.handle === 'end') {
      const ed = edgeOf(handle.dataset.from, handle.dataset.to);
      if (!ed) return;
      const fixed = handle.dataset.end === 'from' ? ed.path.at(-1) : ed.path[0];
      drag = { kind: 'end', start, from: ed.from, to: ed.to, end: handle.dataset.end, ghost: { a: fixed, b: p } };
    } else if (handle?.dataset.handle === 'connect' && sel?.kind === 'node') {
      const n = itemOf(sel.id);
      drag = { kind: 'connect', start, from: sel.id, ghost: { a: { x: n.x, y: n.y }, b: p } };
    } else {
      const g = t.closest('g.node, g.note:not(.lm-note-folded)');
      const edge = !g && t.closest('g.edge');
      if (g && itemOf(g.id) && itemOf(g.id).kind !== 'legend') {
        const n = itemOf(g.id);
        drag = { kind: 'move', start, base, id: g.id, off: { x: p.x - n.x, y: p.y - n.y }, at: { x: n.x, y: n.y } };
      } else if (edge) {
        drag = { kind: 'bend', start, base, from: edge.dataset.from, to: edge.dataset.to, p };
      } else {
        return; // the background: a pan, and a click clears the selection
      }
    }
    e.stopPropagation(); // no pan
    e.preventDefault();
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
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
    }
    const p = toMap(e);
    if (drag.kind === 'move') {
      const at = snap({ x: p.x - drag.off.x, y: p.y - drag.off.y }, e);
      if (at.x === drag.at.x && at.y === drag.at.y) return;
      drag.at = at;
      drag.bad = blocked(drag.id, at);
      sel = { kind: 'node', id: drag.id };
      placeDragged();
      draw();
      if (!drag.bad) tryPreview({ op: 'pos', id: drag.id, x: at.x, y: at.y });
    } else if (drag.kind === 'via') {
      const at = snap(p, e);
      const [x, y] = drag.points[drag.i];
      if (at.x === x && at.y === y) return;
      drag.points[drag.i] = [at.x, at.y];
      draw();
      tryPreview({ op: 'via', from: drag.from, to: drag.to, points: drag.points });
    } else if (drag.ghost) {
      drag.ghost.b = p;
      draw();
    }
  });

  function end(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    host.classList.remove('dragging');
    if (e.type === 'pointercancel') { if (d.base) cancelPreview(); draw(); return; }
    if (d.kind === 'add') { if (!d.moved) addNodeAt(d.p); return; }
    if (!d.moved) {
      // a click: select. (The overlay is drawn again on every click, so the browser's dblclick
      // never reaches a handle: a second click on the same via point soon after removes it.)
      const key = d.kind === 'via' ? `${d.from} ${d.to} ${d.i}` : null;
      const twice = key && lastClick?.key === key && performance.now() - lastClick.t < 450;
      lastClick = key && !twice ? { key, t: performance.now() } : null;
      if (twice) { sel = { kind: 'via', from: d.from, to: d.to, i: d.i }; remove(); return; }
      if (d.kind === 'move') sel = { kind: 'node', id: d.id };
      else if (d.kind === 'bend') sel = { kind: 'edge', from: d.from, to: d.to };
      else if (d.kind === 'via') sel = { kind: 'via', from: d.from, to: d.to, i: d.i };
      else if (d.kind === 'end') sel = { kind: 'edge', from: d.from, to: d.to };
      draw();
      onChange?.();
      return;
    }
    if (d.kind === 'move') {
      if (d.bad) toast('A box cannot sit on another box, or on a container it is not part of');
      if (d.bad || !apply({ op: 'pos', id: d.id, x: d.at.x, y: d.at.y })) cancelPreview();
    } else if (d.kind === 'via') {
      if (apply({ op: 'via', from: d.from, to: d.to, points: d.points })) sel = { kind: 'via', from: d.from, to: d.to, i: d.i };
      else cancelPreview();
    } else if (d.kind === 'end') {
      const id = targetAt(e.clientX, e.clientY);
      const old = d.end === 'from' ? d.from : d.to;
      if (id && id !== old) {
        const [nf, nt] = d.end === 'from' ? [id, d.to] : [d.from, id];
        if (apply({ op: 'moveEdge', from: d.from, to: d.to, newFrom: nf, newTo: nt })) sel = { kind: 'edge', from: nf, to: nt };
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
    if (!(e.target instanceof Element)) return;
    const hit = e.target.closest('[data-handle], g.node, g.note, g.edge');
    if (!hit && sel) { sel = null; draw(); onChange?.(); }
  }, true);
  host.addEventListener('dblclick', (e) => {
    if (!on || !svg || !(e.target instanceof Element)) return;
    e.stopPropagation(); // no zoom
    e.preventDefault();
    if (!e.target.closest('g.node, g.note, g.edge, .lm-edit')) {
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
      if (sel && sel.kind !== 'node' && !edgeOf(sel.from, sel.to)) sel = null;
      if (sel?.kind === 'via' && !edgeOf(sel.from, sel.to)?.via[sel.i]) sel = { kind: 'edge', from: sel.from, to: sel.to };
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
    undo: () => step(undo, redo),
    redo: () => step(redo, undo),
    canUndo: () => undo.length > 0,
    canRedo: () => redo.length > 0,
    remove,
    selection: () => sel,
    adding: () => adding,
    startAdding() {
      adding = !adding;
      host.classList.toggle('adding', adding);
      onChange?.();
    },
    // pin every node and note where it is now
    pinAll() {
      const ops = [...model.items.values()].filter((n) => !n.pinned && n.kind !== 'legend').map((n) => ({ op: 'pos', id: n.id, x: n.x, y: n.y }));
      if (!ops.length) { toast('Every node and note is pinned already'); return; }
      if (apply(ops)) toast(`Pinned ${ops.length} item${ops.length === 1 ? '' : 's'}`);
    },
    // Escape: stop adding, else drop the selection; false when there was nothing to drop
    escape() {
      if (drag) { const d = drag; drag = null; host.classList.remove('dragging'); if (d.base && d.moved) cancelPreview(); draw(); return true; }
      if (adding) { adding = false; host.classList.remove('adding'); onChange?.(); return true; }
      if (sel) { sel = null; draw(); onChange?.(); return true; }
      return false;
    },
  };
}

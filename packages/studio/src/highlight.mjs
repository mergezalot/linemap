// Hover and click on the map: focus lines (dim the rest), pin them (click a line or a node), open
// node links (ctrl- or cmd-click), tooltips for lines, nodes, notes, bundles and container
// titles. With notes off each note is a badge in its node: hovering it shows the text, a click
// keeps the note open beside the badge, a click on the badge or the open note folds it again. Indexes are built once per render; pointer events are delegated to the map host and only
// touch the DOM when what is under the pointer changes.
import { esc } from './tooltip.mjs';

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

export function createHighlight({ host, tooltip, isPanning, onPinChange }) {
  let svg = null;
  let ix = null;           // indexes of the current render, see index()
  let hover = new Set();   // lines focused by the pointer (map or legend)
  let hoverNode = null;    // node id under the pointer
  let pinned = new Set();  // lines focused by a click
  let opened = new Set();  // folded notes kept open by a click
  let lit = new Set();     // elements that have .on now
  let last = { target: null, key: null, html: null };

  // ---------- indexes ----------
  function index(el, model) {
    svg = el;
    lit = new Set();
    // native <title> tooltips would show next to ours
    for (const t of svg.querySelectorAll('title')) t.remove();

    const byLine = new Map();
    for (const e of svg.querySelectorAll('[data-line]')) {
      const id = e.getAttribute('data-line');
      if (!byLine.has(id)) byLine.set(id, []);
      byLine.get(id).push(e);
    }
    const nodeEls = new Map();
    const nodes = new Map(model.nodes.map((n) => [n.id, n]));
    for (const g of svg.querySelectorAll('g.node')) nodeEls.set(g.id, g);
    // lines in and out of every node or container, and the nodes each line touches
    const io = new Map();
    const lineNodes = new Map();
    const ioOf = (id) => { if (!io.has(id)) io.set(id, { in: new Set(), out: new Set() }); return io.get(id); };
    for (const e of model.edges) {
      for (const l of e.lines) {
        ioOf(e.from).out.add(l.id);
        ioOf(e.to).in.add(l.id);
        if (!lineNodes.has(l.id)) lineNodes.set(l.id, new Set());
        lineNodes.get(l.id).add(e.from).add(e.to);
      }
    }
    const groups = new Map(model.groups.map((g) => [g.id, g]));
    // members of each container, nested ones included
    const members = new Map(model.groups.map((g) => [g.id, { nodes: 0, groups: 0 }]));
    for (const n of model.nodes) for (let g = n.group; g; g = groups.get(g)?.parent) members.get(g).nodes++;
    for (const c of model.groups) for (let g = c.parent; g; g = groups.get(g)?.parent) members.get(g).groups++;

    // notes as badges (notes off)
    const noteEls = new Map();
    for (const g of svg.querySelectorAll('g.note.lm-note-folded')) noteEls.set(g.id, g);

    ix = {
      byLine, nodeEls, nodes, io, lineNodes, groups, members, noteEls,
      notes: new Map([...model.notes, ...model.hiddenNotes].map((n) => [n.id, n])),
      lines: new Map(model.lines.map((l) => [l.id, l])),
      label: (id) => nodes.get(id)?.label ?? model.items.get(id)?.label ?? groups.get(id)?.label ?? id,
    };
    // pinned lines that are still drawn stay pinned
    pinned = new Set([...pinned].filter((id) => byLine.has(id)));
    // notes kept open stay open while notes are off; showing every note forgets them
    opened = new Set([...opened].filter((id) => noteEls.has(id)));
    for (const id of opened) open(noteEls.get(id), true);
    hover = new Set();
    hoverNode = null;
    last = { target: null, key: null, html: null };
    tooltip.hide();
    paint();
  }

  // ---------- focus ----------
  function paint() {
    if (!svg) return;
    const lines = new Set([...pinned, ...hover]);
    const next = new Set();
    for (const id of lines) {
      for (const e of ix.byLine.get(id) ?? []) next.add(e);
      for (const n of ix.lineNodes.get(id) ?? []) if (ix.nodeEls.has(n)) next.add(ix.nodeEls.get(n));
    }
    if (hoverNode && ix.nodeEls.has(hoverNode)) next.add(ix.nodeEls.get(hoverNode));
    for (const e of lit) if (!next.has(e)) e.classList.remove('on');
    for (const e of next) if (!lit.has(e)) e.classList.add('on');
    lit = next;
    svg.classList.toggle('focus', lines.size > 0);
  }

  const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  function setHover(lines, node = null) {
    const next = new Set(lines ?? []);
    if (same(next, hover) && node === hoverNode) return;
    hover = next;
    hoverNode = node;
    paint();
  }

  function setPinned(next) {
    pinned = next;
    paint();
    onPinChange?.([...pinned]);
  }

  // ---------- tooltips ----------
  const dot = (l) => `<span class="dot" style="background:${esc(l.color)}"></span>`;
  const lineList = (ids) => `<span class="tt-lines">${[...ids].map((id) => ix.lines.get(id)).filter(Boolean)
    .sort((a, b) => a.index - b.index).map((l) => `<span class="tt-line">${dot(l)}${esc(l.label)}</span>`).join('')}</span>`;
  const linkRow = (url) => (url ? `<div class="tt-url">${esc(url)}</div>` : '');
  const linkHint = (url) => (url ? `${MOD}-click to open the link` : '');
  const row = (k, ids) => (ids.size ? `<div class="tt-row"><span class="k">${k}</span>${lineList(ids)}</div>` : '');

  function lineTip(id, target) {
    const l = ix.lines.get(id);
    if (!l) return null;
    const edge = target.closest('g.edge');
    const node = target.closest('g.node');
    const where = edge ? `${ix.label(edge.getAttribute('data-from'))} → ${ix.label(edge.getAttribute('data-to'))}`
      : node ? `through ${ix.label(node.id)}` : '';
    const hint = pinned.has(id) ? 'Click to unpin' : 'Click to pin · Shift-click to add';
    return `<div class="tt-head">${dot(l)}<span class="tt-title">${esc(l.label)}</span>${l.label !== l.id ? `<span class="tt-id">${esc(l.id)}</span>` : ''}</div>` +
      (where ? `<div class="tt-sub">${esc(where.replace(/\n/g, ' '))}</div>` : '') + `<div class="tt-hint">${hint}</div>`;
  }

  function nodeTip(g) {
    const n = ix.nodes.get(g.id);
    if (!n) return null;
    const { in: ins, out } = ix.io.get(n.id) ?? { in: new Set(), out: new Set() };
    const group = n.group ? ix.groups.get(n.group)?.label : null;
    const sub = [n.shape, group ? `in ${group}` : '', n.through ? 'lines through' : ''].filter(Boolean)
      .map((s) => esc(s.replace(/\n/g, ' '))).join(' · ');
    const lines = nodeLines(n.id);
    const only = lines.length && pinned.size === lines.length && lines.every((id) => pinned.has(id));
    const hint = !lines.length ? '' : only ? 'Click to unpin its lines' : 'Click to pin its lines · Shift-click to add';
    const all = [hint, linkHint(n.url)].filter(Boolean).join(' · ');
    return `<div class="tt-title">${esc(n.label)}</div><div class="tt-sub">${sub}</div>` + linkRow(n.url) +
      row('In', ins) + row('Out', out) + (all ? `<div class="tt-hint">${all}</div>` : '');
  }

  // a shown note has a tooltip only for its link; a folded one shows its text, until kept open
  function noteTip(g) {
    const n = ix.notes.get(g.id);
    if (!n) return null;
    if (!ix.noteEls.has(n.id)) return n.url ? linkRow(n.url) + `<div class="tt-hint">${linkHint(n.url)}</div>` : null;
    const text = opened.has(n.id) ? '' : `<div class="tt-note">${esc(n.label)}</div>`;
    const link = n.url ? linkRow(n.url) + `<div class="tt-hint">${linkHint(n.url)}</div>` : '';
    return text + link || null;
  }

  // an open note goes on top of everything, other badges and open notes included
  function open(g, on) {
    g.classList.toggle('lm-open', on);
    if (on) g.parentNode.appendChild(g);
  }
  function toggleNote(id) {
    const on = !opened.has(id);
    on ? opened.add(id) : opened.delete(id);
    open(ix.noteEls.get(id), on);
  }

  function nodeLines(id) {
    const { in: ins, out } = ix.io.get(id) ?? { in: [], out: [] };
    return [...new Set([...ins, ...out])];
  }

  function bundleTip(g) {
    const ids = (g.getAttribute('data-lines') ?? '').split(' ').filter(Boolean);
    const label = g.getAttribute('data-label');
    return `<div class="tt-title">${esc(ix.label(g.getAttribute('data-from')))} → ${esc(ix.label(g.getAttribute('data-to')))}</div>` +
      (label ? `<div class="tt-sub">“${esc(label.replace(/\n/g, ' '))}”</div>` : '') + row('Lines', new Set(ids));
  }

  function groupTip(g) {
    const grp = ix.groups.get(g.id);
    if (!grp) return null;
    const m = ix.members.get(g.id);
    const count = [`${m.nodes} node${m.nodes === 1 ? '' : 's'}`, m.groups ? `${m.groups} container${m.groups === 1 ? '' : 's'}` : '']
      .filter(Boolean).join(', ');
    const { in: ins, out } = ix.io.get(g.id) ?? { in: new Set(), out: new Set() };
    const parent = grp.parent ? ix.groups.get(grp.parent)?.label : null;
    return `<div class="tt-title">${esc(grp.label)}</div><div class="tt-sub">container · ${esc(count)}${parent ? ` · in ${esc(parent)}` : ''}</div>` +
      row('In', ins) + row('Out', out);
  }

  // What is under the pointer: { key, lines, node, html } or null.
  function resolve(target) {
    if (!ix || !(target instanceof Element)) return null;
    const lineEl = target.closest('[data-line]');
    if (lineEl) {
      const id = lineEl.getAttribute('data-line');
      const ctx = target.closest('g.edge, g.node');
      return { key: `line ${id} ${ctx?.id || ctx?.getAttribute('data-from') + '>' + ctx?.getAttribute('data-to')}`, lines: [id], html: () => lineTip(id, lineEl) };
    }
    const edge = target.closest('g.edge');
    if (edge) {
      return { key: `edge ${edge.getAttribute('data-from')}>${edge.getAttribute('data-to')}`,
        lines: (edge.getAttribute('data-lines') ?? '').split(' ').filter(Boolean), html: () => bundleTip(edge) };
    }
    const node = target.closest('g.node');
    if (node) return { key: `node ${node.id}`, lines: nodeLines(node.id), node: node.id, html: () => nodeTip(node) };
    const note = target.closest('g.note.lm-note-folded, g.note[data-url]');
    if (note) return { key: `note ${note.id}${opened.has(note.id) ? ' open' : ''}`, lines: [], html: () => noteTip(note) };
    // a container's title: inside its box, or on a tab (themes with tabs draw those above the lines)
    const tab = target.closest('g.group-tab');
    const title = tab ? { id: tab.getAttribute('data-group') } : target.closest('g.group > text')?.parentNode;
    if (title) return { key: `group ${title.id}`, lines: [], html: () => groupTip(title) };
    return null;
  }

  host.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    if (isPanning()) { leave(); return; }
    if (e.target !== last.target) {
      last.target = e.target;
      const hit = resolve(e.target);
      const key = hit?.key ?? null;
      if (key !== last.key) {
        last.key = key;
        last.html = hit ? hit.html() : null;
        setHover(hit?.lines, hit?.node ?? null);
      }
    }
    if (last.html) tooltip.show(last.html, e.clientX, e.clientY);
    else tooltip.hide();
  });
  function leave() {
    if (last.key === null && !hover.size) return;
    last = { target: null, key: null, html: null };
    tooltip.hide();
    setHover(null);
  }
  host.addEventListener('pointerleave', leave);

  host.addEventListener('click', (e) => {
    if (!ix || !(e.target instanceof Element)) return;
    // node links: a plain click pins as everywhere else, ctrl- or cmd-click opens the link
    const a = e.target.closest('a[href]');
    if (a) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { window.open(a.getAttribute('href'), '_blank', 'noopener'); return; }
    }
    const note = e.target.closest('g.note.lm-note-folded');
    if (note && ix.noteEls.has(note.id)) {
      toggleNote(note.id);
      // the tooltip changes with it (the text while folded, the hint), and the element under the
      // pointer changes from the icon to the note or back
      last = { target: null, key: null, html: null };
      if (e.pointerType !== 'touch') {
        last.key = `note ${note.id}${opened.has(note.id) ? ' open' : ''}`;
        last.html = noteTip(note);
        tooltip.show(last.html, e.clientX, e.clientY);
      }
      return;
    }
    const lineEl = e.target.closest('[data-line]');
    if (lineEl) {
      const id = lineEl.getAttribute('data-line');
      const next = new Set(e.shiftKey ? pinned : []);
      if (pinned.has(id) && (e.shiftKey || pinned.size === 1)) next.delete(id); else next.add(id);
      setPinned(next);
      // the hint in the tooltip changed (pin / unpin)
      if (last.key?.startsWith('line ')) { last.html = lineTip(id, lineEl); tooltip.show(last.html, e.clientX, e.clientY); }
      return;
    }
    const node = e.target.closest('g.node');
    if (node) {
      const ids = nodeLines(node.id);
      if (!ids.length) return;
      const all = ids.every((id) => pinned.has(id));
      let next;
      if (e.shiftKey) {
        next = new Set(pinned);
        for (const id of ids) all ? next.delete(id) : next.add(id);
      } else next = all && pinned.size === ids.length ? new Set() : new Set(ids);
      setPinned(next);
      if (last.key === `node ${node.id}`) { last.html = nodeTip(node); tooltip.show(last.html, e.clientX, e.clientY); }
      return;
    }
    if (!e.target.closest('g.edge, g.note') && pinned.size) setPinned(new Set());
  });

  return {
    index,
    // legend hover
    hoverLines: (ids) => { if (!last.key) setHover(ids); },
    pin: (ids) => setPinned(new Set(ids.filter((id) => ix?.byLine.has(id)))),
    clearPins: () => { if (pinned.size) setPinned(new Set()); },
    // folds every note kept open
    foldNotes: () => { for (const id of [...opened]) toggleNote(id); },
    openNotes: () => [...opened],
    pinned: () => [...pinned],
    leave,
    // map rectangle covered by a line's drawn elements
    lineBox(id) {
      const els = ix?.byLine.get(id);
      if (!els?.length) return null;
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const e of els) {
        const b = e.getBBox();
        x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    },
    flash(el) {
      if (!el) return;
      el.classList.remove('flash');
      void el.getBoundingClientRect(); // restart the animation
      el.classList.add('flash');
      el.addEventListener('animationend', () => el.classList.remove('flash'), { once: true });
    },
  };
}

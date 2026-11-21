// Edits to a flow's DOT text, for the studio's edit mode. Each change is spliced into the text at
// the offsets the DOT parser reports, so comments, layout, quoting and attribute order stay as
// written and a diff shows only the change. Ops (ids are DOT ids; points are px, y down, as `pos`):
//   { op: 'pos', id, x, y }                           pin a node or note there
//   { op: 'unpin', id }                               its pos goes from every statement of it (a
//                                                     statement that set only the pos goes too); no
//                                                     pos: nothing changes
//   { op: 'via', from, to, points: [[x, y], ...] }    the edge's via points; [] removes them
//   { op: 'addNode', id, x, y, label, shape, group }  a new node, in container `group` (a cluster
//                                                     id) if given; pinned at x, y if given, else
//                                                     the layout places it; label, shape optional; a
//                                                     label may have line breaks (written as `\n`)
//   { op: 'removeNode', id }                          the node and every edge to or from it
//   { op: 'addEdge', from, to, lines: [ids] }         lines [] or none: a note's attachment
//   { op: 'removeEdge', from, to }
//   { op: 'moveEdge', from, to, newFrom, newTo }      the same edge (lines, label, via), new ends
//   { op: 'size', id, w, h }                          a node's or note's size, px (written in inches)
//   { op: 'lines', from, to, lines: [ids] }           the lines the edge carries, at least one
// Containers (cluster subgraphs). A node is in the deepest cluster it is mentioned in, so moving
// it moves its mentions: its node statements go into the new container, and its edges written in
// a container it leaves go to the deepest container both ends share (an end that stays keeps a bare
// mention where it was). A note moves with the node it is attached to. Node and edge defaults
// (`node [...]`) are those where the statement is written now.
//   { op: 'addGroup', id, label, parent }             an empty container (id starts with `cluster`)
//                                                     at the end of container `parent`, or the top
//   { op: 'group', id, label, ids, parent }           a new container holding the nodes `ids`; id:
//                                                     `cluster_<id>`, unless it starts with cluster
//   { op: 'moveTo', ids, group }                      the nodes into container `group` (none: the
//                                                     top of the graph); a container left empty stays
//   { op: 'removeGroup', id }                         the container goes, its statements are written
//                                                     in its parent (members and nested containers
//                                                     move there); edges to its box go. If it sets
//                                                     node or edge defaults it stays a plain subgraph
// editDot checks only what it needs to place a change; parseFlow on the result says whether the
// flow is still valid (a loop, a label conflict, an unknown line).
import { parse } from '@ts-graphviz/ast';
import { readDot } from './dot.mjs';

export function editDot(text, ops) {
  for (const op of Array.isArray(ops) ? ops : [ops]) {
    const fn = OPS[op?.op];
    if (!fn) throw new Error(`editDot: unknown op "${op?.op}"`);
    const out = fn(scan(text), op);
    // an op may be made of other ops, each applied to the text the one before left
    text = out.ops ? editDot(text, out.ops) : apply(text, out);
  }
  return text;
}

// ---------- reading ----------

// Statements outside `subgraph lines`, each with the body (graph or subgraph) it is written in.
// body.chain: the clusters around it, outermost first.
function scan(text) {
  const graph = parse(text).children.find((c) => c.type === 'Graph');
  if (!graph) throw new Error('no graph in DOT file');
  const doc = { text, graph: null, bodies: [], stmts: [] };
  const visit = (node, chain, inLines) => {
    const body = { node, chain, cluster: chain.at(-1) ?? null };
    doc.bodies.push(body);
    for (const c of node.children) {
      if (c.type === 'Subgraph') {
        const id = c.id?.value;
        if (inLines || (id === 'lines' && !body.cluster)) visit(c, chain, true);
        else visit(c, id?.startsWith('cluster') ? [...chain, id] : chain, false);
      } else if (inLines) {
        continue;
      } else if (c.type === 'Node') {
        doc.stmts.push({ s: c, body, kind: 'node', id: c.id.value });
      } else if (c.type === 'Edge') {
        const ends = c.targets.map((t) => (t.type === 'NodeRef' ? [t.id.value]
          : t.type === 'NodeRefGroup' ? t.children.filter((x) => x.type === 'NodeRef').map((x) => x.id.value) : []));
        doc.stmts.push({ s: c, body, kind: 'edge', ends });
      }
    }
    return body;
  };
  doc.graph = visit(graph, [], false);
  return doc;
}

const pairsOf = (st) => {
  const out = [];
  for (let i = 1; i < st.ends.length; i++) for (const a of st.ends[i - 1]) for (const b of st.ends[i]) out.push([a, b]);
  return out;
};
const edgeStmts = (doc, from, to) => doc.stmts.filter((st) => st.kind === 'edge' && pairsOf(st).some(([a, b]) => a === from && b === to));
const ownAttr = (st, key) => st.s.children.filter((c) => c.type === 'Attribute' && c.key.value === key).at(-1) ?? null;
const mentions = (st, id) => (st.kind === 'node' ? st.id === id : st.ends.some((ids) => ids.includes(id)));

// ---------- writing ----------

const KEYWORDS = /^(node|edge|graph|digraph|subgraph|strict)$/i;
export function idText(id) {
  id = String(id);
  if ((/^[A-Za-z_\u0080-￿][\w\u0080-￿]*$/.test(id) && !KEYWORDS.test(id)) || /^-?(\.\d+|\d+(\.\d*)?)$/.test(id)) return id;
  return quote(id);
}
const quote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n|\r/g, '\\n')}"`;
const pointText = ([x, y]) => `${Math.round(x)},${Math.round(y)}`;

// Where a statement really ends: its location may run on over the whitespace after it.
function endOf(text, s) {
  let e = s.location.end.offset;
  while (e > s.location.start.offset && /\s/.test(text[e - 1])) e--;
  return e;
}
const lineStart = (text, at) => text.lastIndexOf('\n', at - 1) + 1;
// The statement is alone on its line(s): only whitespace before it, and only `;`, whitespace and
// maybe a line comment after it (comment: where that comment starts).
function layoutOf(text, s) {
  const start = s.location.start.offset;
  let end = endOf(text, s);
  const semi = text[end - 1] === ';' || /^[ \t]*;/.test(text.slice(end));
  let after = end;
  while (/[ \t;]/.test(text[after] ?? '')) after++;
  const comment = text.startsWith('//', after) || text[after] === '#' ? after : -1;
  const eol = comment >= 0 ? text.indexOf('\n', after) : after;
  const ls = lineStart(text, start);
  const own = /^[ \t]*$/.test(text.slice(ls, start)) && (eol < 0 || eol >= text.length || text[eol] === '\n' || text[eol] === '\r');
  if (text[end - 1] === ';') end--;
  return { start, end, after, own, semi, comment, eol: eol < 0 ? text.length : eol, indent: text.slice(ls, start).match(/^[ \t]*/)[0] };
}

// Splices: { at, end, text }; applied from the back, so offsets stay valid. Overlaps are a bug.
function apply(text, splices) {
  const list = [...splices].sort((a, b) => b.at - a.at || b.end - a.end);
  for (let i = 1; i < list.length; i++) {
    if (list[i].end > list[i - 1].at) throw new Error('editDot: overlapping changes');
  }
  for (const { at, end, text: t } of list) text = text.slice(0, at) + t + text.slice(end);
  return text;
}

// Replace a statement by others (none: remove it, with its line if it had one to itself).
function replaceStmt(text, s, pieces) {
  const L = layoutOf(text, s);
  if (!pieces.length) {
    // a line comment after it stays, on its own line
    if (L.own && L.comment < 0) {
      const ls = lineStart(text, L.start);
      let e = L.after;
      if (text[e] === '\r') e++;
      if (text[e] === '\n') e++;
      return { at: ls, end: e, text: '' };
    }
    return { at: L.start, end: L.after, text: '' };
  }
  const sep = L.own ? `\n${L.indent}` : '; ';
  return { at: L.start, end: L.end, text: pieces.join(sep) };
}
// Put a statement right after another one, in the same body.
function afterStmt(text, s, piece) {
  const L = layoutOf(text, s);
  // after the line comment that follows it, if any
  const end = L.own && L.comment >= 0 ? L.eol : L.semi ? text.indexOf(';', L.end) + 1 : L.end;
  return { at: end, end, text: L.own ? `\n${L.indent}${piece}` : ` ${piece};` };
}
// Put statements at the end of a body (the graph or a subgraph). A piece may be a function of the
// indent its lines get (null: the body is on one line). `gone`: statements other changes remove,
// so the new ones do not go after them.
function appendTo(text, body, pieces, gone = new Set()) {
  pieces = [pieces].flat();
  const n = body.node;
  let close = n.location.end.offset;
  while (close > 0 && text[close - 1] !== '}') close--;
  close--; // the closing brace
  const open = text.indexOf('{', n.id?.location?.end.offset ?? n.location.start.offset);
  const last = n.children.filter((c) => !gone.has(c)).at(-1);
  let at = last ? endOf(text, last) : open + 1;
  if (last && /^[ \t]*;/.test(text.slice(at))) at = text.indexOf(';', at) + 1;
  const multiline = text.slice(open, close).includes('\n');
  if (multiline) {
    const indent = last ? text.slice(lineStart(text, last.location.start.offset), last.location.start.offset).match(/^[ \t]*/)[0]
      : `${text.slice(lineStart(text, n.location.start.offset)).match(/^[ \t]*/)[0]}  `;
    return { at, end: at, text: pieces.map((p) => `\n${indent}${typeof p === 'function' ? p(indent) : p}`).join('') };
  }
  pieces = pieces.map((p) => (typeof p === 'function' ? p(null) : p));
  // the parser takes no `;` after a subgraph
  const sep = (prev) => (/}\s*$/.test(prev) ? ' ' : '; ');
  const joined = pieces.map((p, i) => (i ? sep(pieces[i - 1]) : '') + p).join('');
  if (last) return { at, end: at, text: `${last.type === 'Subgraph' ? ' ' : '; '}${joined}` };
  if (n.children.length) return { at, end: at, text: ` ${joined}${sep(joined).trim() ? ';' : ''}` };
  return { at: open + 1, end: close, text: ` ${joined} ` };
}

// The attribute lists of a statement: from the first `[` after its id or targets, to its end.
function attrSpan(text, st) {
  const head = st.kind === 'node' ? st.s.id.location.end.offset : st.s.targets.at(-1).location.end.offset;
  const L = layoutOf(text, st.s);
  const open = text.indexOf('[', head);
  return open >= 0 && open < L.end ? { open, close: text.lastIndexOf(']', L.end), end: L.end } : { open: -1, head, end: L.end };
}
// The attribute lists as written, e.g. ` [lines="A B", label="x"]`, or ''.
function attrsText(text, st) {
  const a = attrSpan(text, st);
  return a.open < 0 ? '' : ` ${text.slice(a.open, a.close + 1)}`;
}
// Set an attribute: its value replaced where the statement sets it, else added to its last list.
// (value: a string, quoted; or { raw }, written as it is)
const valueText = (v) => (typeof v === 'object' ? v.raw : quote(v));
function setAttr(text, st, key, value) {
  return setAttrs(text, st, [[key, value]])[0];
}
// Set several attributes: those the statement sets are replaced there, the others are added
// together to its last list (or a new one).
function setAttrs(text, st, pairs) {
  const out = [], add = [];
  for (const [key, value] of pairs) {
    const own = ownAttr(st, key);
    if (own) out.push({ at: own.value.location.start.offset, end: own.value.location.end.offset, text: valueText(value) });
    else add.push(`${key}=${valueText(value)}`);
  }
  if (add.length) out.push(addAttrs(text, st, add.join(', ')));
  return out;
}
function addAttrs(text, st, kv) {
  const a = attrSpan(text, st);
  if (a.open < 0) {
    let at = a.end;
    while (/\s/.test(text[at - 1])) at--;
    return { at, end: at, text: ` [${kv}]` };
  }
  let at = a.close;
  while (/\s/.test(text[at - 1])) at--;
  return { at, end: at, text: text[at - 1] === '[' ? kv : `, ${kv}` };
}
// Remove an attribute the statement sets, and its list if nothing is left in it. The other
// attributes keep the separators they were written with.
function removeAttr(text, st, key) {
  const own = ownAttr(st, key);
  if (!own) return null;
  const at = own.location.start.offset, end = own.location.end.offset;
  const open = text.lastIndexOf('[', at), close = text.indexOf(']', end);
  const before = text.slice(open + 1, at), after = text.slice(end, close);
  const head = before.replace(/[\s,;]*$/, ''), tail = after.replace(/^[\s,;]*/, '');
  if (!head.trim() && !tail.trim()) {
    let from = open;
    while (/[ \t]/.test(text[from - 1])) from--;
    return { at: from, end: close + 1, text: '' };
  }
  let inner;
  if (head.trim() && tail.trim()) inner = head + before.slice(head.length) + tail; // the separator written before it
  else if (head.trim()) inner = head + after.match(/\s*$/)[0];
  else inner = before.match(/^\s*/)[0] + tail;
  return { at: open + 1, end: close, text: inner };
}

// ---------- rewriting edge statements ----------

// Rewrites every edge statement without the pairs `dropPair` names and the nodes `dropNode(id, st)` names,
// and puts `extra(st)` (more statement texts) in place of each statement it touched. A node that
// loses its last mention in a container (or anywhere, at the top) keeps a bare mention there, so
// removing an edge never removes a node or moves it out of its container.
function rewriteEdges(doc, { dropPair = () => false, dropNode = () => false, extra = () => [] }) {
  const { text } = doc;
  const plans = [];
  for (const st of doc.stmts) {
    if (st.kind !== 'edge') continue;
    const ends = st.ends.map((ids) => ids.filter((id) => !dropNode(id, st)));
    const pairs = pairsOf(st);
    const keptPairs = pairsOf({ ends }).filter(([a, b]) => !dropPair(a, b, st));
    if (keptPairs.length === pairs.length) continue;
    const attrs = attrsText(text, st);
    const tText = (i) => {
      const t = st.s.targets[i];
      if (ends[i].length === st.ends[i].length) return text.slice(t.location.start.offset, t.location.end.offset).trim();
      return ends[i].length === 1 ? idText(ends[i][0]) : `{${ends[i].map(idText).join(' ')}}`;
    };
    const pieces = [];
    const linkKept = (i) => ends[i].length && ends[i + 1].length && pairsOf({ ends: [ends[i], ends[i + 1]] }).every(([a, b]) => !dropPair(a, b, st));
    const linkGone = (i) => pairsOf({ ends: [ends[i], ends[i + 1]] }).every(([a, b]) => dropPair(a, b, st));
    if (ends.every((_, i) => i === ends.length - 1 || linkKept(i) || linkGone(i))) {
      // whole links kept or dropped: the chain splits into runs of kept links
      let run = [];
      const flush = () => { if (run.length > 1) pieces.push(run.map(tText).join(' -> ') + attrs); run = []; };
      for (let i = 0; i < ends.length; i++) {
        if (!run.length) run.push(i);
        if (i < ends.length - 1 && linkKept(i)) run.push(i + 1);
        else flush();
      }
    } else {
      for (const [a, b] of keptPairs) pieces.push(`${idText(a)} -> ${idText(b)}${attrs}`);
    }
    pieces.push(...extra(st));
    plans.push({ st, pieces });
  }
  // bare mentions for nodes that would vanish from their container (or from the graph)
  const touched = new Set(plans.map((p) => p.st));
  const reparsed = new Map(plans.map((p) => [p.st, p.pieces.map((t) => scanPiece(t))]));
  const stillThere = (id, cluster) => doc.stmts.some((o) => (!cluster || o.body.chain.includes(cluster)) &&
    (touched.has(o) ? reparsed.get(o).some((ids) => ids.includes(id)) : mentions(o, id)));
  for (const p of plans) {
    const seen = new Set();
    for (const ids of p.st.ends) {
      for (const id of ids) {
        if (seen.has(id) || dropNode(id, p.st) || clusterBody(doc, id)) continue; // a container's box is no node
        seen.add(id);
        if (!stillThere(id, p.st.body.cluster)) {
          p.pieces.push(idText(id));
          reparsed.get(p.st).push([id]);
        }
      }
    }
  }
  return plans.map(({ st, pieces }) => replaceStmt(text, st.s, pieces));
}
// The node ids a statement text of ours mentions (we wrote it, so ids are its words or quoted).
function scanPiece(t) {
  const g = parse(`digraph x { ${t} }`).children[0].children[0];
  if (g.type === 'Node') return [g.id.value];
  return g.targets.flatMap((x) => (x.type === 'NodeRef' ? [x.id.value] : x.children.filter((c) => c.type === 'NodeRef').map((c) => c.id.value)));
}

// ---------- ops ----------

// The attributes a statement sets, as written (`key=value`), less those named.
const ownAttrsText = (doc, st, skip = []) => st.s.children
  .filter((c) => c.type === 'Attribute' && !skip.includes(c.key.value))
  .map((c) => doc.text.slice(c.location.start.offset, c.location.end.offset).replace(/[\s,;]+$/, ''));
const inchText = (px) => String(Math.round((px / 72) * 100) / 100);

const known = (doc, id) => doc.stmts.some((st) => mentions(st, id));
// The clusters a node is in, outermost first: those around its deepest mention.
const chainOf = (doc, id) => doc.stmts.filter((st) => mentions(st, id)).map((st) => st.body.chain)
  .reduce((a, b) => (b.length > a.length ? b : a), []);

// The body a cluster is written in (the first, if it is written in several places).
const clusterBody = (doc, id) => doc.bodies.find((b) => b.node.type === 'Subgraph' && b.node.id?.value === id && b.cluster === id);
const isPrefix = (a, b) => a.length <= b.length && a.every((x, i) => x === b[i]);
const commonChain = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
};
const bodyOf = (doc, chain) => (chain.length ? clusterBody(doc, chain.at(-1)) : doc.graph);

const OPS = {
  pos(doc, { id, x, y }) {
    const value = pointText([x, y]);
    const decl = doc.stmts.filter((st) => st.kind === 'node' && st.id === id);
    const withPos = decl.filter((st) => ownAttr(st, 'pos'));
    if (withPos.length) return [setAttr(doc.text, withPos.at(-1), 'pos', value)];
    if (decl.length) return [setAttr(doc.text, decl.find((st) => st.s.children.some((c) => c.type === 'Attribute')) ?? decl[0], 'pos', value)];
    const first = doc.stmts.find((st) => mentions(st, id));
    if (!first) throw new Error(`no node ${id}`);
    return [appendTo(doc.text, first.body, `${idText(id)} [pos=${quote(value)}]`)];
  },

  // A statement that set nothing but the pos goes, unless it is what keeps the node in its
  // container (or in the graph): then it stays, bare.
  unpin(doc, { id }) {
    if (!known(doc, id)) throw new Error(`no node ${id}`);
    const withPos = doc.stmts.filter((st) => st.kind === 'node' && st.id === id && ownAttr(st, 'pos'));
    return withPos.map((st) => {
      const onlyPos = st.s.children.filter((c) => c.type === 'Attribute').length === 1;
      const cluster = st.body.cluster;
      const kept = doc.stmts.some((o) => o !== st && mentions(o, id) && (!cluster || o.body.chain.includes(cluster)));
      return onlyPos && kept ? replaceStmt(doc.text, st.s, []) : removeAttr(doc.text, st, 'pos');
    });
  },

  via(doc, { from, to, points }) {
    const list = edgeStmts(doc, from, to);
    if (!list.length) throw new Error(`no edge ${from}->${to}`);
    const value = points.map(pointText).join(' ');
    const single = (st) => pairsOf(st).length === 1;
    const setting = list.filter((st) => ownAttr(st, 'via'));
    if (setting.some((st) => !single(st))) throw new Error(`edge ${from}->${to}: its via is set for several edges at once; edit it in the file`);
    if (setting.length) {
      // the last one wins in the file; the others go
      // a statement that only set the via goes with it
      const unset = (st) => (list.length > 1 && st.s.children.filter((c) => c.type === 'Attribute').length === 1
        ? replaceStmt(doc.text, st.s, []) : removeAttr(doc.text, st, 'via'));
      const out = setting.slice(0, -1).map(unset);
      out.push(points.length ? setAttr(doc.text, setting.at(-1), 'via', value) : unset(setting.at(-1)));
      return out;
    }
    if (!points.length) return [];
    const own = list.filter(single).at(-1);
    if (own) return [setAttr(doc.text, own, 'via', value)];
    // written only as part of a chain or group: a statement of its own, which adds the via
    return [afterStmt(doc.text, list.at(-1).s, `${idText(from)} -> ${idText(to)} [via=${quote(value)}]`)];
  },

  size(doc, { id, w, h }) {
    const pairs = [['width', { raw: inchText(w) }], ['height', { raw: inchText(h) }]];
    const decl = doc.stmts.filter((st) => st.kind === 'node' && st.id === id);
    const sized = decl.filter((st) => ownAttr(st, 'width') || ownAttr(st, 'height'));
    if (sized.length) return setAttrs(doc.text, sized.at(-1), pairs);
    if (decl.length) return setAttrs(doc.text, decl.find((st) => st.s.children.some((c) => c.type === 'Attribute')) ?? decl[0], pairs);
    const first = doc.stmts.find((st) => mentions(st, id));
    if (!first) throw new Error(`no node ${id}`);
    return [appendTo(doc.text, first.body, `${idText(id)} [${pairs.map(([k, v]) => `${k}=${v.raw}`).join(', ')}]`)];
  },

  // The lines go on the last statement of the edge alone (or on one of its own, after the last
  // statement); other statements of the edge lose theirs. A chain or group that set lines for it
  // drops the edge, and gives it back on its own with its other attributes, if it had any.
  lines(doc, { from, to, lines }) {
    if (!lines?.length) throw new Error(`edge ${from}->${to} needs a line; remove the edge instead`);
    const list = edgeStmts(doc, from, to);
    if (!list.length) throw new Error(`no edge ${from}->${to}`);
    const value = lines.join(' ');
    const single = (st) => pairsOf(st).length === 1;
    const target = list.filter(single).at(-1) ?? null;
    const multi = list.filter((st) => !single(st) && ownAttr(st, 'lines'));
    const pair = `${idText(from)} -> ${idText(to)}`;
    const out = [];
    for (const st of list) if (single(st) && st !== target && ownAttr(st, 'lines')) out.push(removeAttr(doc.text, st, 'lines'));
    if (target) out.push(setAttr(doc.text, target, 'lines', value));
    if (multi.length) {
      out.push(...rewriteEdges(doc, {
        dropPair: (a, b, st) => a === from && b === to && multi.includes(st),
        extra: (st) => {
          if (!multi.includes(st)) return [];
          const attrs = ownAttrsText(doc, st, ['lines']);
          if (!target && st === multi.at(-1)) attrs.unshift(`lines=${quote(value)}`);
          return attrs.length ? [`${pair} [${attrs.join(', ')}]`] : [];
        },
      }));
    } else if (!target) {
      out.push(afterStmt(doc.text, list.at(-1).s, `${pair} [lines=${quote(value)}]`));
    }
    return out;
  },

  addNode(doc, { id, x, y, label, shape, group }) {
    if (known(doc, id)) throw new Error(`there is a node ${id} already`);
    const body = group ? doc.bodies.find((b) => b.cluster === group && b.node.id?.value === group) : doc.graph;
    if (!body) throw new Error(`no container ${group}`);
    const attrs = [];
    if (label !== undefined && label !== id) attrs.push(`label=${quote(label)}`);
    if (shape && shape !== 'box') attrs.push(`shape=${shape}`);
    if (x != null && y != null) attrs.push(`pos=${quote(pointText([x, y]))}`);
    return [appendTo(doc.text, body, `${idText(id)}${attrs.length ? ` [${attrs.join(', ')}]` : ''}`)];
  },

  removeNode(doc, { id }) {
    if (!known(doc, id)) throw new Error(`no node ${id}`);
    const out = doc.stmts.filter((st) => st.kind === 'node' && st.id === id).map((st) => replaceStmt(doc.text, st.s, []));
    return [...out, ...rewriteEdges(doc, { dropNode: (n) => n === id })];
  },

  addEdge(doc, { from, to, lines = [] }) {
    const attrs = lines.length ? ` [lines=${quote(lines.join(' '))}]` : '';
    return [appendTo(doc.text, doc.graph, `${idText(from)} -> ${idText(to)}${attrs}`)];
  },

  removeEdge(doc, { from, to }) {
    if (!edgeStmts(doc, from, to).length) throw new Error(`no edge ${from}->${to}`);
    return rewriteEdges(doc, { dropPair: (a, b) => a === from && b === to });
  },

  moveEdge(doc, { from, to, newFrom = from, newTo = to }) {
    const list = new Set(edgeStmts(doc, from, to));
    if (!list.size) throw new Error(`no edge ${from}->${to}`);
    if (newFrom === from && newTo === to) return [];
    // each statement that has the edge loses it and gets it back, with its own attributes, as a
    // statement of its own with the new ends; an end that stays is written as it was
    const end = (st, i, id) => {
      const t = st.s.targets.length === 2 ? st.s.targets[i] : null;
      return t?.type === 'NodeRef' && t.id.value === id ? doc.text.slice(t.location.start.offset, t.location.end.offset).trim() : idText(id);
    };
    // A statement in a container makes both its ends members: the edge stays there only if the
    // new ends are in that container already, else it goes to the top of the graph.
    const fits = (st) => !st.body.cluster || [newFrom, newTo].every((id) => chainOf(doc, id).includes(st.body.cluster));
    const outside = [];
    const out = rewriteEdges(doc, {
      dropPair: (a, b) => a === from && b === to,
      extra: (st) => {
        if (!list.has(st)) return [];
        const piece = `${end(st, 0, newFrom)} -> ${end(st, 1, newTo)}${attrsText(doc.text, st)}`;
        if (fits(st)) return [piece];
        outside.push(piece);
        return [];
      },
    });
    if (outside.length) out.push(appendTo(doc.text, doc.graph, outside));
    return out;
  },

  // An empty container, at the end of `parent` (or of the graph).
  addGroup(doc, { id, label, parent = null }) {
    if (clusterBody(doc, id) || known(doc, id)) throw new Error(`there is a ${id} already`);
    if (!String(id).startsWith('cluster')) throw new Error(`a container id starts with "cluster": ${id}`);
    const body = parent ? clusterBody(doc, parent) : doc.graph;
    if (!body) throw new Error(`no container ${parent}`);
    const head = `subgraph ${idText(id)} {`;
    const lab = label != null ? `label = ${quote(label)}` : null;
    return [appendTo(doc.text, body, (indent) => (indent == null ? `${head}${lab ? ` ${lab}` : ''} }`
      : `${head}${lab ? `\n${indent}  ${lab}` : ''}\n${indent}}`))];
  },

  group(doc, { id, label, ids, parent = null }) {
    const cid = String(id).startsWith('cluster') ? id : `cluster_${id}`;
    return { ops: [{ op: 'addGroup', id: cid, label, parent }, { op: 'moveTo', ids, group: cid }] };
  },

  // Every node statement of a node goes to the new container; its edges written in bodies outside
  // the new container's chain leave them, for the deepest container both ends share. The other
  // ends keep a mention where they were.
  moveTo(doc, { ids, group = null }) {
    const target = group ? clusterBody(doc, group) : doc.graph;
    if (!target) throw new Error(`no container ${group}`);
    const to = target.chain;
    for (const id of ids) if (!known(doc, id) || clusterBody(doc, id)) throw new Error(`no node ${id}`);
    // a note goes with the node it is attached to
    const moved = new Set(ids);
    const flow = readDot(doc.text);
    const notes = new Set(flow.nodes.filter((n) => n.attrs.shape === 'note').map((n) => n.id));
    for (const { from, to: t } of flow.edges) {
      if (moved.has(from) && notes.has(t) && !notes.has(from)) moved.add(t);
      if (moved.has(t) && notes.has(from) && !notes.has(t)) moved.add(from);
    }
    const left = new Map();
    for (const id of moved) {
      const chain = chainOf(doc, id);
      if (chain.length === to.length && isPrefix(chain, to)) moved.delete(id);
      else left.set(id, chain.at(-1) ?? null);
    }
    if (!moved.size) return [];
    const bad = (body) => !isPrefix(body.chain, to);
    const out = [], gone = new Set(), nodes = [], edges = [];
    for (const st of doc.stmts) {
      if (st.kind !== 'node' || !moved.has(st.id) || st.body.cluster === group) continue;
      const L = layoutOf(doc.text, st.s);
      nodes.push(doc.text.slice(L.start, L.end));
      gone.add(st.s);
      out.push(replaceStmt(doc.text, st.s, []));
    }
    const drop = (id, st) => moved.has(id) && bad(st.body);
    const endChain = (id) => {
      if (moved.has(id)) return to;
      const box = clusterBody(doc, id); // an edge to a container's box
      return box ? box.chain.slice(0, -1) : chainOf(doc, id);
    };
    for (const st of doc.stmts) {
      if (st.kind !== 'edge' || !bad(st.body)) continue;
      const attrs = attrsText(doc.text, st);
      for (const [a, b] of pairsOf(st)) {
        if (drop(a, st) || drop(b, st)) edges.push({ body: bodyOf(doc, commonChain(endChain(a), endChain(b))), piece: `${idText(a)} -> ${idText(b)}${attrs}` });
      }
    }
    out.push(...rewriteEdges(doc, { dropNode: drop }));
    // a node mentioned nowhere in its new container yet gets a bare mention there
    const bare = [];
    if (group) {
      const there = [...nodes, ...edges.filter((e) => e.body === target).map((e) => e.piece)].map(scanPiece);
      for (const id of moved) {
        if (doc.stmts.some((st) => st.body.cluster === group && !gone.has(st.s) && mentions(st, id)) || there.some((x) => x.includes(id))) continue;
        bare.push(idText(id));
      }
    }
    const adds = new Map([[target, [...nodes, ...bare]]]);
    for (const { body, piece } of edges) adds.set(body, [...(adds.get(body) ?? []), piece]);
    for (const [body, pieces] of adds) if (pieces.length) out.push(appendTo(doc.text, body, pieces, gone));
    return out;
  },

  // Edges to or from the container's box go (it is no box any more), then the container itself.
  removeGroup(doc, { id }) {
    if (!clusterBody(doc, id)) throw new Error(`no container ${id}`);
    return { ops: [{ op: '_dropBox', id }, { op: '_unwrap', id }] };
  },
  _dropBox(doc, { id }) {
    return rewriteEdges(doc, { dropNode: (n) => n === id });
  },
  // The cluster's statements are written in its parent, one indent less; its own attributes go.
  // If it sets node or edge defaults, it stays as an anonymous subgraph, so they keep their scope.
  _unwrap(doc, { id }) {
    const { text } = doc;
    return doc.bodies.filter((b) => b.node.type === 'Subgraph' && b.node.id?.value === id).flatMap(({ node: n }) => {
      const own = n.children.filter((c) => c.type === 'Attribute' || (c.type === 'AttributeList' && c.kind === 'Graph'));
      const removals = own.map((c) => replaceStmt(text, c, []));
      const open = text.indexOf('{', n.id.location.end.offset);
      if (n.children.some((c) => c.type === 'AttributeList' && c.kind !== 'Graph')) {
        return [...removals, { at: n.id.location.start.offset, end: open, text: '' }];
      }
      let close = n.location.end.offset;
      while (text[close - 1] !== '}') close--;
      close--;
      const L = layoutOf(text, n);
      const cut = apply(text, removals);
      const inner = cut.slice(open + 1, close - (text.length - cut.length));
      if (!inner.trim()) return [replaceStmt(text, n, [])];
      if (!inner.includes('\n')) return [{ at: L.start, end: close + 1, text: inner.trim() }];
      const lines = inner.split('\n');
      const first = lines.shift().trim();
      if (!lines.at(-1).trim()) lines.pop();
      const ind = (l) => l.match(/^[ \t]*/)[0].length;
      const step = Math.max(0, Math.min(...lines.filter((l) => l.trim()).map(ind)) - L.indent.length);
      const body = lines.map((l) => (l.trim() ? l.slice(Math.min(step, ind(l))) : ''));
      if (first) body.unshift(L.indent + first);
      return [{ at: L.start, end: close + 1, text: body.join('\n').replace(/^[ \t]*/, '') }];
    });
  },
};

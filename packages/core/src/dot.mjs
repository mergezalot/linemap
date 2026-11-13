// Reads a DOT file (parsed by @ts-graphviz/ast) into plain lists, with Graphviz's own rules for
// default attributes and subgraph membership. Nothing here knows about shapes or styles.
import { parse } from '@ts-graphviz/ast';

// DOT string values. A quoted string keeps its escapes: `\n`, `\l`, `\r` break the line,
// backslash-newline continues it. An HTML-like string <...> collapses whitespace, `<br/>` breaks
// the line, other tags are dropped and entities decoded. Lines are trimmed in both cases.
function text(lit) {
  let s = lit.value;
  if (lit.quoted === 'html') {
    s = s.replace(/\s+/g, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
      .replace(/&amp;/g, '&');
  } else {
    s = s.replace(/\\\r?\n/g, '').replace(/\\([nlr\\])/g, (_, c) => (c === '\\' ? '\\' : '\n'));
  }
  return s.split('\n').map((r) => r.trim()).join('\n').trim();
}

const attrsOf = (stmt) => Object.fromEntries(
  stmt.children.filter((c) => c.type === 'Attribute').map((a) => [a.key.value, text(a.value)]),
);
const where = (stmt) => `line ${stmt.location?.start.line ?? '?'}`;

export function readDot(source) {
  const graph = parse(source).children.find((c) => c.type === 'Graph');
  if (!graph) throw new Error('no graph in DOT file');
  if (!graph.directed) throw new Error('the graph must be a digraph');

  const out = { id: graph.id?.value ?? 'graph', attrs: {}, lines: [], clusters: [], nodes: [], edges: [] };
  const nodeById = new Map();
  const clusterById = new Map();

  // A node belongs to every subgraph it is mentioned in; its container is the deepest cluster.
  const mention = (id, scope, attrs, stmt, explicit = false) => {
    if (scope.inLines) throw new Error(`DOT ${where(stmt)}: only line declarations belong in "subgraph lines"`);
    let n = nodeById.get(id);
    if (!n) {
      n = { id, attrs: { ...scope.node }, clusters: new Set() };
      nodeById.set(id, n);
      out.nodes.push(n);
    }
    Object.assign(n.attrs, attrs);
    if (explicit) n.explicit = true;
    if (scope.cluster) n.clusters.add(scope.cluster);
  };

  const targetIds = (t, stmt) => {
    if (t.type === 'NodeRef') return [t.id.value];
    if (t.type === 'NodeRefGroup') return t.children.filter((c) => c.type === 'NodeRef').map((c) => c.id.value);
    throw new Error(`DOT ${where(stmt)}: subgraphs as edge ends are not supported; use {a b} for several nodes, or the cluster id (a -> cluster_x) for its box`);
  };

  // `scope` carries the defaults set by `node [...]` and `edge [...]`, which apply to what follows
  // them in the same subgraph and in nested ones.
  const walk = (stmts, scope, target) => {
    for (const s of stmts) {
      if (s.type === 'Attribute') {
        target[s.key.value] = text(s.value);
      } else if (s.type === 'AttributeList') {
        const a = attrsOf(s);
        if (s.kind === 'Node') scope.node = { ...scope.node, ...a };
        else if (s.kind === 'Edge') scope.edge = { ...scope.edge, ...a };
        else Object.assign(target, a);
      } else if (s.type === 'Node') {
        if (scope.inLines) {
          if (out.lines.some((l) => l.id === s.id.value)) throw new Error(`DOT ${where(s)}: line "${s.id.value}" declared twice`);
          out.lines.push({ id: s.id.value, attrs: { ...scope.node, ...attrsOf(s) } });
        } else {
          mention(s.id.value, scope, attrsOf(s), s, true);
        }
      } else if (s.type === 'Edge') {
        if (scope.inLines) throw new Error(`DOT ${where(s)}: edges do not belong in "subgraph lines"`);
        const ends = s.targets.map((t) => targetIds(t, s));
        for (const ids of ends) for (const id of ids) mention(id, scope, {}, s);
        const attrs = { ...scope.edge, ...attrsOf(s) };
        for (let i = 1; i < ends.length; i++) {
          for (const from of ends[i - 1]) for (const to of ends[i]) out.edges.push({ from, to, attrs, line: s.location?.start.line });
        }
      } else if (s.type === 'Subgraph') {
        const id = s.id?.value;
        const inner = { ...scope };
        let innerTarget = {};
        if (id === 'lines' && !scope.cluster) {
          inner.inLines = true;
        } else if (id?.startsWith('cluster')) {
          let c = clusterById.get(id);
          if (!c) {
            c = { id, attrs: {}, parent: scope.cluster };
            clusterById.set(id, c);
            out.clusters.push(c);
          }
          inner.cluster = c;
          innerTarget = c.attrs;
        }
        walk(s.children, inner, innerTarget);
      }
    }
  };
  walk(graph.children, { node: {}, edge: {}, cluster: null }, out.attrs);

  // An edge end named like a cluster is that cluster's box, not a node.
  out.nodes = out.nodes.filter((n) => {
    if (!clusterById.has(n.id)) return true;
    if (n.explicit) throw new Error(`"${n.id}" is a cluster, so it cannot also be a node`);
    return false;
  });

  const ancestors = (c) => (c ? [c, ...ancestors(c.parent)] : []);
  for (const n of out.nodes) {
    const deepest = [...n.clusters].sort((a, b) => ancestors(b).length - ancestors(a).length)[0] ?? null;
    for (const c of n.clusters) {
      if (!ancestors(deepest).includes(c)) throw new Error(`node ${n.id} is in both ${c.id} and ${deepest.id}`);
    }
    n.cluster = deepest;
    delete n.clusters;
    delete n.explicit;
  }
  return out;
}

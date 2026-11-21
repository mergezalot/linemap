// editDot: each op changes only what it must, and the result is still a valid flow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { editDot, parseFlow } from '../index.mjs';

const FLOW = `digraph g {
  subgraph lines { A; B }
  // the shop
  a [label="Shop", pos="100,100"]
  b
  subgraph cluster_x {
    label = "X"
    c [label="C"]
    a -> c [lines=A]
  }
  a -> b -> d [lines="A B"]   // a chain
  {b d} -> e [lines=B]
}
`;
const edit = (op, text = FLOW) => {
  const out = editDot(text, op);
  parseFlow(out); // still valid
  return out;
};
// the lines that differ, as [before, after]
function diff(a, b) {
  const [x, y] = [a.split('\n'), b.split('\n')];
  let i = 0;
  while (i < x.length && x[i] === y[i]) i++;
  let j = 0;
  while (j < x.length - i && j < y.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
  return [x.slice(i, x.length - j).join('\n'), y.slice(i, y.length - j).join('\n')];
}

test('pos replaces a pos where it is written', () => {
  assert.deepEqual(diff(FLOW, edit({ op: 'pos', id: 'a', x: 210.4, y: 99.6 })), ['  a [label="Shop", pos="100,100"]', '  a [label="Shop", pos="210,100"]']);
});
test('pos adds to a declaration, or adds one where the node is first mentioned', () => {
  assert.deepEqual(diff(FLOW, edit({ op: 'pos', id: 'c', x: 1, y: 2 })), ['    c [label="C"]', '    c [label="C", pos="1,2"]']);
  assert.deepEqual(diff(FLOW, edit({ op: 'pos', id: 'b', x: 1, y: 2 })), ['  b', '  b [pos="1,2"]']);
  assert.deepEqual(diff(FLOW, edit({ op: 'pos', id: 'e', x: 1, y: 2 })), ['', '  e [pos="1,2"]']);
  const one = 'digraph g { subgraph lines { A } x; y [shape=box] }';
  assert.equal(edit({ op: 'pos', id: 'x', x: 5, y: 6 }, one), 'digraph g { subgraph lines { A } x [pos="5,6"]; y [shape=box] }');
});

test('unpin removes the pos, and a statement that set only the pos', () => {
  assert.deepEqual(diff(FLOW, edit({ op: 'unpin', id: 'a' })), ['  a [label="Shop", pos="100,100"]', '  a [label="Shop"]']);
  assert.equal(parseFlow(edit({ op: 'unpin', id: 'a' })).items.get('a').pinned, false);
  // no pos anywhere: nothing changes
  assert.equal(edit({ op: 'unpin', id: 'c' }), FLOW);
  // every statement loses it; one that set only the pos goes, with its line
  const t = 'digraph g {\n  subgraph lines { A }\n  a [pos="1,2"]\n  a [label="x", pos="3,4"]\n  a -> b [lines=A]\n}\n';
  assert.equal(edit({ op: 'unpin', id: 'a' }, t), 'digraph g {\n  subgraph lines { A }\n  a [label="x"]\n  a -> b [lines=A]\n}\n');
  // a statement that is the node's only mention (or its only one in its container) stays, bare
  const alone = 'digraph g { subgraph lines { A } n [pos="1,2"]; subgraph cluster_x { b [pos="5,6"] } a -> b [lines=A] }';
  const r = edit({ op: 'unpin', id: 'n' }, edit({ op: 'unpin', id: 'b' }, alone));
  assert.equal(r, 'digraph g { subgraph lines { A } n; subgraph cluster_x { b } a -> b [lines=A] }');
  assert.equal(parseFlow(r).items.get('b').group, 'cluster_x');
  assert.throws(() => editDot(FLOW, { op: 'unpin', id: 'zz' }), /no node zz/);
});

test('via: on the edge statement, as a statement of its own for a chain, and removed again', () => {
  const v = edit({ op: 'via', from: 'a', to: 'c', points: [[10, 20], [30, 40]] });
  assert.deepEqual(diff(FLOW, v), ['    a -> c [lines=A]', '    a -> c [lines=A, via="10,20 30,40"]']);
  assert.deepEqual(parseFlow(v).edges.find((e) => e.id === 'a->c').via, [[10, 20], [30, 40]]);
  assert.equal(edit({ op: 'via', from: 'a', to: 'c', points: [] }, v), FLOW);
  const moved = edit({ op: 'via', from: 'a', to: 'c', points: [[1, 2]] }, v);
  assert.deepEqual(diff(FLOW, moved)[1], '    a -> c [lines=A, via="1,2"]');

  const chain = edit({ op: 'via', from: 'b', to: 'd', points: [[5, 5]] });
  assert.deepEqual(diff(FLOW, chain), ['', '  b -> d [via="5,5"]']);
  const model = parseFlow(chain);
  assert.deepEqual(model.edges.find((e) => e.id === 'b->d').via, [[5, 5]]);
  assert.deepEqual(model.edges.find((e) => e.id === 'b->d').lines.map((l) => l.id), ['A', 'B']);
  assert.equal(edit({ op: 'via', from: 'b', to: 'd', points: [] }, chain), FLOW);
});
test('via keeps the other attributes and their separators when removed', () => {
  const t = 'digraph g { subgraph lines { A } a -> b [via="1,2"; lines=A; label="x"] }';
  assert.equal(edit({ op: 'via', from: 'a', to: 'b', points: [] }, t), 'digraph g { subgraph lines { A } a -> b [lines=A; label="x"] }');
  // a statement that only set the via goes
  const u = 'digraph g { subgraph lines { A } a -> b [ via="1,2" ]; a -> b [lines=A] }';
  assert.equal(edit({ op: 'via', from: 'a', to: 'b', points: [] }, u), 'digraph g { subgraph lines { A } a -> b [lines=A] }');
});

test('addNode at the end of the graph or of its container', () => {
  assert.deepEqual(diff(FLOW, edit({ op: 'addNode', id: 'new one', label: 'New "one"', x: 5, y: 6 })), ['', '  "new one" [label="New \\"one\\"", pos="5,6"]']);
  const inX = edit({ op: 'addNode', id: 'n', x: 5, y: 6, shape: 'cylinder', group: 'cluster_x' });
  assert.deepEqual(diff(FLOW, inX), ['', '    n [shape=cylinder, pos="5,6"]']);
  assert.equal(parseFlow(inX).items.get('n').group, 'cluster_x');
  assert.throws(() => editDot(FLOW, { op: 'addNode', id: 'a', x: 0, y: 0 }), /there is a node a already/);
});
test('addNode without a position, and a label of several lines', () => {
  assert.deepEqual(diff(FLOW, edit({ op: 'addNode', id: 'n' })), ['', '  n']);
  const label = 'one "two"\nC:\\three\r\nfour';
  const t = edit({ op: 'addNode', id: 'note_1', label, shape: 'note' });
  assert.deepEqual(diff(FLOW, t), ['', '  note_1 [label="one \\"two\\"\\nC:\\\\three\\nfour", shape=note]']);
  const n = parseFlow(t).items.get('note_1');
  assert.equal(n.label, 'one "two"\nC:\\three\nfour');
  assert.equal(n.pinned, false);
});

test('addEdge and removeEdge', () => {
  const t = edit({ op: 'addEdge', from: 'c', to: 'e', lines: ['A', 'B'] });
  assert.deepEqual(diff(FLOW, t), ['', '  c -> e [lines="A B"]']);
  assert.equal(edit({ op: 'removeEdge', from: 'c', to: 'e' }, t), FLOW);
});
test('removeEdge splits a chain, and keeps the nodes it would lose', () => {
  assert.deepEqual(diff(FLOW, edit({ op: 'removeEdge', from: 'a', to: 'b' })), ['  a -> b -> d [lines="A B"]   // a chain', '  b -> d [lines="A B"]   // a chain']);
  // a -> c puts a into cluster_x (its deepest mention), so a stays there
  assert.deepEqual(diff(FLOW, edit({ op: 'removeEdge', from: 'a', to: 'c' })), ['    a -> c [lines=A]', '    a']);
  const t = 'digraph g {\n  subgraph lines { A }\n  subgraph cluster_x {\n    a -> b [lines=A]\n  }\n  a -> c [lines=A]\n}\n';
  const r = edit({ op: 'removeEdge', from: 'a', to: 'b' }, t);
  assert.deepEqual(diff(t, r), ['    a -> b [lines=A]', '    a\n    b']);
  assert.equal(parseFlow(r).items.get('a').group, 'cluster_x');
});
test('removeEdge out of a group writes the pairs left', () => {
  const r = edit({ op: 'removeEdge', from: 'b', to: 'e' });
  assert.deepEqual(diff(FLOW, r), ['  {b d} -> e [lines=B]', '  d -> e [lines=B]']);
});

test('removeNode takes its declarations and edges', () => {
  const r = edit({ op: 'removeNode', id: 'b' });
  assert.deepEqual(diff(FLOW, r), ['  b\n  subgraph cluster_x {\n    label = "X"\n    c [label="C"]\n    a -> c [lines=A]\n  }\n  a -> b -> d [lines="A B"]   // a chain\n  {b d} -> e [lines=B]',
    '  subgraph cluster_x {\n    label = "X"\n    c [label="C"]\n    a -> c [lines=A]\n  }\n  // a chain\n  d -> e [lines=B]']);
  assert.ok(!parseFlow(r).items.has('b'));
  const m = edit({ op: 'removeNode', id: 'd' });
  assert.deepEqual(diff(FLOW, m), ['  a -> b -> d [lines="A B"]   // a chain\n  {b d} -> e [lines=B]', '  a -> b [lines="A B"]   // a chain\n  b -> e [lines=B]']);
});

test('moveEdge keeps the attributes, in place or out of a chain', () => {
  const v = edit({ op: 'via', from: 'a', to: 'c', points: [[1, 2]] });
  const r = edit({ op: 'moveEdge', from: 'a', to: 'c', newFrom: 'c', newTo: 'a' }, v);
  assert.deepEqual(diff(v, r), ['    a -> c [lines=A, via="1,2"]', '    c -> a [lines=A, via="1,2"]']);
  // b is not in cluster_x, so the edge leaves it (a stays in it)
  const out = edit({ op: 'moveEdge', from: 'a', to: 'c', newFrom: 'b' }, v);
  assert.deepEqual(diff(v, out), ['    a -> c [lines=A, via="1,2"]\n  }\n  a -> b -> d [lines="A B"]   // a chain\n  {b d} -> e [lines=B]',
    '    a\n  }\n  a -> b -> d [lines="A B"]   // a chain\n  {b d} -> e [lines=B]\n  b -> c [lines=A, via="1,2"]']);
  const m = parseFlow(out);
  assert.equal(m.items.get('b').group, null);
  assert.equal(m.items.get('a').group, 'cluster_x');
  const c = edit({ op: 'moveEdge', from: 'b', to: 'd', newTo: 'c' });
  assert.deepEqual(diff(FLOW, c), ['  a -> b -> d [lines="A B"]   // a chain', '  a -> b [lines="A B"]\n  b -> c [lines="A B"]   // a chain']);
  assert.ok(parseFlow(c).edges.some((e) => e.id === 'b->c'));
});

test('size: width and height in inches, where the node is declared', () => {
  assert.deepEqual(diff(FLOW, edit({ op: 'size', id: 'a', w: 180, h: 72 })), ['  a [label="Shop", pos="100,100"]', '  a [label="Shop", pos="100,100", width=2.5, height=1]']);
  const once = edit({ op: 'size', id: 'a', w: 180, h: 72 });
  assert.deepEqual(diff(once, edit({ op: 'size', id: 'a', w: 100, h: 50 }, once))[1], '  a [label="Shop", pos="100,100", width=1.39, height=0.69]');
  assert.deepEqual(diff(FLOW, edit({ op: 'size', id: 'b', w: 144, h: 36 })), ['  b', '  b [width=2, height=0.5]']);
  assert.deepEqual(diff(FLOW, edit({ op: 'size', id: 'e', w: 144, h: 36 })), ['', '  e [width=2, height=0.5]']);
  const m = parseFlow(edit({ op: 'size', id: 'c', w: 144, h: 36 }));
  assert.deepEqual([m.items.get('c').w, m.items.get('c').h], [144, 36]);
  const t = 'digraph g { subgraph lines { A } a [height=2]; a -> b [lines=A] }';
  assert.equal(edit({ op: 'size', id: 'a', w: 72, h: 72 }, t), 'digraph g { subgraph lines { A } a [height=1, width=1]; a -> b [lines=A] }');
});

test('lines: set on the edge, or split out of a chain with its other attributes', () => {
  const ids = (t, id) => parseFlow(t).edges.find((e) => e.id === id).lines.map((l) => l.id);
  const one = edit({ op: 'lines', from: 'a', to: 'c', lines: ['A', 'B'] });
  assert.deepEqual(diff(FLOW, one), ['    a -> c [lines=A]', '    a -> c [lines="A B"]']);
  const chain = edit({ op: 'lines', from: 'b', to: 'd', lines: ['B'] });
  assert.deepEqual(diff(FLOW, chain), ['  a -> b -> d [lines="A B"]   // a chain', '  a -> b [lines="A B"]\n  b -> d [lines="B"]   // a chain']);
  assert.deepEqual(ids(chain, 'b->d'), ['B']);
  assert.deepEqual(ids(chain, 'a->b'), ['A', 'B']);
  const group = edit({ op: 'lines', from: 'b', to: 'e', lines: ['A', 'B'] });
  assert.deepEqual(diff(FLOW, group), ['  {b d} -> e [lines=B]', '  d -> e [lines=B]\n  b -> e [lines="A B"]']);
  // a label written on a chain stays with the edge taken out of it
  const lab = 'digraph g { subgraph lines { A; B } a -> b -> c [lines="A B", label="x"] }';
  assert.equal(edit({ op: 'lines', from: 'a', to: 'b', lines: ['A'] }, lab), 'digraph g { subgraph lines { A; B } b -> c [lines="A B", label="x"]; a -> b [lines="A", label="x"] }');
  // a single statement written twice: the last gets the lines, the other loses them
  const twice = 'digraph g { subgraph lines { A; B } a -> b [lines=A]; a -> b [lines=B, via="1,2"] }';
  const r = edit({ op: 'lines', from: 'a', to: 'b', lines: ['A'] }, twice);
  assert.equal(r, 'digraph g { subgraph lines { A; B } a -> b; a -> b [lines="A", via="1,2"] }');
  assert.deepEqual(ids(r, 'a->b'), ['A']);
  assert.throws(() => editDot(FLOW, { op: 'lines', from: 'a', to: 'c', lines: [] }), /needs a line/);
});

// membership after an edit: id -> container, and container -> parent
const groupsOf = (t) => {
  const m = parseFlow(t);
  return { items: Object.fromEntries([...m.items.values()].map((i) => [i.id, i.group])), groups: Object.fromEntries(m.groups.map((g) => [g.id, g.parent])) };
};
const NOTE = `${FLOW.slice(0, FLOW.lastIndexOf('}'))}  n [shape=note, label="hi"]
  c -> n
}
`;
const NEST = `digraph g {
  subgraph lines { A }
  subgraph cluster_x {
    label = "X"
    subgraph cluster_y {
      p -> q [lines=A]   // inner
    }
    q -> r [lines=A]
  }
  r -> s [lines=A]
}
`;

test('group: a new container around nodes, their declarations moved into it', () => {
  const r = edit({ op: 'group', id: 'y', label: 'Y', ids: ['b', 'e'] });
  assert.deepEqual(diff(FLOW, r), ['  b\n  subgraph cluster_x {\n    label = "X"\n    c [label="C"]\n    a -> c [lines=A]\n  }\n  a -> b -> d [lines="A B"]   // a chain\n  {b d} -> e [lines=B]',
    '  subgraph cluster_x {\n    label = "X"\n    c [label="C"]\n    a -> c [lines=A]\n  }\n  a -> b -> d [lines="A B"]   // a chain\n  {b d} -> e [lines=B]\n  subgraph cluster_y {\n    label = "Y"\n    b\n    e\n  }']);
  const g = groupsOf(r);
  assert.deepEqual(g.items, { a: 'cluster_x', b: 'cluster_y', c: 'cluster_x', d: null, e: 'cluster_y' });
  assert.deepEqual(g.groups, { cluster_x: null, cluster_y: null });
  assert.equal(parseFlow(r).groupById.get('cluster_y').label, 'Y');
  // on one line, inside a container; a full id is taken as it is
  const one = 'digraph g { subgraph lines { A } subgraph cluster_x { a -> b [lines=A] } }';
  const o = edit({ op: 'group', id: 'cluster_in', label: 'In', ids: ['a'], parent: 'cluster_x' }, one);
  assert.equal(o, 'digraph g { subgraph lines { A } subgraph cluster_x { a -> b [lines=A]; subgraph cluster_in { label = "In"; a } } }');
  assert.deepEqual(groupsOf(o).items, { a: 'cluster_in', b: 'cluster_x' });
  assert.throws(() => editDot(FLOW, { op: 'group', id: 'x', ids: ['b'] }), /there is a cluster_x already/);
  assert.throws(() => editDot(FLOW, { op: 'group', id: 'y', ids: ['b'], parent: 'cluster_q' }), /no container cluster_q/);
  assert.throws(() => editDot(FLOW, { op: 'group', id: 'y', ids: ['zz'] }), /no node zz/);
});

test('moveTo: a node mentioned only in edges inside a container leaves it, the other end stays', () => {
  // a is in cluster_x through `a -> c` alone
  const r = edit({ op: 'moveTo', ids: ['a'] });
  assert.deepEqual(diff(FLOW, r), ['    a -> c [lines=A]\n  }\n  a -> b -> d [lines="A B"]   // a chain\n  {b d} -> e [lines=B]',
    '  }\n  a -> b -> d [lines="A B"]   // a chain\n  {b d} -> e [lines=B]\n  a -> c [lines=A]']);
  assert.deepEqual(groupsOf(r).items, { a: null, b: null, c: 'cluster_x', d: null, e: null });
  // c leaves: a keeps a mention in cluster_x, the comment after c's declaration stays in place
  const t = FLOW.replace('c [label="C"]', 'c [label="C"]   // see c');
  const c = edit({ op: 'moveTo', ids: ['c'] }, t);
  assert.deepEqual(diff(t, c), ['    c [label="C"]   // see c\n    a -> c [lines=A]\n  }\n  a -> b -> d [lines="A B"]   // a chain\n  {b d} -> e [lines=B]',
    '    // see c\n    a\n  }\n  a -> b -> d [lines="A B"]   // a chain\n  {b d} -> e [lines=B]\n  c [label="C"]\n  a -> c [lines=A]']);
  assert.deepEqual(groupsOf(c).items, { a: 'cluster_x', b: null, c: null, d: null, e: null });
  // a node only mentioned in edges goes into a container as a bare mention; its edges stay
  const d = edit({ op: 'moveTo', ids: ['d'], group: 'cluster_x' });
  assert.deepEqual(diff(FLOW, d), ['', '    d']);
  assert.equal(groupsOf(d).items.d, 'cluster_x');
  // already there: nothing changes
  assert.equal(edit({ op: 'moveTo', ids: ['c'], group: 'cluster_x' }), FLOW);
  assert.throws(() => editDot(FLOW, { op: 'moveTo', ids: ['b'], group: 'cluster_q' }), /no container cluster_q/);
});

test('moveTo: edges between moved nodes go with them; nested containers', () => {
  // out of a nested container to the top: p -> q goes too, q -> r leaves cluster_x
  const top = edit({ op: 'moveTo', ids: ['p', 'q'] }, NEST);
  assert.deepEqual(diff(NEST, top), ['      p -> q [lines=A]   // inner\n    }\n    q -> r [lines=A]\n  }\n  r -> s [lines=A]',
    '      // inner\n    }\n    r\n  }\n  r -> s [lines=A]\n  p -> q [lines=A]\n  q -> r [lines=A]']);
  assert.deepEqual(groupsOf(top).items, { p: null, q: null, r: 'cluster_x', s: null });
  // one level up: the edge between them is written in cluster_x, where both now are
  const up = edit({ op: 'moveTo', ids: ['p', 'q'], group: 'cluster_x' }, NEST);
  assert.deepEqual(diff(NEST, up), ['      p -> q [lines=A]   // inner\n    }\n    q -> r [lines=A]', '      // inner\n    }\n    q -> r [lines=A]\n    p -> q [lines=A]']);
  assert.deepEqual(groupsOf(up).items, { p: 'cluster_x', q: 'cluster_x', r: 'cluster_x', s: null });
  // one leaves the inner container: the other keeps its mention there
  const q = edit({ op: 'moveTo', ids: ['q'], group: 'cluster_x' }, NEST);
  assert.deepEqual(diff(NEST, q), ['      p -> q [lines=A]   // inner\n    }\n    q -> r [lines=A]', '      p   // inner\n    }\n    q -> r [lines=A]\n    p -> q [lines=A]']);
  assert.deepEqual(groupsOf(q).items, { p: 'cluster_y', q: 'cluster_x', r: 'cluster_x', s: null });
  // down into the nested one, from the top
  const s = edit({ op: 'moveTo', ids: ['s'], group: 'cluster_y' }, NEST);
  assert.deepEqual(diff(NEST, s), ['', '      s']);
  assert.deepEqual(groupsOf(s).items, { p: 'cluster_y', q: 'cluster_y', r: 'cluster_x', s: 'cluster_y' });
  // a new container inside the nested one
  const z = edit({ op: 'group', id: 'z', label: 'Z', ids: ['p'], parent: 'cluster_y' }, NEST);
  assert.deepEqual(diff(NEST, z), ['', '      subgraph cluster_z {\n        label = "Z"\n        p\n      }']);
  assert.deepEqual(groupsOf(z), { items: { p: 'cluster_z', q: 'cluster_y', r: 'cluster_x', s: null }, groups: { cluster_x: null, cluster_y: 'cluster_x', cluster_z: 'cluster_y' } });
});

test('moveTo and group take the notes attached to the nodes along', () => {
  const r = edit({ op: 'moveTo', ids: ['c'] }, NOTE);
  assert.deepEqual(groupsOf(r).items, { a: 'cluster_x', b: null, c: null, d: null, e: null, n: null });
  const into = edit({ op: 'moveTo', ids: ['c'], group: 'cluster_x' }, r);
  assert.deepEqual(groupsOf(into).items, { a: 'cluster_x', b: null, c: 'cluster_x', d: null, e: null, n: 'cluster_x' });
  const g = edit({ op: 'group', id: 'y', ids: ['c'], parent: 'cluster_x' }, NOTE);
  assert.deepEqual(diff(NOTE, g), ['    c [label="C"]\n    a -> c [lines=A]\n  }\n  a -> b -> d [lines="A B"]   // a chain\n  {b d} -> e [lines=B]\n  n [shape=note, label="hi"]',
    '    a -> c [lines=A]\n    subgraph cluster_y {\n      c [label="C"]\n      n [shape=note, label="hi"]\n    }\n  }\n  a -> b -> d [lines="A B"]   // a chain\n  {b d} -> e [lines=B]']);
  assert.deepEqual(groupsOf(g).items, { a: 'cluster_x', b: null, c: 'cluster_y', d: null, e: null, n: 'cluster_y' });
  // no label: none written, so the id names it
  assert.equal(parseFlow(g).groupById.get('cluster_y').label, 'y');
  // a note moved on its own leaves its node where it is
  const n = edit({ op: 'moveTo', ids: ['n'], group: 'cluster_x' }, NOTE);
  assert.deepEqual(groupsOf(n).items, { a: 'cluster_x', b: null, c: 'cluster_x', d: null, e: null, n: 'cluster_x' });
});

test('removeGroup: members and nested containers go to its parent, one indent less', () => {
  const y = edit({ op: 'removeGroup', id: 'cluster_y' }, NEST);
  assert.deepEqual(diff(NEST, y), ['    subgraph cluster_y {\n      p -> q [lines=A]   // inner\n    }', '    p -> q [lines=A]   // inner']);
  assert.deepEqual(groupsOf(y), { items: { p: 'cluster_x', q: 'cluster_x', r: 'cluster_x', s: null }, groups: { cluster_x: null } });
  const x = edit({ op: 'removeGroup', id: 'cluster_x' }, NEST);
  assert.equal(x, `digraph g {
  subgraph lines { A }
  subgraph cluster_y {
    p -> q [lines=A]   // inner
  }
  q -> r [lines=A]
  r -> s [lines=A]
}
`);
  assert.deepEqual(groupsOf(x), { items: { p: 'cluster_y', q: 'cluster_y', r: null, s: null }, groups: { cluster_y: null } });
  // edges to its box go; on one line; an empty one
  const box = 'digraph g { subgraph lines { A } subgraph cluster_x { label=X; a -> b [lines=A] } c -> cluster_x [lines=A]; c -> a [lines=A] }';
  assert.equal(edit({ op: 'removeGroup', id: 'cluster_x' }, box), 'digraph g { subgraph lines { A } a -> b [lines=A] c -> a [lines=A] }');
  assert.equal(edit({ op: 'removeGroup', id: 'cluster_e' }, 'digraph g { a\n  subgraph cluster_e {\n    label = "E"\n  }\n}'), 'digraph g { a\n}');
  // node or edge defaults keep their scope in a plain subgraph
  const scoped = 'digraph g { subgraph lines { A } subgraph cluster_x { node [shape=box]; label=X; a -> b [lines=A] } }';
  const s = edit({ op: 'removeGroup', id: 'cluster_x' }, scoped);
  assert.equal(s, 'digraph g { subgraph lines { A } subgraph { node [shape=box]; a -> b [lines=A] } }');
  assert.deepEqual(groupsOf(s), { items: { a: null, b: null }, groups: {} });
  // an edge from another container's box to it goes without leaving that box behind as a node
  const boxes = 'digraph g { subgraph lines { A } subgraph cluster_x { a } subgraph cluster_y { b } subgraph cluster_z { c; cluster_x -> cluster_y [lines=A] } }';
  const bx = edit({ op: 'removeGroup', id: 'cluster_y' }, boxes);
  assert.equal(bx, 'digraph g { subgraph lines { A } subgraph cluster_x { a } b subgraph cluster_z { c; } }');
  assert.deepEqual(groupsOf(bx).items, { a: 'cluster_x', b: null, c: 'cluster_z' });
  assert.throws(() => editDot(FLOW, { op: 'removeGroup', id: 'cluster_q' }), /no container cluster_q/);
});

test('every example takes a round of edits and stays valid', () => {
  for (const f of ['examples/webshop.dot', 'examples/platform.dot', 'examples/postal.dot', 'docs/pipeline.dot']) {
    const text = fs.readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8');
    const model = parseFlow(text);
    const [e] = model.edges, [n] = model.nodes;
    let t = editDot(text, [{ op: 'pos', id: n.id, x: 1, y: 2 }, { op: 'via', from: e.from, to: e.to, points: [[3, 4]] }]);
    assert.equal(parseFlow(t).items.get(n.id).x, 1, f);
    t = editDot(t, { op: 'removeNode', id: n.id });
    const after = parseFlow(t);
    assert.ok(!after.items.has(n.id), f);
    assert.equal(after.items.size, model.items.size - 1, `${f}: only ${n.id} goes`);
  }
});

test('every example takes container edits and stays valid', () => {
  for (const f of ['examples/webshop.dot', 'examples/platform.dot', 'examples/postal.dot', 'docs/pipeline.dot']) {
    const text = fs.readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8');
    const model = parseFlow(text);
    for (const g of model.groups) {
      const after = parseFlow(editDot(text, { op: 'removeGroup', id: g.id }));
      assert.ok(!after.groupById.has(g.id), `${f}: ${g.id}`);
      for (const n of model.nodes) assert.equal(after.items.get(n.id).group, n.group === g.id ? g.parent : n.group, `${f}: ${n.id} after ${g.id} goes`);
    }
    const ids = model.nodes.slice(0, 3).map((n) => n.id);
    const grouped = parseFlow(editDot(text, { op: 'group', id: 'cluster_new', label: 'New', ids }));
    for (const id of ids) assert.equal(grouped.items.get(id).group, 'cluster_new', `${f}: ${id}`);
    for (const n of model.nodes.slice(3)) assert.equal(grouped.items.get(n.id).group, n.group, `${f}: ${n.id} stays`);
    const out = parseFlow(editDot(text, { op: 'moveTo', ids }));
    for (const id of ids) assert.equal(out.items.get(id).group, null, `${f}: ${id}`);
  }
});

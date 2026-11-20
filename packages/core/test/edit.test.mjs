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

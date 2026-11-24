// statementsOf: where the statements about each node, edge, container and line are in the text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statementsOf } from '../index.mjs';

const FLOW = `digraph g {
  subgraph lines { A; B }
  a [label="Shop",
     pos="100,100"];
  subgraph cluster_x {
    label = "X"
    c [label="C"]
    a -> c [lines=A]
  }
  a -> b -> d [lines="A B"]
  {b d} -> cluster_x [lines=B]
  a [pos="120,100"]
}
`;

const short = (s) => ({ ...s, text: FLOW.slice(s.start, s.end) });

test('every statement with its line range and offsets, in text order (by where they start)', () => {
  const st = statementsOf(FLOW).map(short);
  assert.deepEqual(st.map((s) => [s.kind, s.id ?? s.pairs.map((p) => p.join('>')).join(' '), s.line, s.endLine]), [
    ['line', 'A', 2, 2],
    ['line', 'B', 2, 2],
    ['node', 'a', 3, 4],
    ['group', 'cluster_x', 5, 9],
    ['node', 'c', 7, 7],
    ['edge', 'a>c', 8, 8],
    ['edge', 'a>b b>d', 10, 10],
    ['edge', 'b>cluster_x d>cluster_x', 11, 11],
    ['node', 'a', 12, 12],
  ]);
  const a = st.find((s) => s.kind === 'node');
  assert.match(a.text, /^a \[label="Shop",\n\s+pos="100,100"\];?$/);
  assert.equal(st.find((s) => s.kind === 'group').text.split('\n').at(-1).trim(), '}');
  // the end leaves out the line break after a statement without `;`
  assert.equal(st.find((s) => s.kind === 'edge').text, 'a -> c [lines=A]');
});

test('an edge statement names every id it mentions', () => {
  const e = statementsOf(FLOW).filter((s) => s.kind === 'edge');
  assert.deepEqual(e.map((s) => s.ids), [['a', 'c'], ['a', 'b', 'd'], ['b', 'd', 'cluster_x']]);
});

test('a text that cannot be read throws', () => {
  assert.throws(() => statementsOf('graph { a -- b }'), /digraph/);
});

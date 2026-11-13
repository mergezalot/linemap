// Every way a DOT file can be wrong gives a clear linemap error, not a crash further down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlow, layout } from '../index.mjs';

const L = 'subgraph lines { A }';
// [what, DOT text, expected message]
const CASES = [
  // the DOT parser rejects a file without a graph before linemap sees it
  ['no graph', '', /Expected .*"digraph"/],
  ['undirected graph', 'graph g { a -- b }', /must be a digraph/],
  ['empty graph', 'digraph g { }', /the graph has no nodes/],
  ['unknown attribute', `digraph g { ${L} a [colour="#fff"] }`, /node a: unknown attribute "colour"/],
  ['unknown shape', `digraph g { ${L} a [shape=hexagon] }`, /node a: unknown shape "hexagon"/],
  ['unknown theme', `digraph g { theme=sepia; ${L} a }`, /graph: unknown theme "sepia"/],
  ['unknown line', `digraph g { ${L} a -> b [lines=B] }`, /edge a->b: unknown line "B"/],
  ['edge without lines', `digraph g { ${L} a -> b }`, /edge a->b has no lines/],
  ['loop', `digraph g { ${L} a -> a [lines=A] }`, /edge a->a is a loop/],
  ['line declared twice', 'digraph g { subgraph lines { A; A } a }', /line "A" declared twice/],
  ['node in two clusters', `digraph g { ${L} subgraph cluster_x { a } subgraph cluster_y { a } }`, /node a is in both/],
  ['cluster used as node', `digraph g { ${L} subgraph cluster_x { a } cluster_x [label=x] }`, /"cluster_x" is a cluster, so it cannot also be a node/],
  ['note carrying lines', `digraph g { ${L} n [shape=note]; n -> a [lines=A] }`, /attaches a note, so it cannot carry lines/],
  ['note linking notes', `digraph g { ${L} n [shape=note]; m [shape=note]; n -> m }`, /links two notes/],
  ['note on two nodes', `digraph g { ${L} n [shape=note]; n -> a; n -> b }`, /note n: attached to both a and b/],
  ['note on a container', `digraph g { ${L} subgraph cluster_x { a } n [shape=note]; n -> cluster_x }`, /a note attaches to a node, not a container/],
  ['bad pos', `digraph g { ${L} a [pos="1.2.3,4"] }`, /node a: pos: expected "x,y", got "1.2.3,4"/],
  ['bad via', `digraph g { ${L} a -> b [lines=A, via="1,2 x"] }`, /edge a->b: via: expected "x,y", got "x"/],
  ['bad width', `digraph g { ${L} a [width=wide] }`, /node a: width: expected a number of inches/],
  ['zero width', `digraph g { ${L} a [width=0] }`, /node a: width: expected a number of inches above zero/],
  ['zero height', `digraph g { ${L} a [height=0.0] }`, /node a: height: expected a number of inches above zero/],
  ['bad fontsize', `digraph g { ${L} a [fontsize=big] }`, /node a: fontsize: expected a number of px, got "big"/],
  ['bad through', `digraph g { ${L} a [through=yes] }`, /node a: through must be true or false, got "yes"/],
  ['through on a diamond', `digraph g { ${L} a [shape=diamond, through=true] }`, /through=true needs one of the shapes/],
  ['named colour', `digraph g { ${L} a [color=red] }`, /node a: color: expected a colour like #1565c0, got "red"/],
  ['bad line colour', 'digraph g { subgraph lines { A [color="#12345"] } a }', /line A: color: expected a colour like #1565c0/],
  ['colour breaking out', 'digraph g { subgraph lines { A [color="red\\" onload=\\"x"] } a }', /line A: color: expected a colour/],
  ['bad fillcolor', `digraph g { ${L} subgraph cluster_x { fillcolor=blue; a } }`, /cluster cluster_x: fillcolor: expected a colour/],
  ['javascript URL', `digraph g { ${L} a [URL="javascript:alert(1)"] }`, /node a: URL must be http\(s\), mailto or relative, got "javascript:alert\(1\)"/],
  ['data href', `digraph g { ${L} a [href="data:text/html,x"] }`, /node a: URL must be http\(s\), mailto or relative/],
  ['container without members', `digraph g { ${L} subgraph cluster_x { label=X } a -> cluster_x [lines=A] }`, /container cluster_x has no members/],
];

for (const [what, dot, message] of CASES) {
  test(what, () => {
    assert.throws(() => layout(parseFlow(dot)), message);
  });
}

test('good colours and URLs pass', () => {
  const m = parseFlow(`digraph g { subgraph lines { A [color="#ABC"]; B [color="#1565C0"] }
    a [URL="https://example.com", fontcolor="#000"]; b [href="mailto:x@example.com"]; c [URL="docs/a.html#x"]; d [href="?q=1"]
    a -> b -> c -> d [lines="A B"] }`);
  assert.deepEqual(m.lines.map((l) => l.color), ['#aabbcc', '#1565c0']);
  assert.deepEqual(m.nodes.map((n) => n.url), ['https://example.com', 'mailto:x@example.com', 'docs/a.html#x', '?q=1']);
});

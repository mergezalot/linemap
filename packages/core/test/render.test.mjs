// The whole pipeline, DOT text to SVG: it runs, its output is well-formed, and nothing from the DOT
// file reaches the SVG unescaped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseFlow, layout, render, positions, THEME_NAMES } from '../index.mjs';

const root = new URL('../../../', import.meta.url);
const draw = (dot, opts) => render(layout(parseFlow(dot)), opts);

// A small well-formedness pass: tags balance, attributes are name="value" with no raw < or " in
// the value, and text between tags uses only the XML entities.
function assertWellFormed(svg) {
  const stack = [];
  const TAG = /<(\/?)([\w:-]+)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/y;
  let i = 0;
  while (i < svg.length) {
    const lt = svg.indexOf('<', i);
    const text = svg.slice(i, lt < 0 ? svg.length : lt);
    for (const m of text.matchAll(/&[^;\s]*;?/g)) {
      assert.match(m[0], /^&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);$/i, `bad entity ${m[0]} at ${i}`);
    }
    if (lt < 0) break;
    TAG.lastIndex = lt;
    const m = TAG.exec(svg);
    assert.ok(m, `malformed tag at ${lt}: ${svg.slice(lt, lt + 80)}`);
    const [, close, name, , self] = m;
    if (close) assert.equal(stack.pop(), name, `</${name}> at ${lt} closes the wrong element`);
    else if (!self) stack.push(name);
    i = TAG.lastIndex;
  }
  assert.deepEqual(stack, [], 'unclosed elements');
}

test('the README sample parses, lays out and renders', () => {
  const readme = fs.readFileSync(new URL('README.md', root), 'utf8');
  const dot = /```dot\n([\s\S]*?)```/.exec(readme)[1];
  const svg = draw(dot);
  assert.match(svg, /^<svg /);
  assertWellFormed(svg);
  for (const id of ['sender', 'desk', 'check', 'done', 'hint']) assert.match(svg, new RegExp(`id="${id}"`));
});

test('labels, ids and classes from the DOT file come out escaped', () => {
  const evil = 'x\\"<>&y';
  const svg = draw(`digraph g {
    subgraph lines { "${evil}" [label="${evil}"] }
    subgraph "cluster_${evil}" { label="${evil}"; class="${evil}"
      "${evil}" [label="${evil}", class="${evil}", URL="a.html?q=${evil}"] }
    b [shape=person, label="${evil}"]; c [through=true, label="${evil}"]
    n [shape=note, label="${evil}"]; n -> b
    "${evil}" -> b -> c [lines="${evil}", label="${evil}"]
  }`);
  assertWellFormed(svg);
  assert.doesNotMatch(svg, /x"<>&y/, 'raw input in the output');
  assert.match(svg, /x&quot;&lt;&gt;&amp;y/);
});

test('the css option cannot end the style element', () => {
  assert.throws(() => draw('digraph g { a }', { css: 'a{}</style><script>x</script>' }), /css: must not contain "<\/style"/);
  assert.match(draw('digraph g { a }', { css: '.lm-bg{fill:#000}' }), /\.lm-bg\{fill:#000\}/);
});

test('layout twice on one model throws', () => {
  const m = layout(parseFlow('digraph g { a }'));
  assert.throws(() => layout(m), /already laid out/);
});

test('hiddenLines and fixed keep every position', () => {
  const dot = fs.readFileSync(new URL('examples/webshop.dot', root), 'utf8');
  const first = layout(parseFlow(dot));
  const at = (m) => Object.fromEntries([...m.items.values()].map((n) => [n.id, [n.x, n.y]]));
  const hidden = layout(parseFlow(dot), { hiddenLines: new Set([first.lines[0].id]) });
  assert.deepEqual(at(hidden), at(first));
  assert.ok(hidden.edges.every((e) => e.lines.every((l) => l.id !== first.lines[0].id)));
  const fixed = new Map(positions(first).map(({ id, x, y }) => [id, { x, y }]));
  assert.deepEqual(at(layout(parseFlow(dot), { fixed })), at(first));
});

test('every theme renders', () => {
  const dot = fs.readFileSync(new URL('docs/pipeline.dot', root), 'utf8');
  for (const theme of THEME_NAMES) {
    const svg = draw(dot, { theme });
    assert.match(svg, new RegExp(`data-theme="${theme}"`), theme);
    assertWellFormed(svg);
  }
});

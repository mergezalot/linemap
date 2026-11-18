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

// Note badges in an SVG drawn with noteIcons: the square of each and the node it is on.
const badgesOf = (svg) => [...svg.matchAll(/<g class="note lm-note-folded[^>]*?(?: data-attach="([^"]+)")?><g class="lm-note-icon"><path d="M[\d.-]+,[\d.-]+ Q([\d.-]+),([\d.-]+) /g)]
  .map(([, id, x, y]) => ({ id, x0: +x, y0: +y, x1: +x + 22, y1: +y + 22 }));
const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

test('notes: hide lays the map out without them; noteIcons puts badges on their nodes', () => {
  const dot = fs.readFileSync(new URL('examples/webshop.dot', root), 'utf8');
  const shownModel = layout(parseFlow(dot));
  const model = layout(parseFlow(dot), { notes: 'hide' });
  const count = (svg, re) => (svg.match(re) ?? []).length;
  assert.equal(model.notes.length, 0);
  assert.equal(model.noteLinks.length, 0);
  assert.equal(model.hiddenNotes.length, shownModel.notes.length);
  assert.ok(model.hiddenNotes.every((n) => !model.items.has(n.id)));
  const inRect = (p, r) => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;
  const through = (e, r) => e.path.slice(1).some((b, i) => {
    const a = e.path[i];
    return Array.from({ length: 19 }, (_, k) => (k + 1) / 20).some((t) => inRect({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, r));
  });
  // the notes' room is free: in the postal example, lines now run where notes were
  const postal = fs.readFileSync(new URL('examples/postal.dot', root), 'utf8');
  const [withNotes, without] = [layout(parseFlow(postal)), layout(parseFlow(postal), { notes: 'hide' })];
  const noteRects = withNotes.notes.map((n) => ({ x0: n.x - n.w / 2, y0: n.y - n.h / 2, x1: n.x + n.w / 2, y1: n.y + n.h / 2 }));
  assert.ok(without.edges.some((e) => noteRects.some((r) => through(e, r))), 'no line uses the room of a note');
  assert.ok(!withNotes.edges.some((e) => noteRects.some((r) => through(e, r))));

  const hidden = render(model);
  assertWellFormed(hidden);
  assert.equal(count(hidden, /class="(note|lm-note)/g), 0);

  const icons = render(model, { noteIcons: true });
  assertWellFormed(icons);
  assert.equal(count(icons, /<g class="note lm-note-folded/g), model.hiddenNotes.length);
  assert.equal(count(icons, /class="lm-note-icon"/g), model.hiddenNotes.length);
  assert.equal(count(icons, /class="lm-note-link"/g), 0);
  assert.match(icons, /<title>Kept for 2 years\.<\/title>/);
  assert.match(icons, /data-attach="lake"/);
  assert.match(icons, /\.lm-note-folded:not\(\.lm-open\)>\.lm-note-full/);
  // badges: a fixed spot on their node, whatever is there; half-transparent until pointed at
  const badges = badgesOf(icons);
  assert.equal(badges.length, model.hiddenNotes.length);
  const near = (v, w) => Math.abs(v - w) < 0.11;
  for (const b of badges) {
    const n = model.items.get(b.id);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const spot = {
      diamond: [n.x + n.w / 4, n.y - n.h / 4],               // on the middle of its upper right side
      person: [n.x + n.w * 0.2, n.y + n.h * 0.25],           // on its chest
    }[n.shape] ?? [n.x + n.w / 2 - 18, n.y - n.h / 2 + 18];  // inside the top right corner
    assert.ok(near(cx, spot[0]) && near(cy, spot[1]), `badge on ${b.id} (${n.shape}) at its fixed spot`);
    assert.ok(overlap(b, { x0: n.x - n.w / 2, y0: n.y - n.h / 2, x1: n.x + n.w / 2, y1: n.y + n.h / 2 }), `badge on ${b.id} is on it`);
  }
  assert.deepEqual(new Set(badges.map((b) => model.items.get(b.id).shape)), new Set(['box', 'diamond', 'cylinder', 'person']));
  assert.match(icons, /\.lm-note-icon\{opacity:\.55/);
  assert.match(icons, /\.lm-note-folded:hover>\.lm-note-icon/);
  // the badges are not laid out: the map is drawn exactly as without them
  const plain = (svg) => svg.replace(/<style>[^]*?<\/style>/, '').replace(/\n<g class="note lm-note-folded[^]*?<\/g><\/g>/g, '');
  assert.equal(plain(icons), plain(hidden));
  // shown notes are not affected by noteIcons
  assert.equal(render(shownModel, { noteIcons: true }), render(shownModel));
  assert.throws(() => layout(parseFlow(dot), { notes: 'icon' }), /layout: notes must be show or hide, not "icon"/);
});

test('noteIcons: a note with no node has its badge in the top right corner of the map', () => {
  const dot = `digraph t { subgraph lines { A }
    a -> b [lines=A]
    n1 [shape=note, label="Loose"]
  }`;
  const model = layout(parseFlow(dot), { notes: 'hide' });
  const [loose] = badgesOf(render(model, { noteIcons: true }));
  assert.equal(loose.id, undefined);
  const right = Math.max(...model.nodes.map((n) => n.x + n.w / 2)), top = Math.min(...model.nodes.map((n) => n.y - n.h / 2));
  assert.ok(Math.abs(loose.x1 - (right - 7)) < 0.11 && Math.abs(loose.y0 - (top + 7)) < 0.11, JSON.stringify(loose));
});

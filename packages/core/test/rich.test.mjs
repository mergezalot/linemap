// HTML-like note labels: the supported tags, errors that name the tag, rendering into escaped
// tspans, and the way back from text typed in the studio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlow, layout, render, editDot } from '../index.mjs';
import { parseRich, plainOf, isStyled, hasRichTags, toHtml } from '../src/rich.mjs';

const L = 'subgraph lines { A }';
const flow = (label) => `digraph g { ${L} a; n [shape=note, label=${label}]; a -> n }`;
const noteOf = (dot) => parseFlow(dot).notes.find((n) => n.id === 'n');

test('rows of styled runs, whitespace collapsed, entities decoded', () => {
  const rows = parseRich(' Hello <b>bold <i>both</i></b><br/>  <u>u</u> <s>s</s> <font color="#C00">red</font> &lt;x&gt; &amp; &#65;&#x42; ');
  assert.deepEqual(rows, [
    [{ text: 'Hello ' }, { text: 'bold ', b: true }, { text: 'both', b: true, i: true }],
    [{ text: 'u', u: true }, { text: ' ' }, { text: 's', s: true }, { text: ' ' }, { text: 'red', color: '#c00' }, { text: ' <x> & AB' }],
  ]);
  assert.equal(plainOf(rows), 'Hello bold both\nu s red <x> & AB');
  assert.ok(isStyled(rows));
  assert.ok(!isStyled(parseRich('a<br/>b')));
  assert.deepEqual(parseRich('<font color="#000080" face="Arial">x</font>'), [[{ text: 'x', color: '#000080' }]]);
});

test('other tags, bad nesting and bad colours are errors that say so', () => {
  for (const [html, re] of [
    ['<table><tr><td>x</td></tr></table>', /<table> is not supported/],
    ['<img src="x"/>', /<img> is not supported/],
    ['<sub>2</sub>', /<sub> is not supported/],
    ['<b>x', /<b> is not closed/],
    ['<b><i>x</b></i>', /<\/b> closes <i>/],
    ['x</i>', /<\/i> closes nothing/],
    ['<font color="red">y</font>', /font color must be hex/],
  ]) assert.throws(() => parseRich(html), re, html);
  assert.throws(() => parseFlow(flow('<<table><tr><td>x</td></tr></table>>')), /DOT line 1: label: HTML-like label: <table> is not supported/);
});

test('a note with styles is sized and drawn from its runs; plain HTML-like labels stay plain', () => {
  const n = noteOf(flow('<Plain<br/>two rows>'));
  assert.equal(n.label, 'Plain\ntwo rows');
  assert.equal(n.rich, null);
  const r = noteOf(flow('<<b>Bold</b> and <font color="#1565c0">blue</font>>'));
  assert.equal(r.label, 'Bold and blue');
  assert.ok(r.rich && r.w > noteOf(flow('"Bold and blue"')).w, 'bold runs a little wider');
  const svg = render(layout(parseFlow(flow('<<b>Bold</b> <i>&lt;script&gt;</i><br/><u>u</u><s>s</s><font color="#1565c0">blue</font>>'))));
  const text = /<text[^>]*class="lm-note-text"[^>]*>(.*?)<\/text>/s.exec(svg)[1];
  assert.match(text, /<tspan font-weight="700">Bold<\/tspan> <tspan font-style="italic">&lt;script&gt;<\/tspan><\/tspan>/);
  assert.match(text, /<tspan text-decoration="underline">u<\/tspan><tspan text-decoration="line-through">s<\/tspan><tspan fill="#1565c0">blue<\/tspan>/);
  assert.ok(!svg.includes('<script'));
});

test('typed text with a supported tag becomes an HTML-like label; other text stays a quoted string', () => {
  assert.ok(hasRichTags('a <b>b</b>') && hasRichTags('x<br>y') && !hasRichTags('a < b > c') && !hasRichTags('<table>'));
  assert.equal(toHtml('Use <b>this</b> & <that>\nnext <i>open'), 'Use <b>this</b> &amp; &lt;that&gt;<br/>next <i>open</i>');
  assert.equal(toHtml('stray </b> here <font color="#c00">x'), 'stray &lt;/b&gt; here <font color="#c00">x</font>');
  assert.equal(toHtml('&amp; stays'), '&amp; stays');
  const dot = `digraph g {\n  ${L}\n  a\n}\n`;
  const out = editDot(dot, { op: 'addNode', id: 'n', label: 'A <b>bold</b> note\nsecond row', shape: 'note' });
  assert.match(out, /n \[label=<A <b>bold<\/b> note<br\/>second row>, shape=note\]/);
  const n = parseFlow(`${out.replace(/\}\s*$/, '')}  a -> n\n}\n`).notes[0];
  assert.equal(n.label, 'A bold note\nsecond row');
  assert.deepEqual(n.rich[0][1], { text: 'bold', b: true });
  const plain = editDot(dot, { op: 'addNode', id: 'n', label: 'a < b\nc', shape: 'note' });
  assert.match(plain, /n \[label="a < b\\nc", shape=note\]/);
  // a node's label is never written as HTML-like
  assert.match(editDot(dot, { op: 'addNode', id: 'm', label: '<b>x</b>' }), /m \[label="<b>x<\/b>"\]/);
});

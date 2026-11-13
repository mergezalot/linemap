// The committed drawings are what the code draws today: each example renders to exactly its SVG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseFlow, layout, render } from '../index.mjs';

const root = new URL('../../../', import.meta.url);
const FILES = [
  ...fs.readdirSync(new URL('examples/', root)).filter((f) => f.endsWith('.dot')).map((f) => [`examples/${f}`, 'pnpm example']),
  ['docs/pipeline.dot', 'pnpm example'],
];

for (const [dot, script] of FILES) {
  test(dot, () => {
    const svg = render(layout(parseFlow(fs.readFileSync(new URL(dot, root), 'utf8'))));
    const committed = fs.readFileSync(new URL(dot.replace(/\.dot$/, '.svg'), root), 'utf8');
    assert.ok(svg === committed,
      `${dot} no longer renders to its committed SVG. Run \`${script}\` and look at the result; commit it if it looks right.`);
  });
}

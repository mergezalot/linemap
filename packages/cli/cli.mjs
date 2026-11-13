#!/usr/bin/env node
// linemap <flow.dot> <out.svg> [options]; `linemap --help` lists the options.
// Exit codes: 0 done, 1 the file could not be drawn, 2 wrong usage.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseFlow, layout, crowding, render, positions, THEMES, THEME_NAMES } from '@linemap/core';

const USAGE = `usage: linemap <flow.dot> <out.svg> [options]

  --theme <name>   ${THEME_NAMES.join(', ')} (default: the DOT file's \`theme\`, else minimal)
  --css <file>     a CSS file added after the theme's, to restyle any lm-* class
  --positions      also print the computed position of every unpinned node and note,
                   ready to paste into the DOT file as \`pos\` to pin it
  -h, --help       print this help
  -v, --version    print the version`;

// Wrong usage: the problem, then the usage, and exit 2.
function usage(problem) {
  console.error(`linemap: ${problem}\n\n${USAGE}`);
  process.exit(2);
}

let opts;
try {
  opts = parseArgs({
    strict: true,
    allowPositionals: true,
    options: {
      theme: { type: 'string' },
      css: { type: 'string' },
      positions: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
} catch (e) {
  usage(e.message);
}
const { values: o, positionals } = opts;
if (o.help) {
  console.log(USAGE);
  process.exit(0);
}
if (o.version) {
  const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}
if (o.theme !== undefined && !THEMES[o.theme]) usage(`unknown theme "${o.theme}" (known: ${THEME_NAMES.join(', ')})`);
if (positionals.length !== 2) usage(`expected an input and an output file, got ${positionals.length} argument${positionals.length === 1 ? '' : 's'}`);
const [input, output] = positionals;

// File errors carry the path, so the one line says which file.
const read = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { throw new Error(`${file}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`); }
};
const write = (file, data) => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  } catch (e) { throw new Error(`${file}: ${e.message}`); }
};

function run() {
  let model;
  try {
    model = layout(parseFlow(read(input)));
  } catch (e) {
    // the DOT parser's errors point at a line and column of the input
    const at = e.name === 'DotSyntaxError' ? (e.cause?.location ?? e.location)?.start : null;
    if (at) throw new Error(`${input}:${at.line}:${at.column}: ${e.message}`, { cause: e });
    throw e;
  }
  for (const w of crowding(model)) console.error(`warning: ${w}`);
  const svg = render(model, { theme: o.theme, css: o.css !== undefined ? read(o.css) : '' });
  write(output, svg);
  console.error(`wrote ${output}: ${model.nodes.length} nodes, ${model.notes.length} notes, ${model.edges.length} edges`);

  if (o.positions) {
    for (const { id, x, y } of positions(model)) console.log(`${id} [pos="${x},${y}"]`);
  }
}

try {
  run();
} catch (e) {
  // one line, unless LINEMAP_DEBUG=1 asks for the stack
  console.error(process.env.LINEMAP_DEBUG === '1' ? (e.cause?.stack ?? e.stack) : `linemap: ${e.message}`);
  process.exit(1);
}

#!/usr/bin/env node
// linemap export | studio [...]; `linemap --help` lists the options.
// Exit codes: 0 done, 1 the file could not be drawn (or served), 2 wrong usage.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseFlow, layout, crowding, render, positions, legendPosition, THEMES, THEME_NAMES, NOTE_MODES } from '@linemap/core';
import { studioHtml, serve, announce, openBrowser } from '@linemap/studio';

const USAGE = `usage: linemap <command> [options]

linemap export [flow.dot ...] [-o <out.svg|out.html>] [options]
  writes a file; its extension picks what:
    .svg    the map as a static SVG of one flow; without -o, each flow given gets
            its own <flow>.svg beside it
    .html   the studio as one self-contained HTML file, with the flows baked in;
            no flows gives the empty studio (default with no flows: linemap.html)
  -o, --out <file>   the file to write
  --theme <name>     ${THEME_NAMES.join(', ')}
                     (default: the DOT file's \`theme\`, else minimal; SVG only)
  --css <file>       a CSS file added after the theme's, to restyle any lm-* class (SVG only)
  --legend show|hide draw the legend of the lines or not (default: show; SVG only); place it
                     in the DOT file with \`legend\` (bottom-left, top, right-bottom, ...)
                     or \`legendpos="x,y"\`
  --notes <mode>     ${NOTE_MODES.join(', ')}: hide draws the map as if the notes were not there,
                     so boxes and lines may take their room (default: show; SVG only)
  --positions        also print the computed position of every unpinned node and note,
                     ready to paste into the DOT file as \`pos\` to pin it, and the legend's
                     as \`legendpos\` (SVG only)

linemap studio [dir] [options]
  serves the studio and the DOT files under dir (default: here) on this machine;
  open one with #src=<file>, and Watch redraws it on every save
  --port <n>         default 8000
  --open             also open the studio in the browser

  -h, --help         print this help
  -v, --version      print the version`;

// Wrong usage: the problem, then the usage, and exit 2.
function usage(problem) {
  console.error(`linemap: ${problem}\n\n${USAGE}`);
  process.exit(2);
}

const COMMON = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};
const COMMANDS = {
  export: {
    out: { type: 'string', short: 'o' },
    theme: { type: 'string' },
    css: { type: 'string' },
    legend: { type: 'string' },
    positions: { type: 'boolean' },
    notes: { type: 'string' },
  },
  studio: {
    port: { type: 'string' },
    open: { type: 'boolean' },
  },
};

const argv = process.argv.slice(2);
const command = Object.hasOwn(COMMANDS, argv[0]) ? argv[0] : null;
let opts;
try {
  opts = parseArgs({ args: command ? argv.slice(1) : argv, strict: true, allowPositionals: true, options: { ...COMMON, ...COMMANDS[command] } });
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
if (!command) usage(positionals.length ? `unknown command "${positionals[0]}" (known: ${Object.keys(COMMANDS).join(', ')})` : 'no command');

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

// The flow in a DOT file; the DOT parser's errors point at a line and column of it.
function load(file, text = read(file)) {
  try {
    return parseFlow(text);
  } catch (e) {
    const at = e.name === 'DotSyntaxError' ? (e.cause?.location ?? e.location)?.start : null;
    if (at) throw new Error(`${file}:${at.line}:${at.column}: ${e.message}`, { cause: e });
    throw e;
  }
}

function exportSvg(input, output, heading = false) {
  const legend = o.legend !== 'hide';
  const model = layout(load(input), { notes: o.notes, legend });
  for (const w of crowding(model)) console.error(`warning: ${w}`);
  const svg = render(model, { legend, theme: o.theme, css: o.css !== undefined ? read(o.css) : '' });
  write(output, svg);
  const notes = model.hiddenNotes.length ? `${model.hiddenNotes.length} notes left out` : `${model.notes.length} notes`;
  console.error(`wrote ${output}: ${model.nodes.length} nodes, ${notes}, ${model.edges.length} edges`);

  if (o.positions) {
    if (heading) console.log(`// ${input}`);
    for (const { id, x, y } of positions(model)) console.log(`${id} [pos="${x},${y}"]`);
    const at = legend && legendPosition(model);
    if (at) console.log(`legendpos="${at.x},${at.y}"`);
  }
}

// Every flow is parsed first, so a broken file fails here and not later in the browser.
function exportHtml(inputs, output) {
  const flows = inputs.map((file) => {
    const text = read(file);
    load(file, text);
    return { name: path.basename(file), text };
  });
  const html = studioHtml(flows);
  write(output, html);
  const what = flows.length ? `${flows.length} flow${flows.length === 1 ? '' : 's'}` : 'no flows';
  console.error(`wrote ${output}: the studio with ${what} (${Math.round(Buffer.byteLength(html) / 1024)} KiB)`);
}

function exportCommand() {
  const inputs = positionals;
  const output = o.out ?? (inputs.length ? inputs[0].replace(/(\.[^./\\]*)?$/, '.svg') : 'linemap.html');
  const ext = path.extname(output).toLowerCase();
  if (ext === '.svg') {
    if (o.out !== undefined && inputs.length !== 1) {
      usage(`an SVG is drawn from exactly one flow, got ${inputs.length}${inputs.length ? '; leave out -o to write one SVG beside each flow' : ''}`);
    }
    if (o.legend !== undefined && !['show', 'hide'].includes(o.legend)) usage(`--legend must be show or hide, got "${o.legend}"`);
    if (o.theme !== undefined && !THEMES[o.theme]) usage(`unknown theme "${o.theme}" (known: ${THEME_NAMES.join(', ')})`);
    if (o.notes !== undefined && !NOTE_MODES.includes(o.notes)) usage(`unknown notes mode "${o.notes}" (known: ${NOTE_MODES.join(', ')})`);
    if (o.out !== undefined) return exportSvg(inputs[0], output);
    for (const input of inputs) exportSvg(input, input.replace(/(\.[^./\\]*)?$/, '.svg'), inputs.length > 1);
    return;
  }
  if (ext === '.html' || ext === '.htm') {
    const svgOnly = ['theme', 'css', 'legend', 'positions', 'notes'].filter((k) => o[k] !== undefined);
    if (svgOnly.length) usage(`${svgOnly.map((k) => `--${k}`).join(', ')} only ${svgOnly.length === 1 ? 'applies' : 'apply'} to an SVG export`);
    return exportHtml(inputs, output);
  }
  usage(`the output must end in .svg or .html, got "${output}"`);
}

async function studioCommand() {
  if (positionals.length > 1) usage(`expected at most one folder, got ${positionals.length}`);
  const dir = path.resolve(positionals[0] ?? '.');
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${positionals[0]}: no such folder`);
  const port = o.port === undefined ? 8000 : Number(o.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) usage(`--port must be a port number, got "${o.port}"`);

  const html = studioHtml(); // read once: the page does not change while serving
  let server;
  try {
    server = await serve({ root: dir, port, page: () => html, onError: (e) => console.error(`linemap: ${e.message}`) });
  } catch (e) {
    if (e.code === 'EADDRINUSE') throw new Error(`port ${port} is in use; pick another with --port`);
    throw e;
  }
  const { text, url } = announce(server, dir);
  console.log(text);
  if (o.open) openBrowser(url);
}

try {
  await (command === 'export' ? exportCommand() : studioCommand());
} catch (e) {
  // one line, unless LINEMAP_DEBUG=1 asks for the stack
  console.error(process.env.LINEMAP_DEBUG === '1' ? (e.cause?.stack ?? e.stack) : `linemap: ${e.message}`);
  process.exit(1);
}

// The command line as a user meets it: exit codes, one-line errors, help and version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'cli.mjs');
const root = path.join(here, '..', '..', '..');
const pipeline = path.join(root, 'docs', 'pipeline.dot');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linemap-cli-'));
const out = path.join(tmp, 'out.svg');

const run = (...args) => {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, LINEMAP_DEBUG: '' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const usageError = (r, problem) => {
  assert.equal(r.code, 2);
  assert.match(r.err, problem);
  assert.match(r.err, /usage: linemap <command>/);
};

const html = path.join(tmp, 'out.html');
const examples = (...names) => names.map((n) => path.join(root, 'examples', n));
// the flows baked into a studio page
const bakedFlows = (file) => JSON.parse(fs.readFileSync(file, 'utf8').match(/<script type="application\/json" id="linemap-flows">(.*?)<\/script>/s)[1]);

test('export writes the SVG', () => {
  const r = run('export', pipeline, '-o', out);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /wrote .*out\.svg: \d+ nodes/);
  assert.match(fs.readFileSync(out, 'utf8'), /^<svg /);
});

test('a missing file is one line with its path', () => {
  const r = run('export', path.join(tmp, 'nope.dot'), '-o', out);
  assert.equal(r.code, 1);
  assert.equal(r.err, `linemap: ${path.join(tmp, 'nope.dot')}: no such file\n`);
});

test('a syntax error is one line with line and column, no stack', () => {
  const bad = path.join(tmp, 'bad.dot');
  fs.writeFileSync(bad, 'digraph g {\n  a -> \n}\n');
  const r = run('export', bad, '-o', out);
  assert.equal(r.code, 1);
  assert.match(r.err, new RegExp(`^linemap: ${bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:3:1: Expected .*\n$`));
  assert.doesNotMatch(r.err, /\n\s+at /);
});

test('an error from the model is one line', () => {
  const bad = path.join(tmp, 'colour.dot');
  fs.writeFileSync(bad, 'digraph g { subgraph lines { A [color=red] } a }');
  const r = run('export', bad, '-o', out);
  assert.equal(r.code, 1);
  assert.equal(r.err, 'linemap: line A: color: expected a colour like #1565c0, got "red"\n');
});

test('--notes hide leaves the notes out, --notes show draws them', () => {
  const r = run('export', pipeline, '-o', out, '--notes', 'hide');
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /1 notes left out,/);
  const svg = fs.readFileSync(out, 'utf8');
  assert.doesNotMatch(svg, /class="(note|lm-note)/);
  assert.match(svg, /class="node/);
  assert.match(run('export', pipeline, '-o', out, '--notes', 'show').err, /1 notes,/);
  assert.match(fs.readFileSync(out, 'utf8'), /<g class="note"/);
});

test('an unknown flag is wrong usage', () => usageError(run('export', pipeline, '-o', out, '--bogus'), /Unknown option '--bogus'/));
test('--theme without a value is wrong usage', () => usageError(run('export', pipeline, '-o', out, '--theme'), /argument missing/));
test('an unknown notes mode is wrong usage', () => usageError(run('export', pipeline, '-o', out, '--notes', 'icon'), /unknown notes mode "icon" \(known: show, hide\)/));
test('an unknown theme is wrong usage', () => usageError(run('export', pipeline, '-o', out, '--theme', 'sepia'), /unknown theme "sepia"/));
test('--png is gone', () => usageError(run('export', pipeline, '-o', out, '--png'), /Unknown option '--png'/));
test('no command is wrong usage', () => usageError(run(), /no command/));
test('the old form without a command is wrong usage', () => usageError(run(pipeline, out), /unknown command ".*pipeline\.dot" \(known: export, studio\)/));
test('studio flags on export are wrong usage', () => usageError(run('export', pipeline, '--port', '1'), /Unknown option '--port'/));
test('an SVG from two flows is wrong usage', () => usageError(run('export', pipeline, pipeline, '-o', out), /exactly one flow, got 2/));
test('an SVG from no flow is wrong usage', () => usageError(run('export', '-o', out), /exactly one flow, got 0/));
test('an unknown output type is wrong usage', () => usageError(run('export', pipeline, '-o', 'x.png'), /must end in \.svg or \.html, got "x\.png"/));
test('SVG options on an HTML export are wrong usage', () => {
  usageError(run('export', pipeline, '-o', html, '--theme', 'dark'), /--theme only applies to an SVG export/);
  usageError(run('export', pipeline, '-o', html, '--css', 'a.css', '--positions'), /--css, --positions only apply to an SVG export/);
  usageError(run('export', pipeline, '-o', html, '--notes', 'hide'), /--notes only applies to an SVG export/);
});

test('export without -o writes <flow>.svg beside the flow', () => {
  const dot = path.join(tmp, 'beside.dot');
  fs.copyFileSync(pipeline, dot);
  const r = run('export', dot);
  assert.equal(r.code, 0, r.err);
  assert.match(fs.readFileSync(path.join(tmp, 'beside.svg'), 'utf8'), /^<svg /);
});

test('export to .html bakes the flows into the studio', () => {
  const r = run('export', ...examples('webshop.dot', 'postal.dot'), '-o', html);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /wrote .*out\.html: the studio with 2 flows \(\d+ KiB\)/);
  const flows = bakedFlows(html);
  assert.deepEqual(flows.map((f) => f.name), ['webshop.dot', 'postal.dot']);
  assert.equal(flows[0].text, fs.readFileSync(examples('webshop.dot')[0], 'utf8'));
});

test('a flow cannot end the script element it is baked into', () => {
  const dot = path.join(tmp, 'script.dot');
  const text = 'digraph g { a [label="</script><b>"] }\n';
  fs.writeFileSync(dot, text);
  assert.equal(run('export', dot, '-o', html).code, 0);
  assert.equal(fs.readFileSync(html, 'utf8').match(/<\/script>/g).length, 2); // the flows' and the code's
  assert.equal(bakedFlows(html)[0].text, text);
});

test('export with no flows writes the empty studio, by default linemap.html', () => {
  const r = spawnSync(process.execPath, [cli, 'export'], { cwd: tmp, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /wrote linemap\.html: the studio with no flows/);
  assert.deepEqual(bakedFlows(path.join(tmp, 'linemap.html')), []);
});

test('an HTML export checks every flow first', () => {
  const bad = path.join(tmp, 'bad-html.dot');
  fs.writeFileSync(bad, 'digraph g {\n  a -> \n}\n');
  fs.rmSync(html, { force: true });
  const r = run('export', pipeline, bad, '-o', html);
  assert.equal(r.code, 1);
  assert.match(r.err, /^linemap: .*bad-html\.dot:3:1: /);
  assert.ok(!fs.existsSync(html));
});

// Starts `linemap studio`, waits for its first lines, and returns them with the process.
function studio(...args) {
  const child = spawn(process.execPath, [cli, 'studio', ...args], { encoding: 'utf8' });
  return new Promise((resolve, reject) => {
    let outText = '', errText = '';
    child.stdout.on('data', (d) => { outText += d; if (/\n  http.*\n/.test(outText)) resolve({ child, out: outText }); });
    child.stderr.on('data', (d) => { errText += d; });
    child.on('exit', (code) => reject(new Error(`exited ${code}: ${errText}`)));
  });
}

test('studio serves the page and the DOT files, and lists them', async () => {
  const dir = path.join(tmp, 'served');
  fs.mkdirSync(path.join(dir, 'sub dir'), { recursive: true });
  fs.copyFileSync(pipeline, path.join(dir, 'sub dir', 'flow.dot'));
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'no');
  const { child, out: text } = await studio(dir, '--port', '0');
  try {
    const base = text.match(/http:\/\/localhost:\d+/)[0];
    assert.match(text, /studio\.html#src=sub%20dir\/flow\.dot\n/);
    const page = await fetch(`${base}/studio.html`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /id="linemap-flows">\[\]<\/script>/);
    assert.equal(await (await fetch(`${base}/sub%20dir/flow.dot`)).text(), fs.readFileSync(pipeline, 'utf8'));
    assert.equal((await fetch(`${base}/secret.txt`)).status, 404);
    assert.equal((await fetch(`${base}/%2e%2e/%2e%2e/x.dot`)).status, 404);
  } finally {
    child.kill();
  }
});

test('studio on a missing folder is one line', () => {
  const r = run('studio', path.join(tmp, 'nope'));
  assert.equal(r.code, 1);
  assert.equal(r.err, `linemap: ${path.join(tmp, 'nope')}: no such folder\n`);
});
test('studio with a bad port is wrong usage', () => usageError(run('studio', '--port', 'x'), /--port must be a port number, got "x"/));

test('--help prints the usage with every option', () => {
  for (const flag of ['--help', '-h']) {
    const r = run(flag);
    assert.equal(r.code, 0);
    assert.equal(r.err, '');
    for (const o of ['export', 'studio', '--out', '--theme', '--css', '--positions', '--port', '--open', '--help', '--version']) assert.match(r.out, new RegExp(o));
  }
});

test('--version prints the package version', () => {
  const { version } = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
  for (const flag of ['--version', '-v']) {
    const r = run(flag);
    assert.equal(r.code, 0);
    assert.equal(r.out, `${version}\n`);
  }
});

test('--positions prints a pos line per unpinned item', () => {
  const r = run('export', pipeline, '-o', out, '--positions');
  assert.equal(r.code, 0, r.err);
  const rows = r.out.trim().split('\n');
  assert.ok(rows.length > 0);
  for (const row of rows) assert.match(row, /^\S+ \[pos="-?\d+(\.\d+)?,-?\d+(\.\d+)?"\]$/);
});

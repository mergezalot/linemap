// The command line as a user meets it: exit codes, one-line errors, help and version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
  assert.match(r.err, /usage: linemap <flow\.dot> <out\.svg>/);
};

test('a good run writes the SVG', () => {
  const r = run(pipeline, out);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /wrote .*out\.svg: \d+ nodes/);
  assert.match(fs.readFileSync(out, 'utf8'), /^<svg /);
});

test('a missing file is one line with its path', () => {
  const r = run(path.join(tmp, 'nope.dot'), out);
  assert.equal(r.code, 1);
  assert.equal(r.err, `linemap: ${path.join(tmp, 'nope.dot')}: no such file\n`);
});

test('a syntax error is one line with line and column, no stack', () => {
  const bad = path.join(tmp, 'bad.dot');
  fs.writeFileSync(bad, 'digraph g {\n  a -> \n}\n');
  const r = run(bad, out);
  assert.equal(r.code, 1);
  assert.match(r.err, new RegExp(`^linemap: ${bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:3:1: Expected .*\n$`));
  assert.doesNotMatch(r.err, /\n\s+at /);
});

test('an error from the model is one line', () => {
  const bad = path.join(tmp, 'colour.dot');
  fs.writeFileSync(bad, 'digraph g { subgraph lines { A [color=red] } a }');
  const r = run(bad, out);
  assert.equal(r.code, 1);
  assert.equal(r.err, 'linemap: line A: color: expected a colour like #1565c0, got "red"\n');
});

test('an unknown flag is wrong usage', () => usageError(run(pipeline, out, '--bogus'), /Unknown option '--bogus'/));
test('--theme without a value is wrong usage', () => usageError(run(pipeline, out, '--theme'), /argument missing/));
test('an unknown theme is wrong usage', () => usageError(run(pipeline, out, '--theme', 'sepia'), /unknown theme "sepia"/));
test('one file is wrong usage', () => usageError(run(pipeline), /expected an input and an output file, got 1 argument/));
test('--png is gone', () => usageError(run(pipeline, out, '--png'), /Unknown option '--png'/));

test('--help prints the usage with every option', () => {
  for (const flag of ['--help', '-h']) {
    const r = run(flag);
    assert.equal(r.code, 0);
    assert.equal(r.err, '');
    for (const o of ['--theme', '--css', '--positions', '--help', '--version']) assert.match(r.out, new RegExp(o));
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
  const r = run(pipeline, out, '--positions');
  assert.equal(r.code, 0, r.err);
  const rows = r.out.trim().split('\n');
  assert.ok(rows.length > 0);
  for (const row of rows) assert.match(row, /^\S+ \[pos="-?\d+(\.\d+)?,-?\d+(\.\d+)?"\]$/);
});

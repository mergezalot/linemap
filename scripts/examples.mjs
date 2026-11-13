// Redraws every committed picture: examples/*.dot and docs/pipeline.dot to SVG, and the README's
// screenshot of the studio (docs/studio.png, the postal example with the Parcel line pinned).
//   pnpm example               all of them
//   pnpm example --svg-only    the SVGs only: no browser needed (CI checks these against git)
// The screenshot needs `pnpm --filter @linemap/studio exec playwright install chromium` once.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (...args) => execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });

const flows = [
  ...fs.readdirSync(path.join(root, 'examples')).filter((f) => f.endsWith('.dot')).map((f) => `examples/${f}`),
  'docs/pipeline.dot',
];
for (const dot of flows) run('packages/cli/cli.mjs', dot, dot.replace(/\.dot$/, '.svg'));

if (!process.argv.includes('--svg-only')) {
  run('packages/studio/screenshot.mjs', 'examples/postal.dot', 'docs/studio.png', '--line', 'C');
}

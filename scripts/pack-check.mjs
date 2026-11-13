// Checks the npm tarballs as a user would get them: packs @linemap/core and @linemap/cli, installs both
// into an empty folder outside the repository, draws an example with `npx @linemap/cli`, and checks
// that the bundled MSAGL carries its license header.
//   pnpm pack-check
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linemap-pack-'));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const fail = (msg) => { console.error(`pack-check: ${msg}`); process.exit(1); };

try {
  const tarballs = ['core', 'cli'].map((dir) => {
    const out = run('pnpm', ['pack', '--pack-destination', tmp], path.join(root, 'packages', dir));
    const file = out.trim().split('\n').pop().trim();
    console.log(`packed ${path.basename(file)}`);
    return path.isAbsolute(file) ? file : path.join(tmp, path.basename(file));
  });

  // the CLI's tarball must name core by version, not workspace:
  const cliPkg = JSON.parse(run('tar', ['-xOzf', tarballs[1], 'package/package.json']));
  const dep = cliPkg.dependencies?.['@linemap/core'];
  if (!dep || dep.startsWith('workspace:')) fail(`@linemap/cli depends on @linemap/core as "${dep}"`);

  // each tarball carries its README (the npm page) and the license, and publishes as public
  for (const file of tarballs) {
    const entries = run('tar', ['-tzf', file]).split('\n');
    for (const need of ['package/README.md', 'package/LICENSE']) {
      if (!entries.includes(need)) fail(`${path.basename(file)} has no ${need.slice(8)}`);
    }
    const pkg = JSON.parse(run('tar', ['-xOzf', file, 'package/package.json']));
    if (pkg.publishConfig?.access !== 'public') fail(`${pkg.name} has no publishConfig.access "public"`);
  }

  const app = path.join(tmp, 'app');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'package.json'), '{ "private": true }\n');
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', ...tarballs], app);

  const header = fs.readFileSync(path.join(app, 'node_modules/@linemap/core/vendor/msagl.mjs'), 'utf8').slice(0, 2000);
  if (!/^\/\*!/.test(header) || !/@msagl\/core [\d.]+ \(MIT\)/.test(header) || !/MIT License/.test(header)) {
    fail('vendor/msagl.mjs in the tarball has no license header');
  }

  const out = path.join(app, 'webshop.svg');
  run('npx', ['--no-install', '@linemap/cli', path.join(root, 'examples/webshop.dot'), out], app);
  if (!fs.readFileSync(out, 'utf8').startsWith('<svg ')) fail('npx @linemap/cli wrote no SVG');
  const version = run('npx', ['--no-install', '@linemap/cli', '--version'], app).trim();

  console.log(`pack-check: ok (@linemap/cli ${version}, @linemap/core ${dep}, license header present)`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

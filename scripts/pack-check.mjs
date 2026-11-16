// Checks the npm tarballs as a user would get them: packs @linemap/core, @linemap/studio and
// @linemap/cli, installs them into an empty folder outside the repository, exports an example to SVG
// and to HTML with `npx @linemap/cli`, and checks that the bundled MSAGL carries its license header.
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
  const tarballs = ['core', 'studio', 'cli'].map((dir) => {
    const out = run('pnpm', ['pack', '--pack-destination', tmp], path.join(root, 'packages', dir));
    const file = out.trim().split('\n').pop().trim();
    console.log(`packed ${path.basename(file)}`);
    return path.isAbsolute(file) ? file : path.join(tmp, path.basename(file));
  });

  // the CLI's tarball must name core and studio by version, not workspace:
  const cliPkg = JSON.parse(run('tar', ['-xOzf', tarballs[2], 'package/package.json']));
  for (const name of ['@linemap/core', '@linemap/studio']) {
    const v = cliPkg.dependencies?.[name];
    if (!v || v.startsWith('workspace:')) fail(`@linemap/cli depends on ${name} as "${v}"`);
  }
  const dep = cliPkg.dependencies['@linemap/core'];

  // the studio's tarball carries the built page, and needs nothing at runtime
  const studioEntries = run('tar', ['-tzf', tarballs[1]]).split('\n');
  if (!studioEntries.includes('package/dist/linemap.html')) fail('@linemap/studio has no dist/linemap.html');
  const studioPkg = JSON.parse(run('tar', ['-xOzf', tarballs[1], 'package/package.json']));
  if (Object.keys(studioPkg.dependencies ?? {}).length) fail(`@linemap/studio has dependencies: ${Object.keys(studioPkg.dependencies)}`);

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
  run('npx', ['--no-install', '@linemap/cli', 'export', path.join(root, 'examples/webshop.dot'), '-o', out], app);
  if (!fs.readFileSync(out, 'utf8').startsWith('<svg ')) fail('npx @linemap/cli wrote no SVG');
  const page = path.join(app, 'webshop.html');
  run('npx', ['--no-install', '@linemap/cli', 'export', path.join(root, 'examples/webshop.dot'), '-o', page], app);
  if (!fs.readFileSync(page, 'utf8').includes('"name":"webshop.dot"')) fail('npx @linemap/cli wrote no studio page with the flow');
  const version = run('npx', ['--no-install', '@linemap/cli', '--version'], app).trim();

  console.log(`pack-check: ok (@linemap/cli ${version}, @linemap/core ${dep}, SVG and HTML export, license header present)`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

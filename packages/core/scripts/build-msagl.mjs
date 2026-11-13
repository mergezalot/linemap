// Bundles the parts of @msagl/core that src/msagl.mjs uses into vendor/msagl.mjs, one ES module
// that runs in node and the browser as it is. (The package's own ESM build has extensionless
// imports, which node cannot load, and its index does not export Shape.) vendor/ is not in git:
// `pnpm install` runs this (core's `prepare` script).
//   node scripts/build-msagl.mjs       (pnpm --filter @linemap/core build:msagl)
// @msagl/core is patched (patches/@msagl__core@1.1.24.patch): its sparse visibility graph
// incremented the overlap depth on leaving an obstacle, so every obstacle after the first was
// invisible to the router.
//
// Licenses: @msagl/core and most of what it pulls in are MIT; reliable-random is Apache-2.0.
// Both want their notice kept with every copy, so the full text of each bundled package's
// license goes into a /*! */ comment at the top of msagl.mjs, which esbuild keeps when the
// studio bundles it.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor');
const pkgDir = path.dirname(createRequire(import.meta.url).resolve('@msagl/core/package.json'));
const src = path.join(pkgDir, 'src');
const names = {
  RectilinearEdgeRouter: 'routing/rectilinear/RectilinearEdgeRouter',
  Shape: 'routing/shape',
  GeomEdge: 'layout/core/geomEdge',
  FloatingPort: 'layout/core/floatingPort',
  RelativeFloatingPort: 'layout/core/relativeFloatingPort',
  Point: 'math/geometry/point',
  Polyline: 'math/geometry/polyline',
  // placement (place.mjs): MSAGL's layered (Sugiyama) layout
  layoutGeomGraph: 'layout/driver',
  SugiyamaLayoutSettings: 'layout/layered/sugiyamaLayoutSettings',
  LayerDirectionEnum: 'layout/layered/layerDirectionEnum',
  EdgeRoutingMode: 'routing/EdgeRoutingMode',
  Size: 'math/geometry/rectangle',
  Graph: 'structs/graph',
  Node: 'structs/node',
  Edge: 'structs/edge',
  GeomGraph: 'layout/core/geomGraph',
  GeomNode: 'layout/core/geomNode',
  CurveFactory: 'math/geometry/curveFactory',
  // edge labels (bundle.mjs)
  EdgeLabelPlacement: 'layout/edgeLabelPlacement',
  GeomLabel: 'layout/core/geomLabel',
  Label: 'structs/label',
};
const entry = Object.entries(names)
  .map(([n, f]) => `export {${n}} from ${JSON.stringify(path.join(src, f))}`).join('\n');
const options = {
  stdin: { contents: entry, loader: 'ts', resolveDir: src },
  // msagl is written for tsc's old class-field semantics: a field declared without a value must
  // not overwrite what a base-class constructor already set.
  tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2022',
  minify: true,
  legalComments: 'none', // the bundled packages' licenses go in whole, below
  write: false,
  metafile: true,
  logLevel: 'warning',
};
const first = await esbuild.build(options);

// The packages that ended up in the bundle (by their package.json), with their license texts.
const packages = new Map();
for (const input of Object.keys(first.metafile.inputs)) {
  if (input === '<stdin>') continue;
  let dir = path.dirname(path.resolve(input)); // relative to the working directory
  while (dir !== path.dirname(dir) && !fs.existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir);
  if (packages.has(dir)) continue;
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  if (!file) throw new Error(`${pkg.name}: no license file to bundle`);
  const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim();
  packages.set(dir, { name: pkg.name, version: pkg.version, license: pkg.license ?? spdx(text), text });
}
// for a package.json without a license field
function spdx(text) {
  if (/Apache License\s+Version 2\.0/.test(text)) return 'Apache-2.0';
  if (/^\s*MIT License/.test(text)) return 'MIT';
  throw new Error(`cannot tell the license of:\n${text.slice(0, 200)}`);
}
const list = [...packages.values()].sort((a, b) => (a.name === '@msagl/core' ? -1 : b.name === '@msagl/core' ? 1 : a.name.localeCompare(b.name)));
const notices = list.map((p) => `${'='.repeat(78)}\n${p.name} ${p.version} (${p.license})\n${'='.repeat(78)}\n\n${p.text}\n`).join('\n');
if (notices.includes('*/')) throw new Error('a license text contains "*/"');

const header = 'vendor/msagl.mjs: parts of @msagl/core (https://github.com/microsoft/msagljs), bundled and\n' +
  'minified by scripts/build-msagl.mjs, with a patch (patches/@msagl__core@1.1.24.patch). Do not edit.\n' +
  `It contains these packages: ${list.map((p) => `${p.name} ${p.version} (${p.license})`).join(', ')}.\n` +
  'Their licenses follow.\n\n';
fs.mkdirSync(out, { recursive: true });
await esbuild.build({ ...options, metafile: false, write: true, outfile: path.join(out, 'msagl.mjs'), banner: { js: `/*!\n${header}${notices}*/` } });
console.log(`wrote vendor/msagl.mjs: ${list.map((p) => p.name).join(', ')}`);

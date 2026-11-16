// Builds the studio into one self-contained HTML file: dist/linemap.html, with the JS
// (studio + @linemap/core, MSAGL included) and the CSS inline.
// That file is the template `linemap export` fills with flows.
//   node build.mjs                                     build              (pnpm build)
//   node build.mjs --serve [dir] [--port n] [--open]   build, then serve like `linemap studio`, with
//                                                      the page rebuilt when its sources change
//                                                      (pnpm studio); dir defaults to the repo
// build({ embed, out }) also bakes flows in, for the tests and the README's screenshot.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as esbuild from 'esbuild';
import { embed as embedFlows } from './index.mjs';
import { serve as serveStudio, announce, openBrowser } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, 'src');
const out = path.join(here, 'dist', 'linemap.html');
const root = path.resolve(here, '../..');

// The notice at the top of the HTML: linemap's license (MPL-2.0). MSAGL's licenses travel with its code
// as a /*! */ comment, which esbuild keeps at the end of the script.
function licenses() {
  const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').trim();
  const parts = [
    'linemap studio, © 2026 Michael Karlen. linemap is free software under the Mozilla Public License 2.0:',
    read(path.join(root, 'LICENSE')),
    'This file contains parts of MSAGL (Microsoft Automatic Graph Layout, MIT) and its\n' +
      'dependencies; their license texts are in the /*! ... */ comment in the script below.',
  ];
  const text = parts.join('\n\n' + '='.repeat(78) + '\n\n');
  if (text.includes('-->') || text.includes('--!>')) throw new Error('a license text would end the HTML comment early');
  return `<!--\n${text}\n-->`;
}

export async function build({ embed = [], out: target = out } = {}) {
  const js = await esbuild.build({
    entryPoints: [path.join(src, 'main.mjs')],
    bundle: true,
    platform: 'browser', // fails on node built-ins, which keeps core free of them
    format: 'iife',
    target: 'es2022',
    minify: true,
    write: false,
    logLevel: 'warning',
  });
  const css = fs.readFileSync(path.join(src, 'style.css'), 'utf8');
  // `</script` inside the bundle would end the script element early; `<\/script` means the same in JS.
  const code = js.outputFiles[0].text.replace(/<\/(script)/gi, '<\\/$1');
  // the logo (docs/logo.svg) as a data URI: the toolbar's brand and the tab's icon
  const logo = `data:image/svg+xml;base64,${fs.readFileSync(path.join(root, 'docs', 'logo.svg')).toString('base64')}`;
  const fill = { CSS: css, JS: code, FLOWS: '[]', LOGO: logo };
  const page = fs.readFileSync(path.join(src, 'index.html'), 'utf8')
    .replace('<!--@LICENSES@-->', () => licenses())
    .replace(/\/\*@(CSS|JS|FLOWS|LOGO)@\*\//g, (_, k) => fill[k]); // a function, so `$` in the code stays as it is
  // the plain build is the template that `linemap export` fills; --embed fills it the same way
  const flows = embed.map((f) => ({ name: path.basename(f), text: fs.readFileSync(f, 'utf8') }));
  const html = flows.length ? embedFlows(page, flows) : page;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html);
  return { file: target, bytes: html.length, flows: flows.length };
}

// `linemap studio` for working on the studio: the page is rebuilt when its sources are newer than
// the last build. Resolves with the listening server (port 0 = any free port).
export async function serve({ dir = root, port = 8000, quiet = false, open = false } = {}) {
  let built = sourcesTime();
  const server = await serveStudio({
    root: dir,
    port,
    page: async () => {
      const t = sourcesTime();
      if (t > built) { built = t; await build(); console.log('rebuilt'); }
      return fs.readFileSync(out);
    },
  });
  const { text, url } = announce(server, dir);
  if (!quiet) console.log(text);
  if (open) openBrowser(url);
  return server;
}

// Newest modification time of the studio's sources, to rebuild on request when they changed.
const sourcesTime = () => Math.max(...fs.readdirSync(src).map((f) => fs.statSync(path.join(src, f)).mtimeMs));

// Paths are relative to where the command was typed (pnpm runs scripts elsewhere and keeps that in
// INIT_CWD).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const { values: o, positionals } = parseArgs({
    allowPositionals: true,
    options: { serve: { type: 'boolean' }, port: { type: 'string' }, open: { type: 'boolean' } },
  });
  const { file, bytes } = await build();
  console.log(`wrote ${path.relative(cwd, file)} (${Math.round(bytes / 1024)} KiB)`);
  if (o.serve) {
    const port = o.port === undefined ? 8000 : Number(o.port);
    await serve({ dir: positionals[0] ? path.resolve(cwd, positionals[0]) : root, port, open: o.open });
  }
}

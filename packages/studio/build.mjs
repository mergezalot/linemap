// Builds the studio into one self-contained HTML file: dist/linemap-studio.html, with the JS
// (studio + @linemap/core, MSAGL included) and the CSS inline.
//   node build.mjs           build
//   node build.mjs --embed a.dot [b.dot ...] [--out file.html]
//                            also bakes these flows into the file (default dist/<a>.html): it
//                            opens with the only one, or lists several on the start screen. For
//                            pages that cannot fetch files, e.g. an embed in Notion.
//   node build.mjs --serve   build, then serve the repo's DOT files on port 8000 (or $PORT), with the
//                            studio at /studio.html (rebuilt when its sources change), so
//                            /studio.html?src=examples/postal.dot works.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, 'src');
const out = path.join(here, 'dist', 'linemap-studio.html');
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

// Flows as JSON inside a script element; `<` escaped, so no `</script` can end it early.
const flowsJson = (flows) => JSON.stringify(flows).replace(/</g, '\\u003c');

export async function build({ embed = [], out: target = out } = {}) {
  const flows = embed.map((f) => ({ name: path.basename(f), text: fs.readFileSync(f, 'utf8') }));
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
  const fill = { CSS: css, JS: code, FLOWS: flowsJson(flows), LOGO: logo };
  const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8')
    .replace('<!--@LICENSES@-->', () => licenses())
    .replace(/\/\*@(CSS|JS|FLOWS|LOGO)@\*\//g, (_, k) => fill[k]); // a function, so `$` in the code stays as it is
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html);
  return { file: target, bytes: html.length, flows: flows.length };
}

// What the server hands out: the studio page and DOT files (.dot, .gv), nothing else in the folder.
const DOT = /\.(dot|gv)$/i;

// Newest modification time of the studio's sources, to rebuild on request when they changed.
const sourcesTime = () => Math.max(...fs.readdirSync(src).map((f) => fs.statSync(path.join(src, f)).mtimeMs));

// Resolves with the listening server (port 0 = any free port).
export function serve(port, { quiet = false } = {}) {
  let built = sourcesTime();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let file;
    try {
      if (url.pathname === '/') {
        res.writeHead(302, { location: '/studio.html' + url.search });
        return res.end();
      }
      if (url.pathname === '/studio.html') {
        const t = sourcesTime();
        if (t > built) { built = t; await build(); console.log('rebuilt'); }
        file = out;
      } else {
        file = path.join(root, decodeURIComponent(url.pathname));
        if (!file.startsWith(root + path.sep) || !DOT.test(file)) throw Object.assign(new Error('not served'), { code: 'ENOENT' });
      }
      const body = fs.readFileSync(file);
      res.writeHead(200, {
        'content-type': file === out ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
        'cache-control': 'no-store', // so "watch" sees every change
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (err) {
      const missing = err.code === 'ENOENT' || err.code === 'EISDIR';
      res.writeHead(missing ? 404 : 500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(missing ? `not found: ${url.pathname}\n` : `${err.message}\n`);
      if (!missing) console.error(err);
    }
  });
  // this machine only
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    resolve(server);
    if (quiet) return;
    const base = `http://localhost:${server.address().port}/studio.html`;
    console.log(`serving the DOT files in ${root}\n  ${base}`);
    for (const f of ['examples/webshop.dot', 'examples/platform.dot', 'examples/postal.dot', 'docs/pipeline.dot']) {
      if (fs.existsSync(path.join(root, f))) console.log(`  ${base}?src=${f}`);
    }
  }));
}

// --embed takes the files after it (up to the next --option); paths are relative to where the
// command was typed (pnpm runs scripts in the package folder and keeps that in INIT_CWD).
function parseArgs(argv) {
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const opts = { embed: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--embed') while (argv[i + 1] && !argv[i + 1].startsWith('--')) opts.embed.push(path.resolve(cwd, argv[++i]));
    else if (argv[i] === '--out') opts.out = path.resolve(cwd, argv[++i]);
  }
  if (opts.embed.length && !opts.out) opts.out = path.join(here, 'dist', `${path.basename(opts.embed[0]).replace(/\.[^.]+$/, '')}.html`);
  return opts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  const { file, bytes, flows } = await build(opts);
  console.log(`wrote ${path.relative(process.env.INIT_CWD ?? process.cwd(), file)} (${Math.round(bytes / 1024)} KiB${flows ? `, ${flows} flow${flows === 1 ? '' : 's'}` : ''})`);
  if (process.argv.includes('--serve')) serve(Number(process.env.PORT) || 8000);
}

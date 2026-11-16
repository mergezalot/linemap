// A local server for the studio: the page at /studio.html (/ redirects there, keeping ?src=) and the
// DOT files (.dot, .gv) under root, nothing else. `page` returns the HTML on every request, so a
// caller can rebuild it in between. Listens on 127.0.0.1 only; port 0 = any free port.
// Resolves with the listening server, rejects if it cannot listen (e.g. EADDRINUSE).
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

const DOT = /\.(dot|gv)$/i;

export function serve({ root, page, port = 8000, onError = console.error }) {
  root = path.resolve(root);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname === '/') {
        res.writeHead(302, { location: '/studio.html' + url.search });
        return res.end();
      }
      let body, type;
      if (url.pathname === '/studio.html') {
        body = await page();
        type = 'text/html; charset=utf-8';
      } else {
        const file = path.join(root, decodeURIComponent(url.pathname));
        if (!file.startsWith(root + path.sep) || !DOT.test(file)) throw Object.assign(new Error('not served'), { code: 'ENOENT' });
        body = fs.readFileSync(file);
        type = 'text/plain; charset=utf-8';
      }
      res.writeHead(200, {
        'content-type': type,
        'cache-control': 'no-store', // so "watch" sees every change
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (err) {
      const missing = err.code === 'ENOENT' || err.code === 'EISDIR' || err instanceof URIError;
      res.writeHead(missing ? 404 : 500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(missing ? `not found: ${url.pathname}\n` : `${err.message}\n`);
      if (!missing) onError(err);
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

// What a serving command prints: where it serves, the studio's URL, and one ?src= link per DOT file.
export function announce(server, root) {
  const base = `http://localhost:${server.address().port}/studio.html`;
  const files = dotFiles(root);
  const src = (f) => `${base}?src=${f.split('/').map(encodeURIComponent).join('/')}`;
  return {
    text: [`serving the studio and the DOT files in ${path.resolve(root)} (Ctrl+C stops)`, base, ...files.map(src)].join('\n  '),
    // the one to open: the only flow, or the start screen
    url: files.length === 1 ? src(files[0]) : base,
  };
}

// Opens a URL in the default browser; quietly does nothing where that fails.
export function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* no browser */ }
}

// DOT files under root, relative and with / separators, for listing ?src= links. Skips hidden
// folders and node_modules; stops at `max`.
export function dotFiles(root, max = 20) {
  const found = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (found.length >= max) return;
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (DOT.test(e.name)) found.push(r);
    }
  };
  walk(path.resolve(root), '');
  return found;
}

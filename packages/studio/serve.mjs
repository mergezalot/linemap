// A local server for the studio: the page at /studio.html (/ redirects there) and the
// DOT files (.dot, .gv) under root, nothing else. `page` returns the HTML on every request, so a
// caller can rebuild it in between. Listens on 127.0.0.1 only; port 0 = any free port.
// Resolves with the listening server, rejects if it cannot listen (e.g. EADDRINUSE).
// The studio's edit mode saves a file with PUT: only a DOT file that exists, only with the ETag
// it was read with (If-Match; 412 when the file changed since), and only from this server's own
// pages (Host and Origin are checked, so neither another site nor DNS rebinding can write).
// A DOT file's GET says so with `x-linemap-save: put`.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

const DOT = /\.(dot|gv)$/i;
const MAX_BODY = 4 << 20;
const etagOf = (buf) => `"${crypto.createHash('sha1').update(buf).digest('base64url')}"`;
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const fail = (status, message) => Object.assign(new Error(message), { status });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(fail(413, 'too large')); req.destroy(); } else parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

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
      const headers = { 'cache-control': 'no-store' }; // so "watch" sees every change
      if (url.pathname === '/studio.html') {
        body = await page();
        type = 'text/html; charset=utf-8';
      } else {
        const file = path.join(root, decodeURIComponent(url.pathname));
        if (!file.startsWith(root + path.sep) || !DOT.test(file)) throw Object.assign(new Error('not served'), { code: 'ENOENT' });
        if (req.method === 'PUT') return await save(req, res, file);
        body = fs.readFileSync(file);
        type = 'text/plain; charset=utf-8';
        Object.assign(headers, { etag: etagOf(body), 'x-linemap-save': 'put' });
      }
      res.writeHead(200, { 'content-type': type, ...headers });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (err) {
      const missing = err.code === 'ENOENT' || err.code === 'EISDIR' || err instanceof URIError;
      const status = err.status ?? (missing ? 404 : 500);
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...err.headers });
      res.end(missing ? `not found: ${url.pathname}\n` : `${err.message}\n`);
      if (status === 500) onError(err);
    }
  });
  // PUT: the file's new text, if it is still the one the page read
  async function save(req, res, file) {
    const host = req.headers.host ?? '';
    if (!LOCAL.test(host) || (req.headers.origin && req.headers.origin !== `http://${host}`)) throw fail(403, 'forbidden');
    if (!fs.statSync(file).isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
    const want = req.headers['if-match'];
    if (!want) throw fail(428, 'If-Match is required');
    const body = await readBody(req);
    const now = etagOf(fs.readFileSync(file));
    if (want !== now) throw Object.assign(fail(412, 'the file changed since it was read'), { headers: { etag: now } });
    fs.writeFileSync(file, body);
    res.writeHead(204, { etag: etagOf(body), 'cache-control': 'no-store' });
    res.end();
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

// What a serving command prints: where it serves, the studio's URL, and one #src= link per DOT file.
export function announce(server, root) {
  const base = `http://localhost:${server.address().port}/studio.html`;
  const files = dotFiles(root);
  const src = (f) => `${base}#src=${f.split('/').map(encodeURIComponent).join('/')}`;
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

// DOT files under root, relative and with / separators, for listing #src= links. Skips hidden
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

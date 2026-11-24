// The studio server: DOT files with an ETag, and PUT only for the file as it was read, from its
// own pages.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { serve } from '../serve.mjs';

let dir, server, port;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linemap-serve-'));
  fs.writeFileSync(path.join(dir, 'a.dot'), 'digraph a { x }\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'no');
  server = await serve({ root: dir, page: () => '<html></html>', port: 0, onError: () => {} });
  port = server.address().port;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

// http.request, so Host and Origin can be set as a browser (or an attacker) would
function req(method, p, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    r.on('error', reject);
    r.end(body);
  });
}
const read = () => fs.readFileSync(path.join(dir, 'a.dot'), 'utf8');

test('a DOT file comes with an ETag and says it can be saved', async () => {
  const r = await req('GET', '/a.dot');
  assert.equal(r.status, 200);
  assert.match(r.headers.etag, /^"[\w-]+"$/);
  assert.equal(r.headers['x-linemap-save'], 'put');
});

test('PUT with the ETag it was read with saves, and gives the new ETag', async () => {
  const { headers: { etag } } = await req('GET', '/a.dot');
  const r = await req('PUT', '/a.dot', { body: 'digraph a { y }\n', headers: { 'if-match': etag, origin: `http://localhost:${port}` } });
  assert.equal(r.status, 204);
  assert.equal(read(), 'digraph a { y }\n');
  assert.equal(r.headers.etag, (await req('GET', '/a.dot')).headers.etag);
});

test('PUT is refused without the current ETag, from elsewhere, and for other files', async () => {
  const before = read();
  const { headers: { etag } } = await req('GET', '/a.dot');
  assert.equal((await req('PUT', '/a.dot', { body: 'x' })).status, 428);
  const stale = await req('PUT', '/a.dot', { body: 'x', headers: { 'if-match': '"old"' } });
  assert.equal(stale.status, 412);
  assert.equal(stale.headers.etag, etag);
  assert.equal((await req('PUT', '/a.dot', { body: 'x', headers: { 'if-match': etag, origin: 'https://evil.example' } })).status, 403);
  assert.equal((await req('PUT', '/a.dot', { body: 'x', headers: { 'if-match': etag, host: 'evil.example' } })).status, 403);
  assert.equal((await req('PUT', '/new.dot', { body: 'x', headers: { 'if-match': etag } })).status, 404);
  assert.equal((await req('PUT', '/notes.txt', { body: 'x', headers: { 'if-match': etag } })).status, 404);
  assert.equal((await req('PUT', '/..%2Fescape.dot', { body: 'x', headers: { 'if-match': etag } })).status, 404);
  assert.equal(read(), before);
  assert.ok(!fs.existsSync(path.join(dir, '..', 'escape.dot')));
});

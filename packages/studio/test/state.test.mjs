// The URL hash: settings, view and src in and out (node:test; the page itself is in smoke.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readHash, hashOf } from '../src/state.mjs';

const settings = (hidden = [], mode = 'file', theme = null, notes = true) => ({ hidden: new Set(hidden), mode, theme, notes });

test('src is read from the hash, decoded', () => {
  assert.equal(readHash('#src=examples/postal.dot').src, 'examples/postal.dot');
  assert.equal(readHash('#src=sub%20dir/a%26b.dot&hide=A').src, 'sub dir/a&b.dot');
  assert.equal(readHash('#hide=A').src, null);
  assert.equal(readHash('#src=').src, null);
});

test('src goes first, readable, and round-trips', () => {
  const src = 'https://example.com/sub dir/a&b.dot?x=1#y';
  const h = hashOf(settings(['A']), null, src);
  assert.match(h, /^#src=https:\/\/example\.com\/sub%20dir\/a%26b\.dot%3Fx%3D1%23y&hide=A$/);
  const back = readHash(h);
  assert.equal(back.src, src);
  assert.deepEqual([...back.settings.hidden], ['A']);
});

test('no src, no src part', () => {
  assert.equal(hashOf(settings(), null, null), '');
  assert.equal(hashOf(settings([], 'all'), { x: 1, y: 2, w: 3, h: 4 }), '#through=all&view=1,2,3,4');
});

// Align and distribute: where the boxes' centres go (node:test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { arrange } from '../src/arrange.mjs';

const boxes = [
  { id: 'a', x: 50, y: 40, w: 60, h: 20 },   // 20..80 x, 30..50 y
  { id: 'b', x: 203, y: 100, w: 40, h: 40 }, // 183..223, 80..120
  { id: 'c', x: 120, y: 175, w: 100, h: 30 }, // 70..170, 160..190
];
const at = (r) => Object.fromEntries(r.map((o) => [o.id, [o.x, o.y]]));

test('align left, centre and right on the bounding box, the other axis kept', () => {
  assert.deepEqual(at(arrange(boxes, 'left')), { a: [50, 40], b: [40, 100], c: [70, 175] });
  assert.deepEqual(at(arrange(boxes, 'right')), { a: [193, 40], b: [203, 100], c: [173, 175] });
  // (20 + 223) / 2 = 121.5
  assert.deepEqual(at(arrange(boxes, 'center')), { a: [122, 40], b: [122, 100], c: [122, 175] });
});

test('align top, middle and bottom', () => {
  assert.deepEqual(at(arrange(boxes, 'top')), { a: [50, 40], b: [203, 50], c: [120, 45] });
  assert.deepEqual(at(arrange(boxes, 'bottom')), { a: [50, 180], b: [203, 170], c: [120, 175] });
  assert.deepEqual(at(arrange(boxes, 'middle')), { a: [50, 110], b: [203, 110], c: [120, 110] });
});

test('the aligned line goes on the grid', () => {
  // left 20 -> 20; right 223 -> 220; centre 121.5 -> 120
  assert.deepEqual(at(arrange(boxes, 'right', 10)), { a: [190, 40], b: [200, 100], c: [170, 175] });
  assert.deepEqual(at(arrange(boxes, 'center', 10)).a, [120, 40]);
  assert.deepEqual(at(arrange(boxes, 'top', 10)).b, [203, 50]);
});

test('distribute: the outermost stay, equal gaps between the boxes', () => {
  // horizontally: a (20..80) and b (183..223) stay; 203 - 60 - 100 - 40 = 3 → gap 1.5; c from 81.5
  const h = at(arrange(boxes, 'hspace', 10));
  assert.deepEqual(h.a, [50, 40]);
  assert.deepEqual(h.b, [203, 100]);
  assert.deepEqual(h.c, [Math.round(81.5 + 50), 175]);
  // vertically, four boxes: 30..190, heights 20 + 40 + 30 + 10 = 100, gaps 20
  const v = at(arrange([...boxes, { id: 'd', x: 0, y: 60, w: 10, h: 10 }], 'vspace'));
  assert.deepEqual(v, { a: [50, 40], d: [0, 75], b: [203, 120], c: [120, 175] });
});

test('distribute two boxes, or arrange one: nothing moves', () => {
  assert.deepEqual(arrange(boxes.slice(0, 2), 'vspace'), [{ id: 'a', x: 50, y: 40 }, { id: 'b', x: 203, y: 100 }]);
  assert.deepEqual(arrange(boxes.slice(0, 1), 'left'), [{ id: 'a', x: 50, y: 40 }]);
  assert.throws(() => arrange(boxes, 'diagonal'), /unknown/);
});

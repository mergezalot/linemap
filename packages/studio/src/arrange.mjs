// Align and distribute boxes: where each box's centre goes. Pure geometry (map units, y down).
// boxes: [{ id, x, y, w, h }] (x, y the centre). Returns [{ id, x, y }] for every box, in order.
//   left, center, right    the boxes' left sides, centres or right sides on that line of the
//                          boxes' bounding box; top, middle, bottom the same vertically.
//   hspace, vspace         distribute: the boxes in order of their centres, the outermost two stay,
//                          the others go between them with equal gaps (needs three or more).
// grid: the line aligned to is put on this grid (as a moved box's centre is); distributed boxes
// only get whole units, as the grid would undo the equal gaps.
export const ALIGNS = ['left', 'center', 'right', 'top', 'middle', 'bottom'];
export const DISTRIBUTES = ['hspace', 'vspace'];

export function arrange(boxes, how, grid = 1) {
  const on = (v) => Math.round(v / grid) * grid;
  const out = boxes.map((b) => ({ id: b.id, x: b.x, y: b.y }));
  if (boxes.length < 2) return out;
  const h = ['left', 'center', 'right', 'hspace'].includes(how);
  const [c, s] = h ? ['x', 'w'] : ['y', 'h'];
  const lo = Math.min(...boxes.map((b) => b[c] - b[s] / 2)), hi = Math.max(...boxes.map((b) => b[c] + b[s] / 2));
  if (how === 'left' || how === 'top') { const v = on(lo); boxes.forEach((b, i) => { out[i][c] = v + b[s] / 2; }); }
  else if (how === 'center' || how === 'middle') { const v = on((lo + hi) / 2); out.forEach((o) => { o[c] = v; }); }
  else if (how === 'right' || how === 'bottom') { const v = on(hi); boxes.forEach((b, i) => { out[i][c] = v - b[s] / 2; }); }
  else if (how === 'hspace' || how === 'vspace') {
    if (boxes.length < 3) return out;
    const order = boxes.map((b, i) => i).sort((a, b) => boxes[a][c] - boxes[b][c] || a - b);
    const first = boxes[order[0]], last = boxes[order.at(-1)];
    const from = first[c] - first[s] / 2, to = last[c] + last[s] / 2;
    const gap = (to - from - order.reduce((t, i) => t + boxes[i][s], 0)) / (order.length - 1);
    let at = from + first[s] + gap;
    for (const i of order.slice(1, -1)) {
      out[i][c] = Math.round(at + boxes[i][s] / 2);
      at += boxes[i][s] + gap;
    }
  } else throw new Error(`unknown arrangement: ${how}`);
  return out;
}

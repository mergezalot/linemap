// Smoke test of the built studio in headless Chromium (Playwright):
//   pnpm --filter @linemap/studio test               (builds first)
//   node test/smoke.mjs --shots <dir>                also writes screenshots of every example
// Needs `pnpm --filter @linemap/studio exec playwright install chromium` once.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { serve, build } from '../build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'dist', 'linemap.html');
const shotsArg = process.argv.indexOf('--shots');
const shots = shotsArg > 0 ? process.argv[shotsArg + 1] : null;
if (shots) fs.mkdirSync(shots, { recursive: true });

const EXAMPLES = ['examples/webshop.dot', 'examples/platform.dot', 'examples/postal.dot', 'docs/pipeline.dot'];

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures++;
};

const server = await serve({ port: 0, quiet: true });
const base = `http://127.0.0.1:${server.address().port}/studio.html`;
const browser = await chromium.launch();

async function newPage(width = 1400, height = 860) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  return page;
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
const ready = (page) => page.waitForSelector('#map svg [data-line]', { state: 'attached', timeout: 20000 });
// wait for the next map: the svg element is replaced on every rerun
async function rerun(page, action) {
  const before = await page.evaluateHandle(() => document.querySelector('#map svg'));
  await action();
  await page.waitForFunction((old) => { const s = document.querySelector('#map svg'); return s && s !== old; }, before, { timeout: 20000 });
  await page.waitForTimeout(50);
}
const viewBox = (page) => page.evaluate(() => document.querySelector('#map svg').getAttribute('viewBox'));
// the computed cursor of the first element matching each selector (null: none there)
const cursors = (page, sels) => page.evaluate((sels) => sels.map((q) => { const x = document.querySelector(q); return x ? getComputedStyle(x).cursor : null; }).join(' '), sels);

// A screen point on a strand of some line that is really on top there (not under a label).
async function strandPoint(page, skip = []) {
  return page.evaluate((skip) => {
    const strands = [...document.querySelectorAll('#map g.edge > path[data-line]')]
      .filter((p) => !skip.includes(p.getAttribute('data-line')))
      .sort((a, b) => b.getTotalLength() - a.getTotalLength());
    for (const p of strands) {
      const m = p.getScreenCTM();
      for (const f of [0.5, 0.3, 0.7, 0.4, 0.6]) {
        const pt = p.getPointAtLength(p.getTotalLength() * f);
        const x = pt.x * m.a + m.e, y = pt.y * m.d + m.f;
        if (x < 300 || y < 60 || x > innerWidth - 60 || y > innerHeight - 20) continue; // clear of panels
        const hit = document.elementFromPoint(x, y)?.closest('[data-line]');
        if (hit?.getAttribute('data-line') === p.getAttribute('data-line')) return { x, y, id: hit.getAttribute('data-line') };
      }
    }
    return null;
  }, skip);
}

for (const src of EXAMPLES) {
  const name = path.basename(src, '.dot');
  console.log(`${src}`);
  const page = await newPage();
  await page.goto(`${base}#src=${src}`);
  await ready(page);
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => ({
    strands: document.querySelectorAll('#map svg path[data-line]').length,
    titles: document.querySelectorAll('#map svg title').length,
    legendRows: document.querySelectorAll('#legend li').length,
    lines: window.__linemap.lines,
    ms: window.__linemap.ms,
  }));
  check(info.strands > 0, `map drawn (${info.strands} line paths, ${info.ms} ms)`);
  check(info.titles === 0, 'native <title> tooltips removed');
  check(info.legendRows === info.lines, `legend has a row per line (${info.legendRows})`);
  await shot(page, `${name}-1-default`);
  {
    // cursors: the background pans (grab), a line, a bundle's rim and a node are clicked (pointer)
    const c = await cursors(page, ['#stage', '#map g.edge > path[data-line]', '#map g.edge > .lm-casing', '#map g.node']);
    check(c === 'grab pointer pointer pointer', `view mode cursors: background grab, line, bundle and node pointer (${c})`);
  }

  // hover a strand: focus and tooltip
  const pt = await strandPoint(page);
  check(!!pt, 'found a strand to hover');
  if (pt) {
    await page.mouse.move(pt.x, pt.y);
    await page.waitForTimeout(250);
    const hov = await page.evaluate((id) => ({
      focus: document.querySelector('#map svg').classList.contains('focus'),
      on: document.querySelectorAll(`#map svg [data-line="${CSS.escape(id)}"].on`).length,
      other: document.querySelectorAll('#map svg [data-line].on:not([data-line="' + CSS.escape(id) + '"])').length,
      tip: document.getElementById('tooltip').hidden ? null : document.getElementById('tooltip').textContent,
      label: [...document.querySelectorAll('#legend li')].find((li) => li.dataset.line === id)?.querySelector('.lb').textContent,
    }), pt.id);
    check(hov.focus && hov.on > 0 && hov.other === 0, `hover line ${pt.id}: svg.focus, ${hov.on} elements .on, no others`);
    check(!!hov.tip && hov.tip.includes(hov.label), `tooltip shows the line label "${hov.label}"`);
    await shot(page, `${name}-2-line-hover`);
    // click pins it, the legend row shows it
    await page.mouse.click(pt.x, pt.y);
    await page.mouse.move(5, 300);
    await page.waitForTimeout(200);
    const pinned = await page.evaluate((id) => ({
      focus: document.querySelector('#map svg').classList.contains('focus'),
      row: document.querySelector(`#legend li[data-line="${CSS.escape(id)}"]`).classList.contains('on'),
    }), pt.id);
    check(pinned.focus && pinned.row, 'click pins the line (focus stays, legend row marked)');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    check(!(await page.evaluate(() => document.querySelector('#map svg').classList.contains('focus'))), 'Esc clears the pin');
  }

  // hover a node: tooltip with its label
  const node = await page.evaluate(() => {
    for (const g of document.querySelectorAll('#map g.node')) {
      const r = g.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + 6;
      if (x < 300 || y < 60) continue;
      if (document.elementFromPoint(x, y)?.closest('g.node') === g) return { x, y, label: g.getAttribute('data-label') };
    }
    return null;
  });
  if (node) {
    await page.mouse.move(node.x, node.y);
    await page.waitForTimeout(150);
    const tip = await page.evaluate(() => document.getElementById('tooltip').textContent);
    check(tip.includes(node.label.split('\n')[0]), `node tooltip shows "${node.label.replace(/\n/g, ' ')}"`);
    await shot(page, `${name}-2-node-hover`);
    await page.mouse.move(5, 300);
  }

  // legend click hides the line: rerun without it
  const lineId = await page.evaluate(() => document.querySelector('#legend li').dataset.line);
  await rerun(page, () => page.click(`#legend li[data-line="${lineId}"]`));
  const hidden = await page.evaluate((id) => ({
    drawn: document.querySelectorAll(`#map svg [data-line="${CSS.escape(id)}"]`).length,
    row: document.querySelector(`#legend li[data-line="${CSS.escape(id)}"]`).classList.contains('hidden'),
    hash: location.hash,
  }), lineId);
  check(hidden.drawn === 0 && hidden.row, `legend click hides line ${lineId} (no elements left, row greyed)`);
  await page.waitForTimeout(400);
  check((await page.evaluate(() => location.hash)).includes(`hide=${lineId}`), 'hash records the hidden line');
  // solo another line, then shift-click again = show all
  const second = await page.evaluate(() => document.querySelectorAll('#legend li')[1]?.dataset.line);
  if (second) {
    await rerun(page, () => page.click('#legend [data-act="show"]'));
    await rerun(page, () => page.click(`#legend li[data-line="${second}"]`, { modifiers: ['Shift'] }));
    const lines = await page.evaluate(() => new Set([...document.querySelectorAll('#map svg [data-line]')].map((e) => e.dataset.line)).size);
    check(lines === 1, `shift-click solos line ${second}`);
    await shot(page, `${name}-3-solo`);
  }
  await rerun(page, () => page.click('#legend [data-act="show"]'));
  await rerun(page, () => page.click(`#legend li[data-line="${lineId}"]`));
  await shot(page, `${name}-3-hidden`);
  await rerun(page, () => page.click('#legend [data-act="show"]'));
  await rerun(page, () => page.click('#legend [data-act="hide"]'));
  const none = await page.evaluate(() => ({ drawn: document.querySelectorAll('#map svg [data-line]').length, banner: !document.getElementById('banner').hidden }));
  check(none.drawn === 0 && !none.banner, 'hide all: map without lines, no error');
  await rerun(page, () => page.click('#legend [data-act="show"]'));

  // through: none, all, back to file
  await rerun(page, () => page.click('#through [data-mode="none"]'));
  check(await page.evaluate(() => document.querySelectorAll('#map g.node.through').length === 0), 'through none: no .through nodes');
  await shot(page, `${name}-4-through-none`);
  await rerun(page, () => page.click('#through [data-mode="all"]'));
  const all = await page.evaluate(() => ({
    through: document.querySelectorAll('#map g.node.through').length,
    capable: document.querySelectorAll('#map g.node:is([data-shape="box"], [data-shape="queue"], [data-shape="cylinder"])').length,
  }));
  check(all.through === all.capable && all.capable > 0, `through all: ${all.through} of ${all.capable} capable nodes through`);
  await shot(page, `${name}-4-through-all`);
  await rerun(page, () => page.click('#through [data-mode="file"]'));

  // click a node: pins its lines (no rerun, no through toggle); again: unpins
  const target = await page.evaluate(() => {
    for (const g of document.querySelectorAll('#map g.node')) {
      const r = g.getBoundingClientRect();
      for (const [fx, fy] of [[0.5, 0.08], [0.08, 0.5], [0.92, 0.5], [0.5, 0.92]]) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        if (x < 300 || y < 60 || x > innerWidth - 60 || y > innerHeight - 20) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit?.closest('g.node') === g && !hit.closest('[data-line]')) {
          return { id: g.id, x, y, url: g.dataset.url ?? null, was: g.classList.contains('through') };
        }
      }
    }
    return null;
  });
  if (target) {
    const svgBefore = await page.evaluateHandle(() => document.querySelector('#map svg'));
    await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(100);
    const now = await page.evaluate(([id, old]) => ({
      same: document.querySelector('#map svg') === old,
      through: [...document.querySelectorAll('#map g.node')].find((g) => g.id === id).classList.contains('through'),
      pinned: document.querySelectorAll('#legend li.on').length,
      focus: document.querySelector('#map svg').classList.contains('focus'),
    }), [target.id, svgBefore]);
    check(now.same && now.through === target.was, `click node ${target.id}: no rerun, through unchanged`);
    check(now.pinned > 0 && now.focus, `click node ${target.id} pins its lines (${now.pinned})`);
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(100);
    check(await page.evaluate(() => !document.querySelector('#legend li.on')), `click node ${target.id} again unpins`);
    await page.keyboard.press('Escape');
  } else check(false, 'found a node to click');

  // ctrl-click a linked node opens its URL; a plain click does not navigate
  const linked = await page.evaluate(() => {
    for (const g of document.querySelectorAll('#map g.node[data-url], #map g.note[data-url]')) {
      const r = g.getBoundingClientRect();
      for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.08], [0.08, 0.5], [0.92, 0.5], [0.5, 0.92]]) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        if (x < 300 || y < 60 || x > innerWidth - 60 || y > innerHeight - 20) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit?.closest('g.node, g.note') === g && hit.closest('a')) return { id: g.id, x, y, url: g.dataset.url };
      }
    }
    return null;
  });
  if (linked) {
    await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
    const href = page.url();
    await page.mouse.click(linked.x, linked.y);
    await page.waitForTimeout(100);
    check(page.url() === href && (await page.evaluate(() => window.__opened.length)) === 0, `plain click on linked ${linked.id} does not follow the link`);
    await page.keyboard.down('Control');
    await page.mouse.click(linked.x, linked.y);
    await page.keyboard.up('Control');
    await page.waitForTimeout(100);
    const opened = await page.evaluate(() => window.__opened);
    check(opened.length === 1 && opened[0] === linked.url, `ctrl-click on ${linked.id} opens ${linked.url}`);
    await page.keyboard.press('Escape');
  } else if (name !== 'pipeline' && name !== 'platform') check(false, 'found a linked node to ctrl-click');

  // zoom keys and buttons change the viewBox; fit restores it
  await page.mouse.move(5, 300);
  const vb0 = await viewBox(page);
  await page.keyboard.press('+');
  await page.waitForTimeout(350);
  const vb1 = await viewBox(page);
  check(vb1 !== vb0 && Number(vb1.split(' ')[2]) < Number(vb0.split(' ')[2]), 'key + zooms in');
  await page.mouse.move(700, 450);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -400);
  await page.keyboard.up('Control');
  await page.waitForTimeout(150);
  check(Number((await viewBox(page)).split(' ')[2]) < Number(vb1.split(' ')[2]), 'Ctrl+wheel zooms in');
  {
    // a plain wheel (or a two-finger scroll) pans; Shift+wheel pans sideways
    const w0 = (await viewBox(page)).split(' ').map(Number);
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(150);
    const w1 = (await viewBox(page)).split(' ').map(Number);
    check(w1[1] > w0[1] && w1[0] === w0[0] && w1[2] === w0[2], `the wheel pans down (${w0} -> ${w1})`);
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 60);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(150);
    const w2 = (await viewBox(page)).split(' ').map(Number);
    check(w2[0] > w1[0] && w2[1] === w1[1] && w2[2] === w1[2], `Shift+wheel pans sideways (${w1} -> ${w2})`);
  }
  // drag pans
  const vbA = (await viewBox(page)).split(' ').map(Number);
  // from a point that is not on a node's link (a press on a link does not pan)
  const from = await page.evaluate(() => [[700, 450], [500, 600], [900, 300], [400, 300], [1000, 650]]
    .find(([x, y]) => !document.elementFromPoint(x, y)?.closest('a, button, input')) ?? [700, 450]);
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(from[0] - 100, from[1] - 50, { steps: 5 });
  await page.mouse.up();
  const vbB = (await viewBox(page)).split(' ').map(Number);
  check(vbB[0] > vbA[0] && vbB[1] > vbA[1] && Math.abs(vbB[2] - vbA[2]) < 0.01, `drag pans (${vbA} -> ${vbB})`);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(250);
  check(Number((await viewBox(page)).split(' ')[0]) < vbB[0], 'arrow key pans');
  await shot(page, `${name}-5-zoomed`);
  await page.keyboard.press('0');
  await page.waitForTimeout(350);
  check(await viewBox(page) === vb0, `key 0 fits again (${await viewBox(page)} vs ${vb0})`);

  // search: a node label, Enter zooms to it
  const q = await page.evaluate(() => [...document.querySelectorAll('#map g.node')].at(-1).getAttribute('data-label').split('\n')[0]);
  await page.keyboard.press('/');
  await page.keyboard.type(q);
  await page.waitForTimeout(100);
  const results = await page.evaluate(() => document.querySelectorAll('#results li[data-i]').length);
  check(results > 0, `search "${q}" finds ${results} result(s)`);
  await shot(page, `${name}-6-search`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check(await viewBox(page) !== vb0, 'Enter zooms to the result');

  // export and positions
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  const svgText = fs.readFileSync(await dl.path(), 'utf8');
  check(dl.suggestedFilename() === `${name}.svg` && svgText.startsWith('<svg') && svgText.includes('class="legend"'), `SVG export ${dl.suggestedFilename()} with legend`);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#positions');
  await page.waitForTimeout(200);
  const pos = await page.evaluate(async () => ({
    clip: await navigator.clipboard.readText().catch(() => ''),
    dialog: document.getElementById('positions-dialog').open ? document.querySelector('#positions-dialog textarea').value : '',
    toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent,
  }));
  const text = pos.clip || pos.dialog;
  check(/pos="/.test(text) || /pinned already/.test(pos.toast), `positions copied (${text.split('\n').length} lines; ${pos.toast || 'dialog'})`);
  if (pos.dialog) await page.keyboard.press('Escape');

  check(page.errors.length === 0, `no page errors${page.errors.length ? `: ${page.errors.join(' | ')}` : ''}`);
  await page.close();
}

console.log('state in the hash');
{
  const page = await newPage();
  await page.goto(`${base}#src=examples/webshop.dot&hide=R,E&through=none&view=800,100,900,600`);
  await ready(page);
  await page.waitForTimeout(300);
  const s = await page.evaluate(() => ({
    lines: [...new Set([...document.querySelectorAll('#map svg [data-line]')].map((e) => e.dataset.line))].sort().join(''),
    through: document.querySelectorAll('#map g.node.through').length,
    mode: document.querySelector('#through [aria-checked="true"]').dataset.mode,
    vb: document.querySelector('#map svg').getAttribute('viewBox').split(' ').map(Number),
  }));
  check(s.lines === 'MOPS', `hash hides R and E (drawn: ${s.lines})`);
  check(s.through === 0 && s.mode === 'none', 'hash sets through none');
  // the view rectangle 800,100 900x600 fits inside the restored view
  check(s.vb[0] <= 800 && s.vb[1] <= 100 && s.vb[0] + s.vb[2] >= 1700 && s.vb[1] + s.vb[3] >= 700 && s.vb[2] < 1400, `hash view restored (${s.vb.map(Math.round).join(' ')})`);
  await page.waitForTimeout(400); // the hash is written after 250 ms
  const url = new URL(page.url());
  check(!url.search && url.hash.startsWith('#src=examples/webshop.dot&hide=R,E&through=none&view='), `src stays in the hash, nothing in the query (${url.search}${url.hash})`);
  await page.reload();
  await ready(page);
  check(await page.evaluate(() => document.querySelector('#file-name .name').textContent) === 'webshop.dot', 'a reload opens the same file');
  // a #src= link to another file: opens it, with the link's settings
  await rerun(page, () => page.evaluate(() => { location.hash = '#src=examples/postal.dot&through=all'; }));
  const o = await page.evaluate(() => ({
    name: document.querySelector('#file-name .name').textContent,
    mode: document.querySelector('#through [aria-checked="true"]').dataset.mode,
  }));
  check(o.name === 'postal.dot' && o.mode === 'all', `a #src= change opens that file with its settings (${o.name}, through ${o.mode})`);
  // a file opened by hand drops the src from the hash
  await page.click('#paste');
  await page.fill('#paste-dialog textarea', 'digraph pasted { subgraph lines { A } a -> b [lines=A] }');
  await rerun(page, () => page.click('#paste-dialog button[value="ok"]'));
  await page.waitForTimeout(400);
  check(!new URL(page.url()).hash.includes('src='), `pasted text: no src in the hash (${new URL(page.url()).hash})`);
  check(page.errors.length === 0, 'no page errors');
  await page.close();
}

console.log('notes off: the map without them, a badge for each');
{
  const page = await newPage();
  await page.goto(`${base}#src=examples/postal.dot`);
  await ready(page);
  await page.waitForTimeout(300);
  const notes = await page.evaluate(() => document.querySelectorAll('#map g.note').length);
  check(notes > 0 && await page.isVisible('#notes') && await page.getAttribute('#notes', 'aria-pressed') === 'true', `notes button shown and on (${notes} notes)`);
  const paths = () => page.evaluate(() => [...document.querySelectorAll('#map g.edge')].map((g) => g.querySelector('.lm-casing').getAttribute('d')).join('|'));
  const before = await paths();
  await rerun(page, () => page.click('#notes'));
  const off = await page.evaluate(() => ({
    badges: document.querySelectorAll('#map g.note.lm-note-folded .lm-note-icon').length,
    attached: [...document.querySelectorAll('#map g.note.lm-note-folded')].every((g) => !g.dataset.attach || document.getElementById(g.dataset.attach)?.matches('g.node')),
    shown: [...document.querySelectorAll('#map .lm-note-full')].filter((e) => e.getBoundingClientRect().width > 0).length,
    links: document.querySelectorAll('#map .lm-note-link').length,
    pressed: document.getElementById('notes').getAttribute('aria-pressed'),
  }));
  check(off.badges === notes && off.attached && off.shown === 0 && off.links === 0 && off.pressed === 'false', `notes off: ${off.badges} badges on their nodes, no note or link drawn`);
  const inside = await page.evaluate(() => [...document.querySelectorAll('#map g.note.lm-note-folded[data-attach]')].every((g) => {
    const b = g.querySelector('.lm-note-icon').getBoundingClientRect();
    const node = document.getElementById(g.dataset.attach);
    const n = (node.querySelector('.lm-shape') ?? node).getBoundingClientRect();
    return b.left < n.right && n.left < b.right && b.top < n.bottom && n.top < b.bottom;
  }));
  check(inside, 'each badge sits on its node');
  const faded = await page.evaluate(() => [...document.querySelectorAll('#map .lm-note-icon')].every((e) => +getComputedStyle(e).opacity < 0.7));
  check(faded, 'badges are half-transparent');
  check(await paths() !== before, 'notes off routes the lines again, through the room the notes took');
  await page.waitForTimeout(400);
  check((await page.evaluate(() => location.hash)).includes('notes=off'), 'hash records notes=off');
  check(await page.evaluate(() => localStorage.getItem('linemap:notes')) === 'false', 'notes off is remembered in localStorage');
  // a badge that is on top where it is drawn
  const icon = await page.evaluate(() => {
    for (const g of document.querySelectorAll('#map g.note.lm-note-folded')) {
      const r = g.querySelector('.lm-note-icon').getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < 300 || y < 60 || x > innerWidth - 60 || y > innerHeight - 20) continue;
      if (document.elementFromPoint(x, y)?.closest('g.note') === g) return { id: g.id, x, y, label: g.dataset.label };
    }
    return null;
  });
  check(!!icon, 'found a note badge to hover');
  if (icon) {
    await page.mouse.move(icon.x, icon.y);
    await page.waitForTimeout(300);
    check(await page.evaluate((id) => +getComputedStyle(document.getElementById(id).querySelector('.lm-note-icon')).opacity, icon.id) === 1, 'the badge pointed at is opaque');
    const tip = await page.evaluate(() => document.getElementById('tooltip').hidden ? '' : document.getElementById('tooltip').innerText);
    check(tip.includes(icon.label.split('\n')[0]) && !/click to (keep|fold)|keep it open/i.test(tip), `hovering the badge shows the note, no click hint ("${icon.label.split('\n')[0]}")`);
    const open = (id) => page.evaluate((id) => {
      const g = [...document.querySelectorAll('#map g.note')].find((x) => x.id === id);
      const r = g.querySelector('.lm-note-full').getBoundingClientRect();
      const b = g.querySelector('.lm-note-icon').getBoundingClientRect();
      const near = r.width > 0 && Math.min(Math.abs(r.left - b.right), Math.abs(b.left - r.right)) < 40 && r.top < b.bottom + 4 && r.bottom > b.top - 4;
      return { cls: g.classList.contains('lm-open'), full: r.width > 0, icon: b.width > 0, near, last: g === g.parentNode.lastElementChild };
    }, id);
    await page.mouse.click(icon.x, icon.y);
    await page.waitForTimeout(100);
    const o = await open(icon.id);
    check(o.cls && o.full && o.icon && o.near && o.last, 'click keeps the note open beside its badge, on top');
    await page.waitForTimeout(200);
    const openTip = await page.evaluate(() => document.getElementById('tooltip').hidden ? '' : document.getElementById('tooltip').innerText);
    check(!/click to|fold|keep it open/i.test(openTip), `no click hint over the open note${openTip ? ` ("${openTip}")` : ''}`);
    await page.mouse.move(5, 300);
    await page.waitForTimeout(100);
    check((await open(icon.id)).full, 'it stays open when the pointer leaves');
    await rerun(page, () => page.keyboard.press('t'));
    check((await open(icon.id)).full, 'and across a change of theme');
    await page.mouse.click(icon.x, icon.y);
    await page.waitForTimeout(100);
    check(!(await open(icon.id)).full, 'a click on the badge closes it again');
    await page.mouse.click(icon.x, icon.y);
    await page.keyboard.press('Escape');
    check(!(await open(icon.id)).full, 'Esc closes the notes kept open');
  }
  // the download is what the studio shows, without badges: hidden lines, theme, notes left out
  await page.click('#legend li:first-child');
  await page.waitForTimeout(500);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  const svgText = fs.readFileSync(await dl.path(), 'utf8');
  const shownSvg = await page.evaluate(() => ({ theme: document.querySelector('#map svg').dataset.theme, edges: document.querySelectorAll('#map g.edge').length }));
  check(!/class="(note|lm-note)/.test(svgText) && /class="legend"/.test(svgText), 'SVG export with notes off leaves them out, no badges');
  check(svgText.includes(`data-theme="${shownSvg.theme}"`) && (svgText.match(/<g class="edge"/g) ?? []).length === shownSvg.edges && /opacity="0.35"/.test(svgText), 'SVG export has the theme and hidden lines on screen');
  // remembered: a link without notes= opens with notes off; notes= in the link wins
  await page.goto('about:blank'); // a page load, not a hash change in the page
  await page.goto(`${base}#src=examples/postal.dot`);
  await ready(page);
  check(await page.evaluate(() => document.querySelectorAll('#map g.note.lm-note-folded').length) === notes && await page.getAttribute('#notes', 'aria-pressed') === 'false', 'reload without notes= in the address: notes off, as remembered');
  await page.goto(`${base}?link=1#src=examples/postal.dot&notes=on`); // a new query: a full load
  await ready(page);
  check(await page.evaluate(() => document.querySelectorAll('#map g.note:not(.lm-note-folded)').length) === notes, 'notes=on in the address wins over the remembered value');
  await rerun(page, () => page.keyboard.press('n'));
  await rerun(page, () => page.keyboard.press('n'));
  check(await page.evaluate(() => localStorage.getItem('linemap:notes')) === 'true' && await page.evaluate(() => document.querySelectorAll('#map g.note:not(.lm-note-folded)').length) === notes, 'N switches them, and the switch is remembered');
  check(page.errors.length === 0, `no page errors${page.errors.length ? `: ${page.errors.join(' | ')}` : ''}`);
  await page.close();
}
{
  const page = await newPage();
  await page.goto(`${base}#src=examples/webshop.dot&notes=off`);
  await ready(page);
  check(await page.evaluate(() => document.querySelectorAll('#map g.note.lm-note-folded').length > 0), 'hash notes=off draws badges on load');
  await page.close();
}
{
  // storage that throws (privacy settings, some file:// pages): the toggle still works
  const page = await newPage();
  await page.addInitScript(() => {
    for (const k of ['getItem', 'setItem']) Storage.prototype[k] = () => { throw new Error('denied'); };
  });
  await page.goto(`${base}#src=examples/webshop.dot`);
  await ready(page);
  await rerun(page, () => page.click('#notes'));
  check(await page.evaluate(() => document.querySelectorAll('#map g.note.lm-note-folded').length > 0) && page.errors.length === 0, 'notes off works when storage throws');
  await page.close();
}

console.log('legendpos is ignored (the legend is a panel)');
{
  const page = await newPage();
  await page.goto(`${base}#src=examples/webshop.dot`);
  await ready(page);
  const text = fs.readFileSync(path.join(here, '../../../examples/webshop.dot'), 'utf8');
  // on the Fulfilment -> Data platform line, which an SVG export routes round it
  const withPos = text.replace(/^digraph webshop \{/m, 'digraph webshop { legendpos="2160,800"');
  check(withPos !== text, 'flow with legendpos made');
  const drawn = async (dot) => {
    await page.click('#paste');
    await page.fill('#paste-dialog textarea', dot);
    await rerun(page, () => page.click('#paste-dialog button[value="ok"]'));
    return page.evaluate(() => [...document.querySelectorAll('#map svg g.node, #map svg g.note, #map svg g.edge')].map((g) => g.outerHTML).join('\n'));
  };
  const a = await drawn(withPos), b = await drawn(text);
  check(a.length > 0 && a === b, 'a legendpos flow is laid out as without it: no gap in the map');
  check(page.errors.length === 0, `no page errors${page.errors.length ? `: ${page.errors.join(' | ')}` : ''}`);
  await page.close();
}

console.log('errors keep the last map');
{
  const page = await newPage();
  await page.goto(`${base}#src=examples/webshop.dot`);
  await ready(page);
  await page.click('#paste');
  await page.fill('#paste-dialog textarea', 'digraph broken { subgraph lines { A [color="#f00"] } a -> b [lines=Z] }');
  await page.click('#paste-dialog button[value="ok"]');
  await page.waitForSelector('#banner:not([hidden])');
  const b = await page.evaluate(() => ({
    msg: document.querySelector('#banner .msg').textContent,
    map: document.querySelectorAll('#map svg [data-line]').length,
  }));
  check(b.msg.includes('unknown line "Z"') && b.map > 0, `banner shows "${b.msg.split('\n')[0]}", last map kept`);
  await shot(page, 'error-banner');
  await page.click('#banner .close');
  check(await page.evaluate(() => document.getElementById('banner').hidden), 'banner dismissed');
  await page.close();
}

console.log('watch');
{
  const rel = 'packages/studio/dist/watch-test.dot';
  const file = path.join(here, '..', 'dist', 'watch-test.dot');
  const text = fs.readFileSync(path.join(here, '../../../examples/webshop.dot'), 'utf8');
  fs.writeFileSync(file, text);
  // a context of its own, so a second tab can share its localStorage
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const page = await ctx.newPage();
  await page.goto(`${base}#src=${rel}`);
  await ready(page);
  check(await page.isVisible('#watch'), 'watch button shown for #src over http');
  await page.click('#watch');
  const vb = await viewBox(page);
  fs.writeFileSync(file, text.replace('label="Order",', 'label="Orders (edited)",'));
  await page.waitForFunction(() => [...document.querySelectorAll('#legend .lb')].some((e) => e.textContent === 'Orders (edited)'), null, { timeout: 5000 })
    .then(() => check(true, 'edit to the file shows up within the poll interval'), () => check(false, 'edit to the file shows up'));
  check(await viewBox(page) === vb, 'view kept across the reload');
  // watch is remembered for this URL: on after a reload of the page, and it still follows saves
  await page.reload();
  await ready(page);
  check(await page.getAttribute('#watch', 'aria-pressed') === 'true', 'watch is on again after a page reload (localStorage)');
  fs.writeFileSync(file, text.replace('label="Order",', 'label="Orders (again)",'));
  await page.waitForFunction(() => [...document.querySelectorAll('#legend .lb')].some((e) => e.textContent === 'Orders (again)'), null, { timeout: 5000 })
    .then(() => check(true, 'and follows the next save'), () => check(false, 'and follows the next save'));
  // only a page load looks up the saved value: in the page, opening another file follows the
  // plain rule (a pasted or dropped file is not watched, a URL keeps the current state)
  await page.click('#paste');
  await page.fill('#paste-dialog textarea', fs.readFileSync(path.join(here, '../../../examples/platform.dot'), 'utf8'));
  await rerun(page, () => page.click('#paste-dialog button[value="ok"]'));
  check(await page.getAttribute('#watch', 'aria-pressed') === 'false' && !(await page.isVisible('#watch')), 'pasted text: no Watch (nothing to fetch)');
  await page.click('#file-name');
  await rerun(page, () => page.click('#recent .item[data-i]:has-text("watch-test.dot")'));
  check(await page.isVisible('#watch') && await page.getAttribute('#watch', 'aria-pressed') === 'false', 'reopened from Recent in the page: not watched, the saved value is not looked up');
  await page.reload();
  await ready(page);
  check(await page.getAttribute('#watch', 'aria-pressed') === 'true', 'a page reload watches it again');
  // the saved value is the browser's: another tab loading the URL watches it too
  const tab = await ctx.newPage();
  await tab.goto(`${base}#src=${rel}`);
  await ready(tab);
  check(await tab.getAttribute('#watch', 'aria-pressed') === 'true', 'another tab loading the URL watches it');
  await tab.goto('about:blank'); // a page load, not a hash change in the page
  await tab.goto(`${base}#src=examples/postal.dot`);
  await ready(tab);
  check(await tab.getAttribute('#watch', 'aria-pressed') === 'false', 'a URL never watched loads unwatched');
  await tab.close();
  // switched off: stays off after a reload
  await page.click('#watch');
  await page.reload();
  await ready(page);
  check(await page.getAttribute('#watch', 'aria-pressed') === 'false', 'watch switched off stays off after a reload');
  fs.unlinkSync(file);
  await ctx.close();
}

console.log('watch without localStorage');
{
  const rel = 'packages/studio/dist/watch-test-2.dot';
  const file = path.join(here, '..', 'dist', 'watch-test-2.dot');
  const text = fs.readFileSync(path.join(here, '../../../examples/webshop.dot'), 'utf8');
  fs.writeFileSync(file, text);
  const page = await newPage();
  // every storage access throws, as with storage blocked
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  await page.goto(`${base}#src=${rel}`);
  await ready(page);
  await page.click('#watch');
  check(await page.getAttribute('#watch', 'aria-pressed') === 'true', 'watch switches on with storage blocked');
  fs.writeFileSync(file, text.replace('label="Order",', 'label="Orders (blocked)",'));
  await page.waitForFunction(() => [...document.querySelectorAll('#legend .lb')].some((e) => e.textContent === 'Orders (blocked)'), null, { timeout: 5000 })
    .then(() => check(true, 'and follows saves'), () => check(false, 'and follows saves'));
  await page.reload();
  await ready(page);
  check(await page.getAttribute('#watch', 'aria-pressed') === 'false', 'after a reload it is off (nothing could be kept)');
  check(page.errors.length === 0, `no page errors${page.errors.length ? `: ${page.errors.join(' | ')}` : ''}`);
  fs.unlinkSync(file);
  await page.close();
}

console.log('file:// page, recent list, empty state');
{
  const page = await newPage();
  await page.goto(pathToFileURL(dist).href);
  await page.waitForSelector('#empty:not([hidden])');
  check(true, 'empty state without a file');
  await shot(page, 'empty-state');
  await page.click('#empty [data-act="paste"]');
  await page.fill('#paste-dialog textarea', fs.readFileSync(path.join(here, '../../../examples/platform.dot'), 'utf8'));
  await page.click('#paste-dialog button[value="ok"]');
  await ready(page);
  check(true, 'pasted text drawn from a file:// page (no fetches needed)');
  await page.reload();
  await ready(page);
  check(await page.evaluate(() => document.querySelector('#file-name .name').textContent) === 'platform (pasted)', 'last file reopens after reload (localStorage), named after the graph');
  await page.click('#file-name');
  check(await page.evaluate(() => document.querySelectorAll('#recent .item[data-i]').length) >= 1, 'recent menu lists it');
  await shot(page, 'recent-menu');
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  check(await page.evaluate(() => document.getElementById('help').open), '? opens the help');
  const lic = await page.evaluate(() => document.querySelector('#help .licenses').innerText);
  check(/Mozilla Public License/.test(lic) && /MSAGL/.test(lic), `help names the licenses ("${lic.slice(0, 60)}…")`);
  await shot(page, 'help');
  check(page.errors.length === 0, `no page errors${page.errors.length ? `: ${page.errors.join(' | ')}` : ''}`);
  await page.close();
}

console.log('phone width');
{
  const page = await newPage(390, 800);
  await page.goto(`${base}#src=examples/postal.dot`);
  await ready(page);
  await page.waitForTimeout(300);
  const p = await page.evaluate(() => ({
    collapsed: document.getElementById('legend').classList.contains('collapsed'),
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  check(p.collapsed && !p.overflow, 'legend collapsed, nothing wider than the screen');
  const tb = () => page.evaluate(() => ({
    h: document.querySelector('.toolbar').offsetHeight,
    open: document.querySelector('.toolbar').classList.contains('menu-open'),
  }));
  check((await tb()).h < 50 && !(await page.isVisible('#export')) && await page.isVisible('#menu-btn'), 'toolbar is one row; the rest behind the menu button');
  await page.click('#menu-btn');
  check((await tb()).open && await page.isVisible('#export') && await page.isVisible('#theme-btn'), 'menu button opens the menu');
  await page.click('#through [data-mode="all"]');
  check((await tb()).open, 'a through choice leaves the menu open');
  await page.click('#theme-btn');
  check(await page.isVisible('#theme [data-theme="dark"]'), 'theme dropdown lists the themes');
  await page.click('#theme [data-theme="dark"]');
  await page.waitForFunction(() => document.body.dataset.mapTheme === 'dark');
  check((await tb()).open && await page.evaluate(() => document.getElementById('theme').hidden && /Dark/.test(document.getElementById('theme-btn').textContent)), 'picking a theme closes the list, keeps the menu, names it on the button');
  await page.click('#theme-btn');
  check(await page.evaluate(() => document.querySelectorAll('#theme .row').length === 5 &&
    document.querySelector('#theme .row[data-base="neon"] [data-theme="neon-fancy"]') !== null), 'one row per theme, the fancy variant on the same row');
  await page.click('#theme [data-theme="neon-fancy"]');
  await page.waitForFunction(() => document.body.dataset.mapTheme === 'neon-fancy');
  check(await page.evaluate(() => /Neon/.test(document.getElementById('theme-btn').textContent) && document.getElementById('fancy').getAttribute('aria-pressed') === 'true'), 'the sparkles pick the fancy variant; the toggle beside the button shows it');
  await page.click('#fancy');
  await page.waitForFunction(() => document.body.dataset.mapTheme === 'neon');
  check((await tb()).open && await page.evaluate(() => document.getElementById('fancy').getAttribute('aria-pressed') === 'false'), 'the toggle switches back to plain, and keeps the menu open');
  await page.click('#fancy');
  await page.waitForFunction(() => document.body.dataset.mapTheme === 'neon-fancy');
  await page.click('#theme-btn');
  await shot(page, 'phone-themes');
  await page.click('#theme [data-theme="dark"]');
  await shot(page, 'phone-menu');
  await page.keyboard.press('Escape');
  check(!(await tb()).open, 'Esc closes the menu');
  await page.click('#menu-btn');
  await page.click('#help-btn');
  check(!(await tb()).open && await page.evaluate(() => document.getElementById('help').open), 'an action in the menu runs and closes it');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1600, height: 800 });
  await page.waitForTimeout(100);
  check(await page.isVisible('#export') && !(await page.isVisible('#menu-btn')), 'wide again: controls back in the toolbar');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(100);
  check((await tb()).h < 50, 'the toolbar shrinks back after a resize');
  check(page.errors.length === 0, `no page errors${page.errors.length ? `: ${page.errors.join(' | ')}` : ''}`);
  await shot(page, 'phone');
  await page.close();
}

console.log('touch screen');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${base}#src=examples/postal.dot`);
  await ready(page);
  check(!(await page.isVisible('#zoom-in')) && !(await page.isVisible('#zoom-out')) && await page.isVisible('#zoom-fit'), 'no + and - buttons (pinch instead); fit stays');
  await shot(page, 'touch');
  await ctx.close();
}

console.log('strict Content-Security-Policy (embeds)');
{
  // Embeds (e.g. Notion) forbid fetching data: URLs and running WASM; the studio needs neither.
  const page = await newPage();
  const html = fs.readFileSync(dist, 'utf8');
  const dot = fs.readFileSync(path.join(here, '..', '..', '..', 'examples', 'webshop.dot'), 'utf8');
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src https://embed.test";
  await page.route('https://embed.test/**', (r) => (new URL(r.request().url()).pathname.endsWith('.dot')
    ? r.fulfill({ body: dot, contentType: 'text/plain' })
    : r.fulfill({ body: html, contentType: 'text/html', headers: { 'Content-Security-Policy': csp } })));
  await page.goto('https://embed.test/studio.html#src=webshop.dot');
  const ok = await ready(page).then(() => true, () => false);
  check(ok && !(await page.evaluate(() => document.getElementById('banner').hidden === false)), 'draws the map under a CSP that blocks data: fetches and WASM');
  await page.close();
}

console.log('flows baked in (build --embed), under the same CSP');
{
  const repo = path.join(here, '..', '..', '..');
  const embedHtml = async (...names) => {
    const file = path.join(here, '..', 'dist', '_smoke-embed.html');
    await build({ embed: names.map((n) => path.join(repo, 'examples', n)), out: file });
    const html = fs.readFileSync(file, 'utf8');
    fs.rmSync(file);
    return html;
  };
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:";
  const serveHtml = (page, html) => page.route('https://embed.test/**', (r) => r.fulfill({ body: html, contentType: 'text/html', headers: { 'Content-Security-Policy': csp } }));
  // the host's own ?src= (Notion's file preview passes the page's file URL) is not fetched
  const hostSrc = '?src=https%3A%2F%2Ffiles.test%2Fembed.html%3FX-Amz-Signature%3D1';
  const bannerShown = (page) => page.evaluate(() => document.getElementById('banner').hidden === false);

  // one flow: opens right away
  {
    const page = await newPage();
    await serveHtml(page, await embedHtml('webshop.dot'));
    await page.goto('https://embed.test/embed.html' + hostSrc);
    await ready(page);
    const name = await page.evaluate(() => document.querySelector('#file-name .name').textContent);
    check(name === 'webshop.dot', `one baked-in flow opens right away (${name})`);
    check(!(await bannerShown(page)), 'ignores a ?src= from the host page (no error banner)');
    await page.close();
  }

  // #src= opens that file instead of the baked-in one, and Watch can follow it
  {
    const page = await newPage();
    const html = await embedHtml('webshop.dot');
    const dot = fs.readFileSync(path.join(repo, 'examples', 'postal.dot'), 'utf8');
    await page.route('https://embed.test/**', (r) => (new URL(r.request().url()).pathname.endsWith('.dot')
      ? (r.request().url().includes('missing') ? r.fulfill({ status: 404, body: 'no' }) : r.fulfill({ body: dot, contentType: 'text/plain' }))
      : r.fulfill({ body: html, contentType: 'text/html', headers: { 'Content-Security-Policy': `${csp}; connect-src https://embed.test` } })));
    await page.goto('https://embed.test/embed.html' + hostSrc + '#src=flows/postal.dot');
    await ready(page);
    const name = await page.evaluate(() => document.querySelector('#file-name .name').textContent);
    check(name === 'postal.dot' && !(await bannerShown(page)), `#src= wins over the baked-in flow (${name})`);
    check(await page.isVisible('#watch'), 'and can be watched');
    // a src that cannot be loaded: the baked-in flow, under the error
    await page.goto('https://embed.test/embed.html#src=missing.dot');
    await ready(page);
    const fb = await page.evaluate(() => ({ name: document.querySelector('#file-name .name').textContent, msg: document.querySelector('#banner .title').textContent }));
    check(fb.name === 'webshop.dot' && (await bannerShown(page)) && /missing\.dot/.test(fb.msg), `a missing #src= falls back to the baked-in flow and says so (${fb.name}; ${fb.msg})`);
    check(page.errors.filter((e) => !/404/.test(e)).length === 0, 'no page errors');
    await page.close();
  }

  // several: listed on the start screen
  const page = await newPage();
  await serveHtml(page, await embedHtml('webshop.dot', 'postal.dot'));
  // another embed of the same site left its own last file behind
  await page.goto('https://embed.test/');
  await page.evaluate(() => localStorage.setItem('linemap:last', JSON.stringify({ name: 'other.dot', text: 'digraph other { a -> b }' })));
  await page.goto('https://embed.test/embed.html' + hostSrc);
  await page.waitForSelector('#empty .flows:not([hidden]) [data-flow]');
  const splash = await page.evaluate(() => ({
    flows: [...document.querySelectorAll('#empty .flows [data-flow]')].map((b) => b.textContent),
    map: !!document.querySelector('#map svg'),
  }));
  check(splash.flows.join() === 'webshop.dot,postal.dot' && !splash.map, `start screen lists the flows (${splash.flows.join(', ')})`);
  check(!(await bannerShown(page)), 'no error banner with several flows either');
  await shot(page, 'embed-start');
  await page.click('#empty [data-flow="1"]');
  await ready(page);
  const first = await page.evaluate(() => ({
    name: document.querySelector('#file-name .name').textContent,
    empty: !document.getElementById('empty').hidden,
    last: JSON.parse(localStorage.getItem('linemap:last')).name,
    recent: localStorage.getItem('linemap:recent'),
  }));
  check(first.name === 'postal.dot' && !first.empty, `picking one opens it (${first.name})`);
  check(first.last === 'other.dot' && !first.recent, 'baked-in flows are not written to localStorage');
  await page.click('#file-name');
  const items = await page.evaluate(() => [...document.querySelectorAll('#recent [data-flow]')].map((b) => b.textContent));
  check(items.join() === 'webshop.dot,postal.dot', `file menu lists the flows (${items.join(', ')})`);
  await rerun(page, () => page.click('#recent [data-flow="0"]'));
  const second = await page.evaluate(() => ({
    name: document.querySelector('#file-name .name').textContent,
    nodes: document.querySelectorAll('#map g.node').length,
  }));
  check(second.name === 'webshop.dot' && second.nodes > 5, `menu switches to webshop.dot (${second.nodes} nodes)`);
  await page.waitForTimeout(400); // the hash is written after 250 ms
  check(new URL(page.url()).hash.startsWith('#src=webshop.dot'), `picking a baked-in flow puts its name in the hash (${new URL(page.url()).hash})`);
  // a reload keeps the pick: no start screen, nothing fetched, one map drawn
  const fetched = [];
  page.on('request', (r) => { if (r.url().endsWith('.dot')) fetched.push(r.url()); });
  await page.addInitScript(() => {
    window.__maps = 0;
    new MutationObserver((ms) => { for (const m of ms) if (m.target.id === 'map') for (const n of m.addedNodes) if (n.nodeName === 'svg') window.__maps++; })
      .observe(document, { childList: true, subtree: true });
  });
  page.errors.length = 0; // the start screen's look for the repo's examples, before
  await page.reload();
  await ready(page);
  await page.waitForTimeout(800);
  const reloaded = await page.evaluate(() => ({
    name: document.querySelector('#file-name .name').textContent,
    empty: !document.getElementById('empty').hidden,
    maps: window.__maps,
    hash: location.hash,
  }));
  check(reloaded.name === 'webshop.dot' && !reloaded.empty && !(await bannerShown(page)), `a reload opens the flow the hash names (${reloaded.name})`);
  check(reloaded.maps === 1 && reloaded.hash.startsWith('#src=webshop.dot'), `drawn once, the hash kept (${reloaded.maps} maps, ${reloaded.hash})`);
  // a #src= naming the other flow switches to it, with the link's settings
  await rerun(page, () => page.evaluate(() => { location.hash = '#src=postal.dot&through=all'; }));
  await page.waitForTimeout(400);
  const lf = await page.evaluate(() => ({
    name: document.querySelector('#file-name .name').textContent,
    mode: document.querySelector('#through [aria-checked="true"]').dataset.mode,
    hash: location.hash,
  }));
  check(lf.name === 'postal.dot' && lf.mode === 'all' && lf.hash.startsWith('#src=postal.dot&through=all'), `a #src= change opens that baked-in flow with its settings (${lf.name}, ${lf.hash})`);
  check(!fetched.length, `baked-in flows are not fetched (${fetched.join(', ')})`);
  check(page.errors.length === 0, `no page errors (${page.errors.join('; ')})`);
  await page.close();

  // from file:// too: the hash names the flow, and a load with it opens that flow
  {
    const file = path.join(here, '..', 'dist', '_smoke-embed-file.html');
    fs.writeFileSync(file, await embedHtml('webshop.dot', 'postal.dot'));
    const fp = await newPage();
    await fp.goto(pathToFileURL(file).href);
    await fp.waitForSelector('#empty .flows:not([hidden]) [data-flow]');
    await fp.click('#empty [data-flow="1"]');
    await ready(fp);
    await fp.waitForTimeout(400);
    const h = new URL(fp.url()).hash;
    await fp.goto('about:blank');
    await fp.goto(pathToFileURL(file).href + '#src=webshop.dot');
    await ready(fp);
    const n = await fp.evaluate(() => document.querySelector('#file-name .name').textContent);
    check(h.startsWith('#src=postal.dot') && n === 'webshop.dot', `from file:// as well (${h}; opened ${n})`);
    await fp.close();
    fs.rmSync(file);
  }
}

console.log('edit mode, saving to the file (linemap studio)');
{
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linemap-edit-'));
  const file = path.join(dir, 't.dot');
  const FLOW = `digraph t {
  subgraph lines { A [label="Alpha"]; B [label="Beta"] }
  // boxes
  a [label="A", pos="0,0"]
  b [label="B", pos="700,0"]
  c [label="C", pos="700,500"]
  subgraph cluster_x { label="X"; d [label="D", pos="0,500"] }
  a -> b [lines="A B"]
  b -> c [lines=A]
  a -> d [lines=B]
}
`;
  fs.writeFileSync(file, FLOW);
  const read = () => fs.readFileSync(file, 'utf8');
  const editServer = await serve({ dir, port: 0, quiet: true });
  const page = await newPage();
  await page.goto(`http://127.0.0.1:${editServer.address().port}/studio.html#src=t.dot`);
  await ready(page);
  const until = async (fn, what) => {
    for (let i = 0; i < 100; i++) { if (await fn()) return true; await page.waitForTimeout(50); }
    check(false, `timed out: ${what}`);
    return false;
  };
  const changed = async (before, what) => { await until(() => read() !== before, what); await page.waitForTimeout(250); return read(); };
  // screen point of a map point, and the middle of a node or of an edge's first lane
  const scr = (x, y) => page.evaluate(([x, y]) => { const m = document.querySelector('#map svg').getScreenCTM(); return { x: x * m.a + m.e, y: y * m.d + m.f }; }, [x, y]);
  const nodeAt = (id) => page.evaluate((id) => { const r = [...document.querySelectorAll('#map g.node')].find((g) => g.id === id).querySelector('rect, polygon, path').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
  const edgeAt = (from, to, f = 0.5) => page.evaluate(([from, to, f]) => {
    const p = document.querySelector(`#map g.edge[data-from="${from}"][data-to="${to}"] path[data-line]`);
    const pt = p.getPointAtLength(p.getTotalLength() * f), m = p.getScreenCTM();
    return { x: pt.x * m.a + m.e, y: pt.y * m.d + m.f };
  }, [from, to, f]);
  const handle = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, sel);
  const drag = async (a, b) => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8); await page.waitForTimeout(30); }
    await page.mouse.up();
  };
  const status = () => page.textContent('#edit-status');

  await page.keyboard.press('e');
  check(await page.evaluate(() => !document.getElementById('edit-bar').hidden && document.getElementById('map').classList.contains('editing')), 'E opens edit mode');
  check(/save to t\.dot/.test(await status()), `says where edits go ("${await status()}")`);

  // move a box: its pos changes, and nothing else in the file
  let before = read();
  const b0 = await nodeAt('b'), b1 = await scr(800, 0);
  await drag(b0, { x: b1.x, y: b0.y });
  let text = await changed(before, 'moving b');
  check(text === FLOW.replace('pos="700,0"', 'pos="800,0"'), `dragging b pins it where it was dropped (${/b \[[^\]]*\]/.exec(text)?.[0]})`);
  await until(async () => /Saved to t\.dot/.test(await status()), 'saved status');
  await shot(page, 'edit-1-moved');

  // while the pointer moves the map is not laid out again: stand-ins; once it rests, a preview
  {
    const svgNow = () => page.evaluateHandle(() => document.querySelector('#map svg'));
    const c0 = await nodeAt('c'), first = await svgNow();
    await page.mouse.move(c0.x, c0.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(c0.x - i * 8, c0.y); await page.waitForTimeout(30); }
    const moving = await page.evaluate((s) => ({ same: document.querySelector('#map svg') === s, standins: document.querySelectorAll('#map .lm-edit-standin').length }), first);
    check(moving.same && moving.standins === 1, `a moving drag draws stand-ins, not the map (${JSON.stringify(moving)})`);
    await page.waitForTimeout(700);
    const rested = await page.evaluate((s) => ({ redrawn: document.querySelector('#map svg') !== s, standins: document.querySelectorAll('#map .lm-edit-standin').length }), first);
    check(rested.redrawn && rested.standins === 0, `once the pointer rests the map is drawn as it would be (${JSON.stringify(rested)})`);
    const kept = read();
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(400);
    check(read() === kept, 'Esc during the drag keeps the file');
  }

  // a box dropped on another one: boxes may overlap, even on the very same point, so it is pinned
  // there; undo takes it back
  before = read();
  await drag(await nodeAt('c'), await nodeAt('b'));
  text = await changed(before, 'dropping c on b');
  {
    const pos = (id) => new RegExp(`\\b${id} \\[[^\\]]*pos="([^"]*)"`).exec(text)?.[1];
    check(pos('c') && pos('c') === pos('b'), `a box dropped on the centre of another box is pinned there (c ${pos('c')}, b ${pos('b')})`);
  }
  await page.keyboard.press('Control+z');
  await changed(text, 'undoing the drop');
  check(read() === before, 'undo takes the drop back');

  // bend an edge: a via point where it was pressed
  before = read();
  const mid = await edgeAt('b', 'c');
  await drag(mid, { x: mid.x + 120, y: mid.y });
  text = await changed(before, 'bending b -> c');
  check(/b -> c \[lines=A, via="\d+,\d+"\]/.test(text), `dragging an edge adds a via (${/b -> c.*/.exec(text)?.[0]})`);
  check(await page.evaluate(() => document.querySelectorAll('#map .lm-edit-via').length) === 1, 'the via point has a handle');
  check(await cursors(page, ['#map .lm-edit-via']) === 'move', 'a via handle shows the move cursor');
  await shot(page, 'edit-2-bent');
  // double-click the via handle: gone again
  before = read();
  await page.mouse.dblclick(...Object.values(await handle('#map .lm-edit-via')));
  text = await changed(before, 'removing the via');
  check(/b -> c \[lines=A\]/.test(text), 'double-clicking a via removes it');

  // reattach: select the edge, drag its end onto another box
  before = read();
  await page.mouse.click(...Object.values(await edgeAt('b', 'c', 0.3)));
  await page.waitForTimeout(150);
  const end = await handle('#map .lm-edit-end[data-end="to"]');
  check(!!end && /reattach/.test(await page.textContent('#edit-hint')), 'a selected edge shows handles on its ends');
  {
    // edges are clicked to select (pointer, never the grab of the background); their ends are dragged (move)
    const c = await cursors(page, ['#stage', '#map g.edge > path[data-line]', '#map g.edge > .lm-casing', '#map .lm-edit-end', '#map g.node']);
    check(c === 'grab pointer pointer move move', `edit mode cursors: background grab, line and bundle pointer, edge end and box move (${c})`);
  }
  await drag(end, await nodeAt('d'));
  text = await changed(before, 'reattaching b -> c');
  check(/b -> d \[lines=A\]/.test(text) && !/b -> c/.test(text) && /c \[label="C"/.test(text), 'dragging its end onto d reattaches b -> c to b -> d; c stays');

  // connect: select a box, drag its + onto another, pick the lines
  before = read();
  await page.mouse.click(...Object.values(await nodeAt('a')));
  await page.waitForTimeout(150);
  await drag(await handle('#map .lm-edit-connect'), await nodeAt('c'));
  await page.waitForSelector('#lines-dialog[open]');
  const ticked = await page.evaluate(() => [...document.querySelectorAll('#lines-dialog input:checked')].map((b) => b.value).join());
  check(ticked === 'A,B', `the new edge offers the lines of its box, ticked (${ticked})`);
  await page.click('#lines-dialog input[value="B"]');
  await page.click('#lines-dialog .btn.primary');
  text = await changed(before, 'connecting a -> c');
  check(/\n  a -> c \[lines="A"\]\n\}/.test(text), 'connecting a to c adds a -> c [lines="A"]');

  // resize: a click on the selected box switches to resizing; the side across from the handle stays
  const click = async (pt) => { await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(500); };
  await click(await nodeAt('a'));
  await click(await nodeAt('a'));
  check(await page.evaluate(() => document.querySelectorAll('#map .lm-edit-size').length) === 8 && /resize/.test(await page.textContent('#edit-hint')), 'clicking the selected box shows resize handles');
  await shot(page, 'edit-2a-resize');
  {
    const c = await cursors(page, ['#map .lm-edit-size-se', '#map .lm-edit-size-ne', '#map .lm-edit-size-n', '#map .lm-edit-size-w']);
    check(c === 'nwse-resize nesw-resize ns-resize ew-resize', `size handles show resize cursors (${c})`);
  }
  before = read();
  const se = await handle('#map .lm-edit-size-se'), nw = await handle('#map .lm-edit-size-nw');
  await drag(se, { x: se.x + 60, y: se.y + 30 });
  text = await changed(before, 'resizing a');
  const sized = /a \[label="A", pos="(-?\d+),(-?\d+)", width=([\d.]+), height=([\d.]+)\]/.exec(text);
  const nw2 = await handle('#map .lm-edit-size-nw');
  check(!!sized && Math.abs(nw2.x - nw.x) < 4 && Math.abs(nw2.y - nw.y) < 4, `dragging the se handle resizes a, its nw corner stays (${sized?.[0]})`);
  await click(await nodeAt('a'));
  check(await page.evaluate(() => !document.querySelector('#map .lm-edit-size') && !!document.querySelector('#map .lm-edit-connect')), 'a click again: back to moving');
  {
    const c = await cursors(page, ['#map .lm-edit-connect', '#map .lm-edit-tool']);
    check(c === 'crosshair pointer', `the connect handle shows a crosshair, adorner buttons the pointer (${c})`);
    // Add node: the copy cursor over the whole map until Escape (which keeps the selection)
    await page.click('#edit-add');
    const adding = await cursors(page, ['#map svg', '#map g.node', '#map g.edge > path[data-line]']);
    await page.keyboard.press('Escape');
    const after = await cursors(page, ['#map g.node']);
    check(adding === 'copy copy copy' && after === 'move', `Add node shows the copy cursor until Escape (${adding}; then ${after})`);
  }

  // the adorner: Delete · Pin/Unpin · Resize above the box; pin and unpin, then undo both
  const tools = () => page.evaluate(() => [...document.querySelectorAll('#map .lm-edit-tool')].map((t) => t.dataset.act + (t.classList.contains('on') ? '*' : '')).join(' '));
  check(await tools() === 'delete unpin* resize note text', `a pinned box has the adorner Delete · Unpin · Resize · Add note · Edit text (${await tools()})`);
  {
    // above the box, or below it when a panel (here the edit bar) is in the way; clear of the + and
    // of every panel: each button is what a click there hits
    const r = await page.evaluate(() => {
      const box = (q) => document.querySelector(q).getBoundingClientRect();
      const ad = box('#map .lm-edit-adorner'), sel = box('#map .lm-edit-sel'), plus = box('#map .lm-edit-connect');
      const apart = (a, b) => a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left;
      const hit = [...document.querySelectorAll('#map .lm-edit-tool')].every((t) => {
        const q = t.getBoundingClientRect();
        return document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2)?.closest('.lm-edit-tool') === t;
      });
      return { side: ad.bottom <= sel.top ? 'above' : ad.top >= sel.bottom ? 'below' : 'over', clear: apart(ad, plus), hit };
    });
    check(r.side !== 'over' && r.clear && r.hit, `the adorner sits by the box, clear of the connect handle and of the panels (${JSON.stringify(r)})`);
  }
  await click(await handle('#map .lm-edit-tool[data-act="resize"]'));
  check(await page.evaluate(() => document.querySelectorAll('#map .lm-edit-size').length) === 8 && await tools() === 'delete unpin* resize* note text', `Resize in the adorner shows the handles (${await tools()})`);
  await click(await handle('#map .lm-edit-tool[data-act="resize"]'));
  check(await page.evaluate(() => !document.querySelector('#map .lm-edit-size')), 'Resize again: back to moving');
  before = read();
  await click(await handle('#map .lm-edit-tool[data-act="unpin"]'));
  text = await changed(before, 'unpinning a');
  check(/\n  a \[label="A", width=[\d.]+, height=[\d.]+\]/.test(text) && await tools() === 'delete pin resize note text', `Unpin takes a's pos away (${/a \[[^\]]*\]/.exec(text)?.[0]})`);
  await click(await handle('#map .lm-edit-tool[data-act="pin"]'));
  text = await changed(text, 'pinning a');
  check(/a \[label="A", width=[\d.]+, height=[\d.]+, pos="-?\d+,-?\d+"\]/.test(text) && await tools() === 'delete unpin* resize note text', `Pin writes a's pos (${/a \[[^\]]*\]/.exec(text)?.[0]})`);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await until(() => read() === before, 'undoing pin and unpin');

  // pin marks: one inside the top-right corner of every pinned box, clear of the adorner and the
  // connect handle; a click on one unpins its box (the selection stays), a drag from it moves the box
  {
    await click(await nodeAt('a'));
    const marks = () => page.evaluate(() => [...document.querySelectorAll('#map .lm-edit-pin')].map((m) => m.dataset.id).sort().join(' '));
    check(await marks() === 'a b c d', `every pinned box has a pin mark (${await marks()})`);
    const r = await page.evaluate(() => {
      const box = (q) => document.querySelector(q).getBoundingClientRect();
      const mark = box('#map .lm-edit-pin[data-id="a"]'), node = document.getElementById('a').querySelector('rect, polygon, path').getBoundingClientRect();
      const apart = (a, b) => a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left;
      // what a click on a mark hits (c's: a's may be under the edit bar)
      const mc = box('#map .lm-edit-pin[data-id="c"]');
      const top = document.elementFromPoint(mc.x + mc.width / 2, mc.y + mc.height / 2), hit = top?.closest('.lm-edit-pin')?.dataset.id ?? top?.outerHTML.slice(0, 80);
      return {
        corner: mark.right <= node.right && mark.right > node.right - 40 && mark.top >= node.top && mark.top < node.top + 40,
        size: Math.round(mark.width), clear: apart(mark, box('#map .lm-edit-adorner')) && apart(mark, box('#map .lm-edit-connect')), hit,
      };
    });
    check(r.corner && r.clear && r.hit === 'c', `the pin mark sits in the box's top-right corner, clear of the adorner and the + (${JSON.stringify(r)})`);
    await page.click('#zoom-in');
    await page.waitForTimeout(400);
    const zoomed = await page.evaluate(() => Math.round(document.querySelector('#map .lm-edit-pin[data-id="a"]').getBoundingClientRect().width));
    check(zoomed === r.size, `the pin mark keeps its size on screen (${r.size} px, zoomed in: ${zoomed} px)`);
    await page.click('#zoom-out');
    await page.waitForTimeout(400);
    await click(await nodeAt('a'));
    check(await page.evaluate(() => !document.querySelector('#map .lm-edit-pin[data-id="a"]') && !!document.querySelector('#map .lm-edit-pin[data-id="b"]')), 'a box being resized has no pin mark');
    await click(await nodeAt('a'));
    before = read();
    await click(await handle('#map .lm-edit-pin[data-id="b"]'));
    text = await changed(before, 'unpinning b by its mark');
    check(/\n  b \[label="B"\]/.test(text) && await marks() === 'a c d' && await tools() === 'delete unpin* resize note text', `a click on b's pin mark unpins b, a stays selected (${/b \[[^\]]*\]/.exec(text)?.[0]})`);
    await page.keyboard.press('Control+z');
    await changed(text, 'undoing the unpin');
    check(read() === before, 'undo pins b again');
    const m = await handle('#map .lm-edit-pin[data-id="c"]'), right = await scr(100, 0), zero = await scr(0, 0);
    await drag(m, { x: m.x + (right.x - zero.x), y: m.y });
    text = await changed(before, 'dragging c by its pin mark');
    check(/c \[label="C", pos="800,500"\]/.test(text), `a drag from c's pin mark moves c (${/c \[[^\]]*\]/.exec(text)?.[0]})`);
    await page.keyboard.press('Control+z');
    await changed(text, 'undoing the move');
    check(read() === before, 'undo moves c back');
  }

  // Add note on a box in a container: a text dialog (Escape cancels, Ctrl+Enter adds); the note
  // is unpinned, in the box's container, attached by an edge without lines, and selected; one undo
  {
    await click(await nodeAt('d'));
    before = read();
    await click(await handle('#map .lm-edit-tool[data-act="note"]'));
    await page.waitForSelector('#note-dialog[open]');
    await page.fill('#note-dialog textarea', 'never mind');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    check(await page.evaluate(() => !document.querySelector('#note-dialog[open]')) && read() === before, 'Escape closes the note dialog and adds nothing');
    await click(await handle('#map .lm-edit-tool[data-act="note"]'));
    await page.waitForSelector('#note-dialog[open]');
    check(await page.evaluate(() => document.activeElement === document.querySelector('#note-dialog textarea') && document.querySelector('#note-dialog textarea').value === ''), 'the note dialog opens empty, the text area focused');
    await page.keyboard.type('First line');
    await page.keyboard.press('Enter');
    await page.keyboard.type('  second line');
    await page.keyboard.press('Enter');
    await page.keyboard.type('third');
    await page.keyboard.press('Control+Enter');
    text = await changed(before, 'adding a note to d');
    const note = /subgraph cluster_x \{[^}]*\bnote_d \[label="First line\\n  second line\\nthird", shape=note\][^}]*\}/.test(text);
    check(note && /\n  d -> note_d\n/.test(text), `Add note writes an unpinned note in d's container, attached to d (${/note_d[^\n]*/.exec(text)?.[0]} | ${/[^\n]*-> note_d[^\n]*/.exec(text)?.[0]})`);
    const r = await page.evaluate(() => {
      const g = document.getElementById('note_d');
      return { rows: g ? g.querySelectorAll('text tspan').length || g.querySelectorAll('text').length : 0 };
    });
    check(r.rows === 3 && await tools() === 'delete pin resize text', `the note is drawn with three lines and selected, unpinned (${JSON.stringify(r)}, ${await tools()})`);
    await page.keyboard.press('Control+z');
    await changed(text, 'undoing the note');
    check(read() === before && await page.evaluate(() => !document.getElementById('note_d')), 'one undo removes the note and its edge');
    // rich text: written as an HTML-like label, drawn with a bold run
    await click(await nodeAt('d'));
    await click(await handle('#map .lm-edit-tool[data-act="note"]'));
    await page.waitForSelector('#note-dialog[open]');
    await page.keyboard.type('A <b>bold</b> one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('& more');
    await page.keyboard.press('Control+Enter');
    text = await changed(before, 'adding a rich note to d');
    const bold = await page.evaluate(() => document.querySelector('#note_d tspan[font-weight="700"]')?.textContent);
    check(/note_d \[label=<A <b>bold<\/b> one<br\/>&amp; more>, shape=note\]/.test(text) && bold === 'bold', `a note with <b> is written as label=<…> and drawn bold (${/note_d[^\n]*/.exec(text)?.[0]}; ${bold})`);
    await page.keyboard.press('Control+z');
    await changed(text, 'undoing the rich note');
  }

  // Edit text: F2, Enter, the adorner or a double-click opens the text dialog with the label as
  // written; Escape cancels, Ctrl+Enter sets it (one edit, one undo); the box stays selected
  {
    const dialog = () => page.evaluate(() => {
      const d = document.querySelector('#note-dialog');
      return d.open ? { h: d.querySelector('h2').textContent, v: d.querySelector('textarea').value, rich: !d.querySelector('.rich-hint').hidden, ok: d.querySelector('button[value="ok"]').textContent } : null;
    });
    await page.keyboard.press('Escape');
    await click(await nodeAt('d'));
    before = read();
    check(await page.isVisible('#edit-text'), 'Text… shows in the edit bar for a selected box');
    await page.keyboard.press('F2');
    await page.waitForSelector('#note-dialog[open]');
    let o = await dialog();
    check(o?.h === 'Edit the text of the box' && o.v === 'D' && !o.rich && o.ok === 'Save', `F2 opens the text dialog with the box's label, no rich-text hint (${JSON.stringify(o)})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    check(!(await dialog()) && read() === before, 'Escape closes it, nothing changes');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#note-dialog[open]');
    await page.fill('#note-dialog textarea', 'Dee\n"two"');
    await page.keyboard.press('Control+Enter');
    text = await changed(before, 'editing the text of d');
    check(/d \[label="Dee\\n\\"two\\"", pos="0,500"\]/.test(text) && await tools() === 'delete unpin* resize note text', `Enter, then Ctrl+Enter writes d's label, d stays selected (${/d \[[^\]]*\]/.exec(text)?.[0]})`);
    await page.keyboard.press('Control+z');
    await changed(text, 'undoing the text');
    check(read() === before, 'one undo puts the old label back');
    // a double-click on a box: the dialog, no resize mode, no drag, nothing pinned or moved
    const pt = await nodeAt('b');
    await page.mouse.dblclick(pt.x, pt.y);
    await page.waitForSelector('#note-dialog[open]');
    o = await dialog();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check(o?.v === 'B' && read() === before && await page.evaluate(() => !document.querySelector('#map .lm-edit-size')), `a double-click on b opens its text, nothing else changes (${JSON.stringify(o)})`);
    // Enter on a focused button keeps its meaning
    await page.focus('#zoom-fit');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    check(!(await dialog()), 'Enter on a focused button does not open the text dialog');
    // a note: its HTML-like source, tags kept, <br/> as a line break; the rich hint shows
    await click(await nodeAt('d'));
    await click(await handle('#map .lm-edit-tool[data-act="note"]'));
    await page.waitForSelector('#note-dialog[open]');
    await page.keyboard.type('A <b>bold</b> one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('next');
    await page.keyboard.press('Control+Enter');
    const noted = await changed(before, 'adding a rich note for editing');
    await page.waitForTimeout(300);
    await click(await handle('#map .lm-edit-tool[data-act="text"]'));
    await page.waitForSelector('#note-dialog[open]');
    o = await dialog();
    check(o?.h === 'Edit the note' && o.v === 'A <b>bold</b> one\nnext' && o.rich, `Edit text on a note opens its source with the tags (${JSON.stringify(o)})`);
    await page.fill('#note-dialog textarea', 'A <i>new</i> one\nnext');
    await page.keyboard.press('Control+Enter');
    text = await changed(noted, 'editing the note');
    check(/note_d \[label=<A <i>new<\/i> one<br\/>next>, shape=note\]/.test(text) && await page.evaluate(() => !!document.querySelector('#note_d tspan[font-style="italic"]')), `the note's text is written as label=<…> again (${/note_d \[[^\n]*/.exec(text)?.[0]})`);
    await page.keyboard.press('Control+z');
    await changed(text, 'undoing the note text');
    await page.keyboard.press('Control+z');
    await changed(noted, 'undoing the note');
    check(read() === before, 'two undos: back to before the note');
    // typing in the source sidebar: F2 and Enter are only text there
    await click(await nodeAt('d'));
    await page.keyboard.press('s');
    await page.waitForTimeout(300);
    await page.focus('#source-panel textarea');
    await page.keyboard.press('F2');
    await page.waitForTimeout(200);
    check(!(await dialog()), 'F2 in the source sidebar opens no dialog');
    await page.keyboard.press('Escape');
    await page.keyboard.press('s');
    await page.waitForTimeout(300);
  }

  // one line of a bundle: click the selected edge on a lane
  const laneAt = (from, to, line, f = 0.5) => page.evaluate(([from, to, line, f]) => {
    const p = document.querySelector(`#map g.edge[data-from="${from}"][data-to="${to}"] path.lm-strand[data-line="${line}"]`);
    const pt = p.getPointAtLength(p.getTotalLength() * f), m = p.getScreenCTM();
    return { x: pt.x * m.a + m.e, y: pt.y * m.d + m.f };
  }, [from, to, line, f]);
  await click(await laneAt('a', 'b', 'B', 0.4));
  check(!/^Line/.test(await page.textContent('#edit-hint')) && await page.isVisible('#edit-lines'), 'a click on an edge selects its bundle, Lines… shows');
  await click(await laneAt('a', 'b', 'B', 0.4));
  check(/^Line Beta:/.test(await page.textContent('#edit-hint')) && await page.evaluate(() => !!document.querySelector('#map .lm-edit-lane')), `a click again selects the line clicked ("${(await page.textContent('#edit-hint')).slice(0, 20)}")`);
  await shot(page, 'edit-2b-line');
  before = read();
  await page.keyboard.press('Delete');
  text = await changed(before, 'taking B off a -> b');
  check(/a -> b \[lines="A"\]/.test(text), 'Delete takes only that line off the edge');
  before = read();
  await page.keyboard.press('Control+z');
  await changed(before, 'undo');
  await click(await laneAt('a', 'b', 'B', 0.4));
  await click(await laneAt('a', 'b', 'B', 0.4));
  before = read();
  await drag(await handle('#map .lm-edit-end[data-end="to"]'), await nodeAt('c'));
  text = await changed(before, 'moving B to a -> c');
  check(/a -> b \[lines="A"\]/.test(text) && /a -> c \[lines="A B"\]/.test(text), 'dragging the end of one line moves only it: onto a -> c');
  // Lines…: pick the lines of the selected edge
  await click(await laneAt('a', 'b', 'A'));
  await page.click('#edit-lines');
  await page.waitForSelector('#lines-dialog[open]');
  const on = await page.evaluate(() => [...document.querySelectorAll('#lines-dialog input:checked')].map((b) => b.value).join());
  check(on === 'A', `Lines… ticks the lines of the edge (${on})`);
  before = read();
  await page.click('#lines-dialog input[value="B"]');
  await page.click('#lines-dialog .btn.primary');
  text = await changed(before, 'setting the lines of a -> b');
  check(/a -> b \[lines="A B"\]/.test(text), 'and sets them');
  await shot(page, 'edit-2c-lines');

  // several boxes: Shift+click, then drag one of them: both move as far
  {
    const posOf = (t, id) => new RegExp(`\\n\\s*${id} \\[[^\\]]*pos="(-?\\d+),(-?\\d+)"`).exec(t).slice(1).map(Number);
    await page.keyboard.press('Escape');
    await click(await nodeAt('a'));
    await page.keyboard.down('Shift');
    await click(await nodeAt('b'));
    await page.keyboard.up('Shift');
    check(/^2 boxes:/.test(await page.textContent('#edit-hint')) && await page.evaluate(() => document.querySelectorAll('#map .lm-edit-sel').length) === 2, 'Shift+click adds a box to the selection');
    before = read();
    const [a0, b0] = [posOf(before, 'a'), posOf(before, 'b')];
    const bAt = await nodeAt('b'), up = await scr(0, -100), zero = await scr(0, 0);
    await drag(bAt, { x: bAt.x, y: bAt.y + (up.y - zero.y) });
    text = await changed(before, 'moving a and b');
    const [a1, b1] = [posOf(text, 'a'), posOf(text, 'b')];
    check(a1[0] === a0[0] && b1[0] === b0[0] && a1[1] - a0[1] === -100 && b1[1] - b0[1] === -100, `dragging one moves both by as much (a ${a0} -> ${a1}, b ${b0} -> ${b1})`);
    await shot(page, 'edit-2d-multi');

    // their adorner, above both: Delete · Unpin all · Resize; Unpin all and Pin all, one undo each
    const attr = (t, id, k) => new RegExp(`\\n\\s*${id} \\[[^\\]]*\\b${k}=("[^"]*"|[\\d.]+)`).exec(t)?.[1];
    check(await tools() === 'delete unpin* resize align', `two pinned boxes have the adorner Delete · Unpin all · Resize (${await tools()})`);
    {
      const r = await page.evaluate(() => {
        const ad = document.querySelector('#map .lm-edit-adorner').getBoundingClientRect();
        const sels = [...document.querySelectorAll('#map .lm-edit-sel')].map((x) => x.getBoundingClientRect());
        const x0 = Math.min(...sels.map((q) => q.left)), x1 = Math.max(...sels.map((q) => q.right));
        const side = ad.bottom <= Math.min(...sels.map((q) => q.top)) ? 'above' : ad.top >= Math.max(...sels.map((q) => q.bottom)) ? 'below' : 'over';
        return { side, centred: Math.abs((ad.left + ad.right) / 2 - (x0 + x1) / 2) < 2 };
      });
      check(r.side !== 'over' && r.centred, `the adorner of several boxes sits by their bounding box, centred (${JSON.stringify(r)})`);
    }
    const pinned = text;
    await click(await handle('#map .lm-edit-tool[data-act="unpin"]'));
    text = await changed(pinned, 'unpinning a and b');
    check(!attr(text, 'a', 'pos') && !attr(text, 'b', 'pos') && await tools() === 'delete pin resize align', `Unpin all takes the pos of a and b (${await tools()})`);
    await page.keyboard.press('Control+z');
    text = await changed(text, 'undoing unpin all');
    check(text === pinned, 'one undo pins both again');
    // only a unpinned: Pin all pins it again, b stays (an undo clears the selection)
    // (a is under the edit bar now: the wheel brings the boxes down)
    const mid = await page.evaluate(() => { const r = document.getElementById('map').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(400);
    await click(await nodeAt('a'));
    await page.keyboard.press('p');
    text = await changed(pinned, 'unpinning a alone');
    await page.keyboard.down('Shift');
    await click(await nodeAt('b'));
    await page.keyboard.up('Shift');
    check(/^2 boxes:/.test(await page.textContent('#edit-hint')) && await tools() === 'delete pin resize align', `some pinned: the adorner offers Pin all (${await tools()})`);
    const half = text;
    await click(await handle('#map .lm-edit-tool[data-act="pin"]'));
    text = await changed(half, 'pinning all');
    check(!!attr(text, 'a', 'pos') && attr(text, 'b', 'pos') === attr(pinned, 'b', 'pos') && await tools() === 'delete unpin* resize align', `Pin all pins a, b stays (${attr(text, 'a', 'pos')}, ${attr(text, 'b', 'pos')})`);
    await page.keyboard.press('Control+z');
    await changed(text, 'undoing pin all');
    await page.keyboard.press('Control+z');
    text = await changed(half, 'undoing the unpin of a');
    check(text === pinned, 'undo twice: as before');
    await click(await nodeAt('a'));
    await page.keyboard.down('Shift');
    await click(await nodeAt('b'));
    await page.keyboard.up('Shift');
    check(/^2 boxes:/.test(await page.textContent('#edit-hint')), 'a and b selected again');

    // resize several: a click on a selected box puts them all in size mode, handles on that box
    await click(await nodeAt('a'));
    const sizeMode = () => page.evaluate(() => ({
      handles: document.querySelectorAll('#map .lm-edit-size').length,
      outlined: document.querySelectorAll('#map .lm-edit-sel.sizing').length,
      marks: [...document.querySelectorAll('#map .lm-edit-pin')].map((m) => m.dataset.id).sort().join(' '),
    }));
    let m = await sizeMode();
    check(m.handles === 8 && m.outlined === 2 && m.marks === 'c d' && /^2 boxes: Drag a handle/.test(await page.textContent('#edit-hint')) && await tools() === 'delete unpin* resize* align',
      `a click on a selected box: all in size mode, 8 handles, both outlined, no pin marks on them (${JSON.stringify(m)}, ${await tools()})`);
    before = read();
    const bPos = attr(before, 'b', 'pos');
    const se = await handle('#map .lm-edit-size-se'), nw = await handle('#map .lm-edit-size-nw');
    const step = (await scr(100, 0)).x - (await scr(0, 0)).x;
    await drag(se, { x: se.x + 0.6 * step, y: se.y + 0.3 * step });
    text = await changed(before, 'resizing a and b');
    const nw2 = await handle('#map .lm-edit-size-nw');
    const same = ['width', 'height'].every((k) => attr(text, 'a', k) && attr(text, 'a', k) === attr(text, 'b', k));
    check(same && attr(text, 'b', 'pos') === bPos && Math.abs(nw2.x - nw.x) < 4 && Math.abs(nw2.y - nw.y) < 4,
      `dragging a's se handle gives a and b one size; b keeps its centre, a its nw corner (a ${attr(text, 'a', 'width')}x${attr(text, 'a', 'height')} at ${attr(text, 'a', 'pos')}, b ${attr(text, 'b', 'width')}x${attr(text, 'b', 'height')} at ${attr(text, 'b', 'pos')})`);
    m = await sizeMode();
    check(m.handles === 8 && m.outlined === 2, `still in size mode after the resize (${JSON.stringify(m)})`);
    await page.keyboard.press('Control+z');
    await changed(text, 'undoing the resize');
    check(read() === before, 'one undo takes both sizes back');
    await page.waitForTimeout(300);
    // a click on one of them: back to moving; Resize in the adorner, then Escape, likewise
    // (an undo clears the selection: a and b again, in size mode)
    await click(await nodeAt('a'));
    await page.keyboard.down('Shift');
    await click(await nodeAt('b'));
    await page.keyboard.up('Shift');
    await click(await nodeAt('a'));
    check((await sizeMode()).handles === 8, 'a and b in size mode again');
    await click(await nodeAt('b'));
    m = await sizeMode();
    check(m.handles === 0 && /^2 boxes: Drag one/.test(await page.textContent('#edit-hint')), `a click on one of them: back to moving, both still selected (${JSON.stringify(m)})`);
    await click(await handle('#map .lm-edit-tool[data-act="resize"]'));
    m = await sizeMode();
    check(m.handles === 8 && m.outlined === 2, `Resize in the adorner: all in size mode (${JSON.stringify(m)})`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    m = await sizeMode();
    check(m.handles === 0 && /^2 boxes:/.test(await page.textContent('#edit-hint')), `Escape: back to moving, both still selected (${JSON.stringify(m)})`);
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(400);
    // a click on a container: its boxes (Shift: added)
    await page.keyboard.press('Escape');
    await click(await nodeAt('c'));
    const corner = await page.evaluate(() => { const r = document.querySelector('#map g.group#cluster_x > rect').getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height - 10 }; });
    await page.keyboard.down('Shift');
    await click(corner);
    await page.keyboard.up('Shift');
    check(/^2 boxes:/.test(await page.textContent('#edit-hint')), `Shift+click on a container adds its boxes (${(await page.textContent('#edit-hint')).slice(0, 12)})`);
    // a click on a container: the container itself; again: its boxes (here d alone); again: it
    check(await cursors(page, ['#map g.group#cluster_x > rect']) === 'pointer', 'a container not selected shows the pointer');
    await click(corner);
    check(/^X: Drag it/.test(await page.textContent('#edit-hint')) && await page.evaluate(() => !!document.querySelector('#map .lm-edit-sel') && !!document.querySelector('#map .lm-edit-connect')), `a click on a container selects it, outlined, with a connect handle (${(await page.textContent('#edit-hint')).slice(0, 12)})`);
    check(await cursors(page, ['#map g.group#cluster_x > rect']) === 'move', 'a selected container shows the move cursor');
    await click(corner);
    check(!/boxes/.test(await page.textContent('#edit-hint')) && /click again to resize/.test(await page.textContent('#edit-hint')), 'a second click selects its boxes (here: d alone)');
    await click(corner);
    check(/^X: /.test(await page.textContent('#edit-hint')), 'a third click selects the container again');
    // Shift+drag on the background: the boxes in the rectangle
    await page.keyboard.press('Escape');
    const r0 = await scr(-200, 650), r1 = await scr(720, 250);
    const vb = () => page.evaluate(() => document.querySelector('#map svg').getAttribute('viewBox'));
    const vbSel = await vb();
    await page.keyboard.down('Shift');
    await drag(r0, r1);
    await page.keyboard.up('Shift');
    check(/^2 boxes:/.test(await page.textContent('#edit-hint')), 'Shift+drag on the background selects the boxes in the rectangle (c and d)');
    check(await vb() === vbSel, 'Shift+drag on the background does not pan');
    // a plain drag on the background pans, and keeps the selection
    await drag(r0, { x: r0.x + 40, y: r0.y - 30 });
    await page.waitForTimeout(200);
    check(await vb() !== vbSel && /^2 boxes:/.test(await page.textContent('#edit-hint')), 'a plain drag on the background in edit mode pans, the selection stays');
    await page.keyboard.press('Escape');

    // the middle button pans, also over a box, and moves nothing
    const file = read();
    const v0 = await vb(), c = await nodeAt('c');
    await page.mouse.move(c.x, c.y);
    await page.mouse.down({ button: 'middle' });
    for (let i = 1; i <= 6; i++) { await page.mouse.move(c.x + i * 10, c.y + i * 5); await page.waitForTimeout(20); }
    await page.mouse.up({ button: 'middle' });
    const v1 = await vb();
    check(v1 !== v0 && read() === file, `a middle-button drag over a box pans and moves nothing (${v0} -> ${v1})`);
    await page.keyboard.press('0');
    await page.waitForTimeout(300);
  }

  // a new box: double-click the map, name it
  before = read();
  // a spot where the map shows only its background
  const spot = await page.evaluate(() => {
    const m = document.querySelector('#map svg').getScreenCTM();
    for (const [x, y] of [[350, 250], [350, 150], [250, 300], [1000, 250], [350, 650], [-300, 250]]) {
      const sx = x * m.a + m.e, sy = y * m.d + m.f;
      if (document.elementFromPoint(sx, sy)?.matches('rect.lm-bg')) return { x, y, sx, sy };
    }
    return null;
  });
  await page.mouse.dblclick(spot.sx, spot.sy);
  await page.waitForSelector('#label-dialog[open]');
  await page.keyboard.type('New box');
  await page.keyboard.press('Enter');
  text = await changed(before, 'adding a node');
  check(new RegExp(`new_box \\[label="New box", pos="${spot.x},${spot.y}"\\]`).test(text), `double-clicking the map adds a box there (${/new_box.*/.exec(text)?.[0]})`);
  await shot(page, 'edit-3-added');

  // delete it (it is selected), undo, redo
  before = read();
  await page.keyboard.press('Delete');
  text = await changed(before, 'deleting');
  check(!/new_box/.test(text), 'Delete removes the selected box');
  before = read();
  await page.keyboard.press('Control+z');
  text = await changed(before, 'undo');
  check(/new_box/.test(text), 'Ctrl+Z brings it back');
  before = read();
  await page.keyboard.press('Control+Shift+z');
  text = await changed(before, 'redo');
  check(!/new_box/.test(text), 'Ctrl+Shift+Z removes it again');

  // delete an edge
  before = read();
  await page.mouse.click(...Object.values(await edgeAt('a', 'd')));
  await page.keyboard.press('Delete');
  text = await changed(before, 'deleting a -> d');
  check(!/a -> d/.test(text) && /\n    d\n|cluster_x \{[^}]*d \[/.test(text), 'Delete removes the selected edge, d stays in X');

  // the file changed on disk meanwhile: the edit is not saved over it
  const disk = read().replace('label="A"', 'label="A on disk"');
  fs.writeFileSync(file, disk);
  await drag(await nodeAt('c'), { ...(await nodeAt('c')), x: (await nodeAt('c')).x + 60 });
  await until(async () => /changed on disk/.test(await page.textContent('#toast')), 'conflict toast');
  await page.waitForTimeout(600);
  check(read() === disk, 'an edit is not saved over a file changed on disk');
  check(await page.evaluate(() => [...document.querySelectorAll('#map g.node')].some((g) => g.getAttribute('data-label') === 'A on disk')), 'the map shows the file as it is on disk');
  check(await page.isDisabled('#edit-undo'), 'and undo starts over');

  // leaving edit mode: clicks pin lines again
  await page.keyboard.press('e');
  check(await page.evaluate(() => document.getElementById('edit-bar').hidden && !document.querySelector('#map .lm-edit')), 'E again leaves edit mode, no handles left');
  // (the refused save shows as a failed request in the console)
  const errors = page.errors.filter((e) => !/412/.test(e));
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
  await page.close();
  editServer.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('edit mode, container actions: group, ungroup, merge, split');
{
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linemap-groups-'));
  const file = path.join(dir, 'g.dot');
  const FLOW = `digraph g {
  subgraph lines { A }
  a [pos="0,0"]
  b [pos="300,0"]
  subgraph cluster_x { label="X"; c [pos="0,300"]; d [pos="300,300"]; g [pos="500,300"] }
  subgraph cluster_y { label="Y"; e [pos="0,600"]; f [pos="300,600"] }
  a -> b [lines=A]
  b -> c [lines=A]
  d -> e [lines=A]
  a -> cluster_y [lines=A]
}
`;
  fs.writeFileSync(file, FLOW);
  const read = () => fs.readFileSync(file, 'utf8');
  const groupServer = await serve({ dir, port: 0, quiet: true });
  const page = await newPage();
  await page.goto(`http://127.0.0.1:${groupServer.address().port}/studio.html#src=g.dot`);
  await ready(page);
  const until = async (fn, what) => {
    for (let i = 0; i < 100; i++) { if (await fn()) return true; await page.waitForTimeout(50); }
    check(false, `timed out: ${what}`);
    return false;
  };
  const changed = async (before, what) => { await until(() => read() !== before, what); await page.waitForTimeout(400); return read(); };
  const nodeAt = (id) => page.evaluate((id) => { const r = [...document.querySelectorAll('#map g.node')].find((g) => g.id === id).querySelector('rect, polygon, path').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
  const handle = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, sel);
  const click = async (pt) => { await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(400); };
  const pick = async (...ids) => {
    await page.keyboard.press('Escape');
    await click(await nodeAt(ids[0]));
    await page.keyboard.down('Shift');
    for (const id of ids.slice(1)) await click(await nodeAt(id));
    await page.keyboard.up('Shift');
  };
  const tools = () => page.evaluate(() => [...document.querySelectorAll('#map .lm-edit-tool')].map((t) => t.dataset.act + (t.classList.contains('on') ? '*' : '')).join(' '));
  const bar = () => page.evaluate(() => ['group', 'merge', 'split', 'ungroup'].filter((a) => !document.getElementById(`edit-${a}`).hidden).join(' '));
  const hint = () => page.textContent('#edit-hint');
  // the statements of a container (its braces matched)
  const body = (t, id) => {
    const i = t.indexOf(`subgraph ${id} {`);
    if (i < 0) return null;
    let depth = 0;
    for (let j = t.indexOf('{', i); j < t.length; j++) {
      if (t[j] === '{') depth++;
      else if (t[j] === '}' && !--depth) return t.slice(i, j + 1);
    }
    return null;
  };
  const has = (b, id) => !!b && new RegExp(`[{;\\s]${id}\\b(?! *->)`).test(b);
  const undoTo = async (target, what) => {
    for (let i = 0; i < 3 && read() !== target; i++) { const t = read(); await page.keyboard.press('Control+z'); await changed(t, what); }
    check(read() === target, `${what}: one undo each, back to the file before`);
  };
  await page.keyboard.press('e');
  await page.waitForTimeout(300);

  // two top-level boxes: only Group; then exactly a container's boxes: Ungroup
  await pick('a', 'b');
  check(await tools() === 'delete unpin* resize align group' && await bar() === 'group', `two boxes at the top: the adorner offers Group (${await tools()}; bar: ${await bar()})`);
  let before = read();
  await click(await handle('#map .lm-edit-tool[data-act="group"]'));
  await page.waitForSelector('#label-dialog[open]');
  check(await page.textContent('#label-dialog h2') === 'New container', 'Group asks for the label of the new container');
  await page.keyboard.type('Pair');
  await page.keyboard.press('Enter');
  let text = await changed(before, 'grouping a and b');
  const pair = body(text, 'cluster_pair');
  check(has(pair, 'a') && has(pair, 'b') && /label = "Pair"/.test(pair), `Group writes a new container around a and b (${pair?.replace(/\s+/g, ' ')})`);
  check(/^2 boxes:/.test(await hint()) && await tools() === 'delete unpin* resize align ungroup text' && await bar() === 'ungroup', `its boxes stay selected; now exactly its boxes: Ungroup (${await tools()})`);
  const grouped = text;
  await click(await handle('#map .lm-edit-tool[data-act="ungroup"]'));
  text = await changed(grouped, 'ungrouping Pair');
  check(!/cluster_pair/.test(text) && /\ba \[pos="0,0"\]/.test(text) && /^2 boxes:/.test(await hint()), 'Ungroup removes the container, a and b stay (and stay selected)');
  await undoTo(FLOW, 'undo ungroup and group');

  // boxes from X (clicked first) and Y: Merge into X; edges to Y move onto X
  await pick('c', 'e');
  check(await tools() === 'delete unpin* resize align group merge' && await bar() === 'group merge', `boxes from two containers: Group and Merge (${await tools()})`);
  before = read();
  await click(await handle('#map .lm-edit-tool[data-act="merge"]'));
  text = await changed(before, 'merging Y into X');
  const x = body(text, 'cluster_x');
  check(!/cluster_y/.test(text.replace(/a -> cluster_y/, '')) && ['c', 'd', 'g', 'e', 'f'].every((id) => has(x, id)) && /label="X"/.test(x), `Merge: e and f join X, Y goes (${x?.replace(/\s+/g, ' ')})`);
  check(/a -> cluster_x \[lines=A\]/.test(text) && !/cluster_y/.test(text), 'the edge to Y now goes to X');
  check(/^5 boxes:/.test(await hint()), `the boxes of X are selected (${(await hint()).slice(0, 10)})`);
  await undoTo(FLOW, 'undo merge');

  // two of X's three boxes: Group (inside X) and Split (beside X)
  await pick('c', 'd');
  check(await tools() === 'delete unpin* resize align group split' && await bar() === 'group split', `two of a container's boxes: Group and Split (${await tools()})`);
  before = read();
  await click(await handle('#map .lm-edit-tool[data-act="split"]'));
  await page.waitForSelector('#label-dialog[open]');
  check(/Out of X/.test(await page.textContent('#label-dialog .hint')), 'Split asks for the label of the new container');
  await page.keyboard.type('Side');
  await page.keyboard.press('Enter');
  text = await changed(before, 'splitting c and d off X');
  const side = body(text, 'cluster_side'), x2 = body(text, 'cluster_x');
  check(has(side, 'c') && has(side, 'd') && !has(x2, 'c') && has(x2, 'g') && !x2.includes('cluster_side'), `Split: c and d in a new container beside X, g stays (${side?.replace(/\s+/g, ' ')})`);
  check(/^2 boxes:/.test(await hint()) && /ungroup/.test(await tools()), 'they stay selected, as the new container\'s boxes');
  await undoTo(FLOW, 'undo split');
  // Group inside X
  await pick('c', 'd');
  before = read();
  await page.click('#edit-group');
  await page.waitForSelector('#label-dialog[open]');
  await page.keyboard.type('Inner');
  await page.keyboard.press('Enter');
  text = await changed(before, 'grouping c and d in X');
  const inner = body(text, 'cluster_inner');
  check(has(inner, 'c') && has(inner, 'd') && body(text, 'cluster_x')?.includes('subgraph cluster_inner'), 'Group from the edit bar: the new container is inside X');
  await undoTo(FLOW, 'undo group');

  // a click on a container selects it; a second click its boxes: Ungroup, from the edit bar
  await page.keyboard.press('Escape');
  const corner = await page.evaluate(() => { const r = document.querySelector('#map g.group#cluster_x > rect').getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height - 10 }; });
  await click(corner);
  check(/^X: /.test(await hint()) && await tools() === 'delete deleteAll unpin* text' && await bar() === '' && await page.isVisible('#edit-delete-all'), `a click on X: the container, its own adorner (${await tools()})`);
  await click(corner);
  check(/^3 boxes:/.test(await hint()) && await tools() === 'delete unpin* resize align ungroup text' && await bar() === 'ungroup', `a second click on X: its boxes, Ungroup offered (${await tools()})`);
  // Edit text on a clicked container: rename it (its label prefilled), one undo
  before = read();
  await click(await handle('#map .lm-edit-tool[data-act="text"]'));
  await page.waitForSelector('#note-dialog[open]');
  {
    const o = await page.evaluate(() => ({ h: document.querySelector('#note-dialog h2').textContent, v: document.querySelector('#note-dialog textarea').value }));
    check(o.h === 'Rename the container' && o.v === 'X', `Edit text on a clicked container opens its label (${JSON.stringify(o)})`);
  }
  await page.fill('#note-dialog textarea', 'Ex');
  await page.keyboard.press('Control+Enter');
  text = await changed(before, 'renaming X');
  check(/subgraph cluster_x \{ label="Ex";/.test(text) && /^3 boxes:/.test(await hint()), `the container's label is set, its boxes stay selected (${/subgraph cluster_x[^\n]*/.exec(text)?.[0]})`);
  await undoTo(FLOW, 'undo rename');
  await click(corner);
  await click(corner);
  before = read();
  await page.click('#edit-ungroup');
  text = await changed(before, 'ungrouping X');
  check(!/cluster_x/.test(text) && /cluster_y/.test(text), 'Ungroup from the edit bar removes X');
  await undoTo(FLOW, 'undo ungroup');

  // a selected container: Del removes only it; Delete with contents asks, then removes all it holds
  await page.keyboard.press('Escape');
  await click(corner);
  await page.keyboard.press('Delete');
  text = await changed(FLOW, 'deleting X alone');
  check(!/cluster_x/.test(text) && /\bc \[pos="0,300"\]/.test(text) && /d -> e/.test(text), `Del on a container removes it, its boxes and their edges stay (${text.replace(/\s+/g, ' ').slice(0, 120)})`);
  await undoTo(FLOW, 'undo delete X');
  await click(corner);
  await click(await handle('#map .lm-edit-tool[data-act="deleteAll"]'));
  await page.waitForSelector('#confirm-dialog[open]');
  {
    const o = await page.evaluate(() => ({ h: document.querySelector('#confirm-dialog h2').textContent, t: document.querySelector('#confirm-dialog .hint').textContent, focus: document.activeElement?.textContent }));
    check(/^Delete X with everything/.test(o.h) && /3 boxes/.test(o.t) && o.focus === 'Cancel', `Delete with contents asks first, naming what goes, Cancel focused (${JSON.stringify(o)})`);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(read() === FLOW, 'Escape in the question deletes nothing');
  await page.keyboard.press('Escape');
  await click(corner);
  await click(await handle('#map .lm-edit-tool[data-act="deleteAll"]'));
  await page.waitForSelector('#confirm-dialog[open]');
  await page.click('#confirm-dialog button[value="ok"]');
  text = await changed(FLOW, 'deleting X with its contents');
  check(!/cluster_x/.test(text) && !/\bc \[/.test(text) && !/b -> c|d -> e/.test(text) && /cluster_y/.test(text), `confirmed: X, its boxes and their edges go (${text.replace(/\s+/g, ' ').slice(0, 160)})`);
  await undoTo(FLOW, 'undo delete with contents');

  // a drag on a selected container moves all its boxes, pinned, in one edit; on one not selected it pans
  await page.keyboard.press('Escape');
  const scale = await page.evaluate(() => document.querySelector('#map svg').getScreenCTM().a);
  const dragBy = async (a, dx) => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(a.x + dx * i / 8, a.y); await page.waitForTimeout(30); }
    await page.mouse.up();
    await page.waitForTimeout(300);
  };
  {
    const t0 = await page.evaluate(() => document.querySelector('#map svg').getScreenCTM().e);
    await dragBy(corner, 40);
    const t1 = await page.evaluate(() => document.querySelector('#map svg').getScreenCTM().e);
    check(read() === FLOW && Math.abs(t1 - t0 - 40) < 2 && !/^X: /.test(await hint()), `a drag on a container not selected pans the map (${Math.round(t1 - t0)} px)`);
    await dragBy({ x: corner.x + 40, y: corner.y }, -40);
  }
  await click(corner);
  await dragBy(corner, 100 * scale);
  text = await changed(FLOW, 'moving X');
  check(/c \[pos="100,300"\]/.test(text) && /d \[pos="400,300"\]/.test(text) && /g \[pos="600,300"\]/.test(text) && /e \[pos="0,600"\]/.test(text) && /^X: /.test(await hint()),
    `dragging X moves c, d and g by the drag, X stays selected (${/subgraph cluster_x[^\n]*/.exec(text)?.[0]})`);
  await undoTo(FLOW, 'undo moving X');

  // the + of a selected container: an edge from its box
  await click(corner);
  await page.mouse.move(...Object.values(await handle('#map .lm-edit-connect')));
  await page.mouse.down();
  {
    const a = await nodeAt('a');
    for (let i = 1; i <= 8; i++) { await page.mouse.move(a.x, a.y, { steps: 1 }); await page.waitForTimeout(30); }
  }
  await page.mouse.up();
  await page.waitForSelector('#lines-dialog[open]');
  await page.check('#lines-dialog input[value="A"]');
  await page.click('#lines-dialog button[value="ok"]');
  text = await changed(FLOW, 'connecting X to a');
  check(/cluster_x -> a \[lines=A\]/.test(text), `the + of a container draws an edge from its box (${/[^\n]*cluster_x -> [^\n]*/.exec(text)?.[0]})`);
  await undoTo(FLOW, 'undo connect');
  // Escape on the label dialog: nothing changes
  await pick('a', 'b');
  await click(await handle('#map .lm-edit-tool[data-act="group"]'));
  await page.waitForSelector('#label-dialog[open]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check(read() === FLOW, 'Escape in the label dialog groups nothing');

  // Align: a menu from the adorner (and the edit bar); distribute needs three boxes
  const menu = () => page.evaluate(() => {
    const m = document.getElementById('align-menu');
    return m.hidden ? null : { focus: document.activeElement?.dataset.how ?? document.activeElement?.id ?? '', off: [...m.querySelectorAll('[data-how]:disabled')].map((b) => b.dataset.how).join(' ') };
  });
  const posOf = (t, id) => { const m = new RegExp(`\\b${id} \\[[^\\]]*pos="(-?[\\d.]+),(-?[\\d.]+)"`).exec(t); return m ? [Number(m[1]), Number(m[2])] : null; };
  await page.keyboard.press('Escape');
  await pick('a', 'd');
  check(await page.isVisible('#edit-align'), 'two boxes: the edit bar offers Align');
  await click(await handle('#map .lm-edit-tool[data-act="align"]'));
  let m = await menu();
  check(m?.focus === 'left' && m.off === 'hspace vspace', `Align in the adorner opens the menu, distribute off for two boxes (${JSON.stringify(m)})`);
  await page.keyboard.press('Escape');
  check(!(await menu()) && /^2 boxes:/.test(await hint()), 'Escape closes the menu, the boxes stay selected');
  await click(await handle('#map .lm-edit-tool[data-act="align"]'));
  before = read();
  await page.click('#align-menu [data-how="top"]');
  text = await changed(before, 'aligning a and d at the top');
  check(!(await menu()) && posOf(text, 'a')?.[1] === posOf(text, 'd')?.[1] && posOf(text, 'd')?.[0] === 300, `Align tops: one menu choice, a and d on one line (${posOf(text, 'a')}; ${posOf(text, 'd')})`);
  check(/^2 boxes:/.test(await hint()), 'they stay selected');
  await undoTo(FLOW, 'undo align');
  // a press elsewhere closes it
  await click(await handle('#map .lm-edit-tool[data-act="align"]'));
  await page.mouse.click(5, 300);
  await page.waitForTimeout(200);
  check(!(await menu()), 'a click elsewhere closes the menu');
  // from the edit bar, by keyboard: distribute c, d, g horizontally (c and g stay)
  await pick('c', 'd', 'g');
  await page.focus('#edit-align');
  await page.keyboard.press('Enter');
  m = await menu();
  check(m?.focus === 'left' && m.off === '' && await page.getAttribute('#edit-align', 'aria-expanded') === 'true', `Enter on the edit bar's Align opens the menu, all choices on (${JSON.stringify(m)})`);
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowUp');
  check((await menu())?.focus === 'hspace', 'End and the arrow keys move through the menu');
  before = read();
  await page.keyboard.press('Enter');
  text = await changed(before, 'distributing c, d, g');
  check(String(posOf(text, 'd')) === '250,300' && String(posOf(text, 'c')) === '0,300' && String(posOf(text, 'g')) === '500,300', `Distribute horizontally: d halfway, c and g stay (${/subgraph cluster_x[^}]*/.exec(text)?.[0].replace(/\s+/g, ' ')})`);
  check(!(await menu()) && await page.evaluate(() => document.activeElement?.id) === 'edit-align' && /^3 boxes:/.test(await hint()), 'the menu closes, focus back on Align, the boxes stay selected');
  await undoTo(FLOW, 'undo distribute');

  check(page.errors.length === 0, `no page errors${page.errors.length ? `: ${page.errors.join('; ')}` : ''}`);
  await page.close();
  groupServer.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('source sidebar: the DOT text beside the map, both ways');
{
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linemap-source-'));
  const file = path.join(dir, 's.dot');
  const FLOW = `digraph s {
  subgraph lines { A }
  a [label="Alpha", pos="0,0"]
  b [pos="300,0"]
  c
  a -> b [lines=A]
  b -> c [lines=A]
}
`;
  fs.writeFileSync(file, FLOW);
  const read = () => fs.readFileSync(file, 'utf8');
  const srcServer = await serve({ dir, port: 0, quiet: true });
  const page = await newPage();
  const url = `http://127.0.0.1:${srcServer.address().port}/studio.html#src=s.dot`;
  await page.goto(url);
  await ready(page);
  const until = async (fn, what) => {
    for (let i = 0; i < 100; i++) { if (await fn()) return true; await page.waitForTimeout(50); }
    check(false, `timed out: ${what}`);
    return false;
  };
  const TA = '#source-panel .src-text';
  const value = () => page.inputValue(TA);
  const label = (id) => page.evaluate((id) => [...document.querySelectorAll('#map g.node')].find((g) => g.id === id)?.textContent.trim() ?? null, id);
  const stageW = () => page.evaluate(() => document.getElementById('stage').getBoundingClientRect().width);
  const w0 = await stageW();
  check(!(await page.isVisible('#source-panel')) && await page.isVisible('#source-btn'), 'the sidebar starts closed; Source is in the toolbar');
  await page.keyboard.press('s');
  await page.waitForTimeout(300);
  check(await page.isVisible('#source-panel') && await value() === FLOW && await page.getAttribute('#source-btn', 'aria-pressed') === 'true', 'S opens the sidebar with the file\'s text');
  check(await stageW() < w0 - 200, `the map makes room for it (${Math.round(w0)} -> ${Math.round(await stageW())})`);
  check(await page.evaluate(() => document.querySelector('#source-panel .src-lines').textContent.split('\n').length) === FLOW.split('\n').length, 'the gutter numbers every line');

  // typing: keys are text, not shortcuts; a pause commits (saved to the file, drawn)
  await page.click(TA);
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('// etn\n');
  await page.waitForTimeout(100);
  check(!(await page.isVisible('#edit-bar')) && !(await page.evaluate(() => document.querySelector('.search input') === document.activeElement)), 'E, T, N and / typed in the text are only text');
  await until(() => read().startsWith('// etn'), 'the typed comment saved');
  check(read() === `// etn\n${FLOW}`, 'a pause in typing saves the text to the file');
  await page.fill(TA, FLOW.replace('"Alpha"', '"Omega"'));
  await until(async () => /Omega/.test(await label('a') ?? ''), 'the map redrawn with the new label');
  check(/label="Omega"/.test(read()), 'a changed label is drawn and saved');

  // a text that cannot be drawn: the last map stays, the message and the line are shown
  const good = read();
  await page.fill(TA, good.replace('b -> c [lines=A]', 'b -> [lines=A]'));
  await until(() => page.isVisible('#source-panel .src-status'), 'the error under the text');
  const st = await page.evaluate(() => ({ goto: document.querySelector('#source-panel .src-goto').textContent, band: !document.querySelector('#source-panel .src-band').hidden }));
  check(st.goto === 'Line 7' && st.band && read() === good && /Omega/.test(await label('a') ?? ''), `a syntax error: "${st.goto}" marked, the file and the last map kept`);
  await page.click('#source-panel .src-goto');
  check(await page.evaluate(() => { const t = document.querySelector('#source-panel .src-text'); return t.value.slice(0, t.selectionStart).split('\n').length; }) === 7, 'a click on the line puts the caret there');
  await page.fill(TA, good);
  await until(async () => !(await page.isVisible('#source-panel .src-status')), 'the error gone');

  // map -> text: an edit on the map, and its undo, show in the text; one undo per pause
  await page.click('#map', { position: { x: 5, y: 5 } }); // leaves the text
  await page.keyboard.press('e');
  await page.waitForTimeout(300);
  await page.click('#edit-pin');
  await until(async () => /c \[pos=/.test(await value()), 'Pin all shown in the text');
  check(await value() === read(), 'a map edit updates the text');
  await page.keyboard.press('Control+z');
  await until(async () => await value() === good, 'undo shown in the text');
  check(read() === good, 'undo of the map edit: the text follows');
  await page.keyboard.press('Control+z');
  await until(async () => await value() === `// etn\n${FLOW}`, 'the Omega pause undone');
  check(read() === `// etn\n${FLOW}`, 'the next undo takes back one pause of typing');

  // source <-> map selection: a box selected on the map marks its statements (and the edges that
  // name it, weaker); the caret on a statement selects what it is about
  {
    // lines now: 1 // etn, 2 digraph, 3 lines, 4 a, 5 b, 6 c, 7 a -> b, 8 b -> c
    const marks = () => page.evaluate(() => [...document.querySelectorAll('#source-panel .src-mark')].map((m) => m.dataset.line + (m.classList.contains('weak') ? 'w' : '')).join(' '));
    const centre = (id) => page.evaluate((id) => { const r = [...document.querySelectorAll('#map g.node')].find((g) => g.id === id).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
    const b = await centre('b');
    await page.mouse.click(b.x, b.y);
    await page.waitForTimeout(200);
    check(await marks() === '5 7w 8w', `selecting b on the map marks its statement, and the edges naming it weaker (${await marks()})`);
    const caretOn = async (line) => {
      await page.click(TA);
      await page.keyboard.press('Control+Home');
      for (let i = 1; i < line; i++) await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(200);
    };
    await caretOn(8);
    const sel = () => page.evaluate(() => document.getElementById('edit-hint').textContent);
    check(/reattach/.test(await sel()) && await marks() === '8', `the caret on "b -> c" selects that edge on the map (${await sel()}; marks ${await marks()})`);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(200);
    check(/^Drag to move/.test(await sel()) && await marks() === '5 7w 8w', `the caret on "b [...]" selects box b (${await sel()})`);
    // view mode: the caret on an edge pins its line
    await page.keyboard.press('Escape'); // leaves the text
    await page.keyboard.press('e');
    await page.waitForTimeout(300);
    await caretOn(7);
    check(await page.evaluate(() => document.querySelector('#map svg').classList.contains('focus') && !!document.querySelector('#legend li.on')), 'view mode: the caret on "a -> b" pins its line');
    check(await marks() === '7', `and marks its statement (${await marks()})`);
    // typing drops the marks; nothing on the map changes until the pause commits
    await page.keyboard.type(' ');
    check(await marks() === '', 'typing drops the marks');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(600);
    await page.click('#map', { position: { x: 5, y: 5 } }); // leaves the text
    await page.keyboard.press('e');
    await page.waitForTimeout(300);
  }

  // remembered open, and its width (dragged)
  const edge = await page.evaluate(() => { const r = document.querySelector('#source-panel .src-resize').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 200 }; });
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(edge.x - 100, edge.y, { steps: 5 });
  await page.mouse.up();
  const wide = await page.evaluate(() => document.getElementById('source-panel').getBoundingClientRect().width);
  await page.reload();
  await ready(page);
  await page.waitForTimeout(300);
  const again = await page.evaluate(() => document.getElementById('source-panel').getBoundingClientRect().width);
  check(await page.isVisible('#source-panel') && Math.abs(again - wide) < 2 && wide > 500, `open and width (${Math.round(wide)}) remembered after a reload`);
  await page.click('#source-panel .src-close');
  check(!(await page.isVisible('#source-panel')), 'Close shuts it');
  check(page.errors.length === 0, `no page errors${page.errors.length ? `: ${page.errors.join('; ')}` : ''}`);
  await page.close();
  srcServer.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('edit mode, flows baked in: kept in the page, downloaded');
{
  const repo = path.join(here, '..', '..', '..');
  const file = path.join(here, '..', 'dist', '_smoke-edit.html');
  await build({ embed: ['webshop.dot', 'postal.dot'].map((n) => path.join(repo, 'examples', n)), out: file });
  const page = await newPage();
  await page.goto(pathToFileURL(file).href);
  await page.click('#empty [data-flow="0"]');
  await ready(page);
  await page.click('#edit');
  const box = await page.evaluate(() => { const g = [...document.querySelectorAll('#map g.node')].find((x) => x.id === 'web'); const r = g.querySelector('rect').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await rerun(page, async () => {
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(box.x, box.y - i * 4);
    await page.mouse.up();
  });
  await page.waitForTimeout(300);
  check(/Only in this page/.test(await page.textContent('#edit-status')) && await page.isVisible('#edit-page'), `edits of a baked-in flow stay in the page ("${await page.textContent('#edit-status')}")`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#edit-dot')]);
  const dot = fs.readFileSync(await dl.path(), 'utf8');
  check(dl.suggestedFilename() === 'webshop.dot' && /web +\[label="Web shop", pos="\d+,\d+"\]/.test(dot) && dot !== fs.readFileSync(path.join(repo, 'examples', 'webshop.dot'), 'utf8'), `.dot downloads the edited flow (${dl.suggestedFilename()})`);
  const [dp] = await Promise.all([page.waitForEvent('download'), page.click('#edit-page')]);
  const html = fs.readFileSync(await dp.path(), 'utf8');
  const flows = JSON.parse(/<script type="application\/json" id="linemap-flows">(.*?)<\/script>/s.exec(html)[1]);
  check(flows.length === 2 && flows[0].text === dot && flows[1].name === 'postal.dot' && html.length > 500000, `Page downloads the studio with the edited flow baked in (${flows.map((f) => f.name).join(', ')})`);
  // that page opens with the edit
  fs.writeFileSync(file, html);
  const again = await newPage();
  await again.goto(pathToFileURL(file).href);
  await again.click('#empty [data-flow="0"]');
  await ready(again);
  check(again.errors.length === 0 && await again.evaluate(() => !!document.querySelector('#map g.node#web')), 'the downloaded page draws the edited flow');
  check(page.errors.length === 0, 'no page errors');
  fs.rmSync(file);
  await again.close();
  await page.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);

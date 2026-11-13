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
const dist = path.join(here, '..', 'dist', 'linemap-studio.html');
const shotsArg = process.argv.indexOf('--shots');
const shots = shotsArg > 0 ? process.argv[shotsArg + 1] : null;
if (shots) fs.mkdirSync(shots, { recursive: true });

const EXAMPLES = ['examples/webshop.dot', 'examples/platform.dot', 'examples/postal.dot', 'docs/pipeline.dot'];

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures++;
};

const server = await serve(0, { quiet: true });
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
  await page.goto(`${base}?src=${src}`);
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
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(150);
  check(Number((await viewBox(page)).split(' ')[2]) < Number(vb1.split(' ')[2]), 'wheel zooms in');
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
  await page.goto(`${base}?src=examples/webshop.dot#hide=R,E&through=none&view=800,100,900,600`);
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
  check(page.errors.length === 0, 'no page errors');
  await page.close();
}

console.log('errors keep the last map');
{
  const page = await newPage();
  await page.goto(`${base}?src=examples/webshop.dot`);
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
  const page = await newPage();
  await page.goto(`${base}?src=${rel}`);
  await ready(page);
  check(await page.isVisible('#watch'), 'watch button shown for ?src over http');
  await page.click('#watch');
  const vb = await viewBox(page);
  fs.writeFileSync(file, text.replace('label="Order",', 'label="Orders (edited)",'));
  await page.waitForFunction(() => [...document.querySelectorAll('#legend .lb')].some((e) => e.textContent === 'Orders (edited)'), null, { timeout: 5000 })
    .then(() => check(true, 'edit to the file shows up within the poll interval'), () => check(false, 'edit to the file shows up'));
  check(await viewBox(page) === vb, 'view kept across the reload');
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
  await page.goto(`${base}?src=examples/postal.dot`);
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
  await page.goto(`${base}?src=examples/postal.dot`);
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
  await page.goto('https://embed.test/studio.html?src=webshop.dot');
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
  await page.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);

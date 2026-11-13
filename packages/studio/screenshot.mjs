// The README's screenshot of the studio: a flow opened in the studio, one line pinned (the rest
// dimmed), taken in headless Chromium.
//   pnpm example                                     (from the repo root: the README's picture,
//                                                    with the example SVGs)
//   node screenshot.mjs <flow.dot> <out.png> [--line <id>] [--width 1600] [--height 1000]
// Paths are relative to the repo root. Needs `pnpm --filter @linemap/studio exec playwright
// install chromium` once.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { build } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    line: { type: 'string' },
    width: { type: 'string', default: '1600' },
    height: { type: 'string', default: '1000' },
  },
});
if (positionals.length !== 2) {
  console.error('usage: node screenshot.mjs <flow.dot> <out.png> [--line <id>] [--width 1600] [--height 1000]');
  process.exit(2);
}
const [input, output] = positionals.map((p) => path.resolve(root, p));

// The studio with the flow baked in, so it opens straight from a file.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linemap-shot-'));
const { file } = await build({ embed: [input], out: path.join(dir, 'studio.html') });

const browser = await chromium.launch();
try {
  // twice the pixels, so the picture stays sharp on high-density screens
  const page = await browser.newPage({ viewport: { width: +o.width, height: +o.height }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(file).href);
  await page.waitForSelector('#map svg [data-line]', { state: 'attached', timeout: 20000 });
  if (o.line) {
    // a click on the line pins it, as a click by hand would; no pointer, so no tooltip
    const found = await page.evaluate((id) => {
      const el = document.querySelector(`#map svg [data-line="${CSS.escape(id)}"]`);
      el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return !!el;
    }, o.line);
    if (!found) throw new Error(`no line "${o.line}" in ${input}`);
  }
  await page.waitForTimeout(500); // let the dimming transition finish
  if (errors.length) throw new Error(`the studio failed: ${errors.join('; ')}`);
  await page.screenshot({ path: output });
  console.error(`wrote ${path.relative(root, output)}`);
} finally {
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

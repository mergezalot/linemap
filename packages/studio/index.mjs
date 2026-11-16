// The linemap studio as a ready-made page: dist/linemap.html, built once by build.mjs
// (before publishing), here only filled in. Nothing in this file needs a bundler.
//   studioHtml(flows)        the page with these flows baked in ([] = the empty studio)
//   embed(html, flows)       the same, on a page you already have as a string
//   serve({ root, ... })     a local server: the studio at /studio.html and the DOT files under root
//   announce, openBrowser    what `linemap studio` prints, and --open
import fs from 'node:fs';

export { serve, dotFiles, announce, openBrowser } from './serve.mjs';

export const TEMPLATE = new URL('./dist/linemap.html', import.meta.url);

// The flows' slot in the page, empty; it comes before the script, so the first match is the slot.
const SLOT = '<script type="application/json" id="linemap-flows">[]</script>';

// flows: [{ name, text }]. `<` is escaped in the JSON, so a flow cannot end the script element.
export function embed(html, flows = []) {
  const at = html.indexOf(SLOT);
  if (at < 0) throw new Error('not a linemap studio page: no empty flows slot');
  const json = JSON.stringify(flows.map(({ name, text }) => ({ name, text }))).replace(/</g, '\\u003c');
  return html.slice(0, at) + SLOT.replace('[]', json) + html.slice(at + SLOT.length);
}

export function studioHtml(flows = []) {
  let html;
  try {
    html = fs.readFileSync(TEMPLATE, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    throw new Error('the studio page is not built (in the linemap repository: pnpm build)');
  }
  return embed(html, flows);
}

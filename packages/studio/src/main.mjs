// Boot and wiring: every module gets the elements and callbacks it needs; none reaches into
// another's DOM. Flow: source -> pipeline (with the state's settings) -> map, legend, search.
import { markColor, THEMES, THEME_NAMES, DEFAULT_THEME, PALETTE } from '@linemap/core';
import { createState, readHash, hashWriter } from './state.mjs';
import { createPipeline } from './pipeline.mjs';
import { createSource, isHttp, store } from './source.mjs';
import { createViewport } from './viewport.mjs';
import { createTooltip, esc } from './tooltip.mjs';
import { createHighlight } from './highlight.mjs';
import { createLegend } from './legend.mjs';
import { createSearch } from './search.mjs';
import { createEditor } from './editor.mjs';
import { download, positionsText, copyOrShow, askText, askLabel, askLines, toaster } from './actions.mjs';

const $ = (id) => document.getElementById(id);
// All page elements are looked up now, before any map is inserted: ids from the DOT file end up
// as element ids in the SVG and could shadow ours.
const el = {
  toolbar: document.querySelector('.toolbar'),
  fileName: $('file-name'), recent: $('recent'), open: $('open'), paste: $('paste'), reload: $('reload'), watch: $('watch'),
  through: $('through'), notes: $('notes'), theme: $('theme'), themeBtn: $('theme-btn'), fancy: $('fancy'),
  search: $('search'), results: $('results'), export: $('export'), positions: $('positions'), helpBtn: $('help-btn'),
  menuBtn: $('menu-btn'), more: $('tb-more'),
  banner: $('banner'), stage: $('stage'), map: $('map'), empty: $('empty'), busy: $('busy'), legend: $('legend'),
  zoomIn: $('zoom-in'), zoomOut: $('zoom-out'), zoomFit: $('zoom-fit'),
  tooltip: $('tooltip'), toast: $('toast'), drop: $('drop'), fileInput: $('file-input'),
  pasteDialog: $('paste-dialog'), positionsDialog: $('positions-dialog'), help: $('help'),
  flows: $('linemap-flows'),
  edit: $('edit'), editBar: $('edit-bar'), editHint: $('edit-hint'), editAdd: $('edit-add'), editDelete: $('edit-delete'), editLines: $('edit-lines'),
  editPin: $('edit-pin'), editUndo: $('edit-undo'), editRedo: $('edit-redo'), editStatus: $('edit-status'),
  editDot: $('edit-dot'), editCopy: $('edit-copy'), editPage: $('edit-page'), editDone: $('edit-done'),
  labelDialog: $('label-dialog'), linesDialog: $('lines-dialog'), textDialog: $('text-dialog'),
};

// The toolbar wraps on narrow screens; the stage starts below it.
new ResizeObserver(() => document.documentElement.style.setProperty('--tb-h', `${el.toolbar.offsetHeight}px`)).observe(el.toolbar);

const toast = toaster(el.toast);
// flows baked into the page (build --embed)
let embedded = [];
try { embedded = JSON.parse(el.flows.textContent).filter((f) => typeof f?.text === 'string'); } catch { /* none */ }
// A page with flows baked in can be saved again with its flows edited: the page as it came, with
// an empty flows slot, kept before anything changes it (filled as `linemap export` fills it).
const SLOT = '<script type="application/json" id="linemap-flows">[]</script>';
let pageHtml = null;
if (embedded.length) {
  el.flows.textContent = '[]';
  pageHtml = `<!doctype html>\n${document.documentElement.outerHTML}`;
  if (!pageHtml.includes(SLOT)) pageHtml = null;
}
el.flows.remove();

// ---------- state ----------
const initial = readHash();
// the theme last picked here, unless the link names one
const THEME_KEY = 'linemap.theme';
if (!initial.settings.theme) {
  try { const t = localStorage.getItem(THEME_KEY); if (THEME_NAMES.includes(t)) initial.settings.theme = t; } catch { /* no storage */ }
}
// notes on or off as last switched here, unless the link says
const NOTES_KEY = 'linemap:notes';
if (!initial.given.has('notes') && typeof store.get(NOTES_KEY) === 'boolean') initial.settings.notes = store.get(NOTES_KEY);
const state = createState(initial.settings);
let pendingView = initial.view;  // applied to the first map
let pendingPin = null;           // line to pin once the next map is shown (search on a hidden line)
let shown = null;                // { model, base, svg, theme } on screen
let loadedOnce = false;
let keepBanner = false;          // the next map leaves the error banner up
const writeHash = hashWriter();
// the file's URL goes into the hash only where it can be fetched again; a baked-in flow, by its
// name, everywhere (it needs no fetch)
const hashSrc = () => {
  const cur = source.current();
  if (cur?.flow != null) return cur.name;
  return isHttp() ? cur?.src ?? null : null;
};
// what a #src= names: a baked-in flow by its name, else a URL to fetch
function openSrc(src) {
  const i = source.flowNamed(src);
  if (i < 0) return source.loadUrl(src);
  source.loadEmbedded(i);
  return Promise.resolve(true);
}
const syncHash = () => writeHash(state.get(), shown ? viewport.getView() : null, hashSrc());
let linked = null; // { settings, view } of a #src= link typed or clicked, for the file it opens

// ---------- map ----------
const tooltip = createTooltip(el.tooltip);
const viewport = createViewport({
  stage: el.stage,
  avoid: () => {
    if (el.legend.hidden) return null;
    const r = el.legend.getBoundingClientRect(), st = el.stage.getBoundingClientRect();
    return { x0: r.left - st.left, y0: r.top - st.top, x1: r.right - st.left, y1: r.bottom - st.top };
  },
  onChange: () => { highlight?.leave(); syncHash(); editor?.view(); },
});
const highlight = createHighlight({
  host: el.map, tooltip,
  // no hover focus or tooltips while editing
  isPanning: () => viewport.isPanning() || !!editor?.on(),
  onPinChange: (ids) => legend.setPinned(ids),
});
const legend = createLegend({
  el: el.legend, markColor,
  collapsed: innerWidth < 640,
  onToggle: (id) => { const h = new Set(state.get().hidden); h.has(id) ? h.delete(id) : h.add(id); state.set({ hidden: h }); },
  onSolo: (id) => {
    const others = shown.base.lines.map((l) => l.id).filter((x) => x !== id);
    const { hidden } = state.get();
    const soloed = hidden.size === others.length && others.every((x) => hidden.has(x));
    state.set({ hidden: soloed ? new Set() : new Set(others) });
  },
  onShowAll: () => state.set({ hidden: new Set() }),
  onHideAll: () => state.set({ hidden: new Set(shown.base.lines.map((l) => l.id)) }),
  onHover: (ids) => highlight.hoverLines(ids),
});
const search = createSearch({ input: el.search, list: el.results, onSelect: select });
const editor = createEditor({
  host: el.map,
  getText: () => source.current()?.text ?? '',
  commit: (text) => source.edit(text),
  // a drag draws the map as it would be; the source keeps its text until the drop
  preview: (text) => pipeline.request(text, state.get(), { carry: true, preview: true }),
  check: (text) => pipeline.check(text, state.get()),
  cancelPreview: () => run({ carry: true }),
  toast: (msg) => toast(msg),
  askLabel: () => askLabel(el.labelDialog),
  askLines: (lines, checked, title, opts) => askLines(el.linesDialog, lines, checked, title, opts),
  onChange: () => updateEditBar(),
});

const pipeline = createPipeline({ onResult: show });
let busyTimer = 0;
let freshNext = false; // the next run shows a different file: fit the view
function run(meta = {}) {
  const cur = source.current();
  if (!cur) return;
  if (freshNext) { meta = { ...meta, fresh: true }; freshNext = false; }
  clearTimeout(busyTimer);
  busyTimer = setTimeout(() => { el.busy.hidden = false; }, 150);
  pipeline.request(cur.text, state.get(), { preview: false, ...meta });
}

function show(result, meta) {
  // results only arrive when no newer request is waiting
  clearTimeout(busyTimer);
  el.busy.hidden = true;
  // a map for a spot something is being dragged over that cannot be drawn: the last one stays
  if (!result.ok && meta.preview) return;
  if (!result.ok) {
    banner('Could not draw the map', result.error + (shown ? '\n\nShowing the last map that worked.' : ''));
    if (!shown) setEmpty(true);
    return;
  }
  if (keepBanner) keepBanner = false; else hideBanner();
  setEmpty(false);
  const keep = !!shown && !meta.fresh;
  el.map.innerHTML = result.svg;
  const svg = el.map.firstElementChild;
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  const [x, y, w, h] = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  shown = { model: result.model, base: result.base, svg, theme: result.theme };
  applyTheme(result.theme);
  // the legend first: fitting keeps the map clear of it
  const counts = new Map();
  for (const e of result.base.edges) for (const l of e.lines) counts.set(l.id, (counts.get(l.id) ?? 0) + 1);
  legend.update(result.base.lines, counts, state.get().hidden, highlight.pinned());
  viewport.setContent(svg, { x, y, w, h }, { keep });
  if (pendingView) { viewport.setView(pendingView); pendingView = null; }
  highlight.index(svg, result.model);
  editor.index(svg, result.model);
  if (pendingPin) { highlight.pin([pendingPin]); zoomToLine(pendingPin); pendingPin = null; }

  search.index([
    ...result.model.nodes.map((n) => ({ kind: 'node', id: n.id, label: n.label })),
    ...result.model.groups.map((g) => ({ kind: 'container', id: g.id, label: g.label || g.id })),
    ...result.base.lines.map((l) => ({ kind: 'line', id: l.id, label: l.label, color: l.color })),
  ]);
  updateToolbar();
  syncHash();
  window.__linemap = { ms: Math.round(result.ms), lines: result.model.lines.length, edges: result.model.edges.length }; // for tests
}

// ---------- settings ----------
state.onChange(() => { run(); updateToolbar(); syncHash(); });

el.through.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (b && b.dataset.mode !== state.get().mode) state.set({ mode: b.dataset.mode });
});
// notes on, or off: the map without them, a badge for each (hover one to read it, click to keep
// it open); remembered for the next visit
const toggleNotes = () => {
  const notes = !state.get().notes;
  store.set(NOTES_KEY, notes);
  state.set({ notes });
};
el.notes.addEventListener('click', toggleNotes);
const hasNotes = () => !!(shown?.model.notes.length || shown?.model.hiddenNotes.length);
// theme menu: a swatch of each theme (background, a node outline, a line) and its name
const swatch = (n) => {
  const t = THEMES[n], pal = t.palette ?? PALETTE;
  return `<span class="tsw" style="background:${t.bg};border-color:${t.node.stroke === 'none' ? t.muted : t.node.stroke}"><i style="background:${pal[0]}"></i><i style="background:${pal[1]}"></i></span>`;
};
// One row per theme: the plain theme, and its `-fancy` variant (shadows, glows, moving arrows) as a
// sparkles button on the same row. Themes are paired by the name's suffix.
const FANCY = '-fancy';
const baseOf = (n) => (n.endsWith(FANCY) ? n.slice(0, -FANCY.length) : n);
const isFancy = (n) => n !== baseOf(n);
const BASES = THEME_NAMES.filter((n) => !isFancy(n));
const sparkles = '<svg class="icon sparkles"><use href="#i-sparkles"/></svg>';
el.theme.innerHTML = BASES.map((n) => {
  const fancy = THEMES[n + FANCY] ? `<button class="item fancy" role="menuitemradio" data-theme="${n + FANCY}" title="${esc(THEMES[n].label)}, fancy: shadows, glows and moving arrows (uses more CPU)" aria-label="${esc(THEMES[n].label)} fancy">${sparkles}</button>` : '';
  return `<div class="row" data-base="${n}"><button class="item" role="menuitemradio" data-theme="${n}">${swatch(n)}<span class="nm">${esc(THEMES[n].label)}</span></button>${fancy}</div>`;
}).join('');
const effectiveTheme = () => shown?.theme ?? state.get().theme ?? DEFAULT_THEME;
function setTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* no storage */ }
  if (theme !== state.get().theme) state.set({ theme });
}
function showThemes(open) {
  el.theme.hidden = !open;
  el.themeBtn.setAttribute('aria-expanded', String(open));
}
el.themeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  el.recent.hidden = true;
  showThemes(el.theme.hidden);
});
el.theme.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-theme]');
  if (!b) return;
  e.stopPropagation(); // the choice stays in the narrow-screen menu, to try one after another
  showThemes(false);
  setTheme(b.dataset.theme);
});
document.addEventListener('click', (e) => { if (!el.theme.hidden && !e.target.closest('.theme-pick')) showThemes(false); });
el.fancy.addEventListener('click', (e) => {
  e.stopPropagation(); // stays in the narrow-screen menu, like a pick from the list
  const cur = effectiveTheme(), base = baseOf(cur);
  setTheme(isFancy(cur) ? base : base + FANCY);
});
// The page around the map follows the theme: dark chrome for dark maps.
const luminance = (hex) => {
  const v = parseInt(String(hex).replace('#', ''), 16);
  return Number.isNaN(v) ? 1 : (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
};
function applyTheme(name) {
  const t = THEMES[name] ?? THEMES[DEFAULT_THEME];
  document.body.dataset.mapTheme = name;
  document.body.classList.toggle('ui-dark', luminance(t.bg) < 0.4);
  document.documentElement.style.setProperty('--map-bg', t.bg);
}
applyTheme(state.get().theme ?? DEFAULT_THEME);

function updateToolbar() {
  const { mode } = state.get();
  for (const b of el.through.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
  const theme = state.get().theme ?? effectiveTheme();
  for (const b of el.theme.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.theme === theme));
  for (const r of el.theme.querySelectorAll('.row')) r.classList.toggle('on', r.dataset.base === baseOf(theme));
  const base = THEMES[baseOf(theme)] ? baseOf(theme) : theme;
  el.themeBtn.querySelector('.cur').innerHTML = `${swatch(base)}<span class="tl">${esc(THEMES[base]?.label ?? theme)}</span>`;
  // the sparkles beside it switch the fancy variant on and off, for themes that have one
  el.fancy.hidden = !THEMES[base + FANCY];
  el.fancy.setAttribute('aria-pressed', String(isFancy(theme)));
  el.fancy.title = isFancy(theme) ? 'Fancy: on (shadows, glows, moving arrows; uses more CPU). Click for plain' : 'Fancy: off. Click for shadows, glows and moving arrows (uses more CPU)';
  const { notes } = state.get();
  el.notes.hidden = !hasNotes();
  el.notes.setAttribute('aria-pressed', String(notes));
  el.notes.title = notes ? 'Notes: shown. Click to draw the map without them, with a badge for each (N)' : 'Notes: off, a badge for each; hover one to read it, click to keep it open. Click to show them all (N)';
  const cur = source.current();
  el.fileName.querySelector('.name').textContent = cur?.name ?? 'No file';
  el.fileName.title = cur?.src ? `${cur.src} · recent files` : 'Recent files';
  document.title = cur ? `${cur.name} · linemap` : 'linemap studio';
  el.watch.hidden = !source.canWatch();
  el.watch.setAttribute('aria-pressed', String(source.watching()));
  for (const b of [el.export, el.positions, el.reload, el.zoomIn, el.zoomOut, el.zoomFit, el.edit]) b.disabled = !shown;
  document.body.classList.toggle('nomap', !shown);
  updateEditBar();
}

// ---------- edit mode ----------
let saveState = { state: null, message: '' }; // of the last save to the server
function setEditing(on) {
  if (on && !shown) return;
  if (on) { highlight.clearPins(); highlight.leave(); }
  editor.setOn(on);
  if (on && innerWidth < 860) setMenu(false);
}
const HINTS = {
  none: 'Drag a box to move it · drag a line to bend it · double-click the map for a new box · Shift+drag or click a container to select several',
  nodes: 'Drag one to move them all · Shift+click adds or removes a box · Del removes them',
  node: 'Drag to move · click again to resize · drag the + onto another box to connect them · Del removes the box and its edges',
  size: 'Drag a handle to resize · click again to move · Del removes the box and its edges',
  edge: 'Drag an end onto another box to reattach · click again for the line under the pointer · Lines… picks its lines · Del removes the edge',
  line: 'drag an end onto another box to move only this line · Del takes it off this edge · click again for the whole bundle',
  via: 'Drag to move the bend · double-click or Del removes it',
  adding: 'Click where the new box goes · Esc cancels',
};
function updateEditBar() {
  const on = editor.on();
  el.edit.setAttribute('aria-pressed', String(on));
  el.editBar.hidden = el.editHint.hidden = !on;
  if (!on) return;
  const sel = editor.selection();
  el.editUndo.disabled = !editor.canUndo();
  el.editRedo.disabled = !editor.canRedo();
  el.editDelete.disabled = !sel;
  el.editLines.hidden = !(sel?.kind === 'edge' || sel?.kind === 'via');
  el.editAdd.setAttribute('aria-pressed', String(editor.adding()));
  const mode = sel?.mode === 'size' ? 'size' : sel?.line ? 'line' : sel?.kind ?? 'none';
  el.editHint.textContent = (mode === 'line' ? `Line ${editor.lineLabel(sel.line)}: ` : mode === 'nodes' ? `${sel.ids.length} boxes: ` : '') + HINTS[editor.adding() ? 'adding' : mode];
  const cur = source.current();
  el.editPage.hidden = !(pageHtml && cur?.flow !== null && cur?.flow !== undefined);
  // where the edits go: the file (served by linemap studio), or only this page
  let status = '', error = false;
  if (source.canSave()) {
    const { state: st, message } = saveState;
    status = st === 'saving' ? 'Saving…' : st === 'error' ? 'Not saved' : st === 'saved' ? `Saved to ${cur.name}` : `Edits save to ${cur.name}`;
    error = st === 'error';
    el.editStatus.title = error ? message : '';
  } else {
    status = source.dirty() ? 'Only in this page: download or copy it' : '';
    el.editStatus.title = 'Edits here stay in this page (and in Recent) until you download or copy the DOT text';
  }
  el.editStatus.textContent = status;
  el.editStatus.classList.toggle('error', error);
  el.editStatus.hidden = !status;
}
el.edit.addEventListener('click', () => setEditing(!editor.on()));
el.editDone.addEventListener('click', () => setEditing(false));
el.editAdd.addEventListener('click', () => editor.startAdding());
el.editDelete.addEventListener('click', () => editor.remove());
el.editLines.addEventListener('click', () => editor.editLines());
el.editPin.addEventListener('click', () => editor.pinAll());
el.editUndo.addEventListener('click', () => editor.undo());
el.editRedo.addEventListener('click', () => editor.redo());
const dotName = () => `${baseName()}.dot`;
el.editDot.addEventListener('click', () => {
  const cur = source.current();
  if (!cur) return;
  download(dotName(), cur.text, 'text/vnd.graphviz');
  source.markClean();
  updateEditBar();
});
el.editCopy.addEventListener('click', async () => {
  const cur = source.current();
  if (!cur) return;
  if (await copyOrShow(cur.text, el.textDialog)) toast('Copied the DOT text');
  source.markClean();
  updateEditBar();
});
el.editPage.addEventListener('click', () => {
  if (!pageHtml) return;
  const json = JSON.stringify(source.embedded().map(({ name, text }) => ({ name, text }))).replace(/</g, '\\u003c');
  const name = decodeURIComponent(location.pathname.split('/').pop() || '') || 'linemap.html';
  download(/\.html?$/i.test(name) ? name : `${name}.html`, pageHtml.replace(SLOT, () => SLOT.replace('[]', json)), 'text/html');
  source.markClean();
  updateEditBar();
});
for (const b of document.querySelectorAll('dialog [data-close]')) b.addEventListener('click', () => b.closest('dialog').close('cancel'));
// edits that are only in this page
window.addEventListener('beforeunload', (e) => { if (source.dirty()) { e.preventDefault(); e.returnValue = ''; } });

// ---------- source ----------
const source = createSource({
  onText({ src, flow, fresh, edited }) {
    if (edited) { run({ carry: true }); updateToolbar(); return; }
    editor.forget();
    if (fresh) saveState = { state: null, message: '' };
    if (fresh && loadedOnce) {
      // a different file: its own settings (or the link's), fitted view, nothing pinned
      const link = src || flow != null ? linked : null;
      linked = null;
      pendingView = link?.view ?? null;
      highlight.clearPins();
      freshNext = true;
      const { hidden, mode, theme } = link?.settings ?? { hidden: new Set(), mode: 'file' };
      state.set(theme ? { hidden, mode, theme } : { hidden, mode }); // runs it
      return;
    }
    loadedOnce = true;
    run({ fresh });
    updateToolbar();
  },
  onError: (title, msg) => { banner(title, msg); if (!shown) setEmpty(true); },
  onWatch: () => updateToolbar(),
  onSave(st, message) {
    saveState = { state: st, message };
    if (st === 'error') toast(`Could not save: ${message}`);
    if (st === 'conflict') toast('The file changed on disk, so the last edit was not saved; showing the file as it is now');
    updateEditBar();
  },
  embedded,
});

source.bindDrop(el.drop);
source.bindPaste();
el.open.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => {
  const f = el.fileInput.files[0];
  if (f) source.loadFile(f);
  el.fileInput.value = '';
});
async function pasteDialog() {
  const text = await askText(el.pasteDialog);
  if (text) source.loadText(text);
}
el.paste.addEventListener('click', pasteDialog);
el.reload.addEventListener('click', () => source.reload());
el.watch.addEventListener('click', () => {
  const on = !source.watching();
  source.setWatch(on, { remember: true });
  toast(on ? 'Watching the file: the map follows every save' : 'Stopped watching');
});

// recent files menu
const ago = (t) => {
  const s = (Date.now() - t) / 1000;
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
function openRecent(r) {
  if (r.src && isHttp()) source.loadUrl(r.src); else source.loadText(r.text, r.name, r.src);
}
function renderRecent() {
  const list = source.recent();
  const flows = source.embedded();
  const cur = source.current();
  el.recent.innerHTML = (flows.length > 1
    ? `<div class="head">In this file</div>` + flows.map((f, i) => `<button class="item" role="menuitem" data-flow="${i}"${cur && !cur.src && cur.name === f.name && cur.text === f.text ? ' aria-current="true"' : ''}><span class="nm">${esc(f.name)}</span></button>`).join('') + '<hr>'
    : '') + `<div class="head">Recent</div>` + (list.length
    ? list.map((r, i) => `<button class="item" role="menuitem" data-i="${i}"><span class="nm">${esc(r.name)}</span><span class="when">${ago(r.time)}</span></button>`).join('') +
      '<hr><button class="item" data-act="clear"><span class="nm">Clear the list</span></button>'
    : '<div class="empty-note">Files you open show up here.</div>');
}
el.fileName.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!el.recent.hidden) { el.recent.hidden = true; return; }
  showThemes(false);
  renderRecent();
  el.recent.hidden = false;
});
el.recent.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  el.recent.hidden = true;
  if (b.dataset.act === 'clear') { source.clearRecent(); renderEmpty(); return; }
  if (b.dataset.flow !== undefined) { source.loadEmbedded(Number(b.dataset.flow)); return; }
  const r = source.recent()[Number(b.dataset.i)];
  if (r) openRecent(r);
});
document.addEventListener('click', (e) => { if (!el.recent.hidden && !e.target.closest('.file')) el.recent.hidden = true; });

// the menu button (narrow screens): the toolbar's other controls, in a panel under it
function setMenu(open) {
  el.toolbar.classList.toggle('menu-open', open);
  if (!open) showThemes(false);
  el.menuBtn.setAttribute('aria-expanded', String(open));
}
el.menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  el.recent.hidden = true;
  setMenu(!el.toolbar.classList.contains('menu-open'));
});
// an action closes it; through and theme leave it open, to try one after another
el.more.addEventListener('click', (e) => { if (e.target.closest('.btn')) setMenu(false); });
// pointerdown, so a drag on the map closes it too (the stage keeps its pointer events)
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#tb-more, #menu-btn')) setMenu(false); }, true);
matchMedia('(max-width: 860px)').addEventListener('change', () => setMenu(false));

// ---------- empty state ----------
const EXAMPLES = ['examples/webshop.dot', 'examples/platform.dot', 'examples/postal.dot', 'docs/pipeline.dot'];
let examplesChecked = false;
async function renderEmpty() {
  const flows = source.embedded();
  const fl = el.empty.querySelector('.flows');
  fl.hidden = flows.length < 2;
  el.empty.querySelector('p').textContent = flows.length > 1 ? 'Pick a flow from this file, or load your own DOT file.' : 'Load a DOT file to explore it as a transit map.';
  fl.querySelector('.links').innerHTML = flows.map((f, i) => `<button data-flow="${i}">${esc(f.name)}</button>`).join('');
  const recent = source.recent();
  const rl = el.empty.querySelector('.recent-list');
  rl.hidden = !recent.length;
  rl.querySelector('.links').innerHTML = recent.slice(0, 6).map((r, i) => `<button data-i="${i}">${esc(r.name)}</button>`).join('');
  if (!examplesChecked && isHttp()) {
    examplesChecked = true;
    // served from the repo (pnpm studio)? then offer the examples
    const ok = await fetch(EXAMPLES[0], { method: 'HEAD', cache: 'no-store' }).then((r) => r.ok, () => false);
    const ex = el.empty.querySelector('.examples');
    ex.querySelector('.links').innerHTML = EXAMPLES.map((p) => `<a href="#src=${p}">${p.split('/').pop().replace('.dot', '')}</a>`).join('');
    ex.hidden = !ok;
  }
}
function setEmpty(on) {
  el.empty.hidden = !on;
  if (on) { renderEmpty(); legend.hide(); }
  updateToolbar();
}
el.empty.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.act === 'open') el.fileInput.click();
  else if (b.dataset.act === 'paste') pasteDialog();
  else if (b.dataset.flow !== undefined) source.loadEmbedded(Number(b.dataset.flow));
  else if (b.dataset.i !== undefined) { const r = source.recent()[Number(b.dataset.i)]; if (r) openRecent(r); }
});

// ---------- banner ----------
function banner(title, msg) {
  el.banner.querySelector('.title').textContent = title;
  el.banner.querySelector('.msg').textContent = msg;
  el.banner.hidden = false;
}
const hideBanner = () => { el.banner.hidden = true; };
el.banner.querySelector('.close').addEventListener('click', hideBanner);

// ---------- search ----------
function zoomToLine(id) {
  const box = highlight.lineBox(id);
  if (box) viewport.zoomTo({ x: box.x - 40, y: box.y - 40, w: box.w + 80, h: box.h + 80 });
}
function select(entry) {
  if (!shown) return;
  if (entry.kind === 'line') {
    if (state.get().hidden.has(entry.id)) {
      pendingPin = entry.id;
      const h = new Set(state.get().hidden);
      h.delete(entry.id);
      state.set({ hidden: h });
      return;
    }
    highlight.pin([entry.id]);
    zoomToLine(entry.id);
    return;
  }
  const g = [...el.map.querySelectorAll(entry.kind === 'node' ? 'g.node' : 'g.group')].find((x) => x.id === entry.id);
  if (!g) return;
  let r;
  if (entry.kind === 'node') {
    const n = shown.model.nodes.find((x) => x.id === entry.id);
    r = { x: n.x - n.w / 2, y: n.y - n.h / 2, w: n.w, h: n.h + (n.shape === 'person' ? 30 : 0) };
    // some context around a node: not more than 1.5x
    viewport.zoomTo({ x: r.x - r.w, y: r.y - r.h, w: r.w * 3, h: r.h * 3 }, { maxScale: 1.5 });
  } else {
    const b = g.querySelector('rect').getBBox();
    viewport.zoomTo({ x: b.x - 20, y: b.y - 20, w: b.width + 40, h: b.height + 40 });
  }
  setTimeout(() => highlight.flash(g), 200);
}

// ---------- actions ----------
const baseName = () => (source.current()?.name ?? 'linemap').replace(/\.(dot|gv|txt)$/i, '');
el.export.addEventListener('click', () => {
  if (!shown) return;
  download(`${baseName()}.svg`, pipeline.exportSvg(shown.model, shown.theme));
});
el.positions.addEventListener('click', async () => {
  if (!shown) return;
  const list = pipeline.positions(shown.model);
  if (!list.length) { toast('Every node and note is pinned already'); return; }
  if (await copyOrShow(positionsText(list), el.positionsDialog)) toast(`Copied ${list.length} position${list.length === 1 ? '' : 's'}`);
});
const openHelp = () => { if (!el.help.open) el.help.showModal(); };
el.helpBtn.addEventListener('click', openHelp);
el.zoomIn.addEventListener('click', () => viewport.zoomIn());
el.zoomOut.addEventListener('click', () => viewport.zoomOut());
el.zoomFit.addEventListener('click', () => viewport.fit());

// ---------- keys ----------
window.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  const typing = e.target.closest?.('input, textarea, [contenteditable]');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && shown) { e.preventDefault(); search.focus(); return; }
  if (editor.on() && !typing) {
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    const act = mod && k === 'z' ? (e.shiftKey ? editor.redo : editor.undo) : mod && k === 'y' ? editor.redo
      : !mod && !e.altKey && (e.key === 'Delete' || e.key === 'Backspace') ? editor.remove
        : e.key === 'Escape' && editor.escape() ? () => {} : null;
    if (act) { e.preventDefault(); act(); return; }
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  const pan = e.shiftKey ? 400 : 120;
  const keys = {
    '/': () => search.focus(),
    '?': openHelp,
    '+': () => viewport.zoomIn(), '=': () => viewport.zoomIn(),
    '-': () => viewport.zoomOut(), _: () => viewport.zoomOut(),
    0: () => viewport.fit(),
    ArrowLeft: () => viewport.panBy(-pan, 0), ArrowRight: () => viewport.panBy(pan, 0),
    ArrowUp: () => viewport.panBy(0, -pan), ArrowDown: () => viewport.panBy(0, pan),
    r: () => source.reload(),
    e: () => setEditing(!editor.on()),
    n: () => { if (hasNotes()) toggleNotes(); },
    // the next theme, fancy or not as now
    t: () => {
      const cur = effectiveTheme(), next = BASES[(BASES.indexOf(baseOf(cur)) + 1) % BASES.length];
      setTheme(isFancy(cur) && THEMES[next + FANCY] ? next + FANCY : next);
    },
    Escape: () => { el.recent.hidden = true; showThemes(false); setMenu(false); highlight.clearPins(); highlight.foldNotes(); hideBanner(); },
  };
  const fn = keys[e.key];
  if (!fn || (!shown && !['/', '?', 'Escape'].includes(e.key))) return;
  e.preventDefault();
  fn();
});

// a hash typed or pasted into the address bar, or a #src= link clicked
window.addEventListener('hashchange', async () => {
  const { settings, view, src } = readHash();
  const cur = source.current();
  if (src && src !== (cur?.flow != null ? cur.name : cur?.src)) {
    linked = { settings, view };
    if (!(await openSrc(src))) linked = null;
    return;
  }
  if (view && shown) viewport.setView(view); else pendingView = view;
  state.set(settings);
});

// ---------- start ----------
updateToolbar();
// A #src= link opens that file, also in a page with flows baked in; one that names a baked-in
// flow opens that flow (picking one puts its name there). If it cannot be loaded, the baked-in
// flows are there as without it. The query is not read: hosts such as Notion's file preview put
// their own ?src= there. One baked-in flow opens right away; several are offered on the start
// screen.
function openEmbedded() {
  if (embedded.length === 1) source.loadEmbedded(0); else setEmpty(true);
}
if (initial.src) {
  openSrc(initial.src).then((ok) => {
    if (ok) source.restoreWatch();
    if (ok || !embedded.length) return;
    keepBanner = embedded.length === 1; // the baked-in flow is drawn under the error, which stays
    openEmbedded();
  });
} else if (embedded.length) {
  openEmbedded();
} else {
  const last = source.last();
  if (last?.text) { source.loadText(last.text, last.name, last.src); source.restoreWatch(); } else setEmpty(true);
}

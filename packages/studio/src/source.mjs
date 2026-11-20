// Where the DOT text comes from: flows baked into the page (build --embed), a #src= URL, file
// picker, drag-and-drop, paste. Remembers the last file and a short recent list in localStorage
// (not the baked-in flows: several embeds of one site share it), and can watch a #src URL.
// Watch only works for a file the studio fetches over http (#src=, e.g. under `linemap studio`);
// a file opened, dropped or pasted cannot be watched. Switching Watch keeps the URL's state in
// localStorage, which only a page load reads (restoreWatch): reloading the page, in any tab of
// this browser, keeps watching a URL that was watched. Opening another file in the page does
// not look it up. A list, not one value, so tabs watching different files each get theirs back.
// Edits (edit mode) replace the text in place: a file the server can save (`linemap studio`, which
// sends `x-linemap-save: put`) is written back at once, with the ETag it was read with, so a file
// changed on disk meanwhile is never overwritten; anything else keeps the edits in the page (and
// the recent list) until they are downloaded or copied (`dirty`).

const LAST = 'linemap:last';
const RECENT = 'linemap:recent';
const MAX_RECENT = 8;
const WATCHED = 'linemap:watched';
const MAX_WATCHED = 20;
const WATCH_MS = 1000;

// localStorage may be missing or throw (privacy settings, file:// in some browsers, quota).
export const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not kept */ } },
};

export const isHttp = () => /^https?:$/.test(location.protocol);
const baseName = (s) => decodeURIComponent(String(s).split(/[?#]/)[0].split('/').pop() || s);
const looksLikeDot = (t) => /^\s*(\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*|#[^\n]*\n\s*)*(strict\s+)?(di)?graph\b/i.test(t);

// onText({ text, name, src, flow, fresh, edited }): fresh = a different file (fit the view, reset
// settings); edited = an edit made here; otherwise a reload of the same one. onError(title, message).
// onSave(state, message): 'saving', 'saved', 'conflict' (the file changed on disk; it is loaded
// again) or 'error'. embedded: [{ name, text }] baked into the page; flow is the index of the one
// shown, if any.
export function createSource({ onText, onError, onWatch, onSave, embedded = [] }) {
  let current = null; // { text, name, src, flow, etag, save, dirty }
  let watchTimer = 0;
  let polling = false;
  let saving = false, saveAgain = false;
  let saves = 0; // counts saves begun and ended, so a poll that overlapped one is ignored

  function emit(text, name, src, fresh, { keep = true, flow = null, etag = null, save = null } = {}) {
    const changed = !current || current.text !== text || current.name !== name;
    current = { text, name, src, flow, etag, save, dirty: false };
    if (changed && keep) remember(text, name, src);
    onText({ text, name, src, flow, fresh });
  }

  // URLs with Watch on, most recent first, as absolute URLs (the same file under ./x and x).
  const watchKey = (src) => { try { return new URL(src, location.href).href; } catch { return String(src); } };
  const watched = () => (store.get(WATCHED) ?? []).filter((s) => typeof s === 'string');
  function rememberWatch(src, on) {
    const key = watchKey(src);
    const rest = watched().filter((s) => s !== key);
    store.set(WATCHED, (on ? [key, ...rest] : rest).slice(0, MAX_WATCHED));
  }

  function remember(text, name, src) {
    store.set(LAST, { text, name, src });
    const recent = (store.get(RECENT) ?? []).filter((r) => r && r.name !== name);
    recent.unshift({ name, text, src, time: Date.now() });
    store.set(RECENT, recent.slice(0, MAX_RECENT));
  }

  async function fetchText(src) {
    const res = await fetch(src, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText || ''}`.trim());
    const save = res.headers.get('x-linemap-save') === 'put' && res.headers.get('etag') ? 'put' : null;
    return { text: await res.text(), etag: res.headers.get('etag'), save };
  }

  async function loadUrl(src, { fresh = true } = {}) {
    try {
      const { text, etag, save } = await fetchText(src);
      emit(text, baseName(src), src, fresh, { etag, save });
      return true;
    } catch (err) {
      const hint = location.protocol === 'file:'
        ? '\n\nBrowsers do not let a page opened from a file fetch other files. Serve over http, e.g. with npx @linemap/cli studio, or open the file with Open / drag-and-drop.'
        : '';
      onError(`Could not load ${src}`, `${err.message}${hint}`);
      return false;
    }
  }

  async function loadFile(file) {
    try {
      const text = await file.text();
      setWatch(false);
      emit(text, file.name, null, true);
    } catch (err) {
      onError(`Could not read ${file.name}`, err.message);
    }
  }

  // pasted text is named after its graph: `digraph postal {` -> "postal (pasted)"
  function loadText(text, name = `${/graph\s+("?)([\w.-]+)\1\s*\{/.exec(text)?.[2] ?? 'flow'} (pasted)`, src = null) {
    setWatch(false);
    emit(text, name, src, true);
  }

  function loadEmbedded(i) {
    const f = embedded[i];
    if (!f) return;
    setWatch(false);
    emit(f.text, f.name, null, true, { keep: false, flow: i });
  }
  // the baked-in flow a #src= names (its name), or -1
  const flowNamed = (src) => (src ? embedded.findIndex((f) => f.name === src) : -1);

  // Watching polls the src URL and re-runs when its text changed (only over http).
  // remember: the user switched it, so a page reload on this URL watches it (or not).
  function setWatch(on, { remember: keepIt = false } = {}) {
    on = !!(on && current?.src && isHttp());
    if (keepIt && current?.src) rememberWatch(current.src, on);
    clearInterval(watchTimer);
    watchTimer = 0;
    if (on) {
      watchTimer = setInterval(async () => {
        if (polling || saving) return;
        polling = true;
        const at = saves;
        try {
          const got = await fetchText(current.src);
          // (a save meanwhile: what was read may be the text before it)
          if (got.text !== current.text && at === saves && !saving) emit(got.text, current.name, current.src, false, got);
        } catch { /* mid-save or server gone: try again next time */ }
        polling = false;
      }, WATCH_MS);
    }
    onWatch?.(on);
  }

  async function reload() {
    if (!current) return;
    if (current.src && isHttp()) {
      const src = current.src;
      try {
        const got = await fetchText(src);
        emit(got.text, current.name, src, false, got);
      } catch (err) {
        onError(`Could not reload ${src}`, err.message);
      }
    } else {
      onText({ ...current, fresh: false });
    }
  }

  // An edit made here: the new text of the current file, drawn at once and saved where it can be.
  function edit(text) {
    if (!current || text === current.text) return;
    current = { ...current, text, dirty: !current.save };
    remember(text, current.name, current.src);
    // a baked-in flow keeps its edits while the page is open, also when another one is picked
    if (current.flow !== null && current.flow !== undefined) embedded[current.flow] = { name: current.name, text };
    onText({ ...current, fresh: false, edited: true });
    if (current.save) save();
  }

  // One PUT at a time; edits made meanwhile go in the next one, as one.
  async function save() {
    if (saving) { saveAgain = true; return; }
    saving = true;
    saves++;
    onSave?.('saving');
    let state = 'saved', message = '';
    try {
      do {
        saveAgain = false;
        const { src, text, etag } = current;
        const res = await fetch(src, { method: 'PUT', headers: { 'if-match': etag ?? '', 'content-type': 'text/plain; charset=utf-8' }, body: text });
        if (res.status === 412) { state = 'conflict'; break; }
        if (!res.ok) throw new Error(`${res.status} ${(await res.text()).trim() || res.statusText}`);
        if (current.src === src) current.etag = res.headers.get('etag');
      } while (saveAgain && current.save);
    } catch (err) {
      state = 'error';
      message = err.message;
      if (current) current.dirty = true;
    }
    saves++;
    saving = false;
    onSave?.(state, message);
    // changed on disk since it was read: show the file as it is now
    if (state === 'conflict') reload();
  }

  // Drag-and-drop anywhere; `dropEl` is the overlay shown while dragging.
  function bindDrop(dropEl) {
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; dropEl.hidden = false; });
    window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; dropEl.hidden = true; } });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      dropEl.hidden = true;
      const file = e.dataTransfer.files[0];
      if (file) loadFile(file);
    });
  }

  // Pasting DOT text anywhere outside a text field opens it.
  function bindPaste() {
    window.addEventListener('paste', (e) => {
      if (e.target.closest?.('input, textarea, [contenteditable]')) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!looksLikeDot(text)) return;
      e.preventDefault();
      loadText(text);
    });
  }

  return {
    loadUrl, loadFile, loadText, loadEmbedded, flowNamed, reload, edit,
    // edits only in this page (not saved to a file)
    dirty: () => !!current?.dirty,
    markClean: () => { if (current) current.dirty = false; },
    canSave: () => current?.save === 'put',
    embedded: () => embedded, setWatch, bindDrop, bindPaste,
    // on page load only: watch the file just loaded if it was watched when the page was left
    restoreWatch: () => { if (current?.src && watched().includes(watchKey(current.src))) setWatch(true); },
    current: () => current,
    watching: () => !!watchTimer,
    canWatch: () => !!(current?.src && isHttp()),
    last: () => store.get(LAST),
    recent: () => (store.get(RECENT) ?? []).filter((r) => r && typeof r.text === 'string'),
    clearRecent: () => { store.set(RECENT, []); },
  };
}

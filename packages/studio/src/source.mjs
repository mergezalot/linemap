// Where the DOT text comes from: flows baked into the page (build --embed), a #src= URL, file
// picker, drag-and-drop, paste. Remembers the last file and a short recent list in localStorage
// (not the baked-in flows: several embeds of one site share it), and can watch a #src URL.
// Watch only works for a file the studio fetches over http (#src=, e.g. under `linemap studio`);
// a file opened, dropped or pasted cannot be watched. Switching Watch keeps the URL's state in
// localStorage, which only a page load reads (restoreWatch): reloading the page, in any tab of
// this browser, keeps watching a URL that was watched. Opening another file in the page does
// not look it up. A list, not one value, so tabs watching different files each get theirs back.

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

// onText({ text, name, src, fresh }): fresh = a different file (fit the view, reset settings);
// otherwise a reload of the same one. onError(title, message).
// embedded: [{ name, text }] baked into the page.
export function createSource({ onText, onError, onWatch, embedded = [] }) {
  let current = null; // { text, name, src }
  let watchTimer = 0;
  let polling = false;

  function emit(text, name, src, fresh, { keep = true } = {}) {
    const changed = !current || current.text !== text || current.name !== name;
    current = { text, name, src };
    if (changed && keep) remember(text, name, src);
    onText({ text, name, src, fresh });
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
    return res.text();
  }

  async function loadUrl(src, { fresh = true } = {}) {
    try {
      emit(await fetchText(src), baseName(src), src, fresh);
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
    emit(f.text, f.name, null, true, { keep: false });
  }

  // Watching polls the src URL and re-runs when its text changed (only over http).
  // remember: the user switched it, so a page reload on this URL watches it (or not).
  function setWatch(on, { remember: keepIt = false } = {}) {
    on = !!(on && current?.src && isHttp());
    if (keepIt && current?.src) rememberWatch(current.src, on);
    clearInterval(watchTimer);
    watchTimer = 0;
    if (on) {
      watchTimer = setInterval(async () => {
        if (polling) return;
        polling = true;
        try {
          const text = await fetchText(current.src);
          if (text !== current.text) emit(text, current.name, current.src, false);
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
        const text = await fetchText(src);
        emit(text, current.name, src, false);
      } catch (err) {
        onError(`Could not reload ${src}`, err.message);
      }
    } else {
      onText({ ...current, fresh: false });
    }
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
    loadUrl, loadFile, loadText, loadEmbedded, reload,
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

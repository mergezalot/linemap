// Where the DOT text comes from: flows baked into the page (build --embed), ?src= URL, file
// picker, drag-and-drop, paste. Remembers the last file and a short recent list in localStorage
// (not the baked-in flows: several embeds of one site share it), and can watch a ?src URL.

const LAST = 'linemap:last';
const RECENT = 'linemap:recent';
const MAX_RECENT = 8;
const WATCH_MS = 1000;

// localStorage may be missing or throw (privacy settings, file:// in some browsers, quota).
const store = {
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
        ? '\n\nBrowsers do not let a page opened from a file fetch other files. Serve over http, e.g. pnpm studio:serve, or open the file with Open / drag-and-drop.'
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

  // Watching polls the ?src URL and re-runs when its text changed (only over http).
  function setWatch(on) {
    on = !!(on && current?.src && isHttp());
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
    current: () => current,
    watching: () => !!watchTimer,
    canWatch: () => !!(current?.src && isHttp()),
    last: () => store.get(LAST),
    recent: () => (store.get(RECENT) ?? []).filter((r) => r && typeof r.text === 'string'),
    clearRecent: () => { store.set(RECENT, []); },
  };
}

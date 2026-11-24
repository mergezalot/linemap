// The source sidebar: the DOT text of the flow shown, beside the map, editable, in view and edit
// mode. A plain textarea (no wrapping, Tab inserts two spaces, Escape leaves it for its Close
// button) with a gutter of line numbers that scrolls with it. Keys typed in it never reach the
// studio's shortcuts; Ctrl+Z in it is the textarea's own undo.
// Text -> map: a pause in typing (DELAY) commits the text (commit(text): the error, or null;
// main.mjs checks it as for a map edit and hands it to the editor, so it is one undo step there and
// saves, dirties and watches as a map edit does). Leaving the textarea commits at once. A text
// that cannot be drawn is not committed: the last map stays, the message shows under the text
// and the line it names ("DOT line N") is marked; a click on it puts the caret there.
// Map -> text: setText(text) after every change of the flow's text (a map edit, undo, reload,
// watch, another flow), keeping the caret and the scroll where they were (the caret moves with
// the text around it). While a pause is pending, what was typed wins and is committed over it;
// a text that could not be drawn is replaced (the map was changed meanwhile, so it wins), as is
// everything when another flow is shown (fresh).
// Map <-> text: mark(ranges) tints the lines of what is selected on the map (a stronger band for its
// own statements, a weaker one for statements that only mention it) and, unless the textarea has
// the focus or a pause is pending, scrolls the first into view; it never moves the caret. Typing
// drops the marks until the text is on the map again. onCaret(offset) is called when the caret
// is put somewhere (a click, keys that move it, the focus), never while typing or while the text
// differs from the map's (pending or not drawable): main.mjs selects what the statement there is
// about.
// Find: Ctrl+F in the text (or the head's search button) opens a row under the head; every match
// of what is typed there (ignoring case) is drawn behind the text, the current one stronger and in
// view. Enter / Shift+Enter go to the next / previous one; Esc closes it and leaves the caret on
// the current match, selected.
// Open or closed and the width (drag the panel's edge, or arrow keys on it) are remembered.
// On wide screens the map makes room for it; on narrow ones (CSS) it lies over the map.
const DELAY = 300;  // ms of no typing before the text is committed
const LH = 18;      // line height of the text and the gutter, px (style.css)
const PAD = 6;      // top padding of the text, px (style.css)
const MIN_W = 240;
const KEY = 'linemap:source';

export function createSourcePanel({ panel, store, commit, onToggle, onCaret }) {
  const $ = (s) => panel.querySelector(s);
  const ta = $('.src-text'), lines = $('.src-lines'), band = $('.src-band'), status = $('.src-status');
  const goto = $('.src-goto'), msg = $('.src-msg'), name = $('.src-name'), resize = $('.src-resize'), close = $('.src-close');
  const saved = store.get(KEY) ?? {};
  let open = saved.open === true;
  let usable = false;  // a flow is open (else the panel stays away, open or not)
  let width = clampW(Number(saved.width) || 440);
  let timer = 0;       // a commit pending
  let broken = false;  // the text shown could not be drawn (not committed)
  let errLine = null;
  let count = 0;       // lines in the gutter
  let marks = [];      // [{ line, endLine, weak }] tinted
  const markBox = document.createElement('div');
  markBox.className = 'src-marks';
  band.before(markBox);
  const findRow = $('.src-find'), findInput = $('.src-find-input'), findCount = $('.src-find-count'), findBtn = $('.src-find-btn');
  const foundBox = document.createElement('div');
  foundBox.className = 'src-found';
  band.before(foundBox);
  let hits = [];       // [{ start, end, line }] of what is looked for
  let hit = -1;        // the current one

  function clampW(w) { return Math.round(Math.max(MIN_W, Math.min(w, Math.max(MIN_W, innerWidth * 0.8)))); }
  const keep = () => store.set(KEY, { open, width });
  function place() {
    document.body.classList.toggle('source-open', open && usable);
    panel.hidden = !(open && usable);
    document.documentElement.style.setProperty('--src-w', `${width}px`);
    resize.setAttribute('aria-valuenow', String(width));
  }
  function setOpen(v) {
    open = !!v;
    if (!open) { flush(); closeFind({ toText: false }); }
    place();
    keep();
    if (open) { gutter(); scrolled(); }
    onToggle?.(open);
  }

  // ---------- gutter and error mark ----------
  function gutter() {
    const n = ta.value.split('\n').length;
    if (n !== count) {
      count = n;
      lines.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
      lines.parentElement.style.width = `${String(n).length + 2}ch`;
    }
  }
  function scrolled() {
    lines.style.transform = `translateY(${-ta.scrollTop}px)`;
    band.hidden = !errLine;
    if (errLine) band.style.top = `${PAD + (errLine - 1) * LH - ta.scrollTop}px`;
    markBox.style.transform = `translateY(${PAD - ta.scrollTop}px)`;
    if (hits.length) drawHits();
  }
  function drawMarks() {
    markBox.replaceChildren(...marks.map(({ line, endLine, weak }) => {
      const d = document.createElement('div');
      d.className = `src-mark${weak ? ' weak' : ''}`;
      d.dataset.line = String(line);
      d.style.top = `${(line - 1) * LH}px`;
      d.style.height = `${(endLine - line + 1) * LH}px`;
      return d;
    }));
  }
  // the lines of what is selected on the map; scroll: bring the first strong one into view
  function mark(ranges, { scroll = true } = {}) {
    marks = timer || broken ? [] : ranges;
    drawMarks();
    if (!scroll || !marks.length || !open || document.activeElement === ta) return;
    const first = marks.find((m) => !m.weak) ?? marks[0];
    const y0 = (first.line - 1) * LH, y1 = first.endLine * LH, h = ta.clientHeight - 2 * PAD;
    if (y0 < ta.scrollTop || y1 > ta.scrollTop + h) ta.scrollTop = Math.max(0, y1 - y0 > h ? y0 : y0 - Math.max(0, (h - (y1 - y0)) / 3));
    scrolled();
  }
  // the caret was put somewhere: tell main.mjs, unless typing is pending or the text is not the map's
  let caretAt = -1;
  function caret() {
    if (timer || broken || ta.readOnly || document.activeElement !== ta) return;
    const at = ta.selectionStart;
    if (at === caretAt) return;
    caretAt = at;
    onCaret?.(at, ta.value);
  }
  function showError(err) {
    broken = !!err;
    errLine = err ? Number(/DOT line (\d+)/.exec(err)?.[1]) || null : null;
    status.hidden = !err;
    msg.textContent = err ? err.replace(/^DOT line \d+(, column \d+)?: /, '') : '';
    goto.hidden = !errLine;
    goto.textContent = errLine ? `Line ${errLine}` : '';
    panel.classList.toggle('broken', broken);
    scrolled();
  }
  // the caret to the start of line n (1-based), which comes into view
  function goToLine(n) {
    const rows = ta.value.split('\n');
    n = Math.max(1, Math.min(n, rows.length));
    const at = rows.slice(0, n - 1).reduce((t, r) => t + r.length + 1, 0);
    ta.focus();
    ta.setSelectionRange(at, at);
    const y = (n - 1) * LH;
    if (y < ta.scrollTop || y + LH > ta.scrollTop + ta.clientHeight - 2 * PAD) ta.scrollTop = Math.max(0, y - ta.clientHeight / 3);
    scrolled();
  }

  // ---------- find ----------
  // the width of a character of the text (it is monospaced), and its padding
  let cw = 0;
  const charW = () => {
    if (!cw) {
      const c = document.createElement('canvas').getContext('2d');
      c.font = getComputedStyle(ta).font;
      cw = c.measureText('0'.repeat(20)).width / 20 || 7.2;
    }
    return cw;
  };
  // the column x a text offset is drawn at (tabs to the next tab stop)
  function columnOf(at) {
    const from = ta.value.lastIndexOf('\n', at - 1) + 1, tab = Number(getComputedStyle(ta).tabSize) || 2;
    let col = 0;
    for (let i = from; i < at; i++) col = ta.value[i] === '\t' ? (Math.floor(col / tab) + 1) * tab : col + 1;
    return col;
  }
  function findAll() {
    const q = findInput.value.toLowerCase();
    hits = [];
    if (q) {
      const t = ta.value.toLowerCase();
      let line = 1, at = 0; // (lines counted as the matches go)
      for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + q.length)) {
        for (; at < i; at++) if (t.charCodeAt(at) === 10) line++;
        hits.push({ start: i, end: i + q.length, line });
      }
    }
    if (hit >= hits.length) hit = hits.length - 1;
  }
  // the text changed under the matches: found again, nothing scrolls
  function rematch() { findAll(); if (hit < 0 && hits.length) hit = 0; drawHits(); showCount(); }
  function drawHits() {
    const pl = parseFloat(getComputedStyle(ta).paddingLeft), w = charW();
    foundBox.style.left = `${ta.offsetLeft}px`;
    // only the ones near the lines in view
    const first = Math.floor(ta.scrollTop / LH), last = first + Math.ceil(ta.clientHeight / LH) + 1;
    const shown = [];
    hits.forEach((h, i) => {
      const { line } = h;
      if (line < first || line > last + 1) return;
      const d = document.createElement('div');
      d.className = `src-hit${i === hit ? ' on' : ''}`;
      const c0 = columnOf(h.start), c1 = columnOf(h.end);
      d.style.top = `${PAD + (line - 1) * LH - ta.scrollTop}px`;
      d.style.left = `${pl + c0 * w - ta.scrollLeft}px`;
      d.style.width = `${Math.max(2, (c1 - c0) * w)}px`;
      shown.push(d);
    });
    foundBox.replaceChildren(...shown);
  }
  function showCount() {
    const q = findInput.value;
    findCount.textContent = !q ? '' : hits.length ? `${hit + 1}/${hits.length}` : 'none';
    findCount.classList.toggle('none', !!q && !hits.length);
  }
  // the current match into view (both ways: the text does not wrap)
  function reveal() {
    const h = hits[hit];
    if (!h) return;
    const y = (h.line - 1) * LH, view = ta.clientHeight - 2 * PAD;
    if (y < ta.scrollTop || y + LH > ta.scrollTop + view) ta.scrollTop = Math.max(0, y - view / 3);
    const pl = parseFloat(getComputedStyle(ta).paddingLeft), x0 = columnOf(h.start) * charW(), x1 = columnOf(h.end) * charW();
    if (x0 < ta.scrollLeft || x1 + 2 * pl > ta.scrollLeft + ta.clientWidth) ta.scrollLeft = Math.max(0, x0 - ta.clientWidth / 3);
  }
  function refind({ from = null } = {}) {
    findAll();
    // the first match at or after `from` (the caret when looking starts)
    if (from !== null) { hit = hits.findIndex((h) => h.end > from); if (hit < 0) hit = hits.length ? 0 : -1; }
    if (hit < 0 && hits.length) hit = 0;
    reveal();
    scrolled();
    drawHits();
    showCount();
  }
  function step(d) {
    if (!hits.length) return;
    hit = (hit + d + hits.length) % hits.length;
    reveal();
    scrolled();
    drawHits();
    showCount();
  }
  function openFind() {
    if (!open) setOpen(true);
    findRow.hidden = false;
    findBtn.setAttribute('aria-expanded', 'true');
    // a word selected in the text is what to look for
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (sel && !sel.includes('\n')) findInput.value = sel;
    findInput.focus();
    findInput.select();
    refind({ from: ta.selectionStart });
  }
  function closeFind({ toText = true } = {}) {
    if (findRow.hidden) return;
    findRow.hidden = true;
    findBtn.setAttribute('aria-expanded', 'false');
    const h = hits[hit];
    hits = [];
    hit = -1;
    foundBox.replaceChildren();
    if (toText) {
      ta.focus();
      if (h) ta.setSelectionRange(h.start, h.end);
    }
  }
  findBtn.addEventListener('click', () => (findRow.hidden ? openFind() : closeFind()));
  findInput.addEventListener('input', () => { hit = -1; refind({ from: ta.selectionStart }); });
  findInput.addEventListener('keydown', (e) => {
    e.stopPropagation(); // no studio shortcut
    if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); findInput.select(); }
  });
  $('.src-find-next').addEventListener('click', () => step(1));
  $('.src-find-prev').addEventListener('click', () => step(-1));
  $('.src-find-close').addEventListener('click', () => closeFind());

  // ---------- text -> map ----------
  function apply() {
    clearTimeout(timer);
    timer = 0;
    if (ta.readOnly) return;
    showError(commit(ta.value));
  }
  function flush() { if (timer) apply(); }
  ta.addEventListener('input', () => {
    gutter();
    if (!findRow.hidden) rematch();
    // what is marked has moved with the typing: the marks come back with the map
    if (marks.length) { marks = []; drawMarks(); }
    caretAt = -1;
    clearTimeout(timer);
    timer = setTimeout(apply, DELAY);
  });
  ta.addEventListener('blur', () => { flush(); caretAt = -1; });
  // (after the press has put the caret)
  ta.addEventListener('focus', () => setTimeout(caret, 0));
  ta.addEventListener('pointerup', () => setTimeout(caret, 0));
  ta.addEventListener('keyup', (e) => { if (/^(Arrow|Page|Home|End)/.test(e.key)) caret(); });
  ta.addEventListener('scroll', scrolled);
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation(); // no studio shortcut
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      // (insertText keeps the textarea's own undo)
      if (!document.execCommand?.('insertText', false, '  ')) {
        ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input'));
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close.focus();
    } else if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openFind();
    }
  });
  goto.addEventListener('click', () => { if (errLine) goToLine(errLine); });
  close.addEventListener('click', () => setOpen(false));

  // ---------- width ----------
  resize.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    resize.setPointerCapture(e.pointerId);
    panel.classList.add('resizing');
    const move = (ev) => { width = clampW(innerWidth - ev.clientX); place(); };
    const up = () => {
      resize.removeEventListener('pointermove', move);
      resize.removeEventListener('pointerup', up);
      resize.removeEventListener('pointercancel', up);
      panel.classList.remove('resizing');
      keep();
    };
    resize.addEventListener('pointermove', move);
    resize.addEventListener('pointerup', up);
    resize.addEventListener('pointercancel', up);
  });
  resize.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: 20, ArrowRight: -20 }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    width = clampW(width + d * (e.shiftKey ? 5 : 1));
    place();
    keep();
  });
  window.addEventListener('resize', () => { const w = clampW(width); if (w !== width) { width = w; place(); } });
  place();

  return {
    // The flow's text now (null: none open). fresh: another flow, which replaces whatever is here.
    setText(text, { fresh = false, title = '' } = {}) {
      name.textContent = title;
      ta.readOnly = text == null;
      if (usable !== (text != null)) { usable = text != null; place(); if (open && usable) gutter(); }
      text ??= '';
      if (fresh) { clearTimeout(timer); timer = 0; } else if (timer) return; // typing wins
      const old = ta.value;
      if (text === old) { if (broken) showError(null); return; }
      const top = ta.scrollTop, left = ta.scrollLeft;
      // the caret keeps its place in the text around it: before the change, or after it
      let p = 0;
      while (p < old.length && p < text.length && old[p] === text[p]) p++;
      let s = 0;
      while (s < old.length - p && s < text.length - p && old[old.length - 1 - s] === text[text.length - 1 - s]) s++;
      const at = (x) => (x <= p ? x : x >= old.length - s ? x + text.length - old.length : Math.min(x, text.length - s));
      const [a, b] = [at(ta.selectionStart), at(ta.selectionEnd)];
      ta.value = text;
      if (fresh) { ta.setSelectionRange(0, 0); ta.scrollTop = 0; ta.scrollLeft = 0; } else { ta.setSelectionRange(a, b); ta.scrollTop = top; ta.scrollLeft = left; }
      caretAt = -1;
      showError(null);
      gutter();
      if (fresh) closeFind({ toText: false }); else if (!findRow.hidden) rematch();
      scrolled();
    },
    mark,
    toggle: () => setOpen(!open),
    setOpen,
    isOpen: () => open,
    // commit what was typed now, if a pause is pending (before the page goes, a download, …)
    flush,
    // typed and not on the map yet: pending, or not drawable
    pending: () => !!timer || broken,
    goToLine,
    textarea: ta,
  };
}

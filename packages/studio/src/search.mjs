// Search over nodes (label or id), containers and lines. Enter or a click selects a result;
// what selecting does (zoom, focus) is up to the caller.
import { esc } from './tooltip.mjs';

const MAX = 12;
const KIND_LABEL = { node: 'node', container: 'container', line: 'line', note: 'note' };

export function createSearch({ input, list, onSelect }) {
  let entries = [];
  let results = [];
  let active = 0;

  const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();

  function find(q) {
    q = norm(q);
    if (!q) return [];
    const scored = [];
    for (const e of entries) {
      const i = e.text.indexOf(q);
      const j = e.idText.indexOf(q);
      if (i < 0 && j < 0) continue;
      // label start beats a word start beats anywhere; ids count a little less
      const at = i >= 0 ? i : j;
      const word = at === 0 || /[\s_\-./]/.test((i >= 0 ? e.text : e.idText)[at - 1]);
      scored.push({ e, score: (at === 0 ? 0 : word ? 1 : 2) + (i < 0 ? 0.5 : 0) + e.rank * 0.1 });
    }
    return scored.sort((a, b) => a.score - b.score || a.e.label.length - b.e.label.length).slice(0, MAX).map((s) => s.e);
  }

  const mark = (label, q) => {
    const i = label.toLowerCase().indexOf(q);
    return i < 0 ? esc(label) : `${esc(label.slice(0, i))}<mark>${esc(label.slice(i, i + q.length))}</mark>${esc(label.slice(i + q.length))}`;
  };

  function show() {
    const q = norm(input.value);
    results = find(q);
    active = 0;
    if (!q) { list.hidden = true; return; }
    list.innerHTML = results.length
      ? results.map((e, i) => `<li role="option" data-i="${i}" aria-selected="${i === active}">` +
          (e.color ? `<span class="swatch" style="background:${esc(e.color)}"></span>` : '') +
          `<span class="lbl">${mark(e.label, q)}</span><span class="kind">${KIND_LABEL[e.kind]}</span></li>`).join('')
      : '<li class="none">No match</li>';
    list.hidden = false;
  }

  function setActive(i) {
    if (!results.length) return;
    active = (i + results.length) % results.length;
    for (const li of list.children) li.setAttribute('aria-selected', String(Number(li.dataset.i) === active));
    list.children[active]?.scrollIntoView({ block: 'nearest' });
  }

  function choose(i) {
    const e = results[i];
    if (!e) return;
    list.hidden = true;
    input.blur();
    onSelect(e);
  }

  input.addEventListener('input', show);
  input.addEventListener('focus', () => { if (input.value) show(); });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { e.preventDefault(); if (input.value) { input.value = ''; show(); } else input.blur(); }
  });
  // mousedown, not click: the input's blur would hide the list first
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); choose(Number(li.dataset.i)); }
  });

  return {
    // [{ kind, id, label, color? }]
    index(next) {
      entries = next.map((e) => ({ ...e, label: e.label.replace(/\s*\n\s*/g, ' '), text: norm(e.label), idText: norm(e.id),
        rank: { node: 0, container: 1, line: 2, note: 3 }[e.kind] }));
      if (document.activeElement === input) show();
    },
    focus() { input.focus(); input.select(); },
  };
}

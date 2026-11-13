// The legend as an HTML panel: one row per line (swatch with a direction triangle, label, number
// of bundles). Hover = focus the line; click = hide/show; alt- or shift-click = solo.
import { esc } from './tooltip.mjs';

export function createLegend({ el, markColor, onToggle, onSolo, onShowAll, onHideAll, onHover, collapsed = false }) {
  let lines = [];
  el.classList.toggle('collapsed', collapsed);
  el.innerHTML = `
    <div class="lg-head">
      <button class="lg-title" aria-expanded="${!collapsed}" title="Show or hide the legend">
        <svg class="icon small"><use href="#i-chevron"/></svg>Lines <span class="count"></span>
      </button>
      <button class="btn" data-act="show" title="Show every line">Show all</button>
      <button class="btn" data-act="hide" title="Hide every line">Hide all</button>
    </div>
    <ul role="list"></ul>`;
  const list = el.querySelector('ul');
  const title = el.querySelector('.lg-title');

  title.addEventListener('click', () => {
    const c = el.classList.toggle('collapsed');
    title.setAttribute('aria-expanded', String(!c));
  });
  el.querySelector('[data-act="show"]').addEventListener('click', () => onShowAll());
  el.querySelector('[data-act="hide"]').addEventListener('click', () => onHideAll());

  list.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-line]');
    if (!li) return;
    const id = li.dataset.line;
    if (e.altKey || e.shiftKey) onSolo(id); else onToggle(id);
  });
  let hovered = null;
  list.addEventListener('pointerover', (e) => {
    const li = e.target.closest('li[data-line]');
    const id = li && !li.classList.contains('hidden') ? li.dataset.line : null;
    if (id !== hovered) { hovered = id; onHover(id ? [id] : null); }
  });
  list.addEventListener('pointerleave', () => { hovered = null; onHover(null); });

  // The swatch: a short piece of line with a direction triangle, as drawn on the map.
  const swatch = (l) => `<svg class="sw" viewBox="0 0 30 10" aria-hidden="true"><rect x="0" y="0.5" width="30" height="9" rx="1.5" fill="${esc(l.color)}"/>` +
    `<polygon points="19,5 13,2.3 13,7.7" fill="${esc(markColor(l.color))}"/></svg>`;

  return {
    // lines: model.lines; counts: Map id -> number of bundles; hidden: Set of ids; pinned: ids
    update(next, counts, hidden, pinned = []) {
      lines = next;
      el.querySelector('.count').textContent = hidden.size ? `${lines.length - hidden.size}/${lines.length}` : String(lines.length);
      list.innerHTML = lines.map((l) => {
        const n = counts.get(l.id) ?? 0;
        const cls = [hidden.has(l.id) ? 'hidden' : '', pinned.includes(l.id) ? 'on' : ''].filter(Boolean).join(' ');
        return `<li data-line="${esc(l.id)}" class="${cls}" title="${hidden.has(l.id) ? 'Show' : 'Hide'} ${esc(l.label)} · Alt- or Shift-click: only this line">` +
          `${swatch(l)}<span class="lb">${esc(l.label)}</span><span class="ct" title="bundles">${n}</span></li>`;
      }).join('');
      el.hidden = false;
    },
    setPinned(pinned) {
      for (const li of list.children) li.classList.toggle('on', pinned.includes(li.dataset.line));
    },
    hide() { el.hidden = true; },
  };
}

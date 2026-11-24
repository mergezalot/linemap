// A split button: one part does the quick thing (go on to the next mode, switch fancy on or off),
// the other opens a menu of every choice. Either part may come first. Markup:
//   <div class="split"><button class="btn split-main">…</button>
//     <button class="btn split-arrow" aria-haspopup="menu" aria-expanded="false">…</button>
//     <div class="popover menu" role="menu" hidden></div></div>
// The menu's choices are buttons with data-<attr> (default data-value). renderMenu, if given,
// draws them each time the menu opens, so it shows the current choice; without it the menu's
// HTML is left as it is. A choice, or the quick part, leaves the narrow-screen menu open, to try
// one after another.
export function createSplit(root, { onMain, onPick, renderMenu, onOpen, attr = 'value' }) {
  const main = root.querySelector('.split-main');
  const arrow = root.querySelector('.split-arrow');
  const menu = root.querySelector('.menu');
  function show(open) {
    if (open) { if (renderMenu) menu.innerHTML = renderMenu(); onOpen?.(); }
    menu.hidden = !open;
    arrow.setAttribute('aria-expanded', String(open));
  }
  main.addEventListener('click', () => { show(false); onMain(); });
  arrow.addEventListener('click', (e) => { e.stopPropagation(); show(menu.hidden); });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest(`button[data-${attr}]`);
    if (!b) return;
    show(false);
    onPick(b.dataset[attr]);
  });
  document.addEventListener('click', (e) => { if (!menu.hidden && !root.contains(e.target)) show(false); });
  return { close: () => show(false), isOpen: () => !menu.hidden };
}

// One tooltip element, positioned near the pointer and kept inside the window. It never takes
// pointer events (CSS), so it cannot steal the hover from the map underneath.

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createTooltip(el) {
  let html = null;
  let pos = { x: 0, y: 0 };
  let frame = 0;

  function place() {
    frame = 0;
    const gap = 14;
    const { innerWidth: vw, innerHeight: vh } = window;
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = pos.x + gap, y = pos.y + gap;
    if (x + w > vw - 6) x = pos.x - gap - w;   // flip to the left of the pointer
    if (y + h > vh - 6) y = pos.y - gap - h;   // flip above
    el.style.transform = `translate(${Math.max(6, Math.round(x))}px, ${Math.max(6, Math.round(y))}px)`;
  }

  return {
    // content: HTML string (callers escape what they insert)
    show(content, x, y) {
      const changed = content !== html || el.hidden;
      if (content !== html) { el.innerHTML = content; html = content; }
      el.hidden = false;
      pos = { x, y };
      // new content changes the size: place it now, not a frame later at the old spot
      if (changed) { cancelAnimationFrame(frame); place(); } else this.move(x, y);
    },
    move(x, y) {
      pos = { x, y };
      if (!el.hidden && !frame) frame = requestAnimationFrame(place);
    },
    hide() {
      if (el.hidden) return;
      el.hidden = true;
      html = null;
    },
  };
}

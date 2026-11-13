// Pan and zoom by rewriting the SVG's viewBox, so the map stays crisp at every zoom level.
// The view is a centre (cx, cy, in map units) and a scale s (screen px per map unit); the viewBox
// always has the stage's aspect ratio, so nothing is letterboxed and the maths stays simple.

const MAX_SCALE = 8;   // 8x of 1:1
const FIT_PAD = 28;    // screen px around the map when fitting
const DRAG_START = 4;  // px a pointer must move before a press becomes a pan

// avoid(): a rectangle on the stage (a floating panel) that fitting should keep the map clear
// of when that costs little.
export function createViewport({ stage, onChange, avoid = () => null }) {
  let svg = null;
  let content = null; // { x, y, w, h } of the map, from the SVG's own viewBox
  let cx = 0, cy = 0, s = 1;
  let W = stage.clientWidth || 1, H = stage.clientHeight || 1;
  let anim = 0;
  // What the view was last asked to show, redone when the stage changes size (the toolbar
  // wrapping, a window resize): { fit: true } or { rect }. null once the user zooms or pans.
  let goal = null;

  // Scale and centre that show the whole map in a region of the stage.
  const fitIn = (r) => {
    const sc = Math.min((r.x1 - r.x0 - 2 * FIT_PAD) / content.w, (r.y1 - r.y0 - 2 * FIT_PAD) / content.h);
    return { s: sc, cx: content.x + content.w / 2 - ((r.x0 + r.x1) / 2 - W / 2) / sc, cy: content.y + content.h / 2 - ((r.y0 + r.y1) / 2 - H / 2) / sc };
  };
  // The whole stage, or beside or above the panel to avoid when the map stays nearly as large.
  function fitView() {
    const full = fitIn({ x0: 0, y0: 0, x1: W, y1: H });
    const a = avoid();
    if (!a) return full;
    const best = [fitIn({ x0: a.x1, y0: 0, x1: W, y1: H }), fitIn({ x0: 0, y0: 0, x1: W, y1: a.y0 })]
      .reduce((p, q) => (q.s > p.s ? q : p));
    return best.s >= full.s * 0.85 ? best : full;
  }
  const fitScale = () => (content ? fitIn({ x0: 0, y0: 0, x1: W, y1: H }).s : 1);
  const minScale = () => Math.min(fitScale() / 4, MAX_SCALE);
  const clampScale = (v) => Math.min(MAX_SCALE, Math.max(minScale(), v));

  function apply() {
    if (!svg) return;
    if (content) {
      // keep at least the map's centre line on screen: the centre may wander to the map's edges
      cx = Math.min(content.x + content.w, Math.max(content.x, cx));
      cy = Math.min(content.y + content.h, Math.max(content.y, cy));
    }
    const w = W / s, h = H / s;
    svg.setAttribute('viewBox', `${round(cx - w / 2)} ${round(cy - h / 2)} ${round(w)} ${round(h)}`);
    onChange?.();
  }
  const round = (v) => Math.round(v * 100) / 100;

  const stop = () => { cancelAnimationFrame(anim); anim = 0; };
  // Runs step(t) for t from 0 to 1 over `ms`, eased; ms = 0 applies the end state at once.
  function animate(step, ms = 220) {
    stop();
    if (!ms || matchMedia('(prefers-reduced-motion: reduce)').matches) { step(1); apply(); return; }
    const t0 = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      step(1 - (1 - t) ** 3);
      apply();
      anim = t < 1 ? requestAnimationFrame(frame) : 0;
    };
    anim = requestAnimationFrame(frame);
  }

  // Screen point (relative to the stage) -> map point.
  const toMap = (px, py) => ({ x: cx + (px - W / 2) / s, y: cy + (py - H / 2) / s });
  const local = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  // Zoom by `f` keeping the map point under screen point p (default: the centre) in place.
  function zoomAt(f, p = { x: W / 2, y: H / 2 }, ms = 0) {
    goal = null;
    const s0 = s, c0 = { x: cx, y: cy };
    const s1 = clampScale(s0 * f);
    const a = toMap(p.x, p.y);
    animate((t) => {
      s = s0 * (s1 / s0) ** t;
      cx = a.x - (a.x - c0.x) * s0 / s;
      cy = a.y - (a.y - c0.y) * s0 / s;
    }, ms);
  }

  // Show a map rectangle as large as fits (capped at maxScale), centred.
  function zoomTo(r, { ms = 260, pad = 0.88, maxScale = MAX_SCALE } = {}) {
    goal = null;
    const s0 = s, c0 = { x: cx, y: cy };
    const s1 = clampScale(Math.min(maxScale, Math.min(W / r.w, H / r.h) * pad));
    const c1 = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    animate((t) => {
      s = s0 * (s1 / s0) ** t;
      cx = c0.x + (c1.x - c0.x) * t;
      cy = c0.y + (c1.y - c0.y) * t;
    }, ms);
  }

  function fit(ms = 0) {
    if (!content) return;
    goal = { fit: true };
    const s0 = s, c0 = { x: cx, y: cy };
    const v = fitView();
    const s1 = v.s, c1 = { x: v.cx, y: v.cy };
    animate((t) => {
      s = s0 * (s1 / s0) ** t;
      cx = c0.x + (c1.x - c0.x) * t;
      cy = c0.y + (c1.y - c0.y) * t;
    }, ms);
  }

  // Show exactly this map rectangle (a view from the URL), also after the stage resizes.
  function setView(r) {
    zoomTo(r, { ms: 0, pad: 1 });
    goal = { rect: r };
  }

  function panBy(dx, dy, ms = 0) {
    goal = null;
    const c0 = { x: cx, y: cy };
    animate((t) => { cx = c0.x + (dx / s) * t; cy = c0.y + (dy / s) * t; }, ms);
  }

  // ---- wheel: zoom at the cursor; events within one frame are merged ----
  let wheel = null;
  stage.addEventListener('wheel', (e) => {
    if (!svg) return;
    e.preventDefault();
    stop();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1;
    // ctrl+wheel is how browsers report a trackpad pinch: small deltas, so a stronger factor
    const k = e.ctrlKey ? 0.012 : 0.0018;
    const p = local(e);
    if (!wheel) {
      wheel = { dy: 0, p };
      requestAnimationFrame(() => {
        const { dy, p: at } = wheel;
        wheel = null;
        zoomAt(Math.exp(-Math.max(-300, Math.min(300, dy)) * k), at);
      });
    }
    wheel.dy += e.deltaY * unit;
    wheel.p = p;
  }, { passive: false });

  // ---- pointers: drag to pan (mouse, pen, one finger), two fingers to pinch ----
  const pointers = new Map();
  let drag = null;   // { start: {x,y}, c0, moved }
  let pinch = null;  // { d0, s0, anchor }
  let suppressClick = false;

  const mid = () => { const [a, b] = [...pointers.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  const dist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };

  stage.addEventListener('pointerdown', (e) => {
    if (!svg || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target.closest('a, button, input, .empty')) return;
    stop();
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 1) {
      drag = { start: local(e), c0: { x: cx, y: cy }, moved: false };
    } else if (pointers.size === 2) {
      drag = null;
      const m = mid();
      pinch = { d0: dist(), s0: s, anchor: toMap(m.x, m.y) };
      setPanning(true);
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const m = mid();
      goal = null;
      s = clampScale(pinch.s0 * dist() / pinch.d0);
      cx = pinch.anchor.x - (m.x - W / 2) / s;
      cy = pinch.anchor.y - (m.y - H / 2) / s;
      apply();
    } else if (drag) {
      const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_START) return;
      if (!drag.moved) { drag.moved = true; goal = null; setPanning(true); }
      cx = drag.c0.x - dx / s;
      cy = drag.c0.y - dy / s;
      apply();
    }
  });
  const up = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (drag?.moved || pinch) suppressClick = true;
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1) {
      // the finger left down continues as a pan
      const [p] = pointers.values();
      drag = { start: p, c0: { x: cx, y: cy }, moved: true };
    } else if (!pointers.size) {
      drag = null;
      setPanning(false);
      setTimeout(() => { suppressClick = false; }, 0);
    }
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  // a press that turned into a pan is not a click
  stage.addEventListener('click', (e) => {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
  }, true);
  stage.addEventListener('dblclick', (e) => {
    if (!svg || e.target.closest('a, button, input, .empty')) return;
    e.preventDefault();
    zoomAt(e.shiftKey ? 0.5 : 2, local(e), 240);
  });

  function setPanning(on) { stage.classList.toggle('panning', on); }

  new ResizeObserver(() => {
    const [w, h] = [stage.clientWidth || 1, stage.clientHeight || 1];
    if (w === W && h === H) return;
    W = w; H = h;
    if (goal?.fit) fit();
    else if (goal?.rect) setView(goal.rect);
    else apply();
  }).observe(stage);

  return {
    // A new SVG element and its map rectangle. keep = keep the current view (reruns, reloads).
    setContent(el, box, { keep = false } = {}) {
      svg = el;
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      content = box;
      if (keep) apply(); else fit();
    },
    clear() { svg = null; content = null; },
    fit: () => fit(240),
    zoomIn: () => zoomAt(1.6, undefined, 200),
    zoomOut: () => zoomAt(1 / 1.6, undefined, 200),
    panBy: (dx, dy) => panBy(dx, dy, 160),
    zoomTo,
    // the visible map rectangle
    getView: () => ({ x: cx - W / 2 / s, y: cy - H / 2 / s, w: W / s, h: H / s }),
    setView,
    isPanning: () => pointers.size > 0 && (!!pinch || !!drag?.moved),
    size: () => ({ w: W, h: H }),
  };
}

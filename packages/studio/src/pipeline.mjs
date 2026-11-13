// DOT text + view settings -> { model, svg }, through @linemap/core.
// The first run for a text uses the file as it is (no hidden lines, the file's `through`); its
// positions of unpinned items become `fixed` for every later run of the same text, so hiding a
// line or switching `through` never moves a box. The theme only paints: a change of theme alone
// renders the last model again. Errors come back as results, never thrown.
import { parseFlow, layout, render, positions, paintLines, THEMES } from '@linemap/core';

export function createPipeline({ onResult }) {
  let base = null; // { text, model, fixed } of the first run of the current text
  let last = null; // { key, model } of the last run, for a change of theme alone
  let running = false;
  let pending = null;

  async function runOnce(text, settings) {
    const t0 = performance.now();
    const { hidden, mode, theme } = settings;
    if (base?.text !== text) {
      const model = layout(parseFlow(text));
      base = { text, model, fixed: new Map(positions(model).map(({ id, x, y }) => [id, { x, y }])) };
    }
    const known = new Set(base.model.lines.map((l) => l.id));
    const hiddenLines = new Set([...hidden].filter((id) => known.has(id)));
    const key = JSON.stringify([mode, [...hiddenLines].sort()]);
    let model = base.model;
    if (last?.base === base && last.key === key) model = last.model;
    else if (hiddenLines.size || mode !== 'file') {
      model = layout(parseFlow(text), { hiddenLines, through: { mode }, fixed: base.fixed });
    }
    last = { base, key, model };
    const used = theme ?? model.theme ?? 'light';
    paintLines(base.model.lines, THEMES[used]); // the legend and search show the base model's lines
    return { ok: true, model, base: base.model, theme: used, svg: render(model, { legend: false, theme: used }), ms: performance.now() - t0 };
  }

  // Runs now, or after the run in flight; requests made meanwhile collapse into the latest one
  // (with `meta` flags of the skipped ones kept, e.g. `fresh`).
  async function request(text, settings, meta = {}) {
    if (running) {
      pending = { text, settings, meta: { ...pending?.meta, ...meta, fresh: !!(pending?.meta.fresh || meta.fresh) } };
      return;
    }
    running = true;
    let job = { text, settings, meta };
    while (job) {
      let result;
      try {
        result = await runOnce(job.text, job.settings);
      } catch (err) {
        result = { ok: false, error: err?.message ?? String(err) };
      }
      const next = pending;
      pending = null;
      // a result is only shown when no newer request is waiting
      if (!next) onResult(result, job.meta);
      else next.meta = { ...job.meta, ...next.meta, fresh: !!(job.meta.fresh || next.meta.fresh) };
      job = next;
    }
    running = false;
  }

  return {
    request,
    busy: () => running,
    // export with the legend: a second render of the same laid-out model
    exportSvg: (model, theme) => render(model, { legend: true, theme }),
    positions: (model) => positions(model),
  };
}

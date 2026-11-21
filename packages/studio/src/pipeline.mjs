// DOT text + view settings -> { model, svg }, through @linemap/core.
// The first run for a text and a notes setting uses the file as it is (no hidden lines, the
// file's `through`); its positions of unpinned items become `fixed` for every later run of the
// same text and notes setting, so hiding a line or switching `through` never moves a box. Notes
// off lays the map out without the notes (as `linemap export --notes hide` does), so lines and
// boxes may take their room; each note is then drawn as a badge in its node. The theme only
// paints: a change of theme alone renders the last model again. The legend is an HTML panel, so
// `legendpos` is ignored: nothing keeps clear of it, and the exported SVG puts the legend outside
// the map. An edit (meta.carry) keeps every box where the last map had it: the new text's first run
// gets the last map's positions as `fixed`, so only what the edit moved or added moves.
// Errors come back as results, never thrown; each names its line as "DOT line N" where it can.
import { parseFlow, layout, render, positions, paintLines, THEMES, DEFAULT_THEME } from '@linemap/core';

// the message of an error; the DOT parser's syntax errors carry their place only as a location
export function errorText(err) {
  const at = err?.name === 'DotSyntaxError' ? (err.cause?.location ?? err.location)?.start : null;
  const msg = err?.message ?? String(err);
  return at ? `DOT line ${at.line}, column ${at.column}: ${msg}` : msg;
}

export function createPipeline({ onResult }) {
  let bases = null; // { text, carry, show, hide }: { model, fixed } of the first run of the current text, per notes setting
  let last = null; // { key, model } of the last run, for a change of theme alone
  let running = false;
  let pending = null;

  // The first run of a text, per notes setting (carry: from the last map's positions).
  function baseFor(text, noteMode, carry) {
    if (bases?.text !== text) {
      const prev = carry ? last?.base.model : null;
      bases = { text, carry: prev ? new Map([...prev.items.values()].map((n) => [n.id, { x: n.x, y: n.y }])) : null };
    }
    if (!bases[noteMode]) {
      const model = layout(parseFlow(text), { notes: noteMode, legend: false, fixed: bases.carry ?? undefined });
      bases[noteMode] = { model, fixed: new Map(positions(model).map(({ id, x, y }) => [id, { x, y }])) };
    }
    return bases[noteMode];
  }

  async function runOnce(text, settings, carry) {
    const t0 = performance.now();
    const { hidden, mode, theme, notes } = settings;
    const noteMode = notes ? 'show' : 'hide';
    const base = baseFor(text, noteMode, carry);
    const known = new Set(base.model.lines.map((l) => l.id));
    const hiddenLines = new Set([...hidden].filter((id) => known.has(id)));
    const key = JSON.stringify([mode, [...hiddenLines].sort()]);
    let model = base.model;
    if (last?.base === base && last.key === key) model = last.model;
    else if (hiddenLines.size || mode !== 'file') {
      model = layout(parseFlow(text), { hiddenLines, through: { mode }, fixed: base.fixed, notes: noteMode, legend: false });
    }
    last = { base, key, model };
    const used = theme ?? model.theme ?? DEFAULT_THEME;
    paintLines(base.model.lines, THEMES[used]); // the legend and search show the base model's lines
    return { ok: true, model, base: base.model, theme: used, svg: render(model, { legend: false, theme: used, noteIcons: true }), ms: performance.now() - t0 };
  }

  // Runs now, or after the run in flight; requests made meanwhile collapse into the latest one
  // (with `meta` flags of the skipped ones kept, e.g. `fresh`).
  async function request(text, settings, meta = {}) {
    if (running) {
      pending = { text, settings, meta: { ...pending?.meta, ...meta, fresh: !!(pending?.meta.fresh || meta.fresh), carry: !!(pending?.meta.carry || meta.carry) } };
      return;
    }
    running = true;
    let job = { text, settings, meta };
    while (job) {
      let result;
      try {
        result = await runOnce(job.text, job.settings, !!job.meta.carry);
      } catch (err) {
        result = { ok: false, error: errorText(err) };
      }
      const next = pending;
      pending = null;
      // a result is only shown when no newer request is waiting
      if (!next) onResult(result, job.meta);
      else next.meta = { ...job.meta, ...next.meta, fresh: !!(job.meta.fresh || next.meta.fresh), carry: !!(job.meta.carry || next.meta.carry) };
      job = next;
    }
    running = false;
  }

  return {
    request,
    // Lays out an edited text now (as a run with meta.carry would), so an edit can be refused
    // before it is kept: the error, or null. The run that follows reuses the layout.
    check(text, settings) {
      try { baseFor(text, settings.notes ? 'show' : 'hide', true); return null; } catch (err) { return errorText(err); }
    },
    busy: () => running,
    // export with the legend: a second render of the model on screen, so it shows what the studio
    // shows (hidden lines, through, theme, and notes off as `--notes hide`), but no badges
    exportSvg: (model, theme) => render(model, { legend: true, theme }),
    positions: (model) => positions(model),
  };
}

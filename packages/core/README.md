# @linemap/core

Draw how data flows through a system like a subway map. DOT text in, SVG string out: pinned
boxes stay put, the rest is placed automatically, and the lines are routed orthogonally and
drawn as transit-map bundles. No I/O; runs in Node 22+ and the browser.

[![Web shop](https://raw.githubusercontent.com/mergezalot/linemap/master/examples/webshop.svg)](https://mergezalot.github.io/linemap/)

```js
import { parseFlow, layout, render } from '@linemap/core';

const svg = render(layout(parseFlow(dotText)), { theme: 'dark' });
```

- `parseFlow(text)` reads a linemap DOT file into a model; errors are thrown with one-line messages.
- `layout(model, { hiddenLines, through, fixed, notes, legend })` places, routes and bundles it.
  Call it once per parsed model. `notes: 'hide'` lays the map out as if the notes were not there
  (they move to `model.hiddenNotes`); the default is `'show'`.
- `render(model, { theme, css, legend, noteIcons })` returns the SVG. Themes: `minimal` (default),
  `light`, `dark`, `neon`, `neond`, each also as `-fancy` (shadows, glows, moving arrows; costlier).
  `legend: false` (to both) drops the legend. `noteIcons: true` (for interactive pages such as the
  studio) draws each hidden note as a badge inside its node with the text as its tooltip; the class
  `lm-open` on its `g.note` shows the note beside the badge.
- `positions(model)` gives the computed positions of unpinned nodes, ready to pin with `pos`;
  `legendPosition(model)` the legend's.

The command line is [`@linemap/cli`](https://www.npmjs.com/package/@linemap/cli): `npx @linemap/cli export flow.dot`.
The DOT format, themes and the studio are described in the
[project README](https://github.com/mergezalot/linemap#readme).

Placement and routing use Microsoft's [MSAGL](https://github.com/microsoft/msagl-js) (MIT),
bundled in `vendor/`.

## License

[Mozilla Public License 2.0](https://github.com/mergezalot/linemap/blob/master/LICENSE)

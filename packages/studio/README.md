# @linemap/studio

The [linemap](https://github.com/mergezalot/linemap) studio as one self-contained HTML file: open a
DOT flow, explore it as a transit map, hide and solo lines, switch themes, hide notes behind badges, read and edit the DOT text in a sidebar beside the map (its selection and the map's follow each other), edit the map (move, resize, add and connect boxes, add notes (with bold, italic, underlined, struck-out or coloured text), edit the text of a box, note or container (double-click, F2 or Enter), bend lines, change the lines of an edge, align and distribute several boxes, group boxes into containers, merge, split and ungroup containers), save the SVG. Everything
runs in the browser; the file loads nothing from anywhere else, so it works offline, from `file://`
and inside embeds such as Notion.

**[Try the examples in the studio](https://mergezalot.github.io/linemap/)**.

Most people want the command line, which uses this package:

```sh
npx @linemap/cli export flow.dot -o flow.html        # the studio with the flow baked in
npx @linemap/cli export a.dot b.dot -o flows.html    # several, picked on the start screen
npx @linemap/cli export                              # the empty studio: linemap.html
npx @linemap/cli studio                              # serve the DOT files here, with Watch
```

From code:

```js
import { studioHtml } from '@linemap/studio';

fs.writeFileSync('flow.html', studioHtml([{ name: 'flow.dot', text: fs.readFileSync('flow.dot', 'utf8') }]));
```

- `studioHtml(flows)`: the page with these `{ name, text }` flows baked in; `[]` gives the empty studio.
- `embed(html, flows)`: the same, on the page as a string.
- `serve({ root, page, port })`: a server on 127.0.0.1 with `page()` at `/studio.html` and the
  `.dot`/`.gv` files under `root`. Resolves with the `http.Server`.
- `TEMPLATE`: the URL of the built page, `dist/linemap.html`.

Needs Node 22 or later. No dependencies: the layout engine is inside the page.

## License

[Mozilla Public License 2.0](https://github.com/mergezalot/linemap/blob/master/LICENSE). The page
contains parts of MSAGL (MIT); their license texts are in it.

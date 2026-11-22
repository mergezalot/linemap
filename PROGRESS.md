# Studio edit mode: adorner, panning, notes, containers

Plan and progress log for the serial-implementation skill
(`~/homestead/.claude/skills/serial-implementation/SKILL.md`). Branch: `studio-editor`.
An orchestrator delegates one unit at a time to a subagent, which implements it, updates the docs,
commits, and reports its context usage. A fresh orchestrator resumes from this file alone.

## Ground rules for every unit

- Code lives in `packages/core/src/edit.mjs` (editDot ops), `packages/studio/src/editor.mjs` (edit
  mode), `packages/studio/src/viewport.mjs` (pan/zoom), `packages/studio/src/main.mjs`,
  `index.html`, `style.css`.
- Each unit: tests (`pnpm --filter @linemap/core test`; `pnpm test` from the root builds the studio
  and runs core, studio unit and cli tests; `pnpm test:studio` runs the Playwright smoke test),
  docs (the header comment of `editor.mjs` / `edit.mjs`, `packages/studio/README.md` where users
  see it), one commit in the existing style (`core: …` / `studio: …`, lower case, what it does).
- Run natively with pnpm, no podman. The host has no system fonts, so the UI uses the SVG icons in
  `index.html` (`#i-…`), never emoji.
- Never stage `examples/europe.dot`; it carries the user's own uncommitted change.
- Overlay pieces (handles, adorner, marks) are drawn in map units but keep their size on screen,
  like the handles now (`unit()` in `editor.mjs`).

## Units

### 1. core: unpin, and notes without a position
- New editDot op `{ op: 'unpin', id }`: removes `pos` from every statement of the node or note; a
  statement that set nothing but `pos` goes entirely (as `via` does when unset). No `pos` anywhere
  is a no-op, not an error.
- `addNode` takes `x`, `y` as optional: without them no `pos` is written, so the layout places it.
  Needed for notes, which are unpinned when added.
- Check that a multi-line label survives `quote` (it writes `\n`) and comes back from `parseFlow`
  as real line breaks; fix if not.
- Tests in `packages/core/test/edit.test.mjs`.

### 2. studio: boxes may overlap
- Drop the box-on-box refusal in `blocked()` (moves and resizes): editing is a pain otherwise.
  A box may also overlap a container it is not in; a drag never changes membership (only the
  container actions of unit 9 do; the user decided against drop-into-container as too finicky). Remove `blocked`, `drag.bad`,
  `.lm-edit-bad` and the toast if nothing else is left of them.
- Update the header comment ("A box may not land on another box…").

### 3. studio: which button pans
- Middle mouse button pans, in view and edit mode, anywhere on the map (also over boxes).
- View mode: left drag pans, as now.
- Edit mode: left drag on the background draws the selection rectangle (no Shift needed); with
  Shift it adds to the selection. Today's Shift+drag becomes plain drag.
- Space held + left drag pans in both modes (trackpads have no middle button). The cursor shows
  grab/grabbing while Space is held. Space must not trigger while typing in an input or dialog.
- Touch: one finger on the background still pans in edit mode; two fingers pinch.
- Wheel zooms, unchanged.

### 3b. studio: panning revised (user feedback after unit 3)
Space+drag did not work with a touchpad (on Linux, libinput's disable-while-typing most likely
switches the touchpad off while Space is held), and the user prefers left drag for panning.
- Left drag on the background pans, in view and edit mode (as before unit 3).
- Edit mode: Shift+drag on the background draws the selection rectangle (adds to the selection;
  Shift+click still adds or removes one box).
- Middle button pans everywhere, over boxes too (unchanged from unit 3; keep the Linux paste
  guard).
- Remove Space+drag panning entirely (keys, `space-pan` class, cursors, focus special cases).
- Wheel: a plain wheel / two-finger touchpad scroll pans (deltaX and deltaY); Ctrl+wheel (also
  how browsers report a touchpad pinch) zooms at the cursor. Shift+wheel pans horizontally for
  mice without a horizontal wheel.
- Update hint text in main.mjs, the help table in index.html, the editor/viewport header
  comments, and the smoke checks.

### 4. studio: the adorner toolbar
- A small floating toolbar above the selection (below it when there is no room on screen), with
  icon buttons, kept the same size on screen. It moves with the box while dragging and hides
  during the drag if it gets in the way.
- One node: Delete · Pin/Unpin · Resize. A note: Delete · Pin/Unpin · Resize.
  - Pin/Unpin is one toggle: it shows the current state (pin icon when pinned; a new `#i-unpin`,
    a pin with a slash, to unpin). Pinning writes `pos` where the box is now; unpinning uses the
    `unpin` op of unit 1.
  - Resize toggles the size mode; clicking the selection again keeps doing the same.
  - The connect handle (the `+` beside the box) stays as it is.
- An edge (bundle or a single line): Delete · Lines….
- The edit bar keeps Delete and Lines… (where keyboard users look) and gains **Unpin all** next
  to Pin all.
- Buttons have titles with their shortcut (Del, …).

### 5. studio: pinned boxes show a pin mark
- In edit mode every pinned node and note carries a small pin mark at its top-right corner, part
  of the overlay (not the exported SVG). Clicking the mark unpins the box (same as the adorner).

### 6. studio: add a note
- Adorner on one node (not a note, not a container): Add note.
- Opens a multi-line text dialog (textarea; Ctrl+Enter or the button confirms, Escape cancels).
  The new note is `shape=note`, unpinned, attached to the node by an edge without lines; its id
  from `newId` (prefix `note_`). Applied as one edit, so one undo removes it. The new note ends up
  selected.
- Plain text only in this unit; rich text is unit 10.

### 7. studio: several boxes: adorner and resize
- The adorner sits above the bounding box of the selection: Delete · Pin/Unpin all · Resize
  (and the container actions of unit 9).
  Pin/Unpin all: unpin when every selected box is pinned, else pin all.
- Resize: clicking a box of the selection again (no Shift), or the Resize button, puts the whole
  selection in size mode; the handles are on the box clicked (or the first one), the others are
  outlined. While dragging, every selected box takes the dragged box's width and height at once,
  each keeping its own centre; the dragged one keeps its opposite side fixed, as now. One edit,
  one undo.
- A click on a box of the selection while in size mode goes back to moving (as for one box).

### 8. core: container ops
Membership is the deepest cluster a node is mentioned in (`dot.mjs`), so moving a node means
moving its mentions: its node statements and edge statements inside clusters it leaves (the same
way `moveEdge` puts an edge to the top of the graph when its ends no longer fit).
- `{ op: 'group', id, label, ids, parent }`: a new `subgraph cluster_<id>` in `parent` (a cluster
  id, or none for the top) holding `ids`.
- `{ op: 'moveTo', ids, group }`: the nodes into container `group` (none: the top of the graph).
- `{ op: 'removeGroup', id }`: the cluster goes; its members (and nested clusters) move to its
  parent.
- A note moves with the node it is attached to.
- Tests for each, including nodes mentioned only in edges inside a cluster, nested clusters and
  a comment kept in place.

### 9. studio: container actions on several boxes
In the adorner of a multi-selection (and the edit bar), each shown only when it applies:
- **Group**: a new container around the selected boxes, inside the innermost container they all
  share; asks for its label.
- **Merge**: shown when the boxes come from two or more containers: those containers become one
  (the first one clicked keeps its id and label; the others' members move into it and the emptied
  containers go).
- **Split**: shown when all boxes come from one container and are not all of it: they leave it
  for a new container beside it (same parent); asks for its label.
- **Ungroup**: shown when the selection is exactly a container's members (a click on a container
  selects them): the container goes, its members stay where they are.
Each is one edit and one undo; the new or kept container's members stay selected.
- No drag-into-container: dropping a box on a container never changes its membership (user
  decision: too finicky). Membership changes only through the actions above.

### 10. notes: rich text as DOT HTML-like labels
- Notes may have an HTML-like label (`label=<…>`), as DOT has natively; no dependency. Supported
  subset: `<b>`, `<i>`, `<u>`, `<s>`, `<br/>`, `<font color="…">`; anything else (tables,
  images, unknown tags) is a parse error naming the tag. Rendered into SVG `<tspan>`s with the
  existing text-width estimate; text is escaped, never injected as markup.
- The note dialog: text containing one of the supported tags is written as `label=<…>` (line
  breaks as `<br/>`), otherwise as a quoted string, as now.
- Markdown could replace this later.

### 11. studio: align and distribute several boxes
- In the adorner of a multi-selection (and the edit bar): align left, centre, right, top, middle,
  bottom (to the selection's bounding box), and distribute evenly, horizontally or vertically
  (equal gaps between boxes, the outermost two stay). Shown as one Align button opening a small
  menu, to keep the adorner short.
- Every moved box is pinned at its new place (`pos`); one edit, one undo; snapping as for moves.

### 12. studio: the DOT source as an editable sidebar (user request 2026-11-21)
- A toolbar toggle (and a key) opens a sidebar beside the map with the live DOT text of the
  current flow, in view and edit mode. Resizable by dragging its edge; open/closed and width
  remembered (state.mjs / localStorage as other settings). On narrow screens it overlays the map.
- No dependency: a `<textarea>` (monospace, no spellcheck, Tab inserts spaces) with a line-number
  gutter kept in sync with scrolling. Syntax colouring is optional, only if cheap (overlay).
- Text -> map: typing re-renders after a short pause (~300 ms) through `source.edit`, so dirty
  state, save/download and watch behave as for map edits. A parse error keeps the last good map,
  shows the message in the sidebar and marks the line (errors carry "DOT line N").
  Undo/redo of the editor stays coherent: one text pause = one undo step; Ctrl+Z inside the
  textarea is the textarea's own.
- Map -> text: every map edit (and undo, reload, watch, loading another flow) updates the text,
  keeping the caret and scroll where they were as far as possible; never while the user is in
  the middle of typing (pending debounce wins).
- Keys typed in the textarea never trigger studio shortcuts.
- Docs: help table, README, main.mjs/editor header comments. Smoke checks (not runnable now).

### 12a. studio: cursors tell panning from edge selection (user feedback 2026-11-21)
- "pan and edge-selection have the same mouse pointer, that's confusing." Today (style.css):
  `#stage` grab (pan), edit mode `g.edge` crosshair, `.lm-edit-handle` grab, view-mode lines
  pointer. Find where they coincide (likely the handles/bends of a selected edge, or edge hit
  areas not under `g.edge`) and make it unambiguous: background = grab (pan); anything clickable
  to select (edges, lines) = pointer; things that drag-move (boxes, handles, bends) = move or a
  resize cursor; grabbing only while a pan runs. Check every mode (view, edit, add, size).

### 13. studio: source and map selection follow each other
- Selecting a box, container or edge on the map highlights (and scrolls to) its statements in the
  sidebar; moving the caret onto a statement selects that item on the map (edit mode) or focuses
  it (view mode). Needs statement line ranges from core's DOT reader if it has none yet.

### 14. core: edit text, delete a container with its contents
- `{ op: 'label', id, text }` for a node, note or container: writes `label` on its declaration
  (quoted; for notes `label=<…>` when the text has a supported rich tag, as `addNode` does);
  removing the label when the text equals the id is fine but optional. Multi-line via `\n`.
- `{ op: 'removeGroupDeep', id }` (or an option on `removeGroup`): the container, nested
  containers, every member node, their notes and every edge touching any of them go.
- Tests in `packages/core/test`.

### 15. studio: edit the text of a node, note or container (user decision: a dialog)
- Double-click, F2 or Enter on the one selected item, or an "Edit text" button in its adorner,
  opens the multi-line text dialog (the note dialog, prefilled; heading says what is edited).
  Notes keep their rich tags (prefill with the HTML-like source). One edit, one undo.
- Works for a selected container too (rename). Closes the idea "rename a container".

### 16. studio: containers can be selected themselves (user request 2026-11-21)
- A click on a container selects the container itself (new selection kind, outlined as a box);
  a second click on it selects its members (today's behaviour), a third goes back to the
  container. Shift+click keeps adding members as today.
- Container adorner: Delete (the container only, members stay: `removeGroup`, like Ungroup) ·
  Delete with contents (confirm dialog, unit 14 op) · Edit text (unit 15) · connect handle `+`
  (an edge from the container box to a node or container; DOT allows that already) .
- Dragging a selected container moves all its members (and nested containers' members, and
  notes) by the drag, pins them all at their new places; one edit, one undo; snapping as moves.
- Del on a selected container = delete container only (members stay). Escape clears.
- Update the multi-selection Ungroup rule (selection exactly a container's members) so it still
  works on the second click.

## Ideas not yet planned
- (Rename a container: now unit 15.)

## Progress
- Done:
  - plan (fdea7b4)
  - unit 1 (43facbd): `unpin` op; `addNode` without x/y; `quote` normalises \r\n. Notes: a
    pos-only statement that is a node's only mention (or only mention in its container) stays as a
    bare id; `unpin` of an unknown id throws. Labels are trimmed per line when parsed (unit 6:
    leading spaces in notes are lost). Unpinned items have `pinned: false` in the model.
  - unit 2 (badc4f5): no overlap refusal; `blocked`/`groupBoxes`/`lm-edit-bad` removed . Layout accepts overlapping pinned
    boxes. Smoke test updated; chromium installed later (user approved), smoke run asked for with unit 4.
  - unit 3 (781e4ea): middle button / Space+drag pan (capture listener on #stage in
    viewport.mjs); edit-mode background drag selects; touch still pans. Extras: Space on a
    focused button keeps its normal meaning unless the pointer is over the map; a middle press
    is always suppressed (no paste/autoscroll/auxclick). Smoke checks updated, not run.
    Known nit: in add-node mode the copy cursor wins over the Space grab cursor.
  - unit 2 fix (5b9a71a): smoke drops a box beside the other's centre (see 4a).
  - unit 3 fix (d101073): Linux middle-release pasted the primary selection, and the studio
    opened pasted DOT; viewport.mjs drops a `paste` within 500 ms of a middle release over the map.
  - unit 4 (25dcea5): adorner as SVG overlay (`tools()` returns `{ at, list }`, actions in
    `tool(act)` in editor.mjs; add buttons there). Node/note: Delete, Pin/Unpin, Resize; edge:
    Delete, Lines…. Icons `#i-unpin`, `#i-resize`. Keys P (pin toggle), L (lines). Edit bar: Unpin
    all (`editor.unpinAll()`). Presses on adorner buttons act on release and swallow the click.
- Smoke test runs (264 checks pass) with system libs and a font unpacked in the scratchpad, no
  root needed:
  `D=/tmp/claude-1000/-home-player2-workspaces-mad-flowgraph-flowgraph/722b5987-640b-47b3-b966-932ef34b3442/scratchpad/libs; FONTCONFIG_FILE=$D/fonts.conf LD_LIBRARY_PATH=$D/root/usr/lib/x86_64-linux-gnu pnpm test:studio`
  The scratchpad may be cleared; the lasting fix is `sudo pnpm exec playwright install-deps` plus
  a font package (user's call).
  - unit 4a (392477c, core): coincident connection ends are not routed (path = that point);
    route.mjs keeps paths at >= 2 points; a diamond is routed as its bounding box (MSAGL
    convex-hull bug with overlapping non-rectangles). Smoke drop back on the exact centre.
  - unit 5 (36d860f): `pinMarks()` in editor.mjs; press on a mark = move drag with `unpin: id`,
    a click unpins; shared `swallow()` helper. Unit 7 must hide marks for every box in multi
    size mode.
  - unit 3b (cdbd241): left drag pans (both modes), Shift+drag selects, middle pans, Space gone,
    wheel pans, Ctrl/Cmd+wheel zooms (≤×1.65 per frame), Shift+wheel pans sideways.
  - unit 6 (cabca89): Add note on a node's adorner (`#i-note-add`, `addNote()`, `askNote` in
    actions.mjs, `#note-dialog`); note goes into the node's container, edge `node -> note` at
    top level; id `note_<node>`. No key (N toggles notes). Examples already contain HTML-like
    note labels (unit 10 must keep them working).
  - unit 7 (ec1e543): multi adorner (Delete · Pin/Unpin all · Resize; P works on several);
    size mode `{ kind: 'nodes', ids, mode: 'size', main }`; all resized boxes pinned (others at
    their centre). A click on a selected box no longer shrinks the selection. Undo clears the
    selection (`step()`); container actions go in the `nodes` branch of `tools()` / `tool(act)`;
    `membersOf(group)` exists. A full smoke run takes 3–5 min.
  - unit 8 (925efd6, core): ops `moveTo {ids, group}`, `addGroup {id, label, parent}`,
    `group {id, label, ids, parent}` (id gets `cluster_` prefix), `removeGroup {id}` (drops
    edges to its box; keeps a plain `subgraph {}` if it set defaults). Ops may return `{ ops }`.
    Fixed: `rewriteEdges` left a container id as a bare node. Limits: a comment above a moved
    declaration stays behind; `moveTo` doesn't validate (studio shows parseFlow's error).
    For unit 9: Merge = `moveTo` members into the kept container (+ `moveEdge` edges to the
    others' boxes onto it) then `removeGroup` each, one ops array; Split = `group` with the old
    container's parent; Ungroup = `removeGroup`. Unit 10: `addGroup` quotes labels.
- Subagents must not use `git stash` or stage examples/ (the user edits them live in `pnpm studio`) (subagent #2 once stashed and popped the whole tree to run
  a check; nothing was lost).
  - unit 9 (07a2dd4): `containerPlan()`/`containerTools()`/`containerActs` in editor.mjs; edit bar
    `#edit-group/merge/split/ungroup`; `askLabel` in actions.mjs (`#label-dialog` gained a hint);
    `newId(label, prefix)`; `sel.ids` keeps click order; a container click sets `sel.group`;
    `selectAfter(ids, group)` restores selection after an edit. Limits: actions need >= 2 boxes;
    Merge needs every box in a container and flattens nested containers; Ungroup drops edges to the
    container's box. Smoke section "edit mode, container actions" added but NOT run (scratchpad libs
    gone, chromium lacks libatk); verified with a throwaway Node harness. Core test for
    examples/platform.dot fails only because of the user's uncommitted edit to it.
  - unit 10 (5bbb13e, core): `packages/core/src/rich.mjs` (`parseRich` -> rows of runs
    `{text,b,i,u,s,color}`, `toHtml`); `readDot` keeps plain text in every attribute and the rows
    under the symbol `RICH_LABEL`; notes get `item.rich`, drawn as nested tspans (bold 1.08x
    wider). Unsupported tags are errors for every HTML-like attribute; only notes draw rich text.
    Font colour hex only. `addNode` with shape note writes `label=<…>` when the text has a
    supported tag. No op to edit an existing note's text. Smoke check added, not run.
    Tests: core 79/79, studio unit 6/6, cli 32/32.
  - unit 11 (d1fd975): `packages/studio/src/arrange.mjs` (`arrange(boxes, how, grid)`, unit
    tests in `packages/studio/test/arrange.test.mjs`); Align button in the multi adorner and
    `#edit-align` open one HTML popover `#align-menu` (keyboard accessible). Every selected box is
    pinned (not only moved ones); distribute needs >= 3 boxes and rounds to whole units (no grid).
    Smoke checks added, not run. Tests: core 79/79, studio unit 11/11, cli 32/32.
  - unit 12 (98de250): `packages/studio/src/sourcepanel.mjs` (API `setText(text,{fresh,title})`,
    `toggle`, `setOpen`, `isOpen`, `flush`, `pending()`, `goToLine(n)`, `textarea`); Source button
    + S key; width/open in localStorage `linemap:source`; overlays at <= 860px. Commits via
    `editor.commitText(text)` after 300 ms or blur (one undo); undrawable text is never committed,
    error shown with a "Line N" button and a red band (LH 18, PAD 6). `pipeline.mjs errorText(err)`
    adds "DOT line N, column C:". Limits: a pending text wins over a newer watched file; map
    changes clear the textarea's own undo history. For unit 13: core's DOT reader keeps `line`
    only for edges; node/attr/subgraph statements need line ranges.
  - unit 12a (1b4d91e): grab only on the background, grabbing while panning (all modes); edges
    pointer; ends/bends move; connect `+` crosshair; size handles their arrows; drags set
    `--drag-cursor` via `dragCursor()` in editor.mjs. View mode: a click on a bundle's rim pins
    its lines. Container bodies are still grab (pan) in edit mode: unit 16 must give them a
    pointer/move cursor once they are selectable. Smoke cursor checks added, not run.
  - unit 13 (3602808 core, a97159b studio): `statementsOf(text)` / `readDot().statements`
    (kinds node, edge {pairs, ids}, group = whole block, line; offsets + line/endLine).
    `sourcepanel.mark(ranges,{scroll})`, `onCaret(offset,text)`; `editor.select(t)`; main.mjs
    "source <-> map" block (`caretPick`, `caretKey` guard feedback). Limits: attribute statements
    not recorded; caret column ignored in edge chains; a one-box container selects as a node
    (unit 16 changes container selection). Smoke checks added, not run. Core 82/82.
  - unit 14 (d4e3f7c, core): `{op:'label', id, text}` (node, note — rich via toHtml when it has
    a supported tag —, container; replaces the last setting, drops earlier ones);
    `{op:'removeGroup', id, deep:true}` removes blocks, members (DOT membership: a node named only
    in an edge inside the cluster counts), their notes and all touching edges; `labelSource(text,
    id)` reads a label back for prefilling (rich: source with `<br/>` -> \n). Limits: a stray `; `
    can stay on a line after removing one of several statements (existing `replaceStmt`).
    Core 89/89.
  - unit 15 (07047ef): Edit text via adorner `text` (`#i-text-edit`), edit bar `#edit-text`, F2/
    Enter, double-click on a box/note or a container title; `askNote(dialog, title, {heading, ok,
    placeholder, value, rich})`; `editText(target {kind node|note|group, id})`, `textTarget()`,
    `exactly(g, ids)`. Limits: blank text cancels (a label can't be cleared); container text only
    after a container click (`sel.group`); folded notes not editable. Smoke checks added, not run.
- Resumed 2026-11-21 (new orchestrator session). Subagent #5 (ae328f70c4dc31f1d) did units 9 and
  10 and ended at ~185k tokens; unit 11 goes to a fresh subagent #6 (a0ed38398bace1fbc).
- examples/platform.dot: the user's uncommitted change (28 lines) vanished from the working tree
  at 16:12 during unit 10; the subagent's transcript shows no command touching it. Asked the user.
- Open for the user: the smoke test can't run until the Playwright system deps and a font are
  installed (`sudo pnpm exec playwright install-deps` + a font package), or the libs are unpacked
  into a scratchpad again.
- Units 1–12 done. Plan grew at the user's request: 12a, 13, 14, 15, 16 (decisions recorded in
  the units). Subagent #6 (a0ed38398bace1fbc) did 11 and 12 (~140k+); subagent #7 (aa14b096d53dcd99b) did
  12a and 13 (~115k+); subagent #8 (a0e5488a4a8d38267) did
  14 and 15 (~135k+); unit 16 was started by subagent #9
  (a3703b03a863d2ee9), which stopped when the session ended, unfinished.
- Paused 2026-11-22 at the user's request. Unit 16 is partly done and NOT committed: editor.mjs
  in the working tree (also saved as .git/unit16-wip.patch) has the `group` selection kind,
  `groupLoad`, `groupBox`, `removeDeep` (needs an `askConfirm` dialog not yet wired in main.mjs),
  Del on a container, header comment. Missing: click cycling, container adorner, drag-move,
  connect from a container, cursors, source sync, main.mjs/index.html/README/smoke. Resume
  subagent #9 or give a fresh one this note plus unit 16.
- Next: unit 16.

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

## Ideas not yet planned
- Rename a container from the adorner when the selection is exactly its members.

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
- Resumed 2026-11-21 (new orchestrator session). Subagent #5 (ae328f70c4dc31f1d) did units 9 and
  10 and ended at ~185k tokens; unit 11 goes to a fresh subagent #6 (a0ed38398bace1fbc).
- examples/platform.dot: the user's uncommitted change (28 lines) vanished from the working tree
  at 16:12 during unit 10; the subagent's transcript shows no command touching it. Asked the user.
- Open for the user: the smoke test can't run until the Playwright system deps and a font are
  installed (`sudo pnpm exec playwright install-deps` + a font package), or the libs are unpacked
  into a scratchpad again.
- All units done (2026-11-21). Subagent #6 (a0ed38398bace1fbc, ~75k) finished unit 11.

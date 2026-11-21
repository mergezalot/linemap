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
  A box may also overlap a container it is not in; a plain drag never changes membership (Ctrl
  while dropping moves the box into the container, unit 9). Remove `blocked`, `drag.bad`,
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
- **Drag into a container**: dropping boxes with Ctrl (Cmd on macOS) held moves them into the
  innermost container under the pointer, or to the top of the graph over the background
  (`moveTo`, together with their new `pos`, as one edit). While Ctrl is held during a drag, that
  container is highlighted.

### 10. notes: rich text as DOT HTML-like labels
- Notes may have an HTML-like label (`label=<…>`), as DOT has natively; no dependency. Supported
  subset: `<b>`, `<i>`, `<u>`, `<s>`, `<br/>`, `<font color="…">`; anything else (tables,
  images, unknown tags) is a parse error naming the tag. Rendered into SVG `<tspan>`s with the
  existing text-width estimate; text is escaped, never injected as markup.
- The note dialog: text containing one of the supported tags is written as `label=<…>` (line
  breaks as `<br/>`), otherwise as a quoted string, as now.
- Markdown could replace this later.

## Ideas not yet planned
- Align (left, centre, right, top, middle, bottom) and distribute evenly, for several boxes.
- Rename a container from the adorner when the selection is exactly its members.

## Open questions for the user
- Align/distribute: add as a unit?

## Progress
- Done: none.
- In flight: none.
- Next: unit 1.

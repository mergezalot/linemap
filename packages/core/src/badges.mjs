// Spots for note badges: render's `noteIcons` draws each note that layout left out
// (`notes: 'hide'`) as a small icon on what the note belongs to. The spot is fixed, not laid out:
// the badge is drawn over whatever is there (half-transparent, see theme.mjs) and nothing in
// placement or routing knows about it.
//   a box (and a cylinder, queue, through box): inside its top right corner
//   a diamond: on the middle of its upper right side
//   a person: on the right of its chest
//   no node: inside the top right corner of its container, or of the map

export const BADGE = 22;  // the badge's width and height
const INSET = 7;          // between the badge and the corner it sits in

// note: a hidden note; model: laid out; groups: render's container rectangles; map: the
// drawing's extent. Returns the badge's centre.
export function badgeAt(note, model, groups, map) {
  const n = note.attach ? model.items.get(note.attach) : null;
  if (n?.shape === 'diamond') return { x: n.x + n.w / 4, y: n.y - n.h / 4 };
  if (n?.shape === 'person') return { x: n.x + n.w * 0.2, y: n.y + n.h * 0.25 };
  const r = n ? { x1: n.x + n.w / 2, y0: n.y - n.h / 2 } : groups.get(note.group) ?? map;
  return { x: r.x1 - INSET - BADGE / 2, y: r.y0 + INSET + BADGE / 2 };
}

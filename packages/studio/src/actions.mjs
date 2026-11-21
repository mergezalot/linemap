// One-shot actions: download the SVG, copy positions, small dialogs.

export function download(name, text, type = 'image/svg+xml') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// `positions(model)` as the CLI prints it with --positions, ready to paste into the DOT file.
export const positionsText = (list) => list.map(({ id, x, y }) => `${/^[A-Za-z_][\w]*$/.test(id) ? id : JSON.stringify(id)} [pos="${x},${y}"]`).join('\n');

// Clipboard first; where that is not allowed (file://, permissions), show the text in a dialog.
export async function copyOrShow(text, dialog) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    showText(dialog, text);
    return false;
  }
}

function showText(dialog, text) {
  const ta = dialog.querySelector('textarea');
  ta.value = text;
  dialog.showModal();
  ta.focus();
  ta.select();
}

// Paste dialog: resolves with the text, or null when cancelled.
export function askText(dialog) {
  const ta = dialog.querySelector('textarea');
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' && ta.value.trim() ? ta.value : null), { once: true });
    dialog.returnValue = '';
    dialog.showModal();
    ta.focus();
    ta.select();
  });
}

export function toaster(el) {
  let timer = 0;
  return (msg) => {
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => { el.hidden = true; }, 1800);
  };
}

// New node dialog: resolves with the label typed, or null. Enter adds.
export function askLabel(dialog) {
  const input = dialog.querySelector('input');
  return new Promise((resolve) => {
    const enter = (e) => { if (e.key === 'Enter') { e.preventDefault(); dialog.close('ok'); } };
    input.addEventListener('keydown', enter);
    dialog.addEventListener('close', () => {
      input.removeEventListener('keydown', enter);
      resolve(dialog.returnValue === 'ok' && input.value.trim() ? input.value.trim() : null);
    }, { once: true });
    dialog.returnValue = '';
    input.value = '';
    dialog.showModal();
    input.focus();
  });
}

// New note dialog: resolves with the text typed (several lines; trailing blanks dropped), or
// null. title: what the note is for. Ctrl+Enter (⌘+Enter) adds, Escape cancels.
export function askNote(dialog, title) {
  const ta = dialog.querySelector('textarea');
  dialog.querySelector('.hint').textContent = title;
  return new Promise((resolve) => {
    const enter = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); dialog.close('ok'); } };
    ta.addEventListener('keydown', enter);
    dialog.addEventListener('close', () => {
      ta.removeEventListener('keydown', enter);
      const text = ta.value.replace(/\r\n?/g, '\n').replace(/\s+$/, '').replace(/^(\s*\n)+/, '');
      resolve(dialog.returnValue === 'ok' && text.trim() ? text : null);
    }, { once: true });
    dialog.returnValue = '';
    ta.value = '';
    dialog.showModal();
    ta.focus();
  });
}

// Which lines an edge carries: a checkbox per line, `checked` ticked. Resolves with the ids
// ticked, or null. heading, ok: the dialog's title and button (else those for a new edge).
export function askLines(dialog, lines, checked, title, { heading = 'Lines on the new edge', ok = 'Connect' } = {}) {
  const list = dialog.querySelector('.lines');
  dialog.querySelector('.hint').textContent = title;
  dialog.querySelector('h2').textContent = heading;
  dialog.querySelector('button[value="ok"]').textContent = ok;
  list.replaceChildren(...lines.map((l) => {
    const row = document.createElement('label');
    row.className = 'line-row';
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', value: l.id, checked: checked.has(l.id) });
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = l.color;
    const name = document.createElement('span');
    name.textContent = l.label ?? l.id;
    row.append(box, sw, name);
    return row;
  }));
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok' ? [...list.querySelectorAll('input:checked')].map((b) => b.value) : null);
    }, { once: true });
    dialog.returnValue = '';
    dialog.showModal();
    (list.querySelector('input:checked') ?? list.querySelector('input'))?.focus();
  });
}

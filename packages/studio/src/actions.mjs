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

// HTML-like labels (`label=<…>`), the small part of Graphviz's that a note can show: <b>, <i>,
// <u>, <s>, <br/> and <font color="#hex"> (other font attributes are ignored). Any other tag is an
// error that names it; so is a tag closed in the wrong order or left open. Whitespace collapses
// to one space, entities (&lt; &gt; &amp; &quot; &apos; &nbsp; &#n; &#xh;) are decoded, and
// every row is trimmed, as in a quoted label. The text is only ever data: render escapes it.
//   parseRich(html)  rows: [[{ text, b, i, u, s, color }, ...], ...] (the html without its <>)
//   plainOf(rows)    the text alone, rows joined by \n
//   isStyled(rows)   whether any run has a style (else the label draws as plain text)
//   hasRichTags(s)   whether text typed by a person uses one of the supported tags
//   toHtml(s)        such text as the inside of `<…>`: the supported tags kept (left-open ones
//                    closed, stray closers written as text), any other < > & escaped, line
//                    breaks as <br/>

// The symbol under which readDot keeps the rows of an HTML-like `label` beside its plain text:
// attrs[RICH_LABEL] = { text, rows }, valid only while attrs.label === text.
export const RICH_LABEL = Symbol('rich label');

const STYLES = ['b', 'i', 'u', 's'];
const KNOWN = 'b, i, u, s, br, font color';
const TAG = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[^<>]*?)?)\s*(\/?)>|<[!?][^>]*>/g;
const NAMED = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  }
  return NAMED[e.toLowerCase()] ?? m;
});
// a font colour: #rgb or #rrggbb, as every colour in a flow
const colorOf = (v) => {
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v.toLowerCase();
  throw new Error(`HTML-like label: font color must be hex like #1565c0, got "${v}"`);
};

export function parseRich(html) {
  const s = String(html).replace(/\s+/g, ' ');
  const rows = [[]];
  const stack = []; // open tags: { name, style }
  const style = () => Object.assign({}, ...stack.map((t) => t.style));
  const put = (text) => {
    if (!text) return;
    const run = { text: decode(text), ...style() };
    const row = rows.at(-1), last = row.at(-1);
    if (last && same(last, run)) last.text += run.text;
    else row.push(run);
  };
  let at = 0;
  for (const m of s.matchAll(TAG)) {
    put(s.slice(at, m.index));
    at = m.index + m[0].length;
    const [all, close, rawName, attrs, self] = m;
    if (!rawName) throw new Error(`HTML-like label: ${all.slice(0, 12)} is not supported (known: ${KNOWN})`);
    const name = rawName.toLowerCase();
    if (name === 'br') {
      if (close) throw new Error('HTML-like label: </br> is not a tag; a line break is <br/>');
      rows.push([]);
      continue;
    }
    if (!STYLES.includes(name) && name !== 'font') throw new Error(`HTML-like label: <${rawName}> is not supported (known: ${KNOWN})`);
    if (close) {
      const top = stack.pop();
      if (!top) throw new Error(`HTML-like label: </${rawName}> closes nothing`);
      if (top.name !== name) throw new Error(`HTML-like label: </${rawName}> closes <${top.name}>`);
      continue;
    }
    if (self) continue; // <b/>: nothing in it
    if (name === 'font') {
      const c = /\bcolor\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/i.exec(attrs);
      stack.push({ name, style: c ? { color: colorOf((c[1] ?? c[2] ?? c[3]).trim()) } : {} });
    } else {
      stack.push({ name, style: { [name]: true } });
    }
  }
  put(s.slice(at));
  if (stack.length) throw new Error(`HTML-like label: <${stack.at(-1).name}> is not closed`);
  // trim each row, drop runs left empty, and blank rows at the start and the end
  for (const row of rows) {
    if (row.length) row[0].text = row[0].text.replace(/^ +/, '');
    if (row.length) row.at(-1).text = row.at(-1).text.replace(/ +$/, '');
    for (let i = row.length - 1; i >= 0; i--) if (!row[i].text) row.splice(i, 1);
  }
  while (rows.length > 1 && !rows[0].length) rows.shift();
  while (rows.length > 1 && !rows.at(-1).length) rows.pop();
  return rows;
}
const same = (a, b) => STYLES.every((k) => !a[k] === !b[k]) && a.color === b.color;

export const plainOf = (rows) => rows.map((r) => r.map((t) => t.text).join('')).join('\n');
export const isStyled = (rows) => rows.some((r) => r.some((t) => STYLES.some((k) => t[k]) || t.color));

const SUPPORTED = /<\/?(?:b|i|u|s|font)\b[^<>]*>|<br\s*\/?>/gi;
export const hasRichTags = (s) => new RegExp(SUPPORTED.source, 'i').test(String(s));

export function toHtml(text) {
  const s = String(text).replace(/\r\n?/g, '\n');
  const esc = (t) => t.replace(/&(?!(#x[0-9a-f]+|#\d+|[a-z]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');
  const out = [], stack = [];
  let at = 0;
  for (const m of s.matchAll(SUPPORTED)) {
    out.push(esc(s.slice(at, m.index)));
    at = m.index + m[0].length;
    const tag = m[0];
    const name = /^<\/?\s*([a-z]+)/i.exec(tag)[1].toLowerCase();
    if (name === 'br') { out.push('<br/>'); continue; }
    if (tag[1] === '/') {
      // a closer: closes up to its tag if that is open, else it is text
      const i = stack.lastIndexOf(name);
      if (i < 0) { out.push(esc(tag)); continue; }
      while (stack.length > i) out.push(`</${stack.pop()}>`);
      continue;
    }
    if (/\/\s*>$/.test(tag)) continue;
    stack.push(name);
    out.push(tag.replace(/^<\s*([a-z]+)/i, (_, n) => `<${n.toLowerCase()}`));
  }
  out.push(esc(s.slice(at)));
  while (stack.length) out.push(`</${stack.pop()}>`);
  const html = out.join('');
  parseRich(html); // a font colour that is no colour
  return html;
}

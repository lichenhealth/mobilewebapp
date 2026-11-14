/** Rich text for Drive Docs (founder 2026-11-14: "re-create google docs").
 *  The doc's formatting is stored as HTML in chat_docs.data.html and ALWAYS
 *  passes this allowlist on the way in and out — a doc is the member's own
 *  markup, but a pasted web page is a stranger's, and nothing executable or
 *  styled beyond these few properties survives. body keeps the plain text
 *  (search, the brain, old clients). */

const TAGS = new Set(['P', 'BR', 'H1', 'H2', 'H3', 'H4', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'A', 'UL', 'OL', 'LI',
  'BLOCKQUOTE', 'HR', 'SPAN', 'DIV', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'CODE', 'PRE', 'SUB', 'SUP', 'FONT', 'MARK', 'IMG']);
/** An image is kept only as a reference into Lichen's own private storage
 *  (see officeMedia.ts) — its signed src is re-minted on every open, and a
 *  pasted web image (a stranger's hotlink) never survives. */
const IMG_REF = /^(drive|chat-media)\/[\w\-./]+$/;
const STYLE_OK = new Set(['color', 'background-color', 'text-align', 'text-decoration', 'font-weight', 'font-style', 'margin-left', 'font-size']);

export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return '';
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (!TAGS.has(child.tagName)) {
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'TITLE', 'HEAD'].includes(child.tagName)) { child.remove(); continue; }
        // Unknown wrappers keep their words.
        walk(child);
        child.replaceWith(...child.childNodes);
        continue;
      }
      if (child.tagName === 'IMG') {
        const ref = child.getAttribute('data-store') ?? '';
        if (!IMG_REF.test(ref) || ref.includes('..')) { child.remove(); continue; }
        const w = /width:\s*(\d{1,3})%/.exec(child.getAttribute('style') ?? '')?.[1];
        const alt = child.getAttribute('alt') ?? '';
        for (const a of [...child.attributes]) child.removeAttribute(a.name);
        child.setAttribute('data-store', ref);
        if (alt) child.setAttribute('alt', alt.slice(0, 200));
        if (w) child.setAttribute('style', `width: ${Math.min(100, Math.max(10, +w))}%`);
        continue;
      }
      for (const attr of [...child.attributes]) {
        const n = attr.name.toLowerCase();
        if (n === 'href' && child.tagName === 'A') {
          if (!/^(https?:|mailto:|tel:|\/)/i.test(attr.value.trim())) child.removeAttribute('href');
          continue;
        }
        if (n === 'style') {
          const kept = attr.value.split(';').map((d) => d.trim()).filter((d) => {
            const [prop, ...rest] = d.split(':'); const val = rest.join(':');
            return prop && STYLE_OK.has(prop.trim().toLowerCase()) && !/url\(|expression|javascript/i.test(val);
          });
          if (kept.length) child.setAttribute('style', kept.join('; ')); else child.removeAttribute('style');
          continue;
        }
        if (n === 'class' && /^(chk|done)$/.test(attr.value)) continue;
        if (n === 'data-checked' || n === 'colspan' || n === 'rowspan') continue;
        if (n === 'color' && child.tagName === 'FONT') continue;
        child.removeAttribute(attr.name);
      }
      if (child.tagName === 'A') { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer'); }
      walk(child);
    }
  };
  walk(root);
  return root.innerHTML;
}

export function htmlToText(html: string): string {
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]+>/g, '');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
  doc.querySelectorAll('li').forEach((li) => li.prepend(li.closest('ul.chk') ? (li.getAttribute('data-checked') === 'true' ? '[x] ' : '[ ] ') : '• '));
  doc.querySelectorAll('p,div,h1,h2,h3,h4,li,blockquote,tr,pre').forEach((b) => b.append('\n'));
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s: string) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>')
  .replace(/~~(.+?)~~/g, '<s>$1</s>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');

/** Plain text / light markdown → doc HTML (old plain-text docs open formatted). */
export function textToHtml(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | 'chk' | null = null;
  const close = () => { if (list) { out.push(list === 'ol' ? '</ol>' : '</ul>'); list = null; } };
  for (const l of lines) {
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { close(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if ((m = /^\s*[-*•]\s+\[( |x)\]\s+(.*)$/i.exec(l))) { if (list !== 'chk') { close(); out.push('<ul class="chk">'); list = 'chk'; } out.push(`<li data-checked="${m[1].toLowerCase() === 'x'}">${inline(m[2])}</li>`); continue; }
    if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(l)) { close(); out.push('<hr>'); continue; }
    if ((m = /^>\s?(.*)$/.exec(l))) { close(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    close();
    out.push(l.trim() ? `<p>${inline(l)}</p>` : '<p><br></p>');
  }
  close();
  return out.join('');
}

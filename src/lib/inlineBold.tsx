import type { ReactNode } from 'react';

/** Claude writes Markdown bold (`**like this**`); the feed and the brief
 *  render plain text, so the asterisks showed raw (founder 2026-11-08: "fix
 *  the bold asterisks in the chat replies"). Split on `**…**` and wrap the
 *  inside in <strong>; every plain or bold run still passes through `inner`
 *  (search highlights, linkified refs) so nothing else loses its meaning. An
 *  unpaired `**` stays as written — never swallow the member's own text. */
export function renderBold(text: string, inner: (s: string, key: string) => ReactNode = (s) => s): ReactNode[] {
  const out: ReactNode[] = [];
  // Also a Markdown LINK — [words](/in-app/path or https://…) — becomes a
  // real link (2026-11-26: replies showed "[Open … →](/docs/…)" raw), and a
  // lone *word* reads as emphasis instead of stray asterisks.
  const re = /\*\*(?=\S)([\s\S]*?\S)\*\*|\[([^\]\n]{1,200})\]\((\/(?!\/)[^)\s]*|https:\/\/[^)\s]+)\)|(?<![\w*])\*(?=\S)([^*\n]{1,120}?\S)\*(?![\w*])/g;
  let last = 0; let k = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<span key={`t${k}`}>{inner(text.slice(last, m.index), `t${k}`)}</span>);
    if (m[1] !== undefined) out.push(<strong key={`b${k}`}>{inner(m[1], `b${k}`)}</strong>);
    else if (m[2] !== undefined) {
      const href = m[3]; const label = m[2].replace(/\s*(?:→|›)\s*$/, '');
      out.push(href.startsWith('/')
        ? <a key={`l${k}`} className="link-cue" href={href}>{label} ›</a>
        : <a key={`l${k}`} className="link-cue" href={href} target="_blank" rel="noopener noreferrer">{label} ↗</a>);
    } else out.push(<em key={`i${k}`}>{inner(m[4], `i${k}`)}</em>);
    last = m.index + m[0].length; k++;
  }
  if (last < text.length) out.push(<span key={`t${k}`}>{inner(text.slice(last), `t${k}`)}</span>);
  return out;
}

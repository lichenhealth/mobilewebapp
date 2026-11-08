import type { ReactNode } from 'react';

/** Claude writes Markdown bold (`**like this**`); the feed and the brief
 *  render plain text, so the asterisks showed raw (founder 2026-11-08: "fix
 *  the bold asterisks in the chat replies"). Split on `**…**` and wrap the
 *  inside in <strong>; every plain or bold run still passes through `inner`
 *  (search highlights, linkified refs) so nothing else loses its meaning. An
 *  unpaired `**` stays as written — never swallow the member's own text. */
export function renderBold(text: string, inner: (s: string, key: string) => ReactNode = (s) => s): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(?=\S)([\s\S]*?\S)\*\*/g;
  let last = 0; let k = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<span key={`t${k}`}>{inner(text.slice(last, m.index), `t${k}`)}</span>);
    out.push(<strong key={`b${k}`}>{inner(m[1], `b${k}`)}</strong>);
    last = m.index + m[0].length; k++;
  }
  if (last < text.length) out.push(<span key={`t${k}`}>{inner(text.slice(last), `t${k}`)}</span>);
  return out;
}

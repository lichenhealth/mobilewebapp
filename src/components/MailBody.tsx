import { useEffect, useMemo, useRef, useState } from 'react';
import { mailAttachment, type MailFile, type MailMessage } from '../lib/mailApi';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { uploadDriveFile, type DriveFileKind } from '../lib/driveFilesApi';
import './MailBody.css';

/** AN EMAIL AS ITS SENDER DESIGNED IT (founder 2026-11-15: "how can we make
 *  sure the mail import renders with the same fidelity as the gmail inbox?").
 *
 *  The sender's HTML renders inside a SANDBOXED frame: no `allow-scripts`, so
 *  nothing in an email can ever run; the markup is also stripped of scripts,
 *  frames, forms, event handlers and javascript: links before it lands, and a
 *  CSP inside the frame refuses everything but images, styles and fonts.
 *  `allow-same-origin` lets Lichen measure the frame's height — without
 *  scripts it grants the email nothing. Links open in a new tab. Inline images
 *  (cid:) are fetched from Gmail on demand; wide newsletters scale to fit,
 *  the way Gmail's app does. Plain-text mail keeps the simple text view. */
export default function MailBody({ accountId, m }: { accountId: string; m: MailMessage }) {
  const [showQuote, setShowQuote] = useState(false);
  const textSplit = useMemo(() => (m.html ? null : splitTextQuote(m.body ?? '')), [m.html, m.body]);
  const htmlQuoted = useMemo(() => (m.html ? hasHtmlQuote(m.html) : false), [m.html]);
  const quoted = textSplit ? !!textSplit.quote : htmlQuoted;
  const toggle = quoted ? (
    <button className="mailb__quote" onClick={() => setShowQuote((v) => !v)} aria-expanded={showQuote}
      data-tip={showQuote ? 'Hide quoted text' : 'Show quoted text'}>
      {showQuote ? 'Hide quoted text' : '··· Show quoted text'}
    </button>
  ) : null;
  if (textSplit) {
    return (
      <>
        <div className="mailb__text">{(showQuote || !textSplit.quote ? m.body : textSplit.head) || '(no text in this message)'}</div>
        {toggle}
      </>
    );
  }
  return (
    <>
      <HtmlFrame accountId={accountId} m={m} foldQuote={quoted && !showQuote} />
      {toggle}
    </>
  );
}

/** QUOTED REPLIES FOLD (founder 2026-11-15, the not-yet-built list): the
 *  earlier messages a reply carries below itself hide behind one "Show quoted
 *  text" line, the way Gmail does — only when there's something of the reply's
 *  own above them, so a bare forward never reads empty. */
const QUOTE_SEL = '.gmail_quote, blockquote[type="cite"], .yahoo_quoted, #divRplyFwdMsg, #appendonsend, .moz-cite-prefix, div[id^="mail-editor-reference-message"]';

function quoteRoots(doc: Document): Element[] {
  const roots: Element[] = [];
  doc.querySelectorAll(QUOTE_SEL).forEach((el) => {
    if (!roots.some((r) => r.contains(el))) roots.push(el);
  });
  // Outlook: the "From: … Sent: …" header block and everything after it.
  const out: Element[] = [];
  for (const r of roots) {
    out.push(r);
    if (r.id === 'divRplyFwdMsg' || r.id === 'appendonsend') {
      let n = r.nextElementSibling;
      while (n) { out.push(n); n = n.nextElementSibling; }
      const prev = r.previousElementSibling;
      if (prev?.tagName === 'HR') out.push(prev);
    }
  }
  return out;
}

function hasHtmlQuote(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const roots = quoteRoots(doc);
  if (!roots.length) return false;
  roots.forEach((r) => r.remove());
  return (doc.body.textContent ?? '').trim().length > 0 || !!doc.body.querySelector('img');
}

function splitTextQuote(body: string): { head: string; quote: string } {
  const lines = body.split('\n');
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^-{2,}\s*(original message|forwarded message)\s*-{2,}$/i.test(l)
      || (/^on .{4,200}wrote:$/i.test(l))
      || (/^>/.test(l) && lines.slice(i).every((x) => !x.trim() || /^>/.test(x.trim())))) { at = i; break; }
    // "On Mon, Nov 10, 2026 at 4:12 PM Jane <jane@x.com>" often wraps before "wrote:"
    if (/^on .{4,200}$/i.test(l) && /wrote:$/i.test((lines[i + 1] ?? '').trim())) { at = i; break; }
  }
  if (at <= 0) return { head: body, quote: '' };
  const head = lines.slice(0, at).join('\n').trimEnd();
  if (!head.trim()) return { head: body, quote: '' };
  return { head, quote: lines.slice(at).join('\n') };
}

const DROP = 'script,noscript,iframe,frame,frameset,object,embed,applet,form,input,button,select,textarea,link,meta,base,portal,template';

function sanitize(html: string): Document {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll(DROP).forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      const v = a.value.trim().toLowerCase();
      if (n.startsWith('on') || n === 'formaction' || n === 'srcdoc') { el.removeAttribute(a.name); continue; }
      if ((n === 'href' || n === 'src' || n === 'xlink:href' || n === 'action' || n === 'background')
        && (v.startsWith('javascript:') || v.startsWith('vbscript:') || (v.startsWith('data:') && !v.startsWith('data:image/')))) {
        el.removeAttribute(a.name);
      }
    }
  });
  doc.querySelectorAll('a[href]').forEach((a) => { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); });
  return doc;
}

const FRAME_CSS = `
  html,body{margin:0;padding:0;background:#fff}
  body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Archivo,Helvetica,Arial,sans-serif;color:#1d2427;overflow-wrap:anywhere}
  img{max-width:100%;height:auto}
  table{max-width:100%}
  pre{white-space:pre-wrap}
  a{color:#b8643f}
  blockquote{margin:8px 0 8px 4px;padding-left:10px;border-left:2px solid #e3ddd1;color:#5b6468}
`;
const CSP = "default-src 'none'; img-src https: http: data: blob:; style-src 'unsafe-inline' https:; font-src https: data:; media-src https: data: blob:";

function b64ToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64url.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function fileBlob(accountId: string, messageId: string, f: MailFile): Promise<Blob> {
  const { data } = await mailAttachment(accountId, messageId, f.attachment_id);
  return new Blob([b64ToBytes(data)], { type: f.mime || 'application/octet-stream' });
}
async function fileUrl(accountId: string, messageId: string, f: MailFile): Promise<string> {
  const { data } = await mailAttachment(accountId, messageId, f.attachment_id);
  return URL.createObjectURL(new Blob([b64ToBytes(data)], { type: f.mime || 'application/octet-stream' }));
}

function HtmlFrame({ accountId, m, foldQuote }: { accountId: string; m: MailMessage; foldQuote: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [cids, setCids] = useState<Record<string, string>>({});
  const [h, setH] = useState(120);

  // Inline images ride as attachments — fetch the ones the HTML points at.
  useEffect(() => {
    let live = true;
    const wanted = m.files.filter((f) => f.cid && m.html?.includes(`cid:${f.cid}`));
    void Promise.all(wanted.map(async (f) => {
      try { return [f.cid as string, await fileUrl(accountId, m.id, f)] as const; } catch { return null; }
    })).then((pairs) => {
      if (!live) return;
      const map: Record<string, string> = {};
      for (const p of pairs) if (p) map[p[0]] = p[1];
      setCids(map);
    });
    return () => { live = false; };
  }, [accountId, m.id, m.html, m.files]);

  const srcDoc = useMemo(() => {
    const doc = sanitize(m.html ?? '');
    doc.querySelectorAll('img[src^="cid:"], img[src^="CID:"]').forEach((img) => {
      const key = (img.getAttribute('src') ?? '').slice(4);
      if (cids[key]) img.setAttribute('src', cids[key]);
      else img.removeAttribute('src');
    });
    if (foldQuote) quoteRoots(doc).forEach((el) => el.remove());
    const head = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>${FRAME_CSS}</style>`;
    return `<!doctype html><html><head>${head}${doc.head.innerHTML}</head><body>${doc.body.innerHTML}</body></html>`;
  }, [m.html, cids, foldQuote]);

  // Size the frame to its content; scale a too-wide newsletter down to fit.
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let ro: ResizeObserver | null = null;
    const fit = () => {
      const d = frame.contentDocument;
      if (!d?.body) return;
      d.body.style.zoom = '';
      const avail = frame.clientWidth;
      const wide = d.documentElement.scrollWidth;
      if (wide > avail + 4 && avail > 0) d.body.style.zoom = String(Math.max(0.4, avail / wide));
      setH(Math.min(20000, Math.ceil(d.documentElement.scrollHeight) + 4));
    };
    const onLoad = () => {
      fit();
      const d = frame.contentDocument;
      if (!d?.body) return;
      // LINKS OPEN EVEN WHEN SOMETHING SITS ON TOP OF THEM (founder 2026-11-15:
      // a "Manage Billing" button showed a text cursor and wouldn't click —
      // senders layer invisible spacers/tracking pixels over buttons). The
      // email runs no script; Lichen looks under the pointer through every
      // layer for a real link and opens it in a new tab itself.
      const linkAt = (x: number, y: number): HTMLAnchorElement | null => {
        for (const el of d.elementsFromPoint(x, y)) {
          const a = (el as Element).closest?.('a[href]') as HTMLAnchorElement | null;
          if (a && /^(https?:|mailto:|tel:)/i.test(a.getAttribute('href') ?? '')) return a;
        }
        return null;
      };
      d.addEventListener('click', (e) => {
        const a = linkAt(e.clientX, e.clientY);
        if (!a) return;
        e.preventDefault();
        window.open(a.href, '_blank', 'noopener,noreferrer');
      });
      d.addEventListener('mousemove', (e) => {
        d.documentElement.style.cursor = linkAt(e.clientX, e.clientY) ? 'pointer' : '';
      });
      d.querySelectorAll('img').forEach((img) => img.addEventListener('load', fit));
      ro = new ResizeObserver(fit);
      ro.observe(d.body);
    };
    frame.addEventListener('load', onLoad);
    window.addEventListener('resize', fit);
    return () => { frame.removeEventListener('load', onLoad); window.removeEventListener('resize', fit); ro?.disconnect(); };
  }, [srcDoc]);

  return (
    <iframe ref={ref} className="mailb__frame" title="Email" srcDoc={srcDoc} style={{ height: h }}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />
  );
}

const sizeLabel = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const fileIcon = (mime: string) => (mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'mic' : 'paperclip');
const opensInBrowser = (mime: string) => /^(image\/|video\/|audio\/|text\/plain|application\/pdf)/.test(mime);

/** The message's attachments, opened and saved right here — no trip to Gmail. */
export function MailFiles({ accountId, m }: { accountId: string; m: MailMessage }) {
  const files = m.files.filter((f) => !f.inline || !m.html?.includes(`cid:${f.cid}`));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  // Small images preview as thumbnails without a tap.
  useEffect(() => {
    let live = true;
    const small = files.filter((f) => f.mime.startsWith('image/') && f.size < 3 * 1048576).slice(0, 6);
    void Promise.all(small.map(async (f) => {
      try { return [f.attachment_id, await fileUrl(accountId, m.id, f)] as const; } catch { return null; }
    })).then((pairs) => {
      if (!live) return;
      const map: Record<string, string> = {};
      for (const p of pairs) if (p) map[p[0]] = p[1];
      setThumbs(map);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, m.id]);

  if (!files.length) return null;

  async function open(f: MailFile, download: boolean) {
    setErr(''); setBusy(f.attachment_id + (download ? ':d' : ''));
    // A new tab must open on the tap itself or the browser blocks it.
    const tab = !download && opensInBrowser(f.mime) ? window.open('', '_blank') : null;
    try {
      const url = thumbs[f.attachment_id] ?? await fileUrl(accountId, m.id, f);
      if (tab) { tab.location.href = url; }
      else {
        const a = document.createElement('a');
        a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
      }
    } catch (e) {
      tab?.close();
      setErr(e instanceof Error ? e.message : 'That file didn’t open.');
    } finally { setBusy(null); }
  }

  /** SAVE TO DRIVE: the attachment becomes a private file in your own Drive
   *  (the 'drive' bucket, owner-only) — kept on Lichen, no trip to Gmail. */
  async function toDrive(f: MailFile) {
    setErr(''); setBusy(f.attachment_id + ':s');
    try {
      const blob = await fileBlob(accountId, m.id, f);
      const kind: DriveFileKind = f.mime.startsWith('image/') ? 'photo' : f.mime.startsWith('video/') ? 'video'
        : f.mime.startsWith('audio/') ? 'audio' : 'file';
      await uploadDriveFile(new File([blob], f.name || 'attachment', { type: blob.type }), kind);
      setSaved((cur) => ({ ...cur, [f.attachment_id]: true }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That file didn’t save to Drive.');
    } finally { setBusy(null); }
  }

  return (
    <div className="mailb__files">
      <p className="mailb__fileshead"><Icon name="paperclip" size={13} /> {files.length === 1 ? '1 attachment' : `${files.length} attachments`}</p>
      <ul>
        {files.map((f) => (
          <li key={f.attachment_id} className="mailb__file">
            {thumbs[f.attachment_id]
              ? <button className="mailb__thumb" onClick={() => void open(f, false)} aria-label={`Open ${f.name}`}><img src={thumbs[f.attachment_id]} alt="" /></button>
              : <span className="mailb__fileicon" aria-hidden><Icon name={fileIcon(f.mime)} size={16} /></span>}
            <span className="mailb__filemeta">
              <span className="mailb__filename">{f.name}</span>
              <span className="mailb__filesize">{sizeLabel(f.size)}</span>
            </span>
            <span className="mailb__fileacts">
              {opensInBrowser(f.mime) && (
                <button className="mailb__fileact" disabled={!!busy} onClick={() => void open(f, false)}>
                  {busy === f.attachment_id ? 'Opening…' : 'Open'}</button>
              )}
              <button className="mailb__fileact" disabled={!!busy} onClick={() => void open(f, true)}>
                {busy === f.attachment_id + ':d' ? 'Saving…' : 'Download'}</button>
              {saved[f.attachment_id]
                ? <Link className="mailb__fileact mailb__fileact--done" to="/drive">In your Drive ✓</Link>
                : <button className="mailb__fileact" disabled={!!busy} onClick={() => void toDrive(f)}>
                    {busy === f.attachment_id + ':s' ? 'Saving…' : 'Save to Drive'}</button>}
            </span>
          </li>
        ))}
      </ul>
      {err && <p className="mailb__err">{err}</p>}
    </div>
  );
}

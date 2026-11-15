import { useEffect, useMemo, useRef, useState } from 'react';
import { mailAttachment, type MailFile, type MailMessage } from '../lib/mailApi';
import { Icon } from './Icon';
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
  if (!m.html) return <div className="mailb__text">{m.body || '(no text in this message)'}</div>;
  return <HtmlFrame accountId={accountId} m={m} />;
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
async function fileUrl(accountId: string, messageId: string, f: MailFile): Promise<string> {
  const { data } = await mailAttachment(accountId, messageId, f.attachment_id);
  return URL.createObjectURL(new Blob([b64ToBytes(data)], { type: f.mime || 'application/octet-stream' }));
}

function HtmlFrame({ accountId, m }: { accountId: string; m: MailMessage }) {
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
    const head = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>${FRAME_CSS}</style>`;
    return `<!doctype html><html><head>${head}${doc.head.innerHTML}</head><body>${doc.body.innerHTML}</body></html>`;
  }, [m.html, cids]);

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
            </span>
          </li>
        ))}
      </ul>
      {err && <p className="mailb__err">{err}</p>}
    </div>
  );
}

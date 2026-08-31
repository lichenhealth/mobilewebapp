import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { uploadPageImage } from '../lib/avatarApi';
import { postToAssistantFeed } from '../lib/assistantFeedApi';
import './GrabPen.css';

/** THE GRAB + PEN (founder 2026-08-31: "a screen grab feature with an edit
 *  pen, so people can do on the platform what I'm doing with shottr when I
 *  paste screens for you with edits"). Lives on an owner's PREVIEW of their
 *  page: grab what's on screen, draw on it, add a note, and it lands in the
 *  page's Build-with-Claude thread as a pasted photo — the same loop the
 *  founder runs by hand, on-platform.
 *
 *  html2canvas is lazy-loaded so the page pays nothing until the pen is
 *  picked up. Cross-origin images ride useCORS (Supabase storage sends
 *  permissive CORS); an image that still refuses renders as a gap in the
 *  grab, which is honest enough for markup. */
export default function GrabPen({ thread, uploaderId }: {
  /** The assistant thread the marked-up shot posts into (space:<id>, or
   *  'profile' for a member's own page). */
  thread: string;
  uploaderId: string;
}) {
  const navigate = useNavigate();
  const [shot, setShot] = useState<HTMLImageElement | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<{ x: number; y: number }[][]>([]);
  const live = useRef<{ x: number; y: number }[] | null>(null);

  const grab = async () => {
    setGrabbing(true); setErr('');
    try {
      const { default: html2canvas } = await import('html2canvas');
      const cnv = await html2canvas(document.body, {
        useCORS: true,
        x: window.scrollX, y: window.scrollY,
        width: window.innerWidth, height: window.innerHeight,
        // The FAB itself shouldn't be in the shot.
        ignoreElements: (el) => el.classList?.contains('grabpen__fab'),
      });
      const img = new Image();
      img.onload = () => { strokes.current = []; setShot(img); };
      img.src = cnv.toDataURL('image/png');
    } catch {
      setErr('Could not grab the screen — some browsers block it.');
    } finally { setGrabbing(false); }
  };

  // Draw the shot + every stroke. Undo = pop a stroke and repaint.
  const repaint = () => {
    const cnv = canvasRef.current;
    if (!cnv || !shot) return;
    const ctx = cnv.getContext('2d')!;
    ctx.clearRect(0, 0, cnv.width, cnv.height);
    ctx.drawImage(shot, 0, 0, cnv.width, cnv.height);
    ctx.strokeStyle = '#f0356b'; ctx.lineWidth = Math.max(3, cnv.width / 320);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of [...strokes.current, ...(live.current ? [live.current] : [])]) {
      if (s.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      for (const p of s.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  };
  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv || !shot) return;
    cnv.width = shot.naturalWidth; cnv.height = shot.naturalHeight;
    repaint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot]);

  const at = (e: React.PointerEvent): { x: number; y: number } => {
    const cnv = canvasRef.current!;
    const r = cnv.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * cnv.width,
      y: ((e.clientY - r.top) / r.height) * cnv.height,
    };
  };

  async function send() {
    const cnv = canvasRef.current;
    if (!cnv) return;
    setSending(true); setErr('');
    try {
      const blob: Blob = await new Promise((res, rej) =>
        cnv.toBlob((b) => (b ? res(b) : rej(new Error('no blob'))), 'image/png'));
      const url = await uploadPageImage(uploaderId, new File([blob], 'markup.png', { type: 'image/png' }));
      await postToAssistantFeed(
        note.trim() || 'A marked-up grab of the page — the pen shows what I mean.',
        undefined, thread, [url],
      );
      setSent(true);
    } catch {
      setErr('Could not send — check your connection and try again.');
    } finally { setSending(false); }
  }

  if (!shot) {
    return (
      <button className="grabpen__fab" type="button" onClick={() => void grab()} disabled={grabbing}
        title="Grab this screen and mark it up for Claude">
        <Icon name="image" size={16} />
        {grabbing ? 'Grabbing…' : 'Mark it up'}
        {err && <em>{err}</em>}
      </button>
    );
  }

  return (
    <div className="grabpen__overlay" role="dialog" aria-label="Mark up the screen grab">
      <div className="grabpen__bar">
        {sent ? (
          <>
            <span className="grabpen__sent">Sent to your build thread ✓</span>
            <button type="button" onClick={() => navigate(`/assistant/feed?thread=${encodeURIComponent(thread)}`)}>
              Open the conversation
            </button>
            <button type="button" onClick={() => { setShot(null); setSent(false); setNote(''); }}>Done</button>
          </>
        ) : (
          <>
            <span className="grabpen__hint">Draw on it — circle what you mean</span>
            <button type="button" onClick={() => { strokes.current.pop(); repaint(); }}>Undo</button>
            <button type="button" onClick={() => { setShot(null); setNote(''); }}>Throw it away</button>
          </>
        )}
      </div>
      <canvas
        ref={canvasRef}
        className="grabpen__canvas"
        onPointerDown={(e) => {
          if (sent) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          live.current = [at(e)];
        }}
        onPointerMove={(e) => { if (live.current) { live.current.push(at(e)); repaint(); } }}
        onPointerUp={() => {
          if (live.current) {
            if (live.current.length > 1) strokes.current.push(live.current);
            live.current = null;
            repaint();
          }
        }}
      />
      {!sent && (
        <div className="grabpen__send">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Say what should change…"
          />
          <button type="button" className="grabpen__go" disabled={sending} onClick={() => void send()}>
            {sending ? 'Sending…' : 'Send to Claude'}
          </button>
          {err && <em className="grabpen__err">{err}</em>}
        </div>
      )}
    </div>
  );
}

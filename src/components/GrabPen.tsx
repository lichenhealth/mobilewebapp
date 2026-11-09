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
 *  HOW IT GRABS (founder 2026-11-07: "it shows a blank screenshot… it is
 *  supposed to replace the screen shot and then markup process I use"):
 *  a REAL capture of the tab first — getDisplayMedia with preferCurrentTab,
 *  the browser's own pixels, exactly what Shottr sees (one "Share this tab"
 *  tap in Chrome/Edge/Firefox). html2canvas REPAINTS the DOM from CSS and
 *  can't draw the website look's photo bands (object-fit, gradients, the
 *  #root scroller) — it stays only as the fallback where screen capture
 *  doesn't exist (iPhone/iPad Safari), and the overlay always offers "Use a
 *  screenshot I took" (file pick or paste) — the founder's own loop.
 *  ⚠ The canvas is shown at its OWN aspect (no flex-stretch, no object-fit)
 *  or pointer→pixel mapping drifts and strokes land beside the finger. */
/* One tab share kept open across grabs (see captureTab). Module-level so a
   remount of the button doesn't drop it. */
const IDLE_MS = 20 * 60 * 1000;
let shared: { stream: MediaStream; video: HTMLVideoElement } | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
function stopShare() {
  shared?.stream.getTracks().forEach((t) => t.stop());
  shared = null;
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}
function armIdleStop() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(stopShare, IDLE_MS);
}
async function openShare(): Promise<{ video: HTMLVideoElement; fresh: boolean }> {
  if (shared && shared.stream.getVideoTracks().some((t) => t.readyState === 'live')) {
    return { video: shared.video, fresh: false };
  }
  stopShare();
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'browser' },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
  } as DisplayMediaStreamOptions);
  const video = document.createElement('video');
  video.srcObject = stream; video.muted = true; video.playsInline = true;
  await video.play();
  // Chrome's own Stop button ends the share — forget it so the next grab asks.
  stream.getVideoTracks().forEach((t) => t.addEventListener('ended', () => { if (shared?.stream === stream) { shared = null; } }));
  shared = { stream, video };
  return { video, fresh: true };
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', stopShare);

export default function GrabPen({ thread, uploaderId, context }: {
  /** The assistant thread the marked-up shot posts into (space:<id>, or
   *  'profile' for a member's own page). */
  thread: string;
  uploaderId: string;
  /** A sentence naming WHAT was marked up, sent ahead of the member's note
   *  (an invitation's grab tells the brain which event). */
  context?: string;
}) {
  const navigate = useNavigate();
  const [shot, setShot] = useState<HTMLImageElement | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentConvo, setSentConvo] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<{ x: number; y: number }[][]>([]);
  const live = useRef<{ x: number; y: number }[] | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const fileInput = (
    <input ref={fileRef} type="file" accept="image/*,.heic,.heif" hidden
      onChange={(e) => { void takeFile(e.target.files?.[0]); e.target.value = ''; }} />
  );

  const loadShot = (src: string) => new Promise<void>((res, rej) => {
    const img = new Image();
    img.onload = () => { strokes.current = []; setShot(img); res(); };
    img.onerror = () => rej(new Error('bad image'));
    img.src = src;
  });

  /** The browser's own capture of this tab — real pixels. ASK ONCE PER VISIT
   *  (founder 2026-11-08: "can we remove the permissions step… or only ask
   *  once"): Chrome asks on every getDisplayMedia call and gives a site no
   *  way to skip or remember it, so the share is KEPT OPEN between grabs —
   *  the first grab asks, later ones reuse it. Chrome shows its own "sharing
   *  this tab" bar meanwhile (its Stop ends it; the next grab asks again),
   *  and an idle share closes itself after IDLE_MS. */
  const captureTab = async (): Promise<string> => {
    const fab = document.querySelector('.grabpen__fab') as HTMLElement | null;
    fab?.classList.add('grabpen__fab--hidden');
    try {
      const share = await openShare();
      // Let the FAB hide (and, the first time, the prompt fade) before the frame.
      await new Promise((r) => setTimeout(r, share.fresh ? 450 : 180));
      const { video } = share;
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d')!.drawImage(video, 0, 0);
      armIdleStop();
      return c.toDataURL('image/png');
    } finally {
      fab?.classList.remove('grabpen__fab--hidden');
    }
  };

  /** Fallback where screen capture doesn't exist: repaint the viewport. */
  const repaintViewport = async (): Promise<string> => {
    const { default: html2canvas } = await import('html2canvas');
    const cnv = await html2canvas(document.body, {
      useCORS: true,
      // The app scrolls #root, not the window — html2canvas restores element
      // scroll positions in its clone, so the viewport is simply (0,0).
      x: 0, y: 0, scrollX: 0, scrollY: 0,
      width: window.innerWidth, height: window.innerHeight,
      windowWidth: window.innerWidth, windowHeight: window.innerHeight,
      ignoreElements: (el) => el.classList?.contains('grabpen__fab'),
    });
    return cnv.toDataURL('image/png');
  };

  const grab = async () => {
    setGrabbing(true); setErr('');
    try {
      const canCapture = !!navigator.mediaDevices?.getDisplayMedia;
      await loadShot(canCapture ? await captureTab() : await repaintViewport());
    } catch (e) {
      const name = (e as { name?: string })?.name;
      // Cancelling the share prompt is a choice, not an error.
      if (name !== 'NotAllowedError' && name !== 'AbortError') {
        setErr('Could not grab the screen — use a screenshot you took instead.');
        fileRef.current?.click();
      }
    } finally { setGrabbing(false); }
  };

  /** "Use a screenshot I took" — a picked or pasted image replaces the shot. */
  const takeFile = async (f: File | null | undefined) => {
    if (!f || !f.type.startsWith('image/')) return;
    setErr(''); setSent(false);
    const url = URL.createObjectURL(f);
    try { await loadShot(url); } catch { setErr('That file isn\'t an image this browser can open.'); }
  };
  useEffect(() => {
    if (!shot) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      if (item) { e.preventDefault(); void takeFile(item.getAsFile()); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot]);

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
      // A space build thread is one continuous stream (convo null); a
      // personal thread's grab starts its own conversation (the default) —
      // and "Open the conversation" opens THAT exchange (founder 2026-10-13:
      // a bare thread link now lands on the brief, not the words just sent).
      const row = await postToAssistantFeed(
        [context, note.trim() || 'A marked-up grab of the page — the pen shows what I mean.'].filter(Boolean).join('\n\n'),
        undefined, thread, [url],
        thread.startsWith('space:') ? null : undefined,
      );
      setSentConvo(row?.convo_id ?? null);
      setSent(true);
    } catch {
      setErr('Could not send — check your connection and try again.');
    } finally { setSending(false); }
  }

  if (!shot) {
    return (
      <>
      {fileInput}
      <button className="grabpen__fab" type="button" onClick={() => void grab()} disabled={grabbing}
        title="Grab this screen and mark it up for Claude">
        <Icon name="image" size={16} />
        {grabbing ? 'Grabbing…' : 'Mark it up'}
        {err && <em>{err}</em>}
      </button>
      </>
    );
  }

  return (
    <div className="grabpen__overlay" role="dialog" aria-label="Mark up the screen grab">
      {fileInput}
      <div className="grabpen__bar">
        {sent ? (
          <>
            <span className="grabpen__sent">Sent to your build thread ✓</span>
            <button type="button" onClick={() => navigate(`/assistant/feed?thread=${encodeURIComponent(thread)}${sentConvo ? `&convo=${encodeURIComponent(sentConvo)}` : ''}`)}>
              Open the conversation
            </button>
            <button type="button" onClick={() => { setShot(null); setSent(false); setNote(''); }}>Done</button>
          </>
        ) : (
          <>
            <span className="grabpen__hint">Draw on it — circle what you mean</span>
            <button type="button" onClick={() => { strokes.current.pop(); repaint(); }}>Undo</button>
            <button type="button" onClick={() => fileRef.current?.click()} title="Or paste one with ⌘V">Use a screenshot I took</button>
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

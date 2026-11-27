import { useEffect, useRef } from 'react';

// THE BARS THAT MOVE WITH YOUR VOICE (founder 2026-11-27: "I have those
// little dot monitors, so I know that you're listening" — what Claude's own
// app shows while you talk). On a computer running Chrome or Edge the bars
// follow the microphone's real loudness; everywhere else (phones, Safari —
// where opening a second microphone stream can stop the speech engine
// hearing) they jump each time the engine hears new words and settle back.
// Nothing is recorded: the loudness is read and thrown away frame by frame.

const BARS = [0.55, 0.85, 1, 0.8, 0.6];

function realMicOK(): boolean {
  const ua = navigator.userAgent;
  const mobile = /Android|iP(hone|ad|od)|Mobile/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return !mobile && /(Chrome|Edg)\//.test(ua) && !!navigator.mediaDevices?.getUserMedia;
}

export default function VoiceMeter({ active, pulse = 0, className = '' }: {
  active: boolean;
  /** Bumps each time the engine hears something new (the fallback signal). */
  pulse?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const level = useRef(0);
  const kick = useRef(0);
  useEffect(() => { if (active) kick.current = 1; }, [pulse, active]);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let stop = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let buf: Uint8Array<ArrayBuffer> | null = null;
    if (realMicOK()) {
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then((s) => {
        if (stop) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        try {
          const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          ctx = new AC();
          analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          buf = new Uint8Array(new ArrayBuffer(analyser.fftSize));
          ctx.createMediaStreamSource(s).connect(analyser);
        } catch { analyser = null; }
      }).catch(() => { /* fall back to the word pulse */ });
    }
    let t = 0;
    const frame = () => {
      if (stop) return;
      t += 1;
      let target: number;
      if (analyser && buf) {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        target = Math.min(1, Math.sqrt(sum / buf.length) * 5);
      } else {
        target = kick.current;
        kick.current *= 0.9;
      }
      level.current += (target - level.current) * 0.35;
      const el = ref.current;
      if (el) {
        const kids = el.children;
        for (let i = 0; i < kids.length; i++) {
          const wobble = 0.75 + 0.25 * Math.sin(t / 5 + i * 1.3);
          const h = 0.18 + level.current * BARS[i] * wobble * 0.82;
          (kids[i] as HTMLElement).style.transform = `scaleY(${h.toFixed(3)})`;
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
      void ctx?.close().catch(() => {});
    };
  }, [active]);

  return (
    <span ref={ref} className={'vmeter ' + className} aria-hidden="true">
      {BARS.map((_, i) => <span key={i} className="vmeter__bar" />)}
    </span>
  );
}

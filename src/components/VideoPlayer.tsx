import { useEffect, useRef, useState } from 'react';
import { getVideoJob, videoPublicUrl, type VideoJob } from '../lib/videoApi';

/** Lichen-hosted video: plays the adaptive HLS rendition once the worker has
 *  it ready (Safari natively; hls.js elsewhere, loaded lazily), falling back
 *  to the original file meanwhile. Older posts without a job id play their
 *  url directly — nothing changes for them.
 *
 *  Protection (founder 2026-08-05): the universal default is DOWNLOADABLE —
 *  protection is a choice, not a wall. When a post carries
 *  details.noDownload (or a course is a protected teaching), pass
 *  noDownload to hide the download button, block picture-in-picture and the
 *  context menu. The optional `watermark` prop overlays the viewer's name —
 *  screen recording can't be technically blocked on the open web, so a
 *  traceable name is the honest deterrent. */
export default function VideoPlayer({ url, jobId, watermark, noDownload }: { url: string; jobId?: string; watermark?: string; noDownload?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [job, setJob] = useState<VideoJob | null>(null);

  // Follow the job until it settles (ready/failed); quiet 12s poll.
  useEffect(() => {
    if (!jobId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      const j = await getVideoJob(jobId);
      if (!live) return;
      setJob(j);
      if (j && (j.status === 'uploaded' || j.status === 'processing')) {
        timer = setTimeout(check, 12000);
      }
    };
    void check();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [jobId]);

  const ready = job?.status === 'ready' && job.hls_path;
  const hlsUrl = ready ? videoPublicUrl(job!.hls_path!) : null;
  const poster = job?.poster_path ? videoPublicUrl(job.poster_path) : undefined;

  // Attach HLS when ready: native on Safari/iOS, hls.js (lazy chunk) elsewhere.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !hlsUrl) return;
    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = hlsUrl;
      return;
    }
    let hls: { destroy: () => void } | undefined;
    let live = true;
    void import('hls.js').then(({ default: Hls }) => {
      if (!live || !Hls.isSupported()) return;
      const h = new Hls();
      h.loadSource(hlsUrl);
      h.attachMedia(el);
      hls = h;
    });
    return () => { live = false; hls?.destroy(); };
  }, [hlsUrl]);

  const guard = noDownload ? {
    controlsList: 'nodownload noremoteplayback',
    disablePictureInPicture: true,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  } as const : {};

  const video = ready
    ? <video ref={videoRef} controls playsInline poster={poster} {...guard} />
    // Not (yet) transcoded: play the original directly — honest and immediate.
    : <video controls playsInline src={url} poster={poster} {...guard} />;

  if (!watermark) return video;
  return (
    <span className="vp-marked">
      {video}
      <span className="vp-watermark" aria-hidden="true">{watermark}</span>
    </span>
  );
}

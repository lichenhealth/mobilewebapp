/**
 * Lichen video worker — the self-run compression service (founder 2026-07-26).
 *
 * Polls public.video_jobs for 'uploaded' rows, downloads the original from
 * the 'videos' bucket, transcodes to adaptive HLS (plus a poster frame) with
 * ffmpeg, uploads the renditions, and marks the job 'ready'. Runs anywhere
 * node + ffmpeg exist: the founder's Mac for alpha, a $15 box at scale.
 *
 * Env (see worker/.env.example):
 *   SUPABASE_URL              https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY the service-role key (NEVER ships to clients)
 *   POLL_SECONDS              default 10
 */
const { createClient } = require('@supabase/supabase-js');
const { execFileSync, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL = (Number(process.env.POLL_SECONDS) || 10) * 1000;
if (!URL_ || !KEY) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(URL_, KEY, { auth: { persistSession: false } });

const log = (...a) => console.log(new Date().toISOString(), ...a);

function ffprobe(file) {
  const out = execFileSync('ffprobe', [
    '-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', file,
  ]).toString();
  const j = JSON.parse(out);
  const v = (j.streams || []).find((s) => s.codec_type === 'video') || {};
  return {
    width: v.width || 0,
    height: v.height || 0,
    duration: Math.round(Number(j.format?.duration || 0)),
  };
}

function transcode(src, outDir, srcHeight) {
  // Ladder: always 480p + 720p; add 1080p when the source carries it.
  // Single ffmpeg run → HLS with a master playlist (adaptive playback).
  const ladders = [
    { h: 480, vb: '900k', ab: '96k' },
    { h: 720, vb: '2200k', ab: '128k' },
    ...(srcHeight >= 1000 ? [{ h: 1080, vb: '4500k', ab: '160k' }] : []),
  ];
  const args = ['-y', '-i', src];
  ladders.forEach(() => { args.push('-map', '0:v:0', '-map', '0:a:0?'); });
  ladders.forEach((l, i) => {
    args.push(
      `-filter:v:${i}`, `scale=-2:${l.h}`,
      `-c:v:${i}`, 'libx264', '-preset', 'veryfast', '-crf', '23',
      `-maxrate:v:${i}`, l.vb, `-bufsize:v:${i}`, l.vb,
      `-c:a:${i}`, 'aac', `-b:a:${i}`, l.ab,
    );
  });
  args.push(
    '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod',
    '-hls_segment_filename', path.join(outDir, 'v%v', 'seg%04d.ts'),
    '-master_pl_name', 'master.m3u8',
    '-var_stream_map', ladders.map((_, i) => `v:${i},a:${i},name:v${i}`).join(' '),
    path.join(outDir, 'v%v', 'index.m3u8'),
  );
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  // Poster: a frame from one second in.
  execFileSync('ffmpeg', ['-y', '-ss', '1', '-i', src, '-frames:v', '1', '-update', '1', '-vf', 'scale=-2:720', path.join(outDir, 'poster.jpg')]);
}

async function uploadDir(dir, prefix) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { await uploadDir(p, `${prefix}/${entry.name}`); continue; }
    const type = entry.name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl'
      : entry.name.endsWith('.ts') ? 'video/mp2t'
      : entry.name.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream';
    const { error } = await db.storage.from('videos')
      .upload(`${prefix}/${entry.name}`, fs.readFileSync(p), { contentType: type, upsert: true });
    if (error) throw new Error(`upload ${prefix}/${entry.name}: ${error.message}`);
  }
}

async function processJob(job) {
  log('processing', job.id, job.src_path);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lichen-video-'));
  try {
    const { data, error } = await db.storage.from('videos').download(job.src_path);
    if (error) throw new Error('download: ' + error.message);
    const src = path.join(tmp, 'src' + path.extname(job.src_path));
    fs.writeFileSync(src, Buffer.from(await data.arrayBuffer()));

    const meta = ffprobe(src);
    const outDir = path.join(tmp, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    transcode(src, outDir, meta.height);

    const prefix = `hls/${job.id}`;
    await uploadDir(outDir, prefix);

    await db.from('video_jobs').update({
      status: 'ready',
      hls_path: `${prefix}/master.m3u8`,
      poster_path: `${prefix}/poster.jpg`,
      duration_secs: meta.duration,
      updated_at: new Date().toISOString(),
    }).eq('id', job.id);
    log('ready', job.id, `${meta.duration}s`);
  } catch (e) {
    log('failed', job.id, e.message);
    await db.from('video_jobs').update({
      status: 'failed', error: String(e.message).slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq('id', job.id);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function tick() {
  const { data, error } = await db.from('video_jobs')
    .select('*').eq('status', 'uploaded')
    .order('created_at').limit(1);
  if (error) { log('poll error:', error.message); return; }
  const job = data?.[0];
  if (!job) return;
  // Optimistic claim — safe if a second worker ever runs.
  const { data: claimed } = await db.from('video_jobs')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', job.id).eq('status', 'uploaded').select('id');
  if (!claimed?.length) return;
  await processJob(job);
}

log('Lichen video worker up — polling every', POLL / 1000, 's');
(async function loop() {
  for (;;) {
    try { await tick(); } catch (e) { log('tick error:', e.message); }
    await new Promise((r) => setTimeout(r, POLL));
  }
})();

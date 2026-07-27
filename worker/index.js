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
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ffprobe, transcode, uploadDir } = require('./common');

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL = (Number(process.env.POLL_SECONDS) || 10) * 1000;
if (!URL_ || !KEY) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(URL_, KEY, { auth: { persistSession: false } });

const log = (...a) => console.log(new Date().toISOString(), ...a);

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
    await uploadDir(db, outDir, prefix);

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

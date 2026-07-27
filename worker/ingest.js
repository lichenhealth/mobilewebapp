/**
 * Lichen local ingest — big files skip the upload cap entirely.
 *
 * Zoom recordings run 200MB–2GB; Supabase's free tier caps uploads ~50MB.
 * This CLI transcodes ON THIS MAC and uploads only the HLS renditions
 * (each segment is a few MB — no single file ever nears the cap), then
 * registers a ready video_jobs row. The video appears in Compose under
 * Video → "From my videos".
 *
 *   node --env-file=.env ingest.js "~/Zoom/Class 1.mp4" [more files…]
 *   node --env-file=.env ingest.js --owner <profile-uuid> file.mp4
 *
 * Owner defaults to INGEST_OWNER_PROFILE_ID in .env.
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ffprobe, transcode, uploadDir } = require('./common');

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1); }
const db = createClient(URL_, KEY, { auth: { persistSession: false } });

const args = process.argv.slice(2);
let owner = process.env.INGEST_OWNER_PROFILE_ID || '';
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--owner') { owner = args[++i]; continue; }
  files.push(args[i].replace(/^~\//, os.homedir() + '/'));
}
if (!owner) { console.error('Pass --owner <profile-uuid> or set INGEST_OWNER_PROFILE_ID in .env'); process.exit(1); }
if (!files.length) { console.error('Usage: node --env-file=.env ingest.js <video file> [more…]'); process.exit(1); }

(async () => {
  for (const file of files) {
    if (!fs.existsSync(file)) { console.error('✗ not found:', file); continue; }
    const name = path.basename(file);
    const mb = Math.round(fs.statSync(file).size / 1024 / 1024);
    console.log(`\n▶ ${name} (${mb}MB)`);

    const { data: job, error } = await db.from('video_jobs')
      .insert({ profile_id: owner, src_path: `ingest/${name}`, status: 'processing' })
      .select('id').single();
    if (error) { console.error('✗ job insert:', error.message); continue; }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lichen-ingest-'));
    try {
      const meta = ffprobe(file);
      const outDir = path.join(tmp, 'out');
      fs.mkdirSync(outDir, { recursive: true });
      console.log(`  transcoding ${meta.width}x${meta.height}, ${Math.round(meta.duration / 60)}min…`);
      transcode(file, outDir, meta.height);
      const prefix = `hls/${job.id}`;
      console.log('  uploading renditions…');
      await uploadDir(db, outDir, prefix);
      await db.from('video_jobs').update({
        status: 'ready',
        hls_path: `${prefix}/master.m3u8`,
        poster_path: `${prefix}/poster.jpg`,
        duration_secs: meta.duration,
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
      console.log(`✓ ready — open Compose → Video → "From my videos" to attach it`);
    } catch (e) {
      console.error('✗ failed:', e.message);
      await db.from('video_jobs').update({
        status: 'failed', error: String(e.message).slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
})();

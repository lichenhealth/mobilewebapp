/** Shared ffmpeg plumbing for the poller (index.js) and the local ingest CLI
 *  (ingest.js) — one transcode, one upload path, no drift. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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

async function uploadDir(db, dir, prefix) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { await uploadDir(db, p, `${prefix}/${entry.name}`); continue; }
    const type = entry.name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl'
      : entry.name.endsWith('.ts') ? 'video/mp2t'
      : entry.name.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream';
    const { error } = await db.storage.from('videos')
      .upload(`${prefix}/${entry.name}`, fs.readFileSync(p), { contentType: type, upsert: true });
    if (error) throw new Error(`upload ${prefix}/${entry.name}: ${error.message}`);
  }
}

module.exports = { ffprobe, transcode, uploadDir };

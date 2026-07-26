# Lichen video worker

The self-run compression service: members upload or record video in Lichen;
this worker transcodes it to adaptive HLS (auto quality-switching) plus a
poster frame, entirely on infrastructure we run. No external video platform
ever touches member media.

## Run it (Mac bootstrap, alpha)

```bash
brew install ffmpeg           # once
cd worker
npm install                   # once
cp .env.example .env          # once — paste the service-role key
npm start
```

Leave it running; it polls every 10s and logs each job. Stop with Ctrl-C —
unfinished jobs simply wait for the next run.

## Run it (a real box, later)

Any $15–25/mo machine (Hetzner CX22, Fly.io, etc.) with node 20+ and ffmpeg:
same three commands, plus a process manager (`systemd` or `pm2`) so it
restarts itself. One worker is plenty until uploads queue for hours; a second
worker is safe (jobs are claimed atomically).

## Costs & scaling notes

- Transcode speed ≈ realtime or better per rendition on modest CPUs.
- Storage: originals + renditions ≈ 2× original size in the `videos` bucket.
- When egress bills grow teeth, move the bucket to zero-egress object storage
  (Cloudflare R2) — the worker only changes its upload target.

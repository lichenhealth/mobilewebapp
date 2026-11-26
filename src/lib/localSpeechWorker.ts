/// <reference lib="webworker" />
// ON-PHONE SPEECH-TO-TEXT (founder 2026-11-26: "is there an ethical one from
// a data standpoint that we trust for this speech to text?"). Open-source
// Whisper running HERE, in a worker on the person's own device. The model
// and the engine are fetched once from Lichen's own storage (never a third
// party) and cached by the browser; audio never leaves the device.
import { pipeline, env } from '@huggingface/transformers';

const BASE = 'https://mjqnaevertyzgjlpwynr.supabase.co/storage/v1/object/public/speech/';
const MODEL = 'onnx-community/whisper-tiny.en';

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.remoteHost = BASE + 'models/';
env.remotePathTemplate = '{model}/';
// The engine (onnxruntime's wasm) from our storage too — rewrite whatever
// CDN the library picked to the same file names on ours.
const wp = env.backends?.onnx?.wasm?.wasmPaths as { mjs?: string; wasm?: string } | string | undefined;
if (wp && typeof wp === 'object') {
  const swap = (u?: string) => (u ? BASE + 'ort/' + u.split('/').pop() : u);
  env.backends.onnx!.wasm!.wasmPaths = { mjs: swap(wp.mjs), wasm: swap(wp.wasm) } as never;
}

type Asr = (audio: Float32Array) => Promise<{ text: string } | { text: string }[]>;
let asr: Promise<Asr> | null = null;
function load(): Promise<Asr> {
  if (!asr) {
    const seen: Record<string, [number, number]> = {};
    asr = pipeline('automatic-speech-recognition', MODEL, {
      dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } as never,
      device: 'wasm',
      progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status === 'progress' && p.file && p.total) {
          seen[p.file] = [p.loaded ?? 0, p.total];
          const all = Object.values(seen);
          const got = all.reduce((a, [l]) => a + l, 0), tot = all.reduce((a, [, t]) => a + t, 0);
          postMessage({ type: 'progress', pct: tot ? Math.round((got / tot) * 100) : 0 });
        }
      },
    }) as unknown as Promise<Asr>;
    asr.catch(() => { asr = null; });
  }
  return asr;
}

self.onmessage = async (e: MessageEvent<{ type: string; id?: number; audio?: Float32Array }>) => {
  const m = e.data;
  try {
    if (m.type === 'load') { await load(); postMessage({ type: 'ready' }); return; }
    if (m.type === 'transcribe' && m.audio) {
      const run = await load();
      postMessage({ type: 'ready' });
      const out = await run(m.audio);
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text) ?? '';
      postMessage({ type: 'text', id: m.id, text });
    }
  } catch (err) {
    postMessage({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) });
  }
};

// SPEAK AS IT WRITES (founder 2026-11-27: "the answer starts out loud only
// once it's fully written" — #1 of the gaps to the Claude app). When the
// member's message carries a voice_stream id (voice mode on), the model call
// streams and every new piece of reply TEXT is broadcast, in order, on a
// Supabase Realtime channel named by that id. The phone speaks each sentence
// as it lands. The id is a random uuid minted by the member's own device and
// stored only on their own feed row, so the channel is as private as that
// row (the unguessable-token doctrine). Nothing here changes what is SAVED:
// the reply is still rebuilt into the same message object the loop always
// had, and the finished row is inserted exactly as before.

type Block = Record<string, unknown> & { type: string };
export interface StreamedMessage {
  content: Block[];
  usage: Record<string, unknown>;
  stop_reason?: string;
}

/** Sends text to the channel, in order, batched to whole-ish phrases. */
export function voiceBroadcaster(supabaseUrl: string, serviceKey: string, id: string) {
  let chain: Promise<unknown> = Promise.resolve();
  let buf = '';
  let timer: number | undefined;
  const post = (event: string, payload: Record<string, unknown>) => {
    chain = chain.then(() => fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: `vs:${id}`, event, payload, private: false }] }),
    }).catch(() => {}));
  };
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (buf) { post('d', { t: buf }); buf = ''; }
  };
  return {
    text(t: string) {
      buf += t;
      if (/[.!?\n]/.test(t) || buf.length > 160) flush();
      else if (!timer) timer = setTimeout(flush, 300) as unknown as number;
    },
    /** A draft round the server threw away (a guard re-ran it). */
    reset() { buf = ''; flush(); post('r', {}); },
    /** The reply is finished — speak whatever is left. */
    end() { flush(); post('e', {}); return chain; },
  };
}

/** Reads an Anthropic SSE stream into the same shape a non-streamed call
 *  returns, calling onText for each text delta. Throws on a stream error. */
export async function readMessageStream(res: Response, onText: (t: string) => void): Promise<StreamedMessage> {
  const msg: StreamedMessage = { content: [], usage: {} };
  const json: Record<number, string> = {};
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let pending = '';
  const handle = (ev: Record<string, unknown>) => {
    switch (ev.type) {
      case 'message_start': {
        const m = ev.message as { usage?: Record<string, unknown> };
        msg.usage = { ...(m?.usage ?? {}) };
        break;
      }
      case 'content_block_start': {
        const i = ev.index as number;
        const b = structuredClone(ev.content_block) as Block;
        msg.content[i] = b;
        if (b.type === 'tool_use' || b.type === 'server_tool_use') json[i] = '';
        break;
      }
      case 'content_block_delta': {
        const i = ev.index as number;
        const d = ev.delta as Record<string, unknown>;
        const b = msg.content[i];
        if (!b) break;
        if (d.type === 'text_delta') { b.text = String(b.text ?? '') + String(d.text ?? ''); onText(String(d.text ?? '')); }
        else if (d.type === 'input_json_delta') json[i] = (json[i] ?? '') + String(d.partial_json ?? '');
        else if (d.type === 'thinking_delta') b.thinking = String(b.thinking ?? '') + String(d.thinking ?? '');
        else if (d.type === 'signature_delta') b.signature = d.signature;
        else if (d.type === 'citations_delta') b.citations = [...((b.citations as unknown[]) ?? []), d.citation];
        break;
      }
      case 'content_block_stop': {
        const i = ev.index as number;
        if (json[i] !== undefined) {
          if (json[i].trim()) msg.content[i].input = JSON.parse(json[i]);
          else if (msg.content[i].input === undefined) msg.content[i].input = {};
          delete json[i];
        }
        break;
      }
      case 'message_delta': {
        const d = ev.delta as { stop_reason?: string };
        if (d?.stop_reason) msg.stop_reason = d.stop_reason;
        const u = ev.usage as Record<string, unknown> | undefined;
        if (u) for (const [k, v] of Object.entries(u)) if (v !== null && v !== undefined) msg.usage[k] = v;
        break;
      }
      case 'error': {
        const e = ev.error as { message?: string; type?: string } | undefined;
        throw new Error(`stream error: ${e?.type ?? ''} ${e?.message ?? ''}`.trim());
      }
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += dec.decode(value, { stream: true });
    let cut: number;
    while ((cut = pending.indexOf('\n\n')) >= 0) {
      const frame = pending.slice(0, cut);
      pending = pending.slice(cut + 2);
      const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (data) handle(JSON.parse(data));
    }
  }
  msg.content = msg.content.filter(Boolean);
  return msg;
}

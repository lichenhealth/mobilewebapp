import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../Icon';
import { supabase } from '../../lib/supabase';
import { postToAssistantFeed } from '../../lib/assistantFeedApi';
import { aiDoorOn } from '../AssistantDoor';
import { renderBold } from '../../lib/inlineBold';
import {
  canListen, canSpeak, listenOnce, speak, startWakeWord, stopSpeaking, useSpeaking,
} from '../../lib/voice';
import './DocVoice.css';

/** CLAUDE IN THE DOC (founder 2026-11-26: "we need the brain in every piece
 *  of content… read my next step to me as I'm cooking — or ask it questions
 *  about the recipe, instead of having to read while cooking"; "how much
 *  butter do I add again?"; "hey brain"). A panel on any doc:
 *    · Read it to me — step by step, with Back · Repeat · Next (by tap, or by
 *      voice: "Hey Brain, next").
 *    · Ask — type or talk; the question rides to the brain with this doc
 *      attached (the server reads the doc and checks it may), and the answer
 *      shows here and is spoken.
 *    · Hands-free — "Hey Brain" / "Hey Claude" listening while this panel is
 *      open and the screen is on. */

type Step = { text: string; head: boolean };

function stepsFrom(kind: string, html: string, body: string, slides?: { title?: string; body?: string }[]): Step[] {
  if (kind === 'slides') {
    return (slides ?? []).flatMap((s) => [s.title, s.body].filter((t): t is string => !!t?.trim()).map((t, i) => ({ text: t.trim(), head: i === 0 })));
  }
  if (html && typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out: Step[] = [];
    doc.body.querySelectorAll('h1,h2,h3,p,li,blockquote,pre').forEach((el) => {
      if (el.tagName === 'P' && el.closest('li')) return; // a list item already carries it
      const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (t) out.push({ text: t, head: /^H[1-3]$/.test(el.tagName) });
    });
    if (out.length) return out;
  }
  return body.split(/\n+/).map((t) => t.trim()).filter(Boolean).map((t) => ({ text: t, head: false }));
}

export default function DocVoice({ doc, html, body, onClose }: {
  doc: { id: string; kind: string; title: string; chat_id?: string | null; data?: { slides?: { title?: string; body?: string }[] } | null };
  html: string; body: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const steps = useMemo(() => stepsFrom(doc.kind, html, body, doc.data?.slides), [doc.kind, html, body, doc.data?.slides]);
  // Start at the first step under a heading that reads like the method.
  const firstMethod = useMemo(() => {
    const i = steps.findIndex((s) => s.head && /instruction|direction|method|steps|preparation/i.test(s.text));
    return i >= 0 && i + 1 < steps.length ? i + 1 : 0;
  }, [steps]);
  const [at, setAt] = useState(firstMethod);
  const atRef = useRef(at); atRef.current = at;
  const speakingNow = useSpeaking();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ q: string; a: string } | null>(null);
  const [err, setErr] = useState('');
  const [convo, setConvo] = useState<string | null>(null);
  const [handsFree, setHandsFree] = useState(false);
  const [listening, setListening] = useState(false);
  // A room's doc answers to its room's switches (checked on the server).
  const aiOn = doc.chat_id ? true : aiDoorOn('saved');

  useEffect(() => () => stopSpeaking(), []);

  const say = (i: number) => {
    const s = steps[i];
    if (!s) return;
    setAt(i);
    void speak(s.head ? `${s.text}.` : s.text);
  };
  const go = (d: number) => say(Math.max(0, Math.min(steps.length - 1, atRef.current + d)));

  const ask = async (question: string, voice: boolean) => {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true); setErr(''); setAnswer({ q: text, a: '' }); setQ('');
    try {
      const row = await postToAssistantFeed(text, undefined, 'general', undefined, convo ?? undefined,
        ['saved'], undefined, undefined, { doc_id: doc.id, title: doc.title, voice });
      if (row.convo_id) setConvo(row.convo_id);
      // Wait for the reply in this conversation (realtime, with a slow poll
      // as the net under a dropped socket).
      const reply = await new Promise<string>((resolve, reject) => {
        let done = false;
        const finish = (t: string) => { if (!done) { done = true; cleanup(); resolve(t); } };
        const check = async () => {
          const { data } = await supabase.from('assistant_feed_posts').select('body, created_at')
            .eq('convo_id', row.convo_id).eq('author', 'claude').gt('created_at', row.created_at)
            .order('created_at', { ascending: true }).limit(1);
          const r = (data as { body: string }[] | null)?.[0];
          if (r) finish(r.body);
        };
        const ch = supabase.channel(`docvoice:${row.id}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'assistant_feed_posts', filter: `convo_id=eq.${row.convo_id}` },
            (pl) => { const r = pl.new as { author: string; body: string }; if (r.author === 'claude') finish(r.body); })
          .subscribe();
        const poll = window.setInterval(() => void check(), 2500);
        const giveUp = window.setTimeout(() => { if (!done) { done = true; cleanup(); reject(new Error('The answer is taking a while — it will be in your brain’s conversation.')); } }, 90000);
        function cleanup() { window.clearInterval(poll); window.clearTimeout(giveUp); void supabase.removeChannel(ch); }
      });
      setAnswer({ q: text, a: reply });
      void speak(reply);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That didn’t reach the brain.');
    } finally { setBusy(false); }
  };

  const talk = async () => {
    if (listening) return;
    stopSpeaking();
    setListening(true);
    const l = listenOnce((p) => setQ(p));
    const said = await l.done;
    setListening(false);
    if (said) void ask(said, true);
  };

  // HANDS-FREE: "Hey Brain, next" / "Hey Brain, how much butter?"
  const askRef = useRef(ask); askRef.current = ask;
  useEffect(() => {
    if (!handsFree) return;
    const w = startWakeWord((said) => {
      const s = said.toLowerCase().replace(/[.!?]+$/, '').trim();
      if (/^(next|next step|go on|continue)$/.test(s)) go(1);
      else if (/^(back|go back|previous|last step)$/.test(s)) go(-1);
      else if (/^(repeat|again|say that again|what was that)$/.test(s)) say(atRef.current);
      else if (/^(stop|quiet|pause|shush)$/.test(s)) stopSpeaking();
      else void askRef.current(said, true);
    });
    return () => w.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handsFree]);

  const cur = steps[at];
  return (
    <div className="dvoice" role="dialog" aria-label="Claude in this doc">
      <div className="dvoice__head">
        <span className="dvoice__mark"><Icon name="brain" size={16} /></span>
        <span className="dvoice__title">Claude · {doc.title || 'this doc'}</span>
        <button className="dvoice__x" onClick={() => { stopSpeaking(); onClose(); }} aria-label="Close">×</button>
      </div>

      {canSpeak() && steps.length > 0 && (
        <div className="dvoice__steps">
          <p className="dvoice__eyebrow">Read it to me · {at + 1} of {steps.length}</p>
          <p className={'dvoice__step' + (cur?.head ? ' is-head' : '')}>{cur?.text}</p>
          <div className="dvoice__ctl">
            <button onClick={() => go(-1)} disabled={at === 0}>‹ Back</button>
            <button onClick={() => (speakingNow ? stopSpeaking() : say(at))}>{speakingNow ? 'Stop' : 'Read this'}</button>
            <button className="is-main" onClick={() => go(1)} disabled={at >= steps.length - 1}>Next ›</button>
          </div>
        </div>
      )}

      {!aiOn ? (
        <p className="dvoice__note">Drive AI is off, so Claude can’t read this doc to answer questions. Turn it on in Profile → Privacy.</p>
      ) : (
        <>
          <form className="dvoice__ask" onSubmit={(e) => { e.preventDefault(); void ask(q, false); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this…" aria-label="Ask Claude about this doc" />
            {canListen() && (
              <button type="button" className={'dvoice__mic' + (listening ? ' is-live' : '')} onClick={() => void talk()} aria-label="Ask by voice">
                <Icon name="mic" size={17} />
              </button>
            )}
            <button type="submit" className="dvoice__send" disabled={!q.trim() || busy} aria-label="Ask"><Icon name="send" size={15} /></button>
          </form>
          {answer && (
            <div className="dvoice__answer" aria-live="polite">
              <p className="dvoice__q">“{answer.q}”</p>
              {answer.a ? <p className="dvoice__a">{renderBold(answer.a, (t) => t)}</p> : <p className="dvoice__a is-wait">Reading the doc…</p>}
              {answer.a && canSpeak() && <button className="dvoice__again" onClick={() => void speak(answer.a)}><Icon name="speaker" size={13} /> Say it again</button>}
            </div>
          )}
          {err && <p className="dvoice__note">{err}</p>}
          {canListen() ? (
            <label className="dvoice__hands">
              <input type="checkbox" checked={handsFree} onChange={(e) => setHandsFree(e.target.checked)} />
              <span><strong>Hands-free</strong> — say “Hey Brain” (or “Hey Claude”), then a question, or “next”, “back”, “repeat”. Listens only while this panel is open and your screen is on; your browser’s speech service turns what you say into words.</span>
            </label>
          ) : (
            <p className="dvoice__fine">To talk instead of type here, use your keyboard’s mic — or open Lichen in Safari or Chrome for hands-free “Hey Brain”.</p>
          )}
          {convo && <button className="dvoice__open" onClick={() => navigate(`/assistant/feed?thread=general&convo=${convo}&sec=saved`)}>Open this conversation with Claude ›</button>}
        </>
      )}
    </div>
  );
}

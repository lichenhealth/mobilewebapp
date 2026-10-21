import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { supabase } from '../lib/supabase';
import {
  loadChatDoc, loadVotes, castVote, retractVote,
  DOC_KIND_LABEL, DOC_KIND_ICON,
  type ChatDocRow, type PollVote,
} from '../lib/chatDocsApi';
import './ChatDocCard.css';

/** The gray slashed brain — the decal for content no assistant ever reads
 *  (founder 2026-10-21: "a little decal that shows a gray brain with a line
 *  thru it"). The ai-door's faint+slash grammar at decal size. */
export function DocAiMark({ title = 'AI-free — no assistant reads this' }: { title?: string }) {
  return (
    <span className="docai" title={title} aria-label={title}>
      <Icon name="brain" size={12} />
      <span className="docai__slash" aria-hidden />
    </span>
  );
}

/** A poll, live: options are buttons, your choice is lit, voters are NAMES
 *  (people, never leaderboards). Used in the chat card and on /docs/:id. */
export function PollBody({ doc, me, names }: { doc: ChatDocRow; me: string; names: Record<string, string> }) {
  const [votes, setVotes] = useState<PollVote[]>([]);
  useEffect(() => {
    let active = true;
    void loadVotes(doc.id).then((v) => { if (active) setVotes(v); });
    const channel = supabase
      .channel(`pollvotes:${doc.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_poll_votes', filter: `doc_id=eq.${doc.id}` }, () => {
        void loadVotes(doc.id).then((v) => { if (active) setVotes(v); });
      })
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [doc.id]);

  const mine = votes.find((v) => v.profile_id === me)?.option_idx ?? null;
  const options = doc.data?.options ?? [];
  const pick = async (idx: number) => {
    try {
      if (mine === idx) {
        setVotes((cur) => cur.filter((v) => v.profile_id !== me));
        await retractVote(me, doc.id);
      } else {
        setVotes((cur) => [...cur.filter((v) => v.profile_id !== me), { doc_id: doc.id, profile_id: me, option_idx: idx }]);
        await castVote(me, doc.id, idx);
      }
    } catch (e) { console.warn('vote:', e); void loadVotes(doc.id).then(setVotes); }
  };

  return (
    <div className="cdoc__poll">
      {options.map((opt, idx) => {
        const voters = votes.filter((v) => v.option_idx === idx);
        const shown = voters.slice(0, 4).map((v) => (names[v.profile_id] ?? 'Member').split(' ')[0]);
        const extra = voters.length - shown.length;
        return (
          <button
            key={idx}
            className={'cdoc__opt' + (mine === idx ? ' is-mine' : '')}
            onClick={() => void pick(idx)}
          >
            <span className="cdoc__opt-mark" aria-hidden>{mine === idx ? '●' : '○'}</span>
            <span className="cdoc__opt-text">{opt}</span>
            {voters.length > 0 && (
              <span className="cdoc__opt-who">{shown.join(', ')}{extra > 0 ? ` +${extra}` : ''}</span>
            )}
          </button>
        );
      })}
      <p className="cdoc__poll-hint">Tap to choose — tap again to take it back.</p>
    </div>
  );
}

/** The card a composer-born doc/poll/spreadsheet rides into the room on
 *  (rendered from a message's 'docref' attachment). Polls live right in the
 *  card; docs and spreadsheets are doors into /docs/:id. */
export default function DocRefCard({ docId, me, names }: { docId: string; me: string; names: Record<string, string> }) {
  const navigate = useNavigate();
  const [doc, setDoc] = useState<ChatDocRow | null | 'gone'>(null);
  useEffect(() => {
    let active = true;
    void loadChatDoc(docId).then((d) => { if (active) setDoc(d ?? 'gone'); });
  }, [docId]);
  if (doc === null) return <div className="cdoc cdoc--loading">…</div>;
  if (doc === 'gone') return <div className="cdoc cdoc--loading">This item was removed from the room&rsquo;s drive.</div>;
  return (
    <div className="cdoc">
      <div className="cdoc__head">
        <Icon name={DOC_KIND_ICON[doc.kind]} size={15} />
        <span className="cdoc__kind">{DOC_KIND_LABEL[doc.kind]}</span>
        {!doc.ai_enabled && <DocAiMark />}
      </div>
      <p className="cdoc__title">{doc.title}</p>
      {doc.kind === 'poll' ? (
        <PollBody doc={doc} me={me} names={names} />
      ) : (
        <button className="cdoc__open" onClick={() => navigate(`/docs/${doc.id}`)}>
          Open {doc.kind === 'sheet' ? 'the spreadsheet' : 'the doc'} ›
        </button>
      )}
    </div>
  );
}

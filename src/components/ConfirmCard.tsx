import { useEffect, useState } from 'react';
import { Bolt } from './CurrentcyCard';
import {
  cancelProposal, confirmProposal, loadProposals, MONEY_CEILING_NOTE, type Proposal,
} from '../lib/assistantAllowanceApi';
import './ConfirmCard.css';

// THE CONFIRM CARD (founder 2026-11-08: "give them a 'don't ask me this in
// the future' or 'always allow' - i want as little friction as possible").
// The assistant proposed; this is where the PERSON decides. Reads the
// proposal's live status so a card never offers a decision already made.

export default function ConfirmCard({ id, summary, kind, amount }: {
  id: string; summary: string; kind: string; amount?: number;
}) {
  const [p, setP] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    void loadProposals([id]).then((m) => { if (live) setP(m[id] ?? null); });
    return () => { live = false; };
  }, [id]);
  const reload = async () => setP((await loadProposals([id]))[id] ?? null);

  const act = async (always: boolean) => {
    setBusy(true); setErr('');
    try { await confirmProposal(id, always); await reload(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true); setErr('');
    try { await cancelProposal(id); await reload(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const status = p?.status ?? 'pending';
  const money = kind === 'send_currentcy';
  const big = money && (amount ?? 0) > 500;
  // A floor change is the safeguard itself — it always asks, so no Always allow.
  const askAlways = kind === 'set_floor';
  return (
    <div className={`ccard ccard--${status}`}>
      <p className="ccard__what">
        {money && <Bolt />}<span>{p?.summary ?? summary}</span>
      </p>
      {status === 'pending' && (
        <>
          <div className="ccard__btns">
            <button type="button" className="ccard__btn ccard__btn--go" disabled={busy} onClick={() => void act(false)}>Confirm</button>
            {!askAlways && <button type="button" className="ccard__btn" disabled={busy} onClick={() => void act(true)}>Always allow</button>}
            <button type="button" className="ccard__btn ccard__btn--quiet" disabled={busy} onClick={() => void cancel()}>Not now</button>
          </div>
          {money && <p className="ccard__fine">{MONEY_CEILING_NOTE}</p>}
          {big && <p className="ccard__fine">Over ⚡500 waits 24 hours after you confirm — you can cancel it any time before then.</p>}
          {askAlways && <p className="ccard__fine">Your floor is a safeguard, so changing it always asks you first.</p>}
          {!money && !askAlways && <p className="ccard__fine">Always allow means Claude won't ask before doing this again. You can take it back in Profile → Privacy.</p>}
        </>
      )}
      {status === 'held' && (
        <div className="ccard__state">
          <span>Holding until {p?.execute_after ? new Date(p.execute_after).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'tomorrow'} — then the Current moves.</span>
          <button type="button" className="ccard__btn ccard__btn--quiet" disabled={busy} onClick={() => void cancel()}>Cancel</button>
        </div>
      )}
      {status === 'done' && <p className="ccard__state ccard__state--ok">Done ✓</p>}
      {status === 'cancelled' && <p className="ccard__state">Not done — you said not now.</p>}
      {status === 'failed' && <p className="ccard__state ccard__state--bad">Didn't go through: {p?.result}</p>}
      {err && <p className="ccard__state ccard__state--bad">{err}</p>}
    </div>
  );
}

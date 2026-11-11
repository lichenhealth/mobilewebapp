import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import { ActingGate } from '../components/ActingGate';
import { useTopBackFor } from '../lib/topBack';
import {
  mailEnabled, listMailAccounts, connectMail, disconnectMail, loadInbox, loadMailThread,
  modifyMailThread, sendMail, saveMailDraft, senderName, senderAddress,
  type MailAccount, type ThreadSummary, type MailThread,
} from '../lib/mailApi';
import './Mail.css';

/** LICHEN MAIL (founder 2026-11-11: "let's create 'Mail' on Lichen and I can
 *  test it for personal use" — after "consolidate connect@lichen.health,
 *  galyn@lichen.health, galyn@galynburke.com and galynburke@gmail.com… then
 *  having the Ai brain help you with all your email accounts"). Every inbox
 *  in one list, read live from Google; a thread opens as plain text (an
 *  email's HTML is a stranger's markup — it never renders inside Lichen). */

const when = (iso: string) => {
  const d = new Date(iso); const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
const longWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const shortAcct = (e: string) => e.length > 26 ? e.split('@')[0] + '@…' : e;

type Draft = { accountId: string; threadId?: string; to: string; cc: string; subject: string; body: string };

export default function Mail() {
  const { user } = useAuth();
  const { actor, ready: actingReady } = useActing();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [acctFilter, setAcctFilter] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [inboxErrs, setInboxErrs] = useState<{ account: string; error: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<MailThread | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const openKey = params.get('thread'); // "<accountId>:<threadId>"
  const [openAcct, openThread] = openKey ? openKey.split(':') : [null, null];

  useEffect(() => { void mailEnabled(user?.id).then(setAllowed); }, [user?.id]);
  const refreshAccounts = useCallback(() => listMailAccounts().then(setAccounts), []);
  useEffect(() => { if (allowed) void refreshAccounts(); }, [allowed, refreshAccounts]);

  // The Google round trip lands here with ?mail=…
  useEffect(() => {
    const m = params.get('mail');
    if (!m) return;
    const who = params.get('account');
    setMsg(m === 'connected' ? `${who ?? 'Your inbox'} is connected ✓`
      : m === 'denied' ? 'Google wasn’t given permission — nothing was connected.'
      : m === 'noscope' ? 'Google connected without mail permission — try again and tick the Gmail box.'
      : m === 'expired' ? 'That took too long — try connecting again.'
      : 'Something went wrong connecting — try again.');
    const next = new URLSearchParams(params); next.delete('mail'); next.delete('account');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const fetchInbox = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const r = await loadInbox(acctFilter, query);
      setThreads(r.threads); setInboxErrs(r.errors);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'The inbox didn’t load.');
      setThreads([]);
    } finally { setLoading(false); }
  }, [acctFilter]);
  useEffect(() => { if (allowed && accounts.length) void fetchInbox(q); /* q runs on submit */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, accounts.length, acctFilter]);

  useEffect(() => {
    if (!openAcct || !openThread) { setOpen(null); return; }
    let live = true;
    setOpen(null);
    loadMailThread(openAcct, openThread)
      .then((t) => {
        if (!live) return;
        setOpen(t);
        setThreads((cur) => cur?.map((x) => (x.thread_id === openThread ? { ...x, unread: false } : x)) ?? cur);
      })
      .catch((e) => live && setMsg(e instanceof Error ? e.message : 'That thread didn’t open.'));
    return () => { live = false; };
  }, [openAcct, openThread]);

  const closeThread = useCallback(() => {
    const next = new URLSearchParams(params); next.delete('thread');
    setParams(next); setDraft(null);
  }, [params, setParams]);
  useTopBackFor(closeThread, !!openKey);

  const mine = useMemo(() => new Set(accounts.map((a) => a.email.toLowerCase())), [accounts]);

  function openThreadRow(t: ThreadSummary) {
    setDraft(null); setMsg(null);
    const next = new URLSearchParams(params); next.set('thread', `${t.account_id}:${t.thread_id}`);
    setParams(next);
  }

  function startReply(all: boolean) {
    if (!open || !openAcct || !openThread) return;
    const last = open.messages[open.messages.length - 1];
    const fromMe = mine.has(senderAddress(last.from).toLowerCase());
    const to = fromMe ? last.to : last.from;
    const cc = all ? [last.to, last.cc].filter(Boolean).join(', ').split(',')
      .map((x) => x.trim()).filter((x) => x && !mine.has(senderAddress(x).toLowerCase()) && senderAddress(x) !== senderAddress(to)).join(', ') : '';
    setDraft({ accountId: openAcct, threadId: openThread, to, cc, subject: '', body: '' });
  }

  async function act(kind: 'archive' | 'unread' | 'star') {
    if (!openAcct || !openThread) return;
    setBusy(kind);
    try {
      if (kind === 'archive') await modifyMailThread(openAcct, openThread, [], ['INBOX']);
      if (kind === 'unread') await modifyMailThread(openAcct, openThread, ['UNREAD'], []);
      if (kind === 'star') await modifyMailThread(openAcct, openThread, ['STARRED'], []);
      if (kind !== 'star') {
        setThreads((cur) => kind === 'archive' ? cur?.filter((x) => x.thread_id !== openThread) ?? cur
          : cur?.map((x) => (x.thread_id === openThread ? { ...x, unread: true } : x)) ?? cur);
        closeThread();
      }
      setMsg(kind === 'archive' ? 'Archived — it’s out of the inbox, still in All Mail.' : kind === 'unread' ? 'Marked unread.' : 'Starred ✓');
    } catch (e) { setMsg(e instanceof Error ? e.message : 'That didn’t go through.'); }
    finally { setBusy(null); }
  }

  async function submit(asDraft: boolean) {
    if (!draft) return;
    setBusy(asDraft ? 'draft' : 'send'); setMsg(null);
    try {
      const o = { ...draft, threadId: draft.threadId, cc: draft.cc || undefined };
      if (asDraft) await saveMailDraft(o); else await sendMail(o);
      setDraft(null);
      setMsg(asDraft ? 'Saved to your drafts in Gmail ✓' : 'Sent ✓');
      if (!asDraft && openAcct && openThread) {
        setOpen(await loadMailThread(openAcct, openThread));
      }
    } catch (e) { setMsg(e instanceof Error ? e.message : 'That didn’t send.'); }
    finally { setBusy(null); }
  }

  function askBrain() {
    const ask = open && openAcct && openThread
      ? `Read my email thread "${open.subject}" (mail account ${accounts.find((a) => a.id === openAcct)?.email}, thread ${openThread}) — summarize it and suggest a reply.`
      : 'Look through my inboxes and tell me what needs my attention.';
    navigate(`/assistant/feed?thread=general&convo=new&ask=${encodeURIComponent(ask)}`);
  }

  if (!actingReady) return null;
  if (actor.type !== 'self') return <ActingGate what="your mail" icon="mail" />;
  if (allowed === null) return null;
  if (!allowed) {
    return (
      <div className="mail">
        <header className="myc__head"><h1 className="myc__title">Mail</h1>
          <p className="myc__sub">Mail is in a personal test right now. It opens to more members once it’s proven.</p></header>
      </div>
    );
  }

  const composer = draft && (
    <div className="mail__compose">
      {!draft.threadId && (
        <label className="mail__field"><span>From</span>
          <select value={draft.accountId} onChange={(e) => setDraft({ ...draft, accountId: e.target.value })}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
          </select>
        </label>
      )}
      {draft.threadId && <p className="mail__fine">Replying from {accounts.find((a) => a.id === draft.accountId)?.email}</p>}
      <label className="mail__field"><span>To</span>
        <input value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
      <label className="mail__field"><span>Cc</span>
        <input value={draft.cc} onChange={(e) => setDraft({ ...draft, cc: e.target.value })}
          autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
      {!draft.threadId && (
        <label className="mail__field"><span>Subject</span>
          <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></label>
      )}
      <textarea className="mail__body-in" rows={8} value={draft.body} autoFocus
        placeholder="Write it here…" onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
      <div className="mail__compose-acts">
        <button className="btn btn--primary" disabled={!!busy} onClick={() => void submit(false)}>{busy === 'send' ? 'Sending…' : 'Send'}</button>
        <button className="btn" disabled={!!busy} onClick={() => void submit(true)}>{busy === 'draft' ? 'Saving…' : 'Save as draft'}</button>
        <button className="mail__quiet" onClick={() => setDraft(null)}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div className="mail">
      {!openKey && (
        <header className="myc__head">
          <h1 className="myc__title">Mail</h1>
          <p className="myc__sub">All your inboxes in one place — read live from Google, never stored on Lichen.</p>
        </header>
      )}

      {msg && <p className="mail__msg" role="status">{msg}</p>}

      {!openKey && accounts.length > 0 && (
        <>
          <div className="mail__tools">
            <button className={'icon-row__btn' + (searchOpen ? ' icon-row__btn--here' : '')} data-tip="Search mail" aria-label="Search mail"
              onClick={() => { setSearchOpen((o) => !o); setTimeout(() => searchRef.current?.focus(), 0); }}>
              <Icon name="search" size={16} /></button>
            <button className="icon-row__btn" data-tip="New email" aria-label="New email"
              onClick={() => setDraft({ accountId: acctFilter ?? accounts[0].id, to: '', cc: '', subject: '', body: '' })}>
              <Icon name="plus" size={16} /></button>
            <button className="icon-row__btn" data-tip="Work with AI — your mail" aria-label="Ask the brain about your mail" onClick={askBrain}>
              <Icon name="brain" size={16} /></button>
          </div>
          {searchOpen && (
            <form className="mail__search" onSubmit={(e) => { e.preventDefault(); void fetchInbox(q); }}>
              <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search — from:katie, invoice, has:attachment…" />
              <button className="btn" type="submit">Search</button>
              {q && <button type="button" className="mail__quiet" onClick={() => { setQ(''); void fetchInbox(''); }}>Clear</button>}
            </form>
          )}
          {accounts.length > 1 && (
            <div className="mail__lenses" role="tablist">
              <button className={'mail__lens' + (!acctFilter ? ' is-on' : '')} onClick={() => setAcctFilter(null)}>All inboxes</button>
              {accounts.map((a) => (
                <button key={a.id} className={'mail__lens' + (acctFilter === a.id ? ' is-on' : '')} title={a.email}
                  onClick={() => setAcctFilter(acctFilter === a.id ? null : a.id)}>{shortAcct(a.email)}</button>
              ))}
            </div>
          )}
          {!openKey && composer}
          {inboxErrs.map((e) => <p key={e.account} className="mail__err">{e.account}: {e.error}</p>)}
          {loading && !threads && <p className="mail__fine">Opening your inboxes…</p>}
          {threads && threads.length === 0 && !loading && <p className="mail__fine">{q ? 'Nothing matched that search.' : 'Inbox zero. 🌿'}</p>}
          {threads && threads.length > 0 && (
            <ul className={'mail__list' + (loading ? ' is-loading' : '')}>
              {threads.map((t) => (
                <li key={t.account_id + t.thread_id}>
                  <button className={'mail__row' + (t.unread ? ' is-unread' : '')} onClick={() => openThreadRow(t)}>
                    <span className="mail__row-top">
                      <span className="mail__row-from">{senderName(t.from)}{t.count > 1 && <em> {t.count}</em>}</span>
                      <span className="mail__row-when">{when(t.date)}</span>
                    </span>
                    <span className="mail__row-subj">{t.subject}</span>
                    <span className="mail__row-snip">{t.snippet}</span>
                    {accounts.length > 1 && !acctFilter && <span className="mail__row-acct">{t.account}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {openKey && (
        <article className="mail__thread">
          {!open && <p className="mail__fine">Opening…</p>}
          {open && (
            <>
              <h1 className="mail__thread-subj">{open.subject}</h1>
              <div className="mail__thread-acts">
                <button className="btn" onClick={() => startReply(false)}>Reply</button>
                <button className="btn" onClick={() => startReply(true)}>Reply all</button>
                <button className="btn" disabled={!!busy} onClick={() => void act('archive')}>Archive</button>
                <button className="mail__quiet" disabled={!!busy} onClick={() => void act('unread')}>Mark unread</button>
                <button className="mail__quiet" disabled={!!busy} onClick={() => void act('star')}>Star</button>
                <button className="icon-row__btn mail__brain" data-tip="Ask the brain about this thread" aria-label="Ask the brain about this thread" onClick={askBrain}>
                  <Icon name="brain" size={16} /></button>
              </div>
              {open.messages.map((m) => (
                <section key={m.id} className="mail__msgcard">
                  <header className="mail__msghead">
                    <span className="mail__msgfrom">{senderName(m.from)} <em>{senderAddress(m.from)}</em></span>
                    <span className="mail__msgwhen">{longWhen(m.date)}</span>
                    <span className="mail__msgto">to {m.to}{m.cc ? ` · cc ${m.cc}` : ''}</span>
                  </header>
                  <div className="mail__msgbody">{m.body || '(no text in this message)'}</div>
                  {m.attachments.length > 0 && <p className="mail__fine">📎 {m.attachments.join(', ')} — open it in Gmail for now.</p>}
                </section>
              ))}
              {composer}
            </>
          )}
        </article>
      )}

      {!openKey && (
        <section className="mail__accounts">
          <h2 className="mail__h2">Connected inboxes</h2>
          {accounts.length === 0 && (
            <p className="mail__fine">Connect a Gmail or Google Workspace inbox to see it here. You can connect several — they all land in one list.</p>
          )}
          <ul>
            {accounts.map((a) => (
              <li key={a.id} className="mail__acct">
                <span className="mail__acct-email">{a.email}
                  {a.last_error && <em className="mail__acct-warn"> · needs reconnecting</em>}</span>
                <span className="mail__acct-acts">
                  {a.last_error && <button className="mail__quiet" onClick={() => void connectMail(a.email).catch((e) => setMsg(e.message))}>Reconnect</button>}
                  <button className={'mail__quiet mail__quiet--del' + (sure === a.id ? ' is-sure' : '')}
                    onBlur={() => setSure((s) => (s === a.id ? null : s))}
                    onClick={() => {
                      if (sure !== a.id) { setSure(a.id); return; }
                      void disconnectMail(a.id).then(() => { setSure(null); void refreshAccounts(); setThreads(null); setMsg(`${a.email} is disconnected — Lichen no longer has access.`); })
                        .catch((e) => setMsg(e.message));
                    }}>{sure === a.id ? 'Disconnect?' : 'Disconnect'}</button>
                </span>
              </li>
            ))}
          </ul>
          <button className="btn" disabled={busy === 'connect'}
            onClick={() => { setBusy('connect'); void connectMail().catch((e) => { setMsg(e.message); setBusy(null); }); }}>
            {busy === 'connect' ? 'Opening Google…' : accounts.length ? '+ Connect another inbox' : '+ Connect a Gmail inbox'}
          </button>
          <p className="mail__fine">Google will warn that the app isn’t verified yet — that’s expected while Mail is a personal test. Google re-asks about once a week until it is.</p>
        </section>
      )}
    </div>
  );
}

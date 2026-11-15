import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AssistantDoor from '../components/AssistantDoor';
import MailBody, { MailFiles } from '../components/MailBody';
import { Icon, type IconName } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import { ActingGate } from '../components/ActingGate';
import { useTopBackFor } from '../lib/topBack';
import {
  mailEnabled, listMailAccounts, connectMail, disconnectMail, loadInbox, loadMailThread,
  modifyMailThread, trashMailThread, unsubscribeMailThread, sendMail, saveMailDraft, senderName, senderAddress,
  sendMailDraft, updateMailDraft, discardMailDraft, type MailMessage,
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
  // Google's categories + filters as bubbles (founder 2026-11-14: "help people
  // navigate by promotions and other types of mail, like google… search just
  // lets you apply filters and they show up as bubbles").
  const [cat, setCat] = useState<MailCat | null>(null);
  const [filters, setFilters] = useState<string[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [inboxErrs, setInboxErrs] = useState<{ account: string; error: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<MailThread | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [unsubUrl, setUnsubUrl] = useState<string | null>(null);
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
      const r = await loadInbox(acctFilter, composeQuery(query, filters, cat));
      setThreads(r.threads); setInboxErrs(r.errors);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'The inbox didn’t load.');
      setThreads([]);
    } finally { setLoading(false); }
  }, [acctFilter, filters, cat]);
  useEffect(() => { if (allowed && accounts.length) void fetchInbox(q); /* q runs on submit */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, accounts.length, acctFilter, filters, cat]);
  const runSearch = () => {
    const { ops, rest } = pullOps(q);
    if (ops.length) { setQ(rest); setFilters((f) => [...new Set([...f, ...ops])]); }   // the effect re-runs
    else void fetchInbox(q);
  };
  const toggleFilter = (op: string) => setFilters((f) => (f.includes(op) ? f.filter((x) => x !== op) : [...f, op]));

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
    setDraft(null); setMsg(null); setUnsubUrl(null);
    const next = new URLSearchParams(params); next.set('thread', `${t.account_id}:${t.thread_id}`);
    setParams(next);
  }

  function startReply(all: boolean) {
    if (!open || !openAcct || !openThread) return;
    const real = open.messages.filter((m) => !m.draft);
    const last = real[real.length - 1] ?? open.messages[open.messages.length - 1];
    const fromMe = mine.has(senderAddress(last.from).toLowerCase());
    const to = fromMe ? last.to : last.from;
    const cc = all ? [last.to, last.cc].filter(Boolean).join(', ').split(',')
      .map((x) => x.trim()).filter((x) => x && !mine.has(senderAddress(x).toLowerCase()) && senderAddress(x) !== senderAddress(to)).join(', ') : '';
    setDraft({ accountId: openAcct, threadId: openThread, to, cc, subject: '', body: '' });
  }

  async function act(kind: 'archive' | 'unread' | 'star' | 'trash') {
    if (!openAcct || !openThread) return;
    setBusy(kind); setUnsubUrl(null);
    try {
      if (kind === 'trash') await trashMailThread(openAcct, openThread);
      if (kind === 'archive') await modifyMailThread(openAcct, openThread, [], ['INBOX']);
      if (kind === 'unread') await modifyMailThread(openAcct, openThread, ['UNREAD'], []);
      // STAR TOGGLES (founder 2026-11-14: "star doesn't seem to do anything and
      // i don't see a star icon") — it only ever added, with no state shown.
      const wasStarred = !!open?.starred;
      if (kind === 'star') {
        await modifyMailThread(openAcct, openThread, wasStarred ? [] : ['STARRED'], wasStarred ? ['STARRED'] : []);
        setOpen((cur) => (cur ? { ...cur, starred: !wasStarred } : cur));
        setThreads((cur) => cur?.map((x) => (x.thread_id === openThread && x.account_id === openAcct ? { ...x, starred: !wasStarred } : x)) ?? cur);
      }
      if (kind !== 'star') {
        setThreads((cur) => kind === 'archive' || kind === 'trash' ? cur?.filter((x) => x.thread_id !== openThread) ?? cur
          : cur?.map((x) => (x.thread_id === openThread ? { ...x, unread: true } : x)) ?? cur);
        closeThread();
      }
      setMsg(kind === 'trash' ? 'Moved to Trash — restorable there for 30 days.' : kind === 'archive' ? 'Archived — it’s out of the inbox, still in All Mail.' : kind === 'unread' ? 'Marked unread.' : (open?.starred ? 'Unstarred.' : 'Starred ✓'));
    } catch (e) { setMsg(e instanceof Error ? e.message : 'That didn’t go through.'); }
    finally { setBusy(null); }
  }

  // UNSUBSCRIBE (founder 2026-11-14) — the sender's own List-Unsubscribe
  // header, the way Gmail's button works; a page-only sender hands its link
  // back for the person to open and confirm.
  async function unsubscribe() {
    if (!openAcct || !openThread) return;
    setBusy('unsub'); setUnsubUrl(null);
    try {
      const r = await unsubscribeMailThread(openAcct, openThread);
      const who = senderName(r.from) || 'this sender';
      if (r.status === 'unsubscribed') setMsg(`Unsubscribed from ${who} ✓ — it can take a few days for their mail to stop.`);
      else if (r.status === 'emailed') setMsg(`Unsubscribe request emailed to ${who} ✓ (${r.how?.replace(/^sent /, '')}) — it can take a few days.`);
      else if (r.status === 'needs_you') { setMsg(`${who} only unsubscribes on their own page — open it and confirm there:`); setUnsubUrl(r.url ?? null); }
      else if (r.status === 'no_option') setMsg(`${who} doesn’t offer an unsubscribe option. Ask the brain to filter their mail straight to Trash instead.`);
      else setMsg(r.error ? `That didn’t go through: ${r.error}` : 'That didn’t go through.');
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

  // THE MAIL BRAIN, WITH THE EMAIL ATTACHED (founder 2026-11-14: it "takes me
  // to the general brain, not the mail brain; and… that should be like an
  // attachment in a chat, with the clear space to write additional context,
  // below it"): the Mail brief opens narrowed to that inbox, the thread rides
  // as a card above an EMPTY box.
  function askBrain() {
    if (!open || !openAcct || !openThread) { navigate('/assistant?section=mail'); return; }
    const last = open.messages[open.messages.length - 1];
    const q = new URLSearchParams({
      section: 'mail', mbox: openAcct, mref: `${openAcct}:${openThread}`,
      msubj: open.subject.slice(0, 200), mfrom: senderName(last?.from ?? '').slice(0, 120),
      macct: accounts.find((a) => a.id === openAcct)?.email ?? '',
    });
    navigate(`/assistant?${q.toString()}`);
  }

  if (!actingReady) return null;
  if (actor.type !== 'self') return <ActingGate what="your mail" icon="mail" />;
  if (allowed === null) return null;
  if (!allowed) {
    return (
      <div className="mail">
        <header className="myc__head"><h1 className="myc__title">Mail</h1>
          <p className="myc__sub">Coming soon — every inbox you have, read and answered in one place, filed by person beside your chats.</p></header>
        <p className="mail__fine" style={{ textAlign: 'center' }}>Mail is in a small private test right now. It opens to more members once it’s proven.</p>
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
        <button className="btn btn-primary" disabled={!!busy} onClick={() => void submit(false)}>{busy === 'send' ? 'Sending…' : 'Send'}</button>
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

      {msg && <p className="mail__msg" role="status">{msg}{unsubUrl && <> <a className="link-cue" href={unsubUrl} target="_blank" rel="noopener noreferrer">Open their unsubscribe page ↗</a></>}</p>}

      {!openKey && accounts.length > 0 && (
        <>
          <div className="mail__tools">
            <button className={'icon-row__btn' + (searchOpen ? ' icon-row__btn--here' : '')} data-tip="Search mail" aria-label="Search mail"
              onClick={() => { setSearchOpen((o) => !o); setTimeout(() => searchRef.current?.focus(), 0); }}>
              <Icon name="search" size={16} /></button>
            <button className="icon-row__btn" data-tip="New email" aria-label="New email"
              onClick={() => setDraft({ accountId: acctFilter ?? accounts[0].id, to: '', cc: '', subject: '', body: '' })}>
              <Icon name="plus" size={16} /></button>
            <AssistantDoor section="mail" label="Work with AI — your mail" />
            <span className="mail__cats" role="group" aria-label="Categories">
              {CATS.map((c, i) => (
                <button key={c.id} className={'icon-row__btn' + (cat === c.id ? ' icon-row__btn--here' : '') + (i === CATS.length - 1 ? ' tip-right' : '')}
                  data-tip={c.label} aria-label={c.label} aria-pressed={cat === c.id}
                  onClick={() => setCat(cat === c.id ? null : c.id)}>
                  <Icon name={c.icon} size={16} /></button>
              ))}
            </span>
          </div>
          {searchOpen && (
            <form className="mail__search" onSubmit={(e) => { e.preventDefault(); runSearch(); }}>
              <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search — words, or from:katie, has:attachment…" />
              <button className="btn" type="submit">Search</button>
              {(q || filters.length > 0) && <button type="button" className="mail__quiet" onClick={() => { setQ(''); setFilters([]); if (!filters.length) void fetchInbox(''); }}>Clear</button>}
              <div className="mail__quick" aria-label="Add a filter">
                {QUICK.map((f) => (
                  <button type="button" key={f.op} className={'mail__chip' + (filters.includes(f.op) ? ' is-on' : '')} onClick={() => toggleFilter(f.op)}>
                    {filters.includes(f.op) ? '✓ ' : '+ '}{f.label}</button>
                ))}
              </div>
            </form>
          )}
          {(filters.length > 0 || cat) && (
            <div className="mail__bubbles" aria-label="Filters on">
              {cat && <span className="mail__bubble">{CATS.find((c) => c.id === cat)?.label}<button aria-label="Remove" onClick={() => setCat(null)}>×</button></span>}
              {filters.map((f) => <span key={f} className="mail__bubble">{prettyOp(f)}<button aria-label={`Remove ${prettyOp(f)}`} onClick={() => toggleFilter(f)}>×</button></span>)}
            </div>
          )}
          {accounts.length > 0 && (
            <div className="mail__lenses" role="tablist">
              {accounts.length > 1 && <button className={'mail__lens' + (!acctFilter ? ' is-on' : '')} onClick={() => setAcctFilter(null)}>All inboxes</button>}
              {accounts.length > 1 && accounts.map((a) => (
                <button key={a.id} className={'mail__lens' + (acctFilter === a.id ? ' is-on' : '')} title={a.email}
                  onClick={() => setAcctFilter(acctFilter === a.id ? null : a.id)}>{shortAcct(a.email)}</button>
              ))}
              {/* ADD MAIL rides the lens row (founder 2026-11-14): another
                  inbox is one tap from where the inboxes are listed. */}
              <button className="mail__lens mail__lens--add" disabled={busy === 'connect'}
                onClick={() => { setBusy('connect'); void connectMail().catch((e) => { setMsg(e.message); setBusy(null); }); }}>
                {busy === 'connect' ? 'Opening Google…' : '+ Add mail'}
              </button>
            </div>
          )}
          {!openKey && composer}
          {inboxErrs.map((e) => <p key={e.account} className="mail__err">{e.account}: {e.error}</p>)}
          {loading && !threads && <p className="mail__fine">Opening your inboxes…</p>}
          {threads && threads.length === 0 && !loading && <p className="mail__fine">{
            q || filters.length ? 'Nothing matched that search.'
              : cat ? `Nothing in ${CATS.find((c) => c.id === cat)?.label} — some inboxes (often work accounts) don't sort mail into categories.`
              : 'Inbox zero. 🌿'}</p>}
          {threads && threads.length > 0 && (
            <ul className={'mail__list' + (loading ? ' is-loading' : '')}>
              {threads.map((t) => (
                <li key={t.account_id + t.thread_id}>
                  <button className={'mail__row' + (t.unread ? ' is-unread' : '')} onClick={() => openThreadRow(t)}>
                    <span className="mail__row-top">
                      <span className="mail__row-from">{senderName(t.from)}{t.count > 1 && <em> {t.count}</em>}</span>
                      <span className="mail__row-when">{t.starred && <span className="mail__row-star" aria-label="Starred"><Icon name="star" size={12} /></span>}{when(t.date)}</span>
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
                <button className="mail__quiet" disabled={!!busy} onClick={() => void act('trash')}>Trash</button>
                <button className="mail__quiet" disabled={!!busy} onClick={() => void act('unread')}>Mark unread</button>
                <button className="mail__quiet" disabled={!!busy} onClick={() => void unsubscribe()}>{busy === 'unsub' ? 'Unsubscribing…' : 'Unsubscribe'}</button>
                <button className={'mail__star' + (open.starred ? ' is-starred' : '')} disabled={!!busy} aria-pressed={!!open.starred}
                  onClick={() => void act('star')}><Icon name="star" size={15} /> {open.starred ? 'Starred' : 'Star'}</button>
                {/* An ACTION, not a stateful circle — worded, so it never reads
                    as the brain toggle (the circle rule, 2026-11-14). */}
                <button className="mail__askbtn" onClick={askBrain}>
                  <Icon name="brain" size={13} /> Ask about this thread</button>
              </div>
              {open.messages.map((m) => m.draft ? (
                <DraftInThread key={m.id} m={m} accountId={openAcct ?? ''} threadId={openThread ?? ''}
                  from={accounts.find((a) => a.id === openAcct)?.email ?? ''}
                  onDone={async (note) => {
                    setMsg(note);
                    if (openAcct && openThread) setOpen(await loadMailThread(openAcct, openThread).catch(() => open));
                  }} />
              ) : (
                <section key={m.id} className="mail__msgcard">
                  <header className="mail__msghead">
                    <span className="mail__msgfrom">{senderName(m.from)} <em>{senderAddress(m.from)}</em></span>
                    <span className="mail__msgwhen">{longWhen(m.date)}</span>
                    <span className="mail__msgto">to {m.to}{m.cc ? ` · cc ${m.cc}` : ''}</span>
                  </header>
                  <MailBody accountId={openAcct ?? ''} m={m} />
                  <MailFiles accountId={openAcct ?? ''} m={m} />
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
                  <button className="mail__quiet" onClick={() => void connectMail(a.email).catch((e) => setMsg(e.message))}>Reconnect</button>
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

/** A DRAFT IN THE THREAD IS A COMPOSER, NEVER A RECEIVED MESSAGE (founder
 *  2026-11-15: the brain drafted her reply and Mail showed it with no Send
 *  button). Edit it right where it sits; Send hands the draft to Gmail. */
function DraftInThread({ m, accountId, threadId, from, onDone }: {
  m: MailMessage; accountId: string; threadId: string; from: string; onDone: (note: string) => void | Promise<void>;
}) {
  const [to, setTo] = useState(m.to);
  const [cc, setCc] = useState(m.cc);
  const [body, setBody] = useState(m.body);
  const [busy, setBusy] = useState<'send' | 'save' | 'discard' | null>(null);
  const [err, setErr] = useState('');
  const [messageId, setMessageId] = useState(m.id);
  const edited = to !== m.to || cc !== m.cc || body !== m.body;
  const edits = () => ({ accountId, threadId: threadId || undefined, to, cc: cc || undefined, subject: m.subject, body });

  async function go(kind: 'send' | 'save' | 'discard') {
    setErr(''); setBusy(kind);
    try {
      if (kind === 'send') { await sendMailDraft(accountId, messageId, edited ? edits() : undefined); await onDone(`Sent from ${from} ✓`); }
      else if (kind === 'save') { setMessageId(await updateMailDraft(accountId, messageId, edits()) || messageId); await onDone('Draft saved ✓'); }
      else { await discardMailDraft(accountId, messageId); await onDone('Draft discarded.'); }
    } catch (e) { setErr(e instanceof Error ? e.message : 'That didn’t go through.'); }
    finally { setBusy(null); }
  }

  return (
    <section className="mail__msgcard mail__msgcard--draft">
      <p className="mail__draftlabel">Draft · not sent yet · from {from}</p>
      <div className="mail__compose mail__compose--inline">
        <label className="mail__field"><span>To</span>
          <input value={to} onChange={(e) => setTo(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
        <label className="mail__field"><span>Cc</span>
          <input value={cc} onChange={(e) => setCc(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
        <textarea className="mail__body-in" rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
        {err && <p className="mail__err">{err}</p>}
        <div className="mail__compose-acts">
          <button className="btn btn-primary" disabled={!!busy || !to.trim() || !body.trim()} onClick={() => void go('send')}>{busy === 'send' ? 'Sending…' : 'Send'}</button>
          {edited && <button className="btn" disabled={!!busy} onClick={() => void go('save')}>{busy === 'save' ? 'Saving…' : 'Save changes'}</button>}
          <button className="mail__quiet" disabled={!!busy} onClick={() => void go('discard')}>{busy === 'discard' ? 'Discarding…' : 'Discard'}</button>
        </div>
      </div>
    </section>
  );
}

type MailCat = 'primary' | 'promotions' | 'social' | 'updates' | 'forums';
const CATS: { id: MailCat; label: string; icon: IconName }[] = [
  { id: 'primary', label: 'Primary', icon: 'inbox' },
  { id: 'promotions', label: 'Promotions', icon: 'tag' },
  { id: 'social', label: 'Social', icon: 'user-multiple' },
  { id: 'updates', label: 'Updates', icon: 'info' },
  { id: 'forums', label: 'Forums', icon: 'chat' },
];
const QUICK = [
  { op: 'is:unread', label: 'Unread' }, { op: 'is:starred', label: 'Starred' },
  { op: 'has:attachment', label: 'Attachments' }, { op: 'is:important', label: 'Important' },
  { op: 'newer_than:7d', label: 'This week' },
];
const OP_RE = /(?:^|\s)((?:from|to|cc|subject|is|has|label|in|older_than|newer_than|after|before|filename|category|larger|smaller):(?:"[^"]+"|\S+))/gi;
/** Gmail operators typed into the box become bubbles; the rest stays words. */
function pullOps(text: string): { ops: string[]; rest: string } {
  const ops = [...text.matchAll(OP_RE)].map((m) => m[1].trim());
  return { ops, rest: text.replace(OP_RE, ' ').replace(/\s+/g, ' ').trim() };
}
const OP_WORD: Record<string, string> = { from: 'From', to: 'To', cc: 'Cc', subject: 'Subject', label: 'Label', in: 'In', filename: 'File', after: 'After', before: 'Before', older_than: 'Older than', newer_than: 'Newer than', larger: 'Larger than', smaller: 'Smaller than', category: 'Category' };
function prettyOp(op: string): string {
  const q = QUICK.find((f) => f.op === op); if (q) return q.label;
  const [k, ...v] = op.split(':'); const val = v.join(':').replace(/^"|"$/g, '');
  if (k === 'is') return val[0].toUpperCase() + val.slice(1);
  if (k === 'has') return val === 'attachment' ? 'Attachments' : `Has ${val}`;
  return `${OP_WORD[k.toLowerCase()] ?? k}: ${val}`;
}
/** Words search all mail; filters alone (or a category) stay in the inbox. */
function composeQuery(text: string, filters: string[], cat: MailCat | null): string {
  const parts: string[] = [];
  const scoped = filters.some((f) => /^in:/i.test(f));
  if (!text.trim() && !scoped) parts.push('in:inbox');
  if (cat) parts.push(`category:${cat}`);
  parts.push(...filters);
  if (text.trim()) parts.push(text.trim());
  return parts.join(' ');
}

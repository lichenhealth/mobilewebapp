import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import { supabase } from '../lib/supabase';
import { listMailAccounts, connectMail, type MailAccount } from '../lib/mailApi';
import './Workspace.css';

/**
 * LICHEN'S WORKSPACE (founder 2026-11-14: "let's create admin.lichen.health
 * to handle lichen's workspace, then port over all the lichen inboxes to
 * lichen from google" — Google stays alongside until ours works well).
 * admin.lichen.health redirects here. One screen for running Lichen the
 * organization: its inboxes (Google holds the mail, Lichen reads and answers
 * it — Lichen Mail), Lichen's own conversations, and the desks.
 * Platform admins only.
 */
export default function Workspace() {
  const { user, isAdmin, loading } = useAuth();
  const { setActor } = useActing();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<MailAccount[] | null>(null);
  const [mailMsg, setMailMsg] = useState('');
  const [org, setOrg] = useState<{ id: string; name: string; avatar_url: string | null } | null>(null);
  const [knocks, setKnocks] = useState<number | null>(null);
  const [payouts, setPayouts] = useState<number | null>(null);
  const [cats, setCats] = useState<number | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    void listMailAccounts().then(setAccounts).catch(() => setAccounts([]));
    void supabase.from('spaces').select('id, name, avatar_url').eq('handle', 'lichen').maybeSingle()
      .then(({ data }) => setOrg((data as typeof org) ?? null));
    void supabase.from('join_requests').select('id', { count: 'exact', head: true }).eq('status', 'new').is('replied_at', null)
      .then(({ count }) => setKnocks(count ?? 0));
    void supabase.from('payout_requests').select('id', { count: 'exact', head: true }).eq('status', 'requested')
      .then(({ count, error }) => setPayouts(error ? null : count ?? 0));
    void supabase.from('category_suggestions').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      .then(({ count }) => setCats(count ?? 0));
  }, [isAdmin]);

  if (loading) return null;
  if (!user || !isAdmin) return <Navigate to="/home" replace />;

  const connect = async () => {
    setMailMsg('');
    try { await connectMail(); }
    catch (e) { setMailMsg(e instanceof Error ? e.message : String(e)); }
  };

  const desks: { icon: Parameters<typeof Icon>[0]['name']; label: string; sub: string; to: string; n: number | null }[] = [
    { icon: 'user-multiple', label: 'At the door', sub: 'People asking to join', to: '/invite#door', n: knocks },
    { icon: 'groups', label: 'Members & invitations', sub: 'Invite, gift, manage members', to: '/admin/supporters', n: null },
    { icon: 'currentcy', label: 'Payouts', sub: 'Cash-outs waiting to be paid', to: '/admin/supporters#payouts', n: payouts },
    { icon: 'book', label: 'Categories & identities', sub: 'Add to the vocabulary, answer suggestions', to: '/admin/categories', n: cats },
  ];

  return (
    <div className="wksp">
      <header className="myc__head">
        <h1 className="myc__title"><span className="display-italic">Lichen workspace</span></h1>
        <p className="myc__sub">Running Lichen the organization — its inboxes, its conversations, its desks.</p>
      </header>

      <section className="wksp__sec">
        <h2 className="wksp__h">Inboxes</h2>
        <p className="wksp__note">Google still holds Lichen&rsquo;s mail while this proves itself. Here you read and answer it, filed by who wrote.</p>
        {accounts === null ? <p className="wksp__note">Loading…</p> : accounts.length === 0 ? (
          <p className="wksp__note">No inbox connected yet.</p>
        ) : (
          <ul className="wksp__list">
            {accounts.map((a) => (
              <li key={a.id}>
                <button className="wksp__row" onClick={() => navigate('/mail')}>
                  <span className="wksp__ico"><Icon name="inbox" size={16} /></span>
                  <span className="wksp__rowtext"><strong>{a.email}</strong>
                    <em>{a.last_error ? 'Needs reconnecting' : 'Connected'}</em></span>
                  <Icon name="chevron-right" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <button className="wksp__btn" onClick={() => void connect()}>⊕ Connect a Lichen inbox</button>
        {mailMsg && <p className="wksp__err">{mailMsg}</p>}
      </section>

      {org && (
        <section className="wksp__sec">
          <h2 className="wksp__h">Lichen&rsquo;s conversations</h2>
          <button className="wksp__row" onClick={() => {
            setActor({ type: 'space', id: org.id, name: org.name, kind: 'organization', avatarUrl: org.avatar_url });
            navigate('/chat');
          }}>
            <span className="wksp__ico"><Icon name="chat" size={16} /></span>
            <span className="wksp__rowtext"><strong>Open Lichen&rsquo;s inbox</strong>
              <em>Switches to acting as {org.name}</em></span>
            <Icon name="chevron-right" size={14} />
          </button>
        </section>
      )}

      <section className="wksp__sec">
        <h2 className="wksp__h">Desks</h2>
        <ul className="wksp__list">
          {desks.map((d) => (
            <li key={d.label}>
              <button className="wksp__row" onClick={() => navigate(d.to)}>
                <span className="wksp__ico"><Icon name={d.icon} size={16} /></span>
                <span className="wksp__rowtext"><strong>{d.label}</strong><em>{d.sub}</em></span>
                {d.n ? <span className="wksp__badge">{d.n}</span> : null}
                <Icon name="chevron-right" size={14} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

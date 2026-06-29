import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import './Invite.css';

export default function Invite() {
  const { loading, user } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && !user) { navigate('/login', { replace: true }); return; }
    if (!user) return;
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
      .then(({ data }) => setFullName((data as { full_name: string | null } | null)?.full_name ?? ''));
  }, [user, loading, navigate]);

  async function send() {
    const to = email.trim();
    if (!to) return;
    setBusy(true); setMsg(''); setError('');
    const { error: e } = await supabase.functions.invoke('send-invite', {
      body: { email: to, inviterName: fullName, note: note.trim() },
    });
    setBusy(false);
    if (e) {
      setError('Couldn’t send the invite just now. Please try again in a moment.');
      return;
    }
    setMsg(`Invitation sent to ${to}.`);
    setEmail('');
    setNote('');
  }

  if (loading) return <div className="invite"><p className="invite__muted">Loading…</p></div>;

  return (
    <div className="invite">
      <header className="invite__head">
        <Icon name="user-multiple" size={26} />
        <h1 className="invite__title">Invite to Lichen</h1>
        <p className="invite__sub">
          Know someone who belongs here? Send them an invitation to join Lichen.
        </p>
      </header>

      {error && <p className="invite__error">{error}</p>}
      {msg && <p className="invite__msg">{msg}</p>}

      <div className="invite__form">
        <label className="invite__label" htmlFor="invite-email">Their email</label>
        <input
          id="invite-email"
          className="invite__input"
          type="email"
          placeholder="friend@example.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setMsg(''); }}
        />

        <label className="invite__label" htmlFor="invite-note">Add a note (optional)</label>
        <textarea
          id="invite-note"
          className="invite__input invite__textarea"
          placeholder="A personal line — why you think they'd love Lichen."
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />

        <button className="btn btn-primary invite__send" onClick={send} disabled={busy || !email.trim()}>
          {busy ? 'Sending…' : 'Send invitation'}
        </button>
      </div>
    </div>
  );
}

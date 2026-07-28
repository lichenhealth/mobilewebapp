import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { LichenMark } from '../components/LichenMark';
import './Auth.css';
import Turnstile, { TURNSTILE_SITE_KEY } from '../components/Turnstile';

/** Lichen grows by invitation (founder 2026-07-28). Flip this off to reopen
 *  walk-in signups. */
const INVITE_ONLY = true;

export default function SignUp() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inviteToken = params.get('invite');
  // null = still checking; false = no/invalid token (show the knock form)
  const [inviteOk, setInviteOk] = useState<boolean | null>(inviteToken ? null : false);
  const [inviterName, setInviterName] = useState('');
  useEffect(() => {
    if (!inviteToken) return;
    let live = true;
    void supabase.rpc('check_invite', { p_token: inviteToken }).then(({ data, error }) => {
      if (!live) return;
      const d = data as { valid?: boolean; inviter?: string } | null;
      if (!error && d?.valid) {
        setInviteOk(true);
        setInviterName(d.inviter ?? 'a member');
        localStorage.setItem('lichen-invite-token', inviteToken);
      } else if (error) {
        // check_invite missing (pre-migration) → don't lock anyone out
        setInviteOk(true);
      } else {
        setInviteOk(false);
      }
    });
    return () => { live = false; };
  }, [inviteToken]);

  // The knock: who are you, and why Lichen?
  const [kName, setKName] = useState('');
  const [kEmail, setKEmail] = useState('');
  const [kStory, setKStory] = useState('');
  const [kSent, setKSent] = useState(false);
  const [kBusy, setKBusy] = useState(false);
  const [kError, setKError] = useState('');
  async function knock(e: FormEvent) {
    e.preventDefault();
    setKError('');
    if (!kName.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(kEmail.trim())) {
      setKError('Your name and a real email, so we can write back.'); return;
    }
    setKBusy(true);
    const { error } = await supabase.functions.invoke('join-request', {
      body: { name: kName.trim(), email: kEmail.trim(), story: kStory.trim() },
    });
    setKBusy(false);
    if (error) { setKError('Something went wrong — try again in a moment.'); return; }
    setKSent(true);
  }
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(''); setNotice('');
    if (!fullName.trim()) { setError('Please enter your name.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (TURNSTILE_SITE_KEY && !captchaToken) { setError('One moment — verifying you\u2019re human…'); return; }
    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() }, captchaToken: captchaToken ?? undefined },
    });
    setLoading(false);
    if (signUpError) { setError(signUpError.message); return; }
    if (data.session) {
      navigate('/onboarding', { replace: true });
    } else {
      setNotice('Account created. Check your email to confirm, then log in.');
    }
  }

  if (INVITE_ONLY && inviteOk === null) {
    return (
      <div className="auth"><div className="auth__card">
        <div className="auth__brand"><div className="auth__logo"><LichenMark size={56} /></div></div>
        <p className="auth__sub" style={{ textAlign: 'center' }}>Checking your invitation…</p>
      </div></div>
    );
  }

  if (INVITE_ONLY && inviteOk === false) {
    return (
      <div className="auth">
        <div className="auth__card">
          <div className="auth__brand">
            <div className="auth__logo"><LichenMark size={56} /></div>
            <h1 className="auth__title">Lichen grows by invitation</h1>
            <p className="auth__sub">
              {inviteToken
                ? 'That invitation has already been used or isn\u2019t valid — but the door still has a bell.'
                : 'Every member arrives through someone already here. Don\u2019t know anyone yet? Introduce yourself — a real person reads every note.'}
            </p>
          </div>
          {kSent ? (
            <p className="auth__notice">
              Got it — thank you. We read every introduction and write back personally.
              Watch your email.
            </p>
          ) : (
            <form className="auth__form" onSubmit={knock}>
              <label className="auth__label">
                Your name
                <input className="auth__input" type="text" value={kName}
                  onChange={(e) => setKName(e.target.value)} placeholder="Your name" autoComplete="name" />
              </label>
              <label className="auth__label">
                Email
                <input className="auth__input" type="email" value={kEmail}
                  onChange={(e) => setKEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
              </label>
              <label className="auth__label">
                Who are you, and why Lichen?
                <textarea className="auth__input auth__story" value={kStory}
                  onChange={(e) => setKStory(e.target.value)}
                  placeholder="A few honest lines — what you do, what draws you here, who sent you our way…" />
              </label>
              {/* honeypot — humans never see it, bots can't resist it */}
              <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
                style={{ position: 'absolute', left: '-9999px' }} />
              {kError && <p className="auth__error">{kError}</p>}
              <button className="btn btn-primary auth__submit" type="submit" disabled={kBusy}>
                {kBusy ? 'Sending…' : 'Introduce yourself'}
              </button>
            </form>
          )}
          <p className="auth__switch">
            Already have an account? <Link to="/login">Log in</Link>
          </p>
          <p className="auth__switch">
            Curious first? <Link to="/about">Learn what Lichen is all about</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <div className="auth__logo"><LichenMark size={56} /></div>
          <h1 className="auth__title">Join Lichen</h1>
          <p className="auth__sub">
            {inviterName
              ? `Invited by ${inviterName} — put down roots beside them.`
              : 'Put down roots. Create your account to begin.'}
          </p>
        </div>
        <form className="auth__form" onSubmit={handleSubmit}>
          <label className="auth__label">
            Full name
            <input className="auth__input" type="text" value={fullName}
              onChange={(e) => setFullName(e.target.value)} placeholder="Your name" autoComplete="name" />
          </label>
          <label className="auth__label">
            Email
            <input className="auth__input" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </label>
          <label className="auth__label">
            Password
            <input className="auth__input" type="password" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" autoComplete="new-password" />
          </label>
          {error && <p className="auth__error">{error}</p>}
          {notice && <p className="auth__notice">{notice}</p>}
          <Turnstile onToken={setCaptchaToken} />
          <button className="btn btn-primary auth__submit" type="submit" disabled={loading}>
            {loading ? 'Creating…' : 'Create account'}
          </button>
        </form>
        <p className="auth__switch">
          New to Lichen? <Link to="/about">Learn what it’s all about</Link> first.
        </p>
        <p className="auth__switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { LichenMark } from '../components/LichenMark';
import './Auth.css';

type Phase = 'request' | 'sent' | 'choose' | 'done';

/** Password reset, both halves of the journey:
 *  1. No recovery session → "enter your email", we send the reset link.
 *  2. Arriving FROM that email link → Supabase establishes a recovery session
 *     (PASSWORD_RECOVERY) → "choose a new password". */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('request');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // The email link lands here with a recovery token in the URL hash;
    // supabase-js consumes it and emits PASSWORD_RECOVERY.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setPhase('choose');
    });
    // Covers the already-processed case (fast redirects).
    if (window.location.hash.includes('type=recovery')) setPhase('choose');
    return () => sub.subscription.unsubscribe();
  }, []);

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    setError(''); setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setPhase('sent');
  }

  async function saveNewPassword(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Use at least 8 characters.'); return; }
    if (password !== confirm) { setError("Those passwords don't match."); return; }
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setPhase('done');
    setTimeout(() => navigate('/home'), 1600);
  }

  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <div className="auth__logo"><LichenMark size={56} /></div>
          <h1 className="auth__title">
            {phase === 'choose' ? 'Choose a new password' : phase === 'done' ? 'All set' : 'Reset your password'}
          </h1>
          <p className="auth__sub">
            {phase === 'request' && "Enter your email and we'll send a reset link."}
            {phase === 'sent' && 'Check your inbox (and spam, just in case).'}
            {phase === 'choose' && 'Pick something memorable — at least 8 characters.'}
            {phase === 'done' && "You're logged in with your new password."}
          </p>
        </div>

        {error && <p className="auth__error">{error}</p>}

        {phase === 'request' && (
          <form className="auth__form" onSubmit={sendLink}>
            <label className="auth__label">
              Email
              <input className="auth__input" type="email" value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" autoFocus />
            </label>
            <button className="btn btn-primary auth__submit" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        {phase === 'sent' && (
          <p className="auth__sub" style={{ textAlign: 'center' }}>
            We sent a link to <strong>{email.trim()}</strong>. It opens right back here.
          </p>
        )}

        {phase === 'choose' && (
          <form className="auth__form" onSubmit={saveNewPassword}>
            <label className="auth__label">
              New password
              <input className="auth__input" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" autoFocus />
            </label>
            <label className="auth__label">
              Confirm it
              <input className="auth__input" type="password" value={confirm}
                onChange={(e) => setConfirm(e.target.value)} placeholder="Same again" autoComplete="new-password" />
            </label>
            <button className="btn btn-primary auth__submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save new password'}
            </button>
          </form>
        )}

        <p className="auth__switch">
          Remembered it? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}

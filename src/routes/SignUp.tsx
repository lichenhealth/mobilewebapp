import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { LichenMark } from '../components/LichenMark';
import './Auth.css';
import Turnstile, { TURNSTILE_SITE_KEY } from '../components/Turnstile';

export default function SignUp() {
  const navigate = useNavigate();
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

  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <div className="auth__logo"><LichenMark size={56} /></div>
          <h1 className="auth__title">Join Lichen</h1>
          <p className="auth__sub">Put down roots. Create your account to begin.</p>
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

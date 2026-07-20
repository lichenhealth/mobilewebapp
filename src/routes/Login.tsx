import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { LichenMark } from '../components/LichenMark';
import './Auth.css';

/** Only ever bounce to a place INSIDE the app — an absolute URL in ?next=
 *  would be an open-redirect door. */
function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Remembered destination: a signed-out tap on a notification email lands on
  // /login?next=/spaces/…; after signing in you arrive where you were headed.
  const next = safeNext(params.get('next')) ?? '/home';

  useEffect(() => { if (user) navigate(next, { replace: true }); }, [user, navigate, next]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (signInError) { setError(signInError.message); return; }
    navigate(next, { replace: true });
  }

  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <div className="auth__logo"><LichenMark size={56} /></div>
          <h1 className="auth__title">Welcome back</h1>
          <p className="auth__sub">Log in to your Lichen account.</p>
        </div>
        <form className="auth__form" onSubmit={handleSubmit}>
          <label className="auth__label">
            Email
            <input className="auth__input" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </label>
          <label className="auth__label">
            Password
            <input className="auth__input" type="password" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="Your password" autoComplete="current-password" />
          </label>
          {error && <p className="auth__error">{error}</p>}
          <button className="btn btn-primary auth__submit" type="submit" disabled={loading}>
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </form>
        <p className="auth__switch">
          <Link to="/reset-password">Forgot your password?</Link>
        </p>
        <p className="auth__switch">
          New here? <Link to="/signup">Create an account</Link>
        </p>
      </div>
    </div>
  );
}

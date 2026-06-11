import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import './Auth.css';

export default function SignUp() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => { if (user) navigate('/home'); }, [user, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(''); setNotice('');
    if (!fullName.trim()) { setError('Please enter your name.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() } },
    });
    setLoading(false);
    if (signUpError) { setError(signUpError.message); return; }
    if (data.session) {
      navigate('/home');
    } else {
      setNotice('Account created. Check your email to confirm, then log in.');
    }
  }

  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <span className="auth__leaf">🌱</span>
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
          <button className="btn btn-primary auth__submit" type="submit" disabled={loading}>
            {loading ? 'Creating…' : 'Create account'}
          </button>
        </form>
        <p className="auth__switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}

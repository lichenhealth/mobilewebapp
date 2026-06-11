import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import './Auth.css';

type ProfileRow = { full_name: string | null; email: string | null; created_at: string };

export default function Profile() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileRow | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('full_name,email,created_at').eq('id', user.id).single()
      .then(({ data }) => setProfile(data as ProfileRow | null));
  }, [user]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  if (loading) {
    return <div className="auth-page"><p className="auth-page__sub">Loading…</p></div>;
  }

  if (!user) {
    return (
      <div className="auth-page">
        <h1 className="auth-page__title">Your profile</h1>
        <p className="auth-page__sub">Sign in to see your profile.</p>
        <div className="auth-page__actions">
          <Link className="btn btn-primary" to="/login">Log in</Link>
          <Link className="btn btn-ghost" to="/signup">Create account</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <h1 className="auth-page__title">{profile?.full_name || 'Welcome'}</h1>
      <p className="auth-page__sub">Signed in as {user.email}</p>
      <div className="auth-page__meta">
        <div>
          <span>Member since</span>
          <strong>{profile ? new Date(profile.created_at).toLocaleDateString() : '—'}</strong>
        </div>
      </div>
      <button className="btn btn-ghost" onClick={signOut}>Sign out</button>
    </div>
  );
}

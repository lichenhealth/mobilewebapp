import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { LichenMark } from '../components/LichenMark';
import './Auth.css';

/** /invite/decline?token= — the way to say no to an invitation (founder
 *  2026-08-17: "in case they change their mind"). One tap closes it, the
 *  inviter is told quietly, and no reminder ever follows. Anon route: the
 *  person has no account, that's the point; the unguessable token is the
 *  authorization. Chrome-suppressed like the other guest landings. */
export default function InviteDecline() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'ask' | 'busy' | 'done' | 'error'>('ask');

  async function decline() {
    if (!token) { setState('error'); return; }
    setState('busy');
    const { error } = await supabase.rpc('decline_invite', { p_token: token });
    setState(error ? 'error' : 'done');
  }

  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <div className="auth__logo"><LichenMark size={56} /></div>
          <h1 className="auth__title">
            {state === 'done' ? 'Understood — thank you' : 'Decline this invitation?'}
          </h1>
          <p className="auth__sub">
            {state === 'done'
              ? 'The invitation is closed and we won’t follow up. If you ever change your mind, the person who invited you can always send another.'
              : state === 'error'
                ? 'That link doesn’t match an open invitation — it may already have been used or declined. Nothing else to do.'
                : 'No hard feelings. The person who invited you will hear, quietly, that Lichen isn’t for you right now, and no reminder will come your way.'}
          </p>
        </div>
        {state === 'ask' || state === 'busy' ? (
          <div className="auth__form">
            <button className="btn btn-primary auth__submit" onClick={() => void decline()} disabled={state === 'busy'}>
              {state === 'busy' ? 'One moment…' : 'Yes, decline'}
            </button>
            <p className="auth__switch">
              Changed your mind the other way? <Link to={`/signup?invite=${token}`}>Join instead</Link>
            </p>
          </div>
        ) : (
          <p className="auth__switch">
            Curious anyway? <Link to="/about">Learn what Lichen is all about</Link>
          </p>
        )}
      </div>
    </div>
  );
}

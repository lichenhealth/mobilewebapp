import { useNavigate } from 'react-router-dom';
import { useActing } from '../acting/ActingProvider';
import { useAuth } from '../auth/AuthProvider';
import Avatar from './Avatar';
import { colorFor, monogramFor } from '../lib/chatApi';
import './ProfileSwitch.css';

/** Profile toggle: You · each space you administer. Pure navigation between
 *  /profile and /spaces/:id — deliberately NOT coupled to the "Acting as"
 *  switcher (that answers who you POST as; this answers whose profile you're
 *  looking at). Renders nothing for members with no admin spaces. */
export default function ProfileSwitch({ active }: { active: 'self' | string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { options, self } = useActing();

  if (options.length === 0) return null;

  return (
    <div className="pswitch h-scroll" role="tablist" aria-label="Whose profile">
      <button
        className={'pswitch__chip' + (active === 'self' ? ' is-on' : '')}
        onClick={() => { if (active !== 'self') navigate('/profile'); }}
        role="tab"
        aria-selected={active === 'self'}
      >
        <Avatar id={user?.id ?? 'me'} name={self.name || 'Me'} url={self.avatarUrl} size={22} />
        <span>You</span>
      </button>
      {options.map((o) => (
        <button
          key={o.id}
          className={'pswitch__chip' + (active === o.id ? ' is-on' : '')}
          onClick={() => { if (active !== o.id) navigate(`/spaces/${o.id}`); }}
          role="tab"
          aria-selected={active === o.id}
        >
          <span className="pswitch__mono" style={{ background: colorFor(o.id) }}>
            {monogramFor(o.name)}
          </span>
          <span>{o.name}</span>
        </button>
      ))}
    </div>
  );
}

import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Avatar from './Avatar';
import { Icon } from './Icon';
import { WeaveMark } from './WeaveMark';
import { CLAUDE_PROFILE_ID, ensureDirectChat } from '../lib/chatApi';
import './MemberRow.css';

export interface MemberRowProps {
  id: string;
  name: string;
  sub?: string;
  avatarUrl?: string | null;
  /** Only meaningful for people — the my-celium directory's present/around tags. */
  presence?: 'lit' | 'around' | null;
  /** People get the private trust shield; spaces get the public recommend thumb
   *  (founder 2026-07-17/2026-08-07: trust is a relationship between people and
   *  stays private, an organization is something you vouch for publicly). */
  kind: 'person' | 'space';
  trusted?: boolean;
  onTrust?: (on: boolean) => void;
  recommended?: boolean;
  onRecommend?: (on: boolean) => void;
  weaveOn: boolean;
  onWeave: (on: boolean) => void;
  onOpen: () => void;
  /** Hide every action — SpaceProfile's own-row case (can't message/trust yourself). */
  hideActions?: boolean;
  /** Small badge slot — SpaceProfile's role label. */
  roleLabel?: string;
  /** Extra control appended after the actions — SpaceProfile's "Role →" button. */
  trailing?: ReactNode;
  /** Whether the viewer has ever actually messaged Claude — only consulted
   *  when id === CLAUDE_PROFILE_ID. Undefined/true reads as "in use" so a
   *  page that hasn't loaded this yet never flashes the muted state. */
  claudeInUse?: boolean;
}

/** The one member/space row every listing surface renders through — Home's
 *  Directory, My-celium's web, and a space's Members tab. Avatar (photo-
 *  capable), name + sub-line, the shield-or-thumb signal, the weave mark,
 *  and a labeled Message door. The whole row is the click target; each
 *  action button stops propagation so it still works nested inside it. */
export default function MemberRow({
  id, name, sub, avatarUrl, presence, kind,
  trusted, onTrust, recommended, onRecommend,
  weaveOn, onWeave, onOpen, hideActions, roleLabel, trailing, claudeInUse,
}: MemberRowProps) {
  const navigate = useNavigate();
  const [opening, setOpening] = useState(false);

  const message = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (id === CLAUDE_PROFILE_ID) { navigate('/assistant/feed'); return; }
    setOpening(true);
    try {
      navigate(`/chat/${await ensureDirectChat(id)}`);
    } catch (err) {
      console.error(err);
      setOpening(false);
      alert('Could not open the chat: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const isClaude = id === CLAUDE_PROFILE_ID;
  const muted = isClaude && claudeInUse === false;

  return (
    <div
      className={'member-row' + (muted ? ' member-row--muted' : '')}
      onClick={onOpen}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
    >
      <span className="member-row__id">
        <Avatar id={id} name={name} url={avatarUrl} size={44} />
        <span className="member-row__body">
          <span className="member-row__name">
            {name}
            {presence === 'lit' && (
              <span className="member-row__presence member-row__presence--lit">
                <span aria-hidden="true">🕯️</span> present
              </span>
            )}
            {presence === 'around' && (
              <span className="member-row__presence">
                <span className="member-row__presence-dot" aria-hidden="true" /> around
              </span>
            )}
          </span>
          {roleLabel && <span className="member-row__role">{roleLabel}</span>}
          {!roleLabel && sub && <span className="member-row__sub">{sub}</span>}
        </span>
      </span>

      {!hideActions && (
        <span className="member-row__acts">
          {kind === 'person' && onTrust && (
            <button
              className={'member-row__sig' + (trusted ? ' is-on' : '')}
              onClick={(e) => { e.stopPropagation(); onTrust(!trusted); }}
              aria-pressed={trusted}
              aria-label={trusted ? `Stop trusting ${name}` : `Trust ${name}`}
              title={trusted ? 'Someone you trust' : 'Trust (private)'}
            >
              <Icon name="shield-user" size={16} />
            </button>
          )}
          {kind === 'space' && onRecommend && (
            <button
              className={'member-row__sig' + (recommended ? ' is-on' : '')}
              onClick={(e) => { e.stopPropagation(); onRecommend(!recommended); }}
              aria-pressed={recommended}
              aria-label={recommended ? `Stop recommending ${name}` : `Recommend ${name}`}
              title={recommended ? 'Recommended by you' : 'Recommend'}
            >
              <Icon name="thumbs-up" size={16} />
            </button>
          )}
          <WeaveMark on={weaveOn} onToggle={onWeave} entityName={name} size={20} />
          <button className="member-row__msg" onClick={message} disabled={opening}>
            <Icon name="message" size={15} />
            <span className="member-row__msg-label">{opening ? '…' : 'Message'}</span>
          </button>
        </span>
      )}
      {trailing}
    </div>
  );
}

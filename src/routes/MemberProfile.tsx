import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import Avatar from '../components/Avatar';
import { useAuth } from '../auth/AuthProvider';
import { ensureDirectChat } from '../lib/chatApi';
import { loadMyMycelium, loadMyRecommendations, setTrust, setRecommend } from '../lib/myceliumApi';
import { loadMappableMembers, type MappableMember } from '../lib/locationApi';
import ContributionsFeed from '../components/ContributionsFeed';
import { loadMemberProfile, loadMemberOfferings, type MemberProfile as MemberRow, type MemberOfferings } from '../lib/membersApi';
import './Profile.css';
import './MemberProfile.css';

/** A member's public profile — the Provider face of a person: who they are,
 *  what they offer, and the two ways to connect (Trust into your mycelium,
 *  or start a conversation). Email, phone, and exact whereabouts stay
 *  private by design. */
export default function MemberProfile() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [member, setMember] = useState<MemberRow | null>(null);
  const [offerings, setOfferings] = useState<MemberOfferings>({ services: [], goods: [] });
  const [trusted, setTrusted] = useState(false);
  const [recommended, setRecommended] = useState(false);
  const [homeSpot, setHomeSpot] = useState<MappableMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const [m, off, myc, recs, mappable] = await Promise.all([
        loadMemberProfile(id),
        loadMemberOfferings(id),
        me ? loadMyMycelium() : Promise.resolve(new Set<string>()),
        me ? loadMyRecommendations() : Promise.resolve(new Set<string>()),
        me ? loadMappableMembers() : Promise.resolve([] as MappableMember[]),
      ]);
      if (!live) return;
      setMember(m);
      setOfferings(off);
      setTrusted(myc.has(`profile:${id}`));
      setRecommended(recs.has(`profile:${id}`));
      // What THIS viewer is allowed to see of their home (hidden → absent).
      setHomeSpot(mappable.find((x) => x.id === id) ?? null);
      setLoading(false);
    })();
    return () => { live = false; };
  }, [id, me]);

  const isSelf = !!me && id === me;

  if (loading) return <div className="prof"><p className="mprof__muted">Loading…</p></div>;
  if (!member) {
    return <div className="prof"><p className="mprof__muted">This page isn&rsquo;t available.</p></div>;
  }

  const name = member.full_name || 'A Lichen member';

  async function toggleTrust() {
    if (!me) return;
    const next = !trusted;
    setTrusted(next);   // optimistic — same gesture as Trust on a feed card
    try { await setTrust('profile', id, next); } catch (e) { console.error(e); setTrusted(!next); }
  }

  async function toggleRecommend() {
    if (!me) return;
    const next = !recommended;
    setRecommended(next);   // optimistic — amplify this person to those who trust you
    try { await setRecommend('profile', id, next); } catch (e) { console.error(e); setRecommended(!next); }
  }

  async function message() {
    if (!me || busy) return;
    setBusy(true);
    try {
      navigate(`/chat/${await ensureDirectChat(id)}`);
    } catch (e) { console.error('message', e); setBusy(false); }
  }

  return (
    <div className="prof">
      {isSelf && (
        <div className="mprof__selfbar">
          <span>This is your public profile — how other members see you.</span>
          <button className="mprof__selfbar-edit" onClick={() => navigate('/profile')}>
            Edit profile <Icon name="chevron-right" size={12} />
          </button>
        </div>
      )}
      <div className="prof__head">
        <Avatar id={member.id} name={name} url={member.avatar_url} size={72} />
        <h1 className="prof__name">{name}</h1>
        {member.headline && <p className="mprof__headline">{member.headline}</p>}
        {homeSpot?.place && (
          <p className="mprof__loc">
            <Icon name="location" size={12} />{' '}
            {homeSpot.level === 'area' ? `Near ${homeSpot.place}` : homeSpot.place}
          </p>
        )}
        {me && !isSelf && (
          <div className="mprof__actions">
            <button className="btn btn-primary mprof__btn" onClick={message} disabled={busy}>
              <Icon name="message" size={14} /> {busy ? 'Opening…' : 'Message'}
            </button>
            <button
              className={'btn mprof__btn mprof__btn--trust' + (trusted ? ' is-on' : '')}
              onClick={toggleTrust}
              title={trusted ? 'In your mycelium' : 'Add to your mycelium'}
            >
              <Icon name="shield-user" size={14} /> {trusted ? 'Trusted ✓' : 'Trust'}
            </button>
            <button
              className={'btn mprof__btn mprof__btn--trust' + (recommended ? ' is-on' : '')}
              onClick={toggleRecommend}
              title={recommended ? 'Recommended to those who trust you' : 'Recommend to those who trust you'}
            >
              <Icon name="thumbs-up" size={14} /> {recommended ? 'Recommended ✓' : 'Recommend'}
            </button>
          </div>
        )}
      </div>

      {(member.bio || offerings.services.length > 0 || offerings.goods.length > 0) && (
        <div className="mprof__about">
          {member.bio && <p className="mprof__bio mprof__bio--clamp">{member.bio}</p>}
          {(offerings.services.length > 0 || offerings.goods.length > 0) && (
            <div className="mprof__chips">
              {offerings.services.map((s) => <span key={'s' + s} className="mprof__chip">{s}</span>)}
              {offerings.goods.map((g) => <span key={'g' + g} className="mprof__chip mprof__chip--good">{g}</span>)}
            </div>
          )}
        </div>
      )}

      {/* The profile IS a feed — their contributions, standard lenses. */}
      <ContributionsFeed profileId={member.id} me={me} />
    </div>
  );
}

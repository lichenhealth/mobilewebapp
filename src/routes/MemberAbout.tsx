import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import Avatar from '../components/Avatar';
import {
  loadMemberProfile, loadMemberOfferings,
  type MemberProfile as MemberProfileRow, type MemberOfferings,
} from '../lib/membersApi';
import './MemberProfile.css';

/** The curated About room (founder + Melanie, 2026-07-19): profiles are
 *  feed-first on mobile, so the full story — bio, every service and good —
 *  lives here, one tap deep, with the way back always visible. Future
 *  profile fields (trainings, lineages, links…) land here too. */
export default function MemberAbout() {
  const { id: memberId = '' } = useParams();   // route: /members/:id/about
  const navigate = useNavigate();

  const [member, setMember] = useState<MemberProfileRow | null>(null);
  const [offerings, setOfferings] = useState<MemberOfferings>({ services: [], goods: [] });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const [m, off] = await Promise.all([loadMemberProfile(memberId), loadMemberOfferings(memberId)]);
      if (!live) return;
      setMember(m); setOfferings(off); setReady(true);
    })();
    return () => { live = false; };
  }, [memberId]);

  if (!ready) return <div className="prof"><p className="mprof__muted">Loading…</p></div>;
  if (!member) return <div className="prof"><p className="mprof__muted">This page isn&rsquo;t available.</p></div>;

  const name = member.full_name || 'A Lichen member';

  return (
    <div className="prof">
      <button className="cmp__back mabout__back" onClick={() => navigate(`/members/${memberId}`)}>
        <Icon name="arrow-left" size={14} /> {name}
      </button>

      <div className="prof__head mabout__head">
        <Avatar id={member.id} name={name} url={member.avatar_url} size={56} />
        <h1 className="prof__name">{name}</h1>
        {member.headline && <p className="mprof__headline">{member.headline}</p>}
      </div>

      {member.bio && (
        <section className="mabout__sec">
          <h2 className="mabout__h2">About</h2>
          <p className="mabout__bio">{member.bio}</p>
        </section>
      )}

      {offerings.services.length > 0 && (
        <section className="mabout__sec">
          <h2 className="mabout__h2">Services</h2>
          <div className="mprof__chips">
            {offerings.services.map((s) => <span key={s} className="mprof__chip">{s}</span>)}
          </div>
        </section>
      )}

      {offerings.goods.length > 0 && (
        <section className="mabout__sec">
          <h2 className="mabout__h2">Goods</h2>
          <div className="mprof__chips">
            {offerings.goods.map((g) => <span key={g} className="mprof__chip mprof__chip--good">{g}</span>)}
          </div>
        </section>
      )}

      {!member.bio && offerings.services.length === 0 && offerings.goods.length === 0 && (
        <p className="mprof__muted">Nothing shared here yet.</p>
      )}
    </div>
  );
}

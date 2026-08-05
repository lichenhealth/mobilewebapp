import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { setTopIdentity } from '../lib/topIdentity';
import Avatar from '../components/Avatar';
import { useAuth } from '../auth/AuthProvider';
import { getIdentityTags } from '../lib/meansApi';
import { loadSteward } from '../lib/stewardshipApi';
import { ensureDirectChat } from '../lib/chatApi';
import { loadMyWeb, setInWeb, setVouch } from '../lib/myceliumApi';
import {
  loadMappableMembers, loadMyHome, loadMyLocationShares, areaLabel, type MappableMember,
} from '../lib/locationApi';
import ContributionsFeed from '../components/ContributionsFeed';
import { loadMemberProfile, loadMemberOfferings, type MemberProfile as MemberRow, type MemberOfferings } from '../lib/membersApi';
import { BookingType, listBookableTypes } from '../lib/bookingApi';
import '../routes/Bookings.css';
import './Profile.css';
import './MemberProfile.css';
import PublicPage, { type PageMeta } from '../components/PublicPage';
import { type ContactInfo } from '../components/ContactFields';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

/** A member's public profile — the Provider face of a person: who they are,
 *  what they offer, and the two ways to connect (Trust into your mycelium,
 *  or start a conversation). Email, phone, and exact whereabouts stay
 *  private by design. */
export default function MemberProfile({ memberId }: { memberId?: string } = {}) {
  const { id: paramId = '' } = useParams();
  const id = memberId || paramId;
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [member, setMember] = useState<MemberRow | null>(null);
  const [steward, setSteward] = useState<{ name: string; to: string } | null>(null);
  const [offerings, setOfferings] = useState<MemberOfferings>({ services: [], goods: [] });
  const [inWeb, setInWebState] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const [homeSpot, setHomeSpot] = useState<MappableMember | null>(null);
  const [bookables, setBookables] = useState<BookingType[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const [m, off, mine, mappable] = await Promise.all([
        loadMemberProfile(id),
        loadMemberOfferings(id),
        me ? loadMyWeb() : Promise.resolve({ web: new Set<string>(), vouched: new Set<string>() }),
        me ? loadMappableMembers() : Promise.resolve([] as MappableMember[]),
      ]);
      if (!live) return;
      setMember(m);
      setOfferings(off);
      if (me && id !== me) setBookables(await listBookableTypes(id));
      setInWebState(mine.web.has(`profile:${id}`));
      setTrusted(mine.vouched.has(`profile:${id}`));
      if (me && id === me) {
        // SELF-VIEW: the resolver hands the owner their exact address ("your
        // own data"), but this page promises "how other members see you" —
        // so render what your EVERYONE rule grants (default hidden), never
        // the exact street address (founder, 2026-07-17).
        const [home, rules] = await Promise.all([loadMyHome(), loadMyLocationShares(me)]);
        if (!live) return;
        const everyone = rules.find((r) => r.audience_type === 'everyone')?.level ?? 'hidden';
        // Coarser levels never fall back toward the address — missing label = nothing.
        const placeFor: Record<string, string | null> = {
          area: home.area || null, county: home.county || null,
          state: home.state || null, exact: home.location || null,
        };
        setHomeSpot(
          everyone === 'hidden' ? null : {
            id: me,
            full_name: m?.full_name ?? null,
            avatar_url: null,
            lat: 0, lng: 0,
            level: everyone,
            place: placeFor[everyone] ?? null,
          },
        );
      } else {
        // What THIS viewer is allowed to see of their home (hidden → absent).
        setHomeSpot(mappable.find((x) => x.id === id) ?? null);
      }
      setLoading(false);
    })();
    return () => { live = false; };
  }, [id, me]);

  const isSelf = !!me && id === me;
  const [idTags, setIdTags] = useState<string[]>([]);
  // The open web (and the owner previewing) sees the shared page template.
  const [params] = useSearchParams();
  const previewing = params.get('preview') === '1';
  const [pub, setPub] = useState<{ contact: ContactInfo; page: PageMeta; on: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    void supabase.from('profiles').select('contact, page, public_page').eq('id', id).maybeSingle()
      .then(({ data }: { data: unknown }) => {
        const r = data as { contact?: ContactInfo | null; page?: PageMeta | null; public_page?: boolean } | null;
        if (live && r) setPub({ contact: r.contact ?? {}, page: r.page ?? {}, on: !!r.public_page });
      });
    return () => { live = false; };
  }, [id]);
  useEffect(() => {
    let live = true;
    void getIdentityTags(id).then((t) => { if (live) setIdTags(t); });
    return () => { live = false; };
  }, [id]);

  // De-branding (founder 2026-07-30): this member's face takes the top bar.
  useEffect(() => {
    if (!member) return;
    setTopIdentity({ id: member.id, name: member.full_name || 'A Lichen member', avatarUrl: member.avatar_url, kind: 'person' });
    return () => setTopIdentity(null);
  }, [member]);

  // Who tends this being (nothing to resolve for a person).
  useEffect(() => {
    if (!member || !member.kind || member.kind === 'person') { setSteward(null); return; }
    let live = true;
    void loadSteward(member).then((sv) => { if (live) setSteward(sv); });
    return () => { live = false; };
  }, [member]);

  const isBeing = !!member && !!member.kind && member.kind !== 'person';

  if (loading) return <div className="prof"><p className="mprof__muted">Loading…</p></div>;
  if (!member) {
    return (
      <div className="prof">
        {!me ? (
          <div className="sprof__signin">
            <p className="mprof__muted">Sign in to see full profile details.</p>
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/login?next=${encodeURIComponent(location.pathname)}`)}
            >
              Sign in
            </button>
            <button className="btn" onClick={() => navigate('/signup')}>
              Join Lichen — 3 months free
            </button>
          </div>
        ) : (
          <p className="mprof__muted">This page isn&rsquo;t available.</p>
        )}
      </div>
    );
  }

  const name = member.full_name || 'A Lichen member';

  async function toggleWeb() {
    if (!me) return;
    const next = !inWeb;
    setInWebState(next);                      // optimistic
    if (!next && trusted) setTrusted(false);  // leaving the web withdraws the vouch
    try { await setInWeb('profile', id, next); }
    catch (e) { console.error(e); setInWebState(!next); }
  }

  async function toggleTrust() {
    if (!me) return;
    const next = !trusted;
    setTrusted(next);                         // optimistic — a private vouch
    if (next && !inWeb) setInWebState(true);  // trusting auto-adds to the web
    try { await setVouch('profile', id, next); }
    catch (e) { console.error(e); setTrusted(!next); }
  }

  async function message() {
    if (!me || busy) return;
    setBusy(true);
    try {
      navigate(`/chat/${await ensureDirectChat(id)}`);
    } catch (e) { console.error('message', e); setBusy(false); }
  }

  // Signed-out visitors — and the owner hitting Preview — get the template.
  if ((!me || previewing) && pub && (pub.on || previewing)) {
    return (
      <PublicPage
        id={id}
        name={name}
        kindLabel={member.headline ?? undefined}
        avatarUrl={member.avatar_url}
        description={member.bio}
        offerings={[...offerings.services, ...offerings.goods]}
        contact={pub.contact}
        page={pub.page}
        preview={previewing}
      />
    );
  }

  return (
    <div className="prof">
      {isSelf && (
        <div className="view-toggle-row">
          <span className="view-toggle" role="group" aria-label="View">
            <button className="view-toggle__side is-on">Public view</button>
            <button
              className="view-toggle__side view-toggle__side--admin"
              onClick={() => navigate('/profile')}
            >
              Admin view
            </button>
          </span>
          <span className="mprof__selfhint">How other members see you.</span>
        </div>
      )}
      <div className="prof__head">
        <Avatar id={member.id} name={name} url={member.avatar_url} size={72} />
        <h1 className="prof__name">{name}</h1>
        {/* A being's kind and who tends it — the beyond-human members
            (founder 2026-08-05). Nothing renders for a person. */}
        {isBeing && (
          <p className="mprof__being">
            <span className="mprof__being-kind">{member.kind}</span>
            {steward && (
              <>
                {' · Stewarded by '}
                <Link className="mprof__being-steward" to={steward.to}>{steward.name}</Link>
              </>
            )}
          </p>
        )}
        {member.headline && <p className="mprof__headline">{member.headline}</p>}
        {idTags.length > 0 && (
          <p className="mprof__idtags">
            {idTags.map((t) => <span className="mprof__idtag" key={t}>{t}</span>)}
          </p>
        )}
        {homeSpot?.place && (
          <p className="mprof__loc">
            <Icon name="location" size={12} />{' '}
            {homeSpot.level !== 'exact' ? areaLabel(homeSpot.place) : homeSpot.place}
          </p>
        )}
        {bookables.length > 0 && (
          <div className="mprof__book">
            {bookables.map((bt) => (
              <button className="mprof__book-row" key={bt.id} onClick={() => navigate(`/book/${bt.id}`)}>
                <span className="mprof__book-body">
                  <span className="mprof__book-title">{bt.title}</span>
                  <span className="mprof__book-sub">
                    {bt.duration_min} min{bt.price ? ` · ${bt.price}` : ''}{bt.location ? ` · ${bt.location}` : ''}
                  </span>
                </span>
                <Icon name="chevron-right" size={14} />
              </button>
            ))}
          </div>
        )}
        {me && !isSelf && (
          <div className="mprof__actions">
            {/* You can't DM a horse — the door goes to whoever tends it. */}
            {isBeing ? (
              steward && (
                <button className="btn btn-primary mprof__btn"
                  onClick={() => navigate(steward.to)}>
                  <Icon name="message" size={14} /> Reach {steward.name.split(' ')[0]}
                </button>
              )
            ) : (
              <button className="btn btn-primary mprof__btn" onClick={message} disabled={busy}>
                <Icon name="message" size={14} /> {busy ? 'Opening…' : 'Message'}
              </button>
            )}
            <button
              className={'btn mprof__btn mprof__btn--trust' + (inWeb ? ' is-on' : '')}
              onClick={toggleWeb}
              title={inWeb ? 'In your my-celium — their doings flow to you' : 'Weave them into your my-celium (no trust implied)'}
            >
              <Icon name="user-multiple" size={14} /> {inWeb ? 'In your My-celium ✓' : 'Add to My-celium'}
            </button>
            <button
              className={'btn mprof__btn mprof__btn--trust' + (trusted ? ' is-on' : '')}
              onClick={toggleTrust}
              title={trusted ? 'You trust them — private, tap to undo' : 'Trust them — a private signal, never shown as a count'}
            >
              <Icon name="shield-user" size={14} /> {trusted ? 'Trusted ✓' : 'Trust'}
            </button>
          </div>
        )}
      </div>

      {/* Feed-first on mobile (founder 2026-07-19): a taste of the bio + one
          door to the full About room — the tag wall lives there now. */}
      {(member.bio || offerings.services.length > 0 || offerings.goods.length > 0) && (
        <div className="mprof__about">
          {member.bio && <p className="mprof__bio mprof__bio--clamp">{member.bio}</p>}
          <button className="mprof__aboutdoor" onClick={() => navigate(`/members/${id}/about`)}>
            About & offerings
            {(offerings.services.length + offerings.goods.length) > 0 && (
              <em>{offerings.services.length + offerings.goods.length} listed</em>
            )}
            <Icon name="chevron-right" size={13} />
          </button>
        </div>
      )}

      {/* The profile IS a feed — their contributions, standard lenses.
          Search scopes to just this person's stream. */}
      <ContributionsFeed
        profileId={member.id}
        me={me}
        entityName={name}
        leading={[{ icon: 'search', label: 'Search', onClick: () => navigate(`/search?member=${member.id}`) }]}
        assistantSection="profile"
        assistantOff={member.assistant_enabled === false}
      />
    </div>
  );
}

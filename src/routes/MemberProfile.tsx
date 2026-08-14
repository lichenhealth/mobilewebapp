import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { setTopIdentity } from '../lib/topIdentity';
import Avatar from '../components/Avatar';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import { getIdentityTags } from '../lib/meansApi';
import { loadSteward } from '../lib/stewardshipApi';
import { CLAUDE_PROFILE_ID, ensureDirectChat } from '../lib/chatApi';
import {
  loadMyWeb, setInWeb, setVouch, setRecommend, loadMyRecommendations, recommendKey,
} from '../lib/myceliumApi';
import {
  loadMappableMembers, loadMyHome, loadMyLocationShares, loadProfileBizLocations,
  areaLabel, type MappableMember,
} from '../lib/locationApi';
import ContributionsFeed from '../components/ContributionsFeed';
import { loadMemberProfile, loadMemberOfferings, type MemberProfile as MemberRow, type MemberOfferings } from '../lib/membersApi';
import { BookingType, listBookableTypes } from '../lib/bookingApi';
import '../routes/Bookings.css';
import './Profile.css';
import './MemberProfile.css';
import PublicPage, { type PageMeta, type FeedRenderCtx } from '../components/PublicPage';
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
  const { actor } = useActing();
  // Which of their offerings I recommend (keyed 'profile:id#category').
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [offerings, setOfferings] = useState<MemberOfferings>({ services: [], goods: [], rows: [] });
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
  const [params, setParams] = useSearchParams();
  const previewing = params.get('preview') === '1';
  // Inside the assistant's side-by-side frame this is meant to read as the
  // PAGE, not as an app you can steer — a view toggle in there would just
  // navigate the frame out from under the conversation.
  const embedded = params.get('embed') === '1';
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
  // Goods & Services addresses the member shows on their page.
  const [bizLocs, setBizLocs] = useState<{ label: string; location: string }[]>([]);
  useEffect(() => {
    let live = true;
    void loadProfileBizLocations(id).then((rows) => { if (live) setBizLocs(rows); });
    return () => { live = false; };
  }, [id]);

  // De-branding (founder 2026-07-30): this member's face takes the top bar.
  useEffect(() => {
    if (!member) return;
    setTopIdentity({ id: member.id, name: member.full_name || 'A Lichen member', avatarUrl: member.avatar_url, kind: 'person' });
    return () => setTopIdentity(null);
  }, [member]);

  useEffect(() => {
    if (!me) return;
    let live = true;
    void loadMyRecommendations().then((r) => { if (live) setMyRecs(r); });
    return () => { live = false; };
  }, [me]);

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
    if (id === CLAUDE_PROFILE_ID) { navigate('/assistant/feed'); return; }
    setBusy(true);
    try {
      navigate(`/chat/${await ensureDirectChat(id)}`);
    } catch (e) { console.error('message', e); setBusy(false); }
  }

  // ── The member-only pieces (founder 2026-08-05). These ride the template
  //    when you're signed in and simply aren't passed when you're not, which
  //    is the whole "omit the internal flags on the public web" idea. ──
  const identityExtras = (
    <>
      {isSelf && !embedded && (
        /* One three-way toggle everywhere (founder 2026-08-11): Admin
           manages, Lichen View is the internal experience, Public View is
           the website layer (?preview=1 renders the open-web template). */
        <div className="view-toggle-row">
          <span className="view-toggle" role="group" aria-label="View">
            <button
              className="view-toggle__side view-toggle__side--admin"
              onClick={() => navigate('/profile')}
            >
              Admin
            </button>
            <button
              className={'view-toggle__side' + (!previewing ? ' is-on' : '')}
              onClick={() => setParams({})}
            >
              Lichen View
            </button>
            <button
              className={'view-toggle__side' + (previewing ? ' is-on' : '')}
              onClick={() => setParams({ preview: '1' })}
            >
              Public View
            </button>
          </span>
          <span className="mprof__selfhint">
            {previewing
              ? 'Your public website — what the open web sees.'
              : 'How other members see you.'}
          </span>
        </div>
      )}
      {idTags.length > 0 && (
        <p className="mprof__idtags">
          {idTags.map((t) => <span className="mprof__idtag" key={t}>{t}</span>)}
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
          {isBeing ? (
            steward && (
              <button className="btn btn-primary mprof__btn" onClick={() => navigate(steward.to)}>
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
          >
            <Icon name="user-multiple" size={14} /> {inWeb ? 'In your My-celium ✓' : 'Add to My-celium'}
          </button>
          <button
            className={'btn mprof__btn mprof__btn--trust' + (trusted ? ' is-on' : '')}
            onClick={toggleTrust}
          >
            <Icon name="shield-user" size={14} /> {trusted ? 'Trusted ✓' : 'Trust'}
          </button>
          {/* Trust and my-celium are PERSONAL edges — mycelium.truster_id and
              recommendations.recommender_id both reference a profile, so a
              space cannot hold them. While you're acting as one, these still
              read and write YOUR relationship, and saying so beats letting the
              stable look like it vouched for someone (founder 2026-08-06). */}
          {actor.type !== 'self' && (
            <p className="mprof__whose">
              These are yours, not {actor.name}&rsquo;s — trust and my-celium are
              person-to-person.
            </p>
          )}
        </div>
      )}
    </>
  );

  // Render-function form (founder 2026-08-11): the Feed door rides the icon
  // row itself — lit when the feed is the active tab — and the row stays up
  // on About/Services as the way back.
  const memberFeed = (ctx: FeedRenderCtx) => (
    <ContributionsFeed
      profileId={member.id}
      me={me}
      entityName={name}
      // The open web gets the stream, not the workshop (founder
      // 2026-08-11): Search/Add/AI are member tools, so a guest — or the
      // owner previewing as one — sees only the Feed door and the areas.
      leading={ctx.guest ? [] : [
        { icon: 'search' as const, label: 'Search', onClick: () => navigate(`/search?member=${member.id}`) },
        ...(isSelf
          ? [{ icon: 'plus' as const, label: 'Add', onClick: () => navigate('/compose') }]
          : []),
      ]}
      assistantSection={ctx.guest ? undefined : 'profile'}
      assistantOff={member.assistant_enabled === false}
      feedDoor={{ here: ctx.showing, onClick: ctx.open }}
      navSlot={ctx.navSlot}
      emptyEscape={ctx.openHome ? { label: 'Visit the homepage to engage', onGo: ctx.openHome } : undefined}
      listHidden={!ctx.showing}
      interactive={!ctx.guest}
    />
  );

  // ONE structure (founder 2026-08-05): the web page IS the profile. Signed in
  // you get the same tabs plus the member-only pieces; signed out, the same
  // page with those omitted. public_page no longer decides WHETHER the
  // template renders — only what a signed-out visitor is allowed to see.
  const canSeeIt = !!me || previewing || pub?.on;
  if (pub && canSeeIt) {
    return (
      <PublicPage
        id={id}
        name={name}
        kindLabel={member.headline ?? undefined}
        avatarUrl={member.avatar_url}
        description={member.bio}
        location={homeSpot?.place
          ? (homeSpot.level !== 'exact' ? areaLabel(homeSpot.place) : homeSpot.place)
          : undefined}
        // Services and goods stay SPLIT — flattening them lost what the old
        // About page showed.
        offerings={[...offerings.services, ...offerings.goods]}
        offeringRows={offerings.rows}
        renderOfferingAction={me && !isSelf ? (o) => {
          // Recommend carries the acting-as voice — an org endorsing a
          // farrier is a real, different statement (founder 2026-08-06).
          const asSpace = actor.type === 'space' ? actor.id : undefined;
          const asName = actor.type === 'space' ? actor.name : '';
          const key = recommendKey('profile', member.id, o.id, asSpace);
          const on = myRecs.has(key);
          return (
            <button
              className={'ppage__offer-rec' + (on ? ' is-on' : '')}
              aria-pressed={on}
              title={on
                ? `${asName || 'You'} recommend ${o.name}`
                : `Recommend their ${o.name}${asName ? ` as ${asName}` : ''}`}
              onClick={() => {
                setMyRecs((prev) => {
                  const next = new Set(prev);
                  if (on) next.delete(key); else next.add(key);
                  return next;
                });
                void setRecommend('profile', member.id, !on, o.id, asSpace).catch(console.error);
              }}
            >
              <Icon name="thumbs-up" size={13} />
              {on ? 'Recommended' : 'Recommend'}
              {asName && <em className="ppage__offer-as">as {asName}</em>}
            </button>
          );
        } : undefined}
        contact={pub.contact}
        bizLocations={bizLocs}
        page={pub.page}
        preview={previewing}
        signedIn={!!me}
        feed={memberFeed}
        beforeContent={me ? identityExtras : undefined}
      />
    );
  }

  // Fallback when the page blob hasn't loaded (or the row is unreadable):
  // identity, the member-only pieces, the feed. No About door — that content
  // is the About tab now.
  return (
    <div className="prof">
      <div className="prof__head">
        <Avatar id={member.id} name={name} url={member.avatar_url} size={72} />
        <h1 className="prof__name">{name}</h1>
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
        {member.bio && <p className="mprof__bio">{member.bio}</p>}
      </div>
      {identityExtras}
      {memberFeed({ showing: true, open: () => {}, guest: !me })}
    </div>
  );
}

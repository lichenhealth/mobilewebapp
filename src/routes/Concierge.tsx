import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Icon, IconName } from '../components/Icon';
import HexagonRadar from '../components/HexagonRadar';
import ChatConversation from '../components/ChatConversation';
import { supabase } from '../lib/supabase';
import { loadConciergeAccess } from '../lib/chatApi';
import { useAuth } from '../auth/AuthProvider';
import { TODAY_SNAPSHOT, WEEK_CARE_PLAN, ON_CALL_NOW, BACKUP_PRACTITIONERS } from '../data/concierge';
import './Concierge.css';

type ConciergeTab = 'wow' | 'koc' | 'chat' | 'urgent';

/** Renders body text with {{ai:phrase}} markers transformed into <span>s
 *  that get peach color when AI is on, muted gray when AI is off. */
function BodyWithAI({ text, aiOn }: { text: string; aiOn: boolean }) {
  const parts = text.split(/(\{\{ai:[^}]+\}\})/g);
  return (
    <p className="snap__body-text">
      {parts.map((p, i) => {
        const m = p.match(/^\{\{ai:([^}]+)\}\}$/);
        if (m) {
          return (
            <span
              key={i}
              className={'snap__ai-ref' + (aiOn ? '' : ' is-off')}
            >
              {m[1]}
            </span>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </p>
  );
}

/** Renders KOC care item text with two markers:
 *    [phrase]       → peach-underlined intervention link
 *    {icon-name}    → small inline icon */
function CareItemText({ text }: { text: string }) {
  // Tokenize: match either [phrase], {icon}, or plain text
  const tokens = text.split(/(\[[^\]]+\]|\{[^}]+\})/g);
  return (
    <>
      {tokens.map((tok, i) => {
        const linkMatch = tok.match(/^\[([^\]]+)\]$/);
        if (linkMatch) {
          return <span key={i} className="koc__link">{linkMatch[1]}</span>;
        }
        const iconMatch = tok.match(/^\{([^}]+)\}$/);
        if (iconMatch) {
          return (
            <span key={i} className="koc__inline-icon">
              <Icon name={iconMatch[1] as IconName} size={12} />
            </span>
          );
        }
        return <span key={i}>{tok}</span>;
      })}
    </>
  );
}

/** Urgent Care: connect with the on-call practitioner now (text or call),
 *  with optional context (message + photo/video/voice). If the on-call
 *  practitioner is on the user's care team, they get a peach priority badge. */
function UrgentCare() {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<{ kind: 'photo' | 'video' | 'voice'; label: string }[]>([]);
  const [sentNote, setSentNote] = useState(false);

  const addAttachment = (kind: 'photo' | 'video' | 'voice') => {
    const labels = {
      photo: `Photo ${attachments.filter(a => a.kind === 'photo').length + 1}`,
      video: `Video ${attachments.filter(a => a.kind === 'video').length + 1}`,
      voice: `Voice ${attachments.filter(a => a.kind === 'voice').length + 1}`,
    };
    setAttachments((a) => [...a, { kind, label: labels[kind] }]);
  };

  const removeAttachment = (i: number) => {
    setAttachments((a) => a.filter((_, idx) => idx !== i));
  };

  const handleSend = () => {
    if (!message.trim() && attachments.length === 0) return;
    setSentNote(true);
    setMessage('');
    setAttachments([]);
    setTimeout(() => setSentNote(false), 3000);
  };

  const handleCall = () => {
    // In production: window.location.href = `tel:${ON_CALL_NOW.phone}`;
    setSentNote(true);
    setTimeout(() => setSentNote(false), 2400);
  };

  return (
    <div className="urgent">
      <header className="urgent__head">
        <p className="urgent__eyebrow">Get help now</p>
        <h2 className="urgent__title">
          Reach the practitioner <span className="display-italic">on call.</span>
        </h2>
        <p className="urgent__sub">
          For non-life-threatening urgent care from a Lichen practitioner. Typical
          response time is under 10 minutes.
        </p>
      </header>

      {/* On-call practitioner card */}
      <article className="urgent__oncall">
        {ON_CALL_NOW.isOnUserTeam && (
          <div className="urgent__priority-badge">
            <Icon name="shield-user" size={11} />
            <span>Priority routed &mdash; on your care team</span>
          </div>
        )}
        <header className="urgent__oncall-head">
          <div
            className="urgent__avatar"
            style={{ background: ON_CALL_NOW.color }}
          >
            {ON_CALL_NOW.monogram}
          </div>
          <div className="urgent__oncall-id">
            <h3 className="urgent__oncall-name">{ON_CALL_NOW.name}</h3>
            <p className="urgent__oncall-role">{ON_CALL_NOW.role}</p>
          </div>
          <div className="urgent__status">
            <span className="urgent__status-dot" />
            <span>Available</span>
          </div>
        </header>
        <p className="urgent__oncall-blurb">{ON_CALL_NOW.blurb}</p>
        <p className="urgent__response">
          <Icon name="sparkle" size={11} />
          <span>Responds in <strong>{ON_CALL_NOW.responseTime}</strong></span>
        </p>

        {/* Primary actions: Call (peach) + Text (outline) */}
        <div className="urgent__actions">
          <button className="urgent__call" onClick={handleCall}>
            <Icon name="phone" size={16} />
            <span>Call {ON_CALL_NOW.name.split(' ')[0]}</span>
          </button>
          <a
            href="#urgent-text"
            className="urgent__text-btn"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById('urgent-text')?.focus();
            }}
          >
            <Icon name="message" size={16} />
            <span>Text</span>
          </a>
        </div>
      </article>

      {/* Context section: message + media attachments */}
      <section className="urgent__context">
        <h3 className="urgent__h3">What&rsquo;s going on?</h3>
        <textarea
          id="urgent-text"
          className="urgent__textarea"
          placeholder="Describe what you&rsquo;re experiencing. Symptoms, timing, anything that might help them help you faster."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
        />

        {/* Attachment chips */}
        {attachments.length > 0 && (
          <ul className="urgent__attachments">
            {attachments.map((a, i) => (
              <li key={i} className="urgent__chip">
                <Icon name={a.kind === 'photo' ? 'image' : a.kind === 'video' ? 'video' : 'mic'} size={12} />
                <span>{a.label}</span>
                <button
                  className="urgent__chip-x"
                  onClick={() => removeAttachment(i)}
                  aria-label={`Remove ${a.label}`}
                >
                  <Icon name="close" size={10} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Attachment row */}
        <div className="urgent__attach-row">
          <p className="urgent__attach-label">Add context</p>
          <div className="urgent__attach-buttons">
            <button className="urgent__attach-btn" onClick={() => addAttachment('photo')}>
              <Icon name="image" size={16} />
              <span>Photo</span>
            </button>
            <button className="urgent__attach-btn" onClick={() => addAttachment('video')}>
              <Icon name="video" size={16} />
              <span>Video</span>
            </button>
            <button className="urgent__attach-btn" onClick={() => addAttachment('voice')}>
              <Icon name="mic" size={16} />
              <span>Voice</span>
            </button>
          </div>
        </div>

        {/* Send button */}
        <button
          className="urgent__send"
          onClick={handleSend}
          disabled={!message.trim() && attachments.length === 0}
        >
          <Icon name="send" size={14} />
          <span>Send to {ON_CALL_NOW.name.split(' ')[0]}</span>
        </button>
      </section>

      {/* Backup options */}
      <section className="urgent__backup">
        <h3 className="urgent__h3">If they don&rsquo;t pick up</h3>
        <p className="urgent__sub urgent__sub--tight">
          These Lichen practitioners are also on call right now.
        </p>
        <ul className="urgent__backup-list">
          {BACKUP_PRACTITIONERS.map((p) => (
            <li key={p.id} className="urgent__backup-item">
              <div
                className="urgent__avatar urgent__avatar--sm"
                style={{ background: p.color }}
              >
                {p.monogram}
              </div>
              <div className="urgent__backup-body">
                <div className="urgent__backup-row">
                  <span className="urgent__backup-name">{p.name}</span>
                  <span className="urgent__backup-rt">{p.responseTime}</span>
                </div>
                <span className="urgent__backup-role">{p.role} &middot; {p.blurb}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Emergency disclaimer */}
      <aside className="urgent__emergency">
        <Icon name="info" size={14} />
        <p>
          <strong>If this is a life-threatening emergency,</strong> call <a href="tel:911">911</a> immediately. Lichen urgent care is not a substitute for emergency services.
        </p>
      </aside>

      {/* Toast for send/call (placeholder for now — wire to real services later) */}
      {sentNote && (
        <div className="mkt__toast">
          Connecting you with {ON_CALL_NOW.name.split(' ')[0]}&hellip;
        </div>
      )}
    </div>
  );
}

export default function Concierge() {
  const { tab, patientId } = useParams<{ tab?: ConciergeTab; patientId?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const activeTab: ConciergeTab = (tab as ConciergeTab) ?? 'wow';

  // Client view: a caregiver viewing one of their clients' Concierge page.
  // Self view (no patientId): the member's own Concierge. The "subject" is whose
  // care data we show.
  const isClientView = !!patientId;
  const subjectId = patientId ?? me;

  const [aiOn, setAiOn] = useState(true);
  const [scope, setScope] = useState<'Day' | 'Week' | 'Month'>('Day');
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');

  // Concierge access (care-team chat, client view): active Concierge tier, or admin.
  const [careAllowed, setCareAllowed] = useState<boolean | null>(null);
  const [careChatId, setCareChatId] = useState<string | null>(null);
  const [careReady, setCareReady] = useState(false);
  const [clientName, setClientName] = useState<string | null>(null);
  const [clientAuthorized, setClientAuthorized] = useState(true); // am I a caregiver of this patient?
  const careAnchor = useRef<HTMLDivElement>(null);
  const [careTop, setCareTop] = useState(0);

  useEffect(() => {
    if (!me) return;
    let active = true;
    (async () => {
      const allowed = await loadConciergeAccess(me);
      // The care-team chat for whoever we're viewing (self or a client).
      const chatRes = await supabase
        .from('chats').select('id').eq('patient_id', subjectId).eq('kind', 'care_team').maybeSingle();
      let name: string | null = null;
      let authorized = true;
      if (isClientView) {
        // Confirm I actually care for this patient, and grab their name for the header.
        const linkRes = await supabase
          .from('care_team_members')
          .select('patient:profiles!care_team_members_patient_id_fkey(full_name)')
          .eq('caregiver_id', me).eq('patient_id', subjectId).eq('status', 'active')
          .maybeSingle();
        const link = linkRes.data as { patient: { full_name: string | null } | null } | null;
        authorized = !!link;
        name = link?.patient?.full_name ?? 'Client';
      }
      if (!active) return;
      setCareAllowed(allowed);
      setCareChatId((chatRes.data as { id: string } | null)?.id ?? null);
      setClientName(name);
      setClientAuthorized(authorized);
      setCareReady(true);
    })();
    return () => { active = false; };
  }, [me, subjectId, isClientView]);

  // The care chat is a fixed panel filling from below the tabs to above the nav;
  // measure where it should start so it tracks the (variable) top chrome height.
  useLayoutEffect(() => {
    if (activeTab !== 'chat') return;
    const measure = () => { const el = careAnchor.current; if (el) setCareTop(el.getBoundingClientRect().top); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [activeTab, showSearch, careReady, careAllowed, careChatId, clientName]);

  // Default scope follows the active tab: Day for WOW, Week for KOC
  useEffect(() => {
    if (activeTab === 'koc') setScope('Week');
    else if (activeTab === 'wow') setScope('Day');
  }, [activeTab]);

  // Tab routing — patient-aware so client view stays within /concierge/client/:id.
  const basePath = isClientView ? `/concierge/client/${patientId}` : '/concierge';
  const handleTabClick = (target: ConciergeTab) => {
    navigate(target === 'wow' ? basePath : `${basePath}/${target}`);
  };

  const snap = TODAY_SNAPSHOT;

  // In client view, gate the WHOLE page behind access + caregiver relationship.
  if (isClientView && careReady && (careAllowed === false || !clientAuthorized)) {
    return (
      <div className="conc">
        <header className="conc__head conc__head--client">
          <button className="conc__back" onClick={() => navigate('/caregiver')} aria-label="Back">
            <Icon name="arrow-left" size={18} />
          </button>
          <h1 className="conc__title">Concierge</h1>
        </header>
        <div className="conc__care-gate">
          <Icon name="shield-user" size={22} />
          <h3 className="conc__care-gate-title">
            {careAllowed === false ? 'Concierge access required' : 'Not your client'}
          </h3>
          <p className="conc__care-gate-sub">
            {careAllowed === false
              ? 'The caregiver dashboard is part of Concierge membership.'
              : 'You don’t have an active care connection with this member.'}
          </p>
          <button className="btn btn-primary" onClick={() => navigate(careAllowed === false ? '/membership' : '/caregiver')}>
            {careAllowed === false ? 'See Concierge' : 'Back to clients'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="conc">
      <header className={'conc__head' + (isClientView ? ' conc__head--client' : '')}>
        {isClientView && (
          <button className="conc__back" onClick={() => navigate('/caregiver')} aria-label="Back to clients">
            <Icon name="arrow-left" size={18} />
          </button>
        )}
        <h1 className="conc__title">
          {isClientView ? (clientName ?? 'Client') : 'Concierge'}
        </h1>
        {isClientView && <span className="conc__client-tag">Client view</span>}
      </header>

      {/* 4 tabs: WOW / KOC / Chat / Urgent Care */}
      <nav className="conc__tabs">
        <button
          className={'conc__tab' + (activeTab === 'wow' ? ' is-active' : '')}
          onClick={() => handleTabClick('wow')}
        >
          WOW
        </button>
        <button
          className={'conc__tab' + (activeTab === 'koc' ? ' is-active' : '')}
          onClick={() => handleTabClick('koc')}
        >
          KOC
        </button>
        <button
          className={'conc__tab' + (activeTab === 'chat' ? ' is-active' : '')}
          onClick={() => handleTabClick('chat')}
        >
          Chat
        </button>
        <button
          className={'conc__tab' + (activeTab === 'urgent' ? ' is-active' : '')}
          onClick={() => handleTabClick('urgent')}
        >
          Urgent Care
        </button>
      </nav>

      {/* Tool row (search · AI brain · scope · pagination) */}
      <div className="conc__tools">
        <button
          className={'conc__tool-circle' + (showSearch ? ' is-active' : '')}
          onClick={() => {
            setShowSearch((s) => !s);
            if (showSearch) setQuery('');
          }}
          aria-label="Search"
        >
          <Icon name="search" size={14} />
        </button>
        <button
          className={'conc__brain' + (aiOn ? ' is-on' : '')}
          onClick={() => setAiOn((v) => !v)}
          aria-pressed={aiOn}
          title={aiOn ? 'AI assistance on \u2014 tap to disable' : 'AI assistance off \u2014 tap to enable'}
        >
          <Icon name="brain" size={20} />
        </button>
        {activeTab !== 'chat' && activeTab !== 'urgent' && (
          <>
            <div className="conc__scope">
              <button
                className="conc__scope-label"
                onClick={() => {
                  const order: typeof scope[] = ['Day', 'Week', 'Month'];
                  const i = order.indexOf(scope);
                  setScope(order[(i + 1) % order.length]);
                }}
              >
                {scope}
              </button>
              <button
                className="conc__scope-arrow"
                onClick={() => {
                  const order: typeof scope[] = ['Day', 'Week', 'Month'];
                  const i = order.indexOf(scope);
                  setScope(order[(i + 1) % order.length]);
                }}
                aria-label="Cycle scope"
              >
                <Icon name="chevron-right" size={10} />
              </button>
            </div>
            <div className="conc__pager">
              <button className="conc__tool-circle conc__pager-btn" aria-label="Previous">
                <Icon name="chevron-left" size={12} />
              </button>
              <button className="conc__tool-circle conc__pager-btn" aria-label="Next">
                <Icon name="chevron-right" size={12} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Search bar (toggleable) */}
      {showSearch && (
        <div className="conc__search">
          <Icon name="search" size={14} />
          <input
            autoFocus
            className="conc__search-input"
            placeholder="Search your snapshots"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button onClick={() => setQuery('')} className="conc__search-clear" aria-label="Clear">
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      )}

      {/* Active tab content */}
      {activeTab === 'wow' && (
        <article className="snap">
          <header className="snap__head">
            <div className="snap__avatar" style={{ background: snap.patient.color }}>
              {snap.patient.monogram}
            </div>
            <span className="snap__name">{snap.patient.name}</span>
            <span className="snap__date">{snap.date}</span>
          </header>

          <section className="snap__summary">
            <div className="snap__summary-text">
              <h3 className="snap__h3">Summary</h3>
              <p className="snap__body-text">{snap.summary}</p>
            </div>
            <HexagonRadar axes={snap.axes} size={200} />
          </section>

          {snap.sections.map((s) => (
            <section className="snap__section" key={s.title}>
              <h3 className="snap__h3 snap__h3--center">{s.title}</h3>
              <ol className="snap__list">
                {s.items.map((it, i) => (
                  <li key={i} className="snap__list-item">
                    {it}
                  </li>
                ))}
              </ol>
              <BodyWithAI text={s.body} aiOn={aiOn} />
            </section>
          ))}

          <footer className="conc__end">
            <span className="eyebrow">End of snapshot</span>
            <Icon name="sparkle" size={14} />
          </footer>
        </article>
      )}

      {activeTab === 'koc' && (
        <article className="snap koc">
          <header className="snap__head">
            <div className="snap__avatar" style={{ background: WEEK_CARE_PLAN.patient.color }}>
              {WEEK_CARE_PLAN.patient.monogram}
            </div>
            <span className="snap__name">{WEEK_CARE_PLAN.patient.name}</span>
            <span className="snap__date">{WEEK_CARE_PLAN.dateRange}</span>
          </header>

          {WEEK_CARE_PLAN.days.map((day) => (
            <section className="koc__day" key={day.label}>
              <h3 className="koc__day-label">{day.label}</h3>
              {day.providers.map((p) => (
                <div className="koc__provider-block" key={p.handle}>
                  <p className="koc__handle">{p.handle}:</p>
                  <ul className="koc__items">
                    {p.items.map((item, i) => (
                      <li key={i} className="koc__item">
                        <CareItemText text={item.text} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}

          <footer className="conc__end">
            <span className="eyebrow">End of week</span>
            <Icon name="sparkle" size={14} />
          </footer>
        </article>
      )}

      {activeTab === 'chat' && (
        <>
          <div ref={careAnchor} className="conc__care-anchor" aria-hidden="true" />

          {!careReady && <p className="conc__care-hint">Loading your care team…</p>}

          {careReady && careAllowed === false && (
            <div className="conc__care-gate">
              <Icon name="shield-user" size={22} />
              <h3 className="conc__care-gate-title">Your care team, in one place</h3>
              <p className="conc__care-gate-sub">
                The care-team chat — where your practitioners coordinate with you — is part of
                Concierge membership.
              </p>
              <button className="btn btn-primary" onClick={() => navigate('/membership')}>
                See Concierge
              </button>
            </div>
          )}

          {careReady && careAllowed && !careChatId && (
            <div className="conc__care-gate">
              <Icon name="heart-line" size={22} />
              <h3 className="conc__care-gate-title">No care team yet</h3>
              <p className="conc__care-gate-sub">
                Add caregivers from your profile. Once someone joins, your care-team chat opens here.
              </p>
              <button className="btn btn-primary" onClick={() => navigate('/profile')}>
                Manage care team
              </button>
            </div>
          )}

          {careReady && careAllowed && careChatId && (
            <div className="conc__care" style={{ top: careTop }}>
              <ChatConversation chatId={careChatId} me={me} showIntro={false} />
            </div>
          )}
        </>
      )}

      {activeTab === 'urgent' && <UrgentCare />}
    </div>
  );
}

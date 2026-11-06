import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { APP_ORIGIN } from '../lib/customDomain';
import FitSelect from './FitSelect';
import {
  loadMyContactShares, setContactShare, loadSpaceMemberContacts,
  SHARE_LABEL, type ShareLevel, type ContactShare, type MemberContact,
} from '../lib/contactSharesApi';
import { exportRows, type ExportRow } from '../lib/guestListsApi';
import { loadPrompts, promptSeen, markPrompt } from '../lib/promptsApi';
import './ContactShares.css';

// WHO IN MY GROUPS CAN SEE MY CONTACT INFO (founder 2026-11-06: "it should
// be in permissions whether you want other members of the group to know
// your contact info - as they may not have it"). Three levels, per group,
// email and phone separately; the server applies them (space_member_contacts).
// Several doors, one row: Profile → Privacy lists every group; the group's
// own page asks once and its Members tab carries the same control.

const LEVELS: ShareLevel[] = ['nobody', 'stewards', 'members'];

function LevelSelect({ value, onChange, label }: { value: ShareLevel; onChange: (v: ShareLevel) => void; label: string }) {
  return (
    <FitSelect className="cshare__select" aria-label={label} value={value}
      onChange={(e) => onChange(e.target.value as ShareLevel)}>
      {LEVELS.map((l) => <option key={l} value={l}>{SHARE_LABEL[l]}</option>)}
    </FitSelect>
  );
}

/** One group's two choices. */
function ShareRow({ me, spaceId, initial, onSaved }: {
  me: string; spaceId: string; initial?: ContactShare; onSaved?: () => void;
}) {
  const [email, setEmail] = useState<ShareLevel>(initial?.email_level ?? 'nobody');
  const [phone, setPhone] = useState<ShareLevel>(initial?.phone_level ?? 'nobody');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    setEmail(initial?.email_level ?? 'nobody');
    setPhone(initial?.phone_level ?? 'nobody');
  }, [initial?.email_level, initial?.phone_level]);
  async function save(e: ShareLevel, p: ShareLevel) {
    setEmail(e); setPhone(p);
    try { await setContactShare(me, spaceId, e, p); setMsg('Saved ✓'); onSaved?.(); }
    catch (err) { setMsg((err as Error).message); }
    window.setTimeout(() => setMsg(null), 2500);
  }
  return (
    <div className="cshare__pair">
      <span className="cshare__field">
        <span className="cshare__lbl">Email</span>
        <LevelSelect label="Who sees your email" value={email} onChange={(v) => void save(v, phone)} />
      </span>
      <span className="cshare__field">
        <span className="cshare__lbl">Phone</span>
        <LevelSelect label="Who sees your phone" value={phone} onChange={(v) => void save(email, v)} />
      </span>
      {msg && <span className="cshare__msg">{msg}</span>}
    </div>
  );
}

/** Profile → Privacy: every group you belong to, one row each. */
export function ContactSharesList({ me }: { me: string }) {
  const [spaces, setSpaces] = useState<{ id: string; name: string }[]>([]);
  const [shares, setShares] = useState<Map<string, ContactShare>>(new Map());
  useEffect(() => {
    if (!me) return;
    void (async () => {
      const { data } = await supabase.from('space_members')
        .select('space:spaces(id, name)').eq('profile_id', me);
      const rows = ((data as unknown as { space: { id: string; name: string } | null }[] | null) ?? [])
        .map((r) => r.space).filter((s): s is { id: string; name: string } => !!s)
        .sort((a, b) => a.name.localeCompare(b.name));
      setSpaces(rows);
      setShares(await loadMyContactShares(me));
    })();
  }, [me]);
  if (!spaces.length) return <p className="cshare__none">You’re not in any groups yet — when you join one, you’ll choose here who there can see your contact info.</p>;
  return (
    <div className="cshare__list">
      {spaces.map((s) => (
        <div key={s.id} className="cshare__row">
          <span className="cshare__name">{s.name}</span>
          <ShareRow me={me} spaceId={s.id} initial={shares.get(s.id)} />
        </div>
      ))}
    </div>
  );
}

/** The group page's one-time question (asked once per group, never again;
 *  skipping = Nobody, the default). */
export function ContactShareAsk({ me, spaceId, spaceName }: { me: string; spaceId: string; spaceName: string }) {
  const topic = `contact-share-${spaceId}`;
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!me) return;
    let live = true;
    void (async () => {
      await loadPrompts(me);
      if (promptSeen(topic)) return;
      const shares = await loadMyContactShares(me);
      if (live && !shares.has(spaceId)) setShow(true);
    })();
    return () => { live = false; };
  }, [me, spaceId]);
  if (!show) return null;
  const done = () => { void markPrompt(me, topic); setShow(false); };
  return (
    <div className="cshare__ask">
      <p className="cshare__ask-q">Who in <strong>{spaceName}</strong> can see your contact info?</p>
      <p className="cshare__ask-sub">Your email and phone stay private unless you choose. Stewards might want them to reach you off Lichen; fellow members may not have them at all.</p>
      <ShareRow me={me} spaceId={spaceId} onSaved={() => void markPrompt(me, topic)} />
      <div className="cshare__ask-acts">
        <button className="cshare__ask-btn" onClick={done}>Done</button>
        <button className="cshare__ask-skip" onClick={done}>Keep it private</button>
      </div>
      <p className="cshare__fine">Change it any time in Profile → Privacy, or on this group’s Members tab.</p>
    </div>
  );
}

/** The Members tab's contact block: your own choice for this group, the
 *  contact details you're allowed to see, and the export. */
export function SpaceContactsPanel({ me, spaceId, spaceName, steward }: {
  me: string; spaceId: string; spaceName: string; steward: boolean;
}) {
  const [rows, setRows] = useState<MemberContact[] | null>(null);
  const [mine, setMine] = useState<ContactShare | undefined>(undefined);
  const [showList, setShowList] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function load() {
    try {
      setRows(await loadSpaceMemberContacts(spaceId));
      setMine((await loadMyContactShares(me)).get(spaceId));
    } catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => { if (me) void load(); }, [me, spaceId]);
  if (err) return null;
  if (!rows) return null;
  const others = rows.filter((r) => r.profile_id !== me);
  const sharing = others.filter((r) => r.email || r.phone);
  const toExport = (): ExportRow[] => rows.map((r) => ({
    name: r.full_name ?? 'Member',
    email: r.email ?? undefined,
    phone: r.phone ?? undefined,
    url: r.handle ? `${APP_ORIGIN}/${r.handle}` : `${APP_ORIGIN}/members/${r.profile_id}`,
    note: r.role === 'member' ? undefined : r.role.replace('_', ' '),
  }));
  return (
    <div className="cshare__panel">
      <p className="cshare__panel-head">Contact details</p>
      <p className="cshare__panel-sub">
        {sharing.length} of {others.length} {others.length === 1 ? 'member shares' : 'members share'} contact details with {steward ? 'stewards like you' : 'you'}.
        {' '}Everyone else exports as their name and Lichen link.
      </p>
      <div className="cshare__panel-acts">
        {sharing.length > 0 && (
          <button className="cshare__act" onClick={() => setShowList((v) => !v)}>{showList ? 'Hide' : 'Show'} contact details</button>
        )}
        <button className="cshare__act" onClick={() => exportRows(`${spaceName} members`, toExport(), 'csv')}>Export CSV</button>
        <button className="cshare__act" onClick={() => exportRows(`${spaceName} members`, toExport(), 'vcf')}>Export vCard</button>
      </div>
      {showList && (
        <div className="cshare__visible">
          {sharing.map((r) => (
            <div key={r.profile_id} className="cshare__vrow">
              <span className="cshare__vname">{r.full_name ?? 'Member'}</span>
              {r.email && <a className="link-cue" href={`mailto:${r.email}`}>{r.email}</a>}
              {r.phone && <a className="link-cue" href={`tel:${r.phone}`}>{r.phone}</a>}
            </div>
          ))}
        </div>
      )}
      <p className="cshare__panel-head cshare__panel-head--mine">Your contact info here</p>
      <ShareRow me={me} spaceId={spaceId} initial={mine} onSaved={() => void markPrompt(me, `contact-share-${spaceId}`)} />
    </div>
  );
}

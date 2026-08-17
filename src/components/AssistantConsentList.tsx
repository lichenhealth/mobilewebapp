import { useEffect, useState } from 'react';
import { CONSENT_SECTIONS, listConsentOff, setConsent } from '../lib/assistantConsentApi';
import { supabase } from '../lib/supabase';
import './AssistantConsentList.css';

// The member's own de-selection list (founder 2026-08-17): "You can say 'all
// on' or you can de-select certain aspects of your identity." Everything is
// on by default — collaboration between Ai and Oi is the premise of the
// platform, so this is the one place unknown IS yes — and each unticked box
// is one deliberate "not here", stored as one row the edge functions check
// server-side. The brain on each page flips the same switch in place.

type MySpaceRow = { id: string; name: string; kind: string; aiOff: boolean };

export default function AssistantConsentList() {
  const [off, setOff] = useState<Set<string>>(new Set());
  const [spaceOff, setSpaceOff] = useState<Set<string>>(new Set());
  const [mySpaces, setMySpaces] = useState<MySpaceRow[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      const me = u?.user?.id;
      const [rows, memRes] = await Promise.all([
        listConsentOff(),
        // ⚠ filter to OWN rows — space_members RLS shows fellow members too,
        // and an unfiltered read would list spaces via other people's rows.
        me
          ? supabase.from('space_members')
              .select('spaces(id, name, kind, assistant_enabled)')
              .eq('profile_id', me)
              .limit(80)
          : Promise.resolve({ data: null }),
      ]);
      if (!live) return;
      setOff(new Set(rows.filter((r) => r.scope_type === 'section').map((r) => r.scope_id)));
      setSpaceOff(new Set(rows.filter((r) => r.scope_type === 'space').map((r) => r.scope_id)));
      const mem = (memRes.data as unknown as { spaces: { id: string; name: string; kind: string; assistant_enabled?: boolean } | null }[] | null) ?? [];
      setMySpaces(mem
        .map((r) => r.spaces)
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => ({ id: s.id, name: s.name, kind: s.kind, aiOff: s.assistant_enabled === false }))
        .sort((a, b) => a.name.localeCompare(b.name)));
      setReady(true);
    })();
    return () => { live = false; };
  }, []);

  const toggle = (scope: 'section' | 'space', id: string) => {
    const set = scope === 'section' ? setOff : setSpaceOff;
    const cur = scope === 'section' ? off : spaceOff;
    const turningOn = cur.has(id);
    set((prev) => {
      const next = new Set(prev);
      if (turningOn) next.delete(id); else next.add(id);
      return next;
    });
    setConsent(scope, id, turningOn);
  };

  return (
    <div className="aicl" aria-busy={!ready}>
      <div className="aicl__grid">
        {CONSENT_SECTIONS.map((s) => (
          <label key={s.id} className={'aicl__item' + (off.has(s.id) ? ' is-off' : '')}>
            <input
              type="checkbox"
              checked={!off.has(s.id)}
              disabled={!ready}
              onChange={() => toggle('section', s.id)}
            />
            <span>{s.label}</span>
          </label>
        ))}
      </div>
      {/* Per-SPACE de-selection (founder 2026-08-17: "de-select certain
          aspects of your identity" — the groups you belong to are aspects).
          A space that has switched its own AI fabric off is shown as such:
          mutual visibility, the same doctrine as care. */}
      {mySpaces.length > 0 && (
        <>
          <p className="aicl__group">In the groups &amp; places you belong to</p>
          <div className="aicl__grid aicl__grid--spaces">
            {mySpaces.map((s) => (
              <label key={s.id} className={'aicl__item' + (spaceOff.has(s.id) || s.aiOff ? ' is-off' : '')}>
                <input
                  type="checkbox"
                  checked={!spaceOff.has(s.id)}
                  disabled={!ready || s.aiOff}
                  onChange={() => toggle('space', s.id)}
                />
                <span>
                  {s.name}
                  {s.aiOff && <em className="aicl__space-note"> — has switched its own AI off</em>}
                </span>
              </label>
            ))}
          </div>
        </>
      )}
      <p className="aicl__note">
        Unticked, the assistant never reads, gathers or answers in that part of
        your Lichen life — on any of your devices. The brain on each page flips
        the same switch.
      </p>
    </div>
  );
}

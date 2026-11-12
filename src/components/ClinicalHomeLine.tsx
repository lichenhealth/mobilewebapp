import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { loadClinicalHome, type ClinicalHome } from '../lib/clinicalHomeApi';
import './ClinicalHomeField.css';

/** "For anything clinical, Galyn uses SimplePractice ›" — shown to signed-in
 *  members on a provider's profile and on care surfaces (founder 2026-11-12).
 *  Renders nothing when the provider hasn't named one. */
export default function ClinicalHomeLine({ profileId, name, home: given, self }: {
  profileId: string; name: string; home?: ClinicalHome | null; self?: boolean;
}) {
  const [home, setHome] = useState<ClinicalHome | null>(given ?? null);
  useEffect(() => {
    if (given !== undefined) { setHome(given); return; }
    let live = true;
    void loadClinicalHome(profileId).then((h) => { if (live) setHome(h); });
    return () => { live = false; };
  }, [profileId, given]);
  if (!home) return null;
  const who = self ? 'you use' : `${name.trim().split(/\s+/)[0] || 'they'} uses`;
  return (
    <div className="clinline">
      <Icon name="member-heart" size={15} className="clinline__icon" />
      <div>
        <p>
          For anything clinical, {who}{' '}
          {home.url
            ? <a className="link-cue" href={home.url} target="_blank" rel="noopener noreferrer">{home.service} ↗</a>
            : <strong>{home.service}</strong>}
          {self ? ' — members see this line.' : ' — keep care details there, not in Lichen chat.'}
        </p>
        {home.note && <p className="clinline__note">{home.note}</p>}
      </div>
    </div>
  );
}

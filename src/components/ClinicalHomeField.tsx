import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CLINICAL_SERVICES, cleanClinicalHome, loadClinicalHome, saveClinicalHome } from '../lib/clinicalHomeApi';
import './ClinicalHomeField.css';

/** Profile → Goods & services: a licensed provider names their clinical home
 *  (founder 2026-11-12). Lichen isn't a HIPAA platform yet, so clinical
 *  conversations and records stay in the provider's own HIPAA tool; Lichen
 *  shows members where that is and links to it. */
export default function ClinicalHomeField({ userId }: { userId: string }) {
  const [service, setService] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadClinicalHome(userId).then((h) => {
      setService(h?.service ?? ''); setUrl(h?.url ?? ''); setNote(h?.note ?? '');
      setSaved(JSON.stringify(h ?? null));
    });
  }, [userId]);

  let draft: string;
  try { draft = JSON.stringify(cleanClinicalHome(service, url, note)); } catch { draft = '__bad__'; }
  const dirty = draft !== saved;

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const v = cleanClinicalHome(service, url, note);
      await saveClinicalHome(userId, v);
      setSaved(JSON.stringify(v)); setMsg(v ? 'Saved ✓ — members see it on your profile.' : 'Cleared.');
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="clinhome">
      <p className="clinhome__lead">Your clinical home <span className="clinhome__opt">— for licensed providers</span></p>
      <p className="clinhome__hint">
        Lichen isn&rsquo;t a HIPAA platform yet. Keep clinical conversations, notes and records in your
        own HIPAA tool, and name it here — members see where to reach you for care details, and Lichen
        links there instead of holding them.
      </p>
      <input className="prof__input" list="clinhome-services" placeholder="e.g. SimplePractice, Spruce, Hushmail"
        value={service} maxLength={60} onChange={(e) => setService(e.target.value)} />
      <datalist id="clinhome-services">{CLINICAL_SERVICES.map((s) => <option key={s} value={s} />)}</datalist>
      <input className="prof__input" placeholder="Client portal link (optional)" value={url}
        autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url"
        onChange={(e) => setUrl(e.target.value)} />
      <input className="prof__input" placeholder="A note for clients (optional) — e.g. “Message me in the portal for anything clinical”"
        value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      <div className="clinhome__row">
        <button className="btn btn-primary" disabled={!dirty || busy || draft === '__bad__'} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {msg && <span className="clinhome__msg">{msg}</span>}
      </div>
      <p className="clinhome__hint">
        <Link className="link-cue" to="/practice">Practice payments &amp; superbills ›</Link> — import your Ivy Pay
        spreadsheets, name your clients once, and print superbills.
      </p>
    </div>
  );
}

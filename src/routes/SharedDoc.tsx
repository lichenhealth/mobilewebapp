import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import DocReader from '../components/office/DocReader';
import { LichenMark } from '../components/LichenMark';
import type { ChatDocRow } from '../lib/chatDocsApi';
import './ChatDocs.css';

/** /d/<token> — a doc its owner opened to anyone with the link (2026-11-26).
 *  Read-only, no account needed; a member gets a door into the doc itself. */
export default function SharedDoc() {
  const { token } = useParams();
  const { user } = useAuth();
  const [doc, setDoc] = useState<(Pick<ChatDocRow, 'id' | 'kind' | 'title' | 'body' | 'data' | 'updated_at'> & { owner_name: string; imgs: Record<string, string> }) | null | 'gone'>(null);
  useEffect(() => {
    if (!token) return;
    void supabase.functions.invoke('shared-doc', { body: { t: token } })
      .then(({ data, error }) => setDoc(error || !data?.id ? 'gone' : data));
  }, [token]);
  useEffect(() => { if (doc && doc !== 'gone') document.title = `${doc.title} · Lichen`; }, [doc]);
  if (doc === null) return <div className="sdoc"><p className="cdocp__missing">Opening…</p></div>;
  if (doc === 'gone') return <div className="sdoc"><p className="cdocp__missing">This link isn’t open anymore — its owner may have made it private. Ask them to share it again.</p></div>;
  const d = doc.data ?? {};
  return (
    <div className="sdoc">
      <header className="sdoc__head">
        <a className="sdoc__brand" href="/welcome"><LichenMark size={26} /> Lichen</a>
        {user && <a className="sdoc__inside" href={`/docs/${doc.id}`}>Open it in Lichen ›</a>}
      </header>
      <h1 className="sdoc__title">{doc.title}</h1>
      <p className="sdoc__by">Shared by <span className="nobr">{doc.owner_name}</span> · updated {new Date(doc.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
      <DocReader kind={doc.kind} html={d.html ?? (doc.body ? doc.body.split('\n').map((l) => `<p>${l.replace(/[<>&]/g, '')}</p>`).join('') : '')}
        sheets={d.sheets ?? (d.cells ? [{ name: 'Sheet1', cells: d.cells }] : [])} slides={d.slides} theme={d.theme} imgs={doc.imgs} />
      <p className="sdoc__foot">Made on <a href="/welcome">Lichen</a> — a community network where people share, trade and take care of each other. <a href="/intro">Request an invitation ›</a></p>
    </div>
  );
}

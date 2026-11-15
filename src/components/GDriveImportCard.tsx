import { useState } from 'react';
import { Link } from 'react-router-dom';
import { importGDriveFile, trashGDrive, lichenKindFor, type GFile } from '../lib/gdriveApi';
import './GDriveImportCard.css';

/** FILES THE BRAIN PICKED FROM GOOGLE DRIVE (founder 2026-11-15: "import
 *  files from Google drive to Lichen Drive… and trash the rest"). The tap
 *  re-creates each one as a Lichen doc / spreadsheet / presentation / file
 *  through the member's own session — the same importer as /drive/import. */
export default function GDriveImportCard({ accountId, account, files, thenTrash: thenTrash0 }: {
  accountId: string; account: string; files: GFile[]; thenTrash?: boolean;
}) {
  const [thenTrash, setThenTrash] = useState(!!thenTrash0);
  const [state, setState] = useState<Record<string, { ok?: string; err?: string; busy?: boolean }>>({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  async function go() {
    setRunning(true);
    const ok: string[] = [];
    for (const f of files) {
      setState((s) => ({ ...s, [f.id]: { busy: true } }));
      try {
        const r = await importGDriveFile({ id: accountId, email: account }, f);
        setState((s) => ({ ...s, [f.id]: { ok: r.path } }));
        ok.push(f.id);
      } catch (e) { setState((s) => ({ ...s, [f.id]: { err: (e as Error).message } })); }
    }
    if (thenTrash && ok.length) await trashGDrive(accountId, ok).catch(() => null);
    setRunning(false); setDone(true);
  }

  return (
    <div className="gdic">
      <p className="gdic__hint"><strong>From Google Drive</strong> · {account}</p>
      <ul className="gdic__list">
        {files.map((f) => {
          const st = state[f.id];
          return (
            <li key={f.id}>
              <span className="gdic__name">{f.name}</span>
              <span className="gdic__meta">
                {st?.busy ? 'Working…' : st?.ok ? <>On Lichen ✓ <Link className="link-cue" to={st.ok}>Open</Link></> : st?.err ? <span className="gdic__bad">{st.err}</span> : lichenKindFor(f.mimeType, f.name).label}
              </span>
            </li>
          );
        })}
      </ul>
      {!done && (
        <>
          <label className="gdic__then"><input type="checkbox" checked={thenTrash} onChange={(e) => setThenTrash(e.target.checked)} disabled={running} />
            Then move the Google copies to Trash</label>
          <button className="afeed__pubbtn" type="button" disabled={running} onClick={() => void go()}>
            {running ? 'Bringing them over…' : `Bring ${files.length} to Lichen`}
          </button>
        </>
      )}
      {done && <p className="gdic__hint">Done{thenTrash ? ' — the Google copies are in that account’s Trash for 30 days' : ''}. <Link className="link-cue" to="/drive">Open your Drive</Link></p>}
    </div>
  );
}

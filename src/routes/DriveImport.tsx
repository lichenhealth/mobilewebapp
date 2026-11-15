import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { PageHead } from '../components/PageHead';
import { useAuth } from '../auth/AuthProvider';
import { mailEnabled, listMailAccounts, connectMail, type MailAccount } from '../lib/mailApi';
import {
  listGDrive, trashGDrive, importGDriveFile, listGDriveImports, lichenKindFor, fmtSize,
  type GFile, type GView, type ImportRow,
} from '../lib/gdriveApi';
import './DriveImport.css';

/** GOOGLE DRIVE → LICHEN DRIVE (founder 2026-11-15: "import files from Google
 *  drive to Lichen Drive… identify the file and re-create it as a Lichen
 *  file. I want to clean up my various drives and transfer what I want and
 *  trash the rest"). Browse each connected Google account, bring files over
 *  (each one re-made as a Lichen doc / spreadsheet / presentation / file),
 *  and move what you don't want to that account's Google Trash. */

const KIND_ICON: Record<string, IconName> = {
  doc: 'book', sheet: 'sheet', slides: 'slides', photo: 'image', video: 'video', audio: 'mic', file: 'paperclip', folder: 'drive', none: 'info',
};
const VIEWS: { id: GView; label: string }[] = [
  { id: 'folder', label: 'My Drive' }, { id: 'recent', label: 'Recent' }, { id: 'shared', label: 'Shared with me' }, { id: 'trash', label: 'Google Trash' },
];
const shortDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

type RowState = { status: 'busy' | 'done' | 'trashed' | 'error'; msg?: string; path?: string };

export default function DriveImport() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [acct, setAcct] = useState<string>('');
  const [view, setView] = useState<GView>('folder');
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<GFile[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<{ msg: string; reconnect: boolean } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [imports, setImports] = useState<Map<string, ImportRow>>(new Map());
  const [thenTrash, setThenTrash] = useState(false);
  const [sureTrash, setSureTrash] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void mailEnabled(user.id).then(setAllowed);
    void listMailAccounts().then((a) => { setAccounts(a); setAcct((cur) => cur || a[0]?.id || ''); });
    void listGDriveImports().then((r) => setImports(new Map(r.map((x) => [x.google_file_id, x]))));
  }, [user]);

  const account = accounts.find((a) => a.id === acct) ?? null;
  const folder = trail.length ? trail[trail.length - 1].id : 'root';

  const load = useCallback(async (more = false) => {
    if (!acct) return;
    setLoading(true); setErr(null);
    try {
      const r = await listGDrive(acct, { folder, q: query, view, pageToken: more ? next ?? undefined : undefined });
      setFiles((cur) => (more ? [...cur, ...r.files] : r.files));
      setNext(r.next);
      if (!more) setPicked(new Set());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr({ msg, reconnect: /reconnect/i.test(msg) });
      if (!more) setFiles([]);
    } finally { setLoading(false); }
  }, [acct, folder, query, view, next]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(false); }, [acct, folder, query, view]);

  const selectable = useMemo(() => files.filter((f) => {
    const k = lichenKindFor(f.mimeType, f.name).kind;
    return k !== 'folder' && rows[f.id]?.status !== 'trashed';
  }), [files, rows]);
  const pickedFiles = selectable.filter((f) => picked.has(f.id));

  const toggle = (id: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setRow = (id: string, s: RowState) => setRows((cur) => ({ ...cur, [id]: s }));

  const bringOver = async (list: GFile[]) => {
    if (!account || !list.length) return;
    setWorking(`Bringing over ${list.length} file${list.length === 1 ? '' : 's'}…`);
    const doneIds: string[] = [];
    for (const f of list) {
      setRow(f.id, { status: 'busy' });
      try {
        const r = await importGDriveFile(account, f);
        setRow(f.id, { status: 'done', path: r.path, msg: r.note });
        setImports((cur) => new Map(cur).set(f.id, { google_file_id: f.id, account_email: account.email, name: f.name, lichen_kind: r.kind, lichen_id: r.id, imported_at: new Date().toISOString() }));
        doneIds.push(f.id);
      } catch (e) {
        setRow(f.id, { status: 'error', msg: e instanceof Error ? e.message : String(e) });
      }
    }
    if (thenTrash && doneIds.length && view !== 'trash') {
      const t = await trashGDrive(account.id, doneIds).catch(() => ({ done: [] as string[], failed: [] }));
      for (const id of t.done) setRows((cur) => ({ ...cur, [id]: { ...cur[id], status: 'trashed', path: cur[id]?.path } }));
    }
    setPicked(new Set());
    setWorking(null);
  };

  const trashThese = async (list: GFile[], restore = false) => {
    if (!account || !list.length) return;
    setWorking(restore ? 'Restoring…' : 'Moving to Google Trash…');
    try {
      const t = await trashGDrive(account.id, list.map((f) => f.id), restore);
      for (const id of t.done) setRow(id, { status: 'trashed', msg: restore ? 'Restored in Google' : undefined });
      for (const f of t.failed) setRow(f.id, { status: 'error', msg: f.error });
    } catch (e) { setErr({ msg: e instanceof Error ? e.message : String(e), reconnect: false }); }
    setPicked(new Set()); setSureTrash(false); setWorking(null);
  };

  const openFolder = (f: GFile) => { setView('folder'); setQuery(''); setQ(''); setTrail((t) => [...t, { id: f.id, name: f.name }]); };

  if (allowed === false) {
    return (
      <div className="gdi">
        <PageHead onBack={() => navigate('/drive')} />
        <div className="myc__head"><h1 className="myc__title">From Google Drive</h1>
          <p className="myc__sub">Bringing your Google Drive into Lichen is in a small test right now. It opens to everyone soon.</p></div>
      </div>
    );
  }

  return (
    <div className="gdi">
      <PageHead onBack={() => navigate('/drive')} />
      <div className="myc__head">
        <h1 className="myc__title">From Google Drive</h1>
        <p className="myc__sub">Bring what you want into your Lichen Drive — each file is re-made as a Lichen doc, spreadsheet, presentation or file. Move the rest to Google’s Trash.</p>
      </div>

      {allowed && !accounts.length && (
        <div className="gdi__connect">
          <p>Connect a Google account to see its Drive.</p>
          <button className="btn btn-primary" onClick={() => void connectMail(undefined, '/drive/import')}>Connect Google</button>
        </div>
      )}

      {accounts.length > 0 && (
        <>
          <div className="gdi__accts" role="tablist" aria-label="Google accounts">
            {accounts.map((a) => (
              <button key={a.id} role="tab" aria-selected={a.id === acct} className={`gdi__pill${a.id === acct ? ' is-on' : ''}`}
                onClick={() => { setAcct(a.id); setTrail([]); setRows({}); }}>{a.email}</button>
            ))}
            <button className="gdi__pill gdi__pill--add" onClick={() => void connectMail(undefined, '/drive/import')}>+ Add a Google account</button>
          </div>

          <div className="gdi__views">
            {VIEWS.map((v) => (
              <button key={v.id} className={`gdi__view${view === v.id && !query ? ' is-on' : ''}`}
                onClick={() => { setView(v.id); setTrail([]); setQuery(''); setQ(''); }}>{v.label}</button>
            ))}
          </div>

          <form className="gdi__search" onSubmit={(e) => { e.preventDefault(); setTrail([]); setQuery(q.trim()); }}>
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${account?.email ?? 'this Drive'}`} />
            {query && <button type="button" className="gdi__clear" onClick={() => { setQ(''); setQuery(''); }}>Clear</button>}
          </form>

          {view === 'folder' && !query && (
            <div className="gdi__trail">
              <button onClick={() => setTrail([])}>My Drive</button>
              {trail.map((t, i) => (
                <span key={t.id}> › <button onClick={() => setTrail((cur) => cur.slice(0, i + 1))}>{t.name}</button></span>
              ))}
            </div>
          )}

          {err && (
            <div className="gdi__err">
              <p>{err.msg}</p>
              {err.reconnect && account && (
                <button className="btn btn-primary" onClick={() => void connectMail(account.email, '/drive/import')}>Reconnect {account.email}</button>
              )}
            </div>
          )}

          {selectable.length > 0 && (
            <div className="gdi__bar">
              <label className="gdi__all">
                <input type="checkbox" checked={pickedFiles.length > 0 && pickedFiles.length === selectable.length}
                  onChange={(e) => setPicked(e.target.checked ? new Set(selectable.map((f) => f.id)) : new Set())} />
                {pickedFiles.length ? `${pickedFiles.length} picked` : 'Pick all'}
              </label>
              {pickedFiles.length > 0 && view !== 'trash' && (
                <div className="gdi__bulk">
                  <button className="btn btn-primary" disabled={!!working} onClick={() => void bringOver(pickedFiles)}>Bring {pickedFiles.length} to Lichen</button>
                  <button className={`gdi__trashbtn${sureTrash ? ' is-sure' : ''}`} disabled={!!working}
                    onClick={() => (sureTrash ? void trashThese(pickedFiles) : setSureTrash(true))}>
                    {sureTrash ? `Move ${pickedFiles.length} to Google Trash?` : 'Move to Google Trash'}
                  </button>
                </div>
              )}
              {pickedFiles.length > 0 && view === 'trash' && (
                <div className="gdi__bulk">
                  <button className="btn btn-primary" disabled={!!working} onClick={() => void trashThese(pickedFiles, true)}>Restore {pickedFiles.length} in Google</button>
                </div>
              )}
              {view !== 'trash' && (
                <label className="gdi__then">
                  <input type="checkbox" checked={thenTrash} onChange={(e) => setThenTrash(e.target.checked)} />
                  After bringing a file over, move the Google copy to Trash
                </label>
              )}
            </div>
          )}
          {working && <p className="gdi__working">{working}</p>}

          <ul className="gdi__list">
            {files.map((f) => {
              const { kind, label } = lichenKindFor(f.mimeType, f.name);
              const st = rows[f.id];
              const had = imports.get(f.id);
              const isFolder = kind === 'folder';
              const owner = f.owners?.find((o) => !o.me)?.emailAddress;
              return (
                <li key={f.id} className={`gdi__row${st?.status === 'trashed' ? ' is-gone' : ''}`}>
                  {!isFolder ? (
                    <input type="checkbox" className="gdi__check" aria-label={`Pick ${f.name}`}
                      disabled={st?.status === 'trashed'} checked={picked.has(f.id)} onChange={() => toggle(f.id)} />
                  ) : <span className="gdi__check" aria-hidden="true" />}
                  <span className="gdi__icon"><Icon name={KIND_ICON[kind]} size={16} /></span>
                  <div className="gdi__main">
                    {isFolder ? (
                      <button className="gdi__name gdi__name--folder" onClick={() => openFolder(f)}>{f.name} ›</button>
                    ) : <span className="gdi__name">{f.name}</span>}
                    <span className="gdi__meta">
                      {[isFolder ? 'Folder' : label, fmtSize(f.size), shortDate(f.modifiedTime), owner ? `from ${owner}` : ''].filter(Boolean).join(' · ')}
                    </span>
                    {(st?.status === 'done' || (had && !st)) && (
                      <span className="gdi__ok">
                        On Lichen ✓ <button className="link-cue" onClick={() => navigate(st?.path ?? (had?.lichen_kind && ['doc', 'sheet', 'slides'].includes(had.lichen_kind) ? `/docs/${had.lichen_id}` : '/drive'))}>Open</button>
                        {st?.msg && <span className="gdi__note"> · {st.msg}</span>}
                      </span>
                    )}
                    {st?.status === 'trashed' && <span className="gdi__meta">{st.msg ?? 'In Google Trash — recoverable there for 30 days'}{st.path ? ' · on Lichen ✓' : ''}</span>}
                    {st?.status === 'error' && <span className="gdi__bad">{st.msg}</span>}
                    {st?.status === 'busy' && <span className="gdi__meta">Working…</span>}
                    {!isFolder && st?.status !== 'trashed' && st?.status !== 'busy' && (
                      <div className="gdi__acts">
                        {view === 'trash' ? (
                          <button onClick={() => void trashThese([f], true)}>Restore in Google</button>
                        ) : (
                          <>
                            {kind !== 'none' && <button onClick={() => void bringOver([f])}>{had || st?.status === 'done' ? 'Bring over again' : 'Bring to Lichen'}</button>}
                            <button className="gdi__act--trash" onClick={() => void trashThese([f])}>Trash in Google</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {loading && <p className="gdi__working">Loading…</p>}
          {!loading && !files.length && !err && <p className="gdi__empty">{query ? 'Nothing matches that search.' : 'Nothing here.'}</p>}
          {next && !loading && <button className="gdi__more" onClick={() => void load(true)}>Show more</button>}
          <p className="gdi__fine">Google Docs keep their headings, lists, bold and links; images inside a Doc stay in Google for now. Sheets keep their tabs and formulas. Slides come over as titles, words and speaker notes. Files over 15 MB can’t come over yet. Anything you trash goes to that account’s Google Trash, where it stays recoverable for 30 days.</p>
        </>
      )}
    </div>
  );
}

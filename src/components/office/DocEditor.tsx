import { useEffect, useRef, useState } from 'react';
import { sanitizeHtml, htmlToText } from '../../lib/richText';
import { uploadOfficeImage, hydrateImgs } from '../../lib/officeMedia';
import type { Anchor, Goto } from './collab';
import './Office.css';

/** THE DOCUMENT (founder 2026-11-14: "re-create google docs"). A white page on
 *  Lichen's paper with Google Docs' toolbar: styles, bold/italic/underline/
 *  strike, colour + highlight, links, bullet/numbered/check lists, alignment,
 *  indent, quote, divider, table, clear formatting — undo/redo, word count,
 *  print/PDF and a Word download. Native contentEditable + execCommand (the
 *  same engine every browser ships); everything saved passes sanitizeHtml. */

const COLORS = ['#1f2a30', '#6b7378', '#b4542d', '#c9733d', '#4f7a4a', '#3f6f8a', '#7a5a8c'];
const HIGHLIGHTS = ['#fdf3c8', '#fde8d4', '#eaf2e3', '#e3eef4', '#efe6f3', 'transparent'];

export default function DocEditor({ html, onChange, placeholder, title, chatId, onAnchor, goto, remote }: {
  html: string; onChange: (html: string, text: string) => void; placeholder: string; title: string; chatId?: string | null;
  onAnchor?: (a: Anchor | null) => void; goto?: Goto | null; remote?: { html: string; n: number } | null;
}) {
  const lastInput = useRef(0);
  const ref = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);
  const [pal, setPal] = useState<'color' | 'hl' | null>(null);
  const [words, setWords] = useState(0);
  const [state, setState] = useState<Record<string, boolean>>({});
  const [block, setBlock] = useState('p');
  const [img, setImg] = useState<{ el: HTMLImageElement; top: number; left: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const deskRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || seeded.current) return;
    ref.current.innerHTML = sanitizeHtml(html);
    seeded.current = true;
    void hydrateImgs(ref.current);
    setWords(countWords(ref.current.innerText));
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* old engines */ }
  }, [html]);

  const onAnchorRef = useRef(onAnchor); onAnchorRef.current = onAnchor;

  // A teammate's saved change arrives: take it in unless I'm mid-sentence
  // (then my own next save wins — the accepted "little wars").
  useEffect(() => {
    const el = ref.current;
    if (!el || !remote || !seeded.current) return;
    if (Date.now() - lastInput.current < 2000) return;
    const next = sanitizeHtml(remote.html);
    if (next === sanitizeHtml(el.innerHTML)) return;
    const focused = document.activeElement === el;
    const off = focused ? caretOffset(el) : -1;
    el.innerHTML = next;
    if (off >= 0) setCaret(el, off);
    setWords(countWords(el.innerText));
    void hydrateImgs(el);
  }, [remote?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Jump to the words a comment points at.
  useEffect(() => {
    const a = goto?.anchor; const el = ref.current;
    if (!el || a?.kind !== 'text') return;
    const r = findText(el, a.quote);
    if (!r) return;
    const sel = document.getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
    (r.startContainer.parentElement ?? el).scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [goto?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const emit = () => {
    const el = ref.current; if (!el) return;
    lastInput.current = Date.now();
    const clean = sanitizeHtml(el.innerHTML);
    setWords(countWords(el.innerText));
    onChange(clean, htmlToText(clean));
  };
  const cmd = (name: string, value?: string) => {
    ref.current?.focus();
    document.execCommand(name, false, value);
    emit(); readState();
  };
  const readState = () => {
    const s: Record<string, boolean> = {};
    for (const k of ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList', 'justifyLeft', 'justifyCenter', 'justifyRight']) {
      try { s[k] = document.queryCommandState(k); } catch { s[k] = false; }
    }
    setState(s);
    try { setBlock((document.queryCommandValue('formatBlock') || 'p').toLowerCase().replace(/[<>]/g, '')); } catch { /* ignore */ }
  };
  useEffect(() => {
    const on = () => {
      const sel = document.getSelection();
      if (!ref.current || !ref.current.contains(sel?.anchorNode ?? null)) return;
      readState();
      const q = sel && !sel.isCollapsed ? sel.toString().trim().replace(/\s+/g, ' ').slice(0, 300) : '';
      onAnchorRef.current?.(q ? { kind: 'text', quote: q } : null);
    };
    document.addEventListener('selectionchange', on);
    return () => document.removeEventListener('selectionchange', on);
  }, []);

  const link = () => {
    const url = window.prompt('Link to (https://…)');
    if (!url) return;
    const u = /^(https?:|mailto:|tel:|\/)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    cmd('createLink', u);
  };
  const checklist = () => {
    cmd('insertUnorderedList');
    const sel = document.getSelection();
    const ul = (sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement)?.closest('ul');
    if (ul && ref.current?.contains(ul)) { ul.classList.add('chk'); ul.querySelectorAll('li').forEach((li) => { if (!li.hasAttribute('data-checked')) li.setAttribute('data-checked', 'false'); }); emit(); }
  };
  const table = () => {
    const rows = Array.from({ length: 3 }, () => `<tr>${'<td><br></td>'.repeat(3)}</tr>`).join('');
    cmd('insertHTML', `<table><tbody>${rows}</tbody></table><p><br></p>`);
  };
  const insertImages = async (files: File[]) => {
    const pics = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (!pics.length) return;
    setBusy(true);
    try {
      for (const f of pics) {
        const refStr = await uploadOfficeImage(f, chatId ?? null);
        ref.current?.focus();
        document.execCommand('insertHTML', false, `<img data-store="${refStr}" alt="" style="width: 100%"><p><br></p>`);
      }
      if (ref.current) await hydrateImgs(ref.current);
      emit();
    } catch { window.alert("That image didn't upload — try again in a moment."); }
    finally { setBusy(false); }
  };
  const sizeImg = (pct: number | null) => {
    if (!img) return;
    if (pct == null) img.el.remove(); else img.el.style.width = `${pct}%`;
    setImg(null); emit();
  };
  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'IMG' && deskRef.current) {
      const d = deskRef.current.getBoundingClientRect(), b = t.getBoundingClientRect();
      setImg({ el: t as HTMLImageElement, top: b.top - d.top + deskRef.current.scrollTop + 8, left: b.left - d.left + 8 });
      return;
    }
    setImg(null);
    const li = (e.target as HTMLElement).closest('ul.chk > li') as HTMLElement | null;
    if (!li) return;
    const box = li.getBoundingClientRect();
    if (e.clientX - box.left < 26) {
      li.setAttribute('data-checked', li.getAttribute('data-checked') === 'true' ? 'false' : 'true');
      emit();
    }
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.files];
    if (files.some((f) => f.type.startsWith('image/'))) { e.preventDefault(); void insertImages(files); return; }
    const h = e.clipboardData.getData('text/html');
    if (!h) return;
    e.preventDefault();
    document.execCommand('insertHTML', false, sanitizeHtml(h));
    emit();
  };
  const onKey = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); link(); }
    if (e.key === 'Tab') { e.preventDefault(); cmd(e.shiftKey ? 'outdent' : 'indent'); }
  };
  const downloadWord = () => {
    const body = sanitizeHtml(ref.current?.innerHTML ?? '');
    const doc = `<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
    const u = URL.createObjectURL(new Blob(['﻿', doc], { type: 'application/msword' }));
    const a = document.createElement('a'); a.href = u; a.download = `${title || 'Document'}.doc`; a.click();
    setTimeout(() => URL.revokeObjectURL(u), 2000);
  };

  const B = (k: string, label: React.ReactNode, tip: string, act: () => void) => (
    <button title={tip} className={state[k] ? 'is-on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={act}>{label}</button>
  );

  return (
    <div className="docx">
      <div className="docx__bar" role="toolbar" aria-label="Document tools">
        <button title="Undo (Ctrl+Z)" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('undo')}>↶</button>
        <button title="Redo (Ctrl+Y)" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('redo')}>↷</button>
        <button title="Print or save as PDF" onClick={() => window.print()}>⎙</button>
        <span className="sheet__sep" />
        <select className="docx__style" value={['h1', 'h2', 'h3', 'blockquote', 'pre'].includes(block) ? block : 'p'}
          onChange={(e) => cmd('formatBlock', e.target.value === 'p' ? 'P' : e.target.value.toUpperCase())} aria-label="Text style">
          <option value="p">Normal text</option>
          <option value="h1">Title</option>
          <option value="h2">Heading</option>
          <option value="h3">Subheading</option>
          <option value="blockquote">Quote</option>
          <option value="pre">Code</option>
        </select>
        <span className="sheet__sep" />
        {B('bold', <b>B</b>, 'Bold (Ctrl+B)', () => cmd('bold'))}
        {B('italic', <i>I</i>, 'Italic (Ctrl+I)', () => cmd('italic'))}
        {B('underline', <u>U</u>, 'Underline (Ctrl+U)', () => cmd('underline'))}
        {B('strikeThrough', <s>S</s>, 'Strikethrough', () => cmd('strikeThrough'))}
        <div className="sheet__pop">
          <button title="Text color" onMouseDown={(e) => e.preventDefault()} onClick={() => setPal(pal === 'color' ? null : 'color')}><span style={{ borderBottom: '3px solid var(--peach-deep)' }}>A</span></button>
          {pal === 'color' && <div className="sheet__swatches" onMouseLeave={() => setPal(null)}>{COLORS.map((c) => <button key={c} style={{ background: c }} aria-label={c} onMouseDown={(e) => e.preventDefault()} onClick={() => { cmd('foreColor', c); setPal(null); }} />)}</div>}
        </div>
        <div className="sheet__pop">
          <button title="Highlight" onMouseDown={(e) => e.preventDefault()} onClick={() => setPal(pal === 'hl' ? null : 'hl')}>🖍</button>
          {pal === 'hl' && <div className="sheet__swatches" onMouseLeave={() => setPal(null)}>{HIGHLIGHTS.map((c) => <button key={c} style={{ background: c === 'transparent' ? '#fff' : c }} aria-label={c === 'transparent' ? 'No highlight' : c} onMouseDown={(e) => e.preventDefault()} onClick={() => { cmd('hiliteColor', c); setPal(null); }}>{c === 'transparent' ? '∅' : ''}</button>)}</div>}
        </div>
        <button title="Link (Ctrl+K)" onMouseDown={(e) => e.preventDefault()} onClick={link}>🔗</button>
        <span className="sheet__sep" />
        {B('justifyLeft', '⇤', 'Align left', () => cmd('justifyLeft'))}
        {B('justifyCenter', '↔', 'Center', () => cmd('justifyCenter'))}
        {B('justifyRight', '⇥', 'Align right', () => cmd('justifyRight'))}
        <span className="sheet__sep" />
        {B('insertUnorderedList', '• List', 'Bulleted list', () => cmd('insertUnorderedList'))}
        {B('insertOrderedList', '1. List', 'Numbered list', () => cmd('insertOrderedList'))}
        <button title="Checklist" onMouseDown={(e) => e.preventDefault()} onClick={checklist}>☑ List</button>
        <button title="Decrease indent (Shift+Tab)" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('outdent')}>⇠</button>
        <button title="Increase indent (Tab)" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('indent')}>⇢</button>
        <span className="sheet__sep" />
        <button title="Insert an image" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => fileRef.current?.click()}>{busy ? 'Uploading…' : '🖼 Image'}</button>
        <input ref={fileRef} type="file" hidden multiple accept="image/*,.heic,.heif" onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; void insertImages(fs); }} />
        <button title="Insert a table" onMouseDown={(e) => e.preventDefault()} onClick={table}>▦ Table</button>
        <button title="Insert a divider" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('insertHorizontalRule')}>―</button>
        <button title="Clear formatting" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('removeFormat')}>T̸</button>
        <button title="Download as Word" onClick={downloadWord}>.doc ↓</button>
      </div>
      <div className="docx__desk" ref={deskRef}
        onDragOver={(e) => { if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) e.preventDefault(); }}
        onDrop={(e) => { const fs = [...e.dataTransfer.files]; if (fs.length) { e.preventDefault(); void insertImages(fs); } }}>
        {img && (
          <div className="docx__imgbar" style={{ top: img.top, left: img.left }} onMouseDown={(e) => e.preventDefault()}>
            <button onClick={() => sizeImg(33)}>Small</button>
            <button onClick={() => sizeImg(60)}>Medium</button>
            <button onClick={() => sizeImg(100)}>Full width</button>
            <button className="is-danger" onClick={() => sizeImg(null)}>Remove</button>
          </div>
        )}
        <div
          ref={ref}
          className="docx__page"
          contentEditable
          suppressContentEditableWarning
          data-placeholder={placeholder}
          onInput={emit}
          onClick={onClick}
          onPaste={onPaste}
          onKeyDown={onKey}
          onKeyUp={readState}
          onMouseUp={readState}
          spellCheck
        />
      </div>
      <div className="docx__foot">{words} word{words === 1 ? '' : 's'}</div>
    </div>
  );
}

const countWords = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function caretOffset(root: HTMLElement): number {
  const sel = document.getSelection(); if (!sel || !sel.rangeCount) return -1;
  const r = sel.getRangeAt(0).cloneRange(); r.selectNodeContents(root);
  const end = sel.getRangeAt(0); r.setEnd(end.endContainer, end.endOffset);
  return r.toString().length;
}
function setCaret(root: HTMLElement, off: number) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null; let left = off;
  while ((n = w.nextNode())) {
    const len = (n.textContent ?? '').length;
    if (left <= len) { const r = document.createRange(); r.setStart(n, left); r.collapse(true); const s = document.getSelection(); s?.removeAllRanges(); s?.addRange(r); return; }
    left -= len;
  }
}
function findText(root: HTMLElement, quote: string): Range | null {
  const want = quote.replace(/\s+/g, ' ').trim(); if (!want) return null;
  const nodes: Text[] = []; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null; let all = '';
  const starts: number[] = [];
  while ((n = w.nextNode())) { starts.push(all.length); nodes.push(n as Text); all += (n.textContent ?? ''); }
  const norm = all.replace(/\s/g, ' ');
  const at = norm.indexOf(want.slice(0, 120)); if (at < 0) return null;
  const end = at + Math.min(want.length, 120);
  const locate = (pos: number) => { let i = starts.length - 1; while (i > 0 && starts[i] > pos) i--; return { node: nodes[i], off: pos - starts[i] }; };
  const a = locate(at), b = locate(end);
  const r = document.createRange();
  r.setStart(a.node, Math.min(a.off, a.node.length)); r.setEnd(b.node, Math.min(b.off, b.node.length));
  return r;
}

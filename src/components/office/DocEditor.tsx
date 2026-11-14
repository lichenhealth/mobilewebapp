import { useEffect, useRef, useState } from 'react';
import { sanitizeHtml, htmlToText } from '../../lib/richText';
import './Office.css';

/** THE DOCUMENT (founder 2026-11-14: "re-create google docs"). A white page on
 *  Lichen's paper with Google Docs' toolbar: styles, bold/italic/underline/
 *  strike, colour + highlight, links, bullet/numbered/check lists, alignment,
 *  indent, quote, divider, table, clear formatting — undo/redo, word count,
 *  print/PDF and a Word download. Native contentEditable + execCommand (the
 *  same engine every browser ships); everything saved passes sanitizeHtml. */

const COLORS = ['#1f2a30', '#6b7378', '#b4542d', '#c9733d', '#4f7a4a', '#3f6f8a', '#7a5a8c'];
const HIGHLIGHTS = ['#fdf3c8', '#fde8d4', '#eaf2e3', '#e3eef4', '#efe6f3', 'transparent'];

export default function DocEditor({ html, onChange, placeholder, title }: {
  html: string; onChange: (html: string, text: string) => void; placeholder: string; title: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);
  const [pal, setPal] = useState<'color' | 'hl' | null>(null);
  const [words, setWords] = useState(0);
  const [state, setState] = useState<Record<string, boolean>>({});
  const [block, setBlock] = useState('p');

  useEffect(() => {
    if (!ref.current || seeded.current) return;
    ref.current.innerHTML = sanitizeHtml(html);
    seeded.current = true;
    setWords(countWords(ref.current.innerText));
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* old engines */ }
  }, [html]);

  const emit = () => {
    const el = ref.current; if (!el) return;
    const clean = el.innerHTML;
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
    const on = () => { if (ref.current && ref.current.contains(document.getSelection()?.anchorNode ?? null)) readState(); };
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
  const onClick = (e: React.MouseEvent) => {
    const li = (e.target as HTMLElement).closest('ul.chk > li') as HTMLElement | null;
    if (!li) return;
    const box = li.getBoundingClientRect();
    if (e.clientX - box.left < 26) {
      li.setAttribute('data-checked', li.getAttribute('data-checked') === 'true' ? 'false' : 'true');
      emit();
    }
  };
  const onPaste = (e: React.ClipboardEvent) => {
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
        <button title="Insert a table" onMouseDown={(e) => e.preventDefault()} onClick={table}>▦ Table</button>
        <button title="Insert a divider" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('insertHorizontalRule')}>―</button>
        <button title="Clear formatting" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('removeFormat')}>T̸</button>
        <button title="Download as Word" onClick={downloadWord}>.doc ↓</button>
      </div>
      <div className="docx__desk">
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

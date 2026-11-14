import { Icon } from './Icon';

/** An email thread riding a brain message as an ATTACHMENT (founder
 *  2026-11-14: "that should be like an attachment in a chat, with the clear
 *  space to write additional context, below it"). One card, two homes: above
 *  the composer before sending (with ×), and in the sent bubble after. */
export interface MailRef { account_id: string; account: string; thread_id: string; subject: string; from: string }

export default function MailRefCard({ m, onRemove, onOpen }: { m: MailRef; onRemove?: () => void; onOpen?: () => void }) {
  return (
    <div className="acomp-mailref">
      <span className="acomp-mailref__icon"><Icon name="mail" size={15} /></span>
      <span className="acomp-mailref__txt" role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined}
        onClick={onOpen} onKeyDown={(e) => { if (onOpen && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(); } }}
        style={onOpen ? { cursor: 'pointer' } : undefined}>
        <span className="acomp-mailref__subj">{m.subject || '(no subject)'}</span>
        <span className="acomp-mailref__meta">{m.from ? `${m.from} · ` : ''}{m.account}</span>
      </span>
      {onRemove && <button type="button" className="acomp-mailref__x" onClick={onRemove} aria-label="Remove the email">×</button>}
    </div>
  );
}

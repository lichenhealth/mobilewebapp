import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { loadCalendarSends, sendCalendarInvites } from '../lib/calendarApi';
import './KnockReply.css';

/** Invitations the assistant drafted (founder 2026-11-13: "Update/upgrade the
 *  in app assistant to send invites, generate links, etc, if you ask"). The
 *  model never sends to another person — this card lists who will be invited
 *  and the PERSON taps Send: members are seated on the event (the ordinary
 *  bell), and with `calendar` everyone gets a real calendar invitation by
 *  email (send-calendar-invite; a member's address resolved server-side). */
export default function CalInviteCard({ eventId, title, members, emails, calendar }: {
  eventId: string; title: string;
  members: { id: string; name: string }[]; emails: { email: string; name: string }[]; calendar: boolean;
}) {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const [cal, setCal] = useState(calendar || emails.length > 0);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'dismissed'>('idle');
  const [msg, setMsg] = useState('');

  // Already done (a reload after Send)? Everyone seated and every email sent.
  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await supabase.from('event_attendees').select('profile_id').eq('event_id', eventId);
      const seated = new Set(((data as { profile_id: string }[] | null) ?? []).map((r) => r.profile_id));
      const sent = new Set((await loadCalendarSends(eventId)).map((s) => s.email?.toLowerCase()).filter(Boolean));
      if (live && members.every((m) => seated.has(m.id)) && emails.every((e) => sent.has(e.email.toLowerCase())) && (members.length || emails.length)
        && (emails.length > 0 || !calendar)) setState('sent');
    })();
    return () => { live = false; };
  }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    setState('sending'); setMsg('');
    try {
      if (members.length) {
        const { data } = await supabase.from('event_attendees').select('profile_id').eq('event_id', eventId);
        const seated = new Set(((data as { profile_id: string }[] | null) ?? []).map((r) => r.profile_id));
        const add = members.filter((m) => !seated.has(m.id));
        if (add.length) {
          const { error } = await supabase.from('event_attendees')
            .insert(add.map((m) => ({ event_id: eventId, profile_id: m.id, invited_by: me })));
          if (error && error.code !== '23505') throw error;
        }
      }
      let mailed = 0;
      if (cal && (members.length || emails.length)) {
        const r = await sendCalendarInvites(eventId, members.map((m) => m.id), emails.map((e) => e.email));
        mailed = r.sent ?? 0;
      }
      setState('sent');
      setMsg(cal ? `Invited — ${mailed} calendar invitation${mailed === 1 ? '' : 's'} on the way.` : 'Invited — they’ll see it in Lichen.');
    } catch (e) { setState('idle'); setMsg((e as Error).message || 'That didn’t go through.'); }
  }

  if (state === 'dismissed') return <p className="kreply__hint">Not sent.</p>;
  if (state === 'sent') return <p className="kreply__done">{msg || `Invited to ${title} ✓`}</p>;
  const who = [...members.map((m) => `${m.name} (on Lichen)`), ...emails.map((e) => e.email)];
  return (
    <div className="kreply kreply--open kreply--card">
      <p className="kreply__hint"><strong>Invite to {title}</strong> · {who.join(' · ')}</p>
      <label className="kreply__hint">
        <input type="checkbox" checked={cal} disabled={emails.length > 0} onChange={(e) => setCal(e.target.checked)} />
        {' '}Also send each a calendar invitation by email (Google, Apple, Outlook) — Lichen members’ addresses stay private
      </label>
      {msg && <p className="kreply__err">{msg}</p>}
      <div className="kreply__acts">
        <span className="kreply__spacer" />
        <button type="button" className="kreply__notnow" onClick={() => setState('dismissed')}>Not now</button>
        <button type="button" className="btn btn-primary" disabled={state === 'sending'} onClick={() => void send()}>
          {state === 'sending' ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

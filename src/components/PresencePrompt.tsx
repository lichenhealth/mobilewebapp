import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import {
  myPresence, setAlwaysPresent, snuffPresence, candleLit, type MyPresence,
} from '../lib/presenceApi';
import './PresencePrompt.css';

/** "Do you want your light on?" (founder 2026-08-07: "whenever someone logs in
 *  or opens the desktop app, can we have them get a pop up asking them if they
 *  want their light on or not, explaining presence... the default is to be
 *  present but you can just turn out your light if you want to engage with the
 *  platform but you're not feeling open to connecting with anyone").
 *
 *  IT GROWS OUT OF THE CANDLE ITSELF (founder, same day: "can it be a little
 *  bubble blurb coming out of the light itself, so the person knows where to
 *  take action?"). A centred modal explains presence and teaches nothing about
 *  where to change it later; a bubble with its tail on the candle makes the
 *  explanation and the switch one object. So this renders from TopBar, anchored
 *  to the real button, and the candle lifts while the bubble is open.
 *
 *  ONE LIGHT, NOT ONE PER SPACE. presence lives on your profile row, so it
 *  shows in every layer you belong to at once. The founder also asked for this
 *  on identity switch — but a prompt that appears when you start acting as WAG
 *  would imply you're setting WAG's presence, and you aren't. So the switch
 *  variant says so plainly instead of pretending.
 *
 *  ASKED ONCE A DAY, never on every navigation. A prompt you see constantly is
 *  one you learn to dismiss without reading, which would defeat the teaching. */
export default function PresencePrompt({ anchor, onChange }: {
  /** The candle button in the top bar — the bubble points at it. */
  anchor: HTMLElement | null;
  /** Tell the bar when the bubble changed the light, so the button agrees. */
  onChange?: (lit: boolean) => void;
}) {
  const { user } = useAuth();
  const { actor } = useActing();
  const [pres, setPres] = useState<MyPresence | null>(null);
  const [why, setWhy] = useState<'open' | 'switch' | null>(null);
  const [busy, setBusy] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number; tail: number } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const askedFor = useRef<string | null>(null);

  const todayKey = () => `presence-asked-${new Date().toISOString().slice(0, 10)}`;

  // Once a day, on the first open.
  useEffect(() => {
    if (!user) return;
    let live = true;
    void myPresence(user.id).then((p) => {
      if (!live || !p) return;              // pre-migration: stay silent
      setPres(p);
      if (localStorage.getItem(todayKey())) return;
      setWhy('open');
    });
    return () => { live = false; };
  }, [user]);

  // On switching who you're acting as — once per identity per sitting.
  useEffect(() => {
    if (!user || !pres) return;
    const key = actor.type === 'self' ? 'self' : `${actor.type}:${actor.id}`;
    if (askedFor.current === null) { askedFor.current = key; return; }  // first paint
    if (askedFor.current === key) return;
    askedFor.current = key;
    if (why === null) setWhy('switch');
  }, [actor, user, pres, why]);

  const open = !!user && !!pres && !!why && !!anchor;

  // Sit under the candle, tail aimed at its centre, never past the screen edge.
  useLayoutEffect(() => {
    if (!open || !anchor) { setBox(null); return; }
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const w = Math.min(320, window.innerWidth - 16);
      const centre = a.left + a.width / 2;
      const left = Math.max(8, Math.min(centre - w / 2, window.innerWidth - w - 8));
      setBox({ top: a.bottom + 10, left, tail: centre - left });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, anchor]);

  // Lift the candle while we're pointing at it — the eye lands on the control,
  // not just the words about it.
  useEffect(() => {
    if (!open || !anchor) return;
    anchor.classList.add('is-pointed');
    return () => anchor.classList.remove('is-pointed');
  }, [open, anchor]);

  if (!open || !pres || !box) return null;

  const lit = candleLit(pres) || pres.alwaysPresent;
  const actorName = actor.type === 'self' ? null : actor.name;

  const close = () => {
    localStorage.setItem(todayKey(), '1');
    setWhy(null);
  };

  const choose = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) await setAlwaysPresent(user!.id, true);
      else { await setAlwaysPresent(user!.id, false); await snuffPresence(user!.id); }
      setPres({ ...pres, alwaysPresent: on, litUntil: on ? pres.litUntil : null });
      onChange?.(on);
    } catch (e) { console.error(e); }
    setBusy(false);
    close();
  };

  return (
    <>
      {/* Tapping anywhere else dismisses — no dark scrim, the page stays legible
          behind a bubble this small. */}
      <div className="prespr__catch" onClick={close} />
      <div className="prespr" ref={bubble} role="dialog" aria-label="Your presence"
        style={{ top: box.top, left: box.left, width: Math.min(320, window.innerWidth - 16) }}>
        <span className="prespr__tail" style={{ left: box.tail }} aria-hidden />

        <h2 className="prespr__title">
          {why === 'switch'
            ? `You’re acting as ${actorName}.`
            : lit ? 'Your light is on.' : 'Your light is out.'}
        </h2>

        {why === 'switch' ? (
          <p className="prespr__body">
            Switching doesn’t change your light. You have one, and it shows
            everywhere you belong. Right now it’s {lit ? 'on' : 'out'}.
          </p>
        ) : (
          <p className="prespr__body">
            This candle says you’re around — nothing more. No timestamps, no
            last-seen, no dot following you through the app.
          </p>
        )}

        <p className="prespr__body prespr__body--quiet">
          Being present is the default. If you’d rather get things done without
          being open to connecting, tap the candle any time to blow it out or
          light it back up.
        </p>

        <div className="prespr__acts">
          <button className="btn btn-primary" disabled={busy}
            onClick={() => (lit ? close() : void choose(true))}>
            {lit ? 'Keep it lit' : 'Light it'}
          </button>
          <button className="btn prespr__out" disabled={busy}
            onClick={() => (lit ? void choose(false) : close())}>
            {lit ? 'Blow it out' : 'Leave it out'}
          </button>
        </div>
      </div>
    </>
  );
}

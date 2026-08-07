import { useEffect, useRef, useState } from 'react';
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
 *  ONE LIGHT, NOT ONE PER SPACE. presence lives on your profile row, so it
 *  shows in every layer you belong to at once. The founder also asked for this
 *  on identity switch — but a prompt that appears when you start acting as WAG
 *  would imply you're setting WAG's presence, and you aren't. So the switch
 *  variant says so plainly instead of pretending. Per-layer presence would be
 *  a real build; this copy is honest about the model we actually have.
 *
 *  ASKED ONCE A DAY, never on every navigation. A prompt you see constantly is
 *  one you learn to dismiss without reading, which would defeat the teaching. */
export default function PresencePrompt() {
  const { user } = useAuth();
  const { actor } = useActing();
  const [pres, setPres] = useState<MyPresence | null>(null);
  const [why, setWhy] = useState<'open' | 'switch' | null>(null);
  const [busy, setBusy] = useState(false);
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

  if (!user || !pres || !why) return null;

  const lit = candleLit(pres) || pres.alwaysPresent;
  const actorName = actor.type === 'self' ? null : actor.name;

  const close = () => {
    localStorage.setItem(todayKey(), '1');
    setWhy(null);
  };

  const choose = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) await setAlwaysPresent(user.id, true);
      else { await setAlwaysPresent(user.id, false); await snuffPresence(user.id); }
      setPres({ ...pres, alwaysPresent: on, litUntil: on ? pres.litUntil : null });
    } catch (e) { console.error(e); }
    setBusy(false);
    close();
  };

  return (
    <div className="prespr__scrim" role="dialog" aria-modal="true"
      aria-label="Your presence">
      <div className="prespr">
        <span className="prespr__flame" aria-hidden>{lit ? '🕯️' : '🌑'}</span>
        <h2 className="prespr__title">
          {why === 'switch' ? `You’re acting as ${actorName}.` : 'Your light is on.'}
        </h2>

        {why === 'switch' ? (
          <p className="prespr__body">
            Your presence doesn’t change when you switch — it’s <strong>one light</strong>,
            yours, and it shows in every community and place you belong to.
            Right now it’s {lit ? 'on' : 'out'}.
          </p>
        ) : (
          <p className="prespr__body">
            Presence means other members can see you’re around — nothing more.
            No timestamps, no last-seen, no dot following you across the app.
            Just your name, in the one panel where people look to see who’s here.
          </p>
        )}

        <p className="prespr__body prespr__body--quiet">
          Being present is the default, because a network of invisible people
          isn’t one. But if you want to read, post and get things done without
          being open to connecting right now — turn your light out. You can
          light it again any time from the candle beside your picture.
        </p>

        <div className="prespr__acts">
          <button className="btn btn-primary" disabled={busy}
            onClick={() => (lit ? close() : void choose(true))}>
            {lit ? 'Keep my light on' : 'Light my presence'}
          </button>
          <button className="btn prespr__out" disabled={busy}
            onClick={() => (lit ? void choose(false) : close())}>
            {lit ? 'Turn my light out' : 'Stay unlit'}
          </button>
        </div>

        <p className="prespr__foot">
          Presence is a gift, not a status. Nobody is told you turned it off.
        </p>
      </div>
    </div>
  );
}

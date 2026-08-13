import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import {
  myPresence, setAlwaysPresent, snuffPresence, candleLit, type MyPresence,
} from '../lib/presenceApi';
import ConsentBubble from './ConsentBubble';
import { loadPrompts, promptSeen, promptSeenToday, markPrompt } from '../lib/promptsApi';

/** "Do you want your light on?" (founder 2026-08-07: "whenever someone logs in
 *  or opens the desktop app, can we have them get a pop up asking them if they
 *  want their light on or not, explaining presence... the default is to be
 *  present but you can just turn out your light if you want to engage with the
 *  platform but you're not feeling open to connecting with anyone").
 *
 *  It grows out of the candle itself, via the shared ConsentBubble — the
 *  explanation and the switch are one object, so nobody has to hunt for where
 *  to change it later.
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
  const askedFor = useRef<string | null>(null);

  // Once a day, on the first open — counted against the member, so a new
  // phone doesn't re-ask a question already answered.
  useEffect(() => {
    if (!user) return;
    let live = true;
    void (async () => {
      const p = await myPresence(user.id);
      if (!live || !p) return;              // pre-migration: stay silent
      setPres(p);
      await loadPrompts(user.id);
      if (!live || promptSeenToday('presence')) return;
      setWhy('open');
    })();
    return () => { live = false; };
  }, [user]);

  // On switching who you're acting as — ONCE, EVER. It teaches one thing ("your
  // light doesn't change when you switch"), and once that's learned it must
  // stop: since the space view-toggle now switches your identity for you
  // (founder 2026-08-07), this would otherwise fire every single time anyone
  // opened Admin view, which is precisely the prompt-you-stop-reading problem.
  useEffect(() => {
    if (!user || !pres) return;
    const key = actor.type === 'self' ? 'self' : `${actor.type}:${actor.id}`;
    if (askedFor.current === null) { askedFor.current = key; return; }  // first paint
    if (askedFor.current === key) return;
    askedFor.current = key;
    if (why === null && !promptSeen('presence-switch')) setWhy('switch');
  }, [actor, user, pres, why]);

  if (!user || !pres || !why) return null;

  const lit = candleLit(pres) || pres.alwaysPresent;
  const actorName = actor.type === 'self' ? null : actor.name;

  const close = () => {
    void markPrompt(user.id, why === 'switch' ? 'presence-switch' : 'presence');
    setWhy(null);
  };

  const choose = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) await setAlwaysPresent(user.id, true);
      else { await setAlwaysPresent(user.id, false); await snuffPresence(user.id); }
      setPres({ ...pres, alwaysPresent: on, litUntil: on ? pres.litUntil : null });
      onChange?.(on);
    } catch (e) { console.error(e); }
    setBusy(false);
    close();
  };

  return (
    <ConsentBubble
      anchor={anchor}
      onClose={close}
      editLabel="presence"
      editTo="/mycelium/directory?from=home"
      title={why === 'switch'
        ? `You’re acting as ${actorName}.`
        : lit ? 'Your light is on.' : 'Your light is out.'}
      actions={
        <>
          <button className="btn btn-primary" disabled={busy}
            onClick={() => (lit ? close() : void choose(true))}>
            {lit ? 'Keep it lit' : 'Light it'}
          </button>
          <button className="btn cbub__out" disabled={busy}
            onClick={() => (lit ? void choose(false) : close())}>
            {lit ? 'Blow it out' : 'Leave it out'}
          </button>
        </>
      }
    >
      <p>
        {why === 'switch'
          ? `Switching doesn’t change your light. You have one, and it shows everywhere you belong. Right now it’s ${lit ? 'on' : 'out'}.`
          : 'The candle is the only thing that says you’re present and open to connecting — nothing shows that you’re merely online. No timestamps or last seen following you through the app.'}
      </p>
      <p className="cbub__quiet">
        Being present is a gift. If you’d rather read, post and get things done
        without being open to connecting right now, blow it out. Tap the candle
        any time to be present, or not.
      </p>
    </ConsentBubble>
  );
}

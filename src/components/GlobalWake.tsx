import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { postToAssistantFeed } from '../lib/assistantFeedApi';
import { canListen, setVoiceOn, startWakeWord, topWakeHandler, useWakeWanted } from '../lib/voice';

/** "HEY BRAIN", APP-WIDE (founder 2026-11-26). While the always-listening
 *  setting is on (or a screen claimed the wake words) and Lichen is open on
 *  screen, one wake listener runs for the whole app. Only a phrase that
 *  starts with "Hey Brain" / "Hey Claude" acts; the rest is never sent. By
 *  default the words go to the brain as a new message, voice mode turns on,
 *  and the reply is spoken; a screen that pushed a handler (a doc's Claude
 *  panel) hears them instead. */
export default function GlobalWake() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const wanted = useWakeWanted();
  const navRef = useRef(navigate); navRef.current = navigate;
  useEffect(() => {
    if (!user || !wanted || !canListen()) return;
    const w = startWakeWord((said) => {
      const h = topWakeHandler();
      if (h) { h(said); return; }
      setVoiceOn(true);
      void postToAssistantFeed(said, undefined, 'general').then((row) => {
        navRef.current(`/assistant/feed?thread=general${row.convo_id ? `&convo=${row.convo_id}` : ''}`);
      }).catch(() => {});
    });
    return () => w.stop();
  }, [user, wanted]);
  return null;
}

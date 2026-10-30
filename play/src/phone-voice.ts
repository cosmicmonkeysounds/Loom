// Wave 53 (C4, C5): the house announcements in the phone's own voice. Opt-in
// and per device: the upload's 🔊 card, or ⊞ Start, either way; nothing is
// on the server. The stream's `announce` frame carries the words of what the
// house speakers say and of a host's 📣, live only, so a phone that missed
// one never hears it. `speechSynthesis` needs a tap before a page's first
// words, so turning it on speaks at once, inside the tap, and a page
// reloaded with it on gets its first tap anywhere. Never in an embedded
// pane (Run → Players: many phones on one laptop).

import { useEffect, useReducer } from "react";
import { usePlayHost, type SessionStorage } from "./host.ts";

const KEY = "loom.phoneVoice";

/** An announcement older than this is not said (a phone that slept through it). */
export const ANNOUNCE_STALE_MS = 30_000;
// DRAFT w53
export const PHONE_VOICE_HELLO = "This phone will say the house announcements.";

/** The stream's `announce` frame: words to say, or `stop` (🔇 + the announcement). */
export interface AnnounceNotice {
  text?: string;
  at?: number;
  stop?: boolean;
}

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || typeof window.SpeechSynthesisUtterance !== "function") return null;
  return window.speechSynthesis ?? null;
}

export function phoneVoiceOn(storage: SessionStorage): boolean {
  try {
    return storage.load<boolean>(KEY) === true;
  } catch {
    return false;
  }
}

/** English whatever the phone's language: the show is. The device picks its voice. */
function say(text: string, volume = 1): void {
  const s = synth();
  if (s === null) return;
  const u = new window.SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.volume = volume;
  s.resume(); // Safari can leave the queue paused after a page was hidden
  s.speak(u);
}

/** Call inside the tap: on says so aloud, off cuts what is being said. */
export function setPhoneVoice(storage: SessionStorage, on: boolean): void {
  try {
    storage.save(KEY, on);
  } catch {
    /* storage blocked: it lasts as long as this tap's words */
  }
  if (on) say(PHONE_VOICE_HELLO);
  else synth()?.cancel();
}

/** One `announce` frame, for this page. */
export function phoneAnnounce(host: { storage: SessionStorage; embedded: boolean }, n: AnnounceNotice, now = Date.now()): void {
  if (host.embedded) return;
  if (n.stop === true) {
    synth()?.cancel();
    return;
  }
  if (typeof n.text !== "string" || n.text === "" || !phoneVoiceOn(host.storage)) return;
  if (typeof n.at === "number" && now - n.at > ANNOUNCE_STALE_MS) return;
  say(n.text);
}

export interface PhoneVoice {
  on: boolean;
  toggle: () => void;
}

/** The Start menu's switch: null with no voice to offer. */
export function usePhoneVoice(): PhoneVoice | null {
  const host = usePlayHost();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  // Read on every render: the upload's card sets it too.
  const on = phoneVoiceOn(host.storage);
  const offered = !host.embedded && synth() !== null;
  useEffect(() => {
    if (!on || !offered) return;
    const prime = () => say(" ", 0);
    document.addEventListener("pointerdown", prime, { once: true, capture: true });
    return () => document.removeEventListener("pointerdown", prime, { capture: true });
  }, [on, offered]);
  if (!offered) return null;
  return {
    on,
    toggle: () => {
      setPhoneVoice(host.storage, !on);
      bump();
    },
  };
}

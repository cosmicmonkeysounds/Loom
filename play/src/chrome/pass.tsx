//! The full-screen pass (wave 13): the QR a performer scans, as big as the
//! phone allows, on the brightest white the screen has, with the screen
//! held awake while it is up. Opened by the taskbar's 🎟 Pass (one tap from
//! every screen) and the cutscene's "My pass". It covers everything but a
//! takeover (`--z-pass`): a guest holding up a QR is never interrupted by a
//! dialog or a blue screen — those wait behind `useMomentsHold`.

import { useEffect, useRef } from "react";
import { usePlayHost } from "../host.ts";
import { eventRoot } from "./balloon.tsx";
import { useMomentsHold } from "../moments/provider.tsx";
import { PassQr } from "../pass-qr.tsx";
import { useHeldWakeLock } from "../wake-lock.ts";

/** What the pass tells the guest to do. */
export const PASS_SAY = "Hold this up to a performer's camera.";
/** Phones can't be told to brighten: ask. */
export const PASS_HINT = "Not scanning? Turn your screen brightness up.";

export function FullPass({ guestId, name, onClose }: { guestId: string; name: string; onClose: () => void }) {
  const host = usePlayHost();
  useMomentsHold(true);
  useHeldWakeLock(!host.embedded);
  const done = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    done.current?.focus();
    const key = (e: Event) => {
      if ((e as KeyboardEvent).key === "Escape") close.current();
    };
    const root = eventRoot(done.current);
    root.addEventListener("keydown", key);
    return () => {
      root.removeEventListener("keydown", key);
      before?.focus?.();
    };
  }, []);
  return (
    <div className="fullpass" role="dialog" aria-modal="true" aria-label={`Your pass — ${name}`}>
      <div className="w95-titlebar fullpass-bar">
        <span className="w95-title">🎟 Your pass</span>
        <button type="button" className="w95-btn w95-x" aria-label="Close the pass" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="fullpass-body">
        <div className="fullpass-qr">
          <PassQr alt={`Pass QR for ${name}`} text={guestId} />
        </div>
        <div className="fullpass-name">{name}</div>
        <div className="fullpass-id">{guestId}</div>
        <p className="fullpass-say">{PASS_SAY}</p>
        <p className="fullpass-hint">{PASS_HINT}</p>
        <button ref={done} type="button" className="w95-btn fullpass-done" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

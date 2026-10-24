//! The confrontation (wave 18, BOOTH-SPEC §4.3, Q30): an Antivirus scan of a
//! marked program is the confrontation itself. Not a pop-out: it replaces
//! the card inside the scanner (or the card window) — CORRUPTION DETECTED,
//! the picture, the reason, the story's SAY IT line and one big 🛡. After
//! an in-person scan 🛡 takes one tap once a 600 ms dead time has run; after
//! a card's *Scan again* (not in person) it takes two. On the capture the
//! screen wears the CAPTURED stamp and says where to walk them.

import { clockText, useShowClock, type ShowClock } from "../show-clock.ts";
import { useEffect, useState } from "react";
import { playTone } from "../alerts.ts";
import { ARM_LINE, useArmButtons } from "../arm.ts";
import { PersonAvatar } from "../ui/primitives.tsx";
import { GuestBadges } from "./badges.tsx";
import { Icon } from "../chrome/icons.tsx";
import type { PrimeActResult } from "../types.ts";
import { Outcome } from "./card.tsx";
import { pressOutcome, type OutcomeLine } from "./model.ts";
import { claimNote, type Confront } from "./popouts/model.ts";

/** The win tone (`alerts.ts`). */
function winTone(): void {
  playTone("win");
}

/** The confrontation's status bar: "Scanned 7:12 PM · claimed by you". */
export function scannedLine(at: Date | string, claimedBy: string | null, me: string): string {
  // The party's show clock ("7:12 PM") when the story keeps one, never the
  // wall clock (BN-F17: it read 3:12 AM at 7:09 PM on the tray).
  const time = typeof at === "string" ? at : at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `Scanned ${time} · ${claimNote(claimedBy, me)}`;
}

export interface ConfrontProps {
  c: Confront;
  me: string;
  /** What the booth's character said to them on the scan (SAY IT). */
  said?: readonly string[];
  /** The 🩹 unmark button, when the card offers one. */
  unmarkId?: string | null;
  /** Loose marks left (the Board button). */
  board?: number;
  /** Caught by someone else (the board says so): the refused line. */
  caughtBy?: string | null;
  scannedAt?: Date;
  /** The view's show clock (the tray's): the status bar's time. */
  showClock?: ShowClock | null;
  /** Press a story button on this guest. */
  press: (id: string) => Promise<PrimeActResult>;
  onNotNow: () => void;
  onNext: () => void;
  onBoard?: () => void;
  /** Wave 21: a player booth — no staff-room lines in the outcome. */
  player?: boolean;
}

type Phase = { kind: "ready" } | { kind: "sending" } | { kind: "captured"; lines: OutcomeLine[] } | { kind: "refused"; lines: OutcomeLine[] };

export function ConfrontScreen(p: ConfrontProps) {
  const { c } = p;
  const arm = useArmButtons();
  const [phase, setPhase] = useState<Phase>({ kind: "ready" });
  const [shownAt] = useState(() => Date.now());
  const [dead, setDead] = useState(c.deadMs > 0);
  const [fold, setFold] = useState(false);
  const [at] = useState(() => p.scannedAt ?? new Date());
  const show = useShowClock(p.showClock ?? null);
  const [showAt] = useState(() => (show !== null ? clockText(show.minutes) : null));
  useEffect(() => {
    if (c.deadMs <= 0) return;
    const t = setTimeout(() => setDead(false), c.deadMs);
    return () => clearTimeout(t);
  }, [c.deadMs]);
  const go = (id: string, after: (r: PrimeActResult) => void) => {
    setPhase({ kind: "sending" });
    p.press(id).then(after, (e: unknown) => setPhase({ kind: "refused", lines: [{ kind: "staff", text: e instanceof Error ? e.message : String(e), refused: true }] }));
  };
  const shield = () => {
    if (phase.kind !== "ready" || dead || Date.now() - shownAt < c.deadMs) return;
    arm.tap("shield", c.arm, () =>
      go(c.shield, (r) => {
        const lines = pressOutcome(r, "press", { player: p.player === true });
        if (r.refused === true) setPhase({ kind: "refused", lines });
        else {
          setPhase({ kind: "captured", lines });
          winTone();
        }
      }),
    );
  };
  const unmark = () => {
    if (phase.kind !== "ready" || p.unmarkId == null) return;
    arm.tap("unmark", true, () => go(p.unmarkId!, () => p.onNotNow()));
  };
  const reason = c.reason?.trim() ?? "";
  if (phase.kind === "captured") {
    return (
      <div className="confront captured" role="group" aria-label={`${c.name} captured`}>
        <div className="confront-cap" aria-hidden>
          ⚠ CORRUPTION DETECTED
        </div>
        <div className="confront-pic">
          <PersonAvatar name={c.name} size="lg" />
          <span className="stamp slam">C A P T U R E D</span>
        </div>
        <div className="confront-name">
          {c.name}
          <GuestBadges id={c.guest} />
        </div>
        <p className="confront-walk">Walk {c.name} through the Tube to the tent. Their phone shows them the way.</p>
        {phase.lines.length > 0 && phase.lines.some((l) => l.kind !== "none") && (
          <div className="booth-earlier">
            <button type="button" className="booth-fold" aria-expanded={fold} onClick={() => setFold((v) => !v)}>
              {fold ? "▾" : "▸"} What the story said
            </button>
            {fold && <Outcome lines={phase.lines} />}
          </div>
        )}
        <div className="confront-foot">
          {p.onBoard !== undefined && (p.board ?? 0) > 0 && (
            <button type="button" className="w95-btn confront-btn" onClick={p.onBoard}>
              🚨 Board ({p.board})
            </button>
          )}
          <button type="button" className="w95-btn booth-default confront-btn" onClick={p.onNext}>
            <Icon name="scan" /> Next guest
          </button>
        </div>
      </div>
    );
  }
  const armed = arm.armed === "shield";
  const sending = phase.kind === "sending";
  return (
    <div className="confront" role="group" aria-label={`Corruption detected: ${c.name}`}>
      <div className="confront-cap" aria-hidden>
        ⚠ CORRUPTION DETECTED
      </div>
      <div className="confront-pic">
        <PersonAvatar name={c.name} size="lg" />
      </div>
      <div className="confront-name">
          {c.name}
          <GuestBadges id={c.guest} />
        </div>
      <p className="confront-reason">{reason !== "" ? `Marked for reinstallation: ${reason}` : "Marked for reinstallation."}</p>
      {(p.said ?? []).length > 0 && (
        <div className="confront-say w95-inset">
          <span className="confront-say-k">SAY IT:</span> {(p.said ?? []).join(" ")}
        </div>
      )}
      {c.arm && <p className="confront-remote">📡 Not scanned in person: tap twice.</p>}
      {phase.kind === "refused" && (
        <>
          <Outcome lines={phase.lines} />
          {p.caughtBy != null && <p className="booth-refusal">Caught by {p.caughtBy}.</p>}
        </>
      )}
      <button type="button" className={`w95-btn booth-default confront-shield ${armed ? "armed" : ""} ${dead ? "dead" : ""}`} disabled={dead || sending || phase.kind === "refused"} aria-busy={sending || undefined} aria-pressed={armed || undefined} onClick={shield}>
        <span className="confront-shield-label">{sending ? "🛡 Sending…" : armed ? "Tap again to send" : "🛡 SEND TO THE INTERNET"}</span>
        {dead && (
          <>
            <span className="confront-dead-bar" aria-hidden />
            <span className="confront-dead-word">Ready in a moment</span>
          </>
        )}
      </button>
      <div className="confront-foot">
        <button type="button" className="w95-btn confront-btn" onClick={p.onNotNow} disabled={sending}>
          Not now
        </button>
        {p.unmarkId != null && (
          <button type="button" className={`w95-btn confront-btn ${arm.armed === "unmark" ? "armed" : ""}`} onClick={unmark} disabled={sending}>
            {arm.armed === "unmark" ? ARM_LINE : "🩹 Not them…"}
          </button>
        )}
      </div>
      <div className="booth-status">{scannedLine(showAt ?? at, c.claimedBy, p.me)}</div>
    </div>
  );
}

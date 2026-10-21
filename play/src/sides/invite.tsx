//! The invite card (wave 18, GUEST-SPEC §9.4): another guest wants you in
//! their side or their crew. Not now (final for this invitation) / Join —
//! the server's answer route, then the card's answer (the big closes).

import { useState } from "react";
import type { WidgetProps } from "../widgets.tsx";
import { useSides } from "./context.ts";
import { countLine, factionModeOf, inviteDone, inviteLeaveLine, inviteOf, sidesOf } from "./model.ts";

export function InviteCard({ card, onAnswer, answered }: WidgetProps) {
  const { view, calls } = useSides();
  const inv = inviteOf(view, card.params, card.text);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const leave = inviteLeaveLine(view, inv);
  const live = onAnswer !== undefined && calls !== null && answered == null && inv.id !== "";
  // Faction mode: never a count on an invitation (nobody counts a rival).
  const side = inv.kind === "side" && !factionModeOf(view) ? sidesOf(view).find((s) => s.id === inv.target || s.name === inv.targetName) : undefined;
  const answer = (yes: boolean) => {
    if (!live || busy) return;
    setBusy(true);
    void calls!.answer(inv.id, yes).then(
      () => onAnswer!({ yes }),
      (e: unknown) => {
        setBusy(false);
        setErr(String((e as { message?: unknown }).message ?? "That didn't go through."));
      },
    );
  };
  if (answered != null) {
    return (
      <div className="widget invite-done">
        <div className="widget-title">🚪 {inv.line}</div>
        <div className="widget-sub">{inviteDone(view, inv, answered)}</div>
      </div>
    );
  }
  return (
    <div className="widget invite-card">
      <div className="widget-title">🚪 {inv.line}</div>
      {side !== undefined && countLine(side) !== "" && <div className="widget-sub">{countLine(side)}</div>}
      <div className="invite-buttons">
        <button type="button" className="choice" disabled={!live || busy} onClick={() => answer(false)}>
          Not now
        </button>
        <button type="button" className="choice primary" disabled={!live || busy} onClick={() => answer(true)}>
          Join {inv.targetName}
        </button>
      </div>
      {leave !== null && <div className="widget-sub invite-leave">{leave}</div>}
      {err !== null && <p className="err">{err}</p>}
    </div>
  );
}

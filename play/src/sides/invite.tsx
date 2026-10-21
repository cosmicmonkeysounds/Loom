//! The invite card (wave 18, GUEST-SPEC §9.4): another guest wants you in
//! their side or their crew. Not now (final for this invitation) / Join —
//! the server's answer route, then the card's answer (the big closes).

import { useState } from "react";
import type { WidgetProps } from "../widgets.tsx";
import { useSides } from "./context.ts";
import { countLine, inviteOf, sidesOf } from "./model.ts";

export function InviteCard({ card, onAnswer, answered }: WidgetProps) {
  const { view, calls } = useSides();
  const inv = inviteOf(view, card.params, card.text);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = onAnswer !== undefined && calls !== null && answered == null && inv.id !== "";
  const side = inv.kind === "side" ? sidesOf(view).find((s) => s.id === inv.target || s.name === inv.targetName) : undefined;
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
        <div className="widget-sub">{answered["yes"] === true ? `You joined ${inv.targetName}.` : "You said not now."}</div>
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
      {err !== null && <p className="err">{err}</p>}
    </div>
  );
}

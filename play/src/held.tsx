//! The refused screen (wave 59, `core/server/routes/rejoin.ts`, One holder): a
//! badge, an invitation or a staff badge whose part or Person a phone holds.
//! It says so, naming only what is printed on the card, and offers Ask a host:
//! Approve signs the old phone out and this one in. A lazy part: never in the
//! first load. The calls and copy are `rejoin-calls.ts`'s.

import { useEffect, useState } from "react";
import type { HeldCard } from "./rejoin.ts";
import { ASK_POLL_MS, HELD_HINT, askHeld, askLine, heldLine, pollAsk, type Ask, type AskState, type CardBooth } from "./rejoin-calls.ts";
import type { AdoptedGuest } from "./resume.ts";

export function HeldPanel({ card, onGuest, onBooth, onBack }: { card: HeldCard; onGuest: (guest: AdoptedGuest) => void; onBooth: (booth: CardBooth) => void; onBack: () => void }) {
  const [asked, setAsked] = useState<{ ask: Ask; state: AskState } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const ask = async () => {
    setBusy(true);
    setNote("");
    try {
      setAsked({ ask: await askHeld(card), state: { kind: "pending" } });
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't ask — try again.");
    } finally {
      setBusy(false);
    }
  };

  // While asking: poll until a host answers (or the ask runs out).
  const waiting = asked !== null && asked.state.kind === "pending" ? asked.ask : null;
  useEffect(() => {
    if (waiting === null) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const state = await pollAsk(waiting);
      if (!live) return;
      if (state.kind === "approved") return onGuest(state.guest);
      if (state.kind === "booth") return onBooth(state.booth);
      if (state.kind !== "pending") return setAsked({ ask: waiting, state });
      timer = setTimeout(() => void tick(), ASK_POLL_MS);
    };
    timer = setTimeout(() => void tick(), ASK_POLL_MS);
    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, [waiting, onGuest, onBooth]);

  return (
    <div className="rejoin rejoin-panel cast-pick" role="group" aria-label="Already signed in" data-testid="held-panel">
      <div className="sheet-h">🔒 {heldLine(card)}</div>
      {asked === null ? (
        <>
          <p className="pick-hint">{HELD_HINT}</p>
          <button type="button" className="choice primary" disabled={busy} onClick={() => void ask()}>
            🙋 Ask a host
          </button>
          <button type="button" className="link" onClick={onBack}>
            ‹ Back
          </button>
        </>
      ) : (
        <>
          <p className="sub" role="status">
            {askLine(asked.state, asked.ask.name)}
          </p>
          {asked.state.kind === "pending" ? (
            <button type="button" className="link" onClick={() => setAsked(null)}>
              Cancel
            </button>
          ) : (
            <>
              <button type="button" className="choice ghost" disabled={busy} onClick={() => void ask()}>
                Ask again
              </button>
              <button type="button" className="link" onClick={onBack}>
                ‹ Back
              </button>
            </>
          )}
        </>
      )}
      {note !== "" && (
        <p className="pick-hint" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

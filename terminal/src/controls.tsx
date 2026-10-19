//! Controls shared by the terminal's screens (the line, the chess board):
//! the typed fallback for a tablet whose camera can't run, and the ⚙ that
//! opens setup only on a 2 s hold.

import { useState } from "react";
import type { TerminalConfig } from "./config.ts";
import { HOLD_MS, useLongPress } from "./kiosk.ts";
import { fetchRoster } from "./pilot.ts";
import { matchName } from "./scan.ts";

// --- the typed fallback ------------------------------------------------------

export function TypedFallback({ config, onPick, onProblem }: { config: TerminalConfig; onPick: (id: string) => void; onProblem: (msg: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (name.trim() === "" || busy) return;
    setBusy(true);
    try {
      const hit = matchName(name, await fetchRoster(config));
      if (hit.kind === "one") onPick(hit.id);
      else if (hit.kind === "many") onProblem(`SEVERAL PROGRAMS MATCH: ${hit.names.slice(0, 4).join(", ").toUpperCase()}`);
      else onProblem("NO SUCH PROGRAM — REGISTER ON YOUR PHONE FIRST");
    } catch (e) {
      onProblem(`LOOKUP FAILED — ${(e as Error).message.toUpperCase()}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="typed"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="your program name" autoFocus autoComplete="off" autoCapitalize="off" spellCheck={false} />
      <button type="submit" disabled={busy || name.trim() === ""}>
        CONNECT
      </button>
    </form>
  );
}

// --- the gear ------------------------------------------------------------------

/** The ⚙: opens setup only after a 2 s hold, filling up while held. A short
 *  tap (or a click) does nothing — a wall tablet is in guests' hands. */
export function Gear({ onOpen, label, className }: { onOpen: () => void; label: string; className?: string }) {
  const { holding, handlers } = useLongPress(onOpen);
  return (
    <button
      type="button"
      className={`link gear${className ? ` ${className}` : ""}${holding ? " holding" : ""}`}
      style={{ ["--hold-ms" as string]: `${HOLD_MS}ms` }}
      aria-label={`${label} (hold for ${HOLD_MS / 1000} seconds)`}
      {...handlers}
    >
      ⚙
    </button>
  );
}

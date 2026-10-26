//! Controls shared by the terminal's screens (the line, the chess board):
//! the typed fallback for a tablet whose camera can't run, and the ⚙ that
//! opens setup only on a 2 s hold.

import { useEffect, useRef, useState } from "react";
import type { TerminalConfig } from "./config.ts";
import { HOLD_MS, useLongPress } from "./kiosk.ts";
import { fetchRoster } from "./pilot.ts";
import { matchName } from "./scan.ts";

// --- the typed fallback ------------------------------------------------------

/**
 * Type a program name instead of scanning. Opened from a toggle, it takes
 * the focus at once. `focus` (wave 26, T3: the tent's kiosk, where it is
 * always shown): take the focus whenever it turns true (the station idle,
 * no card up), never otherwise — a keystroke during a walk is the walk's.
 * `clearOnPick`: the field empties after a pick (a kiosk serves the next one).
 */
export function TypedFallback({ config, onPick, onProblem, focus, clearOnPick = false }: { config: TerminalConfig; onPick: (id: string) => void; onProblem: (msg: string) => void; focus?: boolean; clearOnPick?: boolean }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focus === true) input.current?.focus();
  }, [focus]);
  const submit = async () => {
    if (name.trim() === "" || busy) return;
    setBusy(true);
    try {
      const hit = matchName(name, await fetchRoster(config));
      if (hit.kind === "one") {
        if (clearOnPick) setName("");
        onPick(hit.id);
      }
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
      <input ref={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="your program name" autoFocus={focus === undefined} autoComplete="off" autoCapitalize="off" spellCheck={false} />
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

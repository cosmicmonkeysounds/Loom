//! Controls shared by the terminal's screens (the line, the chess board):
//! the typed fallback for a tablet whose camera can't run, and the ⚙ that
//! opens setup only on a 2 s hold.

import { useEffect, useRef, useState, type RefObject } from "react";
import type { TerminalConfig } from "./config.ts";
import { HOLD_MS, useLongPress } from "./kiosk.ts";
import { fetchRoster } from "./pilot.ts";
import { matchName } from "./scan.ts";

// --- the typed fallback ------------------------------------------------------

/** Something that can say whether a node sits inside it (an element). */
type Within = { contains(node: unknown): boolean };

/**
 * Should the typed field take the focus back after a tap settles? Yes when
 * the focus is nowhere (the body, a node that has gone) or on something
 * outside `scope` (the kiosk card): a backdrop window's × or button, which
 * Chrome focuses on a click, would otherwise eat the guest's typing and
 * press itself on Enter. No when it is on a control inside `scope` (the
 * field itself, CONNECT, a quick pick). No scope: the field's own form.
 */
export function takesFocusBack(active: unknown, o: { body: unknown; attached: boolean; scope: Within | null }): boolean {
  if (active === null || active === undefined || active === o.body || !o.attached) return true;
  return o.scope === null || !o.scope.contains(active);
}

/** A typed program name (or id) → that program, or a line saying why not. */
export async function pickByName(config: TerminalConfig, name: string, onPick: (id: string) => void, onProblem: (msg: string) => void): Promise<boolean> {
  try {
    const hit = matchName(name, await fetchRoster(config));
    if (hit.kind === "one") {
      onPick(hit.id);
      return true;
    }
    if (hit.kind === "many") onProblem(`SEVERAL PROGRAMS MATCH: ${hit.names.slice(0, 4).join(", ").toUpperCase()}`);
    else onProblem("NO SUCH PROGRAM — REGISTER ON YOUR PHONE FIRST");
  } catch (e) {
    onProblem(`LOOKUP FAILED — ${(e as Error).message.toUpperCase()}`);
  }
  return false;
}

/**
 * Type a program name instead of scanning. Opened from a toggle, it takes
 * the focus at once. `focus` (wave 26, T3: the tent's kiosk, where it is
 * always shown): take the focus whenever it turns true (the station idle,
 * no card up), and back after any tap that leaves it outside `scope` (the
 * kiosk card; default the field's own form), never otherwise — a keystroke
 * during a walk is the walk's.
 * `clearOnPick`: the field empties after a pick (a kiosk serves the next one).
 */
export function TypedFallback({ config, onPick, onProblem, focus, scope, clearOnPick = false }: { config: TerminalConfig; onPick: (id: string) => void; onProblem: (msg: string) => void; focus?: boolean; scope?: RefObject<HTMLElement | null>; clearOnPick?: boolean }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (focus !== true) return;
    input.current?.focus();
    // A tap that left the focus nowhere (the wake prompt goes away under it)
    // or outside the card (a backdrop window's button) gives it back, once
    // the tap has settled.
    let t = 0;
    const back = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const a = document.activeElement;
        const own = scope?.current ?? form.current;
        if (takesFocusBack(a, { body: document.body, attached: a !== null && document.body.contains(a), scope: own })) input.current?.focus();
      }, 400);
    };
    window.addEventListener("pointerup", back);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pointerup", back);
    };
  }, [focus, scope]);
  const submit = async () => {
    if (name.trim() === "" || busy) return;
    setBusy(true);
    const picked = await pickByName(config, name, onPick, onProblem);
    if (picked && clearOnPick) setName("");
    setBusy(false);
  };
  return (
    <form
      ref={form}
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

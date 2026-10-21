//! Attract mode (OCT31 K-16; wave 17): the full-screen idle show a terminal
//! shows while its character is hidden or asleep (`idle-show/`) — the
//! screensavers, the ads, the popups, playing to the night but never naming
//! him. No camera, no scanner, no line: only the ⚙ (2 s hold) and the
//! terminal's own name in the corner. The TV's attract is this too, quieter
//! (`target: "tv"`), with nothing asking to be touched.

import type { ReactNode } from "react";
import { IdleShow } from "./idle-show/IdleShow.tsx";
import type { ScreenState } from "./screen.ts";

/** The full attract screen. `corner` is the terminal's name + its ⚙. */
export function Attract({ corner, name, state, character, target, covered = false }: { corner: ReactNode; name: string; state: ScreenState | null; character: string; target: "tv" | "wall"; /** A slide or an overlay is over it: paused. */ covered?: boolean }) {
  return (
    <div className="terminal mirror attract-screen" data-target={target}>
      <IdleShow name={name} state={state} asleep character={character} target={target} active={!covered} />
      {corner}
    </div>
  );
}

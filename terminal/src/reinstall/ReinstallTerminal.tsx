//! The tent laptop (wave 18b, `view=reinstall`): one device that is a wall
//! terminal **and** the reinstallation wizard. A lazy chunk (`app.tsx`'s
//! `ReinstallSlot`), awake all night like the King's board and the casino.
//!
//! **A stub** (the `termbase` lane): the app's wiring (the props below, the
//! slot, the busy flag, the wake overlay and the world pane) is in place;
//! the station itself — the idle show with its scan box and quick picks,
//! the refusal card, the wizard card on a `tablet_*` cue, and the
//! reinstall flow (`@loom/reinstall/flow.tsx`) in a shadow root — is the
//! `tent` lane's (the tent scout's §1.2). Until then the laptop plays
//! the idle show like any wall terminal.
//!
//! The contract with the app:
//! - `onBusy(true)` while a walk (or the wizard) is on screen: the app's
//!   screen layer then treats this terminal as piloting, so story slides and
//!   beat cutscenes stand aside; `onBusy(false)` when it is back to idle.
//! - `takeover`: a story overlay (blackout / alarm / go to the living room)
//!   covers the screen — the walk is **held** (`ReinstallFlow`'s `held`),
//!   never ended.
//! - `worldSlot(store, size)`: the app's guarded world view (or the
//!   raycaster with no WebGL2), for a pane while someone else is in the
//!   simulation on a headset.
//! - Sounds: the game's go through the page's master bus
//!   (`createSfx(soundOutput)`, `sound/bus.ts`).

import { useEffect, type ReactNode } from "react";
import type { TerminalConfig } from "../config.ts";
import type { ScreenState } from "../screen.ts";
import type { Gone, WorldStore } from "../world/stream.ts";
import { Gear } from "../controls.tsx";
import { IdleShow } from "../idle-show/IdleShow.tsx";

export interface ReinstallTerminalProps {
  config: TerminalConfig;
  state: ScreenState | null;
  /** The screen-state poll is answering. */
  polled: boolean;
  /** A story overlay covers the screen: hold a walk, never end it. */
  takeover: boolean;
  /** A slide or an overlay covers the screen: the idle show pauses under it. */
  covered: boolean;
  /** The character is hidden or asleep: the idle show's naming gate (nothing
   *  names Trabolta before the introduction). Never a screensaver here. */
  asleep: boolean;
  onSetup: () => void;
  /** The spatial stream was refused for good (access revoked / event over). */
  onGone: (g: Gone) => void;
  /** A walk (or the wizard) is on screen (true), or back to idle (false). */
  onBusy: (busy: boolean) => void;
  /** The app's guarded world view for a store, as a pane or full screen. */
  worldSlot: (store: WorldStore, size: "pane" | "full") => ReactNode;
}

export function ReinstallTerminal({ config, state, covered, asleep, onSetup, onBusy }: ReinstallTerminalProps) {
  // The stub never pilots or walks: always idle.
  useEffect(() => onBusy(false), [onBusy]);
  return (
    <div className="terminal reinstall attract">
      <IdleShow name={config.name} state={state} asleep={asleep} character={config.character} target="wall" active={!covered} region="full" />
      <div className="mirror-corner">
        {config.title ? `${config.title} · ` : ""}
        {config.name.toUpperCase()}
      </div>
      <Gear onOpen={onSetup} label="Set up this terminal" className="mirror-gear" />
      <div className="scanlines" aria-hidden="true" />
    </div>
  );
}

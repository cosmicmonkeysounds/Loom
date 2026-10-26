//! The locked phone (wave 26, R1; CONTRACTS C2). Its screen (`lock.tsx`) is
//! a part of its own, never in the guest's first load, fetched a little
//! after the first paint (`prefetch`) so a capture finds it already there.
//! The frame around it is eager (`LockFrame`): the title bar, the moments
//! layer and the Pass-only taskbar. While the part loads, or if it won't
//! (bad wifi on the night), the guest still has the capture big, the glitch
//! takeover and their pass for the tent's scanner.

import type { ComponentProps } from "react";
import { Icon } from "../chrome/icons.tsx";
import { taskbarButtonClass } from "../chrome/taskbar.tsx";
import { MomentsAndPins } from "../moments/pins-rail.tsx";
import type { ChatMessage } from "../types.ts";
import type { LockScreen } from "./lock.tsx";
import { NowBar } from "./frame.tsx";
import { lazyPart } from "./lazy-part.tsx";

export const LazyLockScreen = lazyPart<ComponentProps<typeof LockScreen>>(() => import("./lock.tsx").then((m) => ({ default: m.LockScreen })), "This screen", <main className="lock-screen" aria-busy />);

export interface LockFrameProps extends ComponentProps<typeof LockScreen> {
  title: string;
  me: string;
  pins: ChatMessage[];
  paused: boolean;
  conn: "live" | "reconnecting" | "offline";
}

/** The locked phone: `[NowBar][moments][lock screen][Pass]`. Only the
 *  middle is lazy. */
export function LockFrame({ title, me, pins, paused, conn, ...screen }: LockFrameProps) {
  return (
    <>
      <NowBar objectives={screen.objective !== null ? [screen.objective] : []} fallback={title} onOpen={() => {}} sub="🔒 captured" tone="alarm" paused={paused} />
      <MomentsAndPins pins={pins} me={me} />
      <LazyLockScreen {...screen} />
      <nav className="taskbar lock-bar" aria-label="Taskbar">
        <button type="button" className={taskbarButtonClass({ primary: true, stacked: true })} aria-label="Pass" title="Show your pass" onClick={screen.onPass}>
          <span className="taskbar-icon" aria-hidden>
            <Icon name="pass" size={20} />
          </span>
          <span className="taskbar-label">Pass</span>
        </button>
        <div className={`taskbar-tray ${conn}`} role="group" aria-label="Tray" />
      </nav>
    </>
  );
}

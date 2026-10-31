//! A host booth's windows (wave 25, docs/loom-house-desk.md §6.2): the
//! taskbar `Show · Chats · Desk · Scan` and the Desk window, fetched on first
//! open (its own chunk: the house desk's model never weighs on a booth that
//! doesn't open it). A fetch that fails shows Try again, never a white page
//! (`lazy-chunk.tsx`). `booth/app.tsx` lays the windows out.

import { Suspense, useState } from "react";
import { Icon } from "../chrome/icons.tsx";
import type { TaskbarButton } from "../chrome/taskbar.tsx";
import { BoothIcon } from "../booth/icons.tsx";
import { ChunkBoundary, retryableLazy } from "../lazy-chunk.tsx";
import type { DeskWindowProps } from "./desk.tsx";
import type { HostWindow } from "./show-model.ts";

export interface HostTaskbarInput {
  /** The window on screen (none while a room covers it on a phone). */
  pressed: HostWindow | null;
  /** Guests whose typed line waits unread (the old 🗂 Guests badge). */
  chatsBadge: number;
  scanOpen: boolean;
  open: (w: HostWindow) => void;
  scan: () => void;
}

/** The host's taskbar windows: ▣ Show · 💬 Chats · 🎛 Desk · 📷 Scan (the primary). Guests live in Show's People. */
export function hostTaskbarButtons(o: HostTaskbarInput): TaskbarButton[] {
  return [
    { id: "show", label: "Show", icon: <Icon name="mission" size={20} />, onClick: () => o.open("show"), stacked: true, tour: "show", title: "The night: NEXT, your jobs, what needs you", pressed: o.pressed === "show" },
    { id: "chats", label: "Chats", icon: <Icon name="reply" size={20} />, onClick: () => o.open("chats"), stacked: true, tour: "chats", title: "Staff rooms, readouts, guests' messages", pressed: o.pressed === "chats", ...(o.chatsBadge > 0 ? { badge: o.chatsBadge } : {}) },
    { id: "desk", label: "Desk", icon: <BoothIcon name="desk" size={20} />, onClick: () => o.open("desk"), stacked: true, tour: "desk", title: "The house desk: GO, stop, test the speakers and lights", pressed: o.pressed === "desk" },
    // The title: DRAFT w58.
    { id: "scan", label: "Scan", icon: <Icon name="scan" size={20} />, onClick: o.scan, primary: true, stacked: true, tour: "scan", title: "Scan a pass or a codex QR", active: o.scanOpen },
  ];
}

const Desk = retryableLazy<DeskWindowProps>(() => import("./desk.tsx").then((m) => ({ default: m.DeskWindow })));

/** The Desk window, fetched on first open. */
export function LazyDeskWindow(props: DeskWindowProps) {
  const [, setRound] = useState(0);
  const D = Desk.current();
  const waiting = (text: string, retry?: () => void) => (
    <div className="screen side host-desk" data-testid="host-desk">
      <p className="host-empty">{text}</p>
      {retry !== undefined && (
        <button type="button" className="choice primary" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
  return (
    <ChunkBoundary
      fallback={(retry) =>
        waiting("The Desk didn't load — check the connection.", () => {
          Desk.again();
          setRound((n) => n + 1);
          retry();
        })
      }
    >
      <Suspense fallback={waiting("Loading the house desk…")}>
        <D {...props} />
      </Suspense>
    </ChunkBoundary>
  );
}

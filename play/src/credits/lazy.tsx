//! Where an app keeps the credits roll (wave 44, C7): eager and tiny, the
//! guest's first load. `useCredits` is the open state and the roll this
//! phone saw on its first view; `CreditsSlot` mounts the lazy chunk
//! (`roll.tsx`) once the story has rolled them (`NightView.credits`). The
//! chunk decides the auto-open (`credits-model.ts` `creditsDue`), waits
//! behind the pass, a `!!` takeover or the glitch, fetches and rolls. A
//! chunk that won't load is a card with the ✕ (closing it retries), never
//! a white page.

import { Suspense, useRef, useState } from "react";
import type { StartItem } from "../chrome/start-menu.tsx";
import { ChunkBoundary, retryableLazy } from "../lazy-chunk.tsx";
import type { NightView } from "../types.ts";
import type { CreditsHostProps } from "./roll.tsx";

const Roll = retryableLazy<CreditsHostProps>(() => import("./roll.tsx").then((m) => ({ default: m.CreditsHost })));

/** ⊞ Start's `🎬 Credits` (DRAFT w44) while the story has rolled them (null before). */
export function creditsStartItem(credits: NightView["credits"], open: () => void): StartItem | null {
  return credits && credits.roll > 0 ? { id: "credits", icon: "🎬", label: "Credits", onClick: open } : null;
}

export interface Credits {
  /** Which open this is (a new value per open: one fetch each), or null. */
  open: number | null;
  set: (open: number | null) => void;
  /** The roll this phone saw on its first view with a clock (0: none). */
  first: number | undefined;
}

export function useCredits(roll: number | undefined, clock: number | undefined): Credits {
  const [open, set] = useState<number | null>(null);
  const first = useRef<number | undefined>(undefined);
  if (first.current === undefined && clock !== undefined) first.current = roll ?? 0;
  return { open, set, first: first.current };
}

export function CreditsSlot(p: CreditsHostProps) {
  const C = Roll.current();
  return (
    <ChunkBoundary
      fallback={(retry) =>
        p.c.open !== null && (
          <div className="credits-roll" role="alert">
            <button
              type="button"
              className="credits-x"
              aria-label="Close"
              onClick={() => {
                Roll.again();
                retry();
                p.c.set(null);
              }}
            >
              ✕
            </button>
            {/* DRAFT w44 */}
            <p className="credits-card-sub">The credits didn't load.</p>
          </div>
        )
      }
    >
      <Suspense fallback={null}>
        <C {...p} />
      </Suspense>
    </ChunkBoundary>
  );
}

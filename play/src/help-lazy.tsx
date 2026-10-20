//! The Help sheet, loaded when it is opened (wave 13 fix round): its
//! articles (`docs/help/play/*.md`, bundled raw) are the largest text in the
//! app and a guest rarely opens them, so they stay out of the first load.
//! A fetch that fails (the house Wi-Fi, a page open across a deploy) shows
//! a small sheet with Try again — never a white page (`lazy-chunk.tsx`).

import { Suspense, useState, type ComponentProps } from "react";
import type { HelpSheet as Sheet } from "./help.tsx";
import { ChunkBoundary, retryableLazy } from "./lazy-chunk.tsx";
import { Sheet as Frame } from "./ui/primitives.tsx";

const Help = retryableLazy<ComponentProps<typeof Sheet>>(() => import("./help.tsx").then((m) => ({ default: m.HelpSheet })));

/** `HelpSheet`, fetched on first open (nothing shows for the moment it takes). */
export function LazyHelpSheet(props: ComponentProps<typeof Sheet>) {
  const [, setRound] = useState(0);
  const H = Help.current();
  return (
    <ChunkBoundary
      fallback={(retry) => (
        <Frame title="Help" onClose={props.onClose}>
          <p className="sub">Help didn't load — check the connection.</p>
          <button
            type="button"
            className="choice primary"
            onClick={() => {
              Help.again();
              setRound((n) => n + 1);
              retry();
            }}
          >
            Try again
          </button>
        </Frame>
      )}
    >
      <Suspense fallback={null}>
        <H {...props} />
      </Suspense>
    </ChunkBoundary>
  );
}

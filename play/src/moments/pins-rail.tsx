//! The pinned rail (moved out of `chat.tsx` in wave 13).

import type { ChatMessage } from "../types.ts";

/** The pinned rail — the sticky notices still up in this room (`pin "…"`),
 *  above the stream, newest per key. Nothing to show → nothing rendered. */
export function PinnedRail({ pins }: { pins: ChatMessage[] }) {
  if (pins.length === 0) return null;
  return (
    <div className="pinned-rail" role="status">
      {pins.map((m) => (
        <div key={m.seq} className={`pin ${m.alert ? "alert" : ""}`}>
          📌 {m.text}
        </div>
      ))}
    </div>
  );
}

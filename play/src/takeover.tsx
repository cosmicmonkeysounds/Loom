// The takeover (`pin "!!GO TO THE LIVING ROOM"`): a full-screen layer over
// everything — the shell, the cutscene, the tour — with the pin's text,
// until the story unpins it. No dismiss button. The flash is a slow invert
// (one swap every half second, never red), still under reduced motion.
// `position: absolute` inside `.root`, so an embedded player keeps it in
// its own pane.

import type { ChatMessage } from "./types.ts";

export function Takeover({ pin }: { pin: ChatMessage | null }) {
  if (pin === null) return null;
  return (
    <div className="takeover" role="alert" aria-live="assertive">
      <div className="takeover-text">{pin.text}</div>
    </div>
  );
}

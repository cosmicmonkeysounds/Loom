// Wave 42b (B5): "… is answering other programs. You are 7th in line" —
// the Win98 status strip a guest's DM with an agent-voiced character
// shows above its composer while their line waits for a free slot (the
// `agentWait` frames, `agent-wait.ts`). Not a chat message: it leaves when
// he starts answering (the typing note takes over) or the wait ends. A
// lazy chunk (`channel-view.tsx` `LazyWaitStrip`); the bar is a bare navy
// fill (the Win95 `BlockBar` is in another lazy chunk).

import { waitBar, waitLine } from "../agent-wait-words.ts";
import type { AgentWait } from "../agent-wait.ts";

export function WaitStrip({ name, wait }: { name: string; wait: AgentWait }) {
  const bar = waitBar(wait);
  return (
    <div className="wait-strip" role="status" aria-live="polite">
      <span className="wait-glass" aria-hidden>
        ⌛
      </span>
      <span>{waitLine(name, wait)}</span>
      {bar !== null && (
        <span className="wait-bar" aria-hidden>
          <i style={{ width: `${Math.round((bar.done / bar.total) * 100)}%` }} />
        </span>
      )}
    </div>
  );
}

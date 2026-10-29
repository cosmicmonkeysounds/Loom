// Wave 42b (B5): "… is answering other programs. You are 7th in line" —
// the Win98 status strip a guest's DM with an agent-voiced character
// shows above its composer while their line waits for a free slot (the
// `agentWait` frames, `agent-wait.ts`). Not a chat message: it leaves when
// he starts answering (the typing note takes over) or the wait ends. A
// lazy chunk (`channel-view.tsx` `LazyWaitStrip`); the bar is a bare navy
// fill (the Win95 `BlockBar` is in another lazy chunk).

import { useEffect, useState } from "react";
import { etaLeft, waitBar, waitWords } from "../agent-wait-words.ts";
import type { AgentWait } from "../agent-wait.ts";

/** The wait's words with its estimate counting down (a 1 s tick while
 *  shown; the terminal's line reads it too). */
export function useWaitWords(name: string, wait: AgentWait): [string, string, string] {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [wait]);
  return waitWords(name, { position: wait.position, etaS: etaLeft(wait, now) });
}

export function WaitStrip({ name, wait }: { name: string; wait: AgentWait }) {
  const bar = waitBar(wait);
  const [said, eta, tail] = useWaitWords(name, wait);
  return (
    <div className="wait-strip">
      <span className="wait-glass" aria-hidden>
        ⌛
      </span>
      {/* Polite, and only the place is spoken: the countdown is hidden. */}
      <span role="status" aria-live="polite">
        {said}
        <span aria-hidden>{eta}</span>
        {tail}
      </span>
      {bar !== null && (
        <span className="wait-bar" aria-hidden>
          <i style={{ width: `${Math.round((bar.done / bar.total) * 100)}%` }} />
        </span>
      )}
    </div>
  );
}

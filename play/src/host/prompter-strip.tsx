// The teleprompter on a host's Show (wave 59): where the scene is, 📜 Join (anyone
// in the scene can drive it, and a host always is), and ▶, which lets every line
// of his left play. Never a word of the script: that is on the prompter.

import { useState } from "react";
import type { PrompterStatus } from "../../../core/src/host-board.ts";
import type { HostCalls } from "./api.ts";
import { prompterLine } from "./show-model.ts";

export function PrompterStrip({ status, calls, onJoin }: { status: PrompterStatus; calls: Pick<HostCalls, "aloud"> | null; onJoin?: () => void }) {
  const [busy, setBusy] = useState(false);
  const free = () => {
    if (calls === null || busy) return;
    setBusy(true);
    void calls.aloud("release").finally(() => setBusy(false));
  };
  return (
    <div className="host-prompter" role="status" data-testid="host-prompter">
      <span className="host-prompter-line">{prompterLine(status)}</span>
      {onJoin !== undefined && (
        <button type="button" className="w95-btn" onClick={onJoin}>
          {/* DRAFT w59 */}
          📜 Join
        </button>
      )}
      {status.held && (
        <button type="button" className="w95-btn" disabled={calls === null || busy} onClick={free} data-testid="host-prompter-release">
          {/* DRAFT w59 */}
          ▶ Let him speak
        </button>
      )}
    </div>
  );
}

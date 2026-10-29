//! The tent's 🆘 Help Me button (wave 44, C9): on every step of the flow
//! for a program being reinstalled. The rules are `help.ts`'s.

import { useEffect, useState } from "react";
import { askForHelp } from "./api.ts";
import type { ReinstallConfig } from "./config.ts";
import { HELP_IDLE, helpAnswered, helpAt, helpFace, type HelpState } from "./help.ts";

/** The press and its rest, shared by the flow's steps (one per flow). */
export function useHelpMe(config: ReinstallConfig, guest: string): { state: HelpState; press: () => void } {
  const [state, setState] = useState<HelpState>(HELP_IDLE);
  useEffect(() => {
    if (state.kind !== "sent" && state.kind !== "failed") return;
    const t = window.setTimeout(() => setState((s) => helpAt(s, Date.now())), Math.max(0, state.until - Date.now()));
    return () => window.clearTimeout(t);
  }, [state]);
  const press = () => {
    if (state.kind === "sending" || state.kind === "sent") return;
    setState({ kind: "sending" });
    void askForHelp(config, guest).then((outcome) => setState(helpAnswered(outcome, Date.now())));
  };
  return { state, press };
}

/** `corner`: fixed over the wizard and the video; `hud`: in the game's top-right row. */
export function HelpMeButton({ help, place }: { help: { state: HelpState; press: () => void }; place: "corner" | "hud" }) {
  const face = helpFace(help.state);
  return (
    <div className={`help-me help-me-${place}`}>
      <button type="button" className="w98-button help-me-button" onClick={help.press} disabled={face.disabled} aria-label="Help me: call a host to the tent">
        {face.label}
      </button>
      {face.note !== null && (
        <div className="help-me-note w98-raised" role="status">
          {face.note}
        </div>
      )}
    </div>
  );
}

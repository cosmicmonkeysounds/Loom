//! The cutscene — the app on rails. While the story has a guest standing in
//! a `cutscene: true` location (the Mud Room login of *Trapped in the
//! Internet*), there is no sidebar, no rooms, no HUD to be overwhelmed by:
//! one dark stage carrying exactly what is said *to them*, in order, with
//! the story's cards (a CAPTCHA) and their decision docked underneath.
//!
//! When the story moves them on, the stage does not vanish mid-line: a
//! Continue button appears and the guest steps into the app themselves.

import type { ReactNode } from "react";
import { AlertBanner, DecisionTray, MessageList, type WidgetHook } from "./chat.tsx";
import type { Alert } from "./session.ts";
import type { ChatMessage, Decision } from "./types.ts";

export function CutsceneStage({
  messages,
  title,
  where,
  decision,
  widgets,
  over,
  onContinue,
  onPass,
  alert,
  onDismissAlert,
}: {
  /** What has been said to this guest, oldest first (`personalStream`). */
  messages: ChatMessage[];
  /** The story's title (the top-right caption). */
  title: string | null | undefined;
  /** The cutscene location's label (the top-left caption). */
  where: string | null;
  /** Their pending decision, if any — docked under the stream. */
  decision: Decision | null;
  widgets: WidgetHook;
  /** The story has moved them out: offer the way into the app. */
  over: boolean;
  onContinue: () => void;
  /** Open the guest's pass (the QR) — the one thing a performer may need
   *  from them while the app is on rails. */
  onPass: () => void;
  alert: Alert | null;
  onDismissAlert: () => void;
}) {
  const banner: ReactNode = alert ? <AlertBanner text={alert.text} onDismiss={onDismissAlert} /> : null;
  return (
    <div className="cutscene" role="region" aria-label={where ?? "Story"}>
      {banner}
      <header className="cut-head">
        <span className="cut-where">{where ?? ""}</span>
        <span className="cut-title">{title ?? ""}</span>
        <button type="button" className="cut-pass" onClick={onPass} title="Your pass">
          🎟️ My pass
        </button>
      </header>
      <MessageList messages={messages} widgets={widgets} empty="Stand by." />
      <footer className="cut-foot">
        {decision && <DecisionTray decision={decision} />}
        {over && (
          <button type="button" className="choice primary cut-go" onClick={onContinue}>
            Continue ▸
          </button>
        )}
        {!over && !decision && (
          <span className="cut-cursor" aria-hidden>
            ▮
          </span>
        )}
      </footer>
    </div>
  );
}

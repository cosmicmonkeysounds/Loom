//! The cutscene — the app on rails. While the story has a guest standing in
//! a `cutscene: true` location (the Optical Drive login of *Trapped in the
//! Internet*), there is no sidebar, no rooms, no HUD to be overwhelmed by:
//! one dark stage carrying exactly what is said *to them*, in order, with
//! the story's cards (a CAPTCHA) and their decision docked underneath.
//!
//! When the story moves them on, the stage does not vanish mid-line: a
//! Continue button appears and the guest steps into the app themselves.

import { useEffect } from "react";
import { PERSONAL_STREAM } from "./crawl.ts";
import { usePlayHost } from "./host.ts";
import type { WidgetHook } from "./stream/bubble.tsx";
import { DecisionTray, useDockReady } from "./stream/channel-view.tsx";
import { MessageList } from "./stream/list.tsx";
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
  offline = false,
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
  /** The stream has been down a while (`useOfflineFor`): say so, since the
   *  stage has no header dot. */
  offline?: boolean;
}) {
  // The stage is open on everything said to this guest: those lines crawl
  // as they land (wave 13: decided at arrival, `crawl.ts`).
  const host = usePlayHost();
  useEffect(() => {
    host.crawl.setOpen(PERSONAL_STREAM);
    return () => host.crawl.setOpen(null);
  }, [host]);
  // The decision docks once its question has crawled in (never under it).
  const dockReady = useDockReady(PERSONAL_STREAM, messages, decision !== null);
  // The alert banner sits above the stage (the app's moments layer, wave 13).
  return (
    <div className="cutscene" role="region" aria-label={where ?? "Story"}>
      <header className="cut-head">
        <span className="cut-where">{where ?? ""}</span>
        <span className="cut-title">{title ?? ""}</span>
        <button type="button" className="cut-pass" onClick={onPass} title="Your pass — hold it up to be scanned">
          <span aria-hidden>🎟️</span> My pass
        </button>
      </header>
      {offline && (
        <div className="cut-offline" role="status">
          reconnecting…
        </div>
      )}
      <MessageList messages={messages} widgets={widgets} empty="Stand by." flushId={PERSONAL_STREAM} />
      <footer className="cut-foot">
        {decision && dockReady && <DecisionTray decision={decision} />}
        {over && (
          <button type="button" className="choice primary cut-go" onClick={onContinue}>
            Continue ▸
          </button>
        )}
        {!over && !(decision && dockReady) && (
          <span className="cut-cursor" aria-hidden>
            ▮
          </span>
        )}
      </footer>
    </div>
  );
}

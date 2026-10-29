//! The cutscene — the app on rails. While the story has a guest standing in
//! a `cutscene: true` location (the Optical Drive login of *Trapped in the
//! Internet*), there is no sidebar, no rooms, no HUD to be overwhelmed by:
//! one dark stage carrying exactly what is said *to them*, in order, with
//! the story's cards (a CAPTCHA) and their decision docked underneath.
//!
//! When the story moves them on, the stage does not vanish mid-line: a
//! Continue button appears and the guest steps into the app themselves.

import { useEffect, useRef } from "react";
import { PERSONAL_STREAM } from "./crawl.ts";
import { usePlayHost } from "./host.ts";
import type { WidgetHook } from "./stream/bubble.tsx";
import { DecisionTray, useDockReady } from "./stream/channel-view.tsx";
import { MessageList } from "./stream/list.tsx";
import type { ChatMessage, Decision } from "./types.ts";

/** Typed chat in a room (not a DM): another guest talking where you stand. */
function roomChatter(m: ChatMessage): boolean {
  return m.kind === "line" && (m.beat === undefined || m.beat === null || m.beat === "") && m.channelKind !== "dm";
}

/** A scripted line said to you in a DM thread (the clearance hand-off). */
function storyToYou(m: ChatMessage): boolean {
  return (m.kind === "line" || m.kind === "narration") && m.beat !== undefined && m.beat !== null && m.beat !== "" && m.channelKind === "dm";
}

/** Cards that belong to the app, never the stage: a 📝 fact or a 💬 answer
 *  card needs the rooms (a late arrival cleared mid-hunt is dealt one in the
 *  same moment the story moves them on). They wait in their rooms' trays.
 *  Wave 41: a card the story deals `with stage: true` (the upload form's
 *  write-in, which the upload waits on) is the stage's after all. */
const APP_CARDS: ReadonlySet<string> = new Set(["fact", "answer"]);
const appCard = (m: ChatMessage): boolean => m.widget !== undefined && APP_CARDS.has(m.widget.kind) && m.widget.params["stage"] !== "true";

/**
 * What the stage shows, from what was said to the guest (`personalStream`,
 * pure — `test/cutscene-stage.test.ts`): never other people's typed chat in
 * a room (an arrival standing in the Optical Drive, or a cleared guest whose
 * new room is the Desktop, gets only their own lines). Once the story has
 * moved them on (`freeze`: the newest seq when it did), only the story's
 * lines to them still land — the hand-off — and every card waits behind
 * Continue, in its room.
 */
export function stageMessages(personal: readonly ChatMessage[], freeze: number | null): ChatMessage[] {
  return personal.filter((m) => !roomChatter(m) && !appCard(m) && (freeze === null || m.seq <= freeze || storyToYou(m)));
}

/** The seq the stage froze at: the newest one on it when the story moved the guest on (null while on rails). */
export function useStageFreeze(over: boolean, messages: readonly ChatMessage[]): number | null {
  const at = useRef<number | null>(null);
  if (!over) at.current = null;
  else if (at.current === null) at.current = messages.length > 0 ? messages[messages.length - 1]!.seq : -1;
  return at.current;
}

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
  // as they land (wave 13: decided at arrival, `crawl.ts`). Never anyone
  // else's typed chat; once moved on, only the story's hand-off to them.
  const freeze = useStageFreeze(over, messages);
  messages = stageMessages(messages, freeze);
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

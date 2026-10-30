// The cutscene — the app on rails. While the story has a guest standing in
// a `cutscene: true` location (the Optical Drive login of *Trapped in the
// Internet*), there is no sidebar, no rooms, no HUD to be overwhelmed by:
// one dark stage carrying exactly what is said *to them*, in order, with
// the story's cards (a CAPTCHA) and their decision docked underneath.
//
// When the story moves them on, the stage does not vanish mid-line: a
// Continue button appears and the guest steps into the app themselves.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PERSONAL_STREAM } from "./crawl.ts";
import { usePlayHost } from "./host.ts";
import { useNowMoment } from "./moments/provider.tsx";
import { StreamModeProvider, type StreamMode, type WidgetHook } from "./stream/bubble.tsx";
import { CardTray } from "./stream/card-tray.tsx";
import { DecisionTray, useDockReady } from "./stream/channel-view.tsx";
import { MessageList } from "./stream/list.tsx";
import { trayCards } from "./stream/settled.ts";
import type { ChatMessage, Decision } from "./types.ts";
import { supersededCards } from "./widgets.tsx";

/** Wave 47: the cards that stay whole on the stage — the CAPTCHA is the
 *  scene itself. Every other card the upload asks (the write-ins, the video
 *  question, the inbox) docks in the stage's tray, one at a time, so the
 *  conversation that asks them always keeps the screen. */
const STAGE_INLINE: ReadonlySet<string> = new Set(["captcha"]);

/** The live cards the stage docks under the stream, oldest first (pure). */
export function stageTray(messages: readonly ChatMessage[], answered: WidgetHook["answered"]): ChatMessage[] {
  return trayCards(messages, answered, supersededCards(messages)).filter((m) => !STAGE_INLINE.has(m.widget!.kind));
}

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
  corner,
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
   *  from them while the app is on rails. A booth (wave 53) has no pass. */
  onPass?: () => void;
  /** Wave 53: what stands where My pass does when there is none. */
  corner?: ReactNode;
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
  // Wave 47: the cards waiting on the guest dock under the stream, one at a
  // time and oldest first, leaving a one-line receipt where they were dealt.
  const cards = useMemo(() => stageTray(messages, widgets.answered), [messages, widgets.answered]);
  const [trayFocus, setTrayFocus] = useState<number | null>(null);
  const mode = useMemo<StreamMode>(() => ({ tray: true, settlePass: false, openTray: setTrayFocus, inline: STAGE_INLINE }), []);
  // The decision docks once its question has crawled in (never under it);
  // so does a card.
  const dockReady = useDockReady(PERSONAL_STREAM, messages, decision !== null || cards.length > 0);
  // Wave 47: the loud "show your pass" objective is the stage's own My pass
  // button lit up — never a banner over the stage saying what its pass card
  // and that button already say.
  const now = useNowMoment();
  const passLit = now.moment !== null && now.moment.pass === true;
  const openPass = () => {
    if (passLit) now.seen(true);
    onPass?.();
  };
  return (
    <div className="cutscene" role="region" aria-label={where ?? "Story"}>
      <header className="cut-head">
        <span className="cut-where">{where ?? ""}</span>
        <span className="cut-title">{title ?? ""}</span>
        {onPass !== undefined && (
          <button type="button" className={`cut-pass${passLit ? " lit" : ""}`} onClick={openPass} title="Your pass — hold it up to be scanned">
            <span aria-hidden>🎟️</span> My pass
          </button>
        )}
        {corner}
      </header>
      {offline && (
        <div className="cut-offline" role="status">
          reconnecting…
        </div>
      )}
      <StreamModeProvider value={mode}>
        <MessageList messages={messages} widgets={widgets} empty="Stand by." flushId={PERSONAL_STREAM} />
      </StreamModeProvider>
      <footer className="cut-foot">
        {decision && dockReady && <DecisionTray decision={decision} />}
        {cards.length > 0 && dockReady && (
          <CardTray cards={cards} widgets={widgets} focus={trayFocus} onFocus={setTrayFocus} crowded={decision !== null} lead="oldest" />
        )}
        {over && (
          <button type="button" className="choice primary cut-go" onClick={onContinue}>
            Continue ▸
          </button>
        )}
        {!over && !((decision !== null || cards.length > 0) && dockReady) && (
          <span className="cut-cursor" aria-hidden>
            ▮
          </span>
        )}
      </footer>
    </div>
  );
}

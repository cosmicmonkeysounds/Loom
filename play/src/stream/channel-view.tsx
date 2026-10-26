//! One open room (moved out of `chat.tsx` in wave 13): the decision tray,
//! the who's-here strip, the room view and the thread panel.

import { Icon } from "../chrome/icons.tsx";
import { Fragment, Suspense, type ComponentType, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { usePlayHost, type Crawl } from "../host.ts";
import { isTextEntry } from "../chrome/keyboard.ts";
import { PinnedRail } from "../moments/pins-rail.tsx";
import type { Channel, ChatMessage, Decision } from "../types.ts";
import { Avatar } from "../ui/primitives.tsx";
import { supersededCards } from "../widgets.tsx";
import { MessageBubble, MessageGroup, StreamModeProvider, type ModerateHook, type StreamMode, type WidgetHook } from "./bubble.tsx";
import { CardTray } from "./card-tray.tsx";
import { ChunkBoundary, retryableLazy } from "../lazy-chunk.tsx";
import { trayCards } from "./settled.ts";
import { AmbientTicker } from "./ticker.tsx";
import { Composer, cantPostNote } from "./composer.tsx";
import { MessageList, useStickToBottom } from "./list.tsx";
import { groupRuns, questStatusOf, repliesFor } from "./runs.ts";

/** The Codex and the Quest Log load on their own (fix round: they kept the
 *  guest's first load over its gate, and most phones open them later). */
type CodexProps = { messages: readonly ChatMessage[]; meId?: string | null; empty: string; focusEntry?: string | null };
type QuestProps = { messages: readonly ChatMessage[]; empty: string };
const LazyCodex = retryableLazy<CodexProps>(() => import("./codex-room.tsx").then((m): { default: ComponentType<CodexProps> } => ({ default: m.CodexRoom })));
const LazyQuests = retryableLazy<QuestProps>(() => import("./codex-room.tsx").then((m): { default: ComponentType<QuestProps> } => ({ default: m.QuestRoom })));

function PinnedRoom({ kind, messages, meId, empty, focusEntry }: { kind: "codex" | "quests"; messages: readonly ChatMessage[]; meId: string | null; empty: string; focusEntry: string | null }) {
  const Codex = LazyCodex.current();
  const Quests = LazyQuests.current();
  return (
    <ChunkBoundary
      fallback={(retry) => (
        <p className="booth-none">
          That didn&apos;t load.{" "}
          <button
            type="button"
            className="w95-btn"
            onClick={() => {
              LazyCodex.again();
              LazyQuests.again();
              retry();
            }}
          >
            Try again
          </button>
        </p>
      )}
    >
      <Suspense fallback={<p className="booth-none">Opening…</p>}>{kind === "codex" ? <Codex messages={messages} meId={meId} empty={empty} focusEntry={focusEntry} /> : <Quests messages={messages} empty={empty} />}</Suspense>
    </ChunkBoundary>
  );
}

// --- holding the dock until its question has crawled ------------------------

/** The newest messages a room checks for a line still crawling. */
const DOCK_LOOKBACK = 40;
/** A dock never waits longer than this: the room is flushed (fx cap + budget). */
export const DOCK_HOLD_MAX_MS = 4000;

/** Is any of the room's newest lines still owed its crawl? */
export function stillCrawling(crawl: Pick<Crawl, "tierOf">, messages: readonly ChatMessage[]): boolean {
  for (let i = messages.length - 1, n = 0; i >= 0 && n < DOCK_LOOKBACK; i--, n++) {
    if (crawl.tierOf(messages[i]!.seq) !== "none") return true;
  }
  return false;
}

/**
 * Whether a docked decision (or anything that answers the room's last line)
 * may show yet: not while a line above it is still crawling in — the
 * question would sit under its own answers, unread. A tap on the stream
 * shows it at once; after `DOCK_HOLD_MAX_MS` the room is flushed anyway.
 */
export function useDockReady(roomId: string, messages: readonly ChatMessage[], waiting: boolean): boolean {
  const crawl = usePlayHost().crawl;
  const [crawling, setCrawling] = useState(() => waiting && stillCrawling(crawl, messages));
  useEffect(() => {
    if (!waiting) {
      setCrawling(false);
      return;
    }
    setCrawling(stillCrawling(crawl, messages));
    return crawl.subscribe(() => setCrawling(stillCrawling(crawl, messages)));
  }, [crawl, messages, waiting]);
  useEffect(() => {
    if (!waiting || !crawling) return;
    const id = window.setTimeout(() => crawl.flush(roomId), DOCK_HOLD_MAX_MS);
    return () => window.clearTimeout(id);
  }, [crawl, roomId, waiting, crawling]);
  return !crawling;
}

// --- decision tray (quick-reply buttons) ------------------------------------

/**
 * The decision box — a video-game dialogue chooser. Options are numbered and
 * driven like an RPG menu: ↑/↓ (or the number keys) move a ▶ selection caret,
 * Enter confirms. Hover / focus still work for touch + mouse. The keyboard
 * handler steps aside while a text field is focused so typing never triggers a
 * choice.
 */
export function DecisionTray({ decision, folded = false, onUnfold }: { decision: Decision; folded?: boolean; onUnfold?: () => void }) {
  const host = usePlayHost();
  const [cursor, setCursor] = useState(0);
  const n = decision.options.length;
  // A fresh prompt resets the caret to the top option.
  useEffect(() => setCursor(0), [decision.title, n]);
  const pick = (i: number) => decision.options[i]?.onClick();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (folded) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return; // don't hijack the composer / a widget
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        setCursor((c) => (c + 1) % n);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        setCursor((c) => (c - 1 + n) % n);
      } else if (e.key === "Enter") {
        e.preventDefault();
        pick(cursor);
      } else if (/^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (i < n) {
          e.preventDefault();
          pick(i);
        }
      }
    };
    // Page-wide on a phone; scoped to its own pane when embedded, so a key
    // pressed over one participant never answers for another.
    const target = host.keyTarget();
    target?.addEventListener("keydown", onKey as EventListener);
    return () => target?.removeEventListener("keydown", onKey as EventListener);
  }, [cursor, n, decision, host, folded]);
  // Wave 26 (P1): folded, the menu is one loud 48 px bar; a tap opens it.
  if (folded)
    return (
      <button type="button" className="tray dialogue dlg-folded" aria-expanded={false} onClick={onUnfold}>
        {/* DRAFT w26 (P1): UI copy */}▴ Your move: {decision.title}
      </button>
    );
  return (
    <div className="tray dialogue" role="menu" aria-label={decision.title}>
      <div className="tray-title">{decision.title}</div>
      <div className="dlg-options">
        {decision.options.map((o, i) => (
          <button
            key={i}
            role="menuitem"
            className={`dlg-choice ${o.tone ?? "primary"} ${i === cursor ? "on" : ""}`}
            onMouseEnter={() => setCursor(i)}
            onFocus={() => setCursor(i)}
            onClick={o.onClick}
          >
            <span className="dlg-caret" aria-hidden>
              ▶
            </span>
            <span className="dlg-key" aria-hidden>
              {i + 1}
            </span>
            <span className="dlg-label">{o.label}</span>
          </button>
        ))}
      </div>
      {n > 1 && <div className="dlg-hint">↑↓ select · enter confirm · 1–{n} quick-pick</div>}
    </div>
  );
}

/** Who's here, in a room's menu row: "👥 4" (· you), tap for the list. */
export function PresenceStrip({ people, meId, onOpen }: { people: Channel["people"]; meId: string | null; onOpen: () => void }) {
  const list = people ?? [];
  const here = list.some((p) => p.id === meId);
  return (
    <button
      type="button"
      className="presence stream-presence"
      onClick={onOpen}
      title="Who's here"
      aria-label={`${list.length} here${here ? ", you included" : ""} — see who`}
    >
      <span className="presence-n">
        <span aria-hidden>
          <Icon name="people" className="ico-inline" />{" "}
        </span>
        {list.length}
        {here ? " · you" : ""}
      </span>
    </button>
  );
}

/** Wave 26 (P1): one way to answer at a time. A docked story menu opens and
 *  the composer folds to its button; typing folds the menu instead; an open
 *  card folds the menu (and the composer to its button). */
export function footLayout(o: { decision: boolean; trayOpen: boolean; typing: boolean; composer: boolean }): { decision: "open" | "folded" | null; composer: "open" | "button" | null } {
  return {
    decision: !o.decision ? null : o.typing || o.trayOpen ? "folded" : "open",
    composer: !o.composer ? null : !o.decision || o.typing ? "open" : "button",
  };
}

/** Wave 26 (P1): a line that went through is spent. The composer clears its
 *  own box once the send resolves, but a menu docking mid-send folds (and
 *  unmounts) it first: the room's draft must not keep the sent line, or the
 *  folded bar would offer it again. Words typed since are kept. */
export function spendDraft(d: { text: string }, sent: string): void {
  if (d.text.trim() === sent.trim()) d.text = "";
}

/** The parts a room's footer may hold, top to bottom. */
export interface StreamFootParts {
  tray: ReactElement | null;
  decision: ReactElement | null;
  footer: ReactNode;
  composer: ReactElement | null;
  cantPost: ReactElement | null;
}

/**
 * A room's footer, as keyed siblings (pure — `test/stream-view.test.tsx`).
 * Every part's key names its part *and* the room: a room change remounts the
 * tray and the composer (a draft never follows the guest), and no two parts
 * ever share a key — when the card tray emptied beside a composer keyed by
 * the same id, React lost the tray's fiber and left the answered card up.
 */
export function streamFoot(roomId: string, parts: StreamFootParts): ReactElement[] {
  const out: ReactElement[] = [];
  const add = (part: keyof StreamFootParts, el: ReactNode) => {
    if (el === null || el === undefined || el === false) return;
    out.push(<Fragment key={`${part}:${roomId}`}>{el}</Fragment>);
  };
  add("tray", parts.tray);
  add("decision", parts.decision);
  add("footer", parts.footer);
  add("composer", parts.composer);
  add("cantPost", parts.cantPost);
  return out;
}

/**
 * One open conversation: a header (back on phones, the room, who's here),
 * the message stream, and a caller-supplied footer (a decision tray, a
 * scanner, moderation actions…).
 */
export function ChannelView({
  channel,
  onBack,
  footer,
  pins,
  moderate,
  showChannel,
  onSend,
  onOpenThread,
  widgets,
  meId,
  onPeople,
  onPerson,
  headerActions,
  wide,
  strip,
  composerExtra,
  focusCard,
  focusEntry,
}: {
  /** Open the card tray on this card (wave 18: a Your move row, an Answer exit). */
  focusCard?: number | null;
  /** Open the Codex on this entry (wave 18: a `codex: <Entry>` exit). */
  focusEntry?: string | null;
  channel: Channel;
  onBack: () => void;
  footer?: ReactNode;
  /** A bar right under the header (the guest's countdown strip). */
  strip?: ReactNode;
  /** A button docked in the composer (the Codex's 📷 Scan). */
  composerExtra?: ReactNode;
  moderate?: ModerateHook;
  showChannel?: boolean;
  /** Hybrid chat: when present, a composer docks below the footer. Return
   *  the send's promise so a refused message stays in the box. */
  onSend?: (text: string, parentSeq?: number) => unknown;
  /** When present, line messages expose a Slack-style "reply" affordance. */
  onOpenThread?: (rootSeq: number) => void;
  widgets?: WidgetHook;
  meId?: string | null;
  /** Open the room's people list. */
  onPeople?: () => void;
  /** Tapping a sender (a performer opens the guest's card). */
  onPerson?: (name: string) => void;
  /** Small buttons on the right of the header (scan, invite, …). */
  headerActions?: ReactNode;
  /** Wide layout: no back button (the sidebar is beside us). */
  wide?: boolean;
  /** Sticky notices to show above the stream (`activePins`). */
  pins?: ChatMessage[];
}) {
  // The room on screen, for the crawl's arrival rule (wave 13 seam).
  const host = usePlayHost();
  useEffect(() => {
    host.crawl.setOpen(channel.id);
    return () => host.crawl.setOpen(null);
  }, [host, channel.id]);
  // Channel-type rules: a read-only channel hides the composer; a
  // non-threadable channel hides the reply affordance. (Derived channels omit
  // both flags → open + threadable.)
  const canPost = channel.canPost !== false;
  const threadable = channel.threadable !== false;
  const people = channel.people ?? [];
  // Live cards waiting on the viewer dock in the tray (a receipt stays in
  // the stream); a booth reading a guest's thread has no widgets → none.
  const [trayFocus, setTrayFocus] = useState<number | null>(focusCard ?? null);
  useEffect(() => setTrayFocus(focusCard ?? null), [channel.id, focusCard]);
  // Typing in the composer folds the tray, so the replies keep the room
  // (a phone keyboard leaves little else).
  const [composing, setComposing] = useState(false);
  const isComposer = (t: EventTarget | null) => t instanceof Element && t.classList.contains("composer-input");
  // Typing in a card's own box (a fact's answer, a 💬 answer): with the
  // keyboard up (the frame's \`.kbd\`) the room's composer steps aside, so the
  // card keeps its box, its slider and its button above the keyboard.
  const [cardTyping, setCardTyping] = useState(false);
  const inTrayField = (t: EventTarget | null) => t instanceof Element && isTextEntry(t) && t.closest(".stream-tray") !== null;
  const pressing = useRef(false);
  // On the next tick, after the tap's own handler: still typing in the card?
  const settleCardTyping = (foot: HTMLElement) =>
    window.setTimeout(() => {
      const root = foot.getRootNode() as Document | ShadowRoot;
      setCardTyping(inTrayField(root.activeElement ?? document.activeElement));
    }, 0);
  const tray = useMemo(() => {
    if (!widgets || channel.kind === "codex" || channel.kind === "quests" || channel.kind === "wallet") return [];
    const roots = channel.messages.filter((m) => m.parentSeq == null);
    return trayCards(roots, widgets.answered, supersededCards(roots));
  }, [channel.messages, channel.kind, widgets]);
  const mode = useMemo<StreamMode>(() => ({ tray: widgets !== undefined, settlePass: true, openTray: setTrayFocus }), [widgets]);
  const dockReady = useDockReady(channel.id, channel.messages, channel.decision !== null);
  // Wave 26 (P1): which answer surface is open (`footLayout`), and the
  // composer's draft, kept while it folds to its button (per room).
  const [typing, setTyping] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [shut, setShut] = useState(0);
  const draft = useRef({ room: channel.id, text: "" });
  if (draft.current.room !== channel.id) draft.current = { room: channel.id, text: "" };
  const onText = useCallback((text: string) => {
    draft.current.text = text;
  }, []);
  const dk = channel.decision;
  useEffect(() => setTyping(false), [channel.id, dk?.title, dk?.options.length]);
  const isRoom = channel.kind !== "dm" && channel.kind !== "guest" && channel.kind !== "codex" && channel.kind !== "quests" && channel.kind !== "wallet";
  const emptyCopy =
    channel.kind === "codex"
      ? "You know nothing yet. Codes are on the walls, in the puzzles, and in people — type one below."
      : channel.kind === "quests"
        ? "No quests yet. When the story hands you one, it lands here — each in its own thread."
        : channel.kind === "wallet"
          ? "Nothing has moved yet. Every transfer, request and trade lands here — each in its own thread."
        : channel.kind === "location"
      ? channel.here
        ? "You're here. Nothing has happened in this room yet."
        : "Nothing has happened here yet. You'd hear it if you were standing here."
      : channel.kind === "dm"
        ? `No messages with ${channel.title} yet.`
        : "Nothing here yet.";
  // The footer's parts, each under its own key (`streamFoot`): the tray and
  // the composer once shared the room's id as a key, and React then left a
  // dead copy of an answered card on screen.
  const docked = dk != null && dockReady;
  // Focus already in the box (a menu docking mid-line) counts as typing: the box never folds under the thumb.
  const lay = footLayout({ decision: docked, trayOpen: trayOpen && tray.length > 0, typing: typing || composing, composer: onSend !== undefined && canPost });
  const hint = channel.kind === "codex" ? "Enter a code…" : `Message ${channel.title}…`;
  const foot = streamFoot(channel.id, {
    tray: tray.length > 0 && widgets ? <CardTray cards={tray} widgets={widgets} focus={trayFocus} onFocus={setTrayFocus} composing={composing} crowded={dk != null} shut={shut} onOpenChange={setTrayOpen} /> : null,
    decision: docked && dk != null ? (
      <DecisionTray
        decision={dk}
        folded={lay.decision === "folded"}
        onUnfold={() => {
          setTyping(false);
          setShut((n) => n + 1);
        }}
      />
    ) : null,
    footer: footer ?? null,
    // Keyed by room: a draft (or a refused line coming back) stays in its
    // own room, never follows the guest into the next one. Folded (a menu
    // docked), the composer is one 48 px button; its tap opens the box with
    // the keyboard, the draft still in it.
    composer:
      lay.composer === "button" ? (
        <div className="composer composer-folded">
          <button type="button" className="choice composer-open" onClick={() => flushSync(() => setTyping(true))}>
            {/* DRAFT w26 (P1): UI copy */}⌨ {draft.current.text.trim() !== "" ? draft.current.text : hint}
          </button>
        </div>
      ) : lay.composer === "open" && onSend ? (
        <Composer
          onSend={(t) => {
            const d = draft.current;
            const r = onSend(t);
            void Promise.resolve(r).then(() => spendDraft(d, t), () => {});
            return r;
          }}
          placeholder={hint} sendLabel={channel.kind === "codex" ? "Unlock" : undefined} extra={composerExtra} initial={draft.current.text} onText={onText} autoFocus={typing} />
      ) : null,
    cantPost: onSend && !canPost ? <div className="cant-post">{cantPostNote(channel)}</div> : null,
  });
  return (
    <div className="screen stage stream-room">
      <header className="thread-head stream-room-head">
        {!wide && (
          <button type="button" className="back stream-back" onClick={onBack} aria-label="Back">
            ‹
          </button>
        )}
        <Avatar channel={channel} />
        <div className="thread-id stream-room-id">
          <strong className="stream-room-title">{channel.title}</strong>
          {(channel.here || channel.subtitle) && (
            <span className="stream-room-sub">
              {channel.here && <span className="here-tag">you are here</span>}
              {channel.subtitle}
            </span>
          )}
        </div>
        <div className="head-right">
          {headerActions}
          {isRoom && onPeople && <PresenceStrip people={people} meId={meId ?? null} onOpen={onPeople} />}
        </div>
      </header>
      {strip}
      {pins && pins.length > 0 && <PinnedRail pins={pins} />}
      <AmbientTicker messages={channel.messages} />
      {channel.kind === "codex" || channel.kind === "quests" ? (
        <PinnedRoom key={channel.id} kind={channel.kind} messages={channel.messages} meId={meId ?? null} empty={emptyCopy} focusEntry={focusEntry ?? null} />
      ) : (
        <StreamModeProvider value={mode}>
          <MessageList
            key={channel.id}
            messages={channel.messages}
            showChannel={showChannel}
            moderate={moderate}
            onOpenThread={threadable ? onOpenThread : undefined}
            widgets={widgets}
            onPerson={onPerson}
            empty={emptyCopy}
            flushId={channel.id}
          />
        </StreamModeProvider>
      )}
      {channel.typing && (
        <div className="typing-note" aria-live="polite">
          {channel.typing} is typing<span className="dots" />
        </div>
      )}
      {foot.length > 0 && (
        <footer
          className={`stream-foot${cardTyping ? " card-typing" : ""}`}
          onFocus={(e) => {
            if (isComposer(e.target)) setComposing(true);
            if (inTrayField(e.target)) setCardTyping(true);
          }}
          onBlur={(e) => {
            if (isComposer(e.target)) {
              setComposing(false);
              // An empty box let go of: the menu comes back.
              if ((e.target as HTMLTextAreaElement).value.trim() === "") setTyping(false);
            }
            // A tap on File it / Say it moves focus off the box first (iOS
            // focuses no button): hold until that tap has landed, so the
            // composer never comes back under the finger (the keyboard rule).
            if (inTrayField(e.target) && !pressing.current) settleCardTyping(e.currentTarget);
          }}
          onPointerDown={() => {
            pressing.current = true;
          }}
          onPointerUp={(e) => {
            const foot = e.currentTarget;
            window.setTimeout(() => pressing.current && ((pressing.current = false), settleCardTyping(foot)), 600);
          }}
          onClick={(e) => {
            pressing.current = false;
            settleCardTyping(e.currentTarget);
          }}
        >
          {foot}
        </footer>
      )}
    </div>
  );
}

/**
 * A Slack-style thread panel: the root message pinned at the top, its replies
 * below, and a reply composer. `rootSeq` is the message the thread hangs from.
 */
export function MessageThread({
  channel,
  rootSeq,
  onClose,
  moderate,
  onSend,
}: {
  channel: Channel;
  rootSeq: number;
  onClose: () => void;
  moderate?: ModerateHook;
  onSend?: (text: string, parentSeq?: number) => unknown;
}) {
  const box = useStickToBottom<HTMLDivElement>();
  const root = channel.messages.find((m) => m.seq === rootSeq);
  const replies = repliesFor(channel.messages, rootSeq);
  const quest = root?.quest;
  return (
    <div className="screen stage">
      <header className="thread-head stream-room-head">
        <button type="button" className="back stream-back" onClick={onClose} aria-label="Back to the room">
          ‹
        </button>
        <div className="avatar dm" aria-hidden>
          <Icon name={quest ? "quest" : "reply"} size={20} />
        </div>
        <div className="thread-id stream-room-id">
          <strong className="stream-room-title">{quest ? quest.title : "Thread"}</strong>
          <span className="stream-room-sub">in {channel.title}</span>
        </div>
      </header>
      <div className="thread" ref={box}>
        {root && <MessageBubble msg={root} moderate={moderate} questStatus={quest ? questStatusOf(channel.messages, rootSeq) : undefined} />}
        <div className="thread-divider">
          {quest
            ? replies.length === 0
              ? "No progress yet"
              : `${replies.length} ${replies.length === 1 ? "update" : "updates"}`
            : `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}
        </div>
        {groupRuns(replies).map((run) => (
          <MessageGroup key={run.messages[0]!.seq} run={run} allMessages={channel.messages} moderate={moderate} />
        ))}
      </div>
      {onSend && channel.canPost !== false && (
        <footer className="stream-foot">
          <Composer key={`${channel.id}#${rootSeq}`} onSend={(t) => onSend(t, rootSeq)} placeholder="Reply…" />
        </footer>
      )}
    </div>
  );
}

//! One open room (moved out of `chat.tsx` in wave 13): the decision tray,
//! the who's-here strip, the room view and the thread panel.

import { useEffect, useState, type ReactNode } from "react";
import { usePlayHost } from "../host.ts";
import { PinnedRail } from "../moments/pins-rail.tsx";
import type { Channel, ChatMessage, Decision } from "../types.ts";
import { Avatar, PersonAvatar } from "../ui/primitives.tsx";
import { MessageBubble, MessageGroup, type ModerateHook, type WidgetHook } from "./bubble.tsx";
import { Composer, cantPostNote } from "./composer.tsx";
import { MessageList, useStickToBottom } from "./list.tsx";
import { groupRuns, questStatusOf, repliesFor } from "./runs.ts";

// --- decision tray (quick-reply buttons) ------------------------------------

/**
 * The decision box — a video-game dialogue chooser. Options are numbered and
 * driven like an RPG menu: ↑/↓ (or the number keys) move a ▶ selection caret,
 * Enter confirms. Hover / focus still work for touch + mouse. The keyboard
 * handler steps aside while a text field is focused so typing never triggers a
 * choice.
 */
export function DecisionTray({ decision }: { decision: Decision }) {
  const host = usePlayHost();
  const [cursor, setCursor] = useState(0);
  const n = decision.options.length;
  // A fresh prompt resets the caret to the top option.
  useEffect(() => setCursor(0), [decision.title, n]);
  const pick = (i: number) => decision.options[i]?.onClick();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
  }, [cursor, n, decision, host]);
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

/** The "who's here" strip in a room header: a few avatar tiles + a count. */
export function PresenceStrip({ people, meId, onOpen }: { people: Channel["people"]; meId: string | null; onOpen: () => void }) {
  const list = people ?? [];
  const shown = list.slice(0, 4);
  return (
    <button type="button" className="presence" onClick={onOpen} title="Who's here" aria-label={`${list.length} here`}>
      <span className="presence-stack">
        {shown.map((p) => (
          <PersonAvatar key={p.id} name={p.name} size="sm" kind={p.kind} />
        ))}
      </span>
      <span className="presence-n">
        👥 {list.length}
        {list.some((p) => p.id === meId) ? " · you" : ""}
      </span>
    </button>
  );
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
}: {
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
  return (
    <div className="screen stage">
      <header className="thread-head">
        {!wide && (
          <button className="back" onClick={onBack} aria-label="Back">
            ‹
          </button>
        )}
        <Avatar channel={channel} />
        <div className="thread-id">
          <strong>
            {channel.title}
            {channel.here && <span className="here-tag">you are here</span>}
          </strong>
          {channel.subtitle && <span className="muted">{channel.subtitle}</span>}
        </div>
        <div className="head-right">
          {headerActions}
          {isRoom && onPeople && <PresenceStrip people={people} meId={meId ?? null} onOpen={onPeople} />}
        </div>
      </header>
      {strip}
      {pins && pins.length > 0 && <PinnedRail pins={pins} />}
      <MessageList
        key={channel.id}
        messages={channel.messages}
        showChannel={showChannel}
        moderate={moderate}
        onOpenThread={threadable ? onOpenThread : undefined}
        widgets={widgets}
        onPerson={onPerson}
        empty={emptyCopy}
      />
      {channel.typing && (
        <div className="typing-note" aria-live="polite">
          {channel.typing} is typing<span className="dots" />
        </div>
      )}
      {(footer || channel.decision || onSend) && (
        <footer>
          {channel.decision && <DecisionTray decision={channel.decision} />}
          {footer}
          {onSend && canPost && (
            // Keyed by room: a draft (or a refused line coming back) stays
            // in its own room, never follows the guest into the next one.
            <Composer
              key={channel.id}
              onSend={(t) => onSend(t)}
              placeholder={channel.kind === "codex" ? "Enter a code…" : `Message ${channel.title}…`}
              sendLabel={channel.kind === "codex" ? "Unlock" : undefined}
              extra={composerExtra}
            />
          )}
          {onSend && !canPost && (
            <div className="cant-post">
              {cantPostNote(channel)}
            </div>
          )}
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
      <header className="thread-head">
        <button className="back" onClick={onClose} aria-label="Back to the room">
          ‹
        </button>
        <div className="avatar dm">{quest ? "📜" : "💬"}</div>
        <div className="thread-id">
          <strong>{quest ? quest.title : "Thread"}</strong>
          <span className="muted">in {channel.title}</span>
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
        <footer>
          <Composer key={`${channel.id}#${rootSeq}`} onSend={(t) => onSend(t, rootSeq)} placeholder="Reply…" />
        </footer>
      )}
    </div>
  );
}

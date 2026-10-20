//! The message stream (moved out of `chat.tsx` in wave 13): stick to the
//! newest line, roots folded into sender runs, barks out, notice runs
//! folded, tap to finish the crawl.

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { usePlayHost } from "../host.ts";
import type { ChatMessage } from "../types.ts";
import { supersededCards } from "../widgets.tsx";
import { MessageBubble, MessageGroup, type ModerateHook, type WidgetHook } from "./bubble.tsx";
import { noticeSummary, streamItems } from "./notices.ts";
import { rootsOf } from "./runs.ts";

/** How close to the bottom (px) still counts as "reading the newest line". */
export const STICK_SLACK = 80;
/** A scroll this soon after a touch / wheel / key is the reader's own. */
export const USER_SCROLL_MS = 1500;

/** Is a scroll box (scrollTop / scrollHeight / clientHeight) at its bottom,
 *  give or take `slack`? */
export function atBottom(el: { scrollTop: number; scrollHeight: number; clientHeight: number }, slack = STICK_SLACK): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
}

/**
 * Keep a message stream on its newest line, the way every chat app does:
 * while the reader is at (or near) the bottom, anything that makes the
 * stream taller — a line the crawl reveals, a card, the pass, a picture
 * loading — or the box itself shorter (the decision tray docking under it)
 * scrolls it back to the bottom. Scroll up to read the backlog and it
 * leaves you there until you come back down. Returns a callback ref for
 * the scrolling element.
 */
export function useStickToBottom<T extends HTMLElement>(): (el: T | null) => void {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (el === null) return;
    let pinned = true;
    const stick = () => {
      if (pinned) el.scrollTop = el.scrollHeight;
    };
    // Only the reader moves `pinned`: our own jump to the bottom lands
    // inside the slack, and a scroll the browser makes on its own (a tray
    // leaving, a clamp, scroll anchoring) is no reason to stop following —
    // only one that follows a touch, the wheel or a key.
    let touched = Number.NEGATIVE_INFINITY;
    const touch = () => {
      touched = Date.now();
    };
    const onScroll = () => {
      if (atBottom(el)) pinned = true;
      else if (Date.now() - touched < USER_SCROLL_MS) pinned = false;
      else if (pinned) stick();
    };
    for (const ev of ["touchstart", "touchmove", "wheel", "pointerdown", "keydown"]) el.addEventListener(ev, touch, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    // A picture finishing loading grows its message without a mutation.
    el.addEventListener("load", stick, true);
    // Rows grow without a mutation too (a picture decoding — the pass QR
    // came in 200 px short of the bottom): watch every row's size, not
    // only the box's.
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(stick) : null;
    const watchRows = () => {
      if (ro === null) return;
      for (const child of Array.from(el.children)) ro.observe(child);
    };
    const mo =
      typeof MutationObserver === "function"
        ? new MutationObserver(() => {
            watchRows();
            stick();
          })
        : null;
    mo?.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    ro?.observe(el);
    watchRows();
    stick();
    cleanup.current = () => {
      el.removeEventListener("scroll", onScroll);
      for (const ev of ["touchstart", "touchmove", "wheel", "pointerdown", "keydown"]) el.removeEventListener(ev, touch);
      el.removeEventListener("load", stick, true);
      mo?.disconnect();
      ro?.disconnect();
    };
  }, []);
}

/** A run of per-person notices about other people, folded into one line
 *  ("✅ 12 · 🤷 3"); tap to read them. */
function NoticeRun({ messages, moderate }: { messages: ChatMessage[]; moderate?: ModerateHook }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`msg stream-notices ${open ? "open" : ""}`}>
      <button type="button" className="stream-notices-line" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="stream-notices-sum">{noticeSummary(messages)}</span>
        <span className="stream-notices-hint">{open ? "hide" : `${messages.length} updates`}</span>
        <span className="stream-settled-caret" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="stream-notices-body">
          {messages.map((m) => (
            <MessageBubble key={m.seq} msg={m} moderate={moderate} />
          ))}
        </div>
      )}
    </div>
  );
}

export function MessageList({
  messages,
  showChannel,
  moderate,
  onOpenThread,
  widgets,
  onPerson,
  empty,
  flushId,
}: {
  messages: ChatMessage[];
  showChannel?: boolean;
  moderate?: ModerateHook;
  onOpenThread?: (rootSeq: number) => void;
  widgets?: WidgetHook;
  onPerson?: (name: string) => void;
  empty?: ReactNode;
  /** The crawl room a tap finishes (the open room, or the cutscene's
   *  personal stream); absent → every room. */
  flushId?: string;
}) {
  const box = useStickToBottom<HTMLDivElement>();
  const host = usePlayHost();
  // Only top-level messages live in the channel; replies are tucked into their
  // thread panel. Consecutive same-sender lines coalesce into one banner;
  // barks go to the ticker; a run of notices about other people folds.
  const roots = useMemo(() => rootsOf(messages), [messages]);
  const items = useMemo(() => streamItems(roots), [roots]);
  const superseded = useMemo(() => supersededCards(roots), [roots]);
  return (
    // Tap anywhere on the stream to finish what is still typing.
    <div className="thread" ref={box} style={{ overflowAnchor: "none" }} onClick={() => host.crawl.flush(flushId)}>
      {items.length === 0 && <div className="thread-empty">{empty ?? "Nothing here yet."}</div>}
      {items.map((item) =>
        item.type === "notices" ? (
          <NoticeRun key={item.key} messages={item.messages} moderate={moderate} />
        ) : (
          <MessageGroup
            key={item.key}
            run={item.run}
            allMessages={messages}
            showChannel={showChannel}
            moderate={moderate}
            onOpenThread={onOpenThread}
            widgets={widgets}
            onPerson={onPerson}
            superseded={superseded}
          />
        ),
      )}
    </div>
  );
}

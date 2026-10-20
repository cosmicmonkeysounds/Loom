//! The message stream (moved out of `chat.tsx` in wave 13): stick to the
//! newest line, roots folded into sender runs.

import { useCallback, useRef, type ReactNode } from "react";
import type { ChatMessage } from "../types.ts";
import { supersededCards } from "../widgets.tsx";
import { MessageGroup, type ModerateHook, type WidgetHook } from "./bubble.tsx";
import { groupRuns, rootsOf } from "./runs.ts";

/** How close to the bottom (px) still counts as "reading the newest line". */
export const STICK_SLACK = 80;

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
    // inside the slack, so it never unpins.
    const onScroll = () => {
      pinned = atBottom(el);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // A picture finishing loading grows its message without a mutation.
    el.addEventListener("load", stick, true);
    const mo = typeof MutationObserver === "function" ? new MutationObserver(stick) : null;
    mo?.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(stick) : null;
    ro?.observe(el);
    stick();
    cleanup.current = () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("load", stick, true);
      mo?.disconnect();
      ro?.disconnect();
    };
  }, []);
}

export function MessageList({
  messages,
  showChannel,
  moderate,
  onOpenThread,
  widgets,
  onPerson,
  empty,
}: {
  messages: ChatMessage[];
  showChannel?: boolean;
  moderate?: ModerateHook;
  onOpenThread?: (rootSeq: number) => void;
  widgets?: WidgetHook;
  onPerson?: (name: string) => void;
  empty?: ReactNode;
}) {
  const box = useStickToBottom<HTMLDivElement>();
  // Only top-level messages live in the channel; replies are tucked into their
  // thread panel. Consecutive same-sender lines coalesce into one banner.
  const roots = rootsOf(messages);
  const runs = groupRuns(roots);
  const superseded = supersededCards(roots);
  return (
    <div className="thread" ref={box}>
      {runs.length === 0 && <div className="thread-empty">{empty ?? "Nothing here yet."}</div>}
      {runs.map((run) => (
        <MessageGroup
          key={run.messages[0]!.seq}
          run={run}
          allMessages={messages}
          showChannel={showChannel}
          moderate={moderate}
          onOpenThread={onOpenThread}
          widgets={widgets}
          onPerson={onPerson}
          superseded={superseded}
        />
      ))}
    </div>
  );
}

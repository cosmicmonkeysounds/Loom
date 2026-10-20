//! The message stream (moved out of `chat.tsx` in wave 13): stick to the
//! newest line, roots folded into sender runs, barks out, notice runs
//! folded, tap to finish the crawl.

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { usePlayHost } from "../host.ts";
import type { ChatMessage } from "../types.ts";
import { supersededCards } from "../widgets.tsx";
import { MessageBubble, MessageGroup, type ModerateHook, type WidgetHook } from "./bubble.tsx";
import { noticeNoun, noticeSummary, streamItems } from "./notices.ts";
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

type NodeLike = { nodeType: number };
type RecordLike = { type: string; target: unknown; addedNodes: ArrayLike<NodeLike>; removedNodes: ArrayLike<NodeLike> };

/** The stream's own rows a batch of mutations added and removed — only the
 *  box's direct children (a crawl tick deep inside a row is no new row). */
export function rowChanges<N extends NodeLike>(records: readonly RecordLike[], box: unknown): { added: N[]; removed: N[] } {
  const added: N[] = [];
  const removed: N[] = [];
  for (const r of records) {
    if (r.type !== "childList" || r.target !== box) continue;
    for (const n of Array.from(r.addedNodes)) if (n.nodeType === 1) added.push(n as N);
    for (const n of Array.from(r.removedNodes)) if (n.nodeType === 1) removed.push(n as N);
  }
  return { added, removed };
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
    const stickNow = () => {
      if (pinned) el.scrollTop = el.scrollHeight;
    };
    // One jump per frame, however many ticks / rows / pictures asked for it
    // (a crawl tick is every 16–40 ms; an old tablet has a 400-row lobby).
    let frame: number | null = null;
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;
    const stick = () => {
      if (raf === null) return stickNow();
      if (frame !== null) return;
      frame = raf(() => {
        frame = null;
        stickNow();
      });
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
      else if (pinned) stickNow();
    };
    for (const ev of ["touchstart", "touchmove", "wheel", "pointerdown", "keydown"]) el.addEventListener(ev, touch, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    // A picture finishing loading grows its message without a mutation.
    el.addEventListener("load", stick, true);
    // Rows grow without a mutation too (a picture decoding — the pass QR
    // came in 200 px short of the bottom): watch every row's size, not
    // only the box's.
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(stick) : null;
    if (ro !== null) for (const child of Array.from(el.children)) ro.observe(child);
    const mo =
      typeof MutationObserver === "function"
        ? new MutationObserver((records) => {
            // Watch new rows, let go of removed ones; a tick inside a row
            // only asks for the (coalesced) jump.
            if (ro !== null) {
              const { added, removed } = rowChanges<Element>(records, el);
              for (const n of removed) ro.unobserve(n);
              for (const n of added) ro.observe(n);
            }
            stick();
          })
        : null;
    mo?.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    ro?.observe(el);
    stickNow();
    cleanup.current = () => {
      el.removeEventListener("scroll", onScroll);
      for (const ev of ["touchstart", "touchmove", "wheel", "pointerdown", "keydown"]) el.removeEventListener(ev, touch);
      el.removeEventListener("load", stick, true);
      mo?.disconnect();
      ro?.disconnect();
      if (frame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    };
  }, []);
}

/** A run of per-person notices about other people, folded into one dim
 *  line ("✅ 12 · 🤷 3 — 15 updates about others"); tap to read them. */
function NoticeRun({ messages, moderate }: { messages: ChatMessage[]; moderate?: ModerateHook }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`msg stream-notices ${open ? "open" : ""}`}>
      <button type="button" className="stream-notices-line" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="stream-notices-sum">{noticeSummary(messages)}</span>
        <span className="stream-notices-hint">{open ? "hide" : noticeNoun(messages)}</span>
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
  // A notice naming the viewer stays its own row (never folded with others').
  const meName = widgets?.viewer?.name ?? null;
  const items = useMemo(() => streamItems(roots, meName), [roots, meName]);
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

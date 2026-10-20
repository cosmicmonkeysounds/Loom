//! One message on the stream (moved out of `chat.tsx` in wave 13): the
//! typewriter, the bubble per kind (line / narration / widget / codex /
//! quest / wallet), and the sender-run group.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePlayHost } from "../host.ts";
import { prettyName } from "../rooms/spaces.ts";
import type { ChatMessage, QuestStatus, WalletCard } from "../types.ts";
import { PersonAvatar, colorFor } from "../ui/primitives.tsx";
import { WalletCardView, lastWalletStep } from "../wallet.tsx";
import { WidgetHost, type WidgetResult } from "../widgets.tsx";
import { questStatusOf, replyCountFor, type MessageRun } from "./runs.ts";

// --- typewriter policy --------------------------------------------------------
// The crawl-once memory lives on the host (`host.ts` `createCrawl`), so each
// embedded pane crawls its own lines.

/**
 * Reveal `text` one character at a time — the classic RPG dialogue crawl.
 * Only runs when `enabled` (a line that just landed); honours
 * `prefers-reduced-motion` by showing the full line at once. Lines that
 * land together crawl one after another (the host's crawl queue), so a
 * burst of dialogue reads as dialogue rather than a wall typing at once.
 */
function useTypewriter(text: string, enabled: boolean, seq: number): { shown: string; typing: boolean } {
  const host = usePlayHost();
  const [count, setCount] = useState(enabled ? 0 : text.length);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!enabled || reduce || text.length === 0) {
      setCount(text.length);
      return;
    }
    setCount(0);
    let id: number | null = null;
    const crawl = host.crawl;
    crawl.start(seq, () => {
      // Clock-driven, not tick-counted: a background tab throttles timers
      // to ~1 Hz, and a line must catch up when the tab returns, not
      // crawl at one character a second.
      const t0 = performance.now();
      id = window.setInterval(() => {
        const i = Math.min(text.length, Math.floor((performance.now() - t0) / 18));
        setCount(i);
        if (i >= text.length) {
          window.clearInterval(id!);
          id = null;
          crawl.finish(seq);
        }
      }, 18);
    });
    return () => {
      if (id !== null) window.clearInterval(id);
      crawl.finish(seq);
    };
  }, [text, enabled, seq, host]);
  return { shown: text.slice(0, count), typing: count < text.length };
}

// --- one open thread --------------------------------------------------------

export interface ModerateHook {
  /** Flip a message's hidden flag (admin only). Absent → no controls. */
  setHidden: (seq: number, hidden: boolean) => void;
}

/** How a room answers a widget: post the result for a card (by seq). Absent
 *  → cards are read-only (a performer watching a guest's card). */
export interface WidgetHook {
  answer: (seq: number, result: WidgetResult) => void;
  /** Answers already given this session, by seq. */
  answered: ReadonlyMap<number, WidgetResult>;
  /** The viewer (a guest's own id + name) for cards about them. */
  viewer?: { id: string; name: string };
}

// --- pinned-room cards (the Codex, the Quest Log) ------------------------------

/** What a pinned-room card can do beyond reading — supplied by the app. */
export interface CardActions {
  /** Share a codex entry you hold (opens a who-with picker). */
  shareCodex?: (entry: string, title: string) => void;
}
const CardActionsContext = createContext<CardActions>({});
export const CardActionsProvider = CardActionsContext.Provider;

const VIA: Record<string, string> = { code: "Unlocked with a code", story: "Learned tonight" };

/** One codex entry, as a card in the Codex room. */
function CodexCardView({ msg, modBtn }: { msg: ChatMessage; modBtn: ReactNode }) {
  const actions = useContext(CardActionsContext);
  const c = msg.codex!;
  return (
    <div className={`msg codex-card-msg ${msg.hidden ? "hidden" : ""}`}>
      <div className="codex-card">
        <div className="codex-card-head">
          <span className="codex-card-ico" aria-hidden>
            📓
          </span>
          <strong className="codex-card-title">{c.title}</strong>
          {c.about && <span className="pill kind">about {c.about}</span>}
        </div>
        {msg.text && <p className="codex-text">{msg.text}</p>}
        <div className="codex-card-foot">
          <span className="muted">{c.via === "share" && c.from ? `Shared by ${c.from}` : (VIA[c.via] ?? "")}</span>
          {actions.shareCodex && (
            <button className="link" onClick={() => actions.shareCodex!(c.entry, c.title)}>
              Share…
            </button>
          )}
        </div>
      </div>
      {modBtn}
    </div>
  );
}

const QUEST_STATUS: Record<QuestStatus, string> = { active: "in progress", done: "complete", failed: "failed" };
const STEP_GLYPH: Record<string, string> = { complete: "✅", fail: "✖", update: "▸", start: "📜" };

/** A quest in the Quest Log: its card (the thread's root), or one step of it. */
function QuestView({
  msg,
  modBtn,
  status,
  replies,
  onOpenThread,
}: {
  msg: ChatMessage;
  modBtn: ReactNode;
  status?: QuestStatus;
  replies?: number;
  onOpenThread?: (rootSeq: number) => void;
}) {
  const q = msg.quest!;
  if (msg.parentSeq != null) {
    const fallback = q.action === "complete" ? "Quest complete." : q.action === "fail" ? "Quest failed." : "";
    return (
      <div className={`msg quest-step ${q.action} ${msg.hidden ? "hidden" : ""}`}>
        <span className="quest-step-ico" aria-hidden>
          {STEP_GLYPH[q.action] ?? "▸"}
        </span>
        <span className="bubble plain">{msg.text || fallback}</span>
        {modBtn}
      </div>
    );
  }
  const st = status ?? "active";
  const open = onOpenThread ? () => onOpenThread(msg.seq) : undefined;
  return (
    <div className={`msg quest-msg ${msg.hidden ? "hidden" : ""}`}>
      <div
        className={`quest-card ${st} ${open ? "openable" : ""}`}
        role={open ? "button" : undefined}
        tabIndex={open ? 0 : undefined}
        onClick={open}
        onKeyDown={open ? (e) => e.key === "Enter" && open() : undefined}
      >
        <div className="quest-head">
          <span className="quest-ico" aria-hidden>
            📜
          </span>
          <strong className="quest-title">{q.title}</strong>
          <span className={`quest-status ${st}`}>{QUEST_STATUS[st]}</span>
        </div>
        {msg.from && (
          <div className="quest-giver">
            <PersonAvatar name={msg.from} size="sm" kind="character" /> from {msg.from.replace(/_/g, " ")}
          </div>
        )}
        {msg.text && <p className="quest-text">{msg.text}</p>}
        {open && <div className="quest-open">{replies ? `${replies} ${replies === 1 ? "update" : "updates"} ›` : "Open ›"}</div>}
      </div>
      {modBtn}
    </div>
  );
}

export function MessageBubble({
  msg,
  showChannel,
  moderate,
  tuck,
  replies,
  onOpenThread,
  widgets,
  onPerson,
  questStatus,
  superseded,
  walletOutcome,
}: {
  msg: ChatMessage;
  /** Where a quest card's quest stands (read off its thread). */
  questStatus?: QuestStatus;
  /** A wallet root's newest thread step (how it closed). */
  walletOutcome?: WalletCard | null;
  /** A newer card of the same re-dealt kind follows this one. */
  superseded?: boolean;
  /** Tag the bubble with its channel (used in the performer's flat view). */
  showChannel?: boolean;
  moderate?: ModerateHook;
  /** A same-sender continuation line: hide the avatar + name banner. */
  tuck?: boolean;
  /** Reply count, when the caller wants a thread affordance on this line. */
  replies?: number;
  onOpenThread?: (rootSeq: number) => void;
  widgets?: WidgetHook;
  /** Tapping a sender's name / avatar (a performer opens the guest's card). */
  onPerson?: (name: string) => void;
}) {
  const cls = msg.kind === "line" ? "line" : msg.kind === "system" ? "system" : msg.kind === "signal" ? (msg.alert ? "signal alert" : "signal") : msg.kind === "widget" ? "widget" : "narration";
  // Only crawl spoken/narrated story text — system + signal notices pop in.
  const crawlable = msg.kind === "line" || msg.kind === "narration";
  const host = usePlayHost();
  const [live] = useState(() => crawlable && host.crawl.claim(msg.seq));
  const { shown, typing } = useTypewriter(msg.text, live, msg.seq);
  // Queued behind an earlier line still crawling: not on screen yet.
  const pending = typing && shown.length === 0 && msg.text.length > 0;
  const modBtn = moderate && (
    <button
      className="mod-toggle"
      title={msg.hidden ? "Restore for guests" : "Hide from guests"}
      onClick={() => moderate.setHidden(msg.seq, !msg.hidden)}
    >
      {msg.hidden ? "🙈 hidden — restore" : "hide"}
    </button>
  );
  if (msg.kind === "widget" && msg.widget) {
    const answered = widgets?.answered.get(msg.seq) ?? null;
    return (
      <div className={`msg widget-msg ${msg.hidden ? "hidden" : ""}`}>
        {showChannel && <div className="msg-channel">{msg.title}</div>}
        <WidgetHost
          card={msg.widget}
          seed={msg.seq}
          answered={answered}
          superseded={superseded}
          viewer={widgets?.viewer ?? null}
          onAnswer={widgets && !answered && !superseded ? (r) => widgets.answer(msg.seq, r) : undefined}
        />
        {modBtn}
      </div>
    );
  }
  if (msg.kind === "codex" && msg.codex) return <CodexCardView msg={msg} modBtn={modBtn} />;
  if (msg.kind === "quest" && msg.quest) {
    return <QuestView msg={msg} modBtn={modBtn} status={questStatus} replies={replies} onOpenThread={onOpenThread} />;
  }
  if (msg.kind === "wallet" && msg.wallet) return <WalletCardView msg={msg} card={msg.wallet} modBtn={modBtn} replies={replies} onOpenThread={onOpenThread} outcome={walletOutcome} />;
  if (msg.kind !== "line") {
    return (
      <div className={`msg ${cls} ${msg.hidden ? "hidden" : ""} ${typing ? "typing" : ""} ${pending ? "pending" : ""}`}>
        {showChannel && <div className="msg-channel">{msg.title}</div>}
        {msg.kind === "narration" && msg.from && msg.from !== "Narrator" && <span className="narrator-tag">{prettyName(msg.from)}</span>}
        <span className="bubble plain">{crawlable ? shown : msg.text}</span>
        {modBtn}
      </div>
    );
  }
  const name = prettyName(msg.from);
  return (
    <div className={`msg line ${tuck ? "tuck" : ""} ${msg.hidden ? "hidden" : ""} ${typing ? "typing" : ""} ${pending ? "pending" : ""}`}>
      {!tuck && (
        <button type="button" className="msg-avatar" onClick={onPerson ? () => onPerson(msg.from) : undefined} tabIndex={onPerson ? 0 : -1} aria-label={name}>
          <PersonAvatar name={msg.from} />
        </button>
      )}
      <div className="msg-body">
        {!tuck && (
          <div className="msg-head">
            {showChannel && <span className="msg-channel">{msg.title}</span>}
            <button type="button" className="speaker" style={{ color: colorFor(msg.from) }} onClick={onPerson ? () => onPerson(msg.from) : undefined} tabIndex={onPerson ? 0 : -1}>
              {name}
            </button>
            {msg.via && <span className="via">via {msg.via}</span>}
          </div>
        )}
        <span className="bubble">{shown}</span>
        {modBtn}
        {onOpenThread && (
          <button
            className={`replies ${replies ? "has" : ""}`}
            onClick={() => onOpenThread(msg.seq)}
            title={replies ? `${replies} ${replies === 1 ? "reply" : "replies"}` : "Reply in thread"}
            aria-label={replies ? `${replies} replies` : "Reply in thread"}
          >
            <span className="reply-ico">💬</span>
            {replies && replies > 0 ? <span className="reply-n">{replies}</span> : null}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * One Slack/Discord sender-run: an avatar + name shown once, with each
 * subsequent same-sender line tucked under it. Non-`line` runs (narration /
 * system / signal / widget) are single standalone messages.
 */
export function MessageGroup({
  run,
  allMessages,
  showChannel,
  moderate,
  onOpenThread,
  widgets,
  onPerson,
  superseded,
}: {
  run: MessageRun;
  /** The full channel history, so each root can show its reply count. */
  allMessages: ChatMessage[];
  /** Cards a newer card of the same kind replaced (`supersededCards`). */
  superseded?: ReadonlySet<number>;
  showChannel?: boolean;
  moderate?: ModerateHook;
  onOpenThread?: (rootSeq: number) => void;
  widgets?: WidgetHook;
  onPerson?: (name: string) => void;
}) {
  if (run.kind === "quest") {
    // A quest card opens its own thread — its steps.
    const m = run.messages[0]!;
    return (
      <MessageBubble
        msg={m}
        moderate={moderate}
        onOpenThread={onOpenThread}
        replies={replyCountFor(allMessages, m.seq)}
        questStatus={questStatusOf(allMessages, m.seq)}
      />
    );
  }
  if (run.kind === "wallet") {
    // A wallet card opens its thread of updates — Denied / Approved /
    // Refunded / Paid (B8); its foot reads how it closed.
    const m = run.messages[0]!;
    return (
      <MessageBubble
        msg={m}
        showChannel={showChannel}
        moderate={moderate}
        onOpenThread={onOpenThread}
        replies={replyCountFor(allMessages, m.seq)}
        walletOutcome={lastWalletStep(allMessages, m.seq)}
      />
    );
  }
  if (run.kind !== "line") {
    const m = run.messages[0]!;
    return <MessageBubble msg={m} showChannel={showChannel} moderate={moderate} widgets={widgets} superseded={superseded?.has(m.seq)} />;
  }
  return (
    <div className="run">
      {run.messages.map((m, i) => (
        <MessageBubble
          key={m.seq}
          msg={m}
          tuck={i > 0}
          showChannel={showChannel}
          moderate={moderate}
          onOpenThread={onOpenThread}
          replies={onOpenThread ? replyCountFor(allMessages, m.seq) : undefined}
          onPerson={onPerson}
        />
      ))}
    </div>
  );
}

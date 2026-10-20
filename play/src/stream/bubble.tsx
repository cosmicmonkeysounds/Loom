//! One message on the stream (moved out of `chat.tsx` in wave 13): the
//! crawl (decided at arrival, `crawl.ts`), the bubble per kind (line /
//! narration / widget / codex / quest / wallet) with cards docked, settled
//! or inline (`settled.ts`), and the sender-run group.

import { Icon } from "../chrome/icons.tsx";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { crawlDuration } from "../crawl.ts";
import { usePlayHost, type CrawlTier } from "../host.ts";
import { displayName, useKnownNames } from "../rooms/names.ts";
import type { ChatMessage, QuestStatus, WalletCard } from "../types.ts";
import { PersonAvatar, colorFor } from "../ui/primitives.tsx";
import { WalletCardView, lastWalletStep } from "../wallet.tsx";
import { WidgetHost, type WidgetResult } from "../widgets.tsx";
import { cardForm, receiptLine, settledLine } from "./settled.ts";
import { questStatusOf, replyCountFor, type MessageRun } from "./runs.ts";

// --- the crawl ------------------------------------------------------------------
// Whether a line crawls, and how, is decided when it ARRIVES (`crawl.ts`):
// the bubble only reads that decision, so opening a room never replays it.

/** The visitor asked the OS for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The scramble an fx line decodes through. */
const SCRAMBLE = "█▓▒░#%&@$?!<>/\\=+*01";
/** How many characters past the cursor scramble before they settle. */
const SCRAMBLE_AHEAD = 6;

function scramble(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)];
  return out;
}

export interface CrawlState {
  /** The text revealed so far. */
  shown: string;
  /** Still crawling (or waiting its turn). */
  typing: boolean;
  /** Waiting behind an earlier line: nothing revealed yet. */
  queued: boolean;
  tier: CrawlTier;
}

/**
 * Reveal `text` at its tier's speed once the host's crawl releases it (one
 * line at a time, in order). Clock-driven, not tick-counted, so a
 * background tab catches up. A flush (tap the stream) shows it whole at
 * once. Reduced motion: shown whole, never crawled.
 */
export function useCrawl(text: string, seq: number): CrawlState {
  const host = usePlayHost();
  const crawl = host.crawl;
  // Read once, at mount: the decision was made when the line arrived.
  const [tier] = useState<CrawlTier>(() => (prefersReducedMotion() ? "none" : crawl.tierOf(seq)));
  const live = tier !== "none" && text.length > 0;
  const [count, setCount] = useState(live ? 0 : text.length);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!live) {
      setCount(text.length);
      if (crawl.tierOf(seq) !== "none") crawl.finish(seq); // reduced motion: nothing owed
      return;
    }
    // Flushed between render and this effect (a card in the next frame, a
    // tap): shown whole, never crawled from nothing behind what flushed it.
    if (crawl.tierOf(seq) === "none") {
      setCount(text.length);
      return;
    }
    let id: number | null = null;
    const stop = () => {
      if (id !== null) window.clearInterval(id);
      id = null;
    };
    const off = crawl.subscribe(() => {
      if (crawl.tierOf(seq) === "none") {
        stop();
        setCount(text.length);
      }
    });
    const total = crawlDuration(tier, text.length);
    const charMs = total / text.length;
    crawl.start(seq, () => {
      setStarted(true);
      const t0 = performance.now();
      id = window.setInterval(() => {
        const i = Math.min(text.length, Math.floor((performance.now() - t0) / charMs));
        setCount(i);
        if (i >= text.length) {
          stop();
          crawl.finish(seq);
        }
      }, Math.max(16, Math.min(40, charMs)));
    });
    return () => {
      off();
      stop();
      crawl.finish(seq);
    };
  }, [text, seq, live, tier, crawl]);
  const typing = count < text.length;
  return { shown: text.slice(0, count), typing, queued: typing && !started && count === 0, tier };
}

/**
 * The text of a line while it crawls. The whole line is laid out from the
 * start (the unrevealed rest takes its space, invisible), so nothing below
 * jumps and a queued line is never `display: none`. Screen readers get the
 * whole text once. An fx line decodes through a scramble ahead of the cursor.
 */
function CrawlText({ text, c }: { text: string; c: CrawlState }) {
  if (!c.typing) return <>{text}</>;
  const rest = text.slice(c.shown.length);
  const ahead = c.tier === "fx" && !c.queued ? Math.min(SCRAMBLE_AHEAD, rest.length) : 0;
  return (
    <>
      <span className="stream-sr">{text}</span>
      <span aria-hidden>
        {c.shown}
        {ahead > 0 && <span className="stream-scramble">{scramble(ahead)}</span>}
        {!c.queued && <span className="stream-caret">▌</span>}
        <span className="stream-rest">{rest.slice(ahead)}</span>
      </span>
    </>
  );
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
/** The app's card actions (the Codex room's Share…). */
export function useCardActions(): CardActions {
  return useContext(CardActionsContext);
}

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
            <Icon name="codex" size={18} />
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
            <Icon name="quest" size={18} />
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

/** How the stream around a bubble treats cards (wave 13): a room docks live
 *  cards in its tray and settles the pass; the cutscene shows both inline. */
export interface StreamMode {
  /** Live answerable cards dock in the room's card tray (a receipt stays here). */
  tray: boolean;
  /** The pass card settles into one line (the pass lives in the taskbar). */
  settlePass: boolean;
  /** Tapping a receipt opens its card in the tray. */
  openTray?: (seq: number) => void;
}
const StreamModeContext = createContext<StreamMode>({ tray: false, settlePass: false });
export const StreamModeProvider = StreamModeContext.Provider;

/** A card settled into one line; tap to see the whole card (read-only). */
function SettledCard({ line, children, expandable }: { line: string; children: ReactNode; expandable: boolean }) {
  const [open, setOpen] = useState(false);
  if (!expandable) {
    return (
      <div className="stream-settled" role="note">
        <span className="stream-settled-line">{line}</span>
      </div>
    );
  }
  return (
    <div className={`stream-settled ${open ? "open" : ""}`}>
      <button type="button" className="stream-settled-line" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="stream-settled-text">{line}</span>
        <span className="stream-settled-caret" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && <div className="stream-settled-body">{children}</div>}
    </div>
  );
}

/** A card, in whichever form the stream gives it (`settled.ts cardForm`). */
function WidgetBubble({ msg, widgets, superseded, showChannel, modBtn }: { msg: ChatMessage; widgets?: WidgetHook; superseded?: boolean; showChannel?: boolean; modBtn: ReactNode }) {
  const mode = useContext(StreamModeContext);
  const card = msg.widget!;
  const answered = widgets?.answered.get(msg.seq) ?? null;
  const answerable = widgets !== undefined;
  const form = cardForm({ card, answered, superseded: superseded === true, answerable, tray: mode.tray, settlePass: mode.settlePass });
  const host = (
    <WidgetHost
      card={card}
      seed={msg.seq}
      answered={answered}
      superseded={superseded}
      viewer={widgets?.viewer ?? null}
      onAnswer={form === "full" && widgets && !answered && !superseded ? (r) => widgets.answer(msg.seq, r) : undefined}
    />
  );
  let body: ReactNode = host;
  if (form === "tray") {
    body = (
      <button type="button" className="stream-receipt" onClick={mode.openTray ? () => mode.openTray!(msg.seq) : undefined}>
        {receiptLine(msg)}
        <span className="stream-receipt-go" aria-hidden>
          ↓
        </span>
      </button>
    );
  } else if (form === "settled") {
    const line = settledLine({ card, answered, superseded: superseded === true, answerable });
    // A closed or replaced card has nothing more to show.
    const expandable = card.kind === "pass" || answered !== null || (!answerable && !superseded);
    body = (
      <SettledCard line={line} expandable={expandable}>
        {host}
      </SettledCard>
    );
  }
  return (
    <div className={`msg widget-msg stream-card-${form} ${msg.hidden ? "hidden" : ""}`}>
      {showChannel && <div className="msg-channel">{msg.title}</div>}
      {body}
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
  const c = useCrawl(msg.text, msg.seq);
  const known = useKnownNames();
  // Effect text keeps its look after the crawl (and under reduced motion).
  const fx = msg.fx === true || (msg.kind === "signal" && (msg.alert === true || msg.takeover === true));
  const crawlCls = `${c.typing && !c.queued ? "stream-typing" : ""} ${c.queued ? "stream-queued" : ""} ${fx ? "stream-fx" : ""} ${fx && c.typing ? "stream-fx-live" : ""}`;
  const modBtn = moderate && (
    <button
      className="mod-toggle"
      title={msg.hidden ? "Restore for guests" : "Hide from guests"}
      onClick={() => moderate.setHidden(msg.seq, !msg.hidden)}
    >
      {msg.hidden ? "🙈 hidden — restore" : "hide"}
    </button>
  );
  if (msg.kind === "widget" && msg.widget) return <WidgetBubble msg={msg} widgets={widgets} superseded={superseded} showChannel={showChannel} modBtn={modBtn} />;
  if (msg.kind === "codex" && msg.codex) return <CodexCardView msg={msg} modBtn={modBtn} />;
  if (msg.kind === "quest" && msg.quest) {
    return <QuestView msg={msg} modBtn={modBtn} status={questStatus} replies={replies} onOpenThread={onOpenThread} />;
  }
  if (msg.kind === "wallet" && msg.wallet) return <WalletCardView msg={msg} card={msg.wallet} modBtn={modBtn} replies={replies} onOpenThread={onOpenThread} outcome={walletOutcome} />;
  if (msg.kind !== "line") {
    return (
      <div className={`msg ${cls} ${msg.hidden ? "hidden" : ""} ${crawlCls}`}>
        {showChannel && <div className="msg-channel">{msg.title}</div>}
        {msg.kind === "narration" && msg.from && msg.from !== "Narrator" && <span className="narrator-tag">{displayName(msg.from, known)}</span>}
        {msg.manner && <span className="stream-manner">({msg.manner}) </span>}
        <span className="bubble plain">
          <CrawlText text={msg.text} c={c} />
        </span>
        {modBtn}
      </div>
    );
  }
  const name = displayName(msg.from, known);
  // The 💬 thread affordance belongs on typed chat (no beat), where people
  // talk back — not under every scripted line. A line with replies shows them.
  const threadable = onOpenThread !== undefined && (!msg.beat || (replies ?? 0) > 0);
  return (
    <div className={`msg line ${tuck ? "tuck" : ""} ${msg.hidden ? "hidden" : ""} ${crawlCls}`}>
      {/* A tappable sender (a booth opens the guest's card) is a button with a
          44 px hit area (chrome.css); a guest's is only a name, never a
          17 px button that does nothing. */}
      {!tuck &&
        (onPerson ? (
          <button type="button" className="msg-avatar" onClick={() => onPerson(msg.from)} tabIndex={0} aria-label={name}>
            <PersonAvatar name={msg.from} />
          </button>
        ) : (
          <span className="msg-avatar" aria-hidden>
            <PersonAvatar name={msg.from} />
          </span>
        ))}
      <div className="msg-body">
        {!tuck && (
          <div className="msg-head">
            {showChannel && <span className="msg-channel">{msg.title}</span>}
            {onPerson ? (
              <button type="button" className="speaker" style={{ color: colorFor(msg.from) }} onClick={() => onPerson(msg.from)} tabIndex={0}>
                {name}
              </button>
            ) : (
              <span className="speaker" style={{ color: colorFor(msg.from) }}>
                {name}
              </span>
            )}
            {msg.manner && <span className="stream-manner">{msg.manner}</span>}
            {msg.via && <span className="via">via {msg.via}</span>}
          </div>
        )}
        {tuck && msg.manner && <span className="stream-manner">({msg.manner}) </span>}
        <span className="bubble">
          <CrawlText text={msg.text} c={c} />
        </span>
        {modBtn}
        {threadable && (
          <button
            className={`replies ${replies ? "has" : ""}`}
            onClick={() => onOpenThread!(msg.seq)}
            title={replies ? `${replies} ${replies === 1 ? "reply" : "replies"}` : "Reply in thread"}
            aria-label={replies ? `${replies} replies` : "Reply in thread"}
          >
            <span className="reply-ico" aria-hidden>
              <Icon name="reply" className="ico-inline" />
            </span>
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

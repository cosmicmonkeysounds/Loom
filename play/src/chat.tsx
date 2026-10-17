//! Composable chat primitives — the building blocks both the guest and the
//! performer apps assemble into their own surfaces. Nothing here knows about
//! roles or actions; callers feed in `Channel`s and `Decision`s and supply a
//! footer / moderation hook, so views compose without duplication.
//!
//! The shape is the one every chat app trained people on: a **sidebar** of
//! rooms (grouped, the room you're standing in first, who's in each), and a
//! **stage** with the open conversation — its header says who is here, its
//! messages carry an avatar tile + name like Discord, and a decision or a
//! widget docks right in the flow. Wide screens show both panes; a phone
//! drills in.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAvatars } from "./avatars.ts";
import { usePlayHost } from "./host.ts";
import { occupancyLabel } from "./presence.ts";
import { useWakeLock } from "./wake-lock.ts";
import {
  groupRuns,
  prettyName,
  questStatusOf,
  repliesFor,
  replyCountFor,
  rootsOf,
  type MessageRun,
  type SpaceGroup,
} from "./threads.ts";
import type { Action, Channel, ChatMessage, Decision, QuestStatus, WalletCard } from "./types.ts";
import { WidgetHost, supersededCards, widgetLabel, type WidgetResult } from "./widgets.tsx";
import { WalletCardView, lastWalletStep } from "./wallet.tsx";

// --- small shared atoms -----------------------------------------------------

/**
 * A deterministic screen-name colour, the way every AOL chatter picked a
 * font colour and kept it. Hash the name into a small web-safe palette so the
 * same person is always the same colour across the room.
 */
const SN_COLORS = [
  "#c00000", "#0000c0", "#008000", "#800080", "#c05000",
  "#008080", "#a00050", "#505000", "#0050a0", "#a02000",
];
export function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SN_COLORS[h % SN_COLORS.length]!;
}

/** `1 guest` / `3 guests`. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The initial(s) an avatar tile shows for a name. */
export function initialsOf(name: string): string {
  const words = prettyName(name).split(" ").filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 1).toUpperCase();
  return (words[0]!.slice(0, 1) + words[words.length - 1]!.slice(0, 1)).toUpperCase();
}

/** A person's avatar tile — their profile picture when the event has one
 *  (a program's Wikipedia image, an authored `avatar:`), else coloured
 *  from their name, like their screen name. `src` overrides the lookup
 *  (the sign-in pickers show pictures before there is a session). */
export function PersonAvatar({ name, size = "md", kind, src }: { name: string; size?: "sm" | "md" | "lg"; kind?: "guest" | "character"; src?: string | null }) {
  const lookup = useAvatars();
  const picture = src === undefined ? lookup.srcFor(name) : src;
  // The initials stay underneath: they show while the picture loads, and
  // stay if it never does (a broken image removes itself).
  return (
    <span className={`pavatar ${size} ${kind ?? ""} ${picture !== null ? "pic" : ""}`} style={{ background: colorFor(name) }} aria-hidden>
      {initialsOf(name)}
      {picture !== null && <img src={picture} alt="" loading="lazy" draggable={false} onError={(e) => e.currentTarget.remove()} />}
    </span>
  );
}

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

/** `(min-width: …)`-style media query as a boolean, live. */
export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const h = () => setOn(mq.matches);
    h();
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [query]);
  return on;
}

/** An embedded pane whose session is over (the participant left, or a run
 *  transition cut it) — the host decides what comes next. */
export function SessionEnded({ notice }: { notice: string | null }) {
  return (
    <div className="hero">
      <div className="glyph">⏏</div>
      <p className="sub">{notice ?? "Signed out."}</p>
    </div>
  );
}

/** The two-pane breakpoint: sidebar + stage side by side from here up. */
export const WIDE = "(min-width: 820px)";

/** The two-pane layout? The viewport decides on a page of its own; an
 *  embedded pane's host decides from the pane's width. */
export function useWide(): boolean {
  const host = usePlayHost();
  const viewport = useMediaQuery(WIDE);
  return host.wide ?? viewport;
}

/** A participant's (public) group, as a small tag. Colour comes from the
 *  group's name — nothing is keyed to any particular story's sides. */
export function GroupPill({ group }: { group: string | null }) {
  if (group === null) return <span className="pill none">unaligned</span>;
  return (
    <span className="pill group" style={{ color: colorFor(group) }}>
      {group}
    </span>
  );
}

export function ConnDot({ connected, label }: { connected: boolean; label: string }) {
  return (
    <span className="conn" title={connected ? "connected" : "reconnecting…"}>
      <span className={`dot ${connected ? "on" : ""}`} /> {label}
    </span>
  );
}

const GLYPH: Record<Channel["kind"], string> = {
  lobby: "🌐",
  faction: "#",
  location: "📍",
  dm: "",
  guest: "",
  scanner: "📷",
  group: "👥",
  open: "#",
  private: "🔒",
  codex: "📓",
  quests: "📜",
  wallet: "🪙",
};

export function Avatar({ channel }: { channel: Pick<Channel, "kind" | "title"> }) {
  if (channel.kind === "dm" || channel.kind === "guest") return <PersonAvatar name={channel.title} kind={channel.kind === "guest" ? "guest" : "character"} />;
  const glyph = GLYPH[channel.kind] || channel.title.replace(/[#\s]/g, "").slice(0, 1).toUpperCase();
  return <div className={`avatar ${channel.kind}`}>{glyph}</div>;
}

export function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return <span className="badge">{count > 9 ? "9+" : count}</span>;
}

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

// --- sheets -------------------------------------------------------------------

/** A modal window: caption bar + body. Click outside (or Close) dismisses. */
export function Sheet({ title, onClose, children, tall }: { title: ReactNode; onClose: () => void; children: ReactNode; tall?: boolean }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className={`sheet ${tall ? "tall" : ""}`} role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <h2>
          <span>{title}</span>
          <button className="sheet-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </h2>
        {children}
      </div>
    </div>
  );
}

/**
 * A modal picker: choose a participant to pull into a channel. Shared by the
 * guest and performer invite affordances.
 */
export function InviteSheet({
  title,
  people,
  onPick,
  onClose,
}: {
  title: string;
  people: Array<{ id: string; name: string }>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <PickerSheet
      title={title}
      items={people.map((p) => ({ id: p.id, label: p.name }))}
      onPick={onPick}
      onClose={onClose}
      empty="No one else here yet."
    />
  );
}

/** One choosable row of a `PickerSheet`. */
export interface PickItem {
  id: string;
  label: string;
  /** A small second line (a group, a kind, a count). */
  sub?: string;
  /** Show an avatar tile for this row (a person). */
  avatar?: boolean;
}

/**
 * A modal list to pick one thing from — a person to share with, an entry
 * to share, a thread to open. The generic cousin of `InviteSheet`.
 */
export function PickerSheet({
  title,
  items,
  onPick,
  onClose,
  empty,
  keepOpen = false,
  lead,
}: {
  title: string;
  items: PickItem[];
  onPick: (id: string) => void;
  onClose: () => void;
  empty?: string;
  /** A pick moves a multi-step sheet on (the wallet's person → amount)
   *  instead of closing it; only × / the backdrop close. */
  keepOpen?: boolean;
  /** Above the list: a field the pick carries (the director's award value). */
  lead?: ReactNode;
}) {
  return (
    <Sheet title={title} onClose={onClose} tall={items.length > 8}>
      {lead}
      {items.length === 0 && <div className="muted pad">{empty ?? "Nothing to pick."}</div>}
      {items.map((it) => (
        <button
          key={it.id}
          className="choice ghost pick"
          onClick={() => {
            onPick(it.id);
            if (!keepOpen) onClose();
          }}
        >
          {it.avatar && <PersonAvatar name={it.label} size="sm" />}
          <span className="pick-label">{it.label}</span>
          {it.sub && <span className="pick-sub">{it.sub}</span>}
        </button>
      ))}
    </Sheet>
  );
}

/** "Keep screen on" — the opt-in wake lock, so a phone left lying around
 *  never sleeps through an alert. Hidden where the browser has none, and
 *  in an embedded pane (the editor's screen is not a phone). */
export function WakeLockToggle() {
  const host = usePlayHost();
  const lock = useWakeLock(host.storage);
  if (host.embedded || !lock.supported) return null;
  return (
    <button className="choice" aria-pressed={lock.on} onClick={lock.toggle}>
      {lock.on ? "🔆 Screen stays on — tap to allow sleep" : "🔅 Keep my screen on (so alerts never sleep)"}
    </button>
  );
}

/** The alert banner — a broadcast the story wants you to *act* on. */
export function AlertBanner({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div className="alert-banner" role="alert" onClick={onDismiss}>
      <span className="alert-glyph" aria-hidden>
        🔔
      </span>
      <span className="alert-text">{text}</span>
      <button className="alert-x" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}

/** A row of inline action buttons (used in composers / profile sheets). */
export function ActionRow({ actions }: { actions: Action[] }) {
  return (
    <div className="actionrow">
      {actions.map((a, i) => (
        <button key={i} className={`choice ${a.tone ?? "ghost"}`} onClick={a.onClick} disabled={a.disabled}>
          {a.label}
        </button>
      ))}
    </div>
  );
}

// --- the sidebar (rooms) ------------------------------------------------------

function lastPreview(c: Channel): string {
  const last = c.messages[c.messages.length - 1];
  if (c.decision) return `▶ ${c.decision.title}`;
  if (!last) return "";
  if (last.kind === "widget" && last.widget) return widgetLabel(last.widget);
  if (last.kind === "codex" && last.codex) return `📓 ${last.codex.title}`;
  if (last.kind === "quest" && last.quest) return `📜 ${last.quest.title}${last.text ? `: ${last.text}` : ""}`;
  if (last.kind === "wallet" && last.wallet) return last.text;
  return last.kind === "line" ? `${last.from ? `${prettyName(last.from)}: ` : ""}${last.text}` : last.text;
}

export function ChannelRow({ channel, active, meId, onOpen }: { channel: Channel; active?: boolean; meId?: string | null; onOpen: (id: string) => void }) {
  const occupancy = occupancyLabel(channel, meId ?? null);
  const sub = channel.typing ? `${channel.typing} is typing…` : (channel.subtitle ?? lastPreview(channel));
  const quiet = channel.kind === "location" && (channel.people?.length ?? 0) === 0 && channel.messages.length === 0 && !channel.here;
  return (
    <button
      className={`chrow ${active ? "active" : ""} ${channel.here ? "here" : ""} ${quiet ? "quiet" : ""}`}
      onClick={() => onOpen(channel.id)}
      aria-current={active ? "true" : undefined}
      data-tour={channel.tour}
    >
      <Avatar channel={channel} />
      <div className="chrow-body">
        <div className="chrow-top">
          <span className="chrow-title">{channel.title}</span>
          {channel.here && <span className="here-tag">you are here</span>}
          {channel.decision && <span className="decision-dot">decision</span>}
          {!channel.decision && channel.needsYou && <span className="decision-dot">your move</span>}
        </div>
        <div className="chrow-sub">
          {occupancy && <span className="chrow-occ">{occupancy}</span>}
          {occupancy && sub && <span className="chrow-dot"> · </span>}
          {sub}
        </div>
      </div>
      <Badge count={channel.unread} />
    </button>
  );
}

/**
 * The Discord-style channel sidebar: channels folded into ordered space
 * sections, each with a header. A thin wrapper over `ChannelRow`.
 */
export function SpaceList({
  spaces,
  activeId,
  meId,
  onOpen,
  header,
  empty,
}: {
  spaces: SpaceGroup[];
  activeId?: string | null;
  meId?: string | null;
  onOpen: (id: string) => void;
  header?: ReactNode;
  empty?: ReactNode;
}) {
  const total = spaces.reduce((n, s) => n + s.channels.length, 0);
  return (
    <div className="screen side">
      {header}
      <div className="chlist" data-tour="rooms">
        {total === 0 && <div className="empty">{empty ?? "No conversations yet."}</div>}
        {spaces.map((s) => (
          <div key={s.id} className="space-section">
            <div className="space-title">{s.title}</div>
            {s.channels.map((c) => (
              <ChannelRow key={c.id} channel={c} active={c.id === activeId} meId={meId} onOpen={onOpen} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- the two-pane shell -------------------------------------------------------

/**
 * Sidebar + stage. Wide: both, side by side (the stage shows a placeholder
 * until a room is open). Narrow: the sidebar, or the open room over it.
 */
export function Shell({ side, stage, wide, placeholder }: { side: ReactNode; stage: ReactNode | null; wide: boolean; placeholder?: ReactNode }) {
  if (!wide) return <>{stage ?? side}</>;
  return (
    <div className="app wide">
      <aside className="side-pane">{side}</aside>
      <section className="stage-pane">{stage ?? <div className="stage-empty">{placeholder ?? "Pick a room."}</div>}</section>
    </div>
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

/**
 * A roomy auto-growing text box + Send button. Used in channels + thread
 * replies. Grows with what you type (up to a cap) so you can always see the
 * whole message — Enter sends, Shift+Enter drops a newline.
 */
export function Composer({
  onSend,
  placeholder,
  disabled,
  sendLabel,
}: {
  /** Return the send's promise to keep the text until the server takes it:
   *  a refusal (slow mode, paused doors, can't post) leaves it in the box. */
  onSend: (text: string) => unknown;
  placeholder?: string;
  disabled?: boolean;
  /** The button's word ("Send"; the Codex says "Unlock"). */
  sendLabel?: string;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Reflow the textarea to fit its content (bounded by the CSS max-height).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  const send = () => {
    if (sending) return;
    const sent = text;
    const pending = sendFromComposer(sent, onSend);
    if (pending === null) return;
    setSending(true);
    void pending.then((clear) => {
      setSending(false);
      // Only clear what was sent: never words typed while it was in flight.
      if (clear) setText((now) => (now === sent ? "" : now));
    });
  };
  return (
    <div className="composer">
      <textarea
        ref={ref}
        className="composer-input"
        rows={1}
        value={text}
        placeholder={placeholder ?? "Say something…"}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <button className="choice composer-send" onClick={send} disabled={disabled || sending}>
        {sendLabel ?? "Send"}
      </button>
    </div>
  );
}

/** Send a composer's text: `null` for nothing to send, else whether to
 *  clear the box — once the send resolves, never after a refusal (the
 *  caller has already said why; the guest keeps their words to retry). */
export function sendFromComposer(raw: string, onSend: (text: string) => unknown): Promise<boolean> | null {
  const t = raw.trim();
  if (t === "") return null;
  let result: unknown;
  try {
    result = onSend(t);
  } catch {
    return Promise.resolve(false);
  }
  if (result !== null && typeof result === "object" && typeof (result as { then?: unknown }).then === "function") {
    return (result as Promise<unknown>).then(
      () => true,
      () => false,
    );
  }
  return Promise.resolve(true);
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
/** The pinned rail — the sticky notices still up in this room (`pin "…"`),
 *  above the stream, newest per key. Nothing to show → nothing rendered. */
export function PinnedRail({ pins }: { pins: ChatMessage[] }) {
  if (pins.length === 0) return null;
  return (
    <div className="pinned-rail" role="status">
      {pins.map((m) => (
        <div key={m.seq} className={`pin ${m.alert ? "alert" : ""}`}>
          📌 {m.text}
        </div>
      ))}
    </div>
  );
}

/** A restricted (marked) program standing in a room may not post there (B4). */
export const RESTRICTED_ROOM_NOTE = "⛔ You're restricted — you can only talk in your direct messages.";

/** Why the composer is gone: restricted where you stand, elsewhere, or read-only. */
export function cantPostNote(channel: Pick<Channel, "kind" | "member" | "here">): string {
  if (channel.kind !== "location") return "This room is read-only.";
  // Standing here and still refused: only restriction does that.
  if (channel.member === true || channel.here === true) return RESTRICTED_ROOM_NOTE;
  return "You're not in this room — walk there to talk here.";
}

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
}: {
  channel: Channel;
  onBack: () => void;
  footer?: ReactNode;
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
            <Composer
              onSend={(t) => onSend(t)}
              placeholder={channel.kind === "codex" ? "Enter a code…" : `Message ${channel.title}…`}
              sendLabel={channel.kind === "codex" ? "Unlock" : undefined}
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
          <Composer onSend={(t) => onSend(t, rootSeq)} placeholder="Reply…" />
        </footer>
      )}
    </div>
  );
}

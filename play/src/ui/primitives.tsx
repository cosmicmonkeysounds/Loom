//! Shared UI atoms (moved out of `chat.tsx` in wave 13): avatars, pills,
//! the live dot, sheets and pickers, the wake-lock toggle, action rows.
//! Nothing here knows about roles; both apps and every lane build on them.

import { useEffect, useState, type ReactNode } from "react";
import { ARM_LINE } from "../arm.ts";
import { useAvatars } from "../avatars.ts";
import { usePlayHost } from "../host.ts";
import { prettyName } from "../rooms/spaces.ts";
import type { Action, Channel } from "../types.ts";
import { useWakeLock } from "../wake-lock.ts";

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

/** Wave 18b: a person's badges (`badge:` lines, e.g. 🚻 Bathroom Mode) as
 *  glyphs beside their name; nothing when they wear none. Each glyph names
 *  its label for a screen reader and on hover. */
export function NameBadges({ badges }: { badges?: ReadonlyArray<{ glyph: string; label: string }> | null }) {
  if (badges === undefined || badges === null || badges.length === 0) return null;
  return (
    <>
      {badges.map((b) => (
        <span key={`${b.glyph}\u0000${b.label}`} className="name-badge" title={b.label} aria-label={b.label} role="img">
          {b.glyph}
        </span>
      ))}
    </>
  );
}

/** The header dot's word: a hollow dot never claims to be "live". */
export function connLabel(connected: boolean): string {
  return connected ? "live" : "reconnecting…";
}

export function ConnDot({ connected, label }: { connected: boolean; label: string }) {
  return (
    <span className="conn" title={connected ? "connected" : "reconnecting…"}>
      <span className={`dot ${connected ? "on" : ""}`} /> {label}
    </span>
  );
}

const GLYPH: Record<Channel["kind"], string> = {
  // The lobby is the far-away 📜 Chat log (wave 18, G2): one glyph on its
  // header, never 🌐 beside a 📜 (GN-F16).
  lobby: "📜",
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
  /** Wave 18b: the person's badges (🚻 Bathroom Mode) beside the label. */
  badges?: ReadonlyArray<{ glyph: string; label: string }>;
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
          <span className="pick-label">
            {it.label}
            <NameBadges badges={it.badges} />
          </span>
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

/** A row of inline action buttons (used in composers / profile sheets). */
export function ActionRow({ actions }: { actions: Action[] }) {
  return (
    <div className="actionrow">
      {actions.map((a, i) => (
        <button key={i} className={`choice ${a.tone ?? "ghost"} ${a.armed ? "armed" : ""}`} onClick={a.onClick} disabled={a.disabled} aria-pressed={a.armed || undefined}>
          {a.label}
          {a.armed && <span className="arm-line">{ARM_LINE}</span>}
        </button>
      ))}
    </div>
  );
}

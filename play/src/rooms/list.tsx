//! The room list + the two-pane shell (moved out of `chat.tsx` in wave 13):
//! one row per room, the Discord-style space sections, sidebar + stage.

import { useState, type ReactNode } from "react";
import { occupancyLabel } from "../presence.ts";
import type { Channel } from "../types.ts";
import { Avatar, Badge } from "../ui/primitives.tsx";
import { widgetLabel } from "../widgets.tsx";
import { foldRooms } from "./order.ts";
import { type SpaceGroup } from "./spaces.ts";
import { displayName, useKnownNames, type KnownNames } from "./names.ts";

// --- the sidebar (rooms) ------------------------------------------------------

/** The newest line a room's row previews: never a GENERATOR bark (barks
 *  live in the room's dim ticker, not its conversation). */
function lastSaid(c: Channel): Channel["messages"][number] | undefined {
  for (let i = c.messages.length - 1; i >= 0; i--) if (c.messages[i]!.ambient !== true) return c.messages[i];
  return undefined;
}

/** A room row's second line: the decision waiting, else the newest line. */
export function lastPreview(c: Channel, known?: KnownNames): string {
  const last = lastSaid(c);
  if (c.decision) return `▶ ${c.decision.title}`;
  if (!last) return "";
  if (last.kind === "widget" && last.widget) return widgetLabel(last.widget);
  if (last.kind === "codex" && last.codex) return `📓 ${last.codex.title}`;
  if (last.kind === "quest" && last.quest) return `📜 ${last.quest.title}${last.text ? `: ${last.text}` : ""}`;
  if (last.kind === "wallet" && last.wallet) return last.text;
  return last.kind === "line" ? `${last.from ? `${displayName(last.from, known)}: ` : ""}${last.text}` : last.text;
}

export function ChannelRow({
  channel,
  active,
  meId,
  onOpen,
  dot,
  sub: subOverride,
}: {
  channel: Channel;
  active?: boolean;
  meId?: string | null;
  onOpen: (id: string) => void;
  /** The guest's one badge kind (wave 18): a yellow dot, never a number;
   *  `false` = no badge at all. Absent = the booth's count. */
  dot?: boolean;
  /** The second line, instead of the preview ("chat room"). */
  sub?: string;
}) {
  const occupancy = occupancyLabel(channel, meId ?? null);
  const known = useKnownNames();
  // The guest's Chat log (the lobby): its own glyph, a fixed line, never a preview.
  const log = dot !== undefined && channel.id === "lobby";
  const sub = subOverride ?? (log ? (channel.subtitle ?? "") : channel.typing ? `${channel.typing} is typing…` : (channel.subtitle ?? lastPreview(channel, known)));
  const quiet = channel.kind === "location" && (channel.people?.length ?? 0) === 0 && channel.messages.length === 0 && !channel.here;
  return (
    <button
      className={`chrow ${active ? "active" : ""} ${channel.here ? "here" : ""} ${quiet ? "quiet" : ""}`}
      onClick={() => onOpen(channel.id)}
      aria-current={active ? "true" : undefined}
      data-tour={channel.tour}
    >
      {log ? (
        <div className="avatar lobby chat-log-avatar" aria-hidden>
          📜
        </div>
      ) : (
        <Avatar channel={channel} />
      )}
      <div className="chrow-body">
        <div className="chrow-top">
          <span className="chrow-title">{channel.title}</span>
          {channel.here && <span className="here-tag">you are here</span>}
          {!log && channel.decision && <span className="decision-dot">decision</span>}
          {!log && !channel.decision && channel.needsYou && <span className="decision-dot">your move</span>}
        </div>
        <div className="chrow-sub">
          {!log && occupancy && <span className="chrow-occ">{occupancy}</span>}
          {!log && occupancy && sub && <span className="chrow-dot"> · </span>}
          {sub}
        </div>
      </div>
      {dot === undefined ? <Badge count={channel.unread} /> : dot && !log ? <span className="guest-dot" aria-label="new" /> : null}
    </button>
  );
}

/** The sections with the folded rooms taken out (pure): each keeps its own
 *  title and order (a booth's "Messages" stays "Messages"), and a section
 *  left empty goes. */
export function foldSections(spaces: readonly SpaceGroup[], folded: readonly Channel[]): SpaceGroup[] {
  if (folded.length === 0) return [...spaces];
  const gone = new Set(folded.map((c) => c.id));
  return spaces.flatMap((s) => {
    const channels = s.channels.filter((c) => !gone.has(c.id));
    return channels.length > 0 ? [{ ...s, channels }] : [];
  });
}

/** The fold's button: "Other rooms (9)". */
export function otherRoomsLabel(n: number): string {
  return `Other rooms (${n})`;
}

/**
 * The Discord-style channel sidebar: channels folded into ordered space
 * sections, each with a header. A thin wrapper over `ChannelRow`. With
 * `fold`, the empty, quiet rooms (`rooms/order.ts` `foldRooms`) gather at
 * the foot behind one "Other rooms (n)" row, closed by default.
 */
export function SpaceList({
  spaces,
  activeId,
  meId,
  onOpen,
  header,
  empty,
  fold = false,
}: {
  spaces: SpaceGroup[];
  activeId?: string | null;
  meId?: string | null;
  onOpen: (id: string) => void;
  header?: ReactNode;
  empty?: ReactNode;
  /** Gather the empty rooms into "Other rooms (n)": `true` any quiet room
   *  (the guest's list), a predicate only the rooms it passes (the booth's). */
  fold?: boolean | ((c: Channel) => boolean);
}) {
  const [othersOpen, setOthersOpen] = useState(false);
  const all = spaces.flatMap((s) => s.channels);
  // `fold` may name which rooms are allowed to fold (a booth folds only the
  // house's empty rooms, never its own tools).
  const candidates = typeof fold === "function" ? all.filter(fold) : all;
  const { folded } = fold !== false ? foldRooms(candidates, activeId) : { folded: [] };
  const sections = foldSections(spaces, folded);
  const total = all.length;
  return (
    <div className="screen side">
      {header}
      <div className="chlist" data-tour="rooms">
        {total === 0 && <div className="empty">{empty ?? "No conversations yet."}</div>}
        {sections.map((s) => (
          <div key={s.id} className="space-section">
            <div className="space-title">{s.title}</div>
            {s.channels.map((c) => (
              <ChannelRow key={c.id} channel={c} active={c.id === activeId} meId={meId} onOpen={onOpen} />
            ))}
          </div>
        ))}
        {folded.length > 0 && (
          <div className="space-section rooms-fold">
            <button type="button" className="rooms-fold-btn" aria-expanded={othersOpen} onClick={() => setOthersOpen((v) => !v)}>
              <span aria-hidden>{othersOpen ? "▾" : "▸"}</span> {otherRoomsLabel(folded.length)}
            </button>
            {othersOpen && folded.map((c) => <ChannelRow key={c.id} channel={c} active={c.id === activeId} meId={meId} onOpen={onOpen} />)}
          </div>
        )}
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

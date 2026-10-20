//! The room list + the two-pane shell (moved out of `chat.tsx` in wave 13):
//! one row per room, the Discord-style space sections, sidebar + stage.

import type { ReactNode } from "react";
import { occupancyLabel } from "../presence.ts";
import type { Channel } from "../types.ts";
import { Avatar, Badge } from "../ui/primitives.tsx";
import { widgetLabel } from "../widgets.tsx";
import { prettyName, type SpaceGroup } from "./spaces.ts";

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

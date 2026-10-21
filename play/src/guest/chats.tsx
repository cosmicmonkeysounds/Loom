//! The Chats window (wave 18, GUEST-SPEC §3): the rooms list in fixed
//! sections (`rooms/chats.ts`), one badge kind (a dot), and Other rooms (n)
//! folded with the 📜 Chat log last.

import { useState } from "react";
import { ChannelRow } from "../rooms/list.tsx";
import { guestDot, otherRoomsLabelOf, type Chats } from "../rooms/chats.ts";
import type { Channel } from "../types.ts";

/** A quiet chatroom's line under Other rooms. */
export const QUIET_ROOM_SUB = "chat room";

function quietSub(c: Channel): string | undefined {
  return c.kind === "open" || c.kind === "private" || c.kind === "group" || c.kind === "faction" ? QUIET_ROOM_SUB : undefined;
}

export function ChatsWindow({ chats, activeId, meId, onOpen }: { chats: Chats; activeId: string | null; meId: string; onOpen: (id: string) => void }) {
  const [othersOpen, setOthersOpen] = useState(false);
  const empty = chats.sections.length === 0 && chats.other.length === 0;
  return (
    <div className="screen side chats" data-tour="chats-list">
      <div className="chlist" data-tour="rooms">
        {empty && <div className="empty">Quiet… for now.</div>}
        {chats.sections.map((s) => (
          <div key={s.id} className="space-section chats-section">
            <div className="space-title">{s.title}</div>
            {s.channels.map((c) => (
              <ChannelRow key={c.id} channel={c} active={c.id === activeId} meId={meId} onOpen={onOpen} dot={guestDot(c)} />
            ))}
          </div>
        ))}
        {chats.other.length > 0 && (
          <div className="space-section rooms-fold">
            <button type="button" className="rooms-fold-btn" aria-expanded={othersOpen} onClick={() => setOthersOpen((v) => !v)}>
              <span aria-hidden>{othersOpen ? "▾" : "▸"}</span> {otherRoomsLabelOf(chats.other.length)}
            </button>
            {othersOpen &&
              chats.other.map((c) => <ChannelRow key={c.id} channel={c} active={c.id === activeId} meId={meId} onOpen={onOpen} dot={guestDot(c)} sub={quietSub(c)} />)}
          </div>
        )}
      </div>
    </div>
  );
}

//! 👥 People on a player's booth (wave 21, P4): a simple searchable list of
//! every program — picture, name, where they stand — with MARKED / IN THE
//! INTERNET tags only for a booth that claims escorts (an Antivirus). A tap
//! opens their card. No tabs, no last-seen, no story flags: the hosts'
//! 🗂 Guests is the director's tool, this is a player's.

import { useState } from "react";
import type { PrimeGuest, PrimeView } from "../types.ts";
import { PersonAvatar } from "../ui/primitives.tsx";
import { Icon } from "../chrome/icons.tsx";
import { GuestBadges } from "./badges.tsx";
import { BoothLayer } from "./layer.tsx";
import { filterGuests, statusTag } from "./model.ts";
import { wantedOf } from "./wire.ts";

/** A row's one tag on a player's People: MARKED / INTERNET for a claimer only. */
export function peopleTag(g: PrimeGuest, view: PrimeView | null, claimer: boolean): { text: string; tone: "marked" | "internet" } | null {
  if (!claimer) return null;
  const t = statusTag(g, { wanted: wantedOf(view) });
  if (t === null) return null;
  if (t.tone === "marked") return { text: "MARKED", tone: "marked" };
  if (t.tone === "internet") return { text: "IN THE INTERNET", tone: "internet" };
  return null;
}

export function PeopleSheet({ view, claimer, onPick, onClose }: { view: PrimeView | null; claimer: boolean; onPick: (guestId: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const guests = view?.guests ?? [];
  const rooms = new Map((view?.channels ?? []).filter((c) => c.id.startsWith("loc:")).map((c) => [c.id.slice(4), c.title]));
  const hits = filterGuests(guests, q);
  return (
    <BoothLayer
      title={
        <span className="booth-layer-title">
          <Icon name="people" /> People ({guests.length})
        </span>
      }
      label="People"
      onClose={onClose}
    >
      <div className="booth-guests">
        <input className="w95-inset booth-search" type="search" placeholder="Search by name" aria-label="Search people" value={q} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => setQ(e.target.value)} />
        {guests.length === 0 && <p className="booth-none">Nobody yet. Programs appear here as they sign in.</p>}
        {guests.length > 0 && hits.length === 0 && <p className="booth-none">Nobody matches “{q.trim()}”.</p>}
        <ul className="booth-guest-list">
          {hits.map((g) => {
            const tag = peopleTag(g, view, claimer);
            const where = g.location !== null ? (rooms.get(g.location) ?? g.location) : null;
            return (
              <li key={g.id}>
                <button type="button" className="booth-guest" onClick={() => onPick(g.id)}>
                  <PersonAvatar name={g.name} size="sm" />
                  <span className="booth-guest-body">
                    <span className="booth-guest-name">
                      {g.name}
                      <GuestBadges id={g.id} />
                      {tag !== null && <span className={`booth-tag ${tag.tone}`}>{tag.text}</span>}
                    </span>
                    <span className="booth-guest-sub">📍 {where ?? "not in a room"}</span>
                  </span>
                  <span className="booth-guest-go" aria-hidden>
                    ›
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </BoothLayer>
  );
}

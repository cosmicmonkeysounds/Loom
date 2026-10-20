//! 🗂 Guests (wave 13): every guest in the event, searchable by name or id,
//! each row with where they stand and the fact that matters most. A tap
//! opens their card — the booth's way to a guest who isn't in front of the
//! camera (a dead phone, a readout to follow up).

import { useState } from "react";
import type { PrimeView } from "../types.ts";
import { PersonAvatar } from "../ui/primitives.tsx";
import { BoothLayer } from "./layer.tsx";
import { factChips, filterGuests } from "./model.ts";

export function GuestsSheet({ view, onPick, onClose }: { view: PrimeView | null; onPick: (guestId: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const guests = view?.guests ?? [];
  const hits = filterGuests(guests, q);
  const whereOf = (loc: string | null) => (loc === null ? null : (view?.channels.find((c) => c.id === `loc:${loc}`)?.title ?? loc));
  return (
    <BoothLayer title={`🗂 Guests (${guests.length})`} label="Guests" onClose={onClose}>
      <div className="booth-guests">
        <input
          className="w95-inset booth-search"
          type="search"
          placeholder="Search by name or id"
          aria-label="Search guests"
          value={q}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
        />
        {guests.length === 0 && <p className="booth-none">No guests yet. They appear here as they sign in.</p>}
        {guests.length > 0 && hits.length === 0 && <p className="booth-none">Nobody matches “{q.trim()}”.</p>}
        <ul className="booth-guest-list">
          {hits.map((g) => {
            const chips = factChips(g, whereOf(g.location));
            const lead = chips.slice(0, 2);
            return (
              <li key={g.id}>
                <button type="button" className="booth-guest" onClick={() => onPick(g.id)}>
                  <PersonAvatar name={g.name} size="sm" />
                  <span className="booth-guest-body">
                    <span className="booth-guest-name">{g.name}</span>
                    <span className="booth-guest-sub">
                      {lead.length === 0
                        ? g.id
                        : lead.map((c, n) => (
                            <span key={c.text} className={c.tone !== "quiet" ? "loud" : ""}>
                              {n > 0 ? " · " : ""}
                              {c.text}
                            </span>
                          ))}
                    </span>
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

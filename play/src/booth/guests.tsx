//! 🗂 Guests (wave 13, tabs since wave 18, BOOTH-SPEC §4.11): every guest in
//! the event, searchable by name or id, behind five tabs — Here (one room,
//! picked from a list and kept for the sign-in), Marked, Internet, Missing
//! and All. Each row: the name and one status tag, then always the place,
//! then at most two loud facts. Marked programs lead every tab. A tap opens
//! their card — the booth's way to a guest who isn't in front of the camera.

import { useState } from "react";
import type { PrimeView } from "../types.ts";
import { PersonAvatar } from "../ui/primitives.tsx";
import { usePlayHost } from "../host.ts";
import { Icon } from "../chrome/icons.tsx";
import { BoothLayer } from "./layer.tsx";
import { defaultGuestTab, defaultHere, filterGuests, guestSort, guestTab, hasMissingTab, loudLine, placeLine, statusTag, type GuestListCtx, type GuestTab } from "./model.ts";
import { wantedOf } from "./wire.ts";

const TABS: Array<{ id: GuestTab; label: string }> = [
  { id: "here", label: "Here" },
  { id: "marked", label: "Marked" },
  { id: "internet", label: "Internet" },
  { id: "missing", label: "Missing" },
  { id: "all", label: "All" },
];

const HERE_KEY = (token: string | null) => `loom.booth.here.${token ?? "anon"}`;

/** The live summons objective's pick (the Missing tab follows it while it runs). */
export function summonsPick(view: PrimeView | null): string[] | null {
  const o = (view?.objectives ?? []).find((x) => /summons/iu.test(`${x.id} ${x.title}`) && Array.isArray((x as { pick?: unknown }).pick));
  return o !== undefined ? ((o as { pick?: string[] }).pick ?? null) : null;
}

export function GuestsSheet({ view, me = "", session = null, now = 0, onPick, onClose }: { view: PrimeView | null; me?: string; session?: string | null; now?: number; onPick: (guestId: string) => void; onClose: () => void }) {
  const host = usePlayHost();
  const guests = view?.guests ?? [];
  const ctx: GuestListCtx = { wanted: wantedOf(view), me, now, summons: summonsPick(view) };
  const rooms = (view?.channels ?? []).filter((c) => c.id.startsWith("loc:")).map((c) => ({ id: c.id.slice(4), title: c.title }));
  const whereOf = (loc: string | null) => (loc === null ? null : (rooms.find((r) => r.id === loc)?.title ?? loc));
  const nowPick = (view?.objectives?.[0] as { pick?: string[] } | undefined)?.pick ?? null;
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<GuestTab>(() => defaultGuestTab(guests, ctx));
  const [here, setHereState] = useState<string | null>(() => {
    try {
      const kept = host.storage.load<string>(HERE_KEY(session));
      if (typeof kept === "string" && kept !== "") return kept;
    } catch {
      /* a private window */
    }
    return defaultHere(guests, nowPick, rooms.map((r) => r.id));
  });
  const setHere = (loc: string) => {
    setHereState(loc);
    try {
      host.storage.save(HERE_KEY(session), loc);
    } catch {
      /* kept in memory */
    }
  };
  const missing = hasMissingTab(guests, ctx);
  const tabs = TABS.filter((t) => t.id !== "missing" || missing);
  const count = (t: GuestTab) => guests.filter((g) => guestTab(g, t, ctx, here)).length;
  const searched = filterGuests(guests, q);
  // A search looks across everyone; otherwise the tab narrows the list.
  const hits = guestSort(q.trim() !== "" ? searched : searched.filter((g) => guestTab(g, tab, ctx, here)), ctx);
  const empty =
    tab === "here" ? `Nobody is standing in ${whereOf(here) ?? "that room"}.` : tab === "marked" ? "Nobody is marked." : tab === "missing" ? "Everyone has been seen in the last 10 minutes." : tab === "internet" ? "Nobody is in the Internet." : "No guests yet. They appear here as they sign in.";
  return (
    <BoothLayer
      title={
        <span className="booth-layer-title">
          <Icon name="people" /> Guests ({guests.length})
        </span>
      }
      label="Guests"
      onClose={onClose}
    >
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
        <div className="booth-tabs" role="tablist" aria-label="Which guests">
          {tabs.map((t) => {
            const n = count(t.id);
            return (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`booth-tab ${tab === t.id ? "current" : ""} ${n === 0 ? "zero" : ""}`} onClick={() => setTab(t.id)}>
                {t.label} {n}
              </button>
            );
          })}
        </div>
        {tab === "here" && q.trim() === "" && rooms.length > 0 && (
          <label className="booth-here">
            <span>📍 Here:</span>
            <select className="w95-inset" value={here ?? ""} onChange={(e) => setHere(e.target.value)}>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {guests.length === 0 && <p className="booth-none">No guests yet. They appear here as they sign in.</p>}
        {guests.length > 0 && hits.length === 0 && <p className="booth-none">{q.trim() !== "" ? `Nobody matches “${q.trim()}”.` : empty}</p>}
        <ul className="booth-guest-list">
          {hits.map((g) => {
            const tag = statusTag(g, ctx);
            const loud = loudLine(g, ctx);
            return (
              <li key={g.id}>
                <button type="button" className="booth-guest" onClick={() => onPick(g.id)}>
                  <PersonAvatar name={g.name} size="sm" />
                  <span className="booth-guest-body">
                    <span className="booth-guest-name">
                      {g.name}
                      {tag !== null && <span className={`booth-tag ${tag.tone}`}>{tag.text}</span>}
                    </span>
                    <span className="booth-guest-sub">{placeLine(g, whereOf(g.location), ctx)}</span>
                    {loud.length > 0 && <span className="booth-guest-sub loud">{loud.join(" · ")}</span>}
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

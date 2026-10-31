//! People: every guest online, searchable, with what a host does to one
//! person — open their card in the booth, end a stale Bathroom Mode, restrict
//! / unrestrict (asks first), 👋 went home / back, a 🔁 re-pair QR for a lost
//! phone, and scan as another character (a late arrival's clearance). Wave
//! 59: the rescue tools need the offline too (a lost phone is offline), so
//! they sit behind one switch, off each time the list opens; 🗂 Guests keeps
//! everyone.

import { useState } from "react";
import { PassQr } from "../pass-qr.tsx";
import { NameBadges, PersonAvatar, PickerSheet, Sheet } from "../ui/primitives.tsx";
import { badgesOf } from "../guest/wire.ts";
import type { HostPerson } from "../types.ts";
import type { PairCode } from "./api.ts";
import { bathroomTag, filterPeople, inBathroom, onlineCount, peoplePool, personLine, seenText } from "./model.ts";
import { ActButton, ConfirmButton, HostEmpty, useHost } from "./kit.tsx";

export function PeopleTab() {
  const { view, now } = useHost();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const online = onlineCount(view.people, now);
  const away = view.people.length - online;
  const count = offline ? view.people.length : online;
  const shown = filterPeople(peoplePool(view.people, { offline, open, now }), query);
  return (
    <div className="host-people">
      <input className="host-filter" type="search" aria-label="Find a guest" placeholder={`Find a guest (${count})`} value={query} onChange={(e) => setQuery(e.target.value)} />
      {away > 0 && (
        <label className="host-switch">
          <input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} /> Offline ({away}){/* DRAFT w59 */}
        </label>
      )}
      {view.people.length === 0 ? (
        <HostEmpty>No guests yet. They appear here as they join.</HostEmpty>
      ) : shown.length === 0 ? (
        <HostEmpty>{query.trim() !== "" ? `Nobody ${offline ? "" : "online "}matches “${query.trim()}”.` : "Nobody online."}{/* DRAFT w59 */}</HostEmpty>
      ) : (
        <ul className="host-rows">
          {shown.map((p) => (
            <PersonRow key={p.id} p={p} open={open === p.id} onToggle={() => setOpen((o) => (o === p.id ? null : p.id))} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PersonRow({ p, open, onToggle }: { p: HostPerson; open: boolean; onToggle: () => void }) {
  const { view, calls, run, now, openCard, session } = useHost();
  const [pair, setPair] = useState<PairCode | null>(null);
  const [scanning, setScanning] = useState(false);
  const bathroom = inBathroom(p);
  const line = personLine(p);
  const seen = p.online === true ? null : seenText(p.lastSeen, now);
  return (
    <li className={`host-person ${open ? "open" : ""} ${p.gone === true ? "gone" : ""}`}>
      <button type="button" className="host-row-btn" aria-expanded={open} onClick={onToggle}>
        <PersonAvatar name={p.name} size="sm" />
        <span className="host-person-body">
          <span className="host-person-name">
            {p.name}
            <NameBadges badges={badgesOf(p)} />
            {p.persona === true && <span className="host-tag">persona</span>}
            {p.restricted && <span className="host-tag alarm">⛔ restricted</span>}
            {bathroomTag(p) && <span className="host-tag">🚻 bathroom</span>}
          </span>
          {line !== "" && <span className="host-person-line">{line}</span>}
          {seen !== null && <span className="host-person-seen">{seen}</span>}
        </span>
        <span className="host-chev" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="host-actions">
          <button type="button" className="w95-btn" onClick={() => openCard(p.id)}>
            🗂 Open card
          </button>
          {bathroom && <ActButton label="🚻 End Bathroom Mode" onClick={() => run(`🚻 ${p.name} is back`, () => calls.backFromBathroom(p.id))} />}
          <ConfirmButton
            label={p.restricted ? "⛔ Unrestrict" : "⛔ Restrict"}
            ask={p.restricted ? `Give ${p.name} their phone back?` : `Grey out ${p.name}'s phone?`}
            danger={!p.restricted}
            onConfirm={() => run(p.restricted ? `${p.name} unrestricted` : `⛔ ${p.name} restricted`, () => calls.restrict(p.id, !p.restricted))}
          />
          <ActButton label={p.gone === true ? "👋 Back" : "👋 Went home"} onClick={() => run(p.gone === true ? `${p.name} is back` : `👋 ${p.name} went home`, () => calls.gone(p.id, p.gone !== true))} />
          {p.persona !== true && (
            <ActButton
              label="🔁 Re-pair"
              title="A single-use QR for a lost phone"
              onClick={async () => {
                try {
                  setPair(await calls.pair(p.id));
                } catch (e) {
                  void run("", () => Promise.reject(e));
                }
              }}
            />
          )}
          {p.persona !== true && <ConfirmButton label="⏏ Release" ask={`Sign ${p.name}'s phone out? Their badge signs them in again on any phone.`} danger onConfirm={() => run(`⏏ ${p.name}'s phone is signed out`, () => calls.releaseGuest(p.id))} />}
          {view.parts.length > 0 && (
            <button type="button" className="w95-btn" onClick={() => setScanning(true)}>
              📡 Scan as…
            </button>
          )}
        </div>
      )}
      {pair !== null && <PairSheet pair={pair} now={now} onClose={() => setPair(null)} />}
      {scanning && (
        <PickerSheet
          title={`Scan ${p.name} as…`}
          items={view.parts.map((c) => ({ id: c.id, label: c.id, sub: c.id === session.auth?.character ? "you" : undefined }))}
          onPick={(as) => void run(`📡 Scanned ${p.name} as ${as}`, () => calls.scanAs(as, p.id))}
          onClose={() => setScanning(false)}
        />
      )}
    </li>
  );
}

/** The re-pair QR, shown big so the guest's new phone can scan it. */
function PairSheet({ pair, now, onClose }: { pair: PairCode; now: number; onClose: () => void }) {
  const left = Math.max(0, Math.round((pair.expiresAt - now) / 60_000));
  return (
    <Sheet title={`🔁 Re-pair ${pair.name}`} onClose={onClose}>
      <div className="host-pair">
        <PassQr text={pair.url} alt={`Re-pair QR for ${pair.name}`} />
        <p>Have {pair.name} scan this with their new phone. It works once{pair.expiresAt > 0 ? `, for ${left} more minute${left === 1 ? "" : "s"}` : ""}.</p>
      </div>
    </Sheet>
  );
}


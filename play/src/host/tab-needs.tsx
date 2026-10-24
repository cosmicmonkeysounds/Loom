//! Needs: what waits on a host right now (host-board's `hostNeeds` — near
//! misses, held transfers, Trabolta's worker, offline parts, unseen guests,
//! silent terminals) plus this booth's refused press with its `# hosts`
//! reason. Each row takes the host where they act on it. Wave 18 (§5.5):
//! escorts waiting lead — `🚨 n marked · m nobody on it`, opening the
//! Wanted board read-only (a host claims nothing: they radio an Antivirus).

import type { HostNeed } from "../types.ts";
import type { RejoinAsk } from "../../../core/src/host-board.ts";
import { useState } from "react";
import { groupNeeds, hostWanted, needSection, needTab, refusedText, rejoinDetail, wantedLine, wantedNeed, type RefusedPress, type WantedLike } from "./model.ts";
import { ActButton, HostEmpty, useHost } from "./kit.tsx";

export function NeedsTab({ refused, reason }: { refused: RefusedPress | null; reason: string | null }) {
  const { view, now, go, openRoom } = useHost();
  const staff = view.staffRooms[0] ?? null;
  const wanted = hostWanted(view);
  const escorts = wantedNeed(wanted);
  const open = (n: HostNeed) => {
    const t = needTab(n.target);
    if (t === "staff") {
      if (staff !== null) openRoom(staff);
      return;
    }
    go(t, needSection(n));
  };
  const asks = view.rejoins ?? [];
  if (refused === null && view.needs.length === 0 && escorts === null && asks.length === 0) {
    return <HostEmpty>Nothing needs you. Near misses, held transfers, a silent terminal or Trabolta's worker going quiet show up here.</HostEmpty>;
  }
  return (
    <ul className="host-rows host-needs">
      {asks.map((a) => (
        <RejoinRow key={a.request} ask={a} />
      ))}
      {escorts !== null && <EscortsRow wanted={wanted} text={escorts.text} />}
      {refused !== null && (
        <li className="host-need refused">
          <button type="button" className="host-row-btn" disabled={staff === null} onClick={() => staff !== null && openRoom(staff)}>
            <span className="host-need-text">{refusedText(refused, reason, now)}</span>
            {staff !== null && <span className="host-need-go">Open # hosts ›</span>}
          </button>
        </li>
      )}
      {groupNeeds(view.needs).map((n) => (
        <li key={n.key} className={`host-need ${n.kind}`}>
          <button type="button" className="host-row-btn" onClick={() => open(n)}>
            <span className="host-person-body">
              <span className="host-need-text">{n.text}</span>
              {n.detail !== undefined && <span className="host-need-detail">{n.detail}</span>}
            </span>
            <span className="host-need-go" aria-hidden="true">
              ›
            </span>
          </button>
          {n.guests !== undefined && n.guests.length > 0 && <UnseenGuests guests={n.guests} />}
        </li>
      ))}
    </ul>
  );
}

/** Wave 23: a phone asking to be a joined guest again. Check it's them
 *  (their face, their badge), then let them in — or don't. */
function RejoinRow({ ask }: { ask: RejoinAsk }) {
  const { calls, run, now } = useHost();
  return (
    <li className="host-need rejoin" data-testid="host-need-rejoin">
      <div className="host-row-btn">
        <span className="host-person-body">
          <span className="host-need-text">🔁 {ask.name} wants back in</span>
          <span className="host-need-detail">{rejoinDetail(ask, now)}</span>
        </span>
      </div>
      <ul className="host-subrows">
        <li className="host-subrow">
          <ActButton label="✅ Let them in" onClick={() => run(`🔁 ${ask.name} is back in`, () => calls.rejoin(ask.request, true))} />
          <ActButton label="✋ Not them" onClick={() => run(`✋ Said no to ${ask.name}`, () => calls.rejoin(ask.request, false))} />
        </li>
      </ul>
    </li>
  );
}

/** The 👋 unseen-30-min need: each guest with Went home, in place. */
function UnseenGuests({ guests }: { guests: NonNullable<HostNeed["guests"]> }) {
  const { calls, run } = useHost();
  return (
    <ul className="host-subrows">
      {guests.map((g) => (
        <li key={g.id} className="host-subrow">
          <span className="host-subrow-name">{g.name}</span>
          <ActButton label="👋 Went home" onClick={() => run(`👋 ${g.name} went home`, () => calls.gone(g.id, true))} />
        </li>
      ))}
    </ul>
  );
}

/** Escorts waiting: the booth's read-only Wanted board when it supplies
 *  one (`openWanted`), else the loose programs listed in place, read-only
 *  (a card opens from a name). Captured ones are left out. */
function EscortsRow({ wanted, text }: { wanted: WantedLike[]; text: string }) {
  const { now, openWanted, openCard } = useHost();
  const [open, setOpen] = useState(false);
  const loose = wanted.filter((w) => !w.captured).sort((a, b) => Number(a.claimedBy !== null && a.claimedBy !== "") - Number(b.claimedBy !== null && b.claimedBy !== "") || b.markedAt - a.markedAt);
  return (
    <li className="host-need wanted" data-testid="host-need-wanted">
      <button type="button" className="host-row-btn" aria-expanded={openWanted === undefined ? open : undefined} onClick={() => (openWanted !== undefined ? openWanted() : setOpen((o) => !o))}>
        <span className="host-need-text">{text}</span>
        <span className="host-need-go" aria-hidden="true">
          {openWanted !== undefined ? "›" : open ? "▾" : "▸"}
        </span>
      </button>
      {openWanted === undefined && open && (
        <ul className="host-subrows" aria-label="Marked programs">
          {loose.map((w) => (
            <li key={w.id} className="host-subrow">
              <button type="button" className="host-row-btn host-wanted-row" onClick={() => openCard(w.id)}>
                <span className="host-person-body">
                  <span className="host-person-name">{w.name}</span>
                  {w.reason !== null && w.reason !== "" && <span className="host-person-line">{w.reason}</span>}
                  <span className="host-person-line">{wantedLine(w, now)}</span>
                </span>
              </button>
            </li>
          ))}
          <li className="host-note">Radio an Antivirus.</li>
        </ul>
      )}
    </li>
  );
}

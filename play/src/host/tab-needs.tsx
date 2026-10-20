//! Needs: what waits on a host right now (host-board's `hostNeeds` — near
//! misses, held transfers, Trabolta's worker, offline parts, unseen guests,
//! silent terminals) plus this booth's refused press with its `# hosts`
//! reason. Each row takes the host where they act on it.

import type { HostNeed } from "../types.ts";
import { groupNeeds, needSection, needTab, refusedText, type RefusedPress } from "./model.ts";
import { ActButton, HostEmpty, useHost } from "./kit.tsx";

export function NeedsTab({ refused, reason }: { refused: RefusedPress | null; reason: string | null }) {
  const { view, now, go, openRoom } = useHost();
  const staff = view.staffRooms[0] ?? null;
  const open = (n: HostNeed) => {
    const t = needTab(n.target);
    if (t === "staff") {
      if (staff !== null) openRoom(staff);
      return;
    }
    go(t, needSection(n));
  };
  if (refused === null && view.needs.length === 0) {
    return <HostEmpty>Nothing needs you. Near misses, held transfers, a silent terminal or Trabolta's worker going quiet show up here.</HostEmpty>;
  }
  return (
    <ul className="host-rows host-needs">
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

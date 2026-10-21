//! The Me sheet (wave 18, GUEST-SPEC §8.1, DECISIONS G8 / Q21): your
//! picture, your name, where you are, your Truthcoin, every group you are
//! in as a badge, your pass, Change my picture, Sides & crews, and the
//! phone's settings. A join adds a badge; nothing ever replaces the sheet.
//! (It replaces the dead `ProfileSheet` / `IdentityCard`.)

import { Icon, IconTitle } from "../chrome/icons.tsx";
import type { GuestView } from "../types.ts";
import { NameBadges, PersonAvatar, Sheet } from "../ui/primitives.tsx";
import { badgesOf, canFoundOf } from "./wire.ts";
import { factionModeOf } from "../sides/model.ts";

export interface MeBadge {
  name: string;
  kind: "side" | "crew" | "group";
}

/** Every group the guest is in, as badges (pure): the sides (◆) first, then
 *  any other group, then the crew (◇). */
export function meBadges(view: Pick<GuestView, "faction" | "groups" | "factions" | "crew" | "sides">): MeBadge[] {
  const crew = view.crew ?? null;
  const sides = new Set([...(view.factions ?? []), ...(Array.isArray(view.sides) ? view.sides : []).map((s) => s.name)]);
  const names = [...(view.groups ?? [])];
  if (view.faction !== null && !names.includes(view.faction)) names.unshift(view.faction);
  const out: MeBadge[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    if (seen.has(n) || (crew !== null && n === crew.name)) continue;
    seen.add(n);
    out.push({ name: n, kind: sides.has(n) || n === view.faction ? "side" : "group" });
  }
  out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "side" ? -1 : 1));
  if (crew !== null) out.push({ name: crew.name, kind: "crew" });
  return out;
}

export function MeSheet({
  view,
  where,
  wake,
  push,
  sides,
  onPass,
  onPicture,
  onSides,
  onAlerts,
  onClose,
}: {
  view: GuestView;
  where: string;
  wake: { supported: boolean; on: boolean; toggle: () => void } | null;
  /** The phone can get alerts (`pushOffered`). */
  push: boolean;
  /** Sides are open or the guest has a crew (a faction you may found
   *  shows the row too, wave 18b). */
  sides: boolean;
  onPass: () => void;
  onPicture: () => void;
  onSides: () => void;
  onAlerts: () => void;
  onClose: () => void;
}) {
  const badges = meBadges(view);
  // Wave 18b, faction mode: "Factions", offered while you may found one too.
  const factions = factionModeOf(view);
  const showSides = sides || canFoundOf(view);
  return (
    <Sheet title={<IconTitle icon="people">Me</IconTitle>} onClose={onClose} tall>
      <div className="me-sheet">
        <div className="me-head">
          <PersonAvatar name={view.name} size="lg" />
          <div className="me-head-body">
            <strong className="me-name">
              {view.name}
              <NameBadges badges={badgesOf(view)} />
            </strong>
            <span className="me-where">{where}</span>
            {view.wallet !== undefined && (
              <span className="me-coin">
                <Icon name="coin" className="ico-inline" /> {view.wallet.balance} {view.wallet.name}
              </span>
            )}
          </div>
        </div>
        <div className="sheet-h">BADGES</div>
        {badges.length === 0 ? (
          <p className="me-none">No badges yet.</p>
        ) : (
          <div className="me-badges">
            {badges.map((b) => (
              <span key={`${b.kind}:${b.name}`} className={`me-badge ${b.kind}`}>
                {b.kind === "crew" && !factions ? "◇" : "◆"} {b.name}
              </span>
            ))}
          </div>
        )}
        <button type="button" className="choice me-row" onClick={onPass}>
          <Icon name="pass" /> Show my pass
        </button>
        <button type="button" className="choice me-row" onClick={onPicture}>
          <Icon name="picture" /> Change my picture <span aria-hidden>›</span>
        </button>
        {showSides && (
          <button type="button" className="choice me-row" onClick={onSides}>
            <Icon name="door" /> {factions ? "Factions" : "Sides & crews"} <span aria-hidden>›</span>
          </button>
        )}
        {(wake !== null && wake.supported) || push ? <div className="sheet-h">SETTINGS</div> : null}
        {wake !== null && wake.supported && (
          <button type="button" className="choice me-row" aria-pressed={wake.on} onClick={wake.toggle}>
            <span className="w95-check" aria-hidden>
              {wake.on ? "☑" : "☐"}
            </span>{" "}
            Keep my screen on
          </button>
        )}
        {push && (
          <button type="button" className="choice me-row" onClick={onAlerts}>
            <Icon name="bell" /> Get alerts on this phone <span aria-hidden>›</span>
          </button>
        )}
      </div>
    </Sheet>
  );
}

//! K-12 — what the Run → Print sheet needs beyond the codex links that
//! `/api/mod/codes` already lists: the **join poster** link and one **room
//! check-in sign** per LOCATION a guest can check into (K-13's
//! `…/?code=<event>&checkin=<slug>`; the play app posts the slug to
//! `/api/guest/checkin`, which folds it back onto the exact LOCATION).
//!
//! It also lists the **cast cards** (SW-QR-11: one per performer part, the
//! same parts the booth's cast picker offers) and, per codex entry, the
//! **fact stack** it belongs to (K-12-stacks: colour + pile + hiding place,
//! from the project's `facts.json`), so the sheet can sort and band the
//! posters instead of a director sorting ~60 by hand.
//!
//! Wave 54: one **sign** per guest button the story marks `qr:` (the show:
//! 🚻 Bathroom Mode): `…/?code=<event>&act=<interaction>`. The app presses
//! that button for whoever scans it, the same press as the one in ⊞ Start.
//!
//! Wave 59: every printed QR has a text code, and typing it does what the QR
//! does (`routes/printed.ts`). A room's is `R-` and a sign's `S-` plus four
//! characters off the event's claim secret and the LOCATION's or button's
//! folded name: a story edit leaves them alone, a rename retires them. A room
//! sign's big text is in-world (`inWorldLabel`); `place` keeps the crew's note
//! for the screen-only line on Run's print sheet.
//!
//! Pure: the codes route spreads `printExtras(…)` into its response. The QR
//! images themselves are drawn in the editor (`qrcode`), never via
//! `/api/qr` — a sheet of 60–80 codes would trip its 60/min limit.

import { foldName } from "../../src/parser/names.ts";
import { inWorldLabel, type SimModel } from "../../src/runtime/sim/model.ts";
import type { FactsFile } from "../../src/facts.ts";
import { identityDefs, performerPickable, secretCode } from "../identity.ts";

export interface CheckinSign {
  /** The exact declared LOCATION name. */
  id: string;
  /** The LOCATION's `label:` (else its name), in-world — the big text on the sign. */
  label: string;
  /** The `checkin=` value: the name in kebab case (`the-start-bar`). */
  slug: string;
  /** The text code printed under the QR (`R-K7QM`). */
  code: string;
  /** The whole `label:` when it says more than `label`: the crew's, never printed. */
  place: string | null;
  url: string;
  /** `hidden: true` — the sign only works once the story opens the room. */
  hidden: boolean;
}

/** A printed sign that presses a guest's button (`qr:` on the INTERACTION). */
export interface ActionSign {
  /** The INTERACTION's name: the `act=` value. */
  name: string;
  /** Its button label: the big text on the sign. */
  label: string;
  /** The `qr:` line: what the sign tells a guest. */
  line: string;
  /** The text code printed under the QR (`S-K7QM`). */
  code: string;
  url: string;
}

/** Which printed pile a codex poster goes in (`facts.json`). */
export interface CodexStack {
  /** `gold` (a hunt answer), `silver` (one of the door's digit notes) or
   *  the category's `colour` (green / blue / red). */
  colour: string;
  /** The pile: `hunt answers`, `the cold door's digits`, or the
   *  category's `stack` (where it hides). */
  stack: string;
  /** This document's own hiding place (a hunt answer's or a digit note's
   *  `where`), or
   *  `already placed` for a hand-written entry; null = the stack says it. */
  where: string | null;
}

export interface PrintExtras {
  /** The join poster's link: `<base>/?code=<event>`. */
  joinLink: string;
  checkin: CheckinSign[];
  /** Signs that press a guest's button (wave 54). */
  actions: ActionSign[];
  /** The performer parts a cast card is printed for (declaration order). */
  cast: string[];
  /** Codex entry id → its stack; an entry the facts file doesn't place is absent. */
  stacks: Record<string, CodexStack>;
}

/** The hunt answers' colour (matches `titi-facts.ts`'s `huntColour`). */
export const HUNT_COLOUR = "gold";

/** The door's digit notes (`door.clues`): their own pile, one room each
 *  (matches `titi-facts.ts`'s `clueColour` / `clueStack`). */
export const CLUE_COLOUR = "silver";
export const CLUE_STACK = "the cold door's digits";

/** Characters after a room or sign code's `R-` / `S-`. 20 bits: nothing to
 *  guard, a room's QR is no secret; short enough to read off a wall. */
export const PLACE_CODE_LENGTH = 4;

/** A room sign's text code. */
export function roomCode(secret: string, location: string): string {
  return `R-${secretCode(secret, `room:${foldName(location)}`, PLACE_CODE_LENGTH).toUpperCase()}`;
}

/** A sign's text code. */
export function signCode(secret: string, name: string): string {
  return `S-${secretCode(secret, `sign:${foldName(name)}`, PLACE_CODE_LENGTH).toUpperCase()}`;
}

/** `The Server Room` → `the-server-room` (folds back via `foldName`). */
export function checkinSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
}

/** Every LOCATION a check-in sign makes sense for: never a prison (only
 *  the story releases), never a cutscene (on rails — the Optical Drive), and
 *  never a `checkin: false` room (the locked Server Room: a visit would
 *  reveal it early). */
export function checkinSigns(model: Pick<SimModel, "locations">, base: string, eventCode: string, secret: string): CheckinSign[] {
  const out: CheckinSign[] = [];
  for (const loc of model.locations.values()) {
    if (loc.prison || loc.cutscene || !loc.checkin) continue;
    const slug = checkinSlug(loc.id);
    const label = inWorldLabel(loc.label ?? loc.id);
    out.push({
      id: loc.id,
      label,
      slug,
      code: roomCode(secret, loc.id),
      place: loc.label !== null && loc.label !== label ? loc.label : null,
      url: `${base}/?code=${encodeURIComponent(eventCode)}&checkin=${encodeURIComponent(slug)}`,
      hidden: loc.hidden,
    });
  }
  return out;
}

/** The guest buttons the story prints a sign for. */
export function actionSigns(model: Pick<SimModel, "interactions">, base: string, eventCode: string, secret: string): ActionSign[] {
  const out: ActionSign[] = [];
  for (const def of model.interactions.values()) {
    if (def.qr === undefined || def.who !== "guest") continue;
    out.push({ name: def.id, label: def.label, line: def.qr, code: signCode(secret, def.id), url: `${base}/?code=${encodeURIComponent(eventCode)}&act=${encodeURIComponent(def.id)}` });
  }
  return out;
}

/** Every codex entry the facts file places: a hunt question's document
 *  (gold, its own `where`), a door digit note (silver, its own pile and
 *  `where`), a generated fact (its tier's colour; the tier and how it
 *  hides as the stack) and a hand-written `existing` entry (the colour, `already placed`). The
 *  first claim wins — two facts may name one hand-written entry. */
export function codexStacks(facts: FactsFile | null): Record<string, CodexStack> {
  const out: Record<string, CodexStack> = {};
  if (facts === null) return out;
  const claim = (id: string, s: CodexStack) => {
    if (!Object.hasOwn(out, id)) out[id] = s;
  };
  for (const q of facts.questions) if (q.codex) claim(q.codex.id, { colour: HUNT_COLOUR, stack: "hunt answers", where: q.where ?? null });
  for (const c of facts.door?.clues ?? []) claim(c.id, { colour: CLUE_COLOUR, stack: CLUE_STACK, where: c.where });
  for (const f of facts.facts) {
    const tier = f.tier === undefined ? undefined : facts.tiers?.[f.tier];
    if (tier === undefined) continue;
    const stack = `${tier.label.toLowerCase()} — ${tier.stack}`;
    if (f.codex) claim(f.codex.id, { colour: tier.colour, stack, where: null });
    else if (f.existing !== undefined) claim(f.existing, { colour: tier.colour, stack, where: "already placed" });
  }
  return out;
}

export function printExtras(model: SimModel | null, base: string, eventCode: string, secret: string, facts: FactsFile | null = null): PrintExtras {
  return {
    joinLink: `${base}/?code=${encodeURIComponent(eventCode)}`,
    checkin: model === null ? [] : checkinSigns(model, base, eventCode, secret),
    actions: model === null ? [] : actionSigns(model, base, eventCode, secret),
    cast: model === null ? [] : identityDefs(model).filter(performerPickable).map((d) => d.name),
    stacks: codexStacks(facts),
  };
}

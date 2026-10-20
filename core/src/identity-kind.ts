//! The pure door classification (wave 13: moved out of
//! `server/identity.ts`, which imports `node:crypto`, so the editor's
//! browser `Workspace` can lint with it — L1211). Every `CHARACTER` is
//! **special** (a part: hooks, owned beats, lines, a mind, `listed`) or
//! **pool** (a bare name a guest may be); `playable: false`, `mind:
//! external` and a `joinable: false` caste narrow who may take it. See
//! `server/identity.ts` for the door rules built on top. Dependency-free.

import type { SimModel } from "./runtime/sim/model.ts";
import { foldName } from "./parser/names.ts";

export type IdentityKind = "special" | "pool";

/** What the story says about one character at the door. */
export interface IdentityDef {
  name: string;
  kind: IdentityKind;
  faction: string | null;
  /** May *anyone* sign in as them? (`playable: false` → no.) */
  playable: boolean;
  /** Voiced by an agent (`mind: external`) — no performer needed or allowed. */
  agent: boolean;
  /** Their group is one the story assigns (`joinable: false`) — an enforcer caste. */
  caste: boolean;
  /** Hand-picked `avatar:` pictures (URLs or `File:` names), best first. */
  avatars: string[];
  /** The Wikipedia article this character is (`wiki:`), if named. */
  wiki: string | null;
  /** `reserved: true` — held for one invitee's claim (see the module doc). */
  reserved: boolean;
}

/** Does this character have a part in the story? */
export function isSpecial(model: SimModel, id: string): boolean {
  const c = model.characters.get(id);
  if (c === undefined) return false;
  if (c.hooks.length > 0 || c.mind !== null || c.listed) return true;
  const prefix = `${id}.`;
  for (const key of model.beats.keys()) if (key.startsWith(prefix)) return true;
  return speakersOf(model).has(foldName(id));
}

const speakerCache = new WeakMap<SimModel, Set<string>>();

/** Every (folded) speaker of a dialogue line in any beat — a character
 *  with lines has a part even with no hooks of its own. */
export function speakersOf(model: SimModel): Set<string> {
  const hit = speakerCache.get(model);
  if (hit !== undefined) return hit;
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (o["kind"] === "dialogue" && typeof o["value"] === "object" && o["value"] !== null) {
      const v = o["value"] as { speaker?: unknown; speakers?: unknown };
      if (typeof v.speaker === "string") out.add(foldName(v.speaker));
      if (Array.isArray(v.speakers)) for (const sp of v.speakers) if (typeof sp === "string") out.add(foldName(sp));
    }
    for (const v of Object.values(o)) if (typeof v === "object" && v !== null) walk(v);
  };
  for (const beat of model.beats.values()) walk(beat.body);
  speakerCache.set(model, out);
  return out;
}

/** Every declared character, classified. Declaration order. */
export function identityDefs(model: SimModel): IdentityDef[] {
  return [...model.characters.values()].map((c) => ({
    name: c.id,
    kind: isSpecial(model, c.id) ? "special" : "pool",
    faction: c.faction,
    playable: c.playable,
    agent: c.mind !== null,
    caste: c.faction !== null && model.factions.get(c.faction)?.joinable === false,
    avatars: c.avatar,
    wiki: c.wiki,
    reserved: c.reserved,
  }));
}

/** May a guest register as this character? */
export function guestPickable(d: IdentityDef): boolean {
  return d.kind === "pool" && d.playable && !d.caste;
}

/** May a performer sign in as this character? */
export function performerPickable(d: IdentityDef): boolean {
  return d.kind === "special" && d.playable && !d.agent;
}

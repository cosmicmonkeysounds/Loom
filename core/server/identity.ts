//! Who may sign in as whom — derived from the story, not configured.
//!
//! Every `CHARACTER` is one of two things at the door:
//!
//! - **special** — it has a part in the story: hooks (`when scanned by
//!   program:`), owned beats (`beat Sweep(program)`), lines in a beat,
//!   a mind, or a body (`listed: true` — a person in the directory).
//!   Clippy, Norton, Broken Ask Jeeves, Excel. A *performer* signs in as
//!   one of these; a guest never can.
//! - **pool** — a name and nothing else (`CHARACTER Calculator`, maybe an
//!   `avatar:`; never `listed`, since the guest who takes the name *is*
//!   the person): the programs a *guest* may be. Declaring the pool in
//!   the story is what puts a name on the guest picker, with its picture.
//!
//! `playable: false` takes a character off both lists (a scannable prop,
//! a voice in the walls); `mind: external` keeps an agent-voiced character
//! off the performer list (nobody plays Trabolta — a model does). A pool
//! character whose group is `joinable: false` (the Antivirus caste) is
//! never a guest's: guests cannot be antivirus software.
//!
//! Claims are exclusive. A name held by a live guest, or a character a
//! signed-in performer holds, is *taken* — the picker greys it out and
//! the register / login routes refuse it — so two phones never share a
//! program and two booths never share Clippy.
//!
//! A pool character marked `reserved: true` (a featured program, written
//! for one invitee) is held for its invitation: `guest/register` takes it
//! only with its **claim** — `claimToken(secret, name)`, an HMAC over the
//! event's claim secret (pinned to the project like its codes, so it
//! survives a restart and End → relaunch) and the folded name — or while a
//! director has opened it for a few minutes (a lost invitation).

import { createHmac, timingSafeEqual } from "node:crypto";

import type { SimModel } from "../src/runtime/sim/model.ts";
import { foldName } from "../src/parser/names.ts";

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

/** One row of a join screen's picker. */
export interface IdentityRow {
  name: string;
  /** Their public group, if the story gives them one. */
  faction: string | null;
  /** Serving key of their profile picture (`/e/:id/api/avatar/<key>`), or null. */
  avatar: string | null;
  /** Someone already holds this name — greyed out, refused on sign-in. */
  claimed: boolean;
  /** Held for an invitee and locked for this caller (no claim for it, no
   *  director's open window) — shown 🔒, refused on register. */
  reserved: boolean;
}

/** One picture a guest may choose for their program. */
export interface PictureChoice {
  /** Serving key (`/e/:id/api/avatar/<key>`). */
  key: string;
  /** The Wikipedia / Commons file it is (no `File:` prefix), or "" for a
   *  plain link — what an author copies into `avatar: File:…`. */
  file: string;
}

/** The refusal `guest/register` answers (409) for a reserved program
 *  taken without its claim. */
export const RESERVED = "reserved";

/** Why a guest may not register a name, or null when they may. `mayClaim`
 *  says whether this caller may take a `reserved: true` program (they hold
 *  its claim, or a director opened it); without it a reserved program is
 *  refused with `RESERVED`. */
export function guestNameRefusal(model: SimModel, name: string, taken: ReadonlySet<string>, mayClaim: (character: string) => boolean = () => false): string | null {
  const folded = foldName(name);
  if (folded === "") return "pick a program";
  if (taken.has(folded)) return `${name} is already here tonight — pick another program`;
  const def = identityDefs(model).find((d) => foldName(d.name) === folded);
  if (def === undefined) return null;
  if (def.caste) return `${name} is ${def.faction} — programs can't be ${def.faction}`;
  if (def.kind === "special" || !def.playable) return `${name} is a part in the story — pick a program from the list`;
  if (def.reserved && !mayClaim(def.name)) return RESERVED;
  return null;
}

/** Characters for the claim token: Crockford-style base32, lower case, no
 *  i / l / o / u (nothing to misread off a printed card). */
const CLAIM_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
/** Claim token length: 10 × 5 bits. */
const CLAIM_LENGTH = 10;

/** The claim token for one reserved character: HMAC-SHA256 over the folded
 *  name keyed by the event's claim secret, first 50 bits in base32. The
 *  same secret and name always give the same token. */
export function claimToken(secret: string, character: string): string {
  const mac = createHmac("sha256", secret).update(`claim:${foldName(character)}`).digest();
  let bits = 0;
  let acc = 0;
  let out = "";
  for (const byte of mac) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < CLAIM_LENGTH) {
      bits -= 5;
      out += CLAIM_ALPHABET[(acc >> bits) & 31];
    }
    if (out.length === CLAIM_LENGTH) break;
    acc &= (1 << bits) - 1;
  }
  return out;
}

/** Does `claim` (as typed or scanned: case and spaces ignored) unlock this
 *  character? Constant-time on the token. */
export function claimMatches(secret: string, character: string, claim: string | null | undefined): boolean {
  if (typeof claim !== "string") return false;
  const given = claim.toLowerCase().replace(/[\s-]+/gu, "");
  const a = Buffer.from(given);
  const b = Buffer.from(claimToken(secret, character));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Why a performer may not sign in as a character, or null when they may. */
export function performerRefusal(model: SimModel, character: string, held: ReadonlySet<string>): string | null {
  const def = identityDefs(model).find((d) => d.name === character);
  if (def === undefined) return "unknown character";
  if (held.has(foldName(character))) return `${character} is already taken by another performer`;
  if (def.agent) return `${character} is voiced by an agent, not a performer`;
  if (!def.playable) return `${character} is not a part anyone plays`;
  if (def.kind === "pool") return `${character} is a program for guests, not a performer's part`;
  return null;
}

/** The folded names of everyone currently registered (guests + personas). */
export function takenNames(persons: Iterable<{ name: string }>): Set<string> {
  const out = new Set<string>();
  for (const p of persons) out.add(foldName(p.name));
  return out;
}

/** The folded characters currently held by signed-in performers. */
export function heldCharacters(sessions: Iterable<[string, { character: string | null }]>): Set<string> {
  const out = new Set<string>();
  for (const [, s] of sessions) if (s.character !== null) out.add(foldName(s.character));
  return out;
}

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

export {
  type IdentityDef,
  type IdentityKind,
  guestPickable,
  identityDefs,
  isSpecial,
  performerPickable,
  speakersOf,
} from "../src/identity-kind.ts";
import { guestPickable, identityDefs, type IdentityDef } from "../src/identity-kind.ts";

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

/** The reserved program a name stands for: its own name, or its `wiki:`
 *  article (a featured `VLC` is `wiki: VLC media player`, and a directory
 *  search finds it by the article). Null when the name holds no reserved
 *  program. */
export function reservedDefFor(model: SimModel, name: string): IdentityDef | null {
  const folded = foldName(name);
  if (folded === "") return null;
  const defs = identityDefs(model).filter((d) => d.reserved && guestPickable(d));
  // Its name without the vendor word is held too ("Excel" for "Microsoft Excel").
  const short = (n: string): string | null => {
    const rest = n.trim().split(/\s+/u).slice(1).join(" ");
    return rest === "" ? null : foldName(rest);
  };
  return defs.find((d) => foldName(d.name) === folded)
    ?? defs.find((d) => d.wiki !== null && foldName(d.wiki) === folded)
    ?? defs.find((d) => short(d.name) === folded)
    ?? null;
}

/** Why a guest may not register a name, or null when they may. `mayClaim`
 *  says whether this caller may take a `reserved: true` program (they hold
 *  its claim, or a director opened it); without it a reserved program is
 *  refused with `RESERVED`. */
export function guestNameRefusal(model: SimModel, name: string, taken: ReadonlySet<string>, mayClaim: (character: string) => boolean = () => false): string | null {
  const folded = foldName(name);
  if (folded === "") return "pick a program";
  if (taken.has(folded)) return `${name} is already here tonight — pick another program`;
  const def = identityDefs(model).find((d) => foldName(d.name) === folded);
  if (def === undefined) {
    // The article name of a reserved program is held like the program.
    const held = reservedDefFor(model, name);
    return held !== null && !mayClaim(held.name) ? RESERVED : null;
  }
  if (def.caste) return `${name} is ${def.faction} — programs can't be ${def.faction}`;
  if (def.kind === "special" || !def.playable) return `${name} is a part in the story — pick a program from the list`;
  if (def.reserved && !mayClaim(def.name)) return RESERVED;
  return null;
}

/** A guest's name as the story spells it: the pool CHARACTER's own name
 *  when the typed one folds to it (`bugdom` → `Bugdom`), so a story that
 *  compares `program.name == "Bugdom"` hears the guest; any other name as
 *  given. Asked after `guestNameRefusal` passed. */
export function canonicalGuestName(model: SimModel, name: string): string {
  const folded = foldName(name);
  return identityDefs(model).find((d) => foldName(d.name) === folded)?.name ?? name;
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

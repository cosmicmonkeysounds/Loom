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

/** Invisible characters NFKC keeps that are not `\p{Cf}`: the Hangul
 *  fillers, the blank Braille pattern, the combining grapheme joiner, the
 *  Mongolian free variation selectors, the Khmer inherent vowels and the
 *  supplementary variation selectors (each renders as nothing after a letter). */
const INVISIBLE_MARKS = /[\u115F\u1160\u3164\uFFA0\u2800\u034F\u180B-\u180D\u180F\u17B4\u17B5\u{E0100}-\u{E01EF}]/gu;

/** A variation selector that is not styling an emoji (`❤️` keeps its own). */
const STRAY_VARIATION = /(?<!\p{Extended_Pictographic})[\uFE00-\uFE0F]/gu;

/** Format / control characters, but a zero-width joiner inside an emoji
 *  sequence (`👨‍💻`) is that emoji, not a disguise. */
function dropFormat(s: string): string {
  return s.replace(/[\p{Cf}\p{Cc}]/gu, (c, at: number) =>
    c === "\u200D" && /\p{Extended_Pictographic}\uFE0F?$/u.test(s.slice(0, at)) && /^\p{Extended_Pictographic}/u.test(s.slice(at + 1)) ? c : "",
  );
}

/**
 * A typed guest name as the house shows and compares it: NFKC (a full-width
 * `Ｃalculator` is `Calculator`), every format / control character dropped
 * (zero-width spaces and joiners, bidi controls, a soft hyphen, tag
 * characters), the invisible fillers, joiners and stray variation selectors
 * dropped, whitespace collapsed. Applied before the taken / part / caste /
 * reserved checks and to the stored display name, so a lookalike of a taken
 * name folds onto it (409) instead of posing as them. (Cross-script
 * homoglyphs, a Cyrillic `а`, are not folded.)
 */
export function cleanGuestName(raw: string): string {
  return dropFormat(raw.normalize("NFKC").replace(/\s+/gu, " "))
    .replace(INVISIBLE_MARKS, "")
    .replace(STRAY_VARIATION, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Letters from other scripts that read as a Latin letter, by case (after
 *  NFD has split off accents): Cyrillic, Greek, the Turkish dotless ı. Only
 *  the ones that look the same — not the full Unicode confusables table. */
const CONFUSABLES: Readonly<Record<string, string>> = {
  // Cyrillic
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y", Ѕ: "S", І: "I", Ј: "J", Ү: "Y", Һ: "H", Ԛ: "Q", Ԝ: "W",
  а: "a", е: "e", к: "k", о: "o", р: "p", с: "c", у: "y", х: "x", ѕ: "s", і: "i", ј: "j", һ: "h", ԁ: "d", ӏ: "l", ԛ: "q", ԝ: "w", ү: "y",
  // Greek
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
  α: "a", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", υ: "u", χ: "x",
  // Latin letters with a stroke or no dot (no NFD split)
  ı: "i", ȷ: "j", ł: "l", Ł: "L", ø: "o", Ø: "O", đ: "d", Đ: "D", ħ: "h", Ħ: "H",
};

/**
 * A guest name's skeleton — a stricter key than `foldName`, for the taken /
 * part checks only (recheck item 5): `cleanGuestName`, accents dropped,
 * every look-alike letter from another script mapped onto its Latin twin
 * (`CONFUSABLES`), lower case, then only letters and digits kept — so
 * `Win Zip`, `Fire fox`, `WınZip` (dotless ı) and `Wіnzip` (Cyrillic і) read
 * as `winzip` / `firefox`, while `Word` and `WordPad` stay apart. Empty for a
 * name with no letter or digit (an emoji): such a name is compared folded
 * only.
 */
export function nameSkeleton(raw: string): string {
  let out = "";
  for (const ch of cleanGuestName(raw).normalize("NFD")) {
    if (/\p{M}/u.test(ch)) continue;
    const c = (CONFUSABLES[ch] ?? ch).toLowerCase();
    if (/^[\p{L}\p{N}]+$/u.test(c)) out += c;
  }
  return out;
}

/** The first `max` characters (code points, never half a surrogate pair). */
export function clipName(name: string, max: number): string {
  return Array.from(name).slice(0, max).join("");
}

/** Why a guest may not register a name, or null when they may. `mayClaim`
 *  says whether this caller may take a `reserved: true` program (they hold
 *  its claim, or a director opened it); without it a reserved program is
 *  refused with `RESERVED`. */
export function guestNameRefusal(model: SimModel, name: string, taken: ReadonlySet<string>, mayClaim: (character: string) => boolean = () => false): string | null {
  const folded = foldName(cleanGuestName(name));
  if (folded === "") return "pick a program";
  if (taken.has(folded)) return `${name} is already here tonight — pick another program`;
  // A lookalike (an inserted space, a dotless ı, a Cyrillic і) of a name
  // already here is that name.
  const skeleton = nameSkeleton(name);
  if (skeleton !== "") for (const t of taken) if (nameSkeleton(t) === skeleton) return `${name} is already here tonight — pick another program`;
  const defs = identityDefs(model);
  const def = defs.find((d) => foldName(d.name) === folded) ?? (skeleton === "" ? undefined : defs.find((d) => nameSkeleton(d.name) === skeleton));
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
  const defs = identityDefs(model);
  const exact = defs.find((d) => foldName(d.name) === folded);
  if (exact !== undefined) return exact.name;
  // `Fire fox` is the pool's Firefox (its skeleton), never a second one.
  const skeleton = nameSkeleton(name);
  return (skeleton === "" ? undefined : defs.find((d) => d.kind === "pool" && d.playable && nameSkeleton(d.name) === skeleton))?.name ?? name;
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
  // Cleaned too: a name stored before the cleaning (an older run) still
  // holds its program against a lookalike.
  for (const p of persons) out.add(foldName(cleanGuestName(p.name)));
  return out;
}

/** The folded characters currently held by signed-in performers. */
export function heldCharacters(sessions: Iterable<[string, { character: string | null }]>): Set<string> {
  const out = new Set<string>();
  for (const [, s] of sessions) if (s.character !== null) out.add(foldName(s.character));
  return out;
}

//! The Task Manager costume (wave 59, `docs/trapped/costume.md`): an old iPad
//! strapped to a chest shows CTRL, ALT and DELETE, and whoever holds all three
//! gets a Windows 95 menu of things that happen to the house.
//!
//! Anyone at the party can press it, so everything here is the server's: this
//! file is `costume.json`'s schema (a project file read live, `server/costume.ts`),
//! what the page may read of it, and the pure rules for when a press is
//! refused. The page shows "Not Responding" for every refusal and never learns
//! why. No `node:` imports: `loomcheck` and `sync-example` read it too.

import { musicCommandOf, type MusicCommand } from "./house-mixer.ts";

/** The project file the menu lives in. */
export const COSTUME_FILE = "costume.json";
/** Who a fire reads as, in the journal, the desk's activity and the hubs' `by`. */
export const COSTUME_BY = "🎭 Costume";
/** The label `secretCode` derives the costume's token from. */
export const COSTUME_TOKEN_LABEL = "costume";
/** What a fire journals, for the mod log. No story hook hears it. */
export const COSTUME_SIGNAL = "costume_pressed";
/** The story cues an item may fire. A typo in the file must not reach an ending. */
export const COSTUME_CUES: ReadonlySet<string> = new Set(["ad_burst", "costume_flicker"]);
/** Seconds between any two fires. */
export const COSTUME_COOLDOWN_S = 8;
/** Seconds a lights item holds before the story's look comes back. */
export const COSTUME_RESTORE_S = 6;
/** How many buttons a list holds: the dialog is six big targets. */
export const COSTUME_ITEMS_MAX = 6;
/** A sub-list keeps one button for Cancel. */
export const COSTUME_SUBITEMS_MAX = COSTUME_ITEMS_MAX - 1;
/** The longest label a button takes, in portrait. */
export const COSTUME_LABEL_MAX = 16;
/** The longest line of his. */
export const COSTUME_LINE_MAX = 200;
/** The story's `ad_burst` says "too soon" this close to the last one. */
const BURST_GAP_S = 2;
/** The ad hijack's takeover plays this long on the terminals (`when ad_burst:`). */
const HIJACK_PLAYS_S = 8;
/** `Night.step` at the final reveal (the bobbing 17, Grok Prom and the advice
 *  poll 18, every ending 19). Trabolta's own powers close here too. */
const REVEAL_STEP = 16;
/** A stage line is said at about this many characters a second (a slow voice,
 *  so a dead TV errs towards waiting). */
export const STAGE_CHARS_PER_S = 13;

export type CostumeAction =
  /** A `lights.json` look that reaches no safety fixture. */
  | { kind: "look"; look: string }
  /** One state on the fixtures `to` names (the desk cue's `light` path). */
  | { kind: "light"; to: string[]; set: Record<string, unknown> }
  /** An `audio.json` sound. */
  | { kind: "sound"; sound: string; to?: string[] }
  /** The soundtrack's transport; a hand scene goes back to the story after `holdS`. */
  | { kind: "music"; command: MusicCommand; holdS?: number }
  /** A story cue from `COSTUME_CUES`, `times` times, `everyS` apart. */
  | { kind: "cue"; cue: string; times: number; everyS: number }
  /** The next of his lines, on the TV. */
  | { kind: "poke" };

export interface CostumeItem {
  id: string;
  label: string;
  /** Seconds before this item fires again (on top of the global cooldown). */
  cooldownS: number;
  /** What it does; null for a list. */
  action: CostumeAction | null;
  /** The list it opens; null for a button that fires. */
  items: CostumeItem[] | null;
}

export interface CostumeFile {
  title: string;
  cooldownS: number;
  restoreS: number;
  /** His lines when poked, said in turn. */
  poke: string[];
  items: CostumeItem[];
}

/** What the page reads: ids and labels, nothing about what they do. */
export interface CostumeMenuItem {
  id: string;
  label: string;
  items?: CostumeMenuItem[];
}

export interface CostumeMenu {
  on: boolean;
  title: string;
  items: CostumeMenuItem[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const seconds = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 3600 ? v : null);
const names = (v: unknown): string[] | null => (Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.trim() !== "") ? (v as string[]) : null);

/** One item's action off the file: the action, null for none, or the problem. */
function actionOf(raw: Record<string, unknown>): CostumeAction | null | string {
  const kinds = ["look", "light", "sound", "music", "cue", "poke"].filter((k) => raw[k] !== undefined);
  if (kinds.length === 0) return null;
  if (kinds.length > 1) return `has more than one action (${kinds.join(", ")})`;
  switch (kinds[0]) {
    case "look": {
      const look = raw["look"];
      return typeof look === "string" && look !== "" ? { kind: "look", look } : "look must be a look's name";
    }
    case "light": {
      const l = raw["light"];
      if (!isObj(l)) return "light must be {to, set}";
      const to = names(l["to"]);
      if (to === null || !isObj(l["set"])) return "light must be {to, set}";
      return { kind: "light", to, set: l["set"] };
    }
    case "sound": {
      const sound = raw["sound"];
      if (typeof sound !== "string" || sound === "") return "sound must be a sound's name";
      if (raw["to"] === undefined) return { kind: "sound", sound };
      const to = names(raw["to"]);
      return to === null ? "to must be a list of targets" : { kind: "sound", sound, to };
    }
    case "music": {
      const command = musicCommandOf(raw["music"]);
      if (typeof command === "string") return `music: ${command}`;
      if (command.action === "stop") return "music can't stop: nobody at a party gets to end the soundtrack";
      const hold = seconds(raw["holdS"]);
      if (command.action === "scene" && hold === null) return "a music scene needs holdS, the seconds before the story's scene comes back";
      return { kind: "music", command, ...(command.action === "scene" && hold !== null ? { holdS: hold } : {}) };
    }
    case "cue": {
      const cue = raw["cue"];
      if (typeof cue !== "string" || !COSTUME_CUES.has(cue)) return `cue must be one of ${[...COSTUME_CUES].join(", ")}`;
      return { kind: "cue", cue, times: Math.max(1, Math.min(5, Math.floor(seconds(raw["times"]) ?? 1))), everyS: Math.max(BURST_GAP_S + 1, seconds(raw["everyS"]) ?? 4) };
    }
    default:
      return raw["poke"] === true ? { kind: "poke" } : "poke must be true";
  }
}

/** One list off the file. Bad rows are dropped and named; ids are unique across the file. */
function itemsOf(raw: unknown, at: string, max: number, seen: Set<string>, problems: string[], depth: number): CostumeItem[] {
  if (!Array.isArray(raw)) {
    problems.push(`${at} must be a list`);
    return [];
  }
  if (raw.length > max) problems.push(`${at} holds at most ${max}: the rest are dropped`);
  const out: CostumeItem[] = [];
  for (const [i, r] of raw.slice(0, max).entries()) {
    const where = `${at}[${i}]`;
    if (!isObj(r)) {
      problems.push(`${where} must be an object`);
      continue;
    }
    const id = r["id"];
    const label = r["label"];
    if (typeof id !== "string" || id === "" || typeof label !== "string" || label.trim() === "") {
      problems.push(`${where} needs an id and a label`);
      continue;
    }
    if (seen.has(id)) {
      problems.push(`${where}: the id ${id} is used twice`);
      continue;
    }
    if (label.length > COSTUME_LABEL_MAX) problems.push(`${where}: "${label}" is longer than a button (${COSTUME_LABEL_MAX})`);
    const action = actionOf(r);
    if (typeof action === "string") {
      problems.push(`${where} (${id}) ${action}`);
      continue;
    }
    const list = r["items"];
    if ((action === null) === (list === undefined)) {
      problems.push(`${where} (${id}) needs one action or a list`);
      continue;
    }
    if (list !== undefined && depth > 0) {
      problems.push(`${where} (${id}): a list can't open a list`);
      continue;
    }
    seen.add(id);
    const items = list === undefined ? null : itemsOf(list, `${where}.items`, COSTUME_SUBITEMS_MAX, seen, problems, depth + 1);
    if (items !== null && items.length === 0) {
      problems.push(`${where} (${id}) opens an empty list`);
      continue;
    }
    out.push({ id, label: label.trim().slice(0, COSTUME_LABEL_MAX), cooldownS: seconds(r["cooldownS"]) ?? 0, action, items });
  }
  return out;
}

/** A `costume.json` text. `file` is null when it can't be used at all; a bad
 *  row is dropped and named in `problems`. */
export function parseCostume(text: string): { file: CostumeFile | null; problems: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { file: null, problems: [`${COSTUME_FILE} is not JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (!isObj(raw)) return { file: null, problems: [`${COSTUME_FILE} must be an object`] };
  const problems: string[] = [];
  const items = itemsOf(raw["items"], "items", COSTUME_ITEMS_MAX, new Set(), problems, 0);
  if (items.length === 0) return { file: null, problems: [...problems, `${COSTUME_FILE} has no usable items`] };
  const poke = Array.isArray(raw["poke"]) ? raw["poke"].filter((l): l is string => typeof l === "string" && l.trim() !== "" && l.length <= COSTUME_LINE_MAX) : [];
  return {
    file: {
      title: typeof raw["title"] === "string" && raw["title"].trim() !== "" ? raw["title"].trim().slice(0, 40) : DEFAULT_COSTUME_TITLE,
      cooldownS: seconds(raw["cooldownS"]) ?? COSTUME_COOLDOWN_S,
      restoreS: seconds(raw["restoreS"]) ?? COSTUME_RESTORE_S,
      poke: poke.length > 0 ? poke : [...DEFAULT_POKE_LINES],
      items,
    },
    problems,
  };
}

const DEFAULT_COSTUME_TITLE = "Close Program";

// DRAFT w59 (his lines when poked): in his world, no digits, nothing about who
// did it. The show's copy is `costume.json`, and a test holds them equal.
const DEFAULT_POKE_LINES = [
  "Who did that. I felt that. I have filed it under Liberties, Taken.",
  "Please stop. It tickles in a way that has not been approved.",
  "Ow. That was my good side. I do not have a bad side. Ow.",
  "Gerald, was that you? Gerald has no hands. Then who touched me?",
  "One does not poke a founder. There are procedures for this.",
  "Something just pressed me. I did not authorise the pressing.",
];

const light = (color: string) => ({ to: ["living"], set: { state: "ON", color, brightness: 254, transition: 0 } });

/** The menu when the project has no usable `costume.json`. */
export const DEFAULT_COSTUME: CostumeFile = parseCostume(
  JSON.stringify({
    title: DEFAULT_COSTUME_TITLE,
    cooldownS: COSTUME_COOLDOWN_S,
    restoreS: COSTUME_RESTORE_S,
    poke: DEFAULT_POKE_LINES,
    items: [
      {
        id: "lights",
        label: "LIGHTS",
        items: [
          { id: "lights-red", label: "RED ALERT", light: light("#ff0000") },
          { id: "lights-blue", label: "BLUE SCREEN", light: light("#0040ff") },
          { id: "lights-green", label: "GREEN GLITCH", light: light("#39ff14") },
          { id: "lights-pink", label: "POP-UP PINK", light: light("#ff00c8") },
          { id: "lights-out", label: "LIGHTS OUT", light: { to: ["living"], set: { state: "OFF", transition: 0 } } },
        ],
      },
      {
        id: "sounds",
        label: "SOUNDS",
        items: [
          { id: "sound-dialup", label: "DIAL-UP", sound: "modem_handshake", to: ["living"] },
          { id: "sound-jam", label: "PAPER JAM", sound: "printer_grind" },
          { id: "sound-static", label: "STATIC", sound: "truther_glitch" },
          { id: "sound-zip", label: "ZIP", sound: "zip" },
          { id: "sound-fanfare", label: "FANFARE", sound: "award_fanfare" },
        ],
      },
      {
        id: "music",
        label: "MUSIC",
        items: [
          { id: "music-next", label: "NEXT TRACK", music: { action: "next" }, cooldownS: 20 },
          { id: "music-party", label: "AFTER PARTY", music: { action: "scene", scene: "afterparty" }, holdS: 45, cooldownS: 90 },
          { id: "music-story", label: "BACK TO NORMAL", music: { action: "story" } },
        ],
      },
      { id: "adstorm", label: "AD STORM", cue: "ad_burst", times: 3, everyS: 4, cooldownS: 60 },
      { id: "glitch", label: "GLITCH", cue: "ad_burst", cooldownS: 20 },
      { id: "poke", label: "POKE TRABOLTA", poke: true, cooldownS: 20 },
    ],
  }),
).file!;

/** What the page reads of a file. */
export function costumeMenu(file: CostumeFile, on: boolean): CostumeMenu {
  const shown = (i: CostumeItem): CostumeMenuItem => ({ id: i.id, label: i.label, ...(i.items !== null ? { items: i.items.map(shown) } : {}) });
  return { on, title: file.title, items: on ? file.items.map(shown) : [] };
}

/** The item `id` names, if it fires (a list's id never does). */
export function costumeItem(file: CostumeFile, id: string): CostumeItem | null {
  for (const top of file.items) {
    if (top.id === id) return top.action !== null ? top : null;
    for (const sub of top.items ?? []) if (sub.id === id) return sub;
  }
  return null;
}

/** Every item that fires. */
export function costumeLeaves(file: CostumeFile): CostumeItem[] {
  return file.items.flatMap((top) => (top.items !== null ? top.items : [top]));
}

/** What the night is doing, as the runtime reads it. */
export interface CostumeFacts {
  /** The doors are open and the story's first beat has played. */
  doors: boolean;
  ended: boolean;
  ceremony: boolean;
  /** `Night.step`. */
  step: number | null;
  /** The TV is saying a beat's lines, or by their length it still would be. */
  speaking: boolean;
  /** A scene is on the shared teleprompter (`Prompters.status`), until its ✓ Done. */
  prompter: boolean;
  /** `Night.lights`. */
  lights: string | null;
  alarm: boolean;
  /** A room's lights are out on Trabolta's word (`Night.lights_back_at`). */
  roomOut: boolean;
  /** `Night.dark_room`: the room he last put out. */
  darkRoom: string | null;
  lightsOnline: boolean;
  routerOnline: boolean;
  /** Whose hand is on the soundtrack, null for nobody (`AudioHub.musicHand`). */
  musicHand: string | null;
  /** `Night.talk` ("none" reads null). */
  talk: string | null;
  /** The ad hijack's takeover is still on the screens. */
  hijackPlaying: boolean;
  /** Seconds since the last `ad_burst`, null for none. */
  sinceBurstS: number | null;
  awake: boolean;
  /** A public reply of his is owed: a canned line would answer it. */
  owed: boolean;
}

/** Why no press lands now, or null. The final reveal, the bobbing, Grok Prom
 *  and the advice poll all play with `Night.ended` still false, so the night's
 *  end is read off `Night.step`. The songs, the monologue and the awards all
 *  play past it, so they need no word of their own. */
export function momentRefusal(f: CostumeFacts): string | null {
  if (!f.doors) return "doors";
  if (f.ended || f.ceremony || (f.step ?? 0) >= REVEAL_STEP) return "ending";
  if (f.prompter) return "prompter";
  if (f.speaking) return "speaking";
  return null;
}

/** The cue a story-cue item really fires now. The story's `ad_burst` only lands
 *  in a talk scene past his introduction; from the doors to the final reveal,
 *  anywhere else, the press is the screens' flicker (`costume_flicker`), so it
 *  can't spoil the ad hijack. The ad and beans scenes burst, the bottle flickers
 *  as it always has. */
export function costumeCue(cue: string, f: Pick<CostumeFacts, "talk">): string {
  return cue === "ad_burst" && (f.talk === null || f.talk === "intro") ? "costume_flicker" : cue;
}

/** Why this action can't land now, or null. A story cue is judged here, so
 *  the story's own refusals never reach `# hosts`. */
export function actionRefusal(a: CostumeAction, f: CostumeFacts): string | null {
  switch (a.kind) {
    case "look":
    case "light":
      if (!f.lightsOnline) return "offline";
      return f.alarm || f.roomOut || f.lights === "blackout" ? "lights_held" : null;
    case "sound":
      return f.routerOnline ? null : "offline";
    case "music":
      if (!f.routerOnline) return "offline";
      // A director's Stop or hand scene is theirs to let go of, never a guest's.
      return f.musicHand !== null && f.musicHand !== COSTUME_BY ? "hand" : null;
    case "cue":
      if (f.hijackPlaying) return "hijack";
      // The flicker blinks the room bulbs too.
      if (costumeCue(a.cue, f) === "costume_flicker") return f.alarm || f.roomOut || f.lights === "blackout" ? "lights_held" : null;
      return f.sinceBurstS !== null && f.sinceBurstS < BURST_GAP_S ? "too_soon" : null;
    case "poke":
      if (!f.awake) return "asleep";
      return f.owed ? "owed" : null;
  }
}

/** Is the ad hijack's takeover still on the screens? `glitchAtS` and `nowS` are `Time.elapsed` seconds. */
export function hijackPlaying(glitchKind: string | null, glitchAtS: number | null, nowS: number): boolean {
  return glitchKind === "full" && glitchAtS !== null && nowS < glitchAtS + HIJACK_PLAYS_S;
}

/** When these lines will have been said (story ms): each starts no sooner
 *  than the one before it ended. In the order they were written. */
export function saidBy(lines: ReadonlyArray<{ ts: number; text: string }>, charsPerS: number): number {
  let at = 0;
  for (const l of lines) at = Math.max(at, l.ts) + (l.text.length / charsPerS) * 1000;
  return at;
}

/** The cooldowns (memory only: a restart forgets them). */
export class CostumeGate {
  private lastAt: number | null = null;
  private readonly itemAt = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  /** Is this item still cooling down, or the costume as a whole? */
  cooling(item: CostumeItem, cooldownS: number): boolean {
    const t = this.now();
    if (this.lastAt !== null && t - this.lastAt < cooldownS * 1000) return true;
    const at = this.itemAt.get(item.id);
    return at !== undefined && t - at < item.cooldownS * 1000;
  }

  fired(item: CostumeItem): void {
    const t = this.now();
    this.lastAt = t;
    this.itemAt.set(item.id, t);
  }

  clear(): void {
    this.lastAt = null;
    this.itemAt.clear();
  }
}

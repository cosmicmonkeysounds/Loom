//! Who the program at his heart is tonight (wave 20, D26): the **dossier**
//! an agent request carries for the heart to heart, so the voice can
//! remember what this guest did tonight. Built only when the speaker is a
//! guest standing at his heart (`<id>.at_the_heart`); absent everywhere
//! else, so nothing else changes. A pure function over the sim log, the
//! chat log and the world, like `agent-recent.ts`: no store, nothing
//! journaled, rebuilt on every request build.
//!
//! Secrecy (the never-list): only named, public fields are read, never the
//! whole `<id>.*` world — so a ROLE `secret:` slot (the virus they carry,
//! their 📝 answers), a `secret: true` CODEX entry or character (the
//! Kernel's verdicts, combos, the door code) never ride it, and every slot
//! the dossier reads is checked against the role's `secret:` list anyway,
//! and so is every quest (`quest.<slug>`: *The Cold Door*, a secret mission).
//! A filing is its question id and verdict, never the answer, the key or
//! the confidence, and the dossier says no more than the screens have:
//! every verdict reads `pending` until Question Results reads its question
//! (`do fact_read <ids>`), then a guess reads `uncertain` only when the
//! judge called it one, and `accurate` / `lie` wait for the house to publish
//! that question's truth (`do fact_truth <id> …`, The Verdict). Before
//! that, *your H1 was accurate* — or a right guess that is not `uncertain`
//! — would confirm a hunt answer (wave 12's rule). The counts cover read
//! questions only and come off the confidence, never the verdict:
//! `truths.accepted` = the sure filings, `uncertain` = the guesses, `lies`
//! = the published lies. Codex titles, gift titles and their own lines are
//! dropped when they carry the `▒ HUNT ANSWER` marker, mention a facts.json
//! answer form (`mentionsAnswer`), a secret character's current value
//! (`mentionsSecret`) or a codex unlock code (`mentionsCode`). Their own
//! lines are only theirs (`from` them, in his `dm:` thread, addressed to
//! them): never another guest's. A guest-typed crew name is never carried
//! (`groupVisible`), and neither is an unrevealed hidden group.

import type { AgentDossier, AgentDossierVerdict } from "./agents.ts";
import type { ChatMessage } from "./chat.ts";
import { HUNT_ANSWER_MARK } from "./agent-recent.ts";
import { CONFIDENCE_MAX, type FactsFiling } from "./facts.ts";
import { RESULTS_READ_VERB, RESULTS_TRUTH_VERB, SCREEN_CHARTS, resultIdsOf } from "./routes/screen.ts";
import { foldName } from "../src/parser/names.ts";
import { Sim, type SimEvent } from "../src/runtime/sim/index.ts";

/** The JSON size the dossier stays near (bytes; oldest items dropped first). */
export const DOSSIER_MAX_BYTES = 3072;
export const DOSSIER_CODEX_MAX = 40;
export const DOSSIER_ROOMS_MAX = 20;
export const DOSSIER_SAID_MAX = 8;
export const DOSSIER_SAID_CHARS = 200;
export const DOSSIER_MOMENTS_MAX = 10;
export const DOSSIER_GIFTS_MAX = 20;
export const DOSSIER_FILINGS_MAX = 16;
export const DOSSIER_QUESTS_MAX = 24;

/** The world slot that says a program stands at his heart (a room terminal's
 *  `terminal opened` sets it). */
export const AT_THE_HEART = "at_the_heart";
/** The duck's find (`EventRuntime.commitFound`): one reinstallation. */
const FOUND_SIGNAL = foldName("the golden duck");
/** The bottle's verdicts (Clippy's 🗣 / 🙅 / 🎩), folded. */
const BOTTLE_CHOICES: ReadonlyMap<string, "truth" | "refused" | "dare"> = new Map([
  [foldName("truth_answered"), "truth"],
  [foldName("truth_refused"), "refused"],
  [foldName("chose_dare"), "dare"],
]);

/** The switch, read on every request: `LOOM_AGENT_DOSSIER=off` leaves it out. */
export function agentDossierOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["LOOM_AGENT_DOSSIER"] !== "off";
}

export interface DossierInput {
  /** The agent's character id (`Trabolta`). */
  character: string;
  speaker: { id: string; name: string };
  /** `sim.elapsed()` now. */
  storyAt: number;
  /** The whole sim log. */
  log: readonly SimEvent[];
  /** The whole chat log. */
  messages: readonly ChatMessage[];
  /** A world path as a display string (null: unset). */
  peek: (path: string) => string | null;
  /** The speaker's ROLE `secret:` slots (a name, or a dotted path's head). */
  secretSlots: ReadonlySet<string>;
  /** The declared CHARACTER their name is, else null. */
  program: string | null;
  /** Their public faction (null: none, or not one an agent may know). */
  faction: string | null;
  groups: readonly string[];
  /** May an agent know of this group? (false: an unrevealed hidden group, a crew, a race side.) */
  groupVisible: (group: string) => boolean;
  captured: boolean;
  restricted: boolean;
  /** Every participant (the Trust Chart ranks the cleared ones). */
  persons: ReadonlyArray<{ id: string; name: string }>;
  /** The codex entries they hold (`sim.codexFor`), story order. */
  codex: ReadonlyArray<{ title: string; text: string; secret: boolean }>;
  /** A codex entry's definition by id (undefined: unknown — dropped). */
  codexDef: (entry: string) => { title: string; text: string; secret: boolean } | undefined;
  /** Their quests (`sim.questsFor`): id, title, status. */
  quests: ReadonlyArray<{ id: string; title: string; status: string }>;
  /** A LOCATION id's display name (null: unknown — dropped). */
  location: (id: string) => string | null;
  /** Their facts filings (newest step per question), in log order, with the
   *  judge's verdict (`pending` while unjudged) and the filer's confidence
   *  (read to count, never output). The builder holds every verdict back
   *  until the screens have shown it. */
  filings: ReadonlyArray<{ question: string; verdict: AgentDossierVerdict; confidence: number; logAt?: number }>;
  /** The story's currency slot (`score`), null when it has none. */
  currencySlot: string | null;
  mentionsAnswer?: (text: string) => boolean;
  mentionsSecret?: (text: string) => boolean;
  mentionsCode?: (text: string) => boolean;
}

/** A filing's verdict for the dossier: `pending` while unjudged; a `marked`
 *  final (a settle marked it: a guess, or a sure round-2 filing with no cup)
 *  reads as the verdict the mark replaced, else the judge's proposal, the
 *  way the tally and the screens read it — never as a lie. */
export function dossierVerdictOf(f: Pick<FactsFiling, "final" | "verdict" | "before">): AgentDossierVerdict {
  if (f.final === null) return "pending";
  if (f.final === "marked") return f.before?.final ?? f.verdict;
  return f.final;
}

/** Is this guest at his heart? (the dossier's gate). */
export function atTheHeart(peek: (path: string) => string | null, id: string): boolean {
  return peek(`${id}.${AT_THE_HEART}`) === "true";
}

/** Fold: lowercase, every run of other than `a-z0-9` one space, trimmed. */
const fold = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();

/** A check for the codex unlock codes (a code typed into a line is never
 *  carried), matched as a standalone token: the code's letters in order,
 *  `-` or `_` allowed between any two (the redeem box's fold, never a
 *  space) and bounded by anything but a letter or digit, so
 *  `NO-EXIT` is caught as `no-exit` / `no_exit` / `noexit` but never inside
 *  "there's no exit", and `SANDY-FILE` never in "the Sandy File". Codes
 *  under four characters are ignored. Titles are never run through this
 *  (a title is not its code). */
export function codeMentions(codes: readonly string[]): (text: string) => boolean {
  const pats = [...new Set(codes.map(squash))]
    .filter((c) => c.length >= 4)
    .map((c) => [...c].map((ch) => ch.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&")).join("[_\\-]?"));
  if (pats.length === 0) return () => false;
  const re = new RegExp(`(?<![a-z0-9])(?:${pats.join("|")})(?![a-z0-9])`, "u");
  return (text: string): boolean => re.test(text.toLowerCase());
}

/** The prefix a wall terminal's pilot carries as `via` (`Terminal · Server
 *  Room`): the guest's own typing, unlike a director's speech-as. */
export const TERMINAL_VIA_PREFIX = "Terminal · ";

/** `foldCode`'s fold, over any text. */
const squash = (s: string): string => s.trim().toLowerCase().replace(/[\s_\-]+/gu, "");

const clipText = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/**
 * The dossier (D26), or null when the speaker is not at his heart. Every
 * list oldest first; then trimmed to `DOSSIER_MAX_BYTES` by dropping the
 * oldest item of the longest list until it fits.
 */
export function buildDossier(input: DossierInput): AgentDossier | null {
  const { speaker, peek } = input;
  const id = speaker.id;
  if (!atTheHeart(peek, id)) return null;
  // A slot of theirs, unless the role keeps it secret.
  const mine = (slot: string): string | null => (input.secretSlots.has(slot) || input.secretSlots.has(slot.split(".")[0]!) ? null : peek(`${id}.${slot}`));
  const num = (slot: string): number | null => {
    const v = mine(slot);
    const n = v === null || v.trim() === "" ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  // A quest the role keeps secret (`quest`, or `quest.<slug>` as the sim
  // mirrors it: `quest.the_cold_door`) is never named, listed or a moment.
  const questSecret = (quest: string): boolean => input.secretSlots.has("quest") || input.secretSlots.has(`quest.${Sim.codexSlug(quest)}`);
  // A house-made text (a title, a moment) is checked for answers and
  // secrets; only a line they typed is checked for unlock codes too.
  const leaksTitle = (text: string): boolean =>
    text.includes(HUNT_ANSWER_MARK) || input.mentionsAnswer?.(text) === true || input.mentionsSecret?.(text) === true;
  const leaks = (text: string): boolean => leaksTitle(text) || input.mentionsCode?.(text) === true;

  // The log walk: rooms, gifts, the bottle, his heart, the moments.
  const rooms: string[] = [];
  const gifts: string[] = [];
  const moments: Array<{ at: number; text: string }> = [];
  let reinstalled = 0;
  let visits = 0;
  let bottle: "truth" | "refused" | "dare" | null = null;
  let marked = false;
  let atHeart = false;
  const moment = (at: number, text: string) => {
    if (!leaksTitle(text)) moments.push({ at, text });
  };
  input.log.forEach((e, i) => {
    switch (e.type) {
      case "accountCreated":
        if (e.person === id) moment(i, "joined");
        break;
      case "joined":
        if (e.person === id && input.groupVisible(e.faction)) moment(i, `joined ${e.faction}`);
        break;
      case "defected":
        if (e.person === id && input.groupVisible(e.to)) moment(i, `switched to ${e.to}`);
        break;
      case "arrived": {
        if (e.person !== id) break;
        const name = input.location(e.location);
        if (name !== null && !rooms.includes(name)) rooms.push(name);
        break;
      }
      case "captured":
        if (e.person === id) moment(i, "captured");
        break;
      case "released":
        if (e.person === id) moment(i, "released");
        break;
      case "restricted":
        if (e.person === id) moment(i, "restricted");
        break;
      case "unrestricted":
        if (e.person === id) moment(i, "unrestricted");
        break;
      case "worldSet":
        if (e.path === `${id}.marked` && !input.secretSlots.has("marked")) {
          const now = e.value === "true";
          if (now !== marked) moment(i, now ? "marked for reinstallation" : "unmarked");
          marked = now;
        } else if (e.path === `${id}.${AT_THE_HEART}`) {
          // A visit to his heart: the story setting the flag (the server
          // room's terminal only), never any room terminal's opening.
          const now = e.value === "true";
          if (now && !atHeart) {
            visits += 1;
            if (visits === 1) moment(i, "came to his heart");
          }
          atHeart = now;
        }
        break;
      case "quest": {
        if (e.person !== id || (e.action !== "complete" && e.action !== "fail") || questSecret(e.quest)) break;
        const q = input.quests.find((x) => x.id === e.quest);
        if (q !== undefined) moment(i, `${e.action === "complete" ? "completed" : "failed"} ${q.title}`);
        break;
      }
      case "codexUnlocked": {
        if (e.person !== input.character || e.via !== "share" || e.from !== id) break;
        const def = input.codexDef(e.entry);
        if (def === undefined || def.secret || leaksTitle(def.title) || def.text.includes(HUNT_ANSWER_MARK)) break;
        gifts.push(def.title);
        moment(i, `gave him ${def.title}`);
        break;
      }
      case "signal": {
        if (e.subject !== id) break;
        const name = foldName(e.name);
        const choice = BOTTLE_CHOICES.get(name);
        if (name === FOUND_SIGNAL) {
          reinstalled += 1;
          moment(i, "reinstalled");
        } else if (choice !== undefined) {
          bottle = choice;
          moment(i, bottle === "truth" ? "answered the bottle's truth" : bottle === "dare" ? "chose dare" : "refused the bottle's truth");
        }
        break;
      }
      default:
        break;
    }
  });
  for (const f of input.filings) moment(f.logAt ?? input.log.length, `filed ${f.question}`);
  moments.sort((a, b) => a.at - b.at);

  // Their own lines to him: his `dm:` thread, from them, addressed to them.
  const said: string[] = [];
  let joinedAt: number | null = null;
  for (const m of input.messages) {
    if (joinedAt === null && m.audience !== "all" && m.audience.includes(id)) joinedAt = m.ts;
    if (m.channel !== `dm:${input.character}` || m.kind !== "line" || m.hidden === true || m.from !== speaker.name) continue;
    if (m.audience === "all" || !m.audience.includes(id)) continue;
    // A director's speech-as is not theirs; a wall terminal's pilot is.
    if (m.via !== undefined && !m.via.startsWith(TERMINAL_VIA_PREFIX)) continue;
    const text = m.text.trim();
    if (text === "" || leaks(text)) continue;
    said.push(clipText(text, DOSSIER_SAID_CHARS));
  }

  // His Trust Chart: their score, and their rank once they are cleared.
  const spec = SCREEN_CHARTS[0];
  let trust: AgentDossier["trust"];
  const score = spec === undefined ? null : num(spec.value);
  if (spec !== undefined && score !== null) {
    trust = { score };
    if (mine(spec.only) === "true") {
      const rows = input.persons
        .filter((p) => peek(`${p.id}.${spec.only}`) === "true")
        .map((p) => ({ id: p.id, name: p.name, value: Number(peek(`${p.id}.${spec.value}`) ?? 0) || 0 }))
        .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
      const rank = rows.findIndex((r) => r.id === id) + 1;
      if (rank > 0) trust = { score, rank, of: rows.length };
    }
  }

  // The questions Question Results has read (`do fact_read`), and those
  // whose truth the house has published (The Verdict).
  const read = new Set<string>();
  const published = new Set<string>();
  for (const e of input.log) {
    if (e.type !== "directive") continue;
    if (e.verb === RESULTS_READ_VERB) for (const q of resultIdsOf(e.args)) read.add(q);
    else if (e.verb === RESULTS_TRUTH_VERB) published.add(e.args.trim().split(/\s+/u)[0] ?? "");
  }
  const seen = (q: string): boolean => read.has(q) || published.has(q);
  const shown = (f: { question: string; verdict: AgentDossierVerdict }): AgentDossierVerdict => {
    if (published.has(f.question)) return f.verdict;
    return read.has(f.question) && f.verdict === "uncertain" ? "uncertain" : "pending";
  };
  const filings = input.filings.slice(-DOSSIER_FILINGS_MAX).map((f) => ({ question: f.question, verdict: shown(f) }));
  const truths = { accepted: 0, lies: 0, uncertain: 0 };
  for (const f of input.filings) {
    if (f.verdict === "pending" || !seen(f.question)) continue;
    if (f.confidence >= CONFIDENCE_MAX) truths.accepted += 1;
    else truths.uncertain += 1;
    if (shown(f) === "lie") truths.lies += 1;
  }
  const codex = input.codex.filter((e) => !e.secret && !leaksTitle(e.title) && !e.text.includes(HUNT_ANSWER_MARK)).map((e) => e.title).slice(-DOSSIER_CODEX_MAX);
  const quests = input.quests.filter((q) => !questSecret(q.id) && !leaksTitle(q.title)).map((q) => ({ title: q.title, status: q.status })).slice(-DOSSIER_QUESTS_MAX);
  const flag = (slot: string): boolean => mine(slot) === "true";
  const balance = input.currencySlot === null ? null : num(input.currencySlot);
  const bottleRound = num("bottle_round");
  const groups = input.groups.filter((g) => input.groupVisible(g));
  const storyMinutes = Math.max(0, Math.floor((input.storyAt - (joinedAt ?? 0)) / 60_000));

  const d: AgentDossier = {
    name: speaker.name,
    ...(input.program !== null ? { program: input.program } : {}),
    ...(joinedAt !== null ? { joinedAt } : {}),
    storyMinutes,
    ...(input.faction !== null && input.groupVisible(input.faction) ? { faction: input.faction } : {}),
    ...(groups.length > 0 ? { groups } : {}),
    marked: flag("marked"),
    captured: input.captured,
    reinstalled,
    restricted: input.restricted,
    ...(trust !== undefined ? { trust } : {}),
    truths,
    filings,
    codex,
    quests,
    rooms: rooms.slice(-DOSSIER_ROOMS_MAX),
    ...(flag("bingo") ? { bingo: true } : {}),
    ...((bottleRound ?? 0) > 0 || bottle !== null ? { bottle: { picked: true, choice: bottle } } : {}),
    ...(balance !== null ? { wallet: { balance } } : {}),
    gifts: gifts.slice(-DOSSIER_GIFTS_MAX),
    heart: {
      layer: num("heart_layer") ?? 0,
      suspicion: num("heart_suspicion") ?? 0,
      convinced: flag("heart_convinced"),
      barred: flag("heart_out"),
      visits,
    },
    said: said.slice(-DOSSIER_SAID_MAX),
    moments: moments.slice(-DOSSIER_MOMENTS_MAX).map((m) => m.text),
  };
  return trimDossier(d);
}

/** The lists the size bound trims, oldest item first. */
const TRIMMABLE = ["moments", "said", "rooms", "codex", "filings", "quests", "gifts", "groups"] as const;

/** Drop the oldest item of the longest list until the JSON fits `max`. */
export function trimDossier(d: AgentDossier, max: number = DOSSIER_MAX_BYTES): AgentDossier {
  const out: AgentDossier = { ...d };
  for (const k of TRIMMABLE) if (Array.isArray(out[k])) (out as unknown as Record<string, unknown>)[k] = [...(out[k] as unknown[])];
  const size = () => new TextEncoder().encode(JSON.stringify(out)).length;
  while (size() > max) {
    let longest: (typeof TRIMMABLE)[number] | null = null;
    for (const k of TRIMMABLE) {
      const list = out[k] as unknown[] | undefined;
      if (list !== undefined && list.length > 0 && (longest === null || list.length > (out[longest] as unknown[]).length)) longest = k;
    }
    if (longest === null) break;
    (out[longest] as unknown[]).shift();
  }
  return out;
}

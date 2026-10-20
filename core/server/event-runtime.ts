//! One live event = one `EventRuntime`.
//!
//! Everything that used to be a module-level global in `server.ts` (the
//! `Sim`, its phase, the chat store, sessions, decision docks, the SSE
//! client set, the autonomous ticker, the on-disk journal) now lives on an
//! instance so a single process can host **many** events at once — one per
//! project that has opened its doors. The multi-tenant server keeps a
//! registry of these and routes each request to the right one.
//!
//! The request handlers, fan-out, persistence and restart-recovery are ported
//! verbatim from the original single-event server; only the state they touch
//! moved from `state.*` / free variables onto `this`.

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { kingSignal, validateHouse, type HouseMap, type KingState, type MapVariantsResponse } from "@loom/house";

import { asNumber } from "../src/runtime/expr.ts";
import { Sim, type SimEvent } from "../src/runtime/sim/index.ts";
import { namedEvents, type SimModel } from "../src/runtime/sim/model.ts";
import { byRefusal, cueState, guestCardView, guestFlags, guestView, modView, staffRoomChannels, notePress, pressMovedArm, pressRefused, primeView, rosterRow, staffRoomIds, themeOf, titleOf, type AgentMindSummary, type GuestView, type ModPresence, type ModView, type PrimeView, type RuntimePhase } from "./views.ts";
import { passOk, type Passcodes } from "./auth.ts";
import { SessionStore } from "./session.ts";
import { Store, type Mutation } from "./store.ts";
import { ChatStore, HISTORY_LIMIT, boothOwnRow, capHistory, composeGuestMessages, guestOwnRow, decisionChannelFor, isPinnedRoom, readoutText, visibleTo, type ChatMessage } from "./chat.ts";
import { DIRECTOR, WalletBook, walletSeam, type WalletOp, type WalletRefusal } from "./wallet.ts";
import { CHAT_TEXT_MAX, SSE_MOD_QUEUE_CAP, chatTooLong, ipOf, queryTokenOf, readBody, sendJson, sseCap, sseFrame, sseQueued, sseSend, sseWrite, str, tokenOf } from "./http-util.ts";
import { RateLimiter, limiterFor, rateLimitsFromEnv, type RateLimits } from "./rate-limit.ts";
import { handleMetrics } from "./routes/metrics.ts";
import { handleModLog } from "./routes/mod-log.ts";
import { NOT_FROM_A_BOOTH, isHostRoute, isModSurface, type HostRouteContext } from "./routes/host.ts";
import { TtsProxy, ttsConfigFromEnv } from "./tts.ts";
import { AvatarBook, ImageCache, avatarKey, avatarRefUrl } from "./avatars.ts";
import { WikiClient, isAntivirusSoftware } from "./wiki.ts";
import {
  canonicalGuestName,
  guestNameRefusal,
  reservedDefFor,
  guestPickable,
  heldCharacters,
  identityDefs,
  performerPickable,
  performerRefusal,
  takenNames,
  type IdentityRow,
  type PictureChoice,
} from "./identity.ts";
import { foldName } from "../src/parser/names.ts";
import { cueSheetView } from "../src/cue-sheet.ts";
import { hostView, type HostView } from "../src/host-board.ts";
import { canonicalPlaceArgs } from "./place-args.ts";
import { CHECKIN_ROUTE, GuestCheckin } from "./routes/k13.ts";
import { LOGOUT_ROUTE, Pairing, RESUME_ROUTE } from "./routes/n02.ts";
import { HOMESCREEN_ROUTE } from "./routes/k31b.ts";
import { PushRoutes } from "./routes/k31.ts";
import { PushHub, boothOwner, guestOwner, messagePush, pushConfigFromEnv, readoutPush, webPushSender, type PushSender } from "./push.ts";
import { printExtras } from "./routes/k12.ts";
import { CLAIM_UNLOCK_ROUTE, Claims, mintClaimSecret } from "./routes/claims.ts";
import { modPatch, modViewJson } from "./mod-patch.ts";
import { sendRecap } from "./routes/recap.ts";
import { guestSide } from "./routes/sides.ts";
import { ScreenWatch, handleScreenGet, handleScreenTerminalsGet, handleScreenVoicePost, screenKingOf, screenTerminals } from "./routes/screen.ts";
import { handleScreenIdentifyPost } from "./routes/screen.ts";
import { SpatialHub, houseVersion, houseWarnings, isWorld, parseDuckRun, parsePose, sortCandidates, type DuckRun, type KingRef, type SessionRef } from "./spatial.ts";
import {
  DEFAULT_MAP_FILE,
  activeVariant,
  mapProblems,
  saveFileFor,
  asMapFiles,
  isMapFile,
  listVariants,
  mapFileText,
  parseMapText,
  readMapFile,
  showVariantFiles,
  type MapFiles,
  type ParsedMap,
  type ProjectLink,
} from "./house-maps.ts";
import {
  CONFIDENCE_MAX,
  FACTS_FILE,
  FactsWatch,
  RULING_ARG,
  RULING_WHY_ARG,
  factsKey,
  factsProblems,
  judgeAnswer,
  judgeFiling,
  judgeMode,
  parseFactsBook,
  readFactsFile,
  rulingOfArgs,
  worldReader,
  type FactVerdict,
  type FactsBook,
  type FactsView,
} from "./facts.ts";
import {
  AGENT_QUEUE_MAX_AGE_MS,
  AgentHub,
  AgentTraceLog,
  agentActs,
  agentControl,
  agentMindReport,
  agentThought,
  type AgentAct,
  type AgentActResult,
  type AgentFacts,
  type AgentLine,
  type AgentPower,
  type AgentQueue,
  type AgentRecent,
  type AgentRequest,
  type AgentThread,
} from "./agents.ts";
import { agentRecentOn, answerMentions, buildRecent, HUNT_ANSWER_MARK, secretMentions, storyTag, storyTexts, worldString, type StoryTagContext } from "./agent-recent.ts";


/** A guest view is never rendered against a null sim — this stands in. */
const EMPTY_SIM = Sim.fromSources("");

/** One SSE subscriber attached to a specific event. */
interface Client {
  role: "guest" | "prime" | "mod";
  id: string;
  /** Display name of a session-authorized director (for co-moderator presence). */
  name?: string; // person id (guest), character (prime), or "" (mod)
  /** A performer who also holds the mod capability sees the whole feed. */
  admin?: boolean;
  /** A booth holding the host capability (a part with `admin: true`, wave
   *  13): its own feed plus every agent-voiced character's `dm:` thread. */
  host?: boolean;
  /** An operator session (`/api/mod/impersonate`): the director playing this
   *  participant from the editor, and the token it streams on (so revoking
   *  the session closes the stream). */
  via?: string;
  token?: string;
  /** A house tool on the mod feed (`?lean=1` — stagehand): every `sim` /
   *  `message` / `lifecycle` frame, but never a `snapshot` or `history`
   *  (a `ModView` is ≈ 200 KB at a full house). */
  lean?: boolean;
  /** A full director console skipped for a `ModView` while it was still
   *  behind by a whole view: owed the newest one once it catches up. */
  snapshotOwed?: boolean;
  /** A full director console on keyed patches (`?delta=1`, W9 O1-01): after
   *  a keyframe `snapshot` it gets `snapshotPatch` frames while it holds the
   *  previous frame. `modFrame` is the frame it holds, `keyframeAt` when its
   *  last full one went out. */
  delta?: boolean;
  modFrame?: number;
  keyframeAt?: number;
  res: ServerResponse;
}

/** A director playing a participant from the editor (`/api/mod/impersonate`):
 *  a guest/persona's own session, or a performer's booth for a character.
 *  In memory only — never written to `guests.json`/`sessions.json`, never a
 *  moderator capability, and cut by every restart the real session would be. */
export interface Impersonation {
  role: "guest" | "prime";
  id: string;
  /** The director (display name) — journaled as `by` on every action. */
  by: string;
}

/**
 * What a performer's console may see. Public story + every room is theirs
 * to run — but a **private thread** (a guest's DM with a character, or two
 * guests' `pm:`) is private to its parties: only the character's own
 * performer (or an admin) sees a `dm:<character>` thread, and nobody but a
 * mod sees a `pm:`. Knowledge is a currency; the booth can't skim it.
 */
/** Free-text answer fields, per widget kind, that may name anyone: a 📝 fact
 *  card's `answer` is whatever the guest typed ("Clippy" is a fine lie), and
 *  the story only ever quotes it back, never aims a rule with it. */
export const WIDGET_FREE_TEXT: Readonly<Record<string, ReadonlySet<string>>> = {
  fact: new Set(["answer"]),
  answer: new Set(["text"]),
};

/** Result keys the server attaches itself — `card` (the message seq a
 *  restart rebuilds the answered set from), `verdict` (the facts judge's
 *  word, `facts.ts`) and `key_answer` (the key's canonical answer on an
 *  accurate filing). A phone that sends one is refused outright: it must
 *  never supply its own verdict or key. */
export const RESERVED_WIDGET_KEYS: ReadonlySet<string> = new Set(["card", "verdict", "key_answer"]);

/**
 * Sanitise a widget's client-supplied result into event arguments: a flat
 * bag of short scalars under plain keys. A string that happens to name a
 * participant or an entity is refused — `Sim.signal` would bind it as that
 * id, and a phone must not be able to aim a story rule at someone else —
 * except in the kind's free-text fields (`WIDGET_FREE_TEXT`).
 */
export function widgetResultArgs(raw: unknown, sim: Sim, kind = ""): Record<string, string | number | boolean> | null {
  const free = Object.hasOwn(WIDGET_FREE_TEXT, kind) ? WIDGET_FREE_TEXT[kind] : undefined;
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string | number | boolean> = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (++n > 16 || !/^[A-Za-z_][A-Za-z0-9_]{0,31}$/u.test(k)) return null;
    if (RESERVED_WIDGET_KEYS.has(k)) return null;
    if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) out[k] = v;
    else if (typeof v === "string") {
      if (v.length > 200) return null;
      if (free?.has(k) !== true && (sim.persons.has(v) || sim.model.entityKind.has(v))) return null;
      out[k] = v;
    } else return null;
  }
  return out;
}

function visibleToPrime(m: ChatMessage, c: Client, isAgent: (character: string) => boolean = () => false): boolean {
  if (c.admin === true) return true;
  if (m.channel.startsWith("pm:")) return false;
  // A host booth also reads guests' threads with an agent-voiced character
  // (Trabolta), so it can answer as him — never another character's DMs, and
  // never a row addressed `@<Character>` (another booth's private
  // `cast:Trabolta` line, a readout): those fall through to the booth rule.
  if (c.host === true && m.channel.startsWith("dm:") && isAgent(m.channel.slice(3)) && (m.audience === "all" || !m.audience.some((a) => a.startsWith("@")))) return true;
  // The booth's own Quest Log / Codex: cards addressed `@<its character>`
  // (a guest's pinned rooms are their own).
  if (isPinnedRoom(m.channel)) return Array.isArray(m.audience) && m.audience.includes(`@${c.id}`);
  if (m.channel.startsWith("dm:")) {
    // Their own character's threads, public lines, and the performer's own
    // conversation with an agent-voiced character (audience `@<Character>`).
    return m.channel === `dm:${c.id}` || m.audience === "all" || m.audience.includes(`@${c.id}`);
  }
  return true;
}

/** How many thread lines an agent request carries. */
const AGENT_HISTORY = 30;

/** The `/api/guest/wallet/*` calls a restricted guest is refused (403). */
const WALLET_RESTRICTED: ReadonlySet<string> = new Set(["send", "request", "respond", "offer", "accept", "stimulus", "grant", "freeze"]);
/** The `/api/guest/wallet/*` calls the rate limit never refuses: backing
 *  out. Each only succeeds on an open item of the caller's, so they are
 *  bounded by the throttled calls that made those items. */
const WALLET_UNTHROTTLED: ReadonlySet<string> = new Set(["decline", "cancel"]);

/** Parse an agent's variable adjustments: `{name: signed delta}`, numbers only. */
function agentAdjustments(raw: unknown): Array<[string, number]> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: Array<[string, number]> = [];
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (Number.isFinite(n) && n !== 0) out.push([k, n]);
  }
  return out;
}

/** The run transitions announced on the `lifecycle` SSE event. */
export type LifecycleKind = "reset" | "reload" | "golive" | "ended";

/** A message as a guest client may see it: never the director attribution
 *  a mod `say`-as-a-participant carries. */
function forGuest(m: ChatMessage): ChatMessage {
  if (m.via === undefined) return m;
  const { via: _via, ...rest } = m;
  return rest;
}

/** A game's own high-rate calls (`/api/spatial/*` POSTs) carry tiny bodies —
 *  read with this cap, before (never through) the generic 4 MiB parse. */
const SPATIAL_BODY_LIMIT = 2048;

/** The named event `/api/mod/spatial/begin` fires for the scanned program,
 *  when the story declares it (the show captures a marked arrival on it). */
export const REINSTALLATION_BEGUN = "reinstallation begun";

/** The show's house map file: `LOOM_HOUSE`, else the example's `house.json`. */
export function defaultHouseFile(): string {
  return process.env.LOOM_HOUSE ?? fileURLToPath(new URL("../examples/trapped-in-the-internet/house.json", import.meta.url));
}

/** The show's facts key (`facts.ts`): `LOOM_FACTS`, else `facts.json` next
 *  to the house map — the fallback for an event with no project snapshot. */
export function defaultFactsFile(houseFile = defaultHouseFile()): string {
  return process.env.LOOM_FACTS ?? join(dirname(houseFile), FACTS_FILE);
}

/** Show maps by path: the last *good* read, keyed on the file's mtime — a
 *  hand edit (or a file mounted after boot) is picked up on the next read,
 *  and a missing / half-saved / invalid file never sticks: the last good
 *  map keeps serving until the file is valid again. */
const showHouses = new Map<string, { mtimeMs: number; house: HouseMap }>();
/** The last problem logged per path (a missing file warns once, not per request). */
const showHouseWarned = new Map<string, string>();
/** The journal's `by` on a power an agent-voiced character used itself
 *  (`agent:<Character>`): a replay counts these against the power's
 *  `limit:`, never a director's fire of the same interaction. */
const AGENT_BY = "agent:";
/** The journal's `by` on the judging-mode flip around a near-miss filing
 *  (`commitUnderReview`): the facts judge, not a director. */
const JUDGE_BY = "Judge";

/** The story's staff room for server notices: a `kind: faction` CHANNEL
 *  whose GROUP no guest may join (`staffRoomIds`), `hosts` first; null when
 *  the story has none. */
function hostsRoomOf(model: Sim["model"]): string | null {
  const staff = staffRoomIds(model);
  const names = [...model.channels.keys()].map((id) => id.replace(/^room:/u, "")).filter((n) => staff.has(n.toLowerCase().replace(/[#_-]/g, " ").replace(/\s+/g, " ").trim()));
  return names.find((n) => n.toLowerCase() === "hosts") ?? names[0] ?? null;
}

/** The `# hosts` line after a 📝 near miss's own (`commitUnderReview`):
 *  the proposal is the near-miss rule's, and an unjudged one is credited.
 *  `judge`: the story's `judge:` character was asked to rule (wave 11b). */
export function nearNotice(name: string, args: Record<string, string | number | boolean>, near: string | null, judge: string | null = null): string | null {
  if (near === null) return null;
  const q = typeof args["question"] === "string" ? args["question"] : "?";
  const a = typeof args["answer"] === "string" ? args["answer"] : "";
  if (judge !== null) {
    return `⚠ Near miss, not an exact match: ${name}'s ${q} filing "${a}" is close to "${near}", so it is proposed accurate — asked ${judge} to rule. Without a ruling it is credited if nobody judges it; you can judge it yourself on Run → Mind → Judging.`;
  }
  return `⚠ Near miss, not an exact match: ${name}'s ${q} filing "${a}" is close to "${near}", so it is proposed accurate and is credited if nobody judges it. Judge it on Run → Mind → Judging.`;
}

/** The `# hosts` line after a `judge:` character's ruling (wave 11b). */
export function rulingNotice(judge: string, name: string, question: string, answer: string, key: string, same: boolean, verdict: FactVerdict, why: string): string {
  const line = `🤖 ${judge} ruled ${name}'s ${question} filing "${answer}": ${same ? "the same as" : "not"} "${key}" (${verdict}).`;
  return why === "" ? line : `${line} ${why}`;
}

/** The ruling a mutation carries for the facts ledger: a `judge:`
 *  character's confirm signal (`by: agent:<Character>`, the ruling in its
 *  journaled args — `rulingOfArgs`). */
function factsRuling(m: Mutation, args: readonly unknown[], by: string | undefined): { same: boolean; why: string } | null {
  if (m !== "signal" || by === undefined || !by.startsWith(AGENT_BY)) return null;
  return rulingOfArgs(args[2]);
}

/** Who a mutation is done by, for the facts ledger's provenance (wave 5
 *  issue 8): the journal's `by` (a director, a device, an impersonator),
 *  else a `signal`'s actor (a booth's character — `/api/prime/act`). */
function factsBy(m: Mutation, args: readonly unknown[], by: string | undefined): string | null {
  if (by !== undefined && by.startsWith(AGENT_BY)) return by.slice(AGENT_BY.length);
  if (by !== undefined && by !== "") return by;
  if (m === "signal" && typeof args[3] === "string" && args[3] !== "") return args[3];
  return null;
}

function warnShowHouse(path: string, message: string): void {
  if (showHouseWarned.get(path) === message) return;
  showHouseWarned.set(path, message);
  process.stderr.write(message);
}
export function showHouse(path: string): HouseMap | null {
  const cached = showHouses.get(path);
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch (err) {
    warnShowHouse(path, `  ⚠️  no house map at ${path} (${err instanceof Error ? err.message : String(err)})\n`);
    return cached?.house ?? null;
  }
  if (cached !== undefined && cached.mtimeMs === mtimeMs) return cached.house;
  try {
    const v = validateHouse(JSON.parse(readFileSync(path, "utf8")));
    if (v.ok && v.house !== undefined) {
      showHouses.set(path, { mtimeMs, house: v.house });
      showHouseWarned.delete(path);
      return v.house;
    }
    warnShowHouse(path, `  ⚠️  house map ${path} is invalid:\n${v.problems.map((p) => `     - ${p}\n`).join("")}`);
  } catch (err) {
    warnShowHouse(path, `  ⚠️  house map ${path} is unreadable (${err instanceof Error ? err.message : String(err)})\n`);
  }
  return cached?.house ?? null;
}

/** What a restart-recovery brought back for one event, for the boot banner. */
export interface Restored {
  guests: number;
  events: number;
  sessions: number;
}

/** Construction context for an event runtime. */
export interface EventRuntimeInit {
  /** Stable event id (also the on-disk state sub-directory name). */
  eventId: string;
  /** Durable per-event state (journal / sessions / hidden). */
  store: Store;
  /** The three passcodes gating this event's roles. */
  codes: Passcodes;
  /** Human label for the loaded scenario. */
  scenarioName: string;
  /** The `.loom` source snapshot this event plays. */
  scenarioSource: string;
  /** Best LAN/base URL for guest-join QRs (for `/api/mod/codes`). */
  joinBase: () => string;
  /** The program directory (Wikipedia): profile pictures for the cast and
   *  the guests' software search. Absent → no scraping, no search (tests,
   *  an offline LAN); the join screen falls back to the declared pool. */
  wiki?: WikiClient | null;
  /** Picture bytes behind `/api/avatar/<key>` — one cache per process. */
  images?: ImageCache;
  /** The wall terminals' voice (`/api/mod/tts`). One proxy — one cache —
   *  is shared by every event in the process; tests inject their own. */
  tts?: TtsProxy;
  /** The show's house map (the reinstallation games) — the fallback when
   *  the event has neither a director's save nor a project map snapshot.
   *  Default: `defaultHouseFile()`. Its siblings `<stem>.<variant>.json`
   *  are the variants of an event with no project map files. */
  houseFile?: string;
  /** The project's map files snapshotted at launch (`house.json`,
   *  `house.<variant>.json` → raw text; `house-maps.ts`). Seeds a fresh
   *  state dir only — a restart reads its own copy back. */
  houseMaps?: MapFiles | null;
  /** The map variant the event row records (`event.map_variant`): where a
   *  fresh state dir starts — a relaunch seeds it from the project's last
   *  event, so the tent ↔ shed choice survives End → relaunch. The state
   *  dir's own choice wins once it has one. */
  mapVariant?: string | null;
  /** The way back to the project ("Save to project"); absent → the event
   *  has none (the LAN default event). */
  project?: ProjectLink | null;
  /** The project's `facts.json` text snapshotted at launch (`facts.ts`):
   *  null = the row says the project has none; absent = no row snapshot
   *  (the state dir's copy, else the show file). */
  facts?: string | null;
  /** The show's facts key for an event with no project copy — `LOOM_FACTS`,
   *  default `facts.json` beside `houseFile` (`defaultFactsFile`). */
  factsFile?: string;
  /** The reserved programs' claim secret as the event row pins it
   *  (`event.claim_secret`, routes/claims.ts). Absent / null → the state
   *  dir's copy, else a fresh one (saved there, and handed to
   *  `onClaimSecret` so the row can keep it). */
  claimSecret?: string | null;
  /** Called once with a secret this runtime had to mint (no row copy). */
  onClaimSecret?: (secret: string) => void;
  /** The `do pick … from […] else …` draw (tests inject; default `Math.random`). */
  random?: () => number;
  /** The spatial + agent hubs' clock (tests). */
  now?: () => number;
  /** Web Push (K-31a). Absent → the process-wide sender from `LOOM_VAPID_*`;
   *  null → push off (tests inject a fake). */
  push?: PushSender | null;
  /** Throttle overrides (tests); the rest come from `LOOM_RL_*`. */
  limits?: Partial<RateLimits>;
  /** Least gap between two `snapshot` frames to the full mod consoles
   *  (default `MOD_SNAPSHOT_MS`; tests pass 0 for one frame per step). */
  modSnapshotMs?: number;
  /** Least gap between two `snapshot` frames to the phones and booths
   *  (default `LOOM_SNAPSHOT_MS`, else 0 = one frame per step). */
  snapshotMs?: number;
}

/** `LOOM_SNAPSHOT_MS`: coalesce guest + booth snapshots to at most one per
 *  this many ms (the K-32 contingency, SW-OPS-24). Off (0) unless set. */
export function snapshotMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const ms = Number(env.LOOM_SNAPSHOT_MS ?? "");
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

/** Mod-console snapshots are coalesced to at most one per this many ms
 *  (≤ 2/s): a `ModView` is ≈ 200 KB at 45 guests and used to be re-sent to
 *  every director on every story step. The trailing frame is always sent,
 *  computed at flush time, so a console never ends on a stale view. */
export const MOD_SNAPSHOT_MS = 500;

/** A delta console (`?delta=1`) gets a full `ModView` at least this often,
 *  so a patch the editor ever merged wrong heals within a minute. */
export const MOD_KEYFRAME_MS = 60_000;

/** The process-wide speech proxy (configured from `LOOM_TTS_*`). */
let sharedTts: TtsProxy | null = null;
function defaultTts(): TtsProxy {
  return (sharedTts ??= new TtsProxy(ttsConfigFromEnv()));
}

/** The process-wide push sender (from `LOOM_VAPID_*`; null = push off). */
let sharedPush: PushSender | null | undefined;
function defaultPush(): PushSender | null {
  if (sharedPush === undefined) sharedPush = webPushSender(pushConfigFromEnv());
  return sharedPush;
}

let sharedImages: ImageCache | null = null;
function defaultImages(): ImageCache {
  return (sharedImages ??= new ImageCache());
}

/** Events a `who: agent` power's fire may produce without being *used*:
 *  the signal itself and the character's own words (a refusal). Anything
 *  else — a cue, a variable, a broadcast — spends one use. */
const POWER_FREE_EVENTS: ReadonlySet<string> = new Set(["signal", "dialogue", "action", "diagnostic", "tick", "ambient"]);

/** A use only counts when the story did something with it. A refusal
 *  ("That function is not available yet.", a room off the allow-list) is
 *  the character's words alone — it must not spend the night's two
 *  blackouts. Live and on a replay alike. */
function powerSpent(events: readonly SimEvent[]): boolean {
  return events.some((e) => !POWER_FREE_EVENTS.has(e.type));
}

/** The 403 an agent-voiced character's refused codex share answers
 *  (`Sim.agentRefusal`): a secret file, or lore about someone else. */
export function agentRefusalText(refusal: "secret" | "about"): string {
  return refusal === "secret" ? "they won't take a secret file" : "they won't take lore about someone else";
}

export class EventRuntime {
  readonly eventId: string;
  readonly codes: Passcodes;
  private readonly store: Store;
  private readonly joinBase: () => string;
  private readonly tts: TtsProxy;
  // The program directory (null: offline) + the pictures it found.
  private readonly wiki: WikiClient | null;
  private readonly images: ImageCache;
  // Who has which profile picture (display name → URL), served same-origin
  // at `/api/avatar/<key>`. Persisted, never journaled.
  private readonly avatars = new AvatarBook();
  private readonly avatarLookups = new Set<string>();

  private sim: Sim | null = null;
  private phase: RuntimePhase = "idle";
  private scenarioName: string;
  private scenarioSource: string;
  /** The story compiled from `source` while no sim exists (null when it
   *  won't compile; never played) — `declaredModel` / `declaredSim`. */
  private declaredCast: { source: string; sim: Sim | null } | null = null;

  // Token → capabilities (performer / admin), scoped to this event.
  private readonly sessions = new SessionStore();
  // Guest capability tokens (token → guest id). A guest's public id is
  // broadcast in rosters, so it is NOT a credential — this opaque token,
  // minted at registration, is what authorizes acting as that guest.
  private readonly guestTokens = new Map<string, string>();
  // Operator play-as sessions (token → who is played, by whom), minted by
  // `/api/mod/impersonate` for the editor's embedded play app.
  private readonly impersonations = new Map<string, Impersonation>();
  // Failed passcode attempts per client IP (guest register + prime/mod
  // login). The codes are short and speakable, so throttling online
  // guessing is what actually protects them.
  // Successful registrations per client IP — a cap on drive-by guest spam.
  // Wrong codex codes per guest: past the cap, redeem answers 429 and the
  // miss is never journaled (a guessing phone can't flood the story).
  // All three are `LOOM_RL_*`-configurable (see `rateLimitsFromEnv`).
  private readonly loginFailures: RateLimiter;
  private readonly registrations: RateLimiter;
  private readonly redeemMisses: RateLimiter;
  private readonly widgetAnswers: RateLimiter;
  // Wallet calls per guest (`/api/guest/wallet/*`, `LOOM_RL_WALLET`).
  private readonly walletCalls: RateLimiter;
  // The story's currency in flight (`currency:` header) — pending transfers,
  // the approver's queue, open requests / offers, the stimulus count. Null
  // when the story declares no currency. Rebuilt with every `loadScenario`;
  // every change is one journaled `wallet` op (see `commitWallet`).
  private wallet: WalletBook | null = null;
  // Server-authoritative chat, rebuilt deterministically from the journal.
  private readonly chat = new ChatStore();
  // Where each guest's pending decision docks (channel id). Ephemeral.
  private readonly decisionChannels = new Map<string, string>();
  // W-03 reserved programs: the claim tokens + a director's open windows.
  private readonly claims: Claims;
  // W-04 / OP-11: guest id → when they were last heard from (wall ms): a
  // stream opened or closed, a request on their own token. In memory only
  // (a restart re-learns it from the reconnects).
  private readonly lastSeen = new Map<string, number>();
  // persona id → the director (display name) who spawned it via
  // `/api/mod/persona`. Persisted in meta, cleared by every restart (the
  // personas die with the journal), surfaced as `RosterRow.owner`.
  private readonly personaOwners = new Map<string, string>();
  // The director currently inside `handleMod` (display name) — stamped onto
  // every journal line that mutation writes (`by`) for attribution.
  private actingBy: string | undefined;
  // This event's SSE subscribers.
  private readonly clients = new Set<Client>();
  /** `<widget seq>:<guest>` pairs already answered — a card is one answer per guest. */
  private answeredWidgets = new Set<string>();
  // Ephemeral messages already announced as expired (so we notify once).
  private readonly notifiedExpired = new Set<number>();
  // Elapsed sim time not yet written to the journal (coalesced ticks).
  private pendingTickMs = 0;
  // Whether this run's `entry:` beat has played. Not the same as "a sim
  // exists": a restart with the doors closed (and a restore) builds the sim
  // without opening, and the next open must still play the entry — once.
  private entryPlayed = false;
  /** Wall time (`clock`) the doors last closed by a pause, until they open
   *  again: the agent hub's timers skip that span (T9-timers-03). */
  private pausedAt: number | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  // Agent-voiced characters (`mind: external`): open requests + the
  // stagehand workers answering them. Ephemeral — a restart drops them.
  private readonly agentStreams = new Set<ServerResponse>();
  /** Uses of each `who: agent` power this run (`limit:` enforcement). */
  private readonly agentPowerUses = new Map<string, number>();
  /** What each worker last reported about its character's mind. */
  private readonly agentMinds = new Map<string, AgentMindSummary>();
  /** Every worker's recorded model calls — the Mind page's debugger feed. */
  private readonly agentTrace = new AgentTraceLog();
  // The reinstallation games (`docs/loom-reinstall.md` §2): sessions,
  // stations, poses and the house map. In memory; poses never journal.
  readonly spatial: SpatialHub;
  private readonly houseFile: string;
  // The project's map files as snapshotted (launch / reload / a save to the
  // project), null = no project snapshot; and the active variant's file
  // (null = the default). Both persist in the state dir (`spatial-maps.json`).
  private projectMaps: MapFiles | null;
  private mapVariant: string | null;
  private readonly project: ProjectLink | null;
  // The facts judge (facts.ts, Wave 4 lane B): the project's facts.json as
  // snapshotted (null = none → the show file beside the house map, re-read
  // on mtime change), the book parsed from whichever applies, and the
  // ledger folded off the sim log for `ModView.facts`. The key lives here
  // only: never in the world, the journal or a message.
  private projectFacts: string | null;
  private readonly factsFile: string;
  private factsMemo: { text: string; book: FactsBook | null } | null = null;
  private showFacts: { mtimeMs: number; book: FactsBook | null } | null = null;
  private readonly factsWatch = new FactsWatch();
  /** Near misses already put to the `judge:` character (person, question,
   *  answer) — never asked twice in one run of this process. */
  private readonly rulingsAsked = new Set<string>();
  /** Near misses a restore found still pending (person, question, answer):
   *  the only ones put to the `judge:` character after they landed —
   *  contract J. A near miss filed with nobody online keeps wave 11's
   *  promise (credited at the settle) and is never asked later. */
  private readonly rulingsDue = new Set<string>();
  private readonly random: () => number;
  /** `runPicks` re-entrancy: a pick's own signal never draws again. */
  private pickDepth = 0;
  // K-13 room check-in by QR (routes/k13.ts).
  private readonly checkin: GuestCheckin;
  // N-02 re-pair a guest + N-10 release a performer part (routes/n02.ts).
  private readonly pairing: Pairing;
  // K-31a Web Push to guests + booths (push.ts, routes/k31.ts).
  readonly push: PushHub;
  private readonly pushRoutes: PushRoutes;
  // The wall terminals' poll (K-16): screen cues folded from the sim log + each terminal's last poll.
  readonly screens: ScreenWatch;
  // Spatial stream subscribers (terminals, the map page) — never `clients`.
  private readonly spatialStreams = new Set<ServerResponse>();
  // Flushes poses every 100 ms (and sweeps every second) while anything is
  // going on; started lazily, stops itself when idle.
  private spatialLoop: ReturnType<typeof setInterval> | null = null;
  private spatialTicks = 0;
  // The injectable clock (`EventRuntimeInit.now`), read lazily by the hubs
  // built in field initialisers.
  private clock: () => number = Date.now;
  // Mod snapshot coalescing (`pushModSnapshots`).
  private readonly modSnapshotMs: number;
  private modSnapshotAt = Number.NEGATIVE_INFINITY;
  private modSnapshotTimer: ReturnType<typeof setTimeout> | null = null;
  /** Retries the `ModView` for consoles that were too far behind for one. */
  private modOwedTimer: ReturnType<typeof setTimeout> | null = null;
  /** The size of the last `ModView` frame built (0 before the first). */
  private modViewBytes = 0;
  /** The last `ModView` frame built — what a delta console's next patch is
   *  against (null: the next frame is a keyframe for everyone). */
  private modPrev: { frame: number; view: ModView } | null = null;
  private modFrameSeq = 0;
  // Guest + booth snapshot coalescing (`pushClientSnapshots`).
  private readonly snapshotMs: number;
  private snapshotAt = Number.NEGATIVE_INFINITY;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly agents = new AgentHub({
    build: (thread, id) => this.buildAgentRequest(thread, id),
    admits: (thread) => this.agentAdmits(thread),
    typing: (thread, on) => this.pushTyping(thread, on),
    hold: (req) => this.postAgentHold(req),
    busy: (req) => this.postAgentBusy(req),
    stalled: (worker, waiting) => this.postAgentStall(worker, waiting),
    judgeGone: () => this.pushModSnapshots(),
    now: () => this.clock(),
    presence: () => this.pushSnapshots(),
  });

  constructor(init: EventRuntimeInit) {
    this.eventId = init.eventId;
    this.store = init.store;
    this.codes = init.codes;
    this.scenarioName = init.scenarioName;
    this.scenarioSource = init.scenarioSource;
    this.joinBase = init.joinBase;
    this.tts = init.tts ?? defaultTts();
    this.wiki = init.wiki ?? null;
    this.images = init.images ?? defaultImages();
    this.houseFile = init.houseFile ?? defaultHouseFile();
    this.project = init.project ?? null;
    // The map files come from the event row like `scenarioSource` does (a
    // sync written to the row while the runtime was down — `sync-example
    // --no-reload` — is what a restart plays); the state dir's copy covers an
    // event with no row snapshot (the LAN default event, an old row). The
    // active variant is the event's own: the state dir's choice, else the
    // row's (a relaunch starts on the project's last event's choice).
    const stored = this.store.loadMaps();
    this.projectMaps = asMapFiles(init.houseMaps ?? null) ?? asMapFiles(stored?.files ?? null);
    this.mapVariant = stored?.active ?? init.mapVariant ?? null;
    if (this.projectMaps !== null) this.store.saveMaps(this.projectMaps, this.mapVariant);
    // The project's facts.json rides the same row record as the maps; the
    // state dir's copy covers an event with no row snapshot.
    this.factsFile = init.factsFile ?? defaultFactsFile(this.houseFile);
    this.projectFacts = init.facts !== undefined ? init.facts : this.store.loadFacts();
    if (init.facts !== undefined) this.store.saveFacts(init.facts);
    this.random = init.random ?? Math.random;
    if (init.now !== undefined) this.clock = init.now;
    this.claims = new Claims({ secret: this.resolveClaimSecret(init), now: () => this.clock() });
    this.modSnapshotMs = Math.max(0, init.modSnapshotMs ?? MOD_SNAPSHOT_MS);
    this.snapshotMs = Math.max(0, init.snapshotMs ?? snapshotMsFromEnv());
    this.spatial = new SpatialHub({
      eventId: init.eventId,
      ...(init.now !== undefined ? { now: init.now } : {}),
      // The speedrun survives a server restart mid-show (SW-RE-14).
      onRun: (run) => this.store.appendRun(run),
      // The shared King's hit points live in the story world (C2: the
      // prop's `health` path, journaled, restart-safe).
      kingHp: (path) => {
        const v = this.sim?.world.peek(path);
        return v == null ? undefined : (asNumber(v) ?? undefined);
      },
      // A ghost wears the program's profile picture (C3), read live.
      avatarOf: (_guest, name) => this.avatars.keyFor(name),
    });
    this.spatial.setOpen(false); // idle until the doors open
    this.checkin = new GuestCheckin({
      sim: () => this.sim,
      open: () => this.open,
      guest: (req, body, res) => this.requireGuest(req, body, res),
      signal: (guest, at) => {
        const events = this.commit("signal", "checked_in", guest, { at });
        this.fanout(events);
        return events;
      },
      now: init.now ?? Date.now,
    });
    this.push = new PushHub({
      sender: init.push === undefined ? defaultPush() : init.push,
      load: () => this.store.loadPush(),
      save: (data) => this.store.savePush(data),
    });
    this.pushRoutes = new PushRoutes({
      push: this.push,
      ownerOf: (token) => {
        if (!token || this.impersonations.has(token)) return null;
        const guest = this.guestTokens.get(token);
        if (guest !== undefined) return `guest:${guest}`;
        const character = this.sessions.characterOf(token);
        return character === null ? null : boothOwner(character);
      },
      nameOf: (id) => this.sim?.persons.get(id)?.name ?? null,
      open: () => this.open,
    });
    this.pairing = new Pairing({
      sim: () => this.sim,
      addGuestToken: (token, id) => {
        this.guestTokens.set(token, id);
        this.persistGuests();
      },
      isPersona: (id) => this.personaOwners.has(id) || id.startsWith("p-"),
      revokeGuest: (id) => this.revokeGuest(id),
      sessions: this.sessions,
      persistSessions: () => this.persistSessions(),
      endBooths: (character) => {
        for (const c of [...this.clients]) {
          if (c.role !== "prime" || c.id !== character || c.via !== undefined) continue;
          this.clients.delete(c);
          try {
            c.res.end();
          } catch {
            /* client already gone */
          }
        }
        this.push.drop((owner) => owner === boothOwner(character));
        this.pushPresence();
      },
      joinBase: () => this.joinBase(),
      eventCode: () => this.codes.event,
      now: () => this.clock(),
    });
    const limits = { ...rateLimitsFromEnv(process.env), ...init.limits };
    this.loginFailures = limiterFor(limits.loginFailures);
    this.registrations = limiterFor(limits.register);
    this.redeemMisses = limiterFor(limits.redeemMisses);
    this.widgetAnswers = limiterFor(limits.widgets);
    this.walletCalls = limiterFor(limits.wallet);
    // The TV-voice mute outlives restarts and Go live (an ALL STOP must
    // survive a crash), so one left on from a rehearsal carries into the
    // show: say so on boot, where the crew reads the log.
    const voiceMuted = this.store.loadVoiceMuted();
    if (voiceMuted) process.stderr.write(`  🔇 event ${this.eventId}: the TV voice is muted (kept from before this start) — unmute it on Run → Terminals\n`);
    this.screens = new ScreenWatch({
      ...(init.now !== undefined ? { now: init.now } : {}),
      muted: voiceMuted,
      onMute: (muted) => this.store.saveVoiceMuted(muted),
    });
  }

  /** Current lifecycle phase (idle | open | paused). */
  get currentPhase(): RuntimePhase {
    return this.phase;
  }

  /** Human label of the loaded scenario. */
  get scenario(): string {
    return this.scenarioName;
  }

  /** Display title participants see: the authored `# Title` heading in the
   *  source, else the scenario name (the project's name for DB events). */
  get title(): string {
    return titleOf(this.scenarioSource) ?? this.scenarioName;
  }

  /** The participant client's skin: the header `theme:` (default `plain`). */
  get theme(): string {
    return themeOf(this.scenarioSource) ?? "plain";
  }

  /** A guest's visible chat history (tests + tooling; the SSE `history` frame). */
  chatHistoryFor(guestId: string): ChatMessage[] {
    return this.chat.historyFor(guestId, false);
  }

  /** The declared characters a performer may sign in as (empty until the
   *  scenario is loaded — a booth can't sign in before the doors open). */
  get characterNames(): string[] {
    return this.sim === null ? [] : [...this.sim.model.characters.keys()];
  }

  /** The story's declared cast, doors open or not: the live sim's when there
   *  is one, else compiled once from the scenario text (memoised on it). A
   *  mod code resolves it before the doors, so a terminal provisioned then
   *  canonicalises its `character` (and refuses a typo) at setup. Booths
   *  still get `characterNames` — they can't sign in before the doors. */
  get declaredCharacters(): string[] {
    return [...(this.declaredModel?.characters.keys() ?? [])];
  }

  /** The story's model, doors open or not: the live sim's when there is one,
   *  else compiled once from the scenario text (memoised on it; null when it
   *  won't compile). Before the doors it checks a booth's part and resolves a
   *  room terminal's LOCATION. */
  private get declaredModel(): SimModel | null {
    if (this.sim !== null) return this.sim.model;
    return this.declaredSim?.model ?? null;
  }

  /** Before the doors: the story compiled from the scenario text but never
   *  played (memoised on the text; null when it won't compile, or once a
   *  live sim exists). The director's view lists its admin cues from it, so
   *  a director checking the phone before the doors sees the cue sheet. */
  private get declaredSim(): Sim | null {
    if (this.sim !== null) return null;
    if (this.declaredCast?.source !== this.scenarioSource) {
      let sim: Sim | null = null;
      try {
        sim = Sim.fromSources(this.scenarioSource);
      } catch {
        // A story that won't compile has no cast to check against yet.
      }
      this.declaredCast = { source: this.scenarioSource, sim };
    }
    return this.declaredCast.sim;
  }

  /** How many participants exist in this event's world right now. */
  get guestCount(): number {
    return this.sim?.persons.size ?? 0;
  }

  /** True once the doors are open and a sim exists. */
  private get open(): boolean {
    return this.phase === "open" && this.sim !== null;
  }

  /** Move the lifecycle; the duck-run clock stops while the doors are
   *  closed (SW-RE-14 — a pause mid-run isn't the player's time). */
  private setPhase(phase: RuntimePhase): void {
    this.phase = phase;
    this.spatial.setOpen(this.open);
  }

  /** The claim secret: the row's (kept in the state dir too), else the state
   *  dir's, else a fresh one — saved there and offered to the row. Stable
   *  across a restart either way, and across End → relaunch with a row. */
  private resolveClaimSecret(init: EventRuntimeInit): string {
    const fromRow = typeof init.claimSecret === "string" && init.claimSecret !== "" ? init.claimSecret : null;
    const stored = this.store.loadClaimSecret();
    const secret = fromRow ?? stored ?? mintClaimSecret();
    if (secret !== stored) this.store.saveClaimSecret(secret);
    if (fromRow === null) init.onClaimSecret?.(secret);
    return secret;
  }

  /** The claim token that takes reserved `character` (its invitation's
   *  `?claim=`) — what `/api/mod/codes` lists. */
  claimFor(character: string): string {
    return this.claims.tokenFor(character);
  }

  /** Least gap between two `lastSeen` stamps from requests (a stream's open
   *  / close always stamps): a busy phone must not churn every director's
   *  roster patch. */
  private static readonly SEEN_EVERY_MS = 15_000;

  /** Note that guest `id` was just heard from (`force`: a stream opened or
   *  closed — always stamped). */
  private seen(id: string, force = false): void {
    const now = this.clock();
    const last = this.lastSeen.get(id);
    if (force || last === undefined || now - last >= EventRuntime.SEEN_EVERY_MS) this.lastSeen.set(id, now);
  }

  /** The live sim, or null before the doors open / after the event ends. */
  get liveSim(): Sim | null {
    return this.sim;
  }

  /** A sim that's never null for guest views (returns an empty live sim). */
  private reqSim(): Sim {
    return this.sim ?? EMPTY_SIM;
  }

  // -- SSE fan-out ---------------------------------------------------------

  /** Who holds an open SSE stream right now, by capability — live presence
   *  for the director consoles (guests, performers, co-moderators). */
  private presence(): ModPresence {
    const guests = new Set<string>();
    const primes = new Set<string>();
    let mods = 0;
    const directors: string[] = [];
    for (const c of this.clients) {
      // A director looking through a real guest's eyes is not that guest
      // being here. (A persona or a character played from the editor IS the
      // rehearsal's participant, so those count.)
      if (c.via !== undefined && c.role === "guest" && !c.id.startsWith("p")) continue;
      if (c.role === "guest") guests.add(c.id);
      else if (c.role === "prime") primes.add(c.id);
      else {
        mods += 1;
        directors.push(c.name ?? "Director");
      }
    }
    return {
      guests,
      primes,
      mods,
      directors,
      owners: this.personaOwners,
      lastSeen: this.lastSeen,
      unlocks: this.claims.openWindows(),
      agents: new Set(this.agents.onlineCharacters()),
      agentQueues: this.agentQueues(),
      held: heldCharacters(this.sessions.entries()),
      minds: [...this.agentMinds.values()],
      facts: this.factsView(),
    };
  }

  private snapshotFor(client: Client): unknown {
    const online = new Set(this.agents.onlineCharacters());
    if (client.role === "guest") return this.guestViewFor(client.id, online);
    if (client.role === "prime") return this.primeViewFor(client.id, online, undefined, client.host === true || client.admin === true);
    return this.modViewNow();
  }

  /** A guest's snapshot, plus the cards they have already answered. */
  private guestViewFor(id: string, online: ReadonlySet<string>, avatars = this.avatarMap()): GuestView {
    return {
      ...guestView(this.reqSim(), id, this.decisionChannels.get(id) ?? null, online),
      answered: this.answeredFor(id),
      avatars,
      ...(this.wallet !== null ? { wallet: this.wallet.viewFor(id) } : {}),
      // The story clock is stopped: the phone's countdown strip holds still.
      ...(this.phase !== "open" ? { paused: true as const } : {}),
    };
  }

  /** A performer's snapshot, plus the cards their character has already
   *  answered, with everyone's profile pictures. */
  private primeViewFor(character: string, online: ReadonlySet<string>, avatars = this.avatarMap(), host = false): PrimeView {
    const queue = this.wallet?.queueFor(character) ?? null;
    return {
      ...primeView(this.sim, character, online, { host }),
      answered: this.answeredFor(character),
      avatars,
      ...(queue !== null ? { wallet: queue } : {}),
      // The story clock is stopped: the booth's tray holds its countdowns
      // still (the same rule as a guest's strip, `guestViewFor`).
      ...(this.phase !== "open" ? { paused: true as const } : {}),
    };
  }

  /** The operator's god view, with everyone's profile pictures. */
  private modViewNow(): ModView {
    return {
      ...modView(this.sim, this.phase, this.scenarioName, this.presence(), this.sim === null ? this.declaredCharacters : undefined, this.declaredSim),
      avatars: this.avatarMap(),
      ...(this.wallet !== null ? { wallet: this.wallet.modView() } : {}),
      // A restart with the doors shut leaves the run `paused` with its
      // `start:` beat unplayed: the doors are still closed (the phone's strip).
      ...(!this.entryPlayed ? { doorsClosed: true as const } : {}),
    };
  }

  /** The host view's last build, reused within the same second of the same log. */
  private hostViewCache: { len: number; phase: RuntimePhase; sec: number; view: HostView } | null = null;

  /** A host booth's panel (`GET /api/state?role=mod&host=1`, §2.6): built on
   *  the mod view, plus the King, the terminals, every guest's flags and the
   *  guests waiting on each agent-voiced character. Cached per second. */
  private hostViewNow(): HostView {
    const now = Date.now();
    const len = this.sim?.log.len() ?? -1;
    const sec = Math.floor(now / 1000);
    const hit = this.hostViewCache;
    if (hit !== null && hit.len === len && hit.phase === this.phase && hit.sec === sec) return hit.view;
    const sim = this.sim;
    const waiting = new Map<string, Array<{ guest: string; name: string; since: number; text: string }>>();
    for (const r of this.agents.pending) {
      if (r.speaker.kind !== "guest" || r.thread.channel !== `dm:${r.character}`) continue;
      const list = waiting.get(r.character) ?? [];
      list.push({ guest: r.speaker.id, name: r.speaker.name, since: r.at, text: r.text.slice(0, 200) });
      waiting.set(r.character, list);
    }
    const flags = new Map<string, ReturnType<typeof guestFlags>>();
    if (sim !== null) for (const id of sim.persons.keys()) flags.set(id, guestFlags(sim, id));
    this.spatialHouse();
    const king = this.spatial.king();
    const terms = screenTerminals(this.screens);
    const model = sim?.model ?? this.declaredModel;
    const view = hostView({
      mod: this.modViewNow(),
      waiting,
      king: king === null ? null : { hp: king.hp, max: king.max, fallen: king.fallen },
      terminals: { now: terms.now, silentMs: terms.silentMs, voiceMuted: terms.voiceMuted, terminals: terms.terminals.map((t) => ({ name: t.name, ago: t.ago, ...(t.room !== undefined ? { room: t.room } : {}), view: t.view })) },
      flags,
      staffRooms: model === null ? [] : staffRoomChannels(model),
      now,
    });
    this.hostViewCache = { len, phase: this.phase, sec, view };
    return view;
  }

  /** Message seqs of the widget cards `id` has answered. */
  private answeredFor(id: string): number[] {
    const out: number[] = [];
    for (const key of this.answeredWidgets) {
      const at = key.indexOf(":");
      if (key.slice(at + 1) === id) out.push(Number(key.slice(0, at)));
    }
    return out.sort((a, b) => a - b);
  }

  /** Push fresh snapshots to every connected client (mod consoles always
   *  coalesced, phones + booths when `snapshotMs` > 0). */
  private pushSnapshots(): void {
    this.pushClientSnapshots();
    this.pushModSnapshots();
  }

  /**
   * Send every guest and booth its own fresh view — at once if the last
   * round went out ≥ `snapshotMs` ago, else once when the window closes (a
   * burst of steps → one trailing round, computed then). `snapshotMs` 0 is
   * one round per step, as before SW-OPS-24.
   */
  private pushClientSnapshots(): void {
    if (this.snapshotTimer !== null) return;
    const wait = this.snapshotAt + this.snapshotMs - Date.now();
    if (wait <= 0) {
      this.flushClientSnapshots();
      return;
    }
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      this.flushClientSnapshots();
    }, wait);
    this.snapshotTimer.unref?.();
  }

  /** Flush a pending (coalesced) guest + booth round right now, if one is waiting. */
  private flushClientSnapshotsNow(): void {
    if (this.snapshotTimer === null) return;
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = null;
    this.flushClientSnapshots();
  }

  private flushClientSnapshots(): void {
    // Who's online and the picture map are the same for everyone: once a round.
    let online: Set<string> | null = null;
    let avatars: Record<string, string> | null = null;
    for (const c of this.clients) {
      if ((c.role !== "guest" && c.role !== "prime") || c.lean === true) continue;
      online ??= new Set(this.agents.onlineCharacters());
      avatars ??= this.avatarMap();
      sseSend(c.res, "snapshot", c.role === "guest" ? this.guestViewFor(c.id, online, avatars) : this.primeViewFor(c.id, online, avatars, c.host === true || c.admin === true));
    }
    if (online !== null) this.snapshotAt = Date.now();
  }

  /** Someone came or went — refresh every mod console's presence view. */
  private pushPresence(): void {
    this.pushModSnapshots();
  }

  /**
   * Send the full mod consoles a fresh `ModView` — at once if the last one
   * went out ≥ `modSnapshotMs` ago, else once when the window closes (a
   * burst of steps → one trailing frame, computed then). The view is the
   * same for every director, so it is built and serialised once per frame;
   * lean clients never get one.
   */
  private pushModSnapshots(): void {
    if (this.modSnapshotTimer !== null) return;
    const wait = this.modSnapshotAt + this.modSnapshotMs - Date.now();
    if (wait <= 0) {
      this.flushModSnapshots();
      return;
    }
    this.modSnapshotTimer = setTimeout(() => {
      this.modSnapshotTimer = null;
      this.flushModSnapshots();
    }, wait);
    this.modSnapshotTimer.unref?.();
  }

  /** Flush a pending (coalesced) mod snapshot right now, if one is waiting. */
  private flushModSnapshotsNow(): void {
    if (this.modSnapshotTimer === null) return;
    clearTimeout(this.modSnapshotTimer);
    this.modSnapshotTimer = null;
    this.flushModSnapshots();
  }

  /** Send the full consoles the current `ModView` (`owedOnly`: just those a
   *  previous frame skipped). A console still holding more unsent than one
   *  view gets none now: views never queue up behind each other for a slow
   *  link — it is owed the newest, retried until it catches up.
   *
   *  A delta console (`?delta=1`) that holds the previous frame, and had a
   *  keyframe inside `MOD_KEYFRAME_MS`, gets a `snapshotPatch` instead —
   *  computed once and shared. In an owed round such a console only rides
   *  along on a view an owed console was actually sent (so it stays on the
   *  newest frame); it never builds one itself, so a stalled console still
   *  costs nothing until it moves. Everyone else gets the whole view; a
   *  delta console's carries `_frame`. */
  private flushModSnapshots(owedOnly = false): void {
    // Same two writes as `sseSend`, the JSON serialised once for everyone.
    let data: string | null = null;
    let framed: string | null = null;
    let patch: string | null | undefined;
    let view: ModView | null = null;
    let frame = 0;
    let owed = false;
    const prev = this.modPrev;
    const now = Date.now();
    const isCurrent = (c: Client) => c.delta === true && prev !== null && c.modFrame === prev.frame && now - (c.keyframeAt ?? 0) < MOD_KEYFRAME_MS;
    const mods = [...this.clients].filter((c) => c.role === "mod" && c.lean !== true);
    // An owed round: the owed consoles first, then the current delta ones
    // that ride along — only once a view was built for an owed console.
    const order = owedOnly ? [...mods.filter((c) => c.snapshotOwed === true), ...mods.filter((c) => c.snapshotOwed !== true && isCurrent(c))] : mods;
    for (const c of order) {
      const current = isCurrent(c);
      if (owedOnly && c.snapshotOwed !== true && data === null) break; // nobody owed moved: nothing to ride on
      // Behind by the last view's size: skip before building a new one (a
      // stalled console's retries cost nothing until it moves).
      const behind = (n: number) => n > 0 && sseQueued(c.res) > n;
      if (data === null && behind(this.modViewBytes)) {
        c.snapshotOwed = true;
        owed = true;
        continue;
      }
      if (data === null) {
        view = this.modViewNow();
        data = `data: ${modViewJson(view)}\n\n`;
        frame = ++this.modFrameSeq;
        this.modViewBytes = data.length;
      }
      if (behind(data.length)) {
        c.snapshotOwed = true;
        owed = true;
        continue;
      }
      c.snapshotOwed = false;
      if (current && prev !== null) {
        // A patch bigger than the view itself is no saving: a keyframe then.
        if (patch === undefined) {
          const p = `data: ${JSON.stringify({ base: prev.frame, frame, patch: modPatch(prev.view, view!) })}\n\n`;
          patch = p.length < data.length ? p : null;
        }
        if (patch !== null) {
          sseFrame(c.res, "event: snapshotPatch\n", patch);
          c.modFrame = frame;
          continue;
        }
      }
      if (c.delta === true) {
        framed ??= data.startsWith("data: {}") ? `data: {"_frame":${frame}}\n\n` : `data: {"_frame":${frame},${data.slice(7)}`;
        sseFrame(c.res, "event: snapshot\n", framed);
        c.modFrame = frame;
        c.keyframeAt = now;
        continue;
      }
      sseFrame(c.res, "event: snapshot\n", data);
    }
    if (view !== null) this.modPrev = { frame, view };
    if (data !== null && !owedOnly) this.modSnapshotAt = Date.now();
    if (owed && this.modOwedTimer === null) {
      this.modOwedTimer = setTimeout(() => {
        this.modOwedTimer = null;
        this.flushModSnapshots(true);
      }, Math.max(this.modSnapshotMs, MOD_SNAPSHOT_MS));
      this.modOwedTimer.unref?.();
    }
  }

  /** Re-send every client its full thread history — after a reset / reload
   *  the chat timeline restarts (seqs from 0 again), so a client that kept
   *  the old feed would interleave stale rows with new ones. */
  private pushHistory(): void {
    // No keyframe here: a `ModView` doesn't hold the chat timeline, and the
    // `lifecycle` notice ahead of every re-sent history already brought one.
    for (const c of this.clients) if (c.lean !== true) sseSend(c.res, "history", this.historyFor(c));
  }

  /** A stream's `history` frame: a director's is the whole feed; a guest's
   *  and a booth's are capped (`capHistory`: the recent stream, plus their
   *  pinned rooms, pins, alerts, cards, own threads and thread roots). */
  private historyFor(c: Client): ChatMessage[] {
    return c.role === "guest"
      ? capHistory(this.chat.historyFor(c.id, false), HISTORY_LIMIT, guestOwnRow(c.id)).map(forGuest)
      : c.role === "mod"
        ? [...this.chat.all()]
        : capHistory(
            this.chat.all().filter((m) => !m.hidden && visibleToPrime(m, c, this.agentVoiced)),
            HISTORY_LIMIT,
            boothOwnRow(c.id),
          );
  }

  /** A lifecycle transition every connected client should react to
   *  (`reset` / `reload` → drop local state; `ended` → the event is gone). */
  private pushLifecycle(kind: LifecycleKind, extra: Record<string, unknown> = {}): void {
    this.modPrev = null; // the next view after a transition is a keyframe
    for (const c of this.clients) sseSend(c.res, "lifecycle", { kind, at: Date.now(), ...extra });
  }

  /** Close every stream of one role (after a cut they announce) and forget
   *  the clients, so presence stops counting them. */
  /** N-02 `revokeOthers`: cut every token of guest `id`, their real
   *  streams, and their push devices. Returns how many tokens went. */
  private revokeGuest(id: string): number {
    let n = 0;
    for (const [token, guest] of [...this.guestTokens]) {
      if (guest !== id) continue;
      this.guestTokens.delete(token);
      n++;
    }
    if (n > 0) this.persistGuests();
    for (const c of [...this.clients]) {
      if (c.role !== "guest" || c.id !== id || c.via !== undefined) continue;
      this.clients.delete(c);
      try {
        c.res.end();
      } catch {
        /* client already gone */
      }
    }
    this.push.drop((owner) => owner === guestOwner(id));
    this.pushPresence();
    return n;
  }

  private endClients(role: Client["role"]): void {
    for (const c of [...this.clients]) {
      if (c.role !== role) continue;
      this.clients.delete(c);
      try {
        c.res.end();
      } catch {
        /* client already gone */
      }
    }
  }

  private toPrime(character: string, event: string, data: unknown): void {
    for (const c of this.clients) if (c.role === "prime" && c.id === character) sseSend(c.res, event, data);
  }

  /**
   * Deliver one composed message to the clients that should see it: guests
   * whose id is in the audience (hidden messages withheld), and every
   * performer/mod console (the full feed, so admins can moderate live).
   */
  private deliverMessage(m: ChatMessage): void {
    for (const c of this.clients) {
      if (c.role === "guest") {
        if (!m.hidden && visibleTo(m, c.id)) sseSend(c.res, "message", forGuest(m));
      } else if (c.role === "prime") {
        if (visibleToPrime(m, c, this.agentVoiced)) sseSend(c.res, "message", m);
      } else {
        sseSend(c.res, "message", m);
      }
    }
    this.pushMessage(m);
  }

  /**
   * K-31a: push one just-delivered message to the phones entitled to it —
   * the same visibility as the SSE delivery. `!` alerts go to every
   * subscribed guest who can see it, and to the booths when they are
   * house-wide or in an authored room (a guest's own `!` pin is theirs
   * alone); a character's DM only to its addressee, and only while their
   * page says it is hidden.
   */
  private pushMessage(m: ChatMessage): void {
    if (!this.push.enabled) return;
    const rule = messagePush(m, this.title);
    if (rule === null) return;
    for (const owner of this.push.owners()) {
      if (owner.startsWith("guest:")) {
        const id = owner.slice("guest:".length);
        if (m.from === id || !visibleTo(m, id)) continue;
        if (rule.payload.kind === "dm" && (m.audience === "all" || !m.audience.includes(id))) continue;
      } else if (m.kind === "wallet") {
        // A wallet card addressed `@<Character>` (the approver's queue)
        // reaches that character's booth and nobody else's.
        const character = owner.startsWith("prime:") ? owner.slice("prime:".length) : null;
        if (character === null || m.audience === "all" || !m.audience.includes(`@${character}`)) continue;
      } else if (rule.payload.kind !== "alert") {
        continue; // booths: alerts here, their own readouts in `fanout`
      } else if (m.audience !== "all" && !m.channel.startsWith("room:")) {
        // A booth hears only house-wide alerts and authored-room alerts (a
        // staff back-room's pin). One addressed to a single guest — their
        // own `!` pin — is theirs alone; the booth's cue is its readout.
        continue;
      }
      this.push.notify(owner, rule.payload, rule.always);
    }
  }

  // -- ephemeral messages --------------------------------------------------

  /** Has a message aged past its channel's ephemeral lifetime? */
  private isExpired(m: ChatMessage): boolean {
    if (this.sim === null) return false;
    const eph = this.sim.ephemeralMsOf(m.channel);
    return eph !== null && this.sim.elapsed() - m.ts >= eph;
  }

  /** Notify clients of ephemeral messages that just expired (drives removal). */
  private sweepEphemeral(): void {
    for (const m of this.chat.all()) {
      if (this.notifiedExpired.has(m.seq) || !this.isExpired(m)) continue;
      this.notifiedExpired.add(m.seq);
      for (const c of this.clients) {
        if (c.role !== "guest" || visibleTo(m, c.id)) sseSend(c.res, "messageExpired", { seq: m.seq });
      }
    }
  }

  /**
   * Route a freshly-emitted batch of sim events. Performer scan readouts go
   * straight to the booth; everything guest-facing is composed into channel
   * messages, appended to the chat store, and delivered.
   */
  private fanout(events: SimEvent[], via?: string): void {
    if (this.agents.judging.length > 0) this.dropMootRulings();
    for (const e of events) {
      if (e.type === "respond") {
        // The alert `!` stripped, as the Inbox row has it (`alert` says it was there).
        const { text, alert } = readoutText(e.text);
        this.toPrime(e.to, "response", { text, ...(alert ? { alert: true } : {}) });
        // A locked booth still hears it (the door alarm, the late list).
        this.push.notify(boothOwner(e.to), readoutPush(e.to, text), false);
      }
      if (e.type === "choicePrompted" && e.person !== null) {
        this.decisionChannels.set(e.person, decisionChannelFor(events, e.person));
      }
      // Mods (the editor's Run mode) also get the raw sim feed, so the
      // story-graph overlay lights beats up as they fire and a future
      // in-editor simulator can mirror the whole run.
      for (const c of this.clients) if (c.role === "mod") sseSend(c.res, "sim", e);
    }
    const drafts = composeGuestMessages(this.sim ?? EMPTY_SIM, events);
    // A director speaking *as* a participant: the room sees the participant's
    // name, the mod feed additionally sees who really typed it.
    if (via !== undefined) for (const d of drafts) if (d.kind === "line") d.via = via;
    for (const m of this.chat.append(drafts)) this.deliverMessage(m);
    for (const id of [...this.decisionChannels.keys()]) {
      if (this.sim?.pendingChoiceFor(id) == null) this.decisionChannels.delete(id);
    }
    this.pushSnapshots();
    this.runPicks(events);
  }

  /**
   * `do pick <event> from [id, id, …] else <event>` — the story asks for one
   * random person (Loom has no random person pick; `Math.random` inside the
   * sim would break replay). The draw is journaled as an ordinary signal,
   * so a restart replays the same pick. Live only: `restore()` never calls
   * `fanout`. A pick fired from inside a pick's own signal is ignored (no
   * loop through a hook that draws again).
   */
  private runPicks(events: SimEvent[]): void {
    if (this.sim === null || this.pickDepth > 0) return;
    for (const e of events) {
      if (e.type !== "directive" || e.verb !== "pick") continue;
      const m = /^(\S+)\s+from\s+\[([^\]]*)\](?:\s+else\s+(\S+))?$/u.exec(e.args.trim());
      if (m === null) continue;
      const pool = m[2]!
        .split(",")
        .map((s) => s.trim())
        .filter((id) => id !== "" && this.sim!.persons.has(id));
      this.pickDepth += 1;
      try {
        if (pool.length === 0) {
          if (m[3] !== undefined) this.fanout(this.commit("signal", m[3]));
          continue;
        }
        const pick = pool[Math.min(pool.length - 1, Math.max(0, Math.floor(this.random() * pool.length)))]!;
        this.fanout(this.commit("signal", m[1]!, pick));
      } finally {
        this.pickDepth -= 1;
      }
    }
  }

  // -- the facts judge (facts.ts) --------------------------------------------

  /** The key in force: the project's snapshot (parsed once per text; a
   *  broken one judges nothing rather than quietly playing the show's), else
   *  the show file, re-read when its mtime changes with the last good book
   *  kept over a broken edit. Null = no key → nothing is judged. */
  private factsBook(): FactsBook | null {
    const text = this.projectFacts;
    if (text !== null) {
      if (this.factsMemo === null || this.factsMemo.text !== text) {
        const p = parseFactsBook(text);
        if (p.book === null) process.stderr.write(`  ⚠️  event ${this.eventId}: the project's ${FACTS_FILE} is ignored (${p.problems[0] ?? "invalid"})\n`);
        this.factsMemo = { text, book: p.book };
      }
      return this.factsMemo.book;
    }
    let mtimeMs: number;
    try {
      mtimeMs = statSync(this.factsFile).mtimeMs;
    } catch {
      return this.showFacts?.book ?? null;
    }
    if (this.showFacts === null || this.showFacts.mtimeMs !== mtimeMs) {
      const p = readFactsFile(this.factsFile);
      if (p.book === null) {
        process.stderr.write(`  ⚠️  facts key ${this.factsFile}: ${p.problems[0] ?? "invalid"} — keeping the last good key\n`);
        this.showFacts = { mtimeMs, book: this.showFacts?.book ?? null };
      } else this.showFacts = { mtimeMs, book: p.book };
    }
    return this.showFacts.book;
  }

  /** The director's ledger (`ModView.facts`), only when a key is in force. */
  private factsView(): FactsView | undefined {
    const book = this.factsBook();
    if (book === null || this.sim === null) return undefined;
    const judge = this.sim.model.judge;
    const view = judge === null ? this.factsWatch.view(this.sim, book) : { ...this.factsWatch.view(this.sim, book), judge };
    const asking = new Set(this.agents.judging.map((j) => `${j.filing.person}\u0000${j.filing.question}`));
    if (asking.size === 0) return view;
    return {
      ...view,
      questions: view.questions.map((q) => ({ ...q, filings: q.filings.map((f) => (asking.has(`${f.person}\u0000${f.question}`) ? { ...f, asking: true as const } : f)) })),
    };
  }

  /** The project's `facts.json` as this event holds it (tests, tooling). */
  get facts(): string | null {
    return this.projectFacts;
  }

  /** A reload's fresh snapshot of the project's facts.json (`events-api.ts`,
   *  `/api/mod/load {facts}`): the key the judge reads from now on (null =
   *  the project has none → the show file). */
  setProjectFacts(text: string | null): void {
    this.projectFacts = text;
    this.store.saveFacts(text);
    this.pushModSnapshots();
  }

  /** The event row's data-file record: the map files plus the project's
   *  `facts.json` when it has one (`events-api.ts` reads the maps with
   *  `asMapFiles`, the facts with `factsOf`). */
  private dataSnapshot(maps: MapFiles): MapFiles {
    return { ...maps, ...(this.projectFacts !== null ? { [FACTS_FILE]: this.projectFacts } : {}) };
  }

  /**
   * The judge hop: a `fact` card is judged on the client's {question, answer,
   * confidence}, an `answer` card on the card's own `question` param (never
   * the client's) and {text}. Null = nothing to judge (no key in force, an
   * un-keyed card, another kind); "refused" = a bad filing (400). A `fact`
   * filing for a question the key lacks is refused only while a key exists;
   * without one the args pass untouched (other projects). `review`: a near
   * miss filed while the mode is `auto` — that one filing takes the review
   * path (`commitUnderReview`); `near` = the key form it is close to.
   */
  private judgeWidget(card: NonNullable<ChatMessage["widget"]>, args: Record<string, string | number | boolean>): { args: Record<string, string | number>; review: boolean; near: string | null } | null | "refused" {
    const book = this.factsBook();
    if (book === null) return null;
    if (card.kind === "fact") {
      const q = args["question"];
      const a = args["answer"];
      const c = args["confidence"];
      if (typeof q !== "string" || typeof a !== "string" || a.trim() === "" || typeof c !== "number" || !Number.isInteger(c) || c < 1 || c > 100) return "refused";
      // A near miss (`Mr Pickels`) is proposed accurate, never a lie or a
      // guess by itself: a director decides it (wave 11, C6).
      const judged = judgeFiling(book, q, a, c);
      if (judged === null) return "refused";
      const { verdict } = judged;
      // An accurate filing also carries the key's canonical answer, so the
      // story reads "Mister Pickles", never whichever alias came in last.
      // Only a filer who already knew it (or all but typed it) ever puts it
      // in the journal.
      return {
        args: verdict === "accurate" ? { verdict, key_answer: factsKey(book, q)!.answer } : { verdict },
        review: judged.near !== null && judgeMode(book, worldReader(this.sim!)) === "auto",
        near: judged.near,
      };
    }
    if (card.kind === "answer") {
      const q = card.params["question"];
      const t = args["text"];
      if (q === undefined) return null;
      if (typeof t !== "string" || t.trim() === "") return "refused";
      const verdict = judgeAnswer(book, q, t, 100);
      return verdict === null ? "refused" : { args: { verdict, question: q }, review: false, near: null };
    }
    return null;
  }

  /**
   * Commit `apply` (a 📝 near-miss filing) as if the judging mode were
   * `review`: the book's mode var is set to `review` just before and put
   * back just after, each a journaled `setVar` by the judge — so the story's
   * own review path holds the filing pending for a director (Run → Mind →
   * Judging, one `# hosts` line from the story), and a replay lands the same.
   * `notice`: the server's own `# hosts` line after the story's, saying the
   * proposal came from the near-miss rule, not an exact match (the story's
   * line only reads "Proposed: accurate").
   */
  private commitUnderReview(apply: () => SimEvent[], notice: string | null = null): SimEvent[] {
    const book = this.factsBook();
    const sim = this.sim;
    if (book === null || sim === null) return apply();
    const was = worldReader(sim)(book.modeVar) ?? "auto";
    const actingBy = this.actingBy;
    this.actingBy = JUDGE_BY;
    const before = this.commit("setVar", book.modeVar, "review");
    this.actingBy = actingBy;
    const events = apply();
    this.actingBy = JUDGE_BY;
    const after = this.commit("setVar", book.modeVar, was);
    const room = notice === null ? null : hostsRoomOf(sim.model);
    const told = room === null ? [] : this.commit("broadcast", `channel(${room})`, notice!);
    this.actingBy = actingBy;
    return [...before, ...events, ...after, ...told];
  }

  // -- rulings: the `judge:` character on near misses (wave 11b, contract J) --

  /** The story's `judge:` character when a ruling may be asked now: a key
   *  in force, `auto` mode, and a worker voicing it online and answering.
   *  Null → wave 11's rule (the near miss waits, credited at the settle). */
  private rulerOnline(): string | null {
    const sim = this.sim;
    const judge = sim?.model.judge ?? null;
    if (sim === null || judge === null || !this.agents.canJudge(judge)) return null;
    const book = this.factsBook();
    if (book === null || judgeMode(book, worldReader(sim)) !== "auto") return null;
    return judge;
  }

  /** The ledger filing (person, question) as it stands, or null. */
  private filingOf(person: string, question: string) {
    const book = this.factsBook();
    if (book === null || this.sim === null) return null;
    return this.factsWatch.all(this.sim, book.confirm).find((f) => f.person === person && f.question === question) ?? null;
  }

  /**
   * Ask the `judge:` character to rule on `person`'s pending near miss for
   * `question` — once per filing answer (`rulingsAsked`; a restart forgets,
   * so a near miss still pending after a restore may be asked again). True
   * when the `judge` frame went out.
   */
  private askRuling(person: string, question: string): boolean {
    const judge = this.rulerOnline();
    const book = this.factsBook();
    if (judge === null || book === null) return false;
    const f = this.filingOf(person, question);
    if (f === null || f.final !== null) return false;
    const key = factsKey(book, question);
    const near = this.factsWatch.nearOf(book, question, f.answer);
    if (key === null || near === null) return false;
    const asked = `${person}\u0000${question}\u0000${f.answer}`;
    if (this.rulingsAsked.has(asked)) return false;
    if (this.agents.judging.some((j) => j.filing.person === person && j.filing.question === question)) return false;
    const id = this.agents.judge({
      character: judge,
      filing: { id: `${person}:${question}`, person, name: f.name, question },
      question: { id: key.id, text: key.text },
      key: { answer: key.answer, aliases: key.forms.slice(1) },
      answer: f.answer,
      confidence: f.confidence,
    });
    if (id === null) return false;
    this.rulingsAsked.add(asked);
    this.rulingsDue.delete(asked);
    this.pushModSnapshots();
    return true;
  }

  /** Every near miss a restore left pending that nobody has asked about
   *  yet (a worker just connected, the ticker): ask. Only in auto mode,
   *  with a `judge:` and a worker that can answer. A near miss that landed
   *  in this process with nobody to ask is never here (`rulingsDue`). */
  private askPendingRulings(): void {
    if (this.rulingsDue.size === 0 || this.rulerOnline() === null) return;
    const book = this.factsBook();
    if (book === null || this.sim === null) return;
    for (const f of this.factsWatch.all(this.sim, book.confirm)) {
      const due = `${f.person}\u0000${f.question}\u0000${f.answer}`;
      if (!this.rulingsDue.has(due)) continue;
      if (f.final !== null || this.factsWatch.nearOf(book, f.question, f.answer) === null) {
        this.rulingsDue.delete(due);
        continue;
      }
      this.askRuling(f.person, f.question);
    }
  }

  /** After a restore: the near misses still pending, due a ruling. */
  private noteRulingsDue(): void {
    this.rulingsDue.clear();
    const book = this.factsBook();
    if (book === null || this.sim === null || this.sim.model.judge === null) return;
    for (const f of this.factsWatch.all(this.sim, book.confirm)) {
      if (f.final !== null || this.factsWatch.nearOf(book, f.question, f.answer) === null) continue;
      this.rulingsDue.add(`${f.person}\u0000${f.question}\u0000${f.answer}`);
    }
  }

  /** A ruling whose filing moved on — judged (a director first, a round's
   *  settle) or filed again with another answer — is cancelled, so its
   *  late answer gets a 410. */
  private dropMootRulings(): void {
    for (const j of this.agents.judging) {
      const f = this.filingOf(j.filing.person, j.filing.question);
      if (f === null || f.final !== null || f.answer !== j.answer) this.agents.cancelJudge(j.id);
    }
  }

  /**
   * `POST /api/agent/judge {id, worker, same, why}` — the `judge:`
   * character's ruling on a near miss. Applied through the same journaled
   * path as a director's Judging-card verdict (the book's confirm event on
   * the filer, the question named), `by: agent:<Character>`, the ruling in
   * its args so a replay rebuilds it: same → accurate; not → a lie at
   * confidence 100, else uncertain. Then one `# hosts` line. 410 when the
   * ruling is gone (a director judged first, it expired, a restart).
   */
  private agentJudge(res: ServerResponse, body: Record<string, unknown>): void {
    const same = body["same"];
    if (typeof same !== "boolean") {
      sendJson(res, 400, { error: "a ruling says same: true or false" });
      return;
    }
    const why = str(body, "why").trim().replace(/\s+/gu, " ").slice(0, 200).trim();
    const gone = () => sendJson(res, 410, { error: "no such open ruling (judged already, expired, or the run restarted)" });
    const j = this.agents.judgeSettle(str(body, "id"), str(body, "worker") || undefined);
    const sim = this.sim;
    const book = this.factsBook();
    if (j === null || sim === null || book === null) {
      gone();
      if (j !== null) this.pushModSnapshots();
      return;
    }
    const f = this.filingOf(j.filing.person, j.filing.question);
    if (f === null || f.final !== null || f.answer !== j.answer) {
      gone();
      this.pushModSnapshots();
      return;
    }
    const verdict: FactVerdict = same ? "accurate" : f.confidence >= CONFIDENCE_MAX ? "lie" : "uncertain";
    const event = book.confirm[verdict];
    const actingBy = this.actingBy;
    this.actingBy = `${AGENT_BY}${j.character}`;
    let events: SimEvent[];
    try {
      events = this.commit("signal", event, j.filing.person, { question: j.filing.question, [RULING_ARG]: same ? "same" : "not", [RULING_WHY_ARG]: why });
      const after = this.filingOf(j.filing.person, j.filing.question);
      const judged = after !== null && after.final !== null;
      if (judged) {
        const room = hostsRoomOf(sim.model);
        const key = factsKey(book, j.filing.question)?.answer ?? j.key.answer;
        if (room !== null) events = [...events, ...this.commit("broadcast", `channel(${room})`, rulingNotice(j.character, f.name, j.filing.question, f.answer, key, same, verdict, why))];
      }
      this.fanout(events);
      sendJson(res, 200, judged ? { ok: true, verdict } : { ok: true, verdict, refused: true });
    } finally {
      this.actingBy = actingBy;
    }
  }

  // -- agent-voiced characters ---------------------------------------------

  /** Every agent character's request line, for the director's cast rows. */
  private agentQueues(): Map<string, AgentQueue> {
    const out = new Map<string, AgentQueue>();
    for (const c of this.sim?.model.characters.values() ?? []) if (c.mind === "external") out.set(c.id, this.agents.queue(c.id));
    return out;
  }

  /** May this thread reach the agent at all? Not a guest's DM with a
   *  character still hidden from that guest (K-16): before Clippy introduces
   *  Trabolta nothing — a wall terminal, a stale tab — may draw a hold line
   *  into a guest's real thread. Performers' cast threads always pass. */
  private agentAdmits(thread: AgentThread): boolean {
    const sim = this.sim;
    const who = thread.audience[0];
    if (sim === null || who === undefined || who.startsWith("@")) return true;
    const def = sim.model.characters.get(thread.character);
    return def === undefined || !def.hidden || sim.isRevealedTo(def.id, who);
  }

  /** The declared character `name` names (case / space / `_` / `-` folded),
   *  as its canonical id; null for none. */
  private characterNamed(name: string): string | null {
    const chars = this.sim?.model.characters;
    if (chars === undefined) return null;
    if (chars.has(name)) return chars.get(name)!.id;
    const want = foldName(name);
    if (want === "") return null;
    for (const def of chars.values()) if (foldName(def.id) === want) return def.id;
    return null;
  }

  /**
   * Is `channel` a room a guest's typed line may land in? Null when it is
   * (whether they may post there is `Sim.canPost`'s call), else the refusal:
   * 404 for a room the story doesn't have, 403 for a public group's room
   * the guest isn't in (`canPost` takes an undeclared-in-`model.channels`
   * id as open to post, which is how the lobby and `faction:` work). The
   * lobby, `dm:` (resolved above), `pm:` (`canPost` checks the two
   * parties), the pinned rooms (`canPost` refuses them), a declared place's
   * `loc:` room and an authored room the guest can see, and a room this
   * guest was already written to in are rooms. A room this guest can't see
   * reads as one the story doesn't have (404), never 403: a hidden group's
   * room before its reveal (`faction:The Way Out` before 🕚), a hidden place
   * they haven't stood in or been shown, an authored room hidden from them
   * or kept to its members (`room:hosts`, `room:the way out`) — so a
   * crafted post can't learn the hidden sides and rooms early.
   */
  private guestRoom(guestId: string, channel: string): { status: 403 | 404; error: string } | null {
    const sim = this.sim!;
    if (channel === "lobby" || channel.startsWith("dm:") || channel.startsWith("pm:") || isPinnedRoom(channel)) return null;
    const none = { status: 404 as const, error: "no such room" };
    if (channel.startsWith("faction:")) {
      const group = channel.slice("faction:".length);
      const def = sim.model.factions.get(group);
      if (def === undefined) return none;
      if (sim.factionMembers(group).includes(guestId)) return null;
      return def.hidden && !sim.factionRevealed(def.id) ? none : { status: 403, error: "you can't post here" };
    }
    if (channel.startsWith("loc:")) return sim.canSeeChannel(guestId, channel) ? null : none;
    if (sim.model.channels.has(channel)) return sim.canSeeChannel(guestId, channel) ? null : none;
    return this.chat.historyFor(guestId, false).some((m) => m.channel === channel) ? null : none;
  }

  /**
   * May guest `by` invite `person` into `channel`? Null when they may, else
   * the refusal (T6 recheck — before, any guest could add themself to any
   * invite-only room). A room the guest can't see reads as one the story
   * doesn't have (404, like `/api/guest/say`), so a private room they
   * aren't in is a 404 too; only an authored invite-only room (`private` /
   * `group` / `dm`) takes invites (400 otherwise); nobody invites
   * themself; and the channel's `invite:` policy holds — `members` (the
   * default: "members can invite others") needs the inviter to be a member
   * already, `anyone` any guest who can see it, any other word names the
   * ROLE that may invite. The story's own invites and the performer and
   * director routes don't come through here.
   */
  private guestInviteRefusal(by: string, person: string, channel: string): { status: 400 | 403 | 404; error: string } | null {
    const sim = this.sim!;
    const room = this.guestRoom(by, channel);
    if (room !== null) return room;
    const def = sim.model.channels.get(channel);
    if (def === undefined || def.kind === "open" || def.kind === "faction") return { status: 400, error: "not an invite-only room" };
    if (!sim.persons.has(person)) return { status: 404, error: "unknown guest" };
    if (person === by) return { status: 403, error: "you can't invite yourself" };
    const policy = (def.invite ?? "members").trim().toLowerCase();
    const member = sim.isChannelMember(by, channel);
    if (policy === "anyone") return null;
    if (policy === "members") return member ? null : { status: 403, error: "only its members can invite" };
    const role = sim.persons.get(by)?.role ?? "";
    return member && foldName(role) === foldName(policy) ? null : { status: 403, error: "you can't invite to this room" };
  }

  /** A non-character `dm:` thread `guestId` may reply in: a stage voice's
   *  (`dm:Operator` / `dm:Narrator` — the voices `/api/mod/say` speaks as
   *  besides characters), or one already addressed to this guest. */
  private guestDmThread(guestId: string, channel: string): boolean {
    if (channel === "dm:Operator" || channel === "dm:Narrator") return true;
    return this.chat.historyFor(guestId, false).some((m) => m.channel === channel);
  }

  /** Is `name` a character voiced by an outside agent (`mind: external`)? */
  private isAgent(name: string): boolean {
    return this.sim?.model.characters.get(name)?.mind === "external";
  }

  /** A line just landed in `channel` for `audience` — if that's an agent's
   *  thread, the agent owes an answer. */
  private agentHeard(channel: string, audience: string[], held = false): void {
    if (!channel.startsWith("dm:") || audience.length !== 1) return;
    const character = channel.slice("dm:".length);
    if (!this.isAgent(character)) return;
    this.agents.line({ character, channel, audience }, { held });
  }

  /** After a restore: every agent thread still owed an answer — someone
   *  else's line since the character last really spoke (its hold and busy
   *  lines are the server's, not the character speaking) — gets its request
   *  again, as the hub's queue died with the process (a worker answers it,
   *  or the hold line follows, never twice: a thread with a hold line since
   *  the character last really spoke is re-asked as already held, however
   *  many lines the guest typed after it — R1-diff-server-02). Only a line
   *  from the last `AGENT_QUEUE_MAX_AGE_MS` of the story clock: live, an
   *  older request has been dropped. */
  private requeueAgentThreads(): void {
    const sim = this.sim;
    if (sim === null) return;
    interface Tail {
      /** The newest line from someone else since the character's last real line. */
      owed: ChatMessage | null;
      /** A hold line after it (since the character's last real line). */
      held: boolean;
      last: ChatMessage;
    }
    const tails = new Map<string, Tail>(); // thread →
    for (const m of this.chat.all()) {
      if (m.hidden || !m.channel.startsWith("dm:") || !Array.isArray(m.audience) || m.audience.length !== 1) continue;
      const character = m.channel.slice("dm:".length);
      if (!this.isAgent(character)) continue;
      const key = `${m.channel}|${m.audience[0]}`;
      const t = tails.get(key);
      const def = sim.model.characters.get(character);
      let owed = t?.owed ?? null;
      let held = t?.held ?? false;
      if (m.from !== character) {
        if (m.kind === "line") owed = m;
      } else if (def?.hold !== null && def?.hold !== undefined && m.text === def.hold) {
        if (owed !== null) held = true;
      } else if (!(def?.busy !== null && def?.busy !== undefined && m.text === def.busy)) {
        owed = null;
        held = false;
      }
      tails.set(key, { owed, held, last: m });
    }
    const now = sim.elapsed();
    for (const { owed, held, last } of tails.values()) {
      if (owed === null || now - owed.ts > AGENT_QUEUE_MAX_AGE_MS) continue;
      this.agentHeard(last.channel, last.audience as string[], held);
    }
  }

  /** No worker has picked up `req` in time: post the character's authored
   *  `hold:` line into the thread as an ordinary journaled say (the director
   *  can still answer as the character from Run). */
  private postAgentHold(req: AgentRequest): boolean {
    const line = this.sim?.model.characters.get(req.character)?.hold ?? null;
    if (line === null) return false;
    this.fanout(this.commit("say", req.character, req.thread.channel, line, null, req.thread.audience));
    return true;
  }

  /** `req` has waited behind a burst on a worker still answering: post the
   *  character's authored `busy:` line once in the thread — once ever, so a
   *  restart (which forgets the hub's own once-per-thread) never says it
   *  twice. */
  private postAgentBusy(req: AgentRequest): boolean {
    const line = this.sim?.model.characters.get(req.character)?.busy ?? null;
    if (line === null) return false;
    const who = req.thread.audience.join(",");
    const said = this.chat.all().some((m) => m.channel === req.thread.channel && m.from === req.character && m.text === line && Array.isArray(m.audience) && m.audience.join(",") === who);
    if (said) return false;
    this.fanout(this.commit("say", req.character, req.thread.channel, line, null, req.thread.audience));
    return true;
  }

  /** A worker stopped answering (its head waited 60 s): one line in the
   *  story's staff room (`# hosts`), so a director answers by hand. No staff
   *  room → nothing (Run still shows `agentQueue.stalled`). */
  private postAgentStall(worker: { name: string; characters: string[] }, waiting: number): void {
    const sim = this.sim;
    const room = sim === null ? null : hostsRoomOf(sim.model);
    if (room === null) return;
    const who = worker.characters.join(" / ") || "the agent";
    const many = waiting === 1 ? "1 thread is waiting" : `${waiting} threads are waiting`;
    this.fanout(this.commit("broadcast", `channel(${room})`, `⏳ ${who} stopped answering (worker ${worker.name}): ${many} and got the hold line. Answer them from Run as ${who}; it clears when ${who} answers again.`));
  }

  /**
   * `<head>.*` vars as an agent may see them: a participant's ROLE
   * `secret:` slots (the virus they carry, the mission they chose — a
   * name, or a dotted path like `quest.excel_mission`) and the
   * `codex.<slug>` flag of every `secret: true` CODEX entry are left out,
   * so neither the voice nor the orchestrator can read a secret off the
   * guest it is talking to (or off the facts document). Membership of a
   * hidden group nobody has revealed yet is left out too: `faction` /
   * `group` / `trueFaction` naming it are dropped and `groups` lists only
   * the groups an agent may know of.
   */
  private agentVarsOf(world: ReadonlyArray<{ path: string; value: string }>): (head: string) => Record<string, string> {
    const sim = this.sim!;
    const secretCodex = new Set([...sim.model.codex.values()].filter((e) => e.secret).map((e) => `codex.${Sim.codexSlug(e.id)}`));
    const hidden = (g: string) => this.agentHiddenGroup(g);
    return (head: string): Record<string, string> => {
      const person = sim.persons.get(head);
      const secret = person === undefined ? null : (sim.model.roles.get(person.role)?.secret ?? null);
      const out: Record<string, string> = {};
      for (const w of world) {
        if (!w.path.startsWith(`${head}.`)) continue;
        const key = w.path.slice(head.length + 1);
        if (secretCodex.has(key)) continue;
        if (secret !== null && (secret.has(key) || secret.has(key.split(".")[0]!))) continue;
        if ((key === "faction" || key === "group" || key === "trueFaction") && hidden(w.value)) continue;
        if (key === "groups" && person !== undefined) {
          out[key] = `[${sim.groupsOf(head).filter((g) => !hidden(g)).join(", ")}]`;
          continue;
        }
        out[key] = w.value;
      }
      return out;
    };
  }

  /** A `hidden: true` group the story has not revealed: an agent may not
   *  know it exists, let alone who is in it. */
  private agentHiddenGroup(group: string): boolean {
    const sim = this.sim!;
    return (sim.model.factions.get(group)?.hidden ?? false) && !sim.factionRevealed(group);
  }

  /** The world's globals as an agent may see them: every path whose head is
   *  neither a person nor a character, minus an unrevealed hidden group's
   *  own paths (`<Group>.members` would name its members). */
  private agentGlobals(world: ReadonlyArray<{ path: string; value: string }>): Record<string, string> {
    const sim = this.sim!;
    const globals: Record<string, string> = {};
    for (const w of world) {
      const head = w.path.split(".")[0]!;
      if (sim.persons.has(head) || sim.model.characters.has(head)) continue;
      if (this.agentHiddenGroup(head)) continue;
      globals[w.path] = w.value;
    }
    return globals;
  }

  /** Everything a worker needs to answer one thread, read from the live sim. */
  private buildAgentRequest(thread: AgentThread, id: string): AgentRequest | null {
    const sim = this.sim;
    if (sim === null) return null;
    const who = thread.audience[0]!;
    const performer = who.startsWith("@") ? who.slice(1) : null;
    // Wave 12 (C1.6): read on every build, so a flip needs no restart of
    // the request; off = the base branch's request, field for field.
    const recentOn = agentRecentOn();
    const all = this.chat.all();
    const lines = all.filter((m) => m.channel === thread.channel && m.kind === "line" && !m.hidden && m.audience !== "all" && m.audience.includes(who));
    const def = sim.model.characters.get(thread.character);
    const tag: StoryTagContext | null = recentOn ? { character: thread.character, hold: def?.hold ?? null, busy: def?.busy ?? null, storyTexts: storyTexts(all, thread.character) } : null;
    const history: AgentLine[] = lines.slice(-AGENT_HISTORY).map((m) => ({
      seq: m.seq,
      mine: m.from === thread.character,
      from: m.from,
      text: m.text,
      ...(tag !== null && storyTag(m, tag) ? { story: true as const } : {}),
    }));
    const last = [...history].reverse().find((l) => !l.mine);
    if (last === undefined) return null; // nothing said to answer
    const world = sim.worldEntries();
    const varsOf = this.agentVarsOf(world);
    const globals = this.agentGlobals(world);
    // Titles only (wave 12, C1.3) blanks the text the worker's own guard
    // reads for the hunt-answer marker, so an entry carrying it is left out
    // here (the gift check's twin); with the text sent the worker sees it.
    const codex = (holder: string, text = true) =>
      sim
        .codexFor(holder)
        .filter((e) => !e.secret && (text || !(e.title.includes(HUNT_ANSWER_MARK) || e.text.includes(HUNT_ANSWER_MARK))))
        .map((e) => ({ id: e.id, title: e.title, about: e.about, text: text ? e.text : "" }));
    const speakerId = performer ?? who;
    const speakerName = performer ?? sim.persons.get(who)?.name ?? who;
    return {
      id,
      character: thread.character,
      thread,
      speaker:
        performer !== null
          ? { kind: "performer", id: performer, name: performer, faction: sim.model.characters.get(performer)?.faction ?? null }
          : { kind: "guest", id: who, name: sim.persons.get(who)?.name ?? who, faction: sim.publicFactionOf(who) },
      text: last.text,
      history,
      self: {
        vars: varsOf(thread.character),
        ranges: Object.fromEntries(def?.ranges ?? []),
        codex: codex(thread.character),
      },
      them: {
        vars: varsOf(speakerId),
        // Wave 12 (C1.3): the guest's entries as titles only; his own keep
        // their text (the classic prompt reads it).
        codex: codex(speakerId, !recentOn),
        location: performer === null ? sim.locationOf(who) : null,
      },
      world: globals,
      powers: this.agentPowers(),
      // The hub's clock (an injected one in tests), so its max-age check
      // and a pause's shift read the same time.
      at: this.clock(),
      ...(tag !== null ? this.agentRecentOf(thread, performer !== null ? "performer" : "guest", speakerId, speakerName, all, lines, tag) : {}),
    };
  }

  /** `recent` + `storyAt` for one request (wave 12, C1.2): rebuilt from the
   *  chat log, the world and the facts ledger every time, never stored. */
  private agentRecentOf(thread: AgentThread, kind: "guest" | "performer", id: string, name: string, all: readonly ChatMessage[], lines: readonly ChatMessage[], tag: StoryTagContext): { recent: AgentRecent[]; storyAt: number } {
    const sim = this.sim!;
    const storyAt = sim.elapsed();
    let lastFreeReply: number | null = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = lines[i]!;
      if (m.from === thread.character && !storyTag(m, tag)) {
        lastFreeReply = m.ts;
        break;
      }
    }
    const book = this.factsBook();
    const filings = book === null || kind !== "guest" ? [] : this.factsWatch.all(sim, book.confirm).map((f) => ({ person: f.person, question: f.question, at: f.at }));
    const topics = new Map((book?.raw.questions ?? []).map((q) => [q.id, q.topics ?? []] as const));
    const mentionsAnswer = book === null ? undefined : answerMentions([...book.questions, ...book.answers].map((k) => ({ forms: k.forms, topics: topics.get(k.id) ?? [] })));
    // C0.1: a house line filled in from a secret character (the Kernel) is
    // never his to read, whatever the hour.
    const secretHeads = new Set([...sim.model.characters.values()].filter((c) => c.secret).map((c) => c.id));
    const secretValues = sim.world
      .entries()
      .flatMap(([path, v]) => (v.kind === "string" && secretHeads.has(path.split(".")[0]!) ? [v.value] : []));
    const mentionsSecret = secretMentions(secretValues, [...sim.persons.values()].map((p) => p.name));
    const recent = buildRecent({
      character: thread.character,
      speaker: { kind, id, name },
      messages: all,
      storyAt,
      lastFreeReply,
      codex: (entry) => {
        const e = sim.model.codex.get(entry);
        return e === undefined ? undefined : { secret: e.secret, title: e.title, text: e.text };
      },
      peek: (path) => worldString(sim.world.peek(path)),
      persons: [...sim.persons.values()].map((p) => ({ id: p.id, name: p.name })),
      filings,
      ...(mentionsAnswer !== undefined ? { mentionsAnswer } : {}),
      mentionsSecret,
    });
    return { recent, storyAt };
  }

  /** Every `INTERACTION … who: agent`, with this run's use count. */
  private agentPowers(): AgentPower[] {
    if (this.sim === null) return [];
    return [...this.sim.model.interactions.values()]
      .filter((i) => i.who === "agent")
      .map((i) => ({ id: i.id, label: i.label, description: i.description, limit: i.limit, used: this.agentPowerUses.get(i.id) ?? 0 }));
  }

  /**
   * The whole session as one lookup document (`GET /api/agent/facts`) —
   * a worker whose character "has access to everything" reads this and
   * decides what the character may know. Mod-gated, but it is written for
   * a model, so the agent secrets stay out: ROLE `secret:` slots, `secret:
   * true` CODEX entries and characters, unrevealed hidden groups.
   */
  private agentFacts(): AgentFacts | null {
    const sim = this.sim;
    if (sim === null) return null;
    const world = sim.worldEntries();
    const varsOf = this.agentVarsOf(world);
    const globals = this.agentGlobals(world);
    const online = new Set(this.agents.onlineCharacters());
    // The booths online, as `presence()` counts them (not the whole presence:
    // that builds the facts view too).
    const primes = new Set([...this.clients].filter((c) => c.role === "prime").map((c) => c.id));
    const nameOf = (id: string) => sim.persons.get(id)?.name ?? id;
    const programs = [...sim.persons.values()].map((p) => ({
      id: p.id,
      name: p.name,
      faction: sim.publicFactionOf(p.id),
      groups: sim.groupsOf(p.id).filter((g) => !this.agentHiddenGroup(g)),
      location: sim.locationOf(p.id),
      captured: sim.isCaptured(p.id),
      vars: varsOf(p.id),
      codex: sim.codexFor(p.id).filter((e) => !e.secret).map((e) => e.title),
    }));
    return {
      at: Date.now(),
      world: globals,
      programs,
      // A `secret: true` character (the show's Kernel) is bookkeeping no
      // agent may read; a character's hidden group reads as null like a
      // guest's.
      characters: [...sim.model.characters.values()].filter((c) => !c.secret).map((c) => ({
        id: c.id,
        faction: c.faction !== null && this.agentHiddenGroup(c.faction) ? null : c.faction,
        listed: c.listed,
        mind: c.mind,
        online: c.mind === "external" ? online.has(c.id) : primes.has(c.id),
        vars: varsOf(c.id),
        codex: sim.codexFor(c.id).filter((e) => !e.secret).map((e) => e.title),
      })),
      locations: [...sim.model.locations.values()].map((l) => ({
        id: l.id,
        label: l.label ?? l.id,
        occupants: programs.filter((p) => p.location === l.id).map((p) => p.name),
      })),
      codex: [...sim.model.codex.values()].filter((e) => !e.secret).map((e) => ({
        id: e.id,
        title: e.title,
        about: e.about,
        text: e.text,
        holders: sim.codexHolders(e.id).map(nameOf),
        hasCode: e.code !== null,
      })),
      powers: this.agentPowers(),
      ...(this.phase === "paused" ? { paused: true } : {}),
    };
  }

  /**
   * Carry out a worker's requested acts for a settled request — the
   * bargains. `share` hands the thread's counterpart (or `to`) an entry the
   * character holds, exactly like a performer's booth share; `fire` uses a
   * declared `who: agent` power: the named event fires *as* the character
   * with the thread's guest as subject, so only the character's own hooks
   * hear it and the story decides what "cutting the lights" means. A power
   * over its `limit:` is refused. Anything undeclared is refused, never
   * improvised. A fire the story only answered with words (a refusal) is
   * not counted against the limit.
   */
  private applyAgentActs(req: AgentRequest, acts: AgentAct[]): AgentActResult[] {
    const sim = this.sim!;
    const who = req.thread.audience[0]!;
    const counterpart = who.startsWith("@") ? who.slice(1) : who;
    const out: AgentActResult[] = [];
    for (const act of acts) {
      if (act.kind === "share") {
        const to = act.to ?? counterpart;
        const entry = sim.model.codexIndex.get(act.entry) ?? (sim.model.codex.has(act.entry) ? act.entry : null);
        if (entry === null || !sim.holdsCodex(req.character, entry)) {
          out.push({ kind: "share", ok: false, what: act.entry, error: "the character doesn't hold that entry" });
          continue;
        }
        if (!sim.persons.has(to) && !sim.model.characters.has(to)) {
          out.push({ kind: "share", ok: false, what: entry, error: "unknown recipient" });
          continue;
        }
        if (sim.holdsCodex(to, entry)) {
          out.push({ kind: "share", ok: false, what: entry, error: "they already hold it" });
          continue;
        }
        this.fanout(this.commit("share", req.character, to, entry));
        out.push({ kind: "share", ok: true, what: entry });
      } else {
        const def = sim.model.interactions.get(act.name);
        if (def === undefined || def.who !== "agent") {
          out.push({ kind: "fire", ok: false, what: act.name, error: "no such power" });
          continue;
        }
        const used = this.agentPowerUses.get(def.id) ?? 0;
        if (def.limit !== null && used >= def.limit) {
          out.push({ kind: "fire", ok: false, what: def.id, error: "power exhausted for this run" });
          continue;
        }
        const subject = act.subject ?? (sim.persons.has(counterpart) ? counterpart : undefined);
        if (subject !== undefined && !sim.persons.has(subject)) {
          out.push({ kind: "fire", ok: false, what: def.id, error: "unknown subject" });
          continue;
        }
        const args = act.args === undefined ? null : canonicalPlaceArgs(act.args, sim.model.locations.values());
        // Journaled `by: agent:<Character>`, so a restore can count the use.
        const actingBy = this.actingBy;
        this.actingBy = `${AGENT_BY}${req.character}`;
        let events: SimEvent[];
        try {
          events = this.commit("signal", def.id, subject, args, req.character);
        } finally {
          this.actingBy = actingBy;
        }
        this.fanout(events);
        const spent = powerSpent(events);
        if (spent) this.agentPowerUses.set(def.id, used + 1);
        out.push({ kind: "fire", ok: true, what: def.id, ...(spent ? {} : { refused: true }) });
      }
    }
    return out;
  }

  /** Show / hide "<Character> is typing…" to whoever is in the thread. */
  private pushTyping(thread: AgentThread, on: boolean): void {
    const who = thread.audience[0]!;
    const data = { channel: thread.channel, from: thread.character, on };
    for (const c of this.clients) {
      if (c.role === "guest" ? c.id === who : c.role === "prime" ? `@${c.id}` === who || c.admin === true : true) {
        sseSend(c.res, "typing", { ...data, audience: thread.audience });
      }
    }
  }

  /** `GET /api/agent/stream?characters=A,B&name=laptop` — one worker. */
  private openAgentStream(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const wanted = (url.searchParams.get("characters") ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c !== "");
    const known = this.sim === null ? [] : [...this.sim.model.characters.values()].filter((c) => c.mind === "external").map((c) => c.id);
    // No list → every agent character; a name the story doesn't mark
    // `mind: external` is still accepted (the story may load later / be
    // reloaded) and reported back so the worker can warn.
    const characters = new Set(wanted.length > 0 ? wanted : known);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(":ok\n\n");
    const worker = {
      id: randomUUID(),
      name: url.searchParams.get("name") ?? "agent",
      characters,
      send: (event: string, data: unknown) => sseSend(res, event, data),
    };
    sseSend(res, "hello", {
      worker: worker.id,
      eventId: this.eventId,
      characters: [...characters],
      agents: known,
      unknown: [...characters].filter((c) => !known.includes(c)),
      // Wave 12 (C1.4): the newest thought this server holds per character
      // (the worker's own stamp), so a reconnect replays only what is newer.
      traceAfter: Object.fromEntries([...characters].map((c) => [c, this.agentTrace.list(c, 0, 1)[0]?.at ?? 0])),
    });
    this.agentStreams.add(res);
    this.agents.attach(worker);
    this.askPendingRulings();
    const ping = setInterval(() => sseWrite(res, ":ping\n\n"), 25000);
    req.on("close", () => {
      clearInterval(ping);
      this.agentStreams.delete(res);
      this.agents.detach(worker.id);
    });
  }

  /** `POST /api/agent/reply {id, say?, adjust?: {var: delta}, worker?}`. */
  private agentReply(res: ServerResponse, body: Record<string, unknown>): void {
    const settled = this.agents.settle(str(body, "id"), str(body, "worker") || undefined);
    if (settled === null) {
      sendJson(res, 410, { error: "no such open request (answered, timed out, or the run restarted)" });
      return;
    }
    const { req, followUp } = settled;
    const sim = this.sim;
    if (sim === null) {
      sendJson(res, 409, { error: "no scenario loaded" });
      return;
    }
    const text = str(body, "say").trim().slice(0, CHAT_TEXT_MAX);
    if (text !== "") {
      this.fanout(this.commit("say", req.character, req.thread.channel, text, null, req.thread.audience));
    }
    // Adjustments move only the character's own declared numeric ranges,
    // clamped to them. The story's watchers decide what the numbers mean.
    const ranges = sim.model.characters.get(req.character)?.ranges ?? new Map<string, [number, number]>();
    const applied: Record<string, number> = {};
    for (const [name, delta] of agentAdjustments(body["adjust"])) {
      const range = ranges.get(name);
      if (range === undefined) continue;
      const path = `${req.character}.${name}`;
      const current = Number(sim.worldEntries().find((w) => w.path === path)?.value ?? range[0]);
      const next = Math.max(range[0], Math.min(range[1], (Number.isFinite(current) ? current : range[0]) + delta));
      applied[name] = next;
      this.fanout(this.commit("setVar", path, String(next)));
    }
    // Doors closed (a pause): the words land, the acts don't (D10) — nothing
    // autonomous changes the house while nobody else may act, and a refused
    // act is not counted against its power's limit.
    const acts = agentActs(body["acts"]);
    const acted: AgentActResult[] =
      this.phase === "open"
        ? this.applyAgentActs(req, acts)
        : acts.map((a) => ({ kind: a.kind, ok: false, what: a.kind === "share" ? a.entry : a.name, error: "doors are closed" }));
    if (followUp) this.agents.line(req.thread);
    sendJson(res, 200, { ok: true, said: text !== "", applied, acted });
  }

  /** `POST /api/agent/mind {character, worker, brief, mood, notes, people}` —
   *  a worker mirrors its character's mind for the director consoles. */
  private agentMind(res: ServerResponse, body: Record<string, unknown>): void {
    const report = agentMindReport(body);
    if (report === null) {
      sendJson(res, 400, { error: "a mind report names its character" });
      return;
    }
    this.agentMinds.set(report.character, { ...report, at: Date.now() });
    this.pushPresence();
    sendJson(res, 200, { ok: true });
  }

  /** `POST /api/agent/trace {worker, thoughts: [Thought…]}` — a worker
   *  streams (or, on reconnect, replays) its recorded model calls. Each
   *  accepted thought is kept in the server's ring and fanned to every
   *  director console as an `agentThought` frame. */
  private agentTraceIn(res: ServerResponse, body: Record<string, unknown>): void {
    const worker = str(body, "worker") || "agent";
    const raw = Array.isArray(body["thoughts"]) ? body["thoughts"] : [body];
    let accepted = 0;
    for (const item of raw.slice(0, 200)) {
      const t = agentThought(item, worker);
      if (t === null) continue;
      const stored = this.agentTrace.add(t);
      if (stored === null) continue;
      accepted += 1;
      for (const c of this.clients) if (c.role === "mod") sseSend(c.res, "agentThought", stored);
    }
    sendJson(res, 200, { ok: true, accepted, seq: this.agentTrace.latestSeq });
  }

  // -- the reinstallation games (docs/loom-reinstall.md §2) ----------------

  /** The event's house map, loaded on first use (`docs/loom-reinstall.md`
   *  §1.3): the director's save for this event when valid, else the
   *  project snapshot's active variant, else the show's file. Null: none
   *  exists. While the event runs on the show's file, a changed file (a
   *  hand edit, a `cp` over it) replaces the map and is announced; a
   *  director's save and a project snapshot never change by themselves. */
  private spatialHouse(): HouseMap | null {
    const current = this.spatial.house;
    if (current !== null) {
      if (this.spatial.source !== "show") return current;
      const next = showHouse(this.showMapPath());
      if (next !== null && next !== current && houseVersion(next) !== this.spatial.version) {
        this.spatial.setHouse(next, "show");
        this.logHouseWarnings(next);
      }
      return this.spatial.house;
    }
    const saved = this.store.loadHouse();
    if (saved !== null) {
      const v = validateHouse(saved);
      if (v.ok && v.house !== undefined) {
        this.spatial.setHouse(v.house, "event", false);
        this.logHouseWarnings(v.house);
        return v.house;
      }
      process.stderr.write(`  ⚠️  event ${this.eventId}: saved house map is invalid — using the project's or the show's (${v.problems.join("; ")})\n`);
    }
    const base = this.baseHouse();
    if (base !== null) {
      this.spatial.setHouse(base.house, base.source, false);
      this.logHouseWarnings(base.house);
    }
    return base?.house ?? null;
  }

  /** The project's map files, when the snapshot has any. */
  private get projectMapFiles(): MapFiles | null {
    return this.projectMaps !== null && Object.keys(this.projectMaps).length > 0 ? this.projectMaps : null;
  }

  /** The map under any director's save: the project snapshot's active
   *  variant when it validates, else the show's file (its active sibling). */
  private baseHouse(): { house: HouseMap; source: "project" | "show" } | null {
    const maps = this.projectMapFiles;
    if (maps !== null) {
      const file = activeVariant(Object.keys(maps), this.mapVariant);
      if (file !== null) {
        const parsed = parseMapText(maps[file]!);
        if (parsed.house !== null) return { house: parsed.house, source: "project" };
        process.stderr.write(`  ⚠️  event ${this.eventId}: the project's ${file} is invalid — using the show's (${parsed.problems.join("; ")})\n`);
      }
    }
    const show = showHouse(this.showMapPath());
    return show === null ? null : { house: show, source: "show" };
  }

  /** The show-side file of the active variant: a chosen sibling of the show
   *  file (an event with no project map files), else the show file. */
  private showMapPath(): string {
    const v = this.mapVariant;
    if (v === null || this.projectMapFiles !== null || v === basename(this.houseFile)) return this.houseFile;
    return join(dirname(this.houseFile), v); // a variant name is checked when it is chosen
  }

  /** The variants on offer — the project snapshot's map files, else the
   *  show file and its siblings — each read and validated afresh. */
  private variantEntries(): { from: "project" | "show"; fallback: string; entries: Array<[string, ParsedMap]> } {
    const maps = this.projectMapFiles;
    if (maps !== null) return { from: "project", fallback: DEFAULT_MAP_FILE, entries: Object.entries(maps).map(([f, t]) => [f, parseMapText(t)]) };
    const files = showVariantFiles(this.houseFile);
    return { from: "show", fallback: files[0]!.file, entries: files.map((v) => [v.file, readMapFile(v.path)]) };
  }

  /** `GET /api/mod/spatial/variants`. `version` = the map the event plays
   *  now: a switch sends it back as `base`, so one confirmed off this list
   *  is refused (409) when another director switched or saved since. */
  private mapVariants(): MapVariantsResponse & { version: string } {
    this.spatialHouse();
    const { from, fallback, entries } = this.variantEntries();
    const active = activeVariant(
      entries.map(([f]) => f),
      this.mapVariant,
      fallback,
    );
    return { variants: listVariants(entries, active, fallback), from, edited: this.spatial.source === "event", project: this.project !== null, version: this.spatial.version };
  }

  /** The variant the event plays now, by file — over the same list
   *  `GET variants` shows (the project's files, else the show's). */
  private activeVariantFile(): string | null {
    const { fallback, entries } = this.variantEntries();
    return activeVariant(
      entries.map(([f]) => f),
      this.mapVariant,
      fallback,
    );
  }

  /**
   * A reload's fresh snapshot of the project's map files (`events-api.ts`,
   * `/api/mod/load {maps}`): the event plays its active variant from now on
   * (the default when that file is gone) — unless a director's save is in
   * force, which stays (it is never silently lost; "Save to project" or a
   * variant switch retires it).
   */
  setProjectMaps(maps: MapFiles): void {
    this.projectMaps = { ...maps };
    const files = Object.keys(maps);
    const was = this.mapVariant;
    if (files.length > 0) this.mapVariant = activeVariant(files, this.mapVariant);
    this.store.saveMaps(this.projectMaps, this.mapVariant);
    if (this.mapVariant !== was) this.recordVariant();
    if (this.spatial.house === null || this.spatial.source === "event") return; // loads lazily / the save stays
    const base = this.baseHouse();
    if (base === null) return;
    const changed = houseVersion(base.house) !== this.spatial.version;
    this.spatial.setHouse(base.house, base.source, changed);
    if (changed) this.logHouseWarnings(base.house);
  }

  /** Put the variant choice on the event row (`event.map_variant`), so the
   *  project's next launch starts on it. Best effort: the state dir has it
   *  either way, and a failed write only costs the relaunch the choice. */
  private recordVariant(): void {
    const project = this.project;
    if (project === null) return;
    const file = this.mapVariant;
    void project.saveVariant(file).catch((err: unknown) => {
      process.stderr.write(`  ⚠️  event ${this.eventId}: recording the map variant failed (${err instanceof Error ? err.message : String(err)})\n`);
    });
  }

  /** The active map variant as this event holds it (null = the default). */
  get activeMapVariant(): string | null {
    return this.mapVariant;
  }

  /** The project's map files as this event holds them (tests, tooling). */
  get houseMaps(): MapFiles | null {
    return this.projectMaps === null ? null : { ...this.projectMaps };
  }

  /** `base` (the map version the caller loaded) against the live map. No /
   *  null `base` = no check. False: the 409 has been sent. */
  private baseIsCurrent(base: unknown, res: ServerResponse): boolean {
    if (base === undefined || base === null) return true;
    this.spatialHouse(); // the current version (loads it on first use)
    if (base === this.spatial.version) return true;
    sendJson(res, 409, { error: "the map changed — reload", version: this.spatial.version });
    return false;
  }

  /**
   * `POST /api/mod/spatial/house/project {file?, base?}` — "Save to
   * project": the event's current map becomes a project file (default: the
   * active variant's), so the next launch and every co-writer see it. When
   * that file is the active variant, the director's save it came from is
   * retired: the event now runs on the project's copy.
   */
  private async saveMapToProject(res: ServerResponse, body: Record<string, unknown>, by: string): Promise<boolean> {
    const project = this.project;
    if (project === null) {
      sendJson(res, 409, { error: "this event has no project — download the map instead" });
      return true;
    }
    const house = this.spatialHouse();
    if (house === null) {
      sendJson(res, 503, { error: "no house map" });
      return true;
    }
    // The default is the variant playing now — a show sibling too (an event
    // with no project maps yet), so the shed is never saved as the tent.
    const file = str(body, "file").trim() || saveFileFor(this.activeVariantFile());
    if (!isMapFile(file)) {
      sendJson(res, 400, { error: "a map file is house.json or house.<variant>.json" });
      return true;
    }
    if (!this.baseIsCurrent(body["base"], res)) return true;
    const version = this.spatial.version;
    const text = mapFileText(house);
    try {
      await project.writeFile(file, text);
    } catch (err) {
      process.stderr.write(`  ⚠️  event ${this.eventId}: saving ${file} to the project failed (${err instanceof Error ? err.message : String(err)})\n`);
      sendJson(res, 502, { error: "could not write the project file" });
      return true;
    }
    const next = { ...(this.projectMaps ?? {}), [file]: text };
    this.projectMaps = next;
    // The live map *is* the saved file when it resolves as the active
    // variant (and nobody saved another map while the write was in flight).
    if (activeVariant(Object.keys(next), this.mapVariant) === file && this.spatial.version === version) {
      const was = this.mapVariant;
      this.mapVariant = file;
      this.store.clearHouse();
      this.spatial.setHouse(house, "project", false);
      if (was !== file) this.recordVariant();
    }
    this.store.saveMaps(next, this.mapVariant);
    try {
      await project.saveSnapshot(this.dataSnapshot(next));
    } catch (err) {
      process.stderr.write(`  ⚠️  event ${this.eventId}: recording the map snapshot failed (${err instanceof Error ? err.message : String(err)})\n`);
    }
    process.stdout.write(`  🗺️  event ${this.eventId}: ${by} saved the map to the project as ${file}\n`);
    sendJson(res, 200, { ok: true, file, version });
    return true;
  }

  /** Rooms naming a LOCATION the loaded story doesn't declare. */
  private houseWarnings(house: HouseMap): string[] {
    if (this.sim === null) return [];
    const names = new Set([...this.sim.model.locations.keys()].map(foldName));
    return houseWarnings(house, (name) => names.has(foldName(name)));
  }

  private logHouseWarnings(house: HouseMap): void {
    for (const w of this.houseWarnings(house)) process.stderr.write(`  ⚠️  event ${this.eventId}: house map ${w}\n`);
  }

  /** May this caller read the spatial plane (the map, the stream)? A
   *  moderator (token or author session), or a live game session. */
  private spatialReader(token: string | undefined, moderator: boolean): boolean {
    return moderator || this.sessions.canModerate(token) || this.spatial.hasToken(token);
  }

  private startSpatialLoop(): void {
    if (this.spatialLoop !== null) return;
    this.spatialLoop = setInterval(() => {
      this.spatial.flush();
      this.spatialTicks += 1;
      if (this.spatialTicks % 10 === 0) this.spatial.sweep();
      if (!this.spatial.active) this.stopSpatialLoop();
    }, 100);
    this.spatialLoop.unref?.();
  }

  private stopSpatialLoop(): void {
    if (this.spatialLoop !== null) {
      clearInterval(this.spatialLoop);
      this.spatialLoop = null;
    }
  }

  /** `GET /api/spatial/stream?name=Kitchen` — a terminal (or the map page) watching. */
  private openSpatialStream(req: IncomingMessage, res: ServerResponse, url: URL): void {
    this.spatialHouse(); // `hello` carries the map's version
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(":ok\n\n");
    const sub = { id: randomUUID(), name: (url.searchParams.get("name") ?? "viewer").slice(0, 60), send: (event: string, data: unknown) => sseSend(res, event, data) };
    this.spatialStreams.add(res);
    this.spatial.attach(sub);
    this.startSpatialLoop();
    const ping = setInterval(() => sseWrite(res, ":ping\n\n"), 25000);
    req.on("close", () => {
      clearInterval(ping);
      this.spatialStreams.delete(res);
      this.spatial.detach(sub.id);
    });
  }

  /** The spatial plane's GET routes. True when `path` matched. */
  private handleSpatialGet(req: IncomingMessage, res: ServerResponse, path: string, url: URL, moderator: boolean): boolean {
    const token = queryTokenOf(req, url);
    if (path === "/api/spatial/house" || path === "/api/spatial/stream") {
      if (!this.spatialReader(token, moderator)) {
        sendJson(res, 401, { error: "a moderator or game session token is required" });
        return true;
      }
      if (path === "/api/spatial/stream") {
        this.openSpatialStream(req, res, url);
        return true;
      }
      const house = this.spatialHouse();
      if (house === null) sendJson(res, 503, { error: "no house map" });
      else {
        // A game reading with its session token also learns its duck — a
        // map edit mid-game may have moved (or re-dealt) it.
        const duck = this.spatial.duckFor(token);
        // Every read carries the shared King (C2; null = the map has none).
        sendJson(res, 200, { house, version: this.spatial.version, source: this.spatial.source, ...(duck !== null ? { duck } : {}), king: this.spatial.king() });
      }
      return true;
    }
    if (!path.startsWith("/api/mod/spatial/")) return false;
    if (!moderator && !this.sessions.canModerate(token)) {
      sendJson(res, 403, { error: "moderators only" });
      return true;
    }
    switch (path) {
      case "/api/mod/spatial/station": {
        // A headset polls (1 s): seen now, and here is its assignment if any.
        const id = (url.searchParams.get("id") ?? "").trim().slice(0, 60);
        const world = url.searchParams.get("world") ?? "vr";
        if (id === "" || !isWorld(world)) {
          sendJson(res, 400, { error: "a station needs an id and a world (vr | web)" });
          return true;
        }
        const name = (url.searchParams.get("name") ?? "").trim().slice(0, 60);
        sendJson(res, 200, { assignment: this.spatial.station(id, name, world) });
        return true;
      }
      case "/api/mod/spatial/stations":
        sendJson(res, 200, { stations: this.spatial.stationList() });
        return true;
      case "/api/mod/spatial/variants":
        sendJson(res, 200, this.mapVariants());
        return true;
      case "/api/mod/spatial/candidates": {
        // The typed-name fallback when a pass won't scan: every guest and
        // persona, the corrupted first, then the marked (restricted: Play
        // here begins their reinstallation — C4, T3-reinstall-03).
        const sim = this.sim;
        if (sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const players = sortCandidates(
          [...sim.persons.values()].map((p) => ({
            id: p.id,
            name: p.name,
            captured: sim.isCaptured(p.id),
            restricted: sim.isRestricted(p.id),
            location: sim.locationOf(p.id),
            avatar: this.avatars.keyFor(p.name),
          })),
        );
        sendJson(res, 200, { players });
        return true;
      }
      default:
        return false;
    }
  }

  /** The game's own calls, authorized by its session token. True when `path` matched. */
  private handleSpatialPost(req: IncomingMessage, res: ServerResponse, path: string, body: Record<string, unknown>): boolean {
    const token = tokenOf(req, body);
    const refuse = (state: "unknown" | "over"): void => {
      if (state === "over") sendJson(res, 410, { error: "this session is over" });
      else sendJson(res, 401, { error: "unknown session token" });
    };
    switch (path) {
      case "/api/spatial/pose": {
        if (!this.spatial.hasToken(token)) {
          refuse(this.spatial.tokenState(token));
          return true;
        }
        const pose = parsePose(body);
        if (pose === null) {
          sendJson(res, 400, { error: "a pose is {p: [x, y, z], yaw, pitch?} with finite numbers" });
          return true;
        }
        const out = this.spatial.pose(token, pose);
        if (out !== "ok") refuse(out);
        else {
          res.writeHead(204);
          res.end();
        }
        return true;
      }
      case "/api/spatial/found": {
        if (!this.open) {
          // The rule for every participant action: nothing commits while the
          // doors are closed (paused, or before they open). The session stays
          // un-found, so the game's retry claims it after resume. A dead
          // token still hears 401/410 so the game learns its session is over.
          if (!this.spatial.hasToken(token)) refuse(this.spatial.tokenState(token));
          else sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const guest = this.spatial.sessionFor(token)?.guest ?? null;
        const out = this.spatial.found(
          token,
          (s) => this.commitFound(s),
          (s) => this.sim?.isCaptured(s.guest) ?? false,
        );
        switch (out.kind) {
          case "unknown":
          case "over":
            refuse(out.kind);
            return true;
          case "parked":
            sendJson(res, 409, { error: "this session has not started — send a pose first" });
            return true;
          case "far":
            sendJson(res, 409, { error: "not near the duck", distance: Math.round(out.distance * 100) / 100, dy: Math.round(out.dy * 100) / 100 });
            return true;
          case "found":
            // `captured`: the program is still captured after the find (the
            // banishment frees nobody), so the game never celebrates a
            // release the story didn't make (C4, T3-reinstall-01). The
            // `found` frame carries the same value (C4b). A repeat reads the
            // story now (a director may have released them since).
            sendJson(res, 200, { ok: true, released: out.released, already: out.already, captured: out.already ? guest !== null && (this.sim?.isCaptured(guest) ?? false) : out.captured });
            return true;
        }
        return true;
      }
      case "/api/spatial/king/hit": {
        // A hit on the shared King (C2): one per reinstallation visit,
        // judged on the session's last pose (the game flushes one first).
        if (!this.open || this.sim === null) {
          // Like `found`: nothing commits while the doors are closed; the
          // visit keeps its hit. A dead token still hears 401 / 410.
          if (!this.spatial.hasToken(token)) refuse(this.spatial.tokenState(token));
          else sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const out = this.spatial.hit(token, (s, next, ref) => this.commitKingHit(s, next, ref));
        switch (out.kind) {
          case "unknown":
          case "over":
            refuse(out.kind);
            return true;
          case "parked":
            sendJson(res, 409, { error: "this session has not started — send a pose first" });
            return true;
          case "none":
            sendJson(res, 404, { error: "no king" });
            return true;
          case "fallen":
            sendJson(res, 409, { error: "fallen", king: out.king });
            return true;
          case "already":
            sendJson(res, 409, { error: "already hit", king: out.king });
            return true;
          case "far":
            sendJson(res, 409, { error: "not near", reach: out.reach });
            return true;
          case "hit":
            sendJson(res, 200, { ok: true, king: out.king });
            return true;
        }
        return true;
      }
      case "/api/spatial/end": {
        const out = this.spatial.endByToken(token);
        if (out !== "ok") refuse(out);
        else sendJson(res, 200, { ok: true });
        return true;
      }
      default:
        return false;
    }
  }

  /** A hit on the King landed: journaled `by` the game's device — his new
   *  hit points into the story world (his `health` path; a King the hub
   *  counts has none), then the story's `hit` signal for the hitter with
   *  `{hp, max}`, then `fallen` once he is down. */
  private commitKingHit(s: SessionRef, next: KingState, ref: KingRef): void {
    const sim = this.sim;
    if (sim === null) return;
    this.actingBy = s.device;
    try {
      if (ref.path !== null) this.fanout(this.commit("setVar", ref.path, String(next.hp)));
      if (!sim.persons.has(s.guest)) return;
      const args = { hp: next.hp, max: next.max };
      this.fanout(this.commit("signal", kingSignal(ref.prop, "hit"), s.guest, args));
      if (next.fallen) this.fanout(this.commit("signal", kingSignal(ref.prop, "fallen"), s.guest, args));
    } finally {
      this.actingBy = undefined;
    }
  }

  /** Someone reached the duck: the story outcome, journaled `by` the game's
   *  device — `the simulation completed` (releases a corrupted program), then
   *  `the golden duck`. Released = they were captured and no longer are. */
  private commitFound(s: SessionRef): boolean {
    const sim = this.sim;
    if (sim === null || !sim.persons.has(s.guest)) return false;
    const was = sim.isCaptured(s.guest);
    this.actingBy = s.device;
    try {
      this.fanout(this.commit("signal", "the simulation completed", s.guest));
      this.fanout(this.commit("signal", "the golden duck", s.guest));
    } finally {
      this.actingBy = undefined;
    }
    return was && !(this.sim?.isCaptured(s.guest) ?? false);
  }

  // -- persistence (event-sourced journal) ---------------------------------

  /** Build the journaled op for one `/api/guest/wallet/<sub>` call after
   *  the book's own check — or the refusal the phone shows. */
  private guestWalletOp(sub: string, me: string, body: Record<string, unknown>): { op: WalletOp } | WalletRefusal {
    const book = this.wallet!;
    const at = this.sim!.elapsed();
    const id = str(body, "id");
    const amount = Number(body["amount"]);
    switch (sub) {
      case "send": {
        const to = str(body, "to");
        return book.checkSend(me, to, amount) ?? { op: { op: "send", id: book.nextId("t"), from: me, to, amount: Math.trunc(amount), at, via: "send" } };
      }
      case "request": {
        const from = str(body, "from"); // whom you ask: the payer
        return book.checkRequest(me, from, amount) ?? { op: { op: "request", id: book.nextId("r"), from: me, to: from, amount: Math.trunc(amount), at } };
      }
      case "respond": {
        const accept = body["accept"] === true;
        return book.checkRespond(id, me, accept) ?? { op: { op: "respond", id, accept, ...(accept ? { tx: book.nextId("t") } : {}), at } };
      }
      case "offer": {
        const to = str(body, "to");
        const side = str(body, "side") === "buy" ? "buy" : "sell";
        const entry = str(body, "entry");
        const bad = book.checkOffer(me, to, side, entry, amount);
        if (bad !== null) return bad;
        return { op: { op: "offer", id: book.nextId("o"), from: me, to, side, entry: book.entryIdOf(entry)!, amount: Math.trunc(amount), at } };
      }
      case "accept":
        return book.checkAccept(id, me) ?? { op: { op: "accept", id, at } };
      case "decline":
        return book.checkDecline(id, me) ?? { op: { op: "decline", id } };
      case "cancel":
        return book.checkCancel(id, me) ?? { op: { op: "cancel", id, by: me } };
      case "stimulus":
        return book.checkStimulus(me, amount) ?? { op: { op: "stimulus", id: book.nextId("s"), by: me, amount: Math.trunc(amount), at } };
      case "grant": {
        const to = str(body, "to");
        return book.checkGrant(me, to, amount) ?? { op: { op: "grant", id: book.nextId("g"), by: me, to, amount: Math.trunc(amount), at } };
      }
      case "freeze": {
        const to = str(body, "to");
        return book.checkFreeze(me, to) ?? { op: { op: "freeze", id: book.nextId("f"), by: me, target: to, until: book.freezeUntil(at), at } };
      }
      case "approve":
        if (!book.isApprover(me)) return { status: 403, error: "not the approver" };
        return book.checkApprove(id) ?? { op: { op: "approve", id, by: me } };
      case "deny":
        if (!book.isApprover(me)) return { status: 403, error: "not the approver" };
        return book.checkDeny(id) ?? { op: { op: "deny", id, by: me } };
      default:
        return { status: 404, error: "no such wallet call" };
    }
  }

  private flushTick(): void {
    if (this.pendingTickMs > 0) {
      this.store.appendCommand("tick", [this.pendingTickMs]);
      this.pendingTickMs = 0;
    }
  }

  /** Apply a sim mutation *and* journal it, so it survives a restart. Inside
   *  a mod route the journal line also carries who did it (`by`). */
  private commit(m: Exclude<Mutation, "wallet">, ...args: unknown[]): SimEvent[] {
    this.flushTick();
    this.store.appendCommand(m, args, this.actingBy);
    this.factsWatch.mark(this.sim!, factsBy(m, args, this.actingBy), factsRuling(m, args, this.actingBy));
    const out = (this.sim![m] as (...a: unknown[]) => SimEvent[])(...args);
    if (m === "signal") notePress(this.sim!, out, this.actingBy); // the cue sheet judges a press by its own events (and names who made it)
    this.spatial.syncKing(); // a `king` frame when this moved his hit points (C2)
    return out;
  }

  /** Apply one wallet op *and* journal it as a single `wallet` line — the
   *  book calls the sim (balances, codex grants, story signals) unjournaled
   *  inside, so a replay of the line lands on the same state. */
  private commitWallet(op: WalletOp): SimEvent[] {
    this.flushTick();
    this.store.appendCommand("wallet", [op], this.actingBy);
    if (this.sim !== null) this.factsWatch.mark(this.sim, this.actingBy ?? null);
    const out = this.wallet!.apply(op);
    this.spatial.syncKing();
    return out;
  }

  /** Settle / expire whatever the story clock has made due, one journal
   *  line each (so replay never depends on how ticks were coalesced). */
  private sweepWallet(): void {
    if (this.wallet === null || this.sim === null) return;
    for (const op of this.wallet.due(this.sim.elapsed())) this.fanout(this.commitWallet(op));
  }

  private persistSessions(): void {
    this.store.saveSessions(this.sessions.entries());
  }

  private persistGuests(): void {
    this.store.saveGuests([...this.guestTokens.entries()]);
  }

  /** The guest id a token authorizes, or null. */
  private guestOf(token: string | undefined): string | null {
    if (!token) return null;
    const imp = this.impersonations.get(token);
    if (imp !== undefined) return imp.role === "guest" ? imp.id : null;
    // Only the guest's own token says they are here: a director's play-as
    // pane (or a terminal piloting them) is not the phone in their hand.
    const id = this.guestTokens.get(token) ?? null;
    if (id !== null) this.seen(id);
    return id;
  }

  /** The character a token performs as — a performer session, or an
   *  operator playing that character's booth. */
  private characterOf(token: string | undefined): string | null {
    const imp = token ? this.impersonations.get(token) : undefined;
    if (imp !== undefined) return imp.role === "prime" ? imp.id : null;
    return this.sessions.characterOf(token);
  }

  /** May this token scan / act as a performer? (never a moderator when it
   *  is an operator play-as session — the booth sees exactly a booth) */
  private canScan(token: string | undefined): boolean {
    const imp = token ? this.impersonations.get(token) : undefined;
    if (imp !== undefined) return imp.role === "prime";
    return this.sessions.canScan(token);
  }

  /** Drop play-as sessions (all, or one role) and close their streams. */
  private endImpersonations(pred: (imp: Impersonation, token: string) => boolean): void {
    for (const [token, imp] of [...this.impersonations]) {
      if (!pred(imp, token)) continue;
      this.impersonations.delete(token);
      for (const c of [...this.clients]) {
        if (c.token !== token) continue;
        this.clients.delete(c);
        try {
          c.res.end();
        } catch {
          /* client already gone */
        }
      }
    }
  }

  /**
   * Resolve + authorize the acting guest for a guest POST route. The id is
   * derived from the caller's token — never from the request body — so no
   * guest can act as another. Sends the error response itself on failure.
   */
  private requireGuest(req: IncomingMessage, body: Record<string, unknown>, res: ServerResponse): string | null {
    const id = this.guestOf(tokenOf(req, body));
    if (id === null) {
      sendJson(res, 401, { error: "not signed in — register first" });
      return null;
    }
    return id;
  }

  /** Count a failed passcode attempt; true when this IP is over the limit.
   *  `publicCode` (the caller sent the right guest event code) always passes:
   *  that code is printed on the door poster, so a lockout protects nothing
   *  and would only refuse every phone behind the house's one IP (D9). The
   *  performer + mod codes stay locked out, so a guesser gets no oracle. */
  private throttled(req: IncomingMessage, res: ServerResponse, publicCode = false): boolean {
    if (publicCode || this.loginFailures.allowed(ipOf(req))) return false;
    sendJson(res, 429, { error: "too many attempts — wait a few minutes" });
    return true;
  }

  private resetChat(): void {
    this.chat.clear();
    this.store.clearHidden();
    this.decisionChannels.clear();
  }

  private persistMeta(): void {
    this.store.saveMeta({
      version: 1,
      scenarioName: this.scenarioName,
      scenarioSource: this.scenarioSource,
      phase: this.phase,
      opened: this.entryPlayed,
      owners: [...this.personaOwners.entries()],
    });
  }

  private loadScenario(source: string, name: string): void {
    this.sim = Sim.fromSources(source);
    const currency = this.sim.model.currency;
    this.wallet = currency !== null ? new WalletBook(currency, walletSeam(this.sim, currency)) : null;
    this.scenarioSource = source;
    this.scenarioName = name;
    this.setPhase("paused");
    this.seedAvatars();
    this.spatial.syncKing(); // a fresh world: a standing King (or the hub's own count)
  }

  // -- profile pictures ----------------------------------------------------

  /** Hand-picked `avatar:` pictures go straight into the book (unless a
   *  guest has since chosen another for that program); every other
   *  playable character (a performer's part, a guest's program) gets one
   *  looked up in the program directory, in the background. Every
   *  picture is then fetched once, ahead of the doors, so the night never
   *  waits on (or depends on) Wikipedia. */
  private seedAvatars(): void {
    if (this.sim === null) return;
    const lookups: string[] = [];
    for (const d of identityDefs(this.sim.model)) {
      const [first] = d.avatars;
      if (first !== undefined) {
        const url = avatarRefUrl(first);
        if (!this.avatars.isChosen(d.name) && this.avatars.keyFor(d.name) !== avatarKey(url)) this.avatars.assign(d.name, url);
      } else if (guestPickable(d) || performerPickable(d)) {
        lookups.push(d.name);
      }
    }
    this.persistAvatars();
    this.prefetchAvatars();
    this.lookupAvatars(lookups);
  }

  /** Warm the picture cache (and its disk copy) with every picture in the book. */
  private prefetchAvatars(): void {
    for (const key of Object.values(this.avatars.keys())) {
      const url = this.avatars.urlFor(key);
      if (url !== null && !this.images.onDisk(url)) void this.images.get(url);
    }
  }

  /** Find pictures for names that have none yet (fire-and-forget; each
   *  arrival re-sends snapshots so tiles fill in as they land). */
  private lookupAvatars(names: string[]): void {
    if (this.wiki === null) return;
    for (const name of names) {
      if (this.avatars.has(name) || this.avatarLookups.has(name)) continue;
      this.avatarLookups.add(name);
      const def = this.sim === null ? undefined : identityDefs(this.sim.model).find((d) => foldName(d.name) === foldName(name));
      void this.wiki.avatarFor(def?.wiki ?? name).then((url) => {
        this.avatarLookups.delete(name);
        if (url === null || this.avatars.has(name)) return;
        this.avatars.assign(name, url);
        void this.images.get(url);
        this.persistAvatars();
        this.pushSnapshots();
        this.refreshGhosts(name);
      });
    }
  }

  /** A picture for `name` changed: every live reinstallation session of a
   *  person by that name hears it (an `avatar` frame, C3). */
  private refreshGhosts(name: string): void {
    if (this.sim === null) return;
    const folded = foldName(name);
    for (const p of this.sim.persons.values()) if (foldName(p.name) === folded) this.spatial.refreshAvatar(p.id);
  }

  /**
   * The pictures a guest may choose between for a program, best first:
   * the story's hand-picked ones (`avatar: a | b`), then the directory's
   * gallery for the article (`wiki:` or the name) — logos and box art
   * ahead of screenshots. Each is made servable (`offer`) so the picker
   * can show it; `name` is what the guest would register as (the
   * article's title for a directory pick). Null: no such program.
   */
  private async pictureOptions(name: string, wiki?: string): Promise<{ name: string; options: PictureChoice[] } | null> {
    const urls: Array<{ url: string; file: string }> = [];
    let title = name;
    if (wiki !== undefined) {
      const hit = this.wiki === null ? null : await this.wiki.lookup(wiki);
      if (hit === null) return null;
      title = hit.title;
    }
    const def = this.sim === null ? undefined : identityDefs(this.sim.model).find((d) => foldName(d.name) === foldName(title));
    for (const ref of def?.avatars ?? []) urls.push({ url: avatarRefUrl(ref), file: /^File:/iu.test(ref) ? ref : "" });
    if (this.wiki !== null) {
      for (const p of await this.wiki.pictures(wiki ?? def?.wiki ?? name, 8)) urls.push({ url: p.url, file: p.file });
    }
    // The picture they have now stays on offer (a guest changing theirs).
    const current = this.avatars.keyFor(title);
    const currentUrl = current === null ? null : this.avatars.urlFor(current);
    if (currentUrl !== null) urls.push({ url: currentUrl, file: "" });
    const seenUrl = new Set<string>();
    const seenFile = new Set<string>();
    const options: PictureChoice[] = [];
    for (const u of urls) {
      const file = u.file.replace(/^File:/iu, "").replace(/_/gu, " ").toLowerCase();
      if (seenUrl.has(u.url) || (file !== "" && seenFile.has(file))) continue;
      seenUrl.add(u.url);
      if (file !== "") seenFile.add(file);
      options.push({ key: this.avatars.offer(u.url), file: u.file.replace(/^File:/iu, "") });
      if (options.length >= 9) break;
    }
    return { name: title, options };
  }

  private persistAvatars(): void {
    this.store.saveAvatars(this.avatars.entries());
  }

  /** Every profile picture, by folded display name → serving key. */
  private avatarMap(): Record<string, string> {
    return this.avatars.keys();
  }

  /** The names on a join screen's picker: the story's pool of programs
   *  for a guest, its parts for a performer — each with its picture,
   *  whether someone already holds it, and whether it is a reserved program
   *  locked for this caller (`claim`: the invitation's token, if any). */
  identities(role: "guest" | "prime", claim?: string | null): IdentityRow[] {
    if (this.sim === null) return [];
    const defs = identityDefs(this.sim.model);
    if (role === "guest") {
      const taken = takenNames(this.sim.persons.values());
      return defs.filter(guestPickable).map((d) => ({
        name: d.name,
        faction: d.faction,
        avatar: this.avatars.keyFor(d.name),
        claimed: taken.has(foldName(d.name)),
        reserved: d.reserved && !this.claims.mayClaim(d.name, claim),
      }));
    }
    const held = heldCharacters(this.sessions.entries());
    return defs
      .filter(performerPickable)
      .map((d) => ({ name: d.name, faction: d.faction, avatar: this.avatars.keyFor(d.name), claimed: held.has(foldName(d.name)), reserved: false }));
  }

  /** Is `name` a reserved program locked for a caller holding `claim`? */
  private reservedFor(name: string, claim: string | null): boolean {
    if (this.sim === null) return false;
    const def = reservedDefFor(this.sim.model, name);
    return def !== null && !this.claims.mayClaim(def.name, claim);
  }

  // -- autonomous clock ----------------------------------------------------

  private startTicker(): void {
    if (this.ticker !== null) return;
    this.ticker = setInterval(() => this.tickOnce(1000), 1000);
  }

  /** The ticker's body: advance the story clock by `ms` while the doors are
   *  open, route what fired, then sweep the ephemeral rooms, the wallet's
   *  due timers and the agent hub. Public so tests drive the clock. */
  tickOnce(ms = 1000): void {
    if (this.sim === null || this.phase !== "open") return;
    this.factsWatch.mark(this.sim, null);
    const evs = this.sim.tick(ms);
    this.pendingTickMs += ms;
    if (evs.length > 0) {
      this.flushTick();
      this.fanout(evs);
      this.spatial.syncKing(); // a story timer is a committed mutation too (journaled as the tick)
    } else if (this.pendingTickMs >= 15000) {
      this.flushTick();
    }
    this.sweepEphemeral();
    this.sweepWallet();
    this.agents.sweep();
    this.askPendingRulings();
  }

  private stopTicker(): void {
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  /**
   * Open the doors: load the scenario on first open, start the clock, and
   * let guests register. The control-plane equivalent of `/api/mod/start`.
   */
  openDoors(): void {
    if (this.sim === null) this.freshRun(this.scenarioSource, this.scenarioName);
    if (this.pausedAt !== null) {
      this.agents.shift(this.pausedAt, this.clock());
      this.pausedAt = null;
    }
    this.setPhase("open");
    this.startTicker();
    // A live event opens exactly like a rehearsal: the `entry:` beat plays
    // on the run's first open — also after a restart or a restore that left
    // the doors closed. Journaled as a fireBeat so a replay reproduces it.
    if (!this.entryPlayed) {
      this.entryPlayed = true;
      const entry = this.sim?.model.entry;
      if (entry != null && entry !== "") this.fanout(this.commit("fireBeat", entry));
    }
    // After the entry: the meta says the doors opened (`opened`), so a
    // restore of a story with no `start:` paused before its first tick
    // still knows it.
    this.persistMeta();
    this.pushSnapshots();
  }

  /** A new run on `source`: a fresh sim, an empty journal + chat, and the
   *  entry beat still to play (the next `openDoors` plays it). */
  private freshRun(source: string, name: string): void {
    this.loadScenario(source, name);
    this.store.clearJournal();
    this.store.clearRuns();
    this.resetChat();
    this.pendingTickMs = 0;
    this.entryPlayed = false;
  }

  /** Pause the event: stop the clock, keep all state. `/api/mod/stop`. */
  pause(): void {
    this.flushTick();
    if (this.phase === "open") this.pausedAt = this.clock();
    this.setPhase("paused");
    this.stopTicker();
    this.persistMeta();
    this.pushSnapshots();
  }

  /**
   * Start the story over — optionally on new source (the editor's "push
   * current draft into the running event"). Clears the journal + chat,
   * replays nothing, and re-opens the doors if they were open (so the
   * `entry:` beat fires again). Every connected client gets a fresh
   * `history` + a `lifecycle` notice so no console keeps a dead feed.
   */
  restart(
    source: string = this.scenarioSource,
    name: string = this.scenarioName,
    opts: { kind?: LifecycleKind; by?: string } = {},
  ): void {
    const kind: LifecycleKind = opts.kind ?? (source === this.scenarioSource ? "reset" : "reload");
    const wasOpen = this.phase === "open";
    // Announce first, so a console drops its old ledger/overlay *before*
    // the replayed entry beat streams in.
    this.pushLifecycle(kind, { phase: wasOpen ? "open" : "paused", ...(opts.by !== undefined ? { by: opts.by } : {}) });
    // Every restart is a real cut for participants: the persons they were
    // die with the journal, so their capability tokens die too (a guest
    // re-registers into the fresh story instead of streaming as a ghost).
    // Going live additionally signs every performer out of their character
    // — rehearsal booths must not carry into the show.
    this.guestTokens.clear();
    this.persistGuests();
    this.pairing.clear();
    this.personaOwners.clear();
    // Operator play-as sessions follow the sessions they stand in for: a
    // guest's dies with every restart, a booth's only when the show goes live.
    this.endImpersonations((imp) => imp.role === "guest" || kind === "golive");
    this.endClients("guest");
    // Push follows the sessions: every guest's device unbinds (the phone
    // re-subscribes when it re-joins), a booth's only when the show goes live.
    this.push.drop((owner) => owner.startsWith("guest:") || (kind === "golive" && owner.startsWith("prime:")));
    if (kind === "golive") {
      // A host part's session goes with its part (never a headless admin).
      for (const [token, session] of this.sessions.entries()) {
        if (session.character === null) continue;
        this.sessions.dropCharacter(token);
      }
      this.persistSessions();
      this.endClients("prime");
    }
    this.stopTicker();
    this.agents.reset(opts.by ?? "server", kind);
    this.rulingsAsked.clear();
    this.rulingsDue.clear();
    this.spatial.reset(kind);
    this.agentPowerUses.clear();
    this.agentMinds.clear();
    this.sim = null;
    this.scenarioSource = source;
    this.scenarioName = name;
    if (wasOpen) {
      this.openDoors(); // fresh → loads, clears journal + chat, fires entry
    } else {
      // Doors closed: the entry waits for the next open (`entryPlayed`).
      this.freshRun(source, name);
      this.persistMeta();
      this.pushSnapshots();
    }
    // A restart is a timeline cut: a director's fresh view must land before
    // the new history, never coalesced to after it (a phone's too).
    this.flushClientSnapshotsNow();
    this.flushModSnapshotsNow();
    this.pushHistory();
  }

  /** The source the running event was built from (the launch/reload snapshot). */
  get source(): string {
    return this.scenarioSource;
  }

  /** Journal the story time the idle ticks haven't written yet (they
   *  coalesce up to 15 s), so a restore's clock matches the live one. Flush
   *  only: the server's SIGTERM / SIGINT handler calls it (a restart is not
   *  an ending), and `dispose` does too. Idempotent. */
  flushClock(): void {
    try {
      this.flushTick();
    } catch {
      /* the state dir is gone */
    }
  }

  /** Tear the runtime down (stop the clock, drop SSE clients). */
  dispose(by?: string): void {
    this.flushClock();
    this.stopTicker();
    if (this.modSnapshotTimer !== null) clearTimeout(this.modSnapshotTimer);
    this.modSnapshotTimer = null;
    if (this.modOwedTimer !== null) clearTimeout(this.modOwedTimer);
    this.modOwedTimer = null;
    if (this.snapshotTimer !== null) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = null;
    this.pushLifecycle("ended", by !== undefined ? { by } : {});
    for (const c of this.clients) {
      try {
        c.res.end();
      } catch {
        /* client already gone */
      }
    }
    this.clients.clear();
    for (const w of [...this.agentStreams]) {
      try {
        w.end();
      } catch {
        /* worker already gone */
      }
    }
    this.agentStreams.clear();
    this.stopSpatialLoop();
    this.spatial.detachAll();
    for (const s of [...this.spatialStreams]) {
      try {
        s.end();
      } catch {
        /* viewer already gone */
      }
    }
    this.spatialStreams.clear();
  }

  // -- restart recovery ----------------------------------------------------

  /**
   * Rebuild live state from disk by replaying the journal into a fresh sim.
   * Returns `null` when this event has no persisted state yet.
   */
  restore(): Restored | null {
    const meta = this.store.loadMeta();
    if (meta === null) return null;
    this.avatars.load(this.store.loadAvatars());
    this.loadScenario(meta.scenarioSource, meta.scenarioName); // sets phase → paused
    let events = 0;
    const entry = this.sim?.model.entry ?? null;
    // The entry played when the journal holds its fireBeat. A journal with
    // a tick (the clock only runs with the doors open) or a run persisted
    // open counts too: a pre-fix run whose entry was lost must not have it
    // fire mid-show on the next resume. So does the meta's own `opened`: a
    // story with no `start:` paused before its first tick journals neither.
    this.entryPlayed = meta.phase === "open" || meta.opened === true;
    for (const e of this.store.readJournal()) {
      if (e.m === "tick" || (e.m === "fireBeat" && entry !== null && e.a[0] === entry)) this.entryPlayed = true;
      if (e.m === "wallet") {
        // A wallet op: the book re-applies it (balances, grants, signals,
        // cards) exactly as it did live.
        if (this.wallet !== null) {
          try {
            this.factsWatch.mark(this.sim!, e.by ?? null);
            const batch = this.wallet.apply(e.a[0] as WalletOp);
            events++;
            this.chat.append(composeGuestMessages(this.sim!, batch));
          } catch {
            /* tolerate a torn line */
          }
        }
        continue;
      }
      const fn = (this.sim as unknown as Record<string, unknown>)[e.m];
      if (typeof fn === "function") {
        try {
          this.factsWatch.mark(this.sim!, factsBy(e.m, e.a, e.by), factsRuling(e.m, e.a, e.by));
          const out = (fn as (...a: unknown[]) => unknown).apply(this.sim, e.a);
          events++;
          if (e.m === "signal" && Array.isArray(out)) notePress(this.sim!, out as SimEvent[], e.by); // as `commit` did live
          if (e.m === "signal") {
            // A widget answer — `signal(<kind> answered, guest, {…, card: seq})`.
            const card = (e.a[2] as { card?: unknown } | null | undefined)?.card;
            if (typeof e.a[1] === "string" && typeof card === "number") this.answeredWidgets.add(`${card}:${e.a[1]}`);
            // An agent's own use of a power counts against its `limit:` again.
            if (e.by === `${AGENT_BY}${String(e.a[3])}` && Array.isArray(out) && powerSpent(out as SimEvent[])) {
              const def = this.sim!.model.interactions.get(String(e.a[0]));
              if (def !== undefined && def.who === "agent") this.agentPowerUses.set(def.id, (this.agentPowerUses.get(def.id) ?? 0) + 1);
            }
          }
          if (Array.isArray(out)) {
            const batch = out as SimEvent[];
            for (const ev of batch) {
              if (ev.type === "choicePrompted" && ev.person !== null) {
                this.decisionChannels.set(ev.person, decisionChannelFor(batch, ev.person));
              }
            }
            const drafts = composeGuestMessages(this.sim!, batch);
            // A director's speech *as* a participant keeps its attribution
            // across a restart — the same rule `fanout` applies live.
            if (e.m === "say" && e.by !== undefined && this.sim!.persons.has(String(e.a[0]))) {
              for (const d of drafts) if (d.kind === "line") d.via = e.by;
            }
            this.chat.append(drafts);
          }
        } catch {
          /* tolerate a single bad/torn entry rather than abort recovery */
        }
      }
    }
    this.chat.loadHidden(this.store.loadHidden());
    this.spatial.restoreRuns(this.store.loadRuns().map(parseDuckRun).filter((r): r is DuckRun => r !== null));
    for (const m of this.chat.all()) if (this.isExpired(m)) this.notifiedExpired.add(m.seq);
    for (const id of [...this.decisionChannels.keys()]) {
      if (this.sim?.pendingChoiceFor(id) == null) this.decisionChannels.delete(id);
    }
    this.setPhase(meta.phase);
    for (const [id, owner] of meta.owners ?? []) this.personaOwners.set(id, owner);
    const entries = this.store.loadSessions();
    this.sessions.load(entries);
    for (const [token, id] of this.store.loadGuests()) this.guestTokens.set(token, id);
    this.requeueAgentThreads();
    this.noteRulingsDue();
    this.spatial.syncKing(); // the replayed world's King
    if (this.phase === "open") this.startTicker();
    // Restored with the doors paused: the re-asked requests wait out the
    // pause like live ones do.
    else if (this.phase === "paused") this.pausedAt = this.clock();
    return { guests: this.sim?.persons.size ?? 0, events, sessions: entries.length };
  }

  // -- request handling ----------------------------------------------------

  /**
   * Handle one event-scoped request. `path` is already relative to this
   * event (the `/e/:eventId` prefix, if any, has been stripped by the
   * router). `opts.moderator` is set by the router when the caller is the
   * owning author (a BetterAuth session), granting mod access without a code.
   * Returns true when the request matched an event route.
   */
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    path: string,
    url: URL,
    opts: { moderator?: boolean; moderatorName?: string } = {},
  ): Promise<boolean> {
    // --- the host allowlist (wave 13, §2.7): a booth holding only the host
    // capability reaches the moderator surface on the listed routes alone ---
    if (method === "GET" && opts.moderator !== true) {
      const query = Object.fromEntries(url.searchParams);
      if (this.hostOnly(queryTokenOf(req, url)) && isModSurface(method, path, query) && !isHostRoute(method, path, query, this.hostRouteContext())) {
        sendJson(res, 403, { error: NOT_FROM_A_BOOTH });
        return true;
      }
    }
    // --- SSE stream ---
    // Every projection is capability-gated: the mod feed (full god view,
    // every DM, hidden factions) needs the mod capability or the owning
    // author's session; the prime feed needs a performer token (the id it
    // streams for is the token's character, never a query param); a guest
    // streams only their own view, resolved from their registration token
    // (EventSource can't set headers, so the token rides `?token=`).
    if (method === "GET" && path === "/events") {
      const role = (url.searchParams.get("role") as Client["role"] | null) ?? "mod";
      const token = queryTokenOf(req, url);
      let id = "";
      if (role === "mod") {
        if (opts.moderator !== true && !this.sessions.canModerate(token)) {
          sendJson(res, 403, { error: "moderators only" });
          return true;
        }
      } else if (role === "prime") {
        const character = this.characterOf(token);
        if (character === null) {
          sendJson(res, 403, { error: "no character — sign in" });
          return true;
        }
        id = character;
      } else {
        const gid = this.guestOf(token);
        if (gid === null) {
          sendJson(res, 401, { error: "not signed in — register first" });
          return true;
        }
        id = gid;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(":ok\n\n");
      const client: Client = { role, id, res };
      if (role === "mod") client.name = opts.moderatorName ?? "Director";
      // A director's console carries every frame: a bigger queue before a stall drops it.
      if (role === "mod") sseCap(res, SSE_MOD_QUEUE_CAP);
      // `?lean=1` (mod feed only): the house tools' stream — frames, no views.
      if (role === "mod" && url.searchParams.get("lean") === "1") client.lean = true;
      // `?delta=1` (a full console only): a keyframe, then keyed patches (C7).
      else if (role === "mod" && url.searchParams.get("delta") === "1") client.delta = true;
      if (role === "prime") {
        client.admin = this.sessions.canModerate(token);
        client.host = this.sessions.canHost(token);
      }
      const imp = token ? this.impersonations.get(token) : undefined;
      if (imp !== undefined) {
        client.via = imp.by;
        client.token = token;
        client.admin = false;
        client.host = false;
      }
      this.clients.add(client);
      // The guest's own phone opened its stream: they are here (W-04).
      const ownGuest = role === "guest" && imp === undefined;
      if (ownGuest) this.seen(id, true);
      const fullMod = role === "mod" && client.lean !== true;
      if (fullMod) {
        // One `ModView` frame to every full director — the newcomer's first
        // view *and* everyone's presence update, serialised once (so the
        // newcomer never gets two ≈200 KB snapshots back to back).
        if (this.modSnapshotTimer !== null) clearTimeout(this.modSnapshotTimer);
        this.modSnapshotTimer = null;
        this.flushModSnapshots();
      } else if (client.lean !== true) {
        sseSend(res, "snapshot", this.snapshotFor(client));
      }
      if (client.lean !== true) {
        // A moderator sees the full feed *including* hidden messages (greyed in
        // the UI) so they can un-hide; performers see the public feed only.
        sseSend(res, "history", this.historyFor(client));
      }
      if (!fullMod) this.pushPresence();
      const ping = setInterval(() => sseWrite(res, ":ping\n\n"), 25000);
      req.on("close", () => {
        clearInterval(ping);
        this.clients.delete(client);
        if (ownGuest) this.seen(id, true);
        this.pushPresence();
      });
      return true;
    }

    // --- is there a server voice? (a terminal picks its speech engine) ---
    if (method === "GET" && path === "/api/mod/tts") {
      if (opts.moderator !== true && !this.sessions.canModerate(queryTokenOf(req, url))) {
        sendJson(res, 403, { error: "moderators only" });
        return true;
      }
      sendJson(res, 200, this.tts.describe());
      return true;
    }

    // --- K-26: the ceremony's recap numbers (directors only) ---
    if (method === "GET" && path === "/api/mod/recap") {
      if (opts.moderator !== true && !this.sessions.canHost(queryTokenOf(req, url))) sendJson(res, 403, { error: "moderators only" });
      else sendRecap(res, url, this.sim, { title: this.title, personas: this.personaOwners, duckRuns: this.spatial.runs() });
      return true;
    }
    // --- process load for the K-32 load test (directors only) ---
    if (handleMetrics(req, res, method, path, url, () => opts.moderator === true || this.sessions.canModerate(queryTokenOf(req, url)), () => this.clients.size)) return true;
    // --- T7-03: the whole ledger, paged, for Run → Log's export (directors only) ---
    if (handleModLog(req, res, method, path, url, () => opts.moderator === true || this.sessions.canModerate(queryTokenOf(req, url)), () => this.sim?.log.all() ?? [])) return true;

    // --- the mind debugger's trace (directors only) ---
    if (method === "GET" && path === "/api/mod/agent/trace") {
      if (opts.moderator !== true && !this.sessions.canModerate(queryTokenOf(req, url))) {
        sendJson(res, 403, { error: "moderators only" });
        return true;
      }
      const character = url.searchParams.get("character");
      const after = Number(url.searchParams.get("after") ?? 0);
      const limit = Math.max(1, Math.min(400, Number(url.searchParams.get("limit") ?? 200)));
      const id = url.searchParams.get("id");
      if (id !== null) {
        const one = this.agentTrace.get(id);
        if (one === null) sendJson(res, 404, { error: "no such thought" });
        else sendJson(res, 200, { thought: one });
        return true;
      }
      sendJson(res, 200, {
        thoughts: this.agentTrace.list(character === null || character === "" ? null : character, Number.isFinite(after) ? after : 0, limit),
        seq: this.agentTrace.latestSeq,
        characters: this.agentTrace.characters(),
        minds: [...this.agentMinds.values()],
      });
      return true;
    }

    // --- a profile picture, served same-origin (the app's CSP is img-src 'self') ---
    // Keys are opaque hashes of URLs *the server* chose (a Wikipedia lead
    // image, an authored `avatar:` link); anything else is a 404, so this
    // is never an open proxy. Public: a picker shows pictures before sign-in.
    if (method === "GET" && path.startsWith("/api/avatar/")) {
      const key = path.slice("/api/avatar/".length);
      const target = /^[0-9a-f]{16}$/u.test(key) ? this.avatars.urlFor(key) : null;
      const img = target === null ? null : await this.images.get(target);
      if (img === null) {
        sendJson(res, 404, { error: "no such picture" });
        return true;
      }
      res.writeHead(200, {
        "content-type": img.contentType,
        "content-length": String(img.bytes.byteLength),
        "cache-control": "public, max-age=86400",
      });
      res.end(img.bytes);
      return true;
    }

    // --- read-only state snapshot (same capability gates as the stream) ---
    if (method === "GET" && path === "/api/state") {
      const role = url.searchParams.get("role") ?? "mod";
      const token = queryTokenOf(req, url);
      // A moderator may read any participant's projection verbatim
      // (`?as=<guest id>` / `?as=<character>`) — the editor's identity lens:
      // what the runner sees while "being" someone is exactly the play app's
      // own `GuestView` / `PrimeView`, not a filtered god view.
      const as = url.searchParams.get("as");
      if (as !== null && role !== "mod") {
        if (opts.moderator !== true && !this.sessions.canModerate(token)) {
          sendJson(res, 403, { error: "moderators only" });
          return true;
        }
        if (role === "guest") {
          if (!this.reqSim().persons.has(as)) {
            sendJson(res, 404, { error: "unknown guest" });
            return true;
          }
          sendJson(res, 200, this.guestViewFor(as, new Set(this.agents.onlineCharacters())));
          return true;
        }
        if (role === "prime") {
          if (!this.reqSim().model.characters.has(as)) {
            sendJson(res, 404, { error: "unknown character" });
            return true;
          }
          // A host part (`admin: true`) is a host booth, as its live
          // stream's snapshot is (`snapshotFor`): the lens shows exactly
          // the objective buttons that phone shows.
          const host = this.reqSim().model.characters.get(as)?.admin === true;
          sendJson(res, 200, this.primeViewFor(as, new Set(this.agents.onlineCharacters()), undefined, host));
          return true;
        }
      }
      if (role === "guest") {
        const gid = this.guestOf(token);
        if (gid === null) {
          sendJson(res, 401, { error: "not signed in — register first" });
          return true;
        }
        sendJson(res, 200, this.guestViewFor(gid, new Set(this.agents.onlineCharacters())));
        return true;
      }
      if (role === "prime") {
        const character = this.characterOf(token);
        if (character === null) {
          sendJson(res, 403, { error: "no character — sign in" });
          return true;
        }
        sendJson(res, 200, this.primeViewFor(character, new Set(this.agents.onlineCharacters()), undefined, this.sessions.canHost(token)));
        return true;
      }
      // `?host=1` (wave 13): a host booth's panel — the cue sheet, needs,
      // judging, wallet holds, parts, people and Trabolta's waiting guests.
      if (url.searchParams.get("host") === "1") {
        if (opts.moderator !== true && !this.sessions.canHost(token)) {
          sendJson(res, 403, { error: "moderators only" });
          return true;
        }
        res.setHeader("cache-control", "no-store");
        sendJson(res, 200, this.hostViewNow());
        return true;
      }
      if (opts.moderator !== true && !this.sessions.canModerate(token)) {
        sendJson(res, 403, { error: "moderators only" });
        return true;
      }
      // `?cues=1` (W-26): the director phone's lean read — just the cue sheet.
      if (url.searchParams.get("cues") === "1") {
        sendJson(res, 200, cueSheetView(this.modViewNow()));
        return true;
      }
      sendJson(res, 200, this.modViewNow());
      return true;
    }

    // --- a participant's full thread history ---
    // A moderator may read any participant's threads (`?id=`, hidden
    // included); a guest reads their own — the id comes from their token,
    // so no `?id=` probing can reach another guest's DMs.
    if (method === "GET" && path === "/api/history") {
      const token = queryTokenOf(req, url);
      const admin = opts.moderator === true || this.sessions.canModerate(token);
      let id: string;
      if (admin) {
        id = url.searchParams.get("id") ?? "";
      } else {
        const gid = this.guestOf(token);
        if (gid === null) {
          sendJson(res, 401, { error: "not signed in — register first" });
          return true;
        }
        id = gid;
      }
      const messages = this.chat.historyFor(id, admin).filter((m) => !this.isExpired(m));
      sendJson(res, 200, { messages: admin ? messages : messages.map(forGuest) });
      return true;
    }

    // --- agent workers (stagehand's agents module) ---
    // A worker voices `mind: external` characters: it holds this stream,
    // receives `request`s, and answers with `POST /api/agent/reply`. Same
    // capability as the mod feed — a worker can do nothing a mod can't.
    if (method === "GET" && path === "/api/agent/stream") {
      if (opts.moderator !== true && !this.sessions.canModerate(queryTokenOf(req, url))) {
        sendJson(res, 403, { error: "moderators only" });
        return true;
      }
      this.openAgentStream(req, res, url);
      return true;
    }
    if (method === "GET" && path === "/api/agent/facts") {
      if (opts.moderator !== true && !this.sessions.canModerate(queryTokenOf(req, url))) {
        sendJson(res, 403, { error: "moderators only" });
        return true;
      }
      const facts = this.agentFacts();
      if (facts === null) sendJson(res, 409, { error: "no scenario loaded" });
      else sendJson(res, 200, facts);
      return true;
    }

    // --- the wall terminals' lean screen state (K-16, routes/screen.ts) ---
    if (method === "GET" && path === "/api/screen/state") {
      return handleScreenGet(
        this.screens,
        this.sim,
        req,
        res,
        url,
        (t) => opts.moderator === true || this.sessions.canModerate(t),
        (c) => this.agents.isOnline(c),
        () => this.chat.all(),
        () => this.declaredModel,
        // The shared King for the chess terminal (C2).
        () => {
          this.spatialHouse();
          return screenKingOf(this.spatial.king(), this.spatial.kingRef()?.prop.armed, this.sim);
        },
      );
    }
    if (method === "GET" && path === "/api/mod/screen/terminals") return handleScreenTerminalsGet(this.screens, req, res, url, (t) => opts.moderator === true || this.sessions.canModerate(t));
    // A host booth may mute the TV and identify a terminal (§2.7).
    if (method === "POST" && path === "/api/mod/screen/voice") return handleScreenVoicePost(this.screens, req, res, (t) => opts.moderator === true || this.sessions.canHost(t));
    if (method === "POST" && path === "/api/mod/screen/identify") return handleScreenIdentifyPost(this.screens, req, res, (t) => opts.moderator === true || this.sessions.canHost(t));

    // --- the reinstallation games: the map, the stream, stations ---
    if (method === "GET" && (path.startsWith("/api/spatial/") || path.startsWith("/api/mod/spatial/"))) {
      if (this.handleSpatialGet(req, res, path, url, opts.moderator === true)) return true;
    }

    // --- K-31a push config (public) ---
    if (this.pushRoutes.handleGet(method, path, res)) return true;

    if (method !== "POST") return false;

    // --- a game's own calls (pose at 10 Hz, found, end): tiny bodies, read
    // under their own cap before the generic parse ---
    if (path.startsWith("/api/spatial/")) {
      return this.handleSpatialPost(req, res, path, await readBody(req, SPATIAL_BODY_LIMIT));
    }

    const body = await readBody(req);

    // The host allowlist for POSTs (the same rule as the GETs above).
    if (opts.moderator !== true && this.hostOnly(tokenOf(req, body)) && isModSurface(method, path, body) && !isHostRoute(method, path, body, this.hostRouteContext())) {
      sendJson(res, 403, { error: NOT_FROM_A_BOOTH });
      return true;
    }

    if (this.pushRoutes.handlePost(req, res, path, body)) return true;
    if (path === RESUME_ROUTE) {
      if (this.throttled(req, res)) return true;
      if (this.pairing.handlePublic(path, res, body)) {
        if (res.statusCode !== 200) this.loginFailures.record(ipOf(req));
        return true;
      }
    }
    if (path === HOMESCREEN_ROUTE) {
      const t = tokenOf(req, body);
      return this.pairing.homescreen(res, t === undefined || this.impersonations.has(t) ? undefined : this.guestTokens.get(t));
    }
    if (path === LOGOUT_ROUTE) return this.pairing.logout(res, tokenOf(req, body));

    if (path === "/api/agent/reply") {
      if (opts.moderator !== true && !this.sessions.canModerate(tokenOf(req, body))) {
        sendJson(res, 403, { error: "moderators only" });
        return true;
      }
      this.agentReply(res, body);
      return true;
    }
    if (path === "/api/agent/judge") {
      if (opts.moderator !== true && !this.sessions.canModerate(tokenOf(req, body))) {
        sendJson(res, 403, { error: "moderators only" });
        return true;
      }
      this.agentJudge(res, body);
      return true;
    }
    if (path === "/api/agent/trace") {
      if (opts.moderator !== true && !this.sessions.canModerate(tokenOf(req, body))) {
        sendJson(res, 403, { error: "moderators only" });
        return true;
      }
      this.agentTraceIn(res, body);
      return true;
    }
    if (path === "/api/agent/mind") {
      if (opts.moderator !== true && !this.sessions.canModerate(tokenOf(req, body))) {
        sendJson(res, 403, { error: "moderators only" });
        return true;
      }
      this.agentMind(res, body);
      return true;
    }

    // --- the wall terminals' voice ---
    // A terminal speaks an agent-voiced character's replies out loud. The
    // synthesis runs on the show laptop behind `LOOM_TTS_URL`; this proxies
    // (and caches) it so tablets stay same-origin and only moderator
    // capability — which a terminal holds — can spend the GPU.
    if (path === "/api/mod/tts") {
      if (!opts.moderator && !this.sessions.canModerate(tokenOf(req, body))) {
        sendJson(res, 403, { error: "moderators only" });
        return true;
      }
      const speed = body["speed"];
      const result = await this.tts.speak({
        text: str(body, "text"),
        voice: str(body, "voice") || undefined,
        speed: typeof speed === "number" ? speed : undefined,
      });
      switch (result.kind) {
        case "audio":
          res.writeHead(200, {
            "content-type": result.contentType,
            "content-length": String(result.bytes.byteLength),
            "cache-control": "private, max-age=3600",
            "x-loom-tts-cache": result.cached ? "hit" : "miss",
          });
          res.end(Buffer.from(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength));
          return true;
        case "disabled":
          sendJson(res, 503, { error: "no speech endpoint configured (set LOOM_TTS_URL)" });
          return true;
        case "bad":
          sendJson(res, 400, { error: result.error });
          return true;
        case "failed":
          sendJson(res, 502, { error: result.error });
          return true;
      }
    }

    // --- the join screens' pickers (a passcode, no session yet) ---
    // Which code you hold decides which list you see: the event code shows
    // the pool of programs a guest may be; the performer / mod code shows
    // the parts. Each name says whether someone already holds it.
    if (path === "/api/identities") {
      const passcode = str(body, "passcode");
      const guestCode = passOk(passcode, this.codes.event);
      if (this.throttled(req, res, guestCode)) return true;
      const role = guestCode ? "guest" : passOk(passcode, this.codes.prime) || passOk(passcode, this.codes.mod) ? "prime" : null;
      if (role === null) {
        this.loginFailures.record(ipOf(req));
        sendJson(res, 403, { error: "wrong code" });
        return true;
      }
      // `doorsOpen: false` — before the director opens the doors there is
      // no cast to list yet: the join screen says so and polls.
      const claim = str(body, "claim").trim() || null;
      sendJson(res, 200, { role, identities: this.identities(role, claim), search: role === "guest" && this.wiki !== null, doorsOpen: this.open });
      return true;
    }
    // A guest's search of the program directory: any software on Wikipedia
    // — except antivirus, which is flagged so the screen can say why.
    if (path === "/api/identities/search") {
      const guestCode = passOk(str(body, "passcode"), this.codes.event);
      if (this.throttled(req, res, guestCode)) return true;
      if (!guestCode) {
        this.loginFailures.record(ipOf(req));
        sendJson(res, 403, { error: "wrong event code" });
        return true;
      }
      if (this.wiki === null) {
        sendJson(res, 503, { error: "the program directory is offline — pick from the list" });
        return true;
      }
      const q = str(body, "q").trim().slice(0, 80);
      const hits = await this.wiki.search(q);
      const taken = takenNames(this.sim?.persons.values() ?? []);
      const claim = str(body, "claim").trim() || null;
      const results = hits.map((h) => ({
        name: h.title,
        description: h.description,
        avatar: h.image === null ? null : this.avatars.offer(h.image),
        claimed: taken.has(foldName(this.sim === null ? h.title : (reservedDefFor(this.sim.model, h.title)?.name ?? h.title))),
        // A featured program found by its name or its `wiki:` article is
        // still held.
        reserved: this.reservedFor(h.title, claim),
        blocked: isAntivirusSoftware(h.title, h.description) ? "antivirus" : null,
      }));
      sendJson(res, 200, { results });
      return true;
    }
    // The pictures a guest may choose between for a program — one of the
    // story's (`name`), or a directory pick (`wiki` = the article title).
    if (path === "/api/identities/pictures") {
      const guestCode = passOk(str(body, "passcode"), this.codes.event);
      if (this.throttled(req, res, guestCode)) return true;
      if (!guestCode) {
        this.loginFailures.record(ipOf(req));
        sendJson(res, 403, { error: "wrong event code" });
        return true;
      }
      const wiki = str(body, "wiki").trim().slice(0, 120);
      const name = str(body, "name").trim().slice(0, 120);
      const out = await this.pictureOptions(wiki !== "" ? wiki : name, wiki !== "" ? wiki : undefined);
      if (out === null) {
        sendJson(res, 404, { error: "no such program" });
        return true;
      }
      sendJson(res, 200, out);
      return true;
    }

    // --- guest / performer / login actions ---
    // An operator play-as session acts exactly as the participant would, but
    // every journal line it writes names the director who did it.
    const imp = this.impersonations.get(tokenOf(req, body) ?? "");
    this.actingBy = imp?.by;
    try {
      if (await this.handlePost(req, res, path, body)) return true;
    } finally {
      this.actingBy = undefined;
    }

    // --- admin-only actions ---
    // Authorized by a per-event mod token OR by the owning author's session
    // (opts.moderator) — the same capability, two front doors.
    if (path.startsWith("/api/mod/")) {
      const caller = tokenOf(req, body);
      // A host-only token already passed the allowlist above.
      if (!opts.moderator && !this.sessions.canHost(caller)) {
        sendJson(res, 403, { error: "moderators only" });
        return true;
      }
      // The journal's `by`: the author's name, a booth's own part
      // (`Booth · Task Manager`), else a headless mod token's "Director".
      const booth = opts.moderator === true ? null : this.characterOf(caller);
      const by = opts.moderatorName ?? (booth !== null ? `Booth · ${booth}` : "Director");
      const hostOnly = opts.moderator !== true && this.hostOnly(caller);
      if (path === "/api/mod/spatial/house/project") return this.saveMapToProject(res, body, opts.moderatorName ?? "Director");
      if (path === "/api/mod/load") await this.resyncProjectFiles();
      if (path === "/api/mod/resync") {
        // `sync-example --no-reload` (T4 recheck): the rows were rewritten
        // from another process but the event keeps running — fold them into
        // the open co-editing docs now, no restart, so no editor tab keeps
        // the pre-sync text and drops its writer's next keystroke.
        const done = await this.resyncProjectFiles();
        if (done === "failed") sendJson(res, 502, { error: "re-reading the project's files failed" });
        else sendJson(res, 200, { ok: true, resynced: done === "resynced" });
        return true;
      }
      return this.handleMod(res, path, body, by, hostOnly);
    }

    return false;
  }

  /** A token holding the host capability but not the moderator one. */
  private hostOnly(token: string | undefined): boolean {
    return this.sessions.canHost(token) && !this.sessions.canModerate(token);
  }

  /** What the host allowlist's per-route limits read off the story. */
  private hostRouteContext(): HostRouteContext {
    const model = this.sim?.model ?? this.declaredModel;
    return {
      alertsPath: model?.alerts ?? "Night.alerts",
      isAgent: (c) => model?.characters.get(c)?.mind === "external",
    };
  }

  /** Is this character agent-voiced (a host booth reads its guests' threads)? */
  private readonly agentVoiced = (character: string): boolean => this.sim?.model.characters.get(character)?.mind === "external";

  /**
   * Non-admin POST routes (guest actions, performer chat, prime/mod login).
   * Returns true when `path` matched one of them.
   */
  private async handlePost(req: IncomingMessage, res: ServerResponse, path: string, body: Record<string, unknown>): Promise<boolean> {
    const open = this.open;
    switch (path) {
      // --- guest actions ---
      // Every route below `register` derives the acting guest from the
      // caller's capability token (`requireGuest`) — the `id` a client may
      // still send in the body is ignored, so no guest can act as another.
      case "/api/guest/register": {
        const guestCode = passOk(str(body, "passcode"), this.codes.event);
        if (this.throttled(req, res, guestCode)) return true;
        if (!guestCode) {
          this.loginFailures.record(ipOf(req));
          sendJson(res, 403, { error: "wrong event code" });
          return true;
        }
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        if (!this.registrations.take(ipOf(req))) {
          sendJson(res, 429, { error: "too many registrations — wait a minute" });
          return true;
        }
        // The name is the program they are tonight: one of the story's
        // pool, or any software from the directory (`wiki` = the article
        // title they picked). Names are exclusive, a part in the story is
        // never a guest's, and a program is never antivirus software.
        let name = str(body, "name").trim().replace(/\s+/gu, " ").slice(0, 48) || "Guest";
        const wiki = str(body, "wiki").trim();
        // A picture the guest chose on the picker (a serving key) — honoured
        // only if it is one of that program's own options.
        const chosenKey = str(body, "picture").trim();
        let picture: string | null = null;
        if (wiki !== "") {
          const hit = this.wiki === null ? null : await this.wiki.lookup(wiki);
          if (hit === null) {
            sendJson(res, 404, { error: "no such program in the directory" });
            return true;
          }
          if (isAntivirusSoftware(hit.title, hit.description)) {
            sendJson(res, 403, { error: `${hit.title} is antivirus software — programs can't be antivirus` });
            return true;
          }
          name = hit.title;
          picture = hit.image;
        }
        // The article of a reserved program (`wiki:`) IS that program: the
        // claim holder becomes the featured CHARACTER (its own picture), and
        // anyone else is refused `reserved` below — never a lookalike.
        const heldAs = reservedDefFor(this.sim!.model, name);
        let pictureFor = wiki;
        if (heldAs !== null && foldName(heldAs.name) !== foldName(name)) {
          name = heldAs.name;
          picture = null;
          pictureFor = "";
        }
        // A reserved (featured) program needs its invitation's claim, or a
        // director's open window (`/api/mod/claim/unlock`) — 409 `reserved`.
        const claim = str(body, "claim").trim() || null;
        const refusal = guestNameRefusal(this.sim!.model, name, takenNames(this.sim!.persons.values()), (c) => this.claims.mayClaim(c, claim));
        if (refusal !== null) {
          sendJson(res, 409, { error: refusal });
          return true;
        }
        // Typed in another case (`bugdom`): the guest is the story's own
        // `Bugdom`, so its `program.name ==` checks (the featured parts) hear them.
        name = canonicalGuestName(this.sim!.model, name);
        let chosen: string | null = null;
        if (chosenKey !== "") {
          const opts = await this.pictureOptions(pictureFor !== "" ? pictureFor : name, pictureFor !== "" ? pictureFor : undefined);
          if (opts === null || !opts.options.some((o) => o.key === chosenKey)) {
            sendJson(res, 400, { error: "that picture isn't one of this program's" });
            return true;
          }
          chosen = this.avatars.urlFor(chosenKey);
        }
        const id = `g-${randomUUID().slice(0, 6)}`;
        const token = randomUUID();
        this.guestTokens.set(token, id);
        this.persistGuests();
        if (chosen !== null) {
          this.avatars.assign(name, chosen, true);
          this.persistAvatars();
        } else if (picture !== null) {
          this.avatars.assign(name, picture);
          this.persistAvatars();
        } else {
          this.lookupAvatars([name]);
        }
        this.fanout(this.commit("createPerson", id, name));
        this.seen(id, true);
        sendJson(res, 200, { id, name, token, avatar: this.avatars.keyFor(name) });
        return true;
      }
      // A guest changes their profile picture: the same options the
      // sign-in picker offered for their program (`GET`-style with no
      // `picture`; answers the options either way).
      case "/api/guest/picture": {
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        const me = this.sim!.persons.get(id);
        if (me === undefined) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        const isPool = identityDefs(this.sim!.model).some((d) => foldName(d.name) === foldName(me.name));
        const opts = await this.pictureOptions(me.name, isPool ? undefined : me.name);
        const options = opts?.options ?? [];
        const key = str(body, "picture").trim();
        if (key !== "") {
          if (!options.some((o) => o.key === key)) {
            sendJson(res, 400, { error: "that picture isn't one of your program's" });
            return true;
          }
          this.avatars.assign(me.name, this.avatars.urlFor(key)!, true);
          this.persistAvatars();
          this.pushSnapshots();
          this.refreshGhosts(me.name);
        }
        sendJson(res, 200, { options, avatar: this.avatars.keyFor(me.name) });
        return true;
      }
      case CHECKIN_ROUTE:
        return this.checkin.handle(req, res, body);
      case "/api/guest/join": {
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        if (this.sim!.isRestricted(id)) {
          // A marked program's side is the story's (T4-07): no club.
          sendJson(res, 403, { error: "you're restricted — the story has to lift it first" });
          return true;
        }
        // Only a declared, joinable, revealed side (D7): never a staff
        // caste or a hidden group the story hasn't opened.
        const side = guestSide(this.sim!, str(body, "faction"));
        if (side === null) {
          sendJson(res, 403, { error: "that side isn't open" });
          return true;
        }
        this.fanout(this.commit("join", id, side));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/guest/defect": {
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        if (this.sim!.isRestricted(id)) {
          // A marked program's side is the story's (T4-07): no club.
          sendJson(res, 403, { error: "you're restricted — the story has to lift it first" });
          return true;
        }
        // Only a declared, joinable, revealed side (D7): never a staff
        // caste or a hidden group the story hasn't opened.
        const side = guestSide(this.sim!, str(body, "to"));
        if (side === null) {
          sendJson(res, 403, { error: "that side isn't open" });
          return true;
        }
        this.fanout(this.commit("defect", id, side));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/guest/choose": {
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const idx = Number(body["index"] ?? -1);
        this.fanout(this.commit("choose", id, idx));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/guest/escape": {
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        this.fanout(this.commit("escape", id));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/guest/act": {
        // A guest fires one of the story's `who: guest` INTERACTIONs for
        // themselves — a named event with the guest as subject (Loom 4 §10).
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const name = str(body, "name");
        const def = this.sim!.model.interactions.get(name);
        if (def === undefined || def.who !== "guest") {
          sendJson(res, 404, { error: "no such interaction for guests" });
          return true;
        }
        // `restrict who`: every button is off until the story lifts it,
        // bar the `restricted: allow` ones (Bathroom Mode).
        if (this.sim!.isRestricted(id) && !def.allowRestricted) {
          sendJson(res, 403, { error: "you're restricted — the story has to lift it first" });
          return true;
        }
        const evs = this.commit("signal", name, id);
        this.fanout(evs);
        // The story's `reply` lines to this guest ride the answer too, so
        // the app can show them where the guest is looking (they land in
        // the lobby feed, rarely the room the guest has open).
        const replies = evs.flatMap((e) => (e.type === "respond" && e.to === id ? [readoutText(e.text).text] : []));
        sendJson(res, 200, { ok: true, replies });
        return true;
      }
      case "/api/guest/widget": {
        // A guest answered a widget the story showed them (`show …`): the
        // answer is the named event `<kind> answered` for that guest, with
        // the widget's result as arguments — so a story handles a CAPTCHA
        // exactly like any other event (`when captcha answered for program:`).
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const seq = Number(body["seq"]);
        const m = Number.isInteger(seq) ? this.chat.get(seq) : undefined;
        if (m === undefined || m.kind !== "widget" || m.widget === undefined || !visibleTo(m, id)) {
          sendJson(res, 404, { error: "no such widget for you" });
          return true;
        }
        const key = `${seq}:${id}`;
        if (this.answeredWidgets.has(key)) {
          sendJson(res, 409, { error: "already answered" });
          return true;
        }
        const args = widgetResultArgs(body["result"], this.sim!, m.widget.kind);
        if (args === null) {
          sendJson(res, 400, { error: "bad widget result" });
          return true;
        }
        // The facts judge (facts.ts): a 📝 fact / keyed answer card gets its
        // verdict here, journaled with the answer — never re-judged on replay.
        const judged = this.judgeWidget(m.widget, args);
        if (judged === "refused") {
          sendJson(res, 400, { error: "bad fact filing" });
          return true;
        }
        if (!this.widgetAnswers.take(id)) {
          sendJson(res, 429, { error: "slow down — wait a minute" });
          return true;
        }
        this.answeredWidgets.add(key);
        // `card` rides the journaled args so a restart rebuilds the
        // answered set (`restore`) — the story sees it as one more argument.
        const answered = () => this.commit("signal", `${m.widget!.kind} answered`, id, { ...args, ...(judged?.args ?? {}), card: seq });
        // A near miss in auto mode: the story's `judge:` character rules on
        // it when its worker can answer now (wave 11b) — else wave 11's rule.
        const ruler = judged?.review === true ? this.rulerOnline() : null;
        this.fanout(judged?.review === true ? this.commitUnderReview(answered, nearNotice(this.sim!.persons.get(id)?.name ?? id, args, judged.near, ruler)) : answered());
        if (ruler !== null && typeof args["question"] === "string") this.askRuling(id, args["question"]);
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/guest/say": {
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        if (!this.sim!.persons.has(id)) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        let channel = str(body, "channel") || "lobby";
        const text = str(body, "text").trim();
        if (text === "") {
          sendJson(res, 400, { error: "empty message" });
          return true;
        }
        if (chatTooLong(res, text)) return true;
        // A guest's `dm:` thread is with a declared character, under its
        // canonical id: `dm:trabolta` (a terminal provisioned in lower case)
        // is the real `dm:Trabolta`, and `dm:nobody` is no thread at all —
        // a phantom one would skip the agent and the hidden-agent gate.
        // A thread that isn't a character's stays as it is when it is a
        // stage voice (`dm:Operator` / `dm:Narrator`, a director's DM) or
        // one this guest was already spoken to in (an undeclared ALL-CAPS
        // speaker's dialogue), so the guest can reply to it.
        if (channel.startsWith("dm:")) {
          const name = channel.slice("dm:".length);
          const character = this.characterNamed(name);
          if (character !== null) channel = `dm:${character}`;
          else if (!this.guestDmThread(id, channel)) {
            sendJson(res, 404, { error: "no such character" });
            return true;
          }
        }
        // Any other room must be one the story has: an undeclared id
        // ("nonsense", "hosts" for room:hosts, faction:Nobody) would be
        // stored as a phantom room with audience "all".
        const room = this.guestRoom(id, channel);
        if (room !== null) {
          sendJson(res, room.status, { error: room.error });
          return true;
        }
        // An agent still hidden from this guest (Trabolta before Clippy
        // introduces him) has no thread yet: a crafted DM is refused, not
        // stored where nothing will ever answer it.
        const agentDm = channel.startsWith("dm:") && this.isAgent(channel.slice(3)) ? channel.slice(3) : null;
        if (!this.sim!.canPost(id, channel) || (agentDm !== null && !this.agentAdmits({ character: agentDm, channel, audience: [id] }))) {
          sendJson(res, 403, { error: "you can't post here" });
          return true;
        }
        const wait = this.sim!.slowModeRemainingMs(id, channel);
        if (wait > 0) {
          sendJson(res, 429, { error: `slow mode — wait ${Math.ceil(wait / 1000)}s`, retryMs: wait });
          return true;
        }
        const parentSeq = this.sim!.threadableOf(channel) && body["parentSeq"] != null ? Number(body["parentSeq"]) : null;
        // A director typing through a play-as pane: the room sees the guest,
        // the mod feed sees who really typed it — like `/api/mod/say`.
        this.fanout(this.commit("say", id, channel, text, parentSeq), this.actingBy);
        this.agentHeard(channel, [id]);
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/guest/channel/invite": {
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        if (!this.sim!.persons.has(id)) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        const channel = str(body, "channel");
        const person = str(body, "person");
        const refused = this.guestInviteRefusal(id, person, channel);
        if (refused !== null) {
          sendJson(res, refused.status, { error: refused.error });
          return true;
        }
        this.fanout(this.commit("inviteToChannel", id, person, channel));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/guest/channel/leave": {
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        if (!this.sim!.persons.has(id)) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        this.fanout(this.commit("leaveChannel", id, str(body, "channel")));
        sendJson(res, 200, { ok: true });
        return true;
      }

      case "/api/guest/codex/redeem": {
        // A guest types (or scans) an unlock code — a QR on the wall, a
        // puzzle's answer. Journaled; a miss is a story event too.
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const code = str(body, "code").trim();
        if (code === "") {
          sendJson(res, 400, { error: "empty code" });
          return true;
        }
        // Past the miss cap every redeem waits (a hit too — else guessing
        // just goes on unjournaled), and nothing reaches the journal.
        if (!this.redeemMisses.allowed(id)) {
          sendJson(res, 429, { error: "too many wrong codes — wait a minute" });
          return true;
        }
        const events = this.commit("redeem", id, code);
        this.fanout(events);
        if (events.some((e) => e.type === "codexMissed" && e.person === id)) this.redeemMisses.record(id);
        const hit = events.find((e): e is Extract<SimEvent, { type: "codexUnlocked" }> => e.type === "codexUnlocked" && e.person === id);
        sendJson(res, 200, { ok: true, unlocked: hit !== undefined ? hit.entry : null, codex: guestView(this.sim!, id).codex });
        return true;
      }
      case "/api/guest/codex/share": {
        // Knowledge changes hands: a guest shares an entry they hold with
        // another participant or a listed character.
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const entry = str(body, "entry");
        const to = str(body, "to");
        if (!this.sim!.holdsCodex(id, entry)) {
          sendJson(res, 404, { error: "you don't hold that entry" });
          return true;
        }
        if (!this.sim!.persons.has(to) && !this.sim!.model.characters.has(to)) {
          sendJson(res, 404, { error: "unknown recipient" });
          return true;
        }
        const refusal = this.sim!.agentRefusal(to, entry);
        if (refusal !== null) {
          sendJson(res, 403, { error: agentRefusalText(refusal) });
          return true;
        }
        this.fanout(this.commit("share", id, to, entry));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/guest/wallet/send":
      case "/api/guest/wallet/request":
      case "/api/guest/wallet/respond":
      case "/api/guest/wallet/offer":
      case "/api/guest/wallet/accept":
      case "/api/guest/wallet/decline":
      case "/api/guest/wallet/cancel":
      case "/api/guest/wallet/stimulus":
      case "/api/guest/wallet/grant":
      case "/api/guest/wallet/freeze":
      case "/api/guest/wallet/approve":
      case "/api/guest/wallet/deny": {
        // The story's currency (`currency:` header): every call is checked
        // by the book (status + message), rate-limited, then committed as
        // one journaled `wallet` op whose cards land in the Wallet rooms.
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        if (this.wallet === null) {
          sendJson(res, 404, { error: "this story has no currency" });
          return true;
        }
        const sub = path.slice("/api/guest/wallet/".length);
        // `restrict who` freezes the wallet: nothing that starts or completes
        // a transfer. Backing out (decline / cancel) stays open, and approve /
        // deny are the book's (approver-only). Cards stay answerable.
        if (WALLET_RESTRICTED.has(sub) && this.sim!.isRestricted(id)) {
          sendJson(res, 403, { error: "you're restricted — the story has to lift it first" });
          return true;
        }
        // The limit is checked before the book builds the op (so a 429
        // never spends an id) and counted once the call is made. Backing
        // out (decline / cancel, or declining a request: `respond` without
        // `accept: true`, as `guestWalletOp` reads it) is never throttled.
        const throttled = !(WALLET_UNTHROTTLED.has(sub) || (sub === "respond" && body["accept"] !== true));
        if (throttled && !this.walletCalls.allowed(id)) {
          sendJson(res, 429, { error: "slow down — wait a minute" });
          return true;
        }
        const r = this.guestWalletOp(sub, id, body);
        if ("status" in r) {
          // A refused offer still costs a call, so nobody guesses codex
          // titles at speed.
          if (sub === "offer") this.walletCalls.record(id);
          sendJson(res, r.status, { error: r.error });
          return true;
        }
        if (throttled) this.walletCalls.record(id);
        this.fanout(this.commitWallet(r.op));
        sendJson(res, 200, { ok: true, wallet: this.wallet.viewFor(id) });
        return true;
      }
      case "/api/prime/codex/share": {
        // A performer shares one of their character's entries with a guest.
        const token = tokenOf(req, body);
        const character = this.characterOf(token);
        if (!character) {
          sendJson(res, 403, { error: "no character — sign in" });
          return true;
        }
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const entry = str(body, "entry");
        const to = str(body, "to");
        if (!this.sim!.holdsCodex(character, entry)) {
          sendJson(res, 404, { error: "your character doesn't hold that entry" });
          return true;
        }
        if (!this.sim!.persons.has(to) && !this.sim!.model.characters.has(to)) {
          sendJson(res, 404, { error: "unknown recipient" });
          return true;
        }
        const refusal = this.sim!.agentRefusal(to, entry);
        if (refusal !== null) {
          sendJson(res, 403, { error: agentRefusalText(refusal) });
          return true;
        }
        const events = this.commit("share", character, to, entry);
        this.fanout(events);
        // `shared: false` — they already held it, nothing moved.
        sendJson(res, 200, { ok: true, shared: events.some((e) => e.type === "codexUnlocked") });
        return true;
      }

      // --- performer (prime) login: grants the `character` capability ---
      case "/api/prime/login": {
        if (this.throttled(req, res)) return true;
        const character = str(body, "character");
        if (!passOk(str(body, "passcode"), this.codes.prime)) {
          this.loginFailures.record(ipOf(req));
          sendJson(res, 403, { error: "bad passcode" });
          return true;
        }
        let token = tokenOf(req, body);
        // Checked against the story's model before the doors too (a fresh or
        // relaunched event has no sim yet); a story that won't compile has
        // no parts to give.
        const model = this.declaredModel;
        if (model === null) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        // A part is one performer's: every *other* session's character is
        // held; re-signing the same booth into the same part is fine.
        const others = this.sessions.entries().filter(([t]) => t !== token);
        const refusal = performerRefusal(model, character, heldCharacters(others));
        if (refusal !== null) {
          sendJson(res, refusal === "unknown character" ? 404 : 409, { error: refusal });
          return true;
        }
        if (token && this.sessions.grant(token, { character })) {
          /* upgraded in place */
        } else {
          token = randomUUID();
          this.sessions.set(token, { character, admin: false, host: false });
        }
        // D1: a part the story marks `admin: true` makes its booth a host;
        // switching to any other part takes host away (admin is kept).
        if (model.characters.get(character)?.admin === true) this.sessions.grant(token, { host: true });
        else this.sessions.revokeHost(token);
        this.persistSessions();
        sendJson(res, 200, { token, character, admin: this.sessions.canModerate(token), host: this.sessions.canHost(token) });
        return true;
      }

      // --- unified scan: capability decides what it does ---
      case "/api/scan": {
        const token = tokenOf(req, body);
        if (!this.canScan(token)) {
          sendJson(res, 403, { error: "no scan capability — sign in" });
          return true;
        }
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const target = str(body, "target");
        if (!this.sim!.persons.has(target)) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        const admin = this.sessions.canModerate(token);
        const chosen = str(body, "as");
        let scanAs = this.characterOf(token);
        if (chosen && admin) {
          if (!this.sim!.model.characters.has(chosen)) {
            sendJson(res, 404, { error: "unknown character" });
            return true;
          }
          scanAs = chosen;
        }
        let responses: string[] = [];
        if (scanAs !== null) {
          const events = this.commit("scan", scanAs, target);
          responses = events
            .filter((e): e is Extract<SimEvent, { type: "respond" }> => e.type === "respond" && e.to === scanAs)
            .map((e) => readoutText(e.text).text);
          this.fanout(events);
        }
        // Wave 13: the booth's card for this guest, after the scan's events.
        const card = scanAs !== null ? guestCardView(this.sim!, this.chat.all(), scanAs, target, this.sessions.canHost(token)) : null;
        sendJson(res, 200, {
          ok: true,
          scannedAs: scanAs,
          canModerate: admin,
          responses,
          guest: admin
            ? rosterRow(this.sim!, target)
            : { id: target, name: this.sim!.persons.get(target)?.name ?? target, captured: this.sim!.isCaptured(target) },
          ...(card !== null ? { card } : {}),
        });
        return true;
      }

      // --- wave 13: what this booth may do to one guest right now ---
      // (the scan card on demand; not journaled — a read)
      case "/api/prime/card": {
        const token = tokenOf(req, body);
        const character = this.characterOf(token);
        if (character === null) {
          sendJson(res, 403, { error: "no performer capability — sign in" });
          return true;
        }
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const card = guestCardView(this.sim!, this.chat.all(), character, str(body, "guest"), this.sessions.canHost(token));
        if (card === null) sendJson(res, 404, { error: "unknown guest" });
        else sendJson(res, 200, card);
        return true;
      }

      // --- performer types into a channel (hybrid chat) ---
      case "/api/prime/wallet/approve":
      case "/api/prime/wallet/deny": {
        // The approver's booth settles a held transfer (or denies one inside
        // its window). Only the approver character — or an admin booth.
        const token = tokenOf(req, body);
        const character = this.characterOf(token);
        if (!character) {
          sendJson(res, 403, { error: "no character — sign in" });
          return true;
        }
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        if (this.wallet === null) {
          sendJson(res, 404, { error: "this story has no currency" });
          return true;
        }
        if (this.wallet.currency.approver?.id !== character && !this.sessions.canModerate(token)) {
          sendJson(res, 403, { error: "not the approver" });
          return true;
        }
        const id = str(body, "id");
        const approve = path.endsWith("/approve");
        const bad = approve ? this.wallet.checkApprove(id) : this.wallet.checkDeny(id);
        if (bad !== null) {
          sendJson(res, bad.status, { error: bad.error });
          return true;
        }
        this.fanout(this.commitWallet(approve ? { op: "approve", id, by: character } : { op: "deny", id, by: character }));
        sendJson(res, 200, { ok: true, queue: this.wallet.queueFor(character) });
        return true;
      }
      case "/api/prime/act": {
        // A performer fires a `who: performer` INTERACTION on a guest, as
        // their character: only that character's hooks hear it (plus role
        // hooks and story rules). `who: admin` needs moderator powers.
        const token = tokenOf(req, body);
        if (!this.canScan(token)) {
          sendJson(res, 403, { error: "no performer capability — sign in" });
          return true;
        }
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const name = str(body, "name");
        const guest = str(body, "guest");
        const def = this.sim!.model.interactions.get(name);
        const admin = this.sessions.canModerate(token);
        if (def === undefined || def.who === "guest" || (def.who === "admin" && !admin)) {
          sendJson(res, 404, { error: "no such interaction for performers" });
          return true;
        }
        if (!this.sim!.persons.has(guest)) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        const character = this.characterOf(token);
        // `by:` is whose button it is (its characters, a GROUP's members, and
        // any character owning a hook for it — `interactionActors`, what the
        // booth leads with): another booth's press is refused, so a ROLE hook
        // (which ignores the actor) can't be pressed from the wrong card. A
        // button with no `by:` stays anyone's; a moderator's or a host's
        // booth may press any (as the director's quick-fire can, and as its
        // card offers them — `primeViewFor` / `guestCardView` take `canHost`).
        // Never "sign in" here: that answer drops a booth.
        const refusal = this.sessions.canHost(token) ? null : byRefusal(this.sim!, def, character);
        if (refusal !== null) {
          sendJson(res, 403, { error: refusal });
          return true;
        }
        const pressed = this.commit("signal", name, guest, null, character);
        // Wave 13: the story's replies to this booth, and its fresh card.
        const replies = character === null ? [] : pressed.flatMap((e) => (e.type === "respond" && e.to === character ? [readoutText(e.text).text] : []));
        this.fanout(pressed);
        const card = character === null ? null : guestCardView(this.sim!, this.chat.all(), character, guest, this.sessions.canHost(token));
        sendJson(res, 200, { ok: true, guest: rosterRow(this.sim!, guest), replies, ...(card !== null ? { card } : {}) });
        return true;
      }
      case "/api/prime/widget": {
        // A performer answered a card the story showed their character
        // (`show <kind> … to <Character>`): the named event `<kind> answered`
        // fires with the character as subject AND actor, so only that
        // character's own hooks + story rules hear it (never ROLE hooks).
        const token = tokenOf(req, body);
        const character = this.characterOf(token);
        if (!character || !this.canScan(token)) {
          sendJson(res, 403, { error: "no performer capability — sign in" });
          return true;
        }
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const seq = Number(body["seq"]);
        const m = Number.isInteger(seq) ? this.chat.get(seq) : undefined;
        const mine = m !== undefined && m.channel.startsWith("dm:") && Array.isArray(m.audience) && m.audience.includes(`@${character}`);
        if (m === undefined || m.kind !== "widget" || m.widget === undefined || !mine) {
          sendJson(res, 404, { error: "no such card for your character" });
          return true;
        }
        const key = `${seq}:${character}`;
        if (this.answeredWidgets.has(key)) {
          sendJson(res, 409, { error: "already answered" });
          return true;
        }
        const args = widgetResultArgs(body["result"], this.sim!, m.widget.kind);
        if (args === null) {
          sendJson(res, 400, { error: "bad widget result" });
          return true;
        }
        if (!this.widgetAnswers.take(character)) {
          sendJson(res, 429, { error: "slow down — wait a minute" });
          return true;
        }
        this.answeredWidgets.add(key);
        this.fanout(this.commit("signal", `${m.widget.kind} answered`, character, { ...args, card: seq }, character));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/prime/say": {
        const token = tokenOf(req, body);
        const character = this.characterOf(token);
        if (!character) {
          sendJson(res, 403, { error: "no character — sign in" });
          return true;
        }
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const text = str(body, "text").trim();
        if (text === "") {
          sendJson(res, 400, { error: "empty message" });
          return true;
        }
        if (chatTooLong(res, text)) return true;
        let channel = str(body, "channel") || "lobby";
        let audience: "all" | string[] | undefined;
        if (channel.startsWith("guest:")) {
          const gid = channel.slice("guest:".length);
          if (!this.sim!.persons.has(gid)) {
            sendJson(res, 404, { error: "unknown guest" });
            return true;
          }
          channel = `dm:${character}`;
          audience = [gid];
        } else if (channel.startsWith("cast:")) {
          // A performer's conversation with an agent-voiced character: the
          // agent's `dm:` channel, narrowed to this performer.
          const target = channel.slice("cast:".length);
          if (target === character || !this.isAgent(target)) {
            sendJson(res, 404, { error: "no one to talk to there" });
            return true;
          }
          channel = `dm:${target}`;
          audience = [`@${character}`];
        } else if (channel !== "lobby") {
          // A booth posts where its UI gives it a composer: the lobby, the
          // rooms it runs (every location + authored room) and the two
          // mapped threads above — never a pinned room, another
          // character's DM or a guest↔guest thread.
          if (isPinnedRoom(channel) || channel.startsWith("dm:") || channel.startsWith("pm:")) {
            sendJson(res, 403, { error: "a booth can't post there" });
            return true;
          }
          if (!this.sim!.allChannelsFor(character).some((c) => c.id === channel)) {
            sendJson(res, 404, { error: "unknown room" });
            return true;
          }
        }
        const parentSeq = this.sim!.threadableOf(channel) && body["parentSeq"] != null ? Number(body["parentSeq"]) : null;
        this.fanout(this.commit("say", character, channel, text, parentSeq, audience));
        if (Array.isArray(audience) && audience[0]!.startsWith("@")) this.agentHeard(channel, audience);
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/prime/channel/invite": {
        const character = this.characterOf(tokenOf(req, body));
        if (!character) {
          sendJson(res, 403, { error: "no character — sign in" });
          return true;
        }
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        this.fanout(this.commit("inviteToChannel", character, str(body, "person"), str(body, "channel")));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/prime/channel/leave": {
        const character = this.characterOf(tokenOf(req, body));
        if (!character) {
          sendJson(res, 403, { error: "no character — sign in" });
          return true;
        }
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        this.fanout(this.commit("leaveChannel", character, str(body, "channel")));
        sendJson(res, 200, { ok: true });
        return true;
      }

      // --- moderator login: grants the `admin` capability ---
      case "/api/mod/login": {
        if (this.throttled(req, res)) return true;
        if (!passOk(str(body, "passcode"), this.codes.mod)) {
          this.loginFailures.record(ipOf(req));
          sendJson(res, 403, { error: "bad passcode" });
          return true;
        }
        let token = tokenOf(req, body);
        if (token && this.sessions.grant(token, { admin: true })) {
          /* upgraded in place */
        } else {
          token = randomUUID();
          this.sessions.set(token, { character: null, admin: true, host: false });
        }
        this.persistSessions();
        sendJson(res, 200, {
          token,
          character: this.characterOf(token),
          eventPass: this.codes.event,
          primePass: this.codes.prime,
          modPass: this.codes.mod,
        });
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * Before `/api/mod/load` restarts the event, and alone for
   * `/api/mod/resync` (`sync-example --no-reload`) (`sync-show` / `sync-example`
   * wrote the project's files straight into the database from another
   * process): fold the stored text into every open co-editing doc, so the
   * editor shows the synced story and its next keystroke merges on top of
   * it instead of saving the pre-sync doc back over it (C2, T4-04). A
   * failure is logged and never blocks the reload.
   */
  private async resyncProjectFiles(): Promise<"resynced" | "none" | "failed"> {
    // `ProjectLink.resyncFiles` (events-api.ts: `CollabHub.resyncFromStorage`
    // + a files notice per file) is optional: a link without it (a test
    // fake, a LAN box with no project) just skips the resync.
    const resync = this.project?.resyncFiles;
    if (resync === undefined) return "none";
    try {
      await resync.call(this.project);
      return "resynced";
    } catch (err) {
      process.stderr.write(`  ⚠️  event ${this.eventId}: re-reading the project's files failed (${err instanceof Error ? err.message : String(err)})\n`);
      return "failed";
    }
  }

  /** Admin-only routes (caller already proven to hold the mod capability).
   *  `by` is the director's display name — every mutation below journals it. */
  private handleMod(res: ServerResponse, path: string, body: Record<string, unknown>, by: string, hostOnly = false): boolean {
    this.actingBy = by;
    try {
      return this.handleModInner(res, path, body, by, hostOnly);
    } finally {
      this.actingBy = undefined;
    }
  }

  /** `hostOnly`: the caller holds the host capability alone (the
   *  allowlist already admitted the route; `codes` leaves out `modPass`). */
  private handleModInner(res: ServerResponse, path: string, body: Record<string, unknown>, by: string, hostOnly: boolean): boolean {
    if (this.pairing.handle(path, res, body)) return true;
    if (this.pushRoutes.handleMod(path, res)) return true;
    switch (path) {
      case "/api/mod/load": {
        const source = str(body, "source") || this.scenarioSource;
        const name = str(body, "name") || this.scenarioName;
        // `maps` (optional): the project's map files with it
        // (`scripts/sync-example.ts`) — a fresh snapshot, as on a reload.
        // Every file must validate: a broken map would quietly play the show
        // file instead. The row's snapshot follows (a restart reads it).
        const maps = asMapFiles(body["maps"]);
        const bad = mapProblems(maps ?? {});
        if (bad !== null) {
          sendJson(res, 400, { error: `invalid house map ${bad.file}`, file: bad.file, problems: bad.problems });
          return true;
        }
        // `facts` (optional): the project's facts.json with it — a string
        // (validated; a broken key would judge nothing), null = the project
        // has none; absent = untouched.
        const facts = body["facts"];
        if (facts !== undefined && facts !== null && typeof facts !== "string") {
          sendJson(res, 400, { error: "bad facts" });
          return true;
        }
        const factsText = typeof facts === "string" && facts.trim() !== "" ? facts : null;
        const factsBad = factsText !== null ? factsProblems(factsText) : [];
        if (factsBad.length > 0) {
          sendJson(res, 400, { error: `invalid ${FACTS_FILE}`, problems: factsBad });
          return true;
        }
        this.restart(source, name, { by });
        if (facts !== undefined) this.setProjectFacts(factsText);
        if (maps !== null) {
          this.setProjectMaps(maps);
          this.project?.saveSnapshot(this.dataSnapshot(maps)).catch((err: unknown) => {
            process.stderr.write(`  ⚠️  event ${this.eventId}: recording the map snapshot failed (${err instanceof Error ? err.message : String(err)})\n`);
          });
        }
        sendJson(res, 200, { ok: true, phase: this.phase });
        return true;
      }
      case "/api/mod/start": {
        this.openDoors();
        sendJson(res, 200, { ok: true, phase: this.phase });
        return true;
      }
      case "/api/mod/stop": {
        this.pause();
        sendJson(res, 200, { ok: true, phase: this.phase });
        return true;
      }
      case "/api/mod/reset": {
        this.restart(undefined, undefined, { by });
        sendJson(res, 200, { ok: true, phase: this.phase });
        return true;
      }
      case "/api/mod/spatial/house": {
        // A director's edit of the house map (the map page's editor):
        // validated, persisted for this event, announced to every stream.
        // `base` — the version the editor loaded — guards a lost update: a
        // map someone else saved since is never silently overwritten (no
        // `base`, no check).
        const v = validateHouse(body["house"]);
        if (!v.ok || v.house === undefined) {
          sendJson(res, 400, { error: "invalid house map", problems: v.problems });
          return true;
        }
        if (!this.baseIsCurrent(body["base"], res)) return true;
        this.store.saveHouse(v.house);
        const version = this.spatial.setHouse(v.house, "event");
        const warnings = this.houseWarnings(v.house);
        for (const w of warnings) process.stderr.write(`  ⚠️  event ${this.eventId}: house map ${w}\n`);
        sendJson(res, 200, { ok: true, version, warnings });
        return true;
      }
      case "/api/mod/spatial/variant": {
        // The tent ↔ shed switch (SW-MAP-13): play another whole-map
        // variant — mid-show too. The same path as a director's save (live
        // sessions carried over, ducks kept or re-dealt, `house` + `duck`
        // frames, 409 on a stale `base`), but nothing is saved: the variant
        // is remembered, and a director's save in force is dropped.
        const file = str(body, "file");
        const { from, entries } = this.variantEntries();
        const hit = entries.find(([f]) => f === file);
        if (hit === undefined) {
          sendJson(res, 404, { error: "no such map variant", variants: entries.map(([f]) => f) });
          return true;
        }
        const house = hit[1].house;
        if (house === null) {
          sendJson(res, 400, { error: "invalid house map", problems: hit[1].problems });
          return true;
        }
        if (!this.baseIsCurrent(body["base"], res)) return true;
        const dropped = this.spatial.source === "event";
        this.store.clearHouse();
        this.mapVariant = file;
        this.store.saveMaps(this.projectMaps, file);
        this.recordVariant();
        const version = this.spatial.setHouse(house, from);
        const warnings = this.houseWarnings(house);
        for (const w of warnings) process.stderr.write(`  ⚠️  event ${this.eventId}: house map ${w}\n`);
        process.stdout.write(`  🗺️  event ${this.eventId}: ${by} switched the map to ${file}\n`);
        sendJson(res, 200, { ok: true, version, warnings, file, dropped });
        return true;
      }
      case "/api/mod/spatial/begin": {
        // A scanned program enters the simulation — here (the tablet plays
        // it) or parked for a headset (`station`) until its first pose.
        const sim = this.sim;
        if (sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const guest = str(body, "guest");
        const person = sim.persons.get(guest);
        if (person === undefined) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        const world = body["world"];
        if (!isWorld(world)) {
          sendJson(res, 400, { error: "world must be vr or web" });
          return true;
        }
        if (this.spatialHouse() === null) {
          sendJson(res, 503, { error: "no house map" });
          return true;
        }
        const station = str(body, "station").trim().slice(0, 60);
        const device = str(body, "device").trim().slice(0, 60) || by;
        // A story that declares `reinstallation begun` hears the scan first
        // (journaled `by` the device), so it can capture a marked arrival
        // before `captured` is read below. Other stories are untouched.
        if (namedEvents(sim.model).some((n) => foldName(n) === foldName(REINSTALLATION_BEGUN))) {
          this.actingBy = device;
          try {
            this.fanout(this.commit("signal", REINSTALLATION_BEGUN, guest));
          } finally {
            this.actingBy = undefined;
          }
        }
        const assignment = this.spatial.begin({
          guest,
          name: person.name,
          world,
          device,
          station: station === "" ? null : station,
          captured: sim.isCaptured(guest),
        });
        this.startSpatialLoop();
        sendJson(res, 200, assignment);
        return true;
      }
      case "/api/mod/spatial/end": {
        this.spatial.end(str(body, "session"));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/mod/spatial/king": {
        // A director sets (or restores) the shared King's hit points (C2):
        // a journaled set of his `health` path, `by` the director.
        this.spatialHouse();
        const current = this.spatial.king();
        if (current === null) {
          sendJson(res, 404, { error: "no king" });
          return true;
        }
        const hp = body["hp"];
        if (typeof hp !== "number" || !Number.isInteger(hp) || hp < 0 || hp > current.max) {
          sendJson(res, 400, { error: `hp must be an integer 0–${current.max}` });
          return true;
        }
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const king = this.spatial.setKingHp(hp, (ref, n) => this.fanout(this.commit("setVar", ref.path!, String(n))));
        sendJson(res, 200, { ok: true, king });
        return true;
      }
      case "/api/mod/agent/control": {
        // The mind control panel: reset / survey / nudge / set / forget /
        // thinking / effort / pause / rerun, forwarded to the worker(s)
        // voicing the character. The worker applies it, re-mirrors the
        // mind, and records a `control` thought — nothing changes on the
        // server itself (the mind lives on the worker).
        const control = agentControl(body, by);
        if (typeof control === "string") {
          sendJson(res, 400, { error: control });
          return true;
        }
        if (control.character !== null && this.sim !== null && !this.sim.model.characters.has(control.character)) {
          sendJson(res, 404, { error: "unknown character" });
          return true;
        }
        const delivered = this.agents.control(control);
        if (delivered === 0) {
          sendJson(res, 409, { error: control.character === null ? "no agent worker is connected" : `nobody is voicing ${control.character} right now` });
          return true;
        }
        sendJson(res, 200, { ok: true, delivered });
        return true;
      }
      case "/api/mod/codes": {
        // Every codex entry with a code also gets its printable join link —
        // the QR a guest scans on the wall: `?code=<event>&unlock=<code>`.
        const base = this.joinBase();
        const codex = [...(this.sim?.model.codex.values() ?? [])]
          .filter((e) => e.code !== null)
          .map((e) => ({
            id: e.id,
            title: e.title,
            about: e.about,
            code: e.code,
            url: `${base}/?code=${encodeURIComponent(this.codes.event)}&unlock=${encodeURIComponent(e.code!)}`,
          }));
        sendJson(res, 200, {
          eventPass: this.codes.event,
          primePass: this.codes.prime,
          // A host booth never learns the moderator passcode.
          ...(hostOnly ? {} : { modPass: this.codes.mod }),
          joinUrl: base,
          codex,
          // W-03: each reserved program's invitation link (its claim token).
          claims: this.claims.links(this.sim?.model ?? this.declaredModel, base, this.codes.event),
          ...printExtras(this.sim?.model ?? null, base, this.codes.event, this.factsBook()?.raw ?? null),
        });
        return true;
      }
      case "/api/mod/codex": {
        // A director (or show hardware through the mod API — an Arduino
        // puzzle solved, a VR duck found) hands an entry to a holder.
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const who = str(body, "who");
        const entry = str(body, "entry");
        if (!this.sim.persons.has(who) && !this.sim.model.characters.has(who)) {
          sendJson(res, 404, { error: "unknown holder" });
          return true;
        }
        if (!this.sim.model.codex.has(entry) && this.sim.model.codexIndex.get(entry) === null) {
          sendJson(res, 404, { error: "unknown codex entry" });
          return true;
        }
        this.fanout(this.commit("unlock", who, entry));
        sendJson(res, 200, { ok: true, holders: this.sim.codexHolders(entry) });
        return true;
      }
      case "/api/mod/quest": {
        // A director (or show hardware — a puzzle that finishes a quest)
        // moves one person's — or one character's — quest:
        // `{who, quest, action, text?}`.
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const who = str(body, "who");
        const quest = str(body, "quest");
        const action = str(body, "action") || "start";
        const text = typeof body["text"] === "string" && body["text"].trim() !== "" ? body["text"].trim().slice(0, 500) : null;
        if (!this.sim.persons.has(who) && !this.sim.model.characters.has(who)) {
          sendJson(res, 404, { error: "unknown guest or character" });
          return true;
        }
        if (!this.sim.model.quests.has(quest) && this.sim.model.questIndex.get(quest) === null) {
          sendJson(res, 404, { error: "unknown quest" });
          return true;
        }
        if (!["start", "update", "complete", "fail"].includes(action)) {
          sendJson(res, 400, { error: "action must be start, update, complete, or fail" });
          return true;
        }
        this.fanout(this.commit("quest", action, who, quest, text));
        sendJson(res, 200, { ok: true, status: this.sim.questStatus(who, quest) });
        return true;
      }
      case "/api/mod/wallet/approve-held": {
        // Approve every held transfer at once (the approver's booth is
        // empty): one journaled `approve` op each, `by` the director.
        if (this.sim === null || this.wallet === null) {
          sendJson(res, this.sim === null ? 409 : 404, { error: this.sim === null ? "no scenario loaded" : "this story has no currency" });
          return true;
        }
        const ids = this.wallet.heldIds();
        for (const id of ids) this.fanout(this.commitWallet({ op: "approve", id, by: DIRECTOR }));
        sendJson(res, 200, { ok: true, approved: ids, wallet: this.wallet.modView() });
        return true;
      }
      case "/api/mod/wallet/approve":
      case "/api/mod/wallet/deny":
      case "/api/mod/wallet/cancel":
      case "/api/mod/wallet/stimulus":
      case "/api/mod/wallet/grant":
      case "/api/mod/wallet/freeze":
      case "/api/mod/wallet/unfreeze": {
        // The director's hand on the wallet: approve / deny / cancel any
        // open item, or pay the stimulus / a grant when the minter's phone is
        // gone (both still count against their limit), freeze an account or
        // lift a freeze early (`{id}` or `{to}`). The journal line carries the
        // director's name; the cards read `Director`.
        if (this.sim === null || this.wallet === null) {
          sendJson(res, this.sim === null ? 409 : 404, { error: this.sim === null ? "no scenario loaded" : "this story has no currency" });
          return true;
        }
        const sub = path.slice("/api/mod/wallet/".length);
        const id = str(body, "id");
        let bad: WalletRefusal | null;
        let op: WalletOp;
        if (sub === "stimulus") {
          const amount = Number(body["amount"]);
          bad = this.wallet.checkStimulus(DIRECTOR, amount, true);
          op = { op: "stimulus", id: this.wallet.nextId("s"), by: DIRECTOR, amount, at: this.sim.elapsed() };
        } else if (sub === "grant") {
          const amount = Number(body["amount"]);
          const to = str(body, "to");
          bad = this.wallet.checkGrant(DIRECTOR, to, amount, true);
          op = { op: "grant", id: this.wallet.nextId("g"), by: DIRECTOR, to, amount: Math.trunc(amount), at: this.sim.elapsed() };
        } else if (sub === "freeze") {
          const to = str(body, "to");
          const at = this.sim.elapsed();
          bad = this.wallet.checkFreeze(DIRECTOR, to, true);
          op = { op: "freeze", id: this.wallet.nextId("f"), by: DIRECTOR, target: to, until: this.wallet.freezeUntil(at), at };
        } else if (sub === "unfreeze") {
          const r = this.wallet.checkUnfreeze(id !== "" ? id : str(body, "to"));
          bad = "status" in r ? r : null;
          op = { op: "unfreeze", id: "status" in r ? id : r.id, by: DIRECTOR };
        } else if (sub === "approve") {
          bad = this.wallet.checkApprove(id);
          op = { op: "approve", id, by: DIRECTOR };
        } else if (sub === "deny") {
          bad = this.wallet.checkDeny(id);
          op = { op: "deny", id, by: DIRECTOR };
        } else {
          bad = this.wallet.checkCancel(id, DIRECTOR, true);
          op = { op: "cancel", id, by: DIRECTOR };
        }
        if (bad !== null) {
          sendJson(res, bad.status, { error: bad.error });
          return true;
        }
        this.fanout(this.commitWallet(op));
        sendJson(res, 200, { ok: true, wallet: this.wallet.modView() });
        return true;
      }
      case "/api/mod/act": {
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const id = str(body, "id");
        if (!this.sim.persons.has(id)) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        switch (str(body, "action")) {
          case "capture":
            this.fanout(this.commit("capture", id));
            break;
          case "release":
            // A director's release is the story's own release (`when
            // released:` runs); `escape` is the guest's self-escape.
            this.fanout(this.commit("release", id));
            break;
          case "restrict":
            this.fanout(this.commit("restrict", id));
            break;
          case "unrestrict":
            this.fanout(this.commit("unrestrict", id));
            break;
          default:
            sendJson(res, 400, { error: "unknown action" });
            return true;
        }
        sendJson(res, 200, { ok: true, guest: rosterRow(this.sim, id) });
        return true;
      }
      case "/api/mod/signal": {
        // Decided (wave 13, no change): no `by:` check here — a moderator is
        // full admin and may fire any INTERACTION as anyone (`/api/prime/act`
        // is where `by:` is enforced, for booths).
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const subject = str(body, "subject");
        // Optional JSON arguments (`{ level: 3 }`) bind by name in listening
        // bodies, like `fire name with level: 3` (Loom 4 §9.2).
        const rawArgs = body["args"];
        const args = rawArgs !== null && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? canonicalPlaceArgs(rawArgs as Record<string, unknown>, this.sim.model.locations.values()) : null;
        // Fired *as* a character (the performer-lens interaction path, like
        // `/api/prime/act`): only that character's hooks hear it.
        const actor = str(body, "actor");
        if (actor !== "" && !this.sim.model.characters.has(actor)) {
          sendJson(res, 404, { error: "unknown character" });
          return true;
        }
        // A mod-token device (a tablet, a terminal — `by` is the generic
        // "Director") names itself in `label` so the journal says which
        // screen fired it (the recap carries no `by`) (restored by `handleMod`'s finally, as
        // `/api/mod/impersonate` does). An author session's own name is
        // never overridden.
        // `presses`: the cue state's press count the director's screen armed
        // against — only a cue-sheet press carries it (a device, stagehand
        // or a Tools fire never does, and is never refused here).
        const expected = body["presses"];
        if (typeof expected === "number" && Number.isFinite(expected)) {
          // Before the doors: the `start:` beat has not played (a restart
          // with the doors shut leaves the run paused, not idle), so a
          // cue-sheet press would land in the journal ahead of it. The same
          // 409 as no sim at all, so both director screens say the doors
          // aren't open yet.
          if (!this.entryPlayed) {
            sendJson(res, 409, { error: "no scenario loaded", doorsClosed: true });
            return true;
          }
          // Since the arm, a press fired this same cue (a second director's
          // 📋, 🍾 again), moved LAST or ticked a new cue: the night moved
          // under the arm — refuse it, so the screen says "Cues moved"
          // rather than firing twice. Another cue's repeat (a second duck
          // find, the door contact) never vetoes it.
          if (pressMovedArm(this.sim, expected, str(body, "name"))) {
            sendJson(res, 409, { error: "the cues moved: another press landed first — re-arm", moved: true, cues: cueState(this.sim) });
            return true;
          }
        }
        const label = str(body, "label").trim().slice(0, 60);
        if (label !== "" && by === "Director") this.actingBy = label;
        const press = this.commit("signal", str(body, "name"), subject === "" ? undefined : subject, args, actor === "" ? null : actor);
        // `refused`: the story turned the press down (its `# hosts` line says
        // why) — the cue sheet's own judgement, so a phone needn't say "fired".
        const refused = pressRefused(this.sim, press);
        this.fanout(press);
        // `presses`: the count after this press — the screen holds its lock
        // until its own snapshot shows it, so its next arm binds past it.
        const presses = cueState(this.sim).presses;
        sendJson(res, 200, refused ? { ok: true, refused: true, presses } : { ok: true, presses });
        return true;
      }
      case "/api/mod/broadcast": {
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const scope = str(body, "scope");
        const cue = str(body, "cue") || "cue";
        // Journaled like any mutation: a restart replays it onto the same
        // seq, so the hidden set and answered cards keep their messages.
        const before = this.chat.all().length;
        this.fanout(this.commit("broadcast", scope, cue));
        const stored = this.chat.all().slice(before);
        sendJson(res, 200, { ok: true, reached: stored.reduce((n, m) => n + (m.audience === "all" ? -1 : m.audience.length), 0) });
        return true;
      }
      case "/api/mod/message": {
        const seq = Number(body["seq"] ?? -1);
        const hide = body["hidden"] === true;
        const m = this.chat.setHidden(seq, hide);
        if (m === null) {
          sendJson(res, 404, { error: "unknown message" });
          return true;
        }
        this.store.saveHidden(this.chat.hiddenSeqs());
        for (const c of this.clients) {
          if (c.role === "guest") {
            if (!visibleTo(m, c.id)) continue;
            if (m.hidden) sseSend(c.res, "messageModerated", { seq: m.seq, hidden: true });
            else sseSend(c.res, "message", forGuest(m));
          } else if (c.role === "mod" || visibleToPrime(m, c, this.agentVoiced)) {
            sseSend(c.res, "messageModerated", m);
          }
        }
        sendJson(res, 200, { ok: true, seq, hidden: m.hidden });
        return true;
      }
      case "/api/mod/say": {
        // The operator types into *any* room — as themselves ("Operator") or
        // in a character's voice (`as`). Unlike a guest `say`, this bypasses
        // the post policy (an operator can post into a read-only feed).
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const text = str(body, "text").trim();
        if (text === "") {
          sendJson(res, 400, { error: "empty message" });
          return true;
        }
        const as = str(body, "as");
        const speaker = as !== "" ? as : "Operator";
        // Who may speak: the stage voices, any character, or a participant.
        // Anything else is a typo, not a new voice.
        const isPerson = this.sim.persons.has(speaker);
        const isCharacter = this.sim.model.characters.has(speaker);
        if (!isPerson && !isCharacter && speaker !== "Operator" && speaker !== "Narrator") {
          sendJson(res, 404, { error: "unknown speaker" });
          return true;
        }
        let channel = str(body, "channel") || "lobby";
        let audience: "all" | string[] | undefined;
        // Address one guest's DM thread: `channel: "guest:<id>"`.
        if (channel.startsWith("guest:")) {
          const gid = channel.slice("guest:".length);
          if (!this.sim.persons.has(gid)) {
            sendJson(res, 404, { error: "unknown guest" });
            return true;
          }
          if (isPerson) {
            // Participants speak in rooms; characters and the Operator DM.
            sendJson(res, 403, { error: `${this.sim.persons.get(speaker)!.name} can't DM a guest — speak in a room` });
            return true;
          }
          channel = `dm:${speaker}`;
          audience = [gid];
        }
        // Speaking *as* a participant obeys their post policy exactly like
        // their own `/api/guest/say` would (presence in a location room,
        // read-only feeds, membership) — a director can't route around it by
        // borrowing a real guest's name. (Slow mode is not applied: a puppet
        // is the director's own voice.)
        if (isPerson && !this.sim.canPost(speaker, channel)) {
          sendJson(res, 403, { error: `you can't post here as ${this.sim.persons.get(speaker)!.name}` });
          return true;
        }
        const parentSeq = this.sim.threadableOf(channel) && body["parentSeq"] != null ? Number(body["parentSeq"]) : null;
        this.fanout(this.commit("say", speaker, channel, text, parentSeq, audience), isPerson ? by : undefined);
        // A director's persona messaging an agent gets an answer, exactly as
        // the guest would — that's what makes a rehearsal of the bot real.
        if (isPerson) this.agentHeard(channel, [speaker]);
        // A director answering a guest AS the agent (its worker is down —
        // decision #35) closes the request that guest's line opened, so a
        // worker that comes back doesn't answer it a second time.
        else if (isCharacter && Array.isArray(audience) && this.isAgent(speaker)) this.agents.answeredByHand({ character: speaker, channel, audience });
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/mod/set": {
        // Live-edit a guest's stats from the run panel's inspector.
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const id = str(body, "id");
        if (!this.sim.persons.has(id)) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        const field = str(body, "field");
        const value = body["value"];
        switch (field) {
          case "score":
            this.fanout(this.commit("setScore", id, Number(value ?? 0)));
            break;
          case "faction": {
            const to = str(body, "value");
            if (to === "") {
              sendJson(res, 400, { error: "faction required" });
              return true;
            }
            this.fanout(this.commit("defect", id, to));
            break;
          }
          case "location": {
            const to = str(body, "value");
            if (to === "") {
              sendJson(res, 400, { error: "location required" });
              return true;
            }
            this.fanout(this.commit("arrive", id, to));
            break;
          }
          case "captured": {
            const on = value === true || value === "true";
            // Both are idempotent; `release` only fires on a real transition.
            this.fanout(this.commit(on ? "capture" : "release", id));
            break;
          }
          case "restricted": {
            // Both are idempotent; the hook fires on a real transition only.
            const on = value === true || value === "true";
            this.fanout(this.commit(on ? "restrict" : "unrestrict", id));
            break;
          }
          default:
            sendJson(res, 400, { error: "unknown field" });
            return true;
        }
        sendJson(res, 200, { ok: true, guest: rosterRow(this.sim, id) });
        return true;
      }
      case "/api/mod/beat": {
        // Fire a named story beat directly (booth live-patch).
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const name = str(body, "name");
        if (name === "" || !this.sim.model.beats.has(name)) {
          sendJson(res, 404, { error: "unknown beat" });
          return true;
        }
        const subject = str(body, "subject");
        this.fanout(this.commit("fireBeat", name, subject === "" ? undefined : subject));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/mod/scan": {
        // Scan a guest *as* a character — fires that character's scan hooks
        // against them (the beat-firing the operator console does via /api/scan,
        // reachable here through the owning author's session).
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const as = str(body, "as");
        const target = str(body, "target");
        if (!this.sim.model.characters.has(as)) {
          sendJson(res, 404, { error: "unknown character" });
          return true;
        }
        if (!this.sim.persons.has(target)) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        const scanEvents = this.commit("scan", as, target);
        const responses = scanEvents
          .filter((e): e is Extract<SimEvent, { type: "respond" }> => e.type === "respond" && e.to === as)
          .map((e) => readoutText(e.text).text);
        this.fanout(scanEvents);
        sendJson(res, 200, { ok: true, guest: rosterRow(this.sim, target), responses });
        return true;
      }
      case "/api/mod/reveal": {
        // Expose a hidden faction (the secret-villain reveal).
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const faction = str(body, "faction");
        if (!this.sim.model.factions.has(faction)) {
          sendJson(res, 404, { error: "unknown faction" });
          return true;
        }
        this.fanout(this.commit("reveal", faction));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/mod/var": {
        // Write any world variable — the World browser's inline editing.
        // Person-standard fields (`<id>.location` / `.faction` / …) route
        // through the proper mutators inside `Sim.setVar`, so hooks fire.
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const path = str(body, "path").trim();
        if (path === "") {
          sendJson(res, 400, { error: "missing path" });
          return true;
        }
        this.fanout(this.commit("setVar", path, str(body, "value")));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/mod/impersonate": {
        // Play a participant from the editor (Run → Players): mint a session
        // that IS that person's own — a guest/persona's, or a character's
        // performer booth — for the editor's embedded play app. Exact (no
        // moderator powers: a booth sees exactly a booth), in memory only
        // (never `guests.json` / `sessions.json`), cut by the same restarts
        // that cut the real thing, and every action it takes journals this
        // director as `by`. The token goes back to the authorized director
        // in a response body — never into a URL.
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const role = str(body, "role") === "prime" ? "prime" : "guest";
        const id = str(body, "id");
        if (role === "guest" ? !this.sim.persons.has(id) : !this.sim.model.characters.has(id)) {
          sendJson(res, 404, { error: role === "guest" ? "unknown guest" : "unknown character" });
          return true;
        }
        const token = randomUUID();
        // A wall terminal (mod-token authorized, so `by` is the generic
        // "Director") names itself — "Terminal · Kitchen" — so the journal
        // and the mod feed say which screen a program was piloted from.
        const label = str(body, "label").trim().slice(0, 60);
        this.impersonations.set(token, { role, id, by: label !== "" ? label : by });
        const name = role === "guest" ? (this.sim.persons.get(id)?.name ?? id) : id;
        sendJson(res, 200, { token, role, id, name, eventId: this.eventId, title: this.title });
        return true;
      }
      case "/api/mod/impersonate/end": {
        // The editor closed a pane: end that play-as session and its stream.
        // (`session`, not `token` — that field is the caller's own credential.)
        const session = str(body, "session");
        this.endImpersonations((_imp, t) => t === session);
        this.pushPresence();
        sendJson(res, 200, { ok: true });
        return true;
      }
      case CLAIM_UNLOCK_ROUTE:
        // A lost invitation: open a reserved program to anyone for a few
        // minutes (routes/claims.ts). Not story state — never journaled.
        return this.claims.handleUnlock(res, body, this.sim?.model ?? this.declaredModel, () => this.pushModSnapshots());
      case "/api/mod/guest/gone": {
        // W-04: a director marks a guest gone home (or back): a journaled
        // world set of `<id>.gone`, `by` the director, so the story's head
        // counts can leave them out (`p.gone != true`).
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const id = str(body, "id");
        if (!this.sim.persons.has(id)) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        const gone = body["gone"];
        if (typeof gone !== "boolean") {
          sendJson(res, 400, { error: "gone must be true or false" });
          return true;
        }
        this.fanout(this.commit("setVar", `${id}.gone`, gone ? "true" : "false"));
        sendJson(res, 200, { ok: true, id, gone });
        return true;
      }
      case "/api/mod/persona": {
        // Spawn a test persona — a guest the director puppets, no passcode
        // and no play-app registration. This is what makes a server-hosted
        // preview a *shared rehearsal*: every co-writer moderating the same
        // event adds their own persona and plays it from their cockpit
        // (speak via `say` with `as`, answer choices via `choose`).
        // Journaled through the same `createPerson` as a real guest.
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const name = str(body, "name") || "Persona";
        const id = `p-${randomUUID().slice(0, 6)}`;
        // Ownership is runtime state, not a sim fact: it names which director
        // puppets this persona (the rail's "you" / "Ana's persona" chips) and
        // survives a reload of their editor.
        this.personaOwners.set(id, by);
        this.persistMeta();
        // A persona is nobody at the party: `<id>.persona` lets the story's
        // head counts leave it out (W-04), journaled like the creation. It is
        // set FIRST so the join's own drain (`when someone joins:`, every
        // watcher) already sees the flag; a ROLE that seeds a `persona`
        // default would overwrite it, so it is set again in that case.
        this.fanout(this.commit("setVar", `${id}.persona`, "true"));
        this.fanout(this.commit("createPerson", id, name));
        const flag = this.sim.world.get(`${id}.persona`);
        if (flag.kind !== "bool" || !flag.value) this.fanout(this.commit("setVar", `${id}.persona`, "true"));
        sendJson(res, 200, { ok: true, guest: { ...rosterRow(this.sim, id)!, owner: by } });
        return true;
      }
      case "/api/mod/choose": {
        // Answer a pending choice on a participant's behalf (or a `__global`
        // unbound story menu) — the moderator twin of `/api/guest/choose`,
        // journaled through the same `choose` mutation.
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const person = str(body, "person");
        if (person === "") {
          sendJson(res, 400, { error: "missing person" });
          return true;
        }
        const idx = Number(body["index"] ?? -1);
        this.fanout(this.commit("choose", person, idx));
        sendJson(res, 200, { ok: true });
        return true;
      }
      default:
        sendJson(res, 404, { error: "unknown mod action" });
        return true;
    }
  }
}

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
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ESCAPE_COOLDOWN_MS, VOICE_MAX_BYTES, kingSignal, lightStateDoes, lightStateProblems, validateHouse, voiceOn, type GameLights, type HouseMap, type KingState, type LightState, type MapVariantsResponse } from "@loom/house";

import { asNumber, truthy } from "../src/runtime/expr.ts";
import { Sim, type SimEvent } from "../src/runtime/sim/index.ts";
import { foldCode, inWorldLabel, namedEvents, type SimModel } from "../src/runtime/sim/model.ts";
import { allSnapshotFlags, arrivalDue, awardOnly, boothChannels, callsCue, captureFor, playerHiddenRooms, cueState, guestCardView, interactionActors, interactionSubjectOnly, isCaller, guestFlags, guestView, isLocked, modView, staffRoomChannels, notePress, pressMovedArm, pressRefusal, pressRefused, primeView, scanRefused, rosterRow, staffRoomIds, themeOf, titleOf, type AgentMindSummary, type GuestView, type ModPresence, type ModView, type PrimeView, type RuntimePhase } from "./views.ts";
import { passOk, type Passcodes } from "./auth.ts";
import { SessionStore } from "./session.ts";
import { Store, type AgentWait, type AgentWaits, type Mutation } from "./store.ts";
import { ChatStore, HISTORY_LIMIT, aloudSpeakers, boothOwnRow, capHistory, composeGuestMessages, goForViewer, guestOwnRow, decisionChannelFor, isPinnedRoom, menuChannelsFor, momentLines, readoutText, visibleTo, type ChatMessage, type ComposeOptions, type DraftMessage } from "./chat.ts";
import { CASINO_BET_GAP_MS, DIRECTOR, WalletBook, walletSeam, type WalletOp, type WalletRefusal } from "./wallet.ts";
import { TerminalVisits } from "./terminal-visits.ts";
import { payoutOf, rollFor, type CasinoGame } from "../src/casino.ts";
import { CHAT_TEXT_MAX, SSE_MOD_QUEUE_CAP, chatTooLong, ipOf, queryTokenOf, readBody, readRawBody, sendJson, sseCap, sseFrame, sseQueued, sseSend, sseWrite, str, tokenOf } from "./http-util.ts";
import { RateLimiter, limiterFor, rateLimitsFromEnv, type RateLimits } from "./rate-limit.ts";
import { handleMetrics } from "./routes/metrics.ts";
import { handleModLog } from "./routes/mod-log.ts";
import { NOT_FROM_A_BOOTH, isHostRoute, isModSurface, type HostRouteContext } from "./routes/host.ts";
import { cueLines, pressLines, type PressLines } from "./routes/press-lines.ts";
import { isPrivateSlot } from "../src/runtime/sim/stats.ts";
import { TtsProxy, ttsConfigFromEnv } from "./tts.ts";
import { AvatarBook, ImageCache, avatarKey, avatarRefUrl } from "./avatars.ts";
import { WikiClient, isAntivirusSoftware } from "./wiki.ts";
import {
  canonicalGuestName,
  cleanGuestName,
  clipName,
  guestNameRefusal,
  reservedDefFor,
  guestPickable,
  heldCharacters,
  codeEquals,
  identityDefs,
  normalizeCode,
  performerPickable,
  performerRefusal,
  secretCode,
  takenNames,
  type IdentityRow,
  type PictureChoice,
} from "./identity.ts";
import { foldName } from "../src/parser/names.ts";
import { cueSheetView } from "../src/cue-sheet.ts";
import { showClock, clockChange, CLOCK_SET_TO, CLOCK_SET_AT, type ShowClock } from "../src/show-clock.ts";
import { ONLINE_GRACE_MS, hostView, type HostView } from "../src/host-board.ts";
import { StoryMarks, huntsFor } from "./wanted.ts";
import { canonicalPlaceArgs } from "./place-args.ts";
import { CHECKIN_ROUTE, GuestCheckin } from "./routes/k13.ts";
import { GUEST_LOGOUT_ROUTE, LOGOUT_ROUTE, Pairing, RESUME_ROUTE, SIGNED_OUT, releasePart } from "./routes/n02.ts";
import { BADGES_ROUTE, BADGE_ROUTE, ENTER_ROUTE, REJOIN_CANCEL_ROUTE, REJOIN_DECIDE_ROUTE, REJOIN_NAMES_ROUTE, REJOIN_POLL_ROUTE, REJOIN_ROUTE, Rejoin, heldAnswer, partCode, partUrl, printedCode, reservedAnswer, type BoothGrant } from "./routes/rejoin.ts";
import { HOMESCREEN_ROUTE } from "./routes/k31b.ts";
import { PushRoutes } from "./routes/k31.ts";
import { Prompters, readPrompterOp, sceneOf, type PrompterFrame, type PrompterStatus, type SceneDraft } from "./prompter.ts";
import { PushHub, aloudLinePush, aloudPush, boothOwner, guestOwner, messagePush, pushConfigFromEnv, readoutPush, webPushSender, type PushSender } from "./push.ts";
import { printExtras } from "./routes/k12.ts";
import { PRINTED_GUEST_ROUTE, PRINTED_PRIME_ROUTE, printedHit, type PrintedHit } from "./routes/printed.ts";
import { buildCards } from "./routes/cards.ts";
import { CLAIM_UNLOCK_ROUTE, Claims, mintClaimSecret } from "./routes/claims.ts";
import { modPatch, modViewJson } from "./mod-patch.ts";
import { sendRecap } from "./routes/recap.ts";
import { computeRecap, type Recap } from "./recap.ts";
import { LettersBook, emailOf, type LetterEntry, type LettersMailer } from "./letters.ts";
import { letterFactsOf } from "./letter-facts.ts";
import { lettersMailerFromEnv } from "./letters-mail.ts";
import { handleAgentLetter, handleLettersPost, handlePrimeLetter, lettersView, type LettersContext } from "./routes/letters.ts";
import { CreditsSource } from "./credits.ts"; // w44
import { CREDITS_ROUTE, creditsAnswer, sendCredits } from "./routes/credits.ts"; // w44
import { VIDEO_ROUTE, sendVideoConsent, videoConsentView } from "./routes/video.ts"; // w44
import { CREDITS_FILE } from "../src/credits.ts"; // w44
import { COSTUME_FIRE_ROUTE, COSTUME_MENU_ROUTE, COSTUME_MOD_ROUTE, CostumeDesk, CostumeSource, costumeFixtures, costumeLookSafe, costumeMoved, costumeRoomOutRestore, sendCostumeFire, sendCostumeMenu, type CostumeTimers } from "./costume.ts"; // w59
import { COSTUME_BY, COSTUME_FILE, COSTUME_SIGNAL, COSTUME_TOKEN_LABEL, STAGE_CHARS_PER_S, costumeCue, hijackPlaying, saidBy, type CostumeAction, type CostumeFacts, type CostumeFile, type CostumeItem } from "../src/costume.ts"; // w59
import { DESCENT_FILE, DescentSource } from "./descent.ts"; // w49
import { SWEAR_CENSORED, SWEAR_FILTER, SWEAR_FLAGGED, decodeHits, encodeHits, filterHits, hitList, isFilterLevel, maskText, maskUnsaid, type FilterHit } from "../src/language-filter.ts"; // w48, w48b
import { FilterBook, type FilterView } from "./language-filter.ts"; // w48
import { NO_ONE, directorIds, directorNames, forBooth, hostSeen, seenCrews, seenCues, seenFrom, seenName, seenPeople, seenRows, type PeopleRound } from "./unseen-directors.ts";
import { guestSide } from "./routes/sides.ts";
import { CrewRoutes, answeredInviteCards, crewDrafts } from "./routes/crews.ts"; // w18 crews
import { isCrewId, isCrewRoom } from "../src/runtime/sim/crews.ts"; // w18 crews
import { AUDIO_FILE, AudioHub, audioPlayOf, audioProblems, handleAudioGet, handleAudioPost, handleMixerGet, musicDjOf, type AudioContext } from "./audio.ts";
import { LIGHTS_FILE, LightsHub, handleLightsGet, handleLightsPost, lightsProblems, type LightTest, type LightsContext } from "./lights.ts";
import { GameLightsFeed, LightsEstimate, buildGameLights } from "./lights-shown.ts";
import { DESK_BY, DESK_FILE, DeskHub, deskHouseOf, deskLightFixtures, deskProblems, deskRefsOf, deskSeen, handleDeskGet, handleDeskPost, lookMsOf, type DeskContext, type DeskTimers } from "./desk.ts";
import { DESK_SPEECH_GRACE_MS } from "../src/house-desk.ts";
import { ANNOUNCE_VERB, SPEECH_ONLINE_MS, ScreenWatch, announceTextOf, roomVoiceOf, speechWatchOf, spokenAnnounce, handleScreenGet, handleScreenTerminalsGet, handleScreenVoicePost, screenKingOf, screenTerminals } from "./routes/screen.ts";
import { handleScreenIdentifyPost } from "./routes/screen.ts";
import { CAM_BODY_LIMIT, CamStore, parseCamUpload } from "./spatial-cams.ts";
import { DreamFeed } from "./dream-feed.ts";
import { VOICE_LAG_BYTES, VOICE_PING_MS, VoiceRelay, parseVoiceUpload, type VoiceListener } from "./spatial-voice.ts";
import {
  SpatialHub,
  houseVersion,
  houseWarnings,
  isDescentLevel,
  isWorld,
  parseDuckRun,
  parsePrefs,
  parsePrefsBook,
  parseMomentRequest,
  parsePose,
  parseTold,
  sortCandidates,
  type DuckRun,
  type KingRef,
  type MomentLine,
  type SessionRef,
} from "./spatial.ts";
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
  isExact,
  isPlaceholderKey,
  judgeFiling,
  judgeMode,
  parseFactsBook,
  readFactsFile,
  rulingOfArgs,
  screenResultsOf,
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
  agentCapacityOf,
  agentControl,
  agentMindReport,
  agentThought,
  answeredSeq,
  type AgentAct,
  type AgentActResult,
  type AgentDossier,
  type AgentFacts,
  type AgentLine,
  type AgentPower,
  type AgentQueue,
  type AgentRecent,
  type AgentRequest,
  type AgentThread,
  type AgentLineWait,
  type AgentWorker,
  threadKey,
} from "./agents.ts";
import { agentDossierOn, buildDossier, codeMentions, dossierVerdictOf } from "./agent-dossier.ts";
import { TALK_AGENT, TALK_AS, TALK_ROOM, readTalkPost, talkScene, talkView, type TalkScene, type TalkView } from "../src/talk-back.ts";
import { TALK_SCENES } from "../src/talk-scenes.ts";
import { agentRecentOn, answerMentions, buildRecent, HUNT_ANSWER_MARK, secretMentions, storyTag, storyTexts, worldString, type StoryTagContext } from "./agent-recent.ts";


/** Wave 59: a reader's stream closed this recently still counts as a phone in
 *  their hand: an iPhone's page sleeps and drops it within seconds. */
const PROMPTER_STREAM_GRACE_MS = 45_000;

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
  /** Wave 59: that session is a director's own pane (not a wall terminal
   *  piloting a guest): the one phone view that keeps Run personas. */
  pane?: boolean;
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
  /** A booth pane of a host part (`admin: true`, C4): the play-as session
   *  holds the host capability (the NEXT bar, the host routes), still
   *  journaled `by` the director. */
  host?: boolean;
  /** A wall terminal's session (it labelled itself), not a director's pane. */
  terminal?: true;
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

/** Fields that name a story GROUP on purpose: the doors card (`show sides`)
 *  answers with the side the guest walked into (a declared group id) or
 *  `neither`. Anything else in that field is refused (wave 18 fix: the
 *  side's own name was refused as "an entity", so Walk in never settled
 *  the card). */
export const WIDGET_SIDE_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  sides: new Set(["side"]),
};

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
      if (Object.hasOwn(WIDGET_SIDE_FIELDS, kind) && WIDGET_SIDE_FIELDS[kind]!.has(k)) {
        if (v !== "neither" && !sim.model.factions.has(v)) return null;
      } else if (free?.has(k) !== true && (sim.persons.has(v) || sim.model.entityKind.has(v))) return null;
      out[k] = v;
    } else return null;
  }
  return out;
}

function visibleToPrime(m: ChatMessage, c: Client, isAgent: (character: string) => boolean = () => false, model?: Sim["model"] | null): boolean {
  if (c.admin === true) return true;
  // Wave 21 (D6): a player reads only its own team's staff rooms.
  if (model != null && playerHiddenRooms(model, c.id).has(m.channel)) return false;
  if (m.channel.startsWith("pm:")) return false;
  if (isCrewRoom(m.channel)) return false; // w18 crews: a crew's room is its members' own
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
    // Wave 53: Task Manager's lines to another part on rails are that part's.
    if (m.audience === "all" || m.audience.includes(`@${c.id}`)) return true;
    return m.channel === `dm:${c.id}` && !m.audience.some((a) => a.startsWith("@"));
  }
  return true;
}

/** Wave 53 (C1): the event a booth's arrival fires for its own part. */
export const BOOTH_ARRIVED = "booth_arrived";

/** The longest unlock code `/api/guest/codex/redeem` journals (fix round):
 *  a printed code or a puzzle answer is a few words at most. */
export const MAX_CODE_LENGTH = 64;

/** A booth's repeat scan of the same guest inside this window is a double
 *  tap, not a new scan (`/api/scan` answers 429 `again`). */
export const SCAN_REPEAT_MS = 1500;

/** How many thread lines an agent request carries. */
const AGENT_HISTORY = 30;
/** Wave 59: how far back a press looks for lines still being said. */
const COSTUME_LOOKBACK_MS = 20 * 60_000;
/** Wave 59: the beat that hands over to him, and the cue its end fires. */
const HANDOVER_BEAT = "Clippy On Trabolta";
const HANDOVER_CUE = "introduce_trabolta";
/** Who that press reads as, in the journal and the desk's activity. */
const PROMPTER_BY = "📜 Teleprompter";
/** A newer beat took the prompter from her paragraph. DRAFT w59 */
const HANDOVER_CUT_NOTE = "!🤖 A new beat cut Clippy off: press 🤖 on her last line";

/**
 * The guest POST routes a **locked** phone may still call (wave 26, C2): the
 * story's `lock:` header holds for the guest (`isLocked`), and every other
 * `/api/guest/*` POST answers `403 {"error": "locked"}` before any check but
 * the token's (`act` too, unless the interaction is `restricted: allow`).
 * These post nothing into the story: signing up, the session's own
 * housekeeping (resume, enter / rejoin, a printed badge, the home-screen
 * hint, push subscriptions, logout). `core/test/w26-lock.test.ts` walks
 * every guest route against this list, so a new route can't slip past.
 */
export const LOCKED_OPEN: readonly string[] = [
  "/api/guest/register",
  RESUME_ROUTE,
  ENTER_ROUTE,
  REJOIN_ROUTE,
  REJOIN_NAMES_ROUTE,
  REJOIN_POLL_ROUTE,
  REJOIN_CANCEL_ROUTE,
  BADGE_ROUTE,
  HOMESCREEN_ROUTE,
  LOGOUT_ROUTE,
  GUEST_LOGOUT_ROUTE,
  "/api/push/subscribe",
  "/api/push/unsubscribe",
  "/api/push/visible",
];

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
 *  a mod `say`-as-a-participant carries, and a Run persona's name (`hide`)
 *  as "Director". */
export function forGuest(m: ChatMessage, sim: Sim | null = null, viewer: string | null = null, hide: ReadonlySet<string> = NO_ONE): ChatMessage {
  // Wave 18 (C2): a guest gets only the exits to rooms they can see.
  const seen = seenFrom(viewer !== null ? goForViewer(m, sim, viewer) : m, hide);
  // Wave 55: another reader's script is only a line in the room.
  const notTheirs = seen.aloud !== undefined && (viewer === null || !seen.aloud.readers.includes(viewer));
  if (seen.via === undefined && !notTheirs) return seen;
  const { via: _via, aloud, ...rest } = seen;
  return notTheirs || aloud === undefined ? rest : { ...rest, aloud };
}

/** A game's own high-rate calls (`/api/spatial/*` POSTs) carry tiny bodies —
 *  read with this cap, before (never through) the generic 4 MiB parse. */
const SPATIAL_BODY_LIMIT = 2048;

/** The named event `/api/mod/spatial/begin` fires for the scanned program,
 *  when the story declares it (the show captures a marked arrival on it). */
export const REINSTALLATION_BEGUN = "reinstallation begun";

/** The casino's refusal for a program in the Internet (wave 18: they are in the tent). */
export const CASINO_CAPTURED = "programs in the Internet can't gamble";

/** `/api/mod/spatial/begin`'s 409 for a program neither captured nor marked. */
export const NOT_MARKED = "not marked for reinstallation";

/**
 * May program `id` enter the reinstallation (C7)? The story's header
 * `reinstall: <cond>`, evaluated with the program bound, when it writes one;
 * else captured or restricted (the wave 16 rule).
 */
export function eligibleFor(sim: Sim, id: string): boolean {
  const cond = sim.model.reinstall;
  return cond !== null ? sim.holds(cond, id, id) : sim.isCaptured(id) || sim.isRestricted(id);
}

/** The show's house map file: `LOOM_HOUSE`, else the example's `house.json`. */
export function defaultHouseFile(): string {
  return process.env.LOOM_HOUSE ?? fileURLToPath(new URL("../examples/trapped-in-the-internet/house.json", import.meta.url));
}

/** The show's facts key (`facts.ts`): `LOOM_FACTS`, else `facts.json` next
 *  to the house map — the fallback for an event with no project snapshot. */
export function defaultFactsFile(houseFile = defaultHouseFile()): string {
  return process.env.LOOM_FACTS ?? join(dirname(houseFile), FACTS_FILE);
}

/** The house speakers' LAN fallback (`audio.ts`): `LOOM_AUDIO`, else none
 *  (the default 16 / 16 config). */
export function defaultAudioFile(): string | null {
  const v = process.env.LOOM_AUDIO;
  return v !== undefined && v.trim() !== "" ? v : null;
}

/** The house lights' LAN fallback (`lights.ts`, wave 20): `LOOM_LIGHTS`,
 *  else none (no fixtures). */
export function defaultLightsFile(): string | null {
  const v = process.env.LOOM_LIGHTS;
  return v !== undefined && v.trim() !== "" ? v : null;
}

/** The house desk's LAN fallback (`desk.ts`, wave 25): `LOOM_DESK`, else
 *  none (an empty cue list). */
export function defaultDeskFile(): string | null {
  const v = process.env.LOOM_DESK;
  return v !== undefined && v.trim() !== "" ? v : null;
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

/** The `# hosts` line after a 📝 plain miss's own (wave 18b, O4): it is not
 *  an exact match and not spelled close to the key, so it is held pending
 *  with its proposal (a lie at 100, a guess below) while `judge` rules
 *  (null: the ask did not land, and the proposal waits for the settle). */
export function missNotice(name: string, args: Record<string, string | number | boolean>, verdict: string, judge: string | null): string {
  const q = typeof args["question"] === "string" ? args["question"] : "?";
  const a = typeof args["answer"] === "string" ? args["answer"] : "";
  if (judge === null) return `📝 Not an exact match: ${name}'s ${q} filing "${a}" is proposed ${verdict}. The proposal stands at the round's settle; you can judge it yourself on Run → Mind → Judging.`;
  return `📝 Not an exact match: ${name}'s ${q} filing "${a}" is proposed ${verdict} — asked ${judge} to rule. Without a ruling the proposal stands at the round's settle; you can judge it yourself on Run → Mind → Judging.`;
}

/** The `# hosts` line when the `judge:` character's worker stops ruling
 *  (wave 18b: two expiries in a row — the judge stall). */
export function judgeStallNotice(judge: string): string {
  return `⚖ ${judge} isn't ruling: filings fall back to the house rule.`;
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
  /** Wave 41: how Trabolta's letters go out. Absent → the environment's
   *  (`LOOM_RESEND_API_KEY` + `LOOM_WEBMASTER_FROM`); null → mail off. */
  lettersMailer?: LettersMailer | null;
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
  /** The project's `audio.json` text snapshotted at launch (`audio.ts`):
   *  null = the project has none; absent = no row snapshot (the state dir's). */
  audio?: string | null;
  /** The speakers' LAN fallback file (`LOOM_AUDIO`; null = none). */
  audioFile?: string | null;
  /** The project's `lights.json` text snapshotted at launch (`lights.ts`,
   *  wave 20): null = the project has none; absent = no row snapshot. */
  lights?: string | null;
  /** The lights' LAN fallback file (`LOOM_LIGHTS`; null = none). */
  lightsFile?: string | null;
  /** The project's `desk.json` text snapshotted at launch (`desk.ts`, wave
   *  25): null = the project has none; absent = no row snapshot. */
  desk?: string | null;
  /** The desk's LAN fallback file (`LOOM_DESK`; null = none). */
  deskFile?: string | null;
  /** Wave 44 (C5): the credits' fallback file (`LOOM_CREDITS`; null = none). */
  creditsFile?: string | null;
  /** Wave 49 (C3.2): the descent's fallback file (`LOOM_DESCENT`; null = none). */
  descentFile?: string | null;
  /** Wave 59: the costume menu's fallback file (`LOOM_COSTUME`; null = none). */
  costumeFile?: string | null;
  /** Wave 59: the costume's timers (tests inject; default `setTimeout`). */
  costumeTimers?: CostumeTimers;
  /** Wave 50: the house media folder (`LOOM_MEDIA_DIR`; null = none). */
  mediaDir?: string | null;
  /** The desk's timers (tests inject; default `setTimeout`). */
  deskTimers?: DeskTimers;
  /** Is this event an author's private preview / shared rehearsal right now
   *  (the registry's mode; a go-live promotes in place)? Absent = live. The
   *  house desk's tests ask first only on a live event (wave 25). */
  isPreview?: () => boolean;
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
  /** Least gap between two host-view builds while only the log moved
   *  (default `HOST_VIEW_MS`; tests pass 0 to read every step). */
  hostViewMs?: number;
  /** Wave 32: the talk scenes' catalog (`talk-scenes.ts` `TALK_SCENES`;
   *  tests inject a fixture's). */
  talkScenes?: Readonly<Record<string, TalkScene>>;
}

/** Wave 32 (C1): the world var naming the talk scene that is on. */
export const TALK_NIGHT_PATH = "Night.talk";

/** Wave 32 (C4): the one `# hosts` line where a public talk request would
 *  have heard the hold line (no worker, a stall, given up). Never in the room. */
export const TALK_HOLD_NOTE = "🤖 Trabolta isn't answering — tap one of his canned lines"; // DRAFT w32

/** Wave 32 (C4): the `# hosts` note when his answer came after its scene closed. */
export const TALK_LATE_NOTE = "🤖 Trabolta's answer came after the scene moved on, so it was dropped"; // DRAFT w32

/** Wave 32 (C4): the `# hosts` note when a scene closed while a worker was
 *  still answering it: the ticker cancels that answer (the worker's voice
 *  slot is free for the next scene), and the hosts hear it was dropped. */
export const TALK_DROPPED_NOTE = "🤖 Trabolta was still thinking when the scene moved on, so his answer was dropped"; // DRAFT w32

/** The `# hosts` line when a worker stalls. `waiting` counts the DM
 *  threads that got the hold line — never the public talk thread (wave 32,
 *  C4), whose own note (`TALK_HOLD_NOTE`) covers the stage; with none
 *  waiting the line names no threads, no hold line and no way to answer
 *  (the talk note that follows it says: tap a canned line). */
export function agentStallNotice(worker: { name: string; characters: string[] }, waiting: number): string {
  const who = worker.characters.join(" / ") || "the agent";
  // Only the stage thread was waiting: the count-free line.
  // How to answer the stage is TALK_HOLD_NOTE's (a canned line), not Run's.
  if (waiting === 0) return `⏳ ${who} stopped answering (worker ${worker.name}); it clears when ${who} answers again.`; // DRAFT w32
  const many = waiting === 1 ? "1 thread is waiting" : `${waiting} threads are waiting`;
  return `⏳ ${who} stopped answering (worker ${worker.name}): ${many} and got the hold line. Answer them from Run as ${who}; it clears when ${who} answers again.`;
}

/** A host booth's panel (`?role=mod&host=1`) is rebuilt at most once per
 *  this many ms while only the log moves (load test, wave 13: a build is
 *  the whole mod view, 20–45 ms late in the night, and under load every 3 s
 *  poll of every host missed the old per-second cache). A cue press or a
 *  phase change rebuilds at once. */
export const HOST_VIEW_MS = 2000;

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
  /** Wave 59: tokens a release cut, so a phone that slept through it reads
   *  why (`SIGNED_OUT`), not "the story restarted". Memory only. */
  private readonly releasedTokens = new Set<string>();
  // Operator play-as sessions (token → who is played, by whom), minted by
  // `/api/mod/impersonate` for the editor's embedded play app.
  private readonly impersonations = new Map<string, Impersonation>();
  /** Wave 28 (gap 2b): each wall terminal's visit floor per guest, so a reload mid-visit keeps it (memory only). */
  private readonly terminalVisits = new TerminalVisits();
  /** When each booth last scanned each guest (`token|character|guest`), for the double-tap guard. */
  private readonly lastScans = new Map<string, number>();
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
  private readonly printedAsks: RateLimiter;
  private readonly widgetAnswers: RateLimiter;
  // Wallet calls per guest (`/api/guest/wallet/*`, `LOOM_RL_WALLET`).
  private readonly walletCalls: RateLimiter;
  // The casino terminal: when each guest's last bet landed (wall ms) — one
  // bet per `CASINO_BET_GAP_MS`, so a stuck button can't drain a balance.
  private readonly casinoLast = new Map<string, number>();
  // The story's currency in flight (`currency:` header) — pending transfers,
  // the approver's queue, open requests / offers, the stimulus count. Null
  // when the story declares no currency. Rebuilt with every `loadScenario`;
  // every change is one journaled `wallet` op (see `commitWallet`).
  private wallet: WalletBook | null = null;
  // Server-authoritative chat, rebuilt deterministically from the journal.
  private readonly chat = new ChatStore();
  // Where each guest's pending decision docks (channel id). Ephemeral.
  private readonly decisionChannels = new Map<string, string>();
  // Wave 20 (D18): each pending menu's id → the channel its prompt went to
  // (`GuestView.choices`). Ephemeral like the above; rebuilt by a replay.
  private readonly menuChannels = new Map<number, string>();
  /** Person → the character whose line last reached them (D18): a menu's
   *  channel falls back to it when its own batch has no line. */
  private readonly lastSpeakers = new Map<string, string>();
  // W-03 reserved programs: the claim tokens + a director's open windows.
  private readonly claims: Claims;
  // W-04 / OP-11: guest id → when they were last heard from (wall ms): a
  // stream opened or closed, a request on their own token. In memory only
  // (a restart re-learns it from the reconnects).
  private readonly lastSeen = new Map<string, number>();
  // Wave 59: a part's booth stream closed at (the guests' `lastSeen` for a
  // booth: a locked booth phone keeps its grace on a guest's People).
  private readonly boothSeen = new Map<string, number>();
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
  /** Thread (`threadKey`) → the open agent request's id and the seq of the
   *  line that opened it (`persistAgentWaits`). */
  private readonly agentWaitSeq = new Map<string, { id: string; seq: number }>();
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
  /** Wave 41 (C4): the inboxes, drafts and sends (state dir, never journaled). */
  private readonly letters: LettersBook;
  /** Wave 48 (C2): the censor's flagged guest lines, rebuilt from the
   *  journal (`swear_flagged` / `swear_censored`); forgotten with the run. */
  private readonly filter = new FilterBook();
  private readonly lettersMailer: LettersMailer | null;
  private readonly lettersTimer: ReturnType<typeof setInterval>;
  /** The recap the writer's frames read, per log length (a write asks for
   *  a whole house at once). */
  private lettersRecap: { len: number; recap: Recap } | null = null;
  // The reinstallation games (`docs/loom-reinstall.md` §2): sessions,
  // stations, poses and the house map. In memory; poses never journal.
  readonly spatial: SpatialHub;
  /** The wall terminals' camera feeds (wave 14): the latest frame per spot, memory only. */
  readonly cams: CamStore;
  /** Clippy's dream on the games' terminals (wave 50). */
  readonly dreamFeed: DreamFeed;
  /** The voice link (wave 19): terminal mics ⇄ headsets, routed by pose, memory only. */
  readonly voice: VoiceRelay;
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
  /** Wave 44 (C5): the credits, read live (`credits.ts`). */
  private readonly credits: CreditsSource;
  /** Wave 59: the costume's menu, read live, and its desk (`costume.ts`). */
  private readonly costumeSource: CostumeSource;
  private readonly costume: CostumeDesk;
  /** Wave 59: which of his poke lines is next (memory only). */
  private costumePokes = 0;
  /** Wave 49 (C3.2): the descent's words, read live (`descent.ts`). */
  private readonly descent: DescentSource;
  private factsMemo: { text: string; book: FactsBook | null } | null = null;
  private showFacts: { mtimeMs: number; book: FactsBook | null } | null = null;
  private readonly factsWatch = new FactsWatch();
  /** The house speakers + the audio interface (`audio.ts`, wave 17). */
  readonly audio: AudioHub;
  /** The house lights + the Zigbee devices (`lights.ts`, wave 20). */
  readonly lights: LightsHub;
  /** The house desk: its cue list, runs, playhead and checks (`desk.ts`, wave 25). */
  readonly desk: DeskHub;
  /** (wave 39) The server's replay of what each house light shows
   *  (`lights-shown.ts`): the games' `lights` frame reads it while the
   *  module's own report is missing or stale. Memory only; the config's
   *  `boot` look plays into it on first use, as long settled (the module
   *  played it when it started), and again after every story restart. */
  private readonly lightsEstimate = new LightsEstimate();
  private lightsBooted = false;
  /** (wave 39) When the spatial stream's `lights` frame goes out. */
  readonly gameLights: GameLightsFeed;
  /** Near misses a restore found still pending (person, question, answer):
   *  the only ones put to the `judge:` character after they landed —
   *  contract J. A near miss filed with nobody online keeps wave 11's
   *  promise (credited at the settle) and is never asked later. */
  private readonly rulingsDue = new Set<string>();
  private readonly random: () => number;
  /** `runPicks` re-entrancy: a pick's own signal never draws again. */
  private pickDepth = 0;
  /** Wave 18b: the crew lines drafted right after a commit (`draftCrewNotices`),
   *  keyed by that commit's last event: `fanout` posts them right after it,
   *  the order a replay appends them in (after the commit's journal line). */
  private readonly crewAfter = new Map<SimEvent, DraftMessage[]>();
  /** …and those of a commit that logged nothing before any other since the
   *  last `fanout` (posted ahead of its events). */
  private crewHead: DraftMessage[] = [];
  /** The last event of the newest commit since the last `fanout`. */
  private commitTail: SimEvent | null = null;
  /** A drafted notice answered an invitation: `fanout` marks the cards. */
  private crewAnswered = false;
  // w18 crews — crews + recruiting (routes/crews.ts): one journaled `crew` op per change.
  private readonly crewRoutes = new CrewRoutes({
    sim: () => this.sim, open: () => this.open, guest: (q, b, r) => this.requireGuest(q, b, r), facts: () => this.factsBook(), now: () => this.clock(),
    apply: (op) => this.commit("crew", op), fanout: (e) => void this.fanout(e), messages: () => this.chat.all(),
    post: (d) => { for (const m of this.chat.append(d)) this.deliverMessage(m); },
    markAnswered: (keys) => { for (const k of keys) this.answeredWidgets.add(k); this.pushSnapshots(); },
  });
  // K-13 room check-in by QR (routes/k13.ts).
  private readonly checkin: GuestCheckin;
  // N-02 re-pair a guest + N-10 release a performer part (routes/n02.ts).
  private readonly pairing: Pairing;
  /** Wave 23: badges, invitations and host-approved asks to get back in. */
  private readonly rejoin: Rejoin;
  /** The event's claim secret (claims, badges, cast cards). */
  private readonly claimSecret: string;
  // K-31a Web Push to guests + booths (push.ts, routes/k31.ts).
  readonly push: PushHub;
  private readonly pushRoutes: PushRoutes;
  // The wall terminals' poll (K-16): screen cues folded from the sim log + each terminal's last poll.
  readonly screens: ScreenWatch;
  /** Wave 59: the shared teleprompter (`prompter.ts`). Memory only: a restart
   *  forgets it, and the rest of a held beat's lines just play. */
  private readonly prompters: Prompters;
  /** Wave 59: her ✓ Done landed behind paused doors; he starts when they reopen. */
  private handoverOwed = false;
  /** Wave 59: a newer beat cut off her paragraph; `fanout` tells the hosts. */
  private handoverCut = false;
  private prompterTimer: ReturnType<typeof setInterval> | null = null;
  /** When each reader's stream last closed (`@<Character>` or a guest id). */
  private readonly streamLeft = new Map<string, number>();
  // Spatial stream subscribers (terminals, the map page) — never `clients`.
  private readonly spatialStreams = new Set<ServerResponse>();
  /** (wave 49) The footsteps' streams (the router's). */
  private readonly walkerStreams = new Set<ServerResponse>();
  // Flushes poses every 100 ms (and sweeps every second) while anything is
  // going on; started lazily, stops itself when idle.
  private spatialLoop: ReturnType<typeof setInterval> | null = null;
  private spatialTicks = 0;
  // The injectable clock (`EventRuntimeInit.now`), read lazily by the hubs
  // built in field initialisers.
  private clock: () => number = Date.now;
  /** Wave 32: the talk scenes' catalog (`EventRuntimeInit.talkScenes`). */
  private readonly talkScenes: Readonly<Record<string, TalkScene>>;
  /** Wave 32 (C4): the newest Clippy talk post's canned steer (null: the
   *  newest post carried none). Memory-only, like the public request. */
  /** The last typed Clippy line's steer, with the scene it was given in
   *  (a steer never rides into another scene's request). */
  private talkDirection: { scene: string | null; text: string } | null = null;
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
    stale: (req) => this.talkStale(req),
    // Wave 32: the room waiting on the TV first, then a guest at his heart
    // (the heart terminal waiting on him), then every other DM. Wave 42:
    // the heart is read live, not from the body — a body waiting for a
    // windowed worker's slot is built at dispatch, so a guest who walked
    // to the heart while queued would keep the rank he opened with.
    rank: (req) => (req.thread.public === true ? 0 : this.sim !== null && this.agentPeek(`${req.speaker.id}.at_the_heart`) === "true" ? 1 : 2),
    typing: (thread, on) => this.pushTyping(thread, on),
    // Wave 42b (B2): a guest's place in a windowed worker's line.
    wait: (thread, wait) => this.pushAgentWait(thread, wait),
    hold: (req) => this.postAgentHold(req),
    busy: (req) => this.postAgentBusy(req),
    stalled: (worker, waiting) => this.postAgentStall(worker, waiting),
    judgeGone: () => this.pushModSnapshots(),
    // Wave 18b: a ruling left the judge queue (queued → asking), and the
    // judge stall's one `# hosts` line.
    judgeSent: () => this.pushModSnapshots(),
    judgeStalled: () => this.postJudgeStall(),
    // Wave 42 (C2): a letter out takes one of a windowed worker's slots.
    letterLoad: (worker) => this.letters?.outOn(worker) ?? 0,
    now: () => this.clock(),
    presence: () => {
      this.letters?.pump(); // wave 41: a worker came back for the letters
      this.pushSnapshots();
    },
  });

  /** The registry's preview flag (`EventRuntimeInit.isPreview`). */
  private readonly isPreview: () => boolean;

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
    // Wave 44 (C5): the project's credits.json, else LOOM_CREDITS, else (no
    // project) the scenario's own beside its house map.
    const readProject = this.project?.readFile;
    const creditsEnv = init.creditsFile !== undefined ? init.creditsFile : (process.env.LOOM_CREDITS ?? null);
    this.credits = new CreditsSource({
      project: readProject !== undefined && this.project !== null ? () => readProject.call(this.project, CREDITS_FILE) : null,
      envFile: creditsEnv,
      scenarioFile: join(dirname(this.houseFile), CREDITS_FILE),
      ...(init.now !== undefined ? { now: init.now } : {}),
    });
    // Wave 49 (C3.2): the descent's words, found the same way.
    const descentEnv = init.descentFile !== undefined ? init.descentFile : (process.env.LOOM_DESCENT ?? null);
    this.descent = new DescentSource({
      project: readProject !== undefined && this.project !== null ? () => readProject.call(this.project, DESCENT_FILE) : null,
      envFile: descentEnv,
      scenarioFile: join(dirname(this.houseFile), DESCENT_FILE),
      ...(init.now !== undefined ? { now: init.now } : {}),
    });
    // Wave 59: the costume's menu, found the same way, and its desk.
    const costumeEnv = init.costumeFile !== undefined ? init.costumeFile : (process.env.LOOM_COSTUME ?? null);
    this.costumeSource = new CostumeSource({
      project: readProject !== undefined && this.project !== null ? () => readProject.call(this.project, COSTUME_FILE) : null,
      envFile: costumeEnv,
      scenarioFile: join(dirname(this.houseFile), COSTUME_FILE),
      ...(init.now !== undefined ? { now: init.now } : {}),
    });
    this.costume = new CostumeDesk({
      now: () => this.clock(),
      timers: init.costumeTimers ?? { set: (fn, ms) => setTimeout(fn, ms).unref(), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
      facts: () => this.costumeFacts(),
      perform: (a, file) => this.costumePerform(a, file),
      note: (item) => this.costumeNote(item),
      restoreLights: (a) => this.costumeRestoreLights(a),
      musicStory: () => {
        if (this.audio.musicHand() === COSTUME_BY) this.audio.music({ action: "story" }, COSTUME_BY);
      },
    });
    this.projectFacts = init.facts !== undefined ? init.facts : this.store.loadFacts();
    if (init.facts !== undefined) this.store.saveFacts(init.facts);
    // The speakers ride the same record; a director's save in the state dir wins.
    this.audio = new AudioHub({ store: this.store, ...(init.audio !== undefined ? { projectText: init.audio } : {}), envFile: init.audioFile !== undefined ? init.audioFile : defaultAudioFile(), ...(init.now !== undefined ? { now: init.now } : {}) });
    this.lights = new LightsHub({ store: this.store, ...(init.lights !== undefined ? { projectText: init.lights } : {}), envFile: init.lightsFile !== undefined ? init.lightsFile : defaultLightsFile(), ...(init.now !== undefined ? { now: init.now } : {}) });
    this.isPreview = init.isPreview ?? (() => false);
    // Wave 41 (C4–C6): Trabolta's letters.
    this.lettersMailer = init.lettersMailer !== undefined ? init.lettersMailer : lettersMailerFromEnv();
    this.letters = new LettersBook({
      load: () => this.store.loadLetters(),
      save: (doc) => this.store.saveLetters(doc),
      workers: (character, all) => this.agents.letterWorkers(character, all),
      facts: (e) => this.letterFacts(e),
      changed: () => this.pushModSnapshots(),
      ...(init.now !== undefined ? { now: init.now } : {}),
    });
    this.lettersTimer = setInterval(() => {
      if (this.letters.pending() === 0) return;
      this.letters.tick();
      this.agents.pump(); // wave 42: an expired letter freed a windowed slot
    }, 5000);
    this.lettersTimer.unref?.();
    // The house desk drives both hubs and fires story events (wave 25).
    this.desk = new DeskHub({
      store: this.store,
      ...(init.desk !== undefined ? { projectText: init.desk } : {}),
      envFile: init.deskFile !== undefined ? init.deskFile : defaultDeskFile(),
      ...(init.now !== undefined ? { now: init.now } : {}),
      ...(init.deskTimers !== undefined ? { timers: init.deskTimers } : {}),
      deps: {
        play: (p, by) => this.audio.play(p, by).seq,
        routerOnline: () => this.audio.router().online,
        stopAudio: (announce, by) => void this.audio.stop({ announce }, by),
        look: (look, by) => {
          if (!Object.prototype.hasOwnProperty.call(this.lights.current().lights.looks, look)) return false;
          this.lights.test({ look }, by);
          return true;
        },
        lookMs: (look) => lookMsOf(this.lights.current().lights, this.spatialHouse(), look),
        light: (to, set, by) => {
          if (!lightStateDoes(set as LightState)) return 0;
          const fixtures = deskLightFixtures(this.lights.current().lights, this.spatialHouse(), to);
          for (const fixture of fixtures) this.lights.test({ fixture, set: set as LightState }, by);
          return fixtures.length;
        },
        lightsOnline: () => this.lights.module()?.online === true,
        fire: (event) => this.deskFire(event),
        speech: (room, startAt) => speechWatchOf(this.screens, this.sim?.model ?? this.declaredModel, room, startAt, this.chat.all(), DESK_SPEECH_GRACE_MS),
      },
    });
    this.audio.onAck((a) => this.desk.ack(a));
    this.random = init.random ?? Math.random;
    if (init.now !== undefined) this.clock = init.now;
    this.talkScenes = init.talkScenes ?? TALK_SCENES;
    this.claimSecret = this.resolveClaimSecret(init);
    this.claims = new Claims({ secret: this.claimSecret, now: () => this.clock() });
    this.modSnapshotMs = Math.max(0, init.modSnapshotMs ?? MOD_SNAPSHOT_MS);
    this.hostViewMs = Math.max(0, init.hostViewMs ?? HOST_VIEW_MS);
    this.snapshotMs = Math.max(0, init.snapshotMs ?? snapshotMsFromEnv());
    this.spatial = new SpatialHub({
      eventId: init.eventId,
      // R16 (wave 18b): only a marked program plays — a parked headset claim
      // or a live walk after an unmark ends (`unmarked`). No story, no walk.
      mayPlay: (guest) => this.sim !== null && eligibleFor(this.sim, guest),
      ...(init.now !== undefined ? { now: init.now } : {}),
      // The speedrun survives a server restart mid-show (SW-RE-14).
      // C7: a find after the night ended is a party favour, tagged at write
      // time so the recap's duck board and the speedrun award leave it out.
      onRun: (run) => {
        if (this.nightEnded()) run.after = true;
        this.store.appendRun(run);
      },
      // A headset's saved settings (snap / smooth turning) survive a restart.
      onPrefs: (all) => this.store.saveSpatialPrefs(all),
      // The shared King's hit points live in the story world (C2: the
      // prop's `health` path, journaled, restart-safe).
      kingHp: (path) => {
        const v = this.sim?.world.peek(path);
        return v == null ? undefined : (asNumber(v) ?? undefined);
      },
      // A ghost wears the program's profile picture (C3), read live.
      avatarOf: (_guest, name) => this.avatars.keyFor(name),
      // (wave 39) A program under a real light pulses it: presence reads the
      // lights config in force and hands each change of the set to the hub
      // the module long-polls.
      lights: () => this.lights.config(),
      onPresence: (entries) => this.lights.setPresence(entries),
      lightsHello: () => this.gameLights.hello(),
      onHouse: () => this.gameLights.changed(),
      // (wave 49) A program walking is heard on the speakers near it: the
      // hub judges by the config in force, the router's stream carries it.
      audio: () => this.audio.config(),
      onWalkers: (walkers) => this.audio.setWalkers(walkers),
    });
    this.gameLights = new GameLightsFeed({
      now: () => this.clock(),
      build: () => this.gameLightsFrame(),
      send: (frame) => this.spatial.sendLights(frame),
      listeners: () => this.spatial.subscriberCount,
      animating: () => this.lights.gameSource() === "estimate" && this.estimate().animating(this.clock()),
      flipAt: () => this.lights.sourceFlipAt(),
    });
    // A test (a look or a {fixture, set}; a desk cue's burst too) plays into
    // the estimate; every change (a report, presence, the config, the
    // module coming or going) re-sends the frame.
    this.lights.onChange((c) => {
      if (c.kind === "test") this.estimateTest(c.test);
      this.gameLights.changed();
    });
    this.spatial.setOpen(false); // idle until the doors open
    this.cams = new CamStore({ now: () => this.clock() });
    this.dreamFeed = new DreamFeed({ dir: init.mediaDir !== undefined ? init.mediaDir : (process.env.LOOM_MEDIA_DIR ?? null), now: () => this.clock() });
    this.voice = new VoiceRelay({
      now: () => this.clock(),
      // The hub's current map (never a fresh `spatialHouse()` read: that
      // stats the show file, and this runs every 100 ms while anyone listens).
      // The players carry their presence room (wave 26, C8): the voice
      // link is same-room by the doorway-hysteresis room, not `locate`'s.
      world: () => ({ house: this.spatial.house, players: this.spatial.voicePlayers(), live: (s) => this.spatial.hasSession(s) }),
    });
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
      endBooths: (character) => this.endBooths(character),
      closeAsks: (id) => this.rejoin.closeAsks(id),
      joinBase: () => this.joinBase(),
      eventCode: () => this.codes.event,
      now: () => this.clock(),
    });
    this.rejoin = new Rejoin({
      sim: () => this.sim,
      secret: () => this.claimSecret,
      guestCode: (passcode) => passOk(passcode, this.codes.event),
      primeCode: (passcode) => passOk(passcode, this.codes.prime),
      addGuestToken: (token, id) => {
        this.guestTokens.set(token, id);
        this.persistGuests();
      },
      guestHeld: (id) => this.guestHeld(id),
      tokenGuest: (token) => this.phoneGuest(token) ?? null,
      revokeGuest: (id) => this.pairing.cut(id),
      isPersona: (id) => this.personaOwners.has(id) || id.startsWith("p-"),
      claimed: (claim) => this.claims.characterOf(this.sim?.model ?? this.declaredModel, claim),
      invitedProgram: (n) => this.claims.programOfBadge(this.sim?.model ?? this.declaredModel, n),
      claimFor: (character) => this.claims.tokenFor(character),
      partOfCode: (code) => this.partOfCode(code),
      partNamed: (name) => (this.declaredModel !== null && performerRefusal(this.declaredModel, name, new Set()) === null ? name : null),
      partHeld: (character) => heldCharacters(this.sessions.entries()).has(foldName(character)),
      releasePart: (character) => {
        if (releasePart(this.sessions, character) > 0) this.persistSessions();
        this.endBooths(character);
      },
      signInPart: (token, character) => this.signInPart(token, character, this.declaredModel),
      saveBadges: (entries) => this.store.saveBadges(entries),
      linked: () => this.pushClientSnapshots(),
      changed: () => {
        this.hostWrites += 1;
      },
      joinBase: () => this.joinBase(),
      eventCode: () => this.codes.event,
      now: () => this.clock(),
    });
    const limits = { ...rateLimitsFromEnv(process.env), ...init.limits };
    this.loginFailures = limiterFor(limits.loginFailures);
    this.registrations = limiterFor(limits.register);
    this.redeemMisses = limiterFor(limits.redeemMisses);
    this.printedAsks = limiterFor(limits.printedAsks);
    this.widgetAnswers = limiterFor(limits.widgets);
    this.walletCalls = limiterFor(limits.wallet);
    // The TV-voice mute outlives restarts and Go live (an ALL STOP must
    // survive a crash), so one left on from a rehearsal carries into the
    // show: say so on boot, where the crew reads the log.
    const voiceMuted = this.store.loadVoiceMuted();
    if (voiceMuted) process.stderr.write(`  🔇 event ${this.eventId}: the TV voice is muted (kept from before this start) — unmute it on Run → Terminals\n`);
    const voiceFx = this.store.loadVoiceFx();
    if (voiceFx !== "auto") process.stderr.write(`  🌀 event ${this.eventId}: Trabolta's voice is on ${voiceFx} (kept from before this start) — put it back on Run → Terminals\n`);
    this.prompters = new Prompters({
      now: () => (init.now !== undefined ? init.now() : Date.now()),
      send: (frame, members) => this.prompterSend(frame, members),
      voice: (channel) => roomVoiceOf(this.screens, this.sim?.model ?? null, channel),
      // A phone that slept a moment ago is still the reader: it wakes to the pop-up.
      online: (who) => [...this.clients].some((c) => EventRuntime.isPrompterId(c, who)) || Date.now() - (this.streamLeft.get(who) ?? -Infinity) < PROMPTER_STREAM_GRACE_MS,
      name: (who) => this.prompterName(who),
      changed: () => {
        this.modViewLast = null;
        this.pushSnapshots();
      },
      finished: (scene, closed) => this.sceneFinished(scene, closed),
      superseded: (scene) => {
        this.handoverCut ||= this.handoverDue(scene);
      },
    });
    this.screens = new ScreenWatch({
      ...(init.now !== undefined ? { now: init.now } : {}),
      muted: voiceMuted,
      onMute: (muted) => this.store.saveVoiceMuted(muted),
      voiceFx,
      onVoiceFx: (mode) => this.store.saveVoiceFx(mode),
      // The screens' signal allowlist (wave 17): the map's own king signals
      // are device moments, but a checkmate never is (it would tell the
      // house someone now holds the door code); nor are the facts book's
      // confirm events.
      signals: () => {
        const king = this.spatial.kingRef()?.prop;
        const book = this.factsBook();
        const quiet = [...(book !== null ? Object.values(book.confirm) : []), ...(king !== undefined ? [kingSignal(king, "won")] : [])];
        return {
          ...(king !== undefined ? { devices: (["lost", "drawn", "hit", "fallen"] as const).map((w) => kingSignal(king, w)) } : {}),
          ...(quiet.length > 0 ? { quiet } : {}),
        };
      },
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
   *  canonicalises its `character` (and refuses a typo) at setup. A
   *  performer code resolves it too (recheck item 6): a booth signs in
   *  before the doors (`/api/prime/login` checks `declaredModel`), and the
   *  host who opens them picks their part off the list. */
  get declaredCharacters(): string[] {
    return [...(this.declaredModel?.characters.keys() ?? [])];
  }

  /** The parts a performer may sign in as, doors open or not — what a
   *  performer code resolves (`ResolvedCode.characters`, the sign-in's
   *  fallback list): never a `playable: false` prop (Night, the Kernel), an
   *  agent-voiced character or a guest's program, which no booth can take. */
  get performerParts(): string[] {
    const model = this.declaredModel;
    return model === null ? [] : identityDefs(model).filter(performerPickable).map((d) => d.name);
  }

  /** Wave 59: the printed text code `code` is, as the link its QR carries
   *  (`routes/printed.ts`), or null. */
  printedHit(code: string): PrintedHit | null {
    const model = this.declaredModel;
    return printedHit(code, {
      secret: this.claimSecret,
      base: this.joinBase(),
      guestCode: this.codes.event,
      model,
      parts: this.performerParts,
      badgeNumber: (c) => this.rejoin.badges.numberOf(c),
      invited: () => this.claims.links(model, this.joinBase(), this.codes.event),
    });
  }

  /** The Scan sheets' question: does this typed code go anywhere but the
   *  Codex? `who` keys the limiter, like the redeem routes' misses; a miss
   *  costs nothing here, the redeem that follows is what counts. */
  private answerPrinted(res: ServerResponse, who: string, body: Record<string, unknown>): void {
    const code = str(body, "code");
    if (code.length > MAX_CODE_LENGTH) return void sendJson(res, 200, { hit: null });
    if (!this.printedAsks.allowed(who)) return void sendJson(res, 429, { error: "too many wrong codes — wait a minute" });
    const hit = this.printedHit(code);
    if (hit === null) this.printedAsks.record(who);
    sendJson(res, 200, { hit });
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
  private seen(id: string, force = false, every: number = EventRuntime.SEEN_EVERY_MS): void {
    const now = this.clock();
    const last = this.lastSeen.get(id);
    if (force || last === undefined || now - last >= every) this.lastSeen.set(id, now);
  }

  /** An idle phone whose stream stays open is still here: its keepalive
   *  re-stamps `lastSeen` this often (BN2-FH: an open, quiet phone read
   *  "seen 12 min ago" and sat under Missing). Coarse, so a room of idle
   *  phones never churns the directors' roster patches. */
  static readonly STREAM_SEEN_EVERY_MS = 120_000;

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

  /** Wave 59: who the people lists may show now, the same for everyone in a
   *  round. Online is an open stream as `presence()` counts it, or a phone
   *  or booth heard from inside `ONLINE_GRACE_MS`. */
  private peopleRound(): PeopleRound {
    const guests = new Set<string>();
    const booths = new Set<string>();
    for (const c of this.clients) {
      if (c.via !== undefined && c.role === "guest" && !c.id.startsWith("p")) continue;
      if (c.role === "guest") guests.add(c.id);
      else if (c.role === "prime") booths.add(c.id);
    }
    const since = this.clock() - ONLINE_GRACE_MS;
    for (const [id, at] of this.lastSeen) if (at > since) guests.add(id);
    for (const [character, at] of this.boothSeen) if (at > since) booths.add(character);
    return { guests, booths, directors: directorIds(this.sim, this.personaOwners) };
  }

  /** Wave 59: the names a phone's chat lines and crews read as "Director". */
  private personaNames(): ReadonlySet<string> {
    return directorNames(this.sim, this.personaOwners);
  }

  /** The same for one stream or token: a director's own pane hides nobody. */
  private namesHiddenFrom(pane: boolean): ReadonlySet<string> {
    return pane ? NO_ONE : this.personaNames();
  }

  /** Is `token` a director's own pane (Run → Players)? */
  private directorPane(token: string | undefined): boolean {
    const imp = this.impersonations.get(token ?? "");
    return imp !== undefined && imp.terminal !== true;
  }

  /** How often the open night checks whether anyone came or went, and
   *  sends the phones a round if so. */
  static readonly PRESENCE_CHECK_MS = 15_000;
  private presenceCheckMs = 0;
  private presenceKey = "";

  /** Wave 59: a People list is only as fresh as its phone's last snapshot,
   *  and nothing else sends one for a phone that just left or a quiet room. */
  private checkPresence(ms: number): void {
    this.presenceCheckMs += ms;
    if (this.presenceCheckMs < EventRuntime.PRESENCE_CHECK_MS) return;
    this.presenceCheckMs = 0;
    const round = this.peopleRound();
    const key = `${[...round.guests].sort().join(",")}|${[...round.booths].sort().join(",")}`;
    if (key === this.presenceKey) return;
    this.presenceKey = key;
    this.pushClientSnapshots();
  }

  private snapshotFor(client: Client): unknown {
    const online = new Set(this.agents.onlineCharacters());
    if (client.role === "guest") return this.guestViewFor(client.id, online, undefined, undefined, client.pane === true);
    if (client.role === "prime") return this.primeViewFor(client.id, online, undefined, client.host === true || client.admin === true, undefined, client.pane === true);
    return this.modViewNow();
  }

  /** A guest's snapshot, plus the cards they have already answered. Wave
   *  59: `director` is a director's own pane, the one view that keeps Run
   *  personas in its lists. */
  private guestViewFor(id: string, online: ReadonlySet<string>, avatars = this.avatarMap(), round = this.peopleRound(), director = false): GuestView {
    const base = guestView(this.reqSim(), id, this.decisionChannels.get(id) ?? null, online, this.menuChannels);
    return {
      ...seenCrews(base, director ? NO_ONE : this.personaNames()),
      ...seenPeople(base, round, director ? NO_ONE : round.directors),
      answered: this.answeredFor(id),
      avatars,
      ...(this.wallet !== null ? { wallet: this.wallet.viewFor(id) } : {}),
      // Wave 23: the printed badge this guest linked (null: none yet).
      badge: this.rejoin.badges.badgeOf(id),
      // The story clock is stopped: the phone's countdown strip holds still.
      ...(this.phase !== "open" ? { paused: true as const } : {}),
      ...this.showClockField(),
    };
  }

  /** A booth press's / scan's card lines (`pressLines`). Wave 21 (D4): a
   *  player booth never reads the staff rooms' lines (a refusal reads "Not
   *  now." on its card); a host or a plain performer does. */
  private boothPressLines(appended: readonly ChatMessage[], character: string | null, guest: string): PressLines {
    const lines = pressLines(appended, new Set(staffRoomChannels(this.sim!.model)), character, guest);
    if (character !== null && this.sim!.model.characters.get(character)?.player === true) delete lines.staff;
    return lines;
  }

  /** A widget's result as the story hears it. Wave 41 (C2): an `email`
   *  card's address is taken out (`email`, for the letters book) and the
   *  story hears `{given: true}` or `{skipped: true}`. */
  private widgetArgsOf(raw: unknown, kind: string): { args: Record<string, string | number | boolean>; email: string | null } | "bad_email" | null {
    if (kind === "email") {
      const r = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      if (r["skipped"] === true) return { args: { skipped: true }, email: null };
      const email = emailOf(r["email"]);
      return email === null ? "bad_email" : { args: { given: true }, email };
    }
    const args = widgetResultArgs(raw, this.sim!, kind);
    return args === null ? null : { args, email: null };
  }

  /** Wave 41 (C6): who writes the letters: the story's `judge:`, else its
   *  only agent-voiced character. */
  private letterWriter(): { character: string; online: boolean } | null {
    const model = this.sim?.model;
    if (model == null) return null;
    const agents = [...model.characters.values()].filter((c) => c.mind === "external").map((c) => c.id);
    const character = model.judge !== null && agents.includes(model.judge) ? model.judge : agents.length === 1 ? agents[0]! : null;
    return character === null ? null : { character, online: this.agents.isOnline(character) };
  }

  private lettersContext(): LettersContext {
    return {
      book: this.letters,
      mailer: this.lettersMailer,
      writer: () => this.letterWriter(),
      nameOf: (e) => (e.kind === "guest" ? (this.sim?.persons.get(e.id)?.name ?? e.id) : e.id),
    };
  }

  /** A `letter` frame's `to` + `facts` (letter-facts.ts), read now. */
  private letterFacts(e: LetterEntry): ReturnType<typeof letterFactsOf> {
    const sim = this.sim;
    if (sim === null) return null;
    const len = sim.log.len();
    if (this.lettersRecap === null || this.lettersRecap.len !== len) {
      this.lettersRecap = { len, recap: computeRecap(sim, { title: this.title, personas: this.personaOwners, duckRuns: this.spatial.runs() }) };
    }
    const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/Halifax", month: "long", day: "numeric", year: "numeric" });
    return letterFactsOf(e, { sim, recap: this.lettersRecap.recap, date });
  }

  /** A performer's snapshot, plus the cards their character has already
   *  answered, with everyone's profile pictures. */
  private primeViewFor(character: string, online: ReadonlySet<string>, avatars = this.avatarMap(), host = false, round = this.peopleRound(), director = false): PrimeView {
    const queue = this.wallet?.queueFor(character) ?? null;
    const base = primeView(this.sim, character, online, { host });
    return {
      ...base,
      ...this.boothExtras(base, character, host, round, director ? NO_ONE : round.directors),
      // C4: on every path, `false` too — play takes the latest view's host
      // (`view.host ?? auth.host`), so a reload that takes the part's
      // `admin: true` away must say so, not leave it out.
      host,
      answered: this.answeredFor(character),
      avatars,
      ...(queue !== null ? { wallet: queue } : {}),
      // The story clock is stopped: the booth's tray holds its countdowns
      // still (the same rule as a guest's strip, `guestViewFor`).
      ...(this.phase !== "open" ? { paused: true as const } : {}),
      ...this.showClockField(),
      // Wave 32 (C5): a host booth's talk panel (never a player's).
      ...(host ? { talk: this.talkViewNow() } : {}),
      // Wave 41 (C3): this part's inbox for Trabolta's letter.
      letter: { email: this.letters.get(`p:${character}`)?.email ?? null, from: this.lettersMailer?.from ?? null, ...(this.boothInboxAsked(character) ? { asked: true as const } : {}) },
      // Wave 48 (C2): the censor's flagged lines, on its own booth only.
      ...(this.sim !== null && this.sim.model.censor === character ? { filter: this.filterView(character) } : {}),
    };
  }

  /** Wave 48 (C2, C11): the censor booth's `filter` block. Wave 57 (C15):
   *  each line offers her capture while it is live on that program; never
   *  after the ending, when ✂ only counts for the report. */
  private filterView(character: string): FilterView {
    const sim = this.sim;
    const sendOf = sim === null || this.nightEnded() ? null : captureFor(sim, character);
    return this.filter.view({
      now: Date.now(),
      hidden: (seq) => this.chat.get(seq)?.hidden === true,
      nameOf: (g) => sim?.persons.get(g)?.name ?? g,
      avatarOf: (g) => {
        const name = sim?.persons.get(g)?.name;
        return name === undefined ? null : this.avatars.keyFor(name);
      },
      ...(sendOf !== null ? { sendOf } : {}),
    });
  }

  /** Wave 48 (C2): where a guest's line was said, as the censor reads it. */
  private filterWhere(m: ChatMessage, guest: string): string {
    if (m.channel.startsWith("dm:")) return `DM to ${m.channel.slice("dm:".length)}`;
    if (m.channel.startsWith("pm:")) {
      const other = Sim.pmParties(m.channel).find((id) => id !== guest);
      return `to ${other === undefined ? "themselves" : (this.sim?.persons.get(other)?.name ?? other)}`;
    }
    return m.title;
  }

  /** Wave 48 (C2): index a flagged line (live, and on restore). */
  private indexFlag(guest: string, m: ChatMessage, hits: FilterHit[]): void {
    this.filter.flag({ seq: m.seq, guest, where: this.filterWhere(m, guest), text: m.text, hits, ts: m.ts });
  }

  /** Wave 48b (C9): a line about to be stored with its slurs starred, when
   *  the story has a censor (`censor:`); as it is otherwise. */
  private unsaidMasked(text: string): string {
    if (this.sim === null || this.sim.model.censor === null) return text;
    const hits = filterHits(text, 0);
    return hits.length === 0 ? text : maskUnsaid(text, hits);
  }

  /** Wave 48 (C2, C8): after a guest's own line is stored (`stored`, the
   *  say's fanout), run the filter over it at the current strength; with
   *  hits, index it and journal `swear_flagged` (no actor), whose fanout
   *  pushes the censor's snapshot. Only what a guest typed themselves:
   *  never a director's play-as typing, a character's line or a pick, and
   *  nothing without a `censor:` header. `raw` is the line as typed, before
   *  its slurs were starred (the offsets are the same). */
  private flagGuestLine(guest: string, raw: string, stored: readonly ChatMessage[]): void {
    const sim = this.sim;
    if (sim === null || sim.model.censor === null || this.actingBy !== undefined) return;
    const name = sim.persons.get(guest)?.name;
    if (name === undefined) return;
    const line = stored.find((m) => m.kind === "line" && m.from === name && m.pick !== true);
    if (line === undefined || line.text.length !== raw.length) return;
    const level = this.filter.level;
    const hits = filterHits(raw, level);
    if (hits.length === 0) return;
    this.indexFlag(guest, line, hits);
    this.fanout(this.commit("signal", SWEAR_FLAGGED, guest, { message: line.seq, words: hits.length, list: hitList(hits), level, marks: encodeHits(hits) }));
  }

  /** Wave 48 (C2, C8): a journaled `swear_filter` / `swear_flagged` /
   *  `swear_censored` signal, replayed: the strength, the line's hits (from
   *  its `marks`, never a filter that may have changed since), or the
   *  censor's mask and pay. The line itself was replayed earlier. */
  private replayFilter(a: readonly unknown[]): void {
    const args = (a[2] ?? {}) as Record<string, unknown>;
    if (a[0] === SWEAR_FILTER) {
      if (isFilterLevel(args["level"])) this.filter.setLevel(args["level"]);
      return;
    }
    const guest = a[1];
    const message = args["message"];
    if (typeof guest !== "string" || typeof message !== "number") return;
    if (a[0] === SWEAR_CENSORED) {
      const num = (k: string): number => (typeof args[k] === "number" ? (args[k] as number) : 0);
      this.applyCensor(message, this.filter.live(message), { stars: num("stars"), heat: num("heat"), at: num("heat_at") }, false);
      return;
    }
    const m = this.chat.get(message);
    if (m === undefined) return;
    const level = isFilterLevel(args["level"]) ? args["level"] : this.filter.level;
    const hits = typeof args["marks"] === "string" ? decodeHits(m.text, args["marks"]) : filterHits(m.text, level);
    if (hits.length > 0) this.indexFlag(guest, m, hits);
  }

  /** Wave 48 (C2, C8): mask a censored line's `hits` in the chat store and
   *  book what it paid; live, re-send it (a silent upsert:
   *  `messageModerated` with the whole message, which every client already
   *  takes by seq). */
  private applyCensor(seq: number, hits: readonly FilterHit[], paid: { stars: number; heat: number; at: number }, live: boolean): ChatMessage | null {
    const e = this.filter.censor(seq, hits, paid);
    if (e === null) return null;
    const m = this.chat.censor(seq, maskText(e.text, hits));
    if (m === null || !live) return m;
    for (const c of this.clients) {
      if (c.role === "guest") {
        if (!m.hidden && visibleTo(m, c.id)) sseSend(c.res, "messageModerated", forGuest(m, this.sim, c.id, this.namesHiddenFrom(c.pane === true)));
      } else if (c.role === "prime") {
        if (visibleToPrime(m, c, this.agentVoiced, this.sim?.model)) sseSend(c.res, "messageModerated", forBooth(m, this.namesHiddenFrom(c.pane === true)));
      } else {
        sseSend(c.res, "messageModerated", m);
      }
    }
    return m;
  }

  /** Wave 18 additions to a booth's view the bare sim cannot know: each
   *  guest's `lastSeen` (A1), a `target:`'s picture (C5), the Wanted board
   *  for a hunting booth or a host (C6), the caller claim on `calls` (C8).
   *  Wave 59: who is online, and no one in `hide` (Run's personas) in the
   *  guests, a `pick:` or the Wanted board. */
  private boothExtras(base: PrimeView, character: string, host: boolean, round: PeopleRound, hide: ReadonlySet<string>): Partial<PrimeView> {
    const sim = this.sim;
    if (sim === null) return {};
    const out: Partial<PrimeView> = {
      guests: seenRows(base.guests, hide).map((g) => ({ ...g, online: round.guests.has(g.id), lastSeen: this.lastSeen.get(g.id) ?? null })),
    };
    if (base.objectives?.some((o) => o.target !== undefined)) {
      out.objectives = base.objectives.map((o) => {
        if (o.target === undefined) return o;
        const avatar = this.avatars.keyFor(o.target.name);
        return avatar !== null ? { ...o, target: { ...o.target, avatar } } : o;
      });
    }
    if (hide.size > 0 && base.objectives?.some((o) => o.pick?.some((id) => hide.has(id)))) {
      out.objectives = (out.objectives ?? base.objectives)!.map((o) => (o.pick === undefined ? o : { ...o, pick: o.pick.filter((id) => !hide.has(id)) }));
    }
    if (sim.model.wanted !== null && (host || huntsFor(sim, character))) out.wanted = seenRows(this.wantedBoard(), hide);
    // A booth never reads a director's name: parts by name, else "Director".
    if (base.calls !== undefined) out.calls = seenCues({ ...base.calls, caller: this.cueCaller() }, sim.model);
    return out;
  }

  /** Has the night ended (C7: `Night.ended` read true at some point)? */
  private nightEnded(): boolean {
    // Never observe here (m2): a read between journal lines would stamp a
    // tick's change earlier than a replay does. The world says it anyway.
    if (this.marks.endedAt() !== null) return true;
    const v = this.sim?.world.peek("Night.ended");
    return v != null && truthy(v);
  }

  /** Who claimed to be calling the show (C8): a name, when, and the token
   *  that claimed it (null for an author session). Memory only. */
  private caller: { name: string; at: number; token: string | null; character?: string | null } | null = null;
  /** The token of the mod / booth request being handled (C8's claim). */
  private actingToken: string | undefined;

  /** The caller claim now (C8), dropped once the token that made it no
   *  longer holds a session (Release, Sign out, Go live). */
  private cueCaller(): { name: string; at: number } | null {
    const c = this.caller;
    if (c === null) return null;
    if (c.token !== null && !this.sessions.has(c.token)) {
      this.caller = null;
      return null;
    }
    // A booth that signed in again as another part is no longer the caller
    // it claimed to be (m4).
    if (c.token !== null && c.character != null && this.sessions.get(c.token)?.character !== c.character) {
      this.caller = null;
      return null;
    }
    return { name: c.name, at: c.at };
  }

  /** `view.cues` with the caller claim now (C8): `caller: null` when nobody
   *  claims it — the key is always there, so a console can tell "nobody"
   *  from an older server that never says. */
  private withCaller<T extends { cues?: { caller?: unknown } }>(view: T): T {
    if (view.cues === undefined) return view;
    return { ...view, cues: { ...view.cues, caller: this.cueCaller() } } as T;
  }

  /** The Wanted board now (C6). */
  private wantedBoard(): NonNullable<PrimeView["wanted"]> {
    return this.sim === null ? [] : this.marks.board(this.sim, this.lastSeen, (name) => this.avatars.keyFor(name));
  }

  /** `{showClock}` for a view (wave 13 K2), or nothing when the story set no
   *  clock. It runs only while the doors are open — story time, so a pause
   *  holds it exactly as it holds the story clock. */
  private showClockField(): { showClock?: ShowClock } {
    const clock = showClock(this.sim, this.phase === "open");
    return clock !== undefined ? { showClock: clock } : {};
  }

  /** The last `modViewNow()` built (the host view reuses a fresh one). */
  private modViewLast: { len: number; phase: RuntimePhase; at: number; view: ModView } | null = null;

  /** The operator's god view, with everyone's profile pictures. */
  private modViewNow(): ModView {
    const base = modView(this.sim, this.phase, this.scenarioName, this.presence(), this.sim === null ? this.declaredCharacters : undefined, this.declaredSim);
    const view: ModView = {
      // C8: the caller claim rides every cue-sheet view (lean, host, ModView).
      ...this.withCaller(base),
      avatars: this.avatarMap(),
      ...(this.wallet !== null ? { wallet: this.wallet.modView() } : {}),
      // A restart with the doors shut leaves the run `paused` with its
      // `start:` beat unplayed: the doors are still closed (the phone's strip).
      ...(!this.entryPlayed ? { doorsClosed: true as const } : {}),
      ...this.showClockField(),
      talk: this.talkViewNow(), // wave 32 (C5)
      prompter: this.prompters.status(), // wave 59
    };
    this.modViewLast = { len: this.sim?.log.len() ?? -1, phase: this.phase, at: Date.now(), view };
    return view;
  }

  private readonly hostViewMs: number;
  /** The host view's last build (`hostViewNow`). */
  private hostViewCache: { len: number; phase: RuntimePhase; presses: number; writes: number; at: number; view: HostView } | null = null;
  /** Bumped by every director / host write (`noteHostWrite`): the host's
   *  re-poll right after its own write (`client.refresh()`) never reads the
   *  build from before it. */
  private hostWrites = 0;

  /** A write a host's panel must show on its next poll: any `/api/mod/*`
   *  POST, an agent's reply or ruling, and a host booth's own press or scan.
   *  Counted now and again once the answer is sent (a poll that slipped in
   *  while the handler awaited must not stand for the written state). */
  private noteHostWrite(path: string, token: string | undefined, res: ServerResponse): void {
    const write =
      path.startsWith("/api/mod/") ||
      path === "/api/agent/reply" ||
      path === "/api/agent/judge" ||
      ((path.startsWith("/api/prime/") || path === "/api/scan") && this.sessions.canHost(token));
    if (write) this.bumpHostWrites(res);
  }

  /** Count a host-visible write now and again once `res` is sent. */
  private bumpHostWrites(res: ServerResponse): void {
    this.hostWrites += 1;
    const after = (): void => {
      this.hostWrites += 1;
    };
    if (typeof res.once === "function") res.once("finish", after);
  }

  /** A host booth's panel (`GET /api/state?role=mod&host=1`, §2.6): built on
   *  the mod view, plus the King, the terminals, every guest's flags and the
   *  guests waiting on each agent-voiced character. Built at most once per
   *  `HOST_VIEW_MS` (the hosts poll every 3 s; a build is the whole mod view)
   *  unless a cue was pressed or the run changed phase since — then at once,
   *  so a host never reads NEXT from before their own press. */
  private hostViewNow(director = false): HostView {
    const now = Date.now();
    const sim = this.sim;
    const len = sim?.log.len() ?? -1;
    const presses = sim === null ? 0 : cueState(sim).presses;
    const hit = this.hostViewCache;
    // Reused only inside the window, whether or not the log moved: a quiet
    // log still moves the clocks the panel shows (a terminal's silence, an
    // agent's oldest wait, who was seen when).
    if (hit !== null && hit.phase === this.phase && hit.presses === presses && hit.writes === this.hostWrites && now - hit.at < this.hostViewMs) return this.hostSeen(this.withCaller(this.withShowClock(hit.view)), director);
    const waiting = new Map<string, Array<{ guest: string; name: string; since: number; text: string }>>();
    // Wave 42: fresh bodies — a guest's newest line, not the one that
    // opened a request still waiting for a windowed worker's slot.
    for (const r of this.agents.pendingFresh) {
      if (r.speaker.kind !== "guest" || r.thread.channel !== `dm:${r.character}`) continue;
      const list = waiting.get(r.character) ?? [];
      // Since the request was opened (or the owed line, after a restart) —
      // the queue's `oldestMs` clock; `r.at` moves on every refresh.
      list.push({ guest: r.speaker.id, name: r.speaker.name, since: this.agents.sinceOf(r.id) ?? r.at, text: r.text.slice(0, 200) });
      waiting.set(r.character, list);
    }
    // Every guest's flags as a booth snapshot carries them (C3), shared with
    // the booths' round; the mod view the directors' round just built, when
    // it is this log's and under a second old.
    const flags = sim === null ? new Map<string, ReturnType<typeof guestFlags>>() : allSnapshotFlags(sim);
    const last = this.modViewLast;
    const reused = last !== null && last.len === len && last.phase === this.phase && now - last.at < 1000 ? last.view : this.modViewNow();
    // C8: the caller claim is read now (a reused mod view may predate it).
    const mod = this.withCaller(reused);
    this.spatialHouse();
    const king = this.spatial.king();
    const terms = screenTerminals(this.screens);
    const model = sim?.model ?? this.declaredModel;
    const view = hostView({
      mod,
      waiting,
      king: king === null ? null : { hp: king.hp, max: king.max, fallen: king.fallen },
      terminals: { now: terms.now, silentMs: terms.silentMs, voiceMuted: terms.voiceMuted, voiceFx: terms.voiceFx, terminals: terms.terminals.map((t) => ({ name: t.name, ago: t.ago, ...(t.room !== undefined ? { room: t.room } : {}), view: t.view })) },
      flags,
      staffRooms: model === null ? [] : staffRoomChannels(model),
      ...(sim !== null ? { awardOnly: awardOnly(sim) } : {}),
      // C6: hosts see the Wanted board too.
      ...(sim !== null && sim.model.wanted !== null ? { wanted: this.wantedBoard() } : {}),
      // M3: the crews a host renames or dissolves from More.
      ...(sim !== null ? { crews: sim.crews.all().map((c) => ({ id: c.id, name: c.name, members: c.members.length })) } : {}),
      now,
    });
    this.hostViewCache = { len, phase: this.phase, presses, writes: this.hostWrites, at: now, view };
    return this.hostSeen(this.withCaller(this.withShowClock(view)), director);
  }

  /** A host booth's panel as a host reads it: every director's name is
   *  "Director" and no Run persona in its lists (`unseen-directors.ts`),
   *  but for a director's own pane of a host part. Run reads
   *  `/api/state?role=mod`. */
  private hostSeen(view: HostView, director = false): HostView {
    return hostSeen(view, this.sim?.model ?? this.declaredModel, director ? NO_ONE : directorIds(this.sim, this.personaOwners));
  }

  /** A cached host view with the show clock read now (wave 13 K2): the
   *  cache window (and the reused mod view) must not hold the clock back, and
   *  a host's own clock change shows on their next poll. */
  private withShowClock(view: HostView): HostView {
    const { showClock: _old, rejoins: _asks, talk: _talk, prompter: _prompter, ...rest } = view;
    // Wave 23: the asks to get back in are read now too; wave 32 (C5): and
    // the talk panel (Trabolta's thinking moves between two polls).
    return { ...rest, ...this.showClockField(), rejoins: this.rejoin.asks(), talk: this.talkViewNow(), prompter: this.prompters.status() };
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
    let round: PeopleRound | null = null;
    for (const c of this.clients) {
      if ((c.role !== "guest" && c.role !== "prime") || c.lean === true) continue;
      online ??= new Set(this.agents.onlineCharacters());
      avatars ??= this.avatarMap();
      round ??= this.peopleRound();
      const director = c.pane === true;
      sseSend(c.res, "snapshot", c.role === "guest" ? this.guestViewFor(c.id, online, avatars, round, director) : this.primeViewFor(c.id, online, avatars, c.host === true || c.admin === true, round, director));
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
    const hide = this.namesHiddenFrom(c.pane === true);
    return c.role === "guest"
      ? capHistory(this.chat.historyFor(c.id, false), HISTORY_LIMIT, guestOwnRow(c.id)).map((m) => forGuest(m, this.sim, c.id, hide))
      : c.role === "mod"
        ? [...this.chat.all()]
        : capHistory(
            this.chat.all().filter((m) => !m.hidden && visibleToPrime(m, c, this.agentVoiced, this.sim?.model)),
            HISTORY_LIMIT,
            boothOwnRow(c.id),
          ).map((m) => forBooth(m, hide));
  }

  /** A lifecycle transition every connected client should react to
   *  (`reset` / `reload` → drop local state; `ended` → the event is gone). */
  private pushLifecycle(kind: LifecycleKind, extra: Record<string, unknown> = {}): void {
    this.costume.clear(); // wave 59: a new run owes the house no restore
    this.modPrev = null; // the next view after a transition is a keyframe
    this.prompters.clear(); // wave 59: a new run has no scene, and nothing waits
    this.handoverOwed = false;
    this.handoverCut = false;
    this.prompterClock();
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
      this.releasedTokens.add(token);
      n++;
    }
    if (n > 0) this.persistGuests();
    for (const c of [...this.clients]) {
      if (c.role !== "guest" || c.id !== id || c.via !== undefined) continue;
      this.clients.delete(c);
      try {
        // The phone says why (wave 59); one that slept through it hears it
        // from its next call (`signedOut`).
        sseSend(c.res, "lifecycle", { kind: "released", at: Date.now() });
        c.res.end();
      } catch {
        /* client already gone */
      }
    }
    this.push.drop((owner) => owner === guestOwner(id));
    this.pushPresence();
    return n;
  }

  /** Does a phone hold guest `id`? Any live token: offline is no release. */
  private guestHeld(id: string): boolean {
    for (const guest of this.guestTokens.values()) if (guest === id) return true;
    return false;
  }

  /** The guest a phone's own token stands for; never a play-as session. */
  private phoneGuest(token: string | undefined): string | undefined {
    return token === undefined || this.impersonations.has(token) ? undefined : this.guestTokens.get(token);
  }

  /** The part a staff badge's code signs in as, or null. */
  private partOfCode(part: string): string | null {
    if (this.declaredModel === null) return null;
    return identityDefs(this.declaredModel).find((d) => codeEquals(part, partCode(this.claimSecret, d.name)))?.name ?? null;
  }

  /** `token`'s capabilities as `character`: a new session unless it has one
   *  to switch. D1: a part the story marks `admin: true` makes its booth a
   *  host; switching to any other part takes host away (admin is kept).
   *  C8: a part some admin cue's `by:` names calls those cues. */
  private signInPart(token: string, character: string, model: SimModel | null): BoothGrant {
    if (!this.sessions.grant(token, { character })) this.sessions.set(token, { character, admin: false, host: false });
    if (model?.characters.get(character)?.admin === true) this.sessions.grant(token, { host: true });
    else this.sessions.revokeHost(token);
    if (model !== null && isCaller(model, character)) this.sessions.grant(token, { caller: true });
    else this.sessions.revokeCaller(token);
    this.persistSessions();
    return { admin: this.sessions.canModerate(token), host: this.sessions.canHost(token), caller: this.sessions.canCall(token) };
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
    const names = this.personaNames();
    for (const c of this.clients) {
      const hide = c.pane === true ? NO_ONE : names;
      if (c.role === "guest") {
        if (!m.hidden && visibleTo(m, c.id)) sseSend(c.res, "message", forGuest(m, this.sim, c.id, hide));
      } else if (c.role === "prime") {
        if (visibleToPrime(m, c, this.agentVoiced, this.sim?.model)) sseSend(c.res, "message", forBooth(m, hide));
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
  /** Returns the chat messages this batch appended (not those of a pick it
   *  drew: `runPicks` commits its own), for a press's card lines (C1). */
  /** Wave 53 (C5): the `announce` frame to every phone on a stream: words to
   *  say, or `stop`. Live only and never journaled: a phone that missed it
   *  never hears it, and the app says it only if its owner opted in. */
  /** Does this stream belong to prompter member `who` (`@<Character>`, a guest id)? */
  private static isPrompterId(c: Client, who: string): boolean {
    return (c.role === "prime" && `@${c.id}` === who) || (c.role === "guest" && c.id === who);
  }

  /** Who a prompter frame reaches: the scene, every host, every director. */
  private seesPrompter(c: Client, members: ReadonlySet<string>): boolean {
    if (c.lean === true) return false;
    if (c.role === "mod" || (c.role === "prime" && (c.host === true || c.admin === true))) return true;
    return members.has(c.role === "prime" ? `@${c.id}` : c.id);
  }

  /** The whole script goes once to anyone who hasn't it: the first frame of a
   *  scene, and each stream's first (`handleEvents`). */
  private prompterSend(frame: PrompterFrame, members: ReadonlySet<string>): void {
    for (const c of this.clients) if (this.seesPrompter(c, members)) sseSend(c.res, "prompter", frame);
    this.prompterClock();
  }

  /** The hold's clock runs only while a scene is on. */
  private prompterClock(): void {
    if (!this.prompters.active) {
      if (this.prompterTimer !== null) clearInterval(this.prompterTimer);
      this.prompterTimer = null;
    } else if (this.prompterTimer === null) {
      this.prompterTimer = setInterval(() => {
        this.prompters.tick();
        this.prompterClock();
      }, 200);
      this.prompterTimer.unref?.();
    }
  }

  /** Is this the scene that hands over to him, with him still to come? */
  private handoverDue(scene: SceneDraft): boolean {
    return this.sim !== null && scene.sections.at(-1)?.title === HANDOVER_BEAT && worldString(this.sim.world.peek("Night.trabolta_introduced")) !== "true";
  }

  /** Her last line is his cue: the arrow past it, or her ✓ Done, is 🤖, on the
   *  path a host's press takes. Once: a press of 🤖 first leaves nothing to do
   *  and nothing said, and 🤖 after it reads *already online*, which is true.
   *  Paused doors hold it: false, so her next move asks again, and a ✓ Done
   *  that took the scene with it goes when they reopen (`openDoors`). */
  private sceneFinished(scene: SceneDraft, closed: boolean): boolean {
    if (!this.handoverDue(scene)) return true;
    if (this.phase !== "open") {
      this.handoverOwed ||= closed;
      return false;
    }
    this.deskFire(HANDOVER_CUE, PROMPTER_BY);
    return true;
  }

  private prompterName(who: string): string {
    return who.startsWith("@") ? who.slice(1) : (this.sim?.persons.get(who)?.name ?? "A program");
  }

  /** Is a line of `from` a screen's to say, and who else says theirs? */
  private prompterScene(appended: readonly ChatMessage[]): ReturnType<typeof sceneOf> {
    const sim = this.sim;
    if (sim === null) return null;
    return sceneOf(appended, {
      voiced: (from) => sim.model.characters.get(from)?.mind === "external",
      ownerOf: (from) => {
        for (const p of sim.persons.values()) if (p.name === from) return p.id;
        return sim.model.characters.has(from) ? `@${from}` : null;
      },
    });
  }

  /** Who a phone is in a scene, from its token. */
  private prompterCaller(token: string | undefined): { who: string; host: boolean } | null {
    const character = this.characterOf(token);
    if (character) return { who: `@${character}`, host: this.canHostToken(token) };
    const guest = this.guestOf(token);
    return guest !== null ? { who: guest, host: false } : null;
  }

  private phoneAnnounce(frame: { text: string; at: number } | { stop: true }): void {
    for (const c of this.clients) if (c.role !== "mod") sseSend(c.res, "announce", frame);
  }

  /** Wave 53: did this part answer the upload's inbox card? (The story's
   *  `inbox` slot, `given` or `skipped`; the address is never in the story.) */
  private boothInboxAsked(character: string): boolean {
    const v = this.sim?.world.peek(`${character}.inbox`);
    return v !== undefined && v !== null && v.kind === "string" && (v.value === "given" || v.value === "skipped");
  }

  private fanout(events: SimEvent[], via?: string): ChatMessage[] {
    if (this.agents.judging.length > 0) this.dropMootRulings();
    for (const [menu, channel] of menuChannelsFor(events, this.lastSpeakers)) this.menuChannels.set(menu, channel);
    for (const e of events) {
      if (e.type === "respond") {
        // The alert `!` stripped, as the Inbox row has it (`alert` says it was there).
        const { text, alert, big } = readoutText(e.text);
        // C1: a `reply !!…` says so on the booth's response frame too.
        this.toPrime(e.to, "response", { text, ...(alert ? { alert: true } : {}), ...(big === true ? { big: true } : {}) });
        // A locked booth still hears it (the door alarm, the late list).
        this.push.notify(boothOwner(e.to), readoutPush(e.to, text), false);
      }
      if (e.type === "choicePrompted" && e.person !== null) {
        this.decisionChannels.set(e.person, decisionChannelFor(events, e.person));
      }
      // Wave 53 (C5): what the house speakers say, each phone that opted in says too.
      if (e.type === "directive" && e.verb === ANNOUNCE_VERB) {
        const text = announceTextOf(e.args);
        if (text !== null) this.phoneAnnounce({ text, at: Date.now() });
      }
      // Mods (the editor's Run mode) also get the raw sim feed, so the
      // story-graph overlay lights beats up as they fire and a future
      // in-editor simulator can mirror the whole run.
      for (const c of this.clients) if (c.role === "mod") sseSend(c.res, "sim", e);
    }
    const post = (drafts: DraftMessage[]) => {
      const got = this.chat.append(drafts);
      for (const m of got) this.deliverMessage(m);
      return got;
    };
    const compose = (batch: SimEvent[]) => {
      const drafts = composeGuestMessages(this.sim ?? EMPTY_SIM, batch, this.composeOpts);
      // A director speaking *as* a participant: the room sees the participant's
      // name, the mod feed additionally sees who really typed it.
      if (via !== undefined) for (const d of drafts) if (d.kind === "line") d.via = via;
      return post(drafts);
    };
    // Wave 18b: the crew lines each commit drafted go right after that
    // commit's events (a replay appends them after its journal line), so
    // the events are composed in runs that end at such a commit.
    if (this.crewHead.length > 0) {
      const head = this.crewHead;
      this.crewHead = [];
      post(head);
    }
    const appended: ChatMessage[] = [];
    let from = 0;
    if (this.crewAfter.size > 0) {
      for (let i = 0; i < events.length; i++) {
        const crew = this.crewAfter.get(events[i]!);
        if (crew === undefined) continue;
        this.crewAfter.delete(events[i]!);
        appended.push(...compose(events.slice(from, i + 1)));
        post(crew);
        from = i + 1;
      }
    }
    appended.push(...compose(from === 0 ? events : events.slice(from)));
    // Wave 55: a phone in a pocket hears its script is waiting.
    for (const reader of aloudSpeakers(appended)) {
      const title = appended.find((m) => m.aloud?.reader === reader)?.beat ?? "Your script";
      this.push.notify(reader.startsWith("@") ? boothOwner(reader.slice(1)) : guestOwner(reader), aloudPush(title), false);
    }
    // Wave 59: the beat's prompter goes live, and his lines wait for it. A
    // line of someone who isn't reading is theirs: a card, and a push.
    const scene = this.prompterScene(appended);
    if (scene !== null) {
      this.prompters.land(scene);
      this.prompterClock();
      const title = scene.sections[0]?.title ?? "Your line";
      for (const who of scene.owners) this.push.notify(who.startsWith("@") ? boothOwner(who.slice(1)) : guestOwner(who), aloudLinePush(title), false);
    } else this.prompters.outrun(appended, (from) => this.sim?.model.characters.get(from)?.mind === "external");
    // A commit whose events never reached a fanout: its lines go now.
    for (const crew of this.crewAfter.values()) post(crew);
    this.crewAfter.clear();
    this.commitTail = null;
    if (this.crewAnswered && this.sim !== null) {
      this.crewAnswered = false;
      for (const k of answeredInviteCards(this.chat.all(), this.sim.crews)) this.answeredWidgets.add(k);
    }
    for (const id of [...this.decisionChannels.keys()]) {
      if (this.sim?.pendingChoiceFor(id) == null) this.decisionChannels.delete(id);
    }
    this.pruneMenuChannels();
    // Wave 18b: a `when` picture whose condition moved (the snapshots below carry it).
    this.syncConditionalAvatars();
    this.pushSnapshots();
    this.deskCues(events);
    this.lightCues(events);
    this.runPicks(events);
    // Wave 59: only a person knows when she has said the last line from the
    // sheet, so the hosts hear, once this batch has gone.
    if (this.handoverCut) {
      this.handoverCut = false;
      this.postHostsNote(HANDOVER_CUT_NOTE);
    }
    return appended;
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
    // Asking (out with the worker) or — wave 18b — still in the judge queue.
    const asking = new Map(this.agents.judging.map((j) => [`${j.filing.person}\u0000${j.filing.question}`, this.agents.judgeQueued(j.id)]));
    if (asking.size === 0) return view;
    return {
      ...view,
      questions: view.questions.map((q) => ({
        ...q,
        filings: q.filings.map((f) => {
          const queued = asking.get(`${f.person}\u0000${f.question}`);
          return queued === undefined ? f : { ...f, asking: true as const, ...(queued ? { queued: true as const } : {}) };
        }),
      })),
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
    const audio = this.audio.project;
    const lights = this.lights.project;
    const desk = this.desk.project;
    return { ...maps, ...(this.projectFacts !== null ? { [FACTS_FILE]: this.projectFacts } : {}), ...(audio !== null ? { [AUDIO_FILE]: audio } : {}), ...(lights !== null ? { [LIGHTS_FILE]: lights } : {}), ...(desk !== null ? { [DESK_FILE]: desk } : {}) };
  }

  /** A reload's fresh snapshot of the project's `audio.json` (`events-api.ts`,
   *  `/api/mod/load {audio}`); a director's save still wins over it. */
  setProjectAudio(text: string | null): void {
    this.audio.setProjectText(text);
  }

  /** What the audio routes read off this event (`audio.ts`). */
  private audioContext(): AudioContext {
    return {
      house: () => this.spatialHouse(),
      model: () => this.sim?.model ?? this.declaredModel,
      dj: () => (this.sim !== null ? musicDjOf(this.sim.worldEntries(), [...this.sim.persons.values()]) : null),
    };
  }

  /** A reload's fresh snapshot of the project's `lights.json` (`events-api.ts`,
   *  `/api/mod/load {lights}`); a director's save still wins over it. */
  setProjectLights(text: string | null): void {
    this.lights.setProjectText(text);
  }

  /** What the lights routes read off this event (`lights.ts`). */
  private lightsContext(): LightsContext {
    return { house: () => this.spatialHouse(), model: () => this.sim?.model ?? this.declaredModel };
  }

  /** (wave 25) The desk's recent activity hears the routes' tests and plays;
   *  the router's ack fills each one's result. */
  private noteDeskAudio(path: string, res: ServerResponse, by: string): void {
    if (res.statusCode !== 200) return;
    if (path === "/api/mod/audio/test") {
      const t = this.audio.tests().at(-1);
      if (t !== undefined) this.desk.note({ kind: "test", text: t.speaker !== null ? `🔊 test speaker ${t.speaker}` : `🔊 test out ${t.out ?? "?"}`, by, ack: { kind: "test", seq: t.seq } });
    } else if (path === "/api/mod/audio/play") {
      const p = this.audio.plays().at(-1);
      if (p !== undefined) this.desk.note({ kind: p.sound !== undefined ? "play" : "say", text: p.sound !== undefined ? `🔊 ${p.sound}${p.to !== null ? ` → ${p.to.join(", ")}` : ""}` : `📢 “${p.say ?? ""}”`, by, ack: { kind: "play", seq: p.seq } });
    } else if (path === "/api/mod/audio/stop") {
      this.desk.note({ kind: "stop", text: "■ stop the house sounds", by });
    }
  }

  /** A reload's fresh snapshot of the project's `desk.json` (`events-api.ts`,
   *  `/api/mod/load {desk}`); a director's save still wins over it. */
  setProjectDesk(text: string | null): void {
    this.desk.setProjectText(text);
  }

  /** What the desk routes read off this event (`desk.ts`): the house built
   *  from the audio and lights in force, the map, the story, the router's
   *  last report and the lights module's devices. */
  private deskContext(): DeskContext {
    const house = () => {
      const devices = this.lights.devices();
      const model = this.sim?.model ?? this.declaredModel;
      return deskHouseOf({
        audio: this.audio.current().audio,
        router: this.audio.router(),
        health: this.audio.health(),
        lights: this.lights.current().lights,
        module: this.lights.module(),
        devices: devices.devices,
        devicesAt: devices.devicesAt,
        pair: this.lights.currentPair(),
        house: this.spatialHouse(),
        model,
        workers: this.agents.workerList(),
        now: this.clock(),
      });
    };
    return {
      house,
      refs: (desk) => deskRefsOf(house(), this.sim?.model ?? this.declaredModel, lightStateProblems, desk),
      // A live event (never a rehearsal: setup days test freely) whose doors
      // are open (this run's entry played) and whose night hasn't ended.
      live: () => !this.isPreview() && this.sim !== null && this.entryPlayed && !this.nightEnded(),
    };
  }

  /**
   * (wave 25) A desk `event` step or a cue's `done`: the story event as a
   * journaled signal whose `by` is `House desk` — exactly the path a door
   * sensor's `door_sensor_opened` takes through `/api/mod/signal` (a device
   * signal, labelled), so `when <event>:` rules run and a replay re-derives
   * the same story from the journal. A replay never reaches here: only a
   * live run fires. `refused`: an INTERACTION the story turned down.
   */
  private deskFire(event: string, by: string = DESK_BY): "fired" | "refused" | "no story" {
    if (this.sim === null) return "no story";
    const actingBy = this.actingBy;
    this.actingBy = by;
    try {
      const out = this.commit("signal", event, undefined, null, null);
      const name = foldName(event);
      const isCue = [...this.sim.model.interactions.values()].some((i) => foldName(i.id) === name);
      const refused = isCue && pressRefused(this.sim, out);
      this.fanout(out);
      return refused ? "refused" : "fired";
    } finally {
      this.actingBy = actingBy;
    }
  }

  /** (wave 25) A live batch's `cue X` directives that name a desk cue start
   *  it (`DeskHub.storyCue`, next turn). Called from `fanout` only — never
   *  from `restore`, so a journal replay plays nothing on the house. */
  private deskCues(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type !== "directive" || e.verb !== "cue") continue;
      const id = e.args.trim().split(/[\s,]+/u)[0] ?? "";
      if (id !== "" && this.desk.hasCue(id)) this.desk.storyCue(id);
    }
  }

  /** (wave 39) A live batch's `cue X` naming a look plays it into the
   *  lights estimate (the games' `lights` frame). Called from `fanout`
   *  only — never on a journal replay. */
  private lightCues(events: readonly SimEvent[]): void {
    let played = false;
    for (const e of events) {
      if (e.type !== "directive" || e.verb !== "cue") continue;
      const id = e.args.trim().split(/[\s,]+/u)[0] ?? "";
      if (id === "") continue;
      const lights = this.lights.config();
      if (!Object.prototype.hasOwnProperty.call(lights.looks, id)) continue;
      if (this.estimate().playLook(lights, this.spatialHouse(), id, this.clock())) played = true;
    }
    if (played) this.gameLights.changed();
  }

  /** (wave 39) The lights estimate, its `boot` look played on first use. */
  private estimate(): LightsEstimate {
    if (!this.lightsBooted) {
      this.lightsBooted = true;
      // Started at 0: long settled. (No clock read here: a fake clock that
      // counts its reads must not see a new one.)
      this.lightsEstimate.boot(this.lights.config(), this.spatialHouse(), 0);
    }
    return this.lightsEstimate;
  }

  /** (wave 39) A lights test into the estimate; an identify is ignored. */
  private estimateTest(t: LightTest): void {
    const lights = this.lights.config();
    if (t.look !== undefined) this.estimate().playLook(lights, this.spatialHouse(), t.look, t.at);
    else if (t.fixture !== undefined && t.set !== undefined) this.estimate().set(lights, t.fixture, t.set, t.at);
  }

  /** (wave 39) The spatial stream's `lights` frame as it stands now. */
  private gameLightsFrame(): GameLights {
    const now = this.clock();
    return buildGameLights({
      lights: this.lights.config(),
      house: this.spatial.house,
      source: this.lights.gameSource(),
      reported: this.lights.shown()?.fixtures ?? null,
      estimate: this.estimate(),
      pulsed: this.lights.pulsedIds(),
      now,
    });
  }

  /**
   * The judge hop: a `fact` card is judged on the client's {question, answer,
   * confidence}, an `answer` card on the card's own `question` param (never
   * the client's) and {text}. Null = nothing to judge (no key in force, an
   * un-keyed card, another kind); "refused" = a bad filing (400). A `fact`
   * filing for a question the key lacks is refused only while a key exists;
   * without one the args pass untouched (other projects). `review`: the
   * filing takes the review path (`commitUnderReview`) while the mode is
   * `auto` — a near miss always (wave 11), and (wave 18b, O4) any filing
   * that is not an exact match when the `judge:` character can rule now
   * (`ruler`); `near` = the key form it is close to.
   */
  private judgeWidget(card: NonNullable<ChatMessage["widget"]>, args: Record<string, string | number | boolean>): { args: Record<string, string | number>; review: boolean; near: string | null; ruler: string | null; verdict: FactVerdict | null } | null | "refused" {
    const book = this.factsBook();
    if (book === null) return null;
    if (card.kind === "fact") {
      const q = args["question"];
      const a = args["answer"];
      const c = args["confidence"];
      if (typeof q !== "string" || typeof a !== "string" || a.trim() === "" || typeof c !== "number" || !Number.isInteger(c) || c < 1 || c > 100) return "refused";
      // A key still owed judges nobody (wave 58): no verdict, so the story
      // says it could not be judged and records nothing.
      if (isPlaceholderKey(book, q)) return null;
      // A near miss (`Mr Pickels`) is proposed accurate, never a lie or a
      // guess by itself: a director decides it (wave 11, C6).
      const judged = judgeFiling(book, q, a, c);
      if (judged === null) return "refused";
      const { verdict } = judged;
      // An accurate filing also carries the key's canonical answer, so the
      // story reads "Mister Pickles", never whichever alias came in last.
      // Only a filer who already knew it (or all but typed it) ever puts it
      // in the journal.
      const auto = judgeMode(book, worldReader(this.sim!)) === "auto";
      const ruler = auto && judged.ask ? this.rulerOnline() : null;
      return {
        args: verdict === "accurate" ? { verdict, key_answer: factsKey(book, q)!.answer } : { verdict },
        review: auto && (judged.near !== null || ruler !== null),
        near: judged.near,
        ruler,
        verdict,
      };
    }
    if (card.kind === "answer") {
      const q = card.params["question"];
      const t = args["text"];
      if (q === undefined) return null;
      if (typeof t !== "string" || t.trim() === "") return "refused";
      const verdict = judgeAnswer(book, q, t, 100);
      return verdict === null ? "refused" : { args: { verdict, question: q }, review: false, near: null, ruler: null, verdict };
    }
    return null;
  }

  /** Wave 18b, faction mode (D13 e): why `person` may not take `side` by
   *  `/api/guest/join` or `/defect` — a live founder stays with their
   *  faction, a side's leader with that side — or null. */
  private staysWithSide(person: string, side: string): string | null {
    const crews = this.sim!.crews;
    if (!crews.factionMode) return null;
    if (crews.foundedBy(person) !== null) return "Founders stay with their faction. Disband it first.";
    const led = crews.ledSide(person);
    return led !== null && led !== side ? "Leaders stay with their side." : null;
  }

  /**
   * Commit `apply` (a 📝 near-miss filing) as if the judging mode were
   * `review`: the book's mode var is set to `review` just before and put
   * back just after, each a journaled `setVar` by the judge — so the story's
   * own review path holds the filing pending for a director (Run → Mind →
   * Judging, one `# hosts` line from the story), and a replay lands the same.
   * `notice`: the server's own `# hosts` line after the story's, saying the
   * proposal came from the near-miss rule, not an exact match (the story's
   * line only reads "Proposed: accurate"); a function is called once the
   * mode is back (it may ask for a ruling first, so the line says what
   * happened).
   */
  private commitUnderReview(apply: () => SimEvent[], notice: string | null | (() => string | null) = null): SimEvent[] {
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
    const text = typeof notice === "function" ? notice() : notice;
    const room = text === null ? null : hostsRoomOf(sim.model);
    const told = room === null || text === null ? [] : this.commit("broadcast", `channel(${room})`, text);
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
   * Ask the `judge:` character to rule on `person`'s pending filing for
   * `question` — a near miss, or (wave 18b, O4) any other filing that is
   * not an exact match — never while one for it is queued or out (wave
   * 18b: a ruling that expired, was cancelled or answered leaves no mark,
   * so the same answer filed again is asked again). True when the ruling
   * joined the hub's judge queue.
   */
  private askRuling(person: string, question: string): boolean {
    const judge = this.rulerOnline();
    const book = this.factsBook();
    if (judge === null || book === null) return false;
    const f = this.filingOf(person, question);
    if (f === null || f.final !== null) return false;
    const key = factsKey(book, question);
    if (key === null || isExact(book, question, f.answer)) return false;
    const near = this.factsWatch.nearOf(book, question, f.answer);
    const asked = `${person}\u0000${question}\u0000${f.answer}`;
    if (this.agents.judging.some((j) => j.filing.person === person && j.filing.question === question)) return false;
    const id = this.agents.judge({
      character: judge,
      filing: { id: `${person}:${question}`, person, name: f.name, question },
      question: { id: key.id, text: key.text },
      key: { answer: key.answer, aliases: key.forms.slice(1) },
      answer: f.answer,
      confidence: f.confidence,
      near,
    });
    if (id === null) return false;
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
      if (f.final !== null || isExact(book, f.question, f.answer)) {
        this.rulingsDue.delete(due);
        continue;
      }
      this.askRuling(f.person, f.question);
    }
  }

  /** After a restore: the filings still pending that are not an exact
   *  match (near misses, and — wave 18b — plain misses held for a ruling),
   *  due a ruling. */
  private noteRulingsDue(): void {
    this.rulingsDue.clear();
    const book = this.factsBook();
    if (book === null || this.sim === null || this.sim.model.judge === null) return;
    for (const f of this.factsWatch.all(this.sim, book.confirm)) {
      if (f.final !== null || isExact(book, f.question, f.answer)) continue;
      this.rulingsDue.add(`${f.person}\u0000${f.question}\u0000${f.answer}`);
    }
  }

  /** A ruling whose filing moved on — judged (a director first, a round's
   *  settle) or filed again with another answer — is cancelled, so its
   *  late answer gets a 410. */
  private dropMootRulings(): void {
    // One ledger read for the whole queue (wave 18b: a round's worth of
    // rulings can wait here, and this runs on every fanout).
    const book = this.factsBook();
    const filings = new Map<string, { final: unknown; answer: string }>();
    if (book !== null && this.sim !== null) for (const f of this.factsWatch.all(this.sim, book.confirm)) filings.set(`${f.person}\u0000${f.question}`, f);
    for (const j of this.agents.judging) {
      const f = filings.get(`${j.filing.person}\u0000${j.filing.question}`);
      if (f === undefined || f.final !== null || f.answer !== j.answer) this.agents.cancelJudge(j.id);
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
    // Wave 32 (C4): the public talk thread only while a talk scene is on and
    // he is awake (else his `unavailable` line would go to the whole room).
    if (thread.public === true) return sim !== null && this.talkSceneNow() !== null && this.talkAwake(thread.character);
    const who = thread.audience[0];
    if (sim === null || who === undefined || who.startsWith("@")) return true;
    const def = sim.model.characters.get(thread.character);
    return def === undefined || !def.hidden || sim.isRevealedTo(def.id, who);
  }

  // -- wave 32: the talk scenes (contract C3–C5) ----------------------------

  /** The talk scene `Night.talk` names now, or null (none on). */
  private talkSceneNow(): TalkScene | null {
    const sim = this.sim;
    if (sim === null) return null;
    return talkScene(this.talkNight(), this.talkScenes);
  }

  /** `Night.talk` now ("none" / unset → null). */
  private talkNight(): string | null {
    const v = this.sim === null ? null : worldString(this.sim.world.peek(TALK_NIGHT_PATH));
    const t = v === null ? "" : v.replace(/^"(.*)"$/su, "$1").trim();
    return t === "" || t === "none" ? null : t;
  }

  /** `<character>.awake` is true. */
  private talkAwake(character: string = TALK_AGENT): boolean {
    const v = this.sim?.world.peek(`${character}.awake`) ?? null;
    return v !== null && (v.kind === "bool" ? v.value : v.kind === "string" && v.value.trim() === "true");
  }

  /** Awake in the body the worker answered, asleep now (wave 58). Never "asleep
   *  now" alone: a worker's closed gate answers through the same route with the
   *  `unavailable` and distress lines, and a character with no `awake` has no gate. */
  private asleepSinceAsked(req: AgentRequest): boolean {
    return req.self.vars["awake"] === "true" && !this.talkAwake(req.character);
  }

  /** The public talk thread (C4): Trabolta answering Clippy aloud in the Desktop. */
  private talkThread(): AgentThread {
    return { character: TALK_AGENT, channel: `loc:${TALK_ROOM}`, audience: [`@${TALK_AS}`], public: true };
  }

  /** A public talk request asked in a scene that is no longer on (or in
   *  none): its answer would be dropped (410), so nothing waits on it. */
  private talkStale(req: AgentRequest): boolean {
    return req.thread.public === true && (req.stage === undefined || this.talkNight() !== req.stage.scene);
  }

  /** The talk panel's block (C5) for a host's view, a host booth's and the
   *  director's: null when no talk scene is on. Read now, never cached.
   *  Only a request owed in *this* scene reads as thinking: one still owed
   *  from an earlier scene is the late path's (410), not the new card's. */
  private talkViewNow(): TalkView | null {
    if (this.sim === null) return null;
    const open = this.agents.openOn(this.talkThread());
    const owed = open !== null && !this.talkStale(open.req) ? open : null;
    return talkView(this.talkNight(), { thinking: owed !== null, since: owed?.since ?? null, online: this.agents.isOnline(TALK_AGENT), awake: this.talkAwake() }, this.talkScenes);
  }

  /** The ticker's belt (C4): a public request still open from a scene that
   *  closed is settled as answered by hand — dropped if queued, cancelled on
   *  its worker if in flight — so it holds no worker's slot, draws no hold
   *  note and never reads as thinking. An in-flight one tells the hosts
   *  once (`TALK_DROPPED_NOTE`): his answer was on its way and is dropped.
   *  Its worker's late reply (if the cancel loses the race) then finds no
   *  open request: a plain 410, no second note. */
  private closeStaleTalk(): void {
    const thread = this.talkThread();
    const open = this.agents.openOn(thread);
    if (open === null || !this.talkStale(open.req)) return;
    this.agents.answeredByHand(thread);
    if (open.inFlight) this.postHostsNote(TALK_DROPPED_NOTE);
  }

  /** One line in the story's staff room (`# hosts`); nothing without one. */
  private postHostsNote(text: string): void {
    const sim = this.sim;
    const room = sim === null ? null : hostsRoomOf(sim.model);
    if (room === null) return;
    this.fanout(this.commit("broadcast", `channel(${room})`, text));
  }

  // -- wave 59: the Task Manager costume (`costume.ts`, `src/costume.ts`) ----

  /** The costume's one credential. Never logged, never in a view but Run's. */
  private costumeToken(): string {
    return secretCode(this.claimSecret, COSTUME_TOKEN_LABEL);
  }

  /** What the night is doing, for a press. Read now, never cached. */
  private costumeFacts(): CostumeFacts {
    const sim = this.sim;
    const word = (path: string): string | null => {
      const v = sim === null ? null : worldString(sim.world.peek(path));
      const t = v === null ? "" : v.replace(/^"(.*)"$/su, "$1").trim();
      return t === "" || t === "none" ? null : t;
    };
    const num = (path: string): number | null => {
      const n = Number(word(path));
      return word(path) === null || !Number.isFinite(n) ? null : n;
    };
    const storyMs = sim?.elapsed() ?? 0;
    const nowS = storyMs / 1000;
    const recent = this.chat.all().filter((m) => !m.hidden && storyMs - m.ts < COSTUME_LOOKBACK_MS);
    const tvTalking = this.screens.seen().some((p) => p.view === "tv" && p.talk === true && this.screens.clock() - p.at <= SPEECH_ONLINE_MS);
    const burst = num("Night.burst_last");
    return {
      doors: sim !== null && this.phase === "open" && this.entryPlayed,
      ended: word("Night.ended") === "true",
      ceremony: word("Night.ceremony") === "true",
      step: num("Night.step"),
      speaking: tvTalking || saidBy(recent.filter((m) => m.channel === `loc:${TALK_ROOM}` && m.kind === "line" && typeof m.beat === "string"), STAGE_CHARS_PER_S) > storyMs,
      prompter: this.prompters.inUse,
      lights: word("Night.lights"),
      alarm: word("Night.alarm_on") === "true",
      roomOut: (num("Night.lights_back_at") ?? 0) > 0,
      darkRoom: word("Night.dark_room"),
      lightsOnline: this.lights.module()?.online === true,
      routerOnline: this.audio.router().online,
      musicHand: this.audio.musicHand(),
      talk: this.talkNight(),
      hijackPlaying: hijackPlaying(word("Night.glitch_kind"), num("Night.glitch_at"), nowS),
      sinceBurstS: burst !== null && burst > 0 ? nowS - burst : null,
      awake: this.talkAwake(),
      owed: this.agents.openOn(this.talkThread()) !== null,
    };
  }

  /** One action, through the path the house already has for it. */
  private costumePerform(a: CostumeAction, file: CostumeFile): boolean {
    const lights = this.lights.current().lights;
    switch (a.kind) {
      case "look":
        if (!costumeLookSafe(lights, this.spatialHouse(), a.look)) return false;
        this.lights.test({ look: a.look }, COSTUME_BY);
        return true;
      case "light": {
        const fixtures = costumeFixtures(lights, this.spatialHouse(), a.to);
        if (fixtures.length === 0 || lightStateProblems("set", a.set).length > 0 || !lightStateDoes(a.set as LightState)) return false;
        for (const fixture of fixtures) this.lights.test({ fixture, set: a.set as LightState }, COSTUME_BY);
        return true;
      }
      case "sound": {
        const play = audioPlayOf({ sound: a.sound, ...(a.to !== undefined ? { to: a.to } : {}) });
        if (typeof play === "string") return false;
        this.audio.play(play, COSTUME_BY);
        return true;
      }
      case "music":
        this.audio.music(a.command, COSTUME_BY);
        return true;
      case "cue":
        return this.deskFire(costumeCue(a.cue, this.costumeFacts()), COSTUME_BY) === "fired";
      case "poke": {
        // The canned Trabolta line's path (`modTalk`): nothing is owed here,
        // the press was refused if it was.
        const line = file.poke[this.costumePokes++ % file.poke.length]!;
        const actingBy = this.actingBy;
        this.actingBy = COSTUME_BY;
        try {
          this.fanout(this.commit("say", TALK_AGENT, `loc:${TALK_ROOM}`, line, null, "all", null));
        } finally {
          this.actingBy = actingBy;
        }
        return true;
      }
    }
  }

  /** The mod log's line: a journaled signal no story hook hears, so a fire is
   *  on the ledger whatever it did, and never in `# hosts`. */
  private costumeNote(item: CostumeItem): void {
    process.stdout.write(`  🎭 costume: ${item.label}\n`);
    const actingBy = this.actingBy;
    this.actingBy = COSTUME_BY;
    try {
      this.fanout(this.commit("signal", COSTUME_SIGNAL, item.label, null, null));
    } finally {
      this.actingBy = actingBy;
    }
  }

  /** The story's look again (the lights module's catch-up names it the same
   *  way), or the plain house when the story has none to give back. If he
   *  put a room out during the hold, only what the press moved goes back. */
  private costumeRestoreLights(a: Extract<CostumeAction, { kind: "look" | "light" }>): void {
    const lights = this.lights.current().lights;
    const looks = lights.looks ?? {};
    const facts = this.costumeFacts();
    const look = facts.lights === "server_open" ? "lights_y2k" : `lights_${facts.lights ?? "restore"}`;
    const usable = Object.prototype.hasOwnProperty.call(looks, look) && looks[look]?.then !== "restore";
    const back = usable ? look : "lights_restore";
    if (!facts.roomOut) {
      this.lights.test({ look: back }, COSTUME_BY);
      return;
    }
    const house = this.spatialHouse();
    for (const t of costumeRoomOutRestore(lights, house, back, costumeMoved(lights, house, a), facts.darkRoom)) this.lights.test(t, COSTUME_BY);
  }

  /** The link Run hands the crew. It holds the token: only Run reads it. */
  private costumeLink(): string {
    return `${this.joinBase()}/costume?e=${encodeURIComponent(this.eventId)}&k=${this.costumeToken()}`;
  }

  /** The two routes the token opens. Nothing else accepts it. */
  private async handleCostume(req: IncomingMessage, res: ServerResponse, path: string, body: Record<string, unknown>): Promise<boolean> {
    if (!codeEquals(normalizeCode(str(body, "k")), this.costumeToken())) {
      if (this.throttled(req, res)) return true;
      this.loginFailures.record(ipOf(req));
      sendJson(res, 401, { ok: false, why: "token" });
      return true;
    }
    const on = !this.store.loadCostumeOff();
    if (path === COSTUME_MENU_ROUTE) await sendCostumeMenu(res, this.costumeSource, on);
    else await sendCostumeFire(res, this.costumeSource, this.costume, on, str(body, "id"));
    return true;
  }

  /**
   * `POST /api/mod/talk {as, text, direction?}` (C3): a host speaks for
   * Clippy in the Desktop (and Trabolta answers through the public thread),
   * or fires one of Trabolta's canned lines. Both are journaled `say`s with
   * audience "all", `by` the host.
   */
  private modTalk(res: ServerResponse, body: Record<string, unknown>): void {
    const sim = this.sim;
    if (sim === null) {
      sendJson(res, 409, { error: "no scenario loaded" });
      return;
    }
    const post = readTalkPost(body);
    if ("error" in post) {
      sendJson(res, 400, { error: post.error });
      return;
    }
    if (this.talkSceneNow() === null) {
      sendJson(res, 409, { error: "no_talk" });
      return;
    }
    if (!this.talkAwake()) {
      sendJson(res, 409, { error: "asleep" });
      return;
    }
    if (this.phase !== "open") {
      sendJson(res, 409, { error: "closed" });
      return;
    }
    const thread = this.talkThread();
    const seqOf = (out: ChatMessage[]): number | null => out.find((m) => m.channel === thread.channel && m.from === post.as)?.seq ?? null;
    if (post.as === TALK_AGENT) {
      // A canned line of his: it answers whatever is owed, by hand.
      const open = this.agents.openOn(thread);
      const seq = seqOf(this.fanout(this.commit("say", TALK_AGENT, thread.channel, post.text, null, "all", open === null ? null : answeredSeq(open.req))));
      this.agents.answeredByHand(thread);
      sendJson(res, 200, { ok: true, seq });
      return;
    }
    this.talkDirection = post.direction === undefined ? null : { scene: this.talkNight(), text: post.direction };
    const seq = seqOf(this.fanout(this.commit("say", TALK_AS, thread.channel, post.text, null, "all")));
    // A request still owed from an earlier scene would be dropped on its
    // answer (410) and take this line's follow-up with it: close it first.
    this.closeStaleTalk();
    this.agents.line(thread);
    sendJson(res, 200, { ok: true, seq, asked: this.agents.openOn(thread) !== null, online: this.agents.isOnline(TALK_AGENT) });
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
   * lobby (unless the story hides it: `lobby: hidden`, 404), `dm:` (resolved above), `pm:` (`canPost` checks the two
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
    const none = { status: 404 as const, error: "no such room" };
    // Wave 18b (D18): `lobby: hidden` lists the lobby on no guest's phone,
    // so a guest can't post into it either (a booth and Run still do).
    if (channel === "lobby") return sim.model.lobbyHidden ? none : null;
    if (channel.startsWith("dm:") || channel.startsWith("pm:") || isPinnedRoom(channel)) return null;
    if (channel.startsWith("faction:")) {
      const group = channel.slice("faction:".length);
      const def = sim.model.factions.get(group);
      if (def === undefined) return none;
      if (def.hidden && !sim.factionRevealed(def.id)) return none;
      return sim.factionMembers(group).includes(guestId) ? null : { status: 403, error: "you can't post here" };
    }
    if (channel.startsWith("loc:") || isCrewRoom(channel)) return sim.canSeeChannel(guestId, channel) ? null : none; // w18 crews: + crew rooms
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
  private agentHeard(channel: string, audience: string[], held = false, since?: number, seq?: number): void {
    if (!channel.startsWith("dm:") || audience.length !== 1) return;
    const character = channel.slice("dm:".length);
    if (!this.isAgent(character)) return;
    const thread: AgentThread = { character, channel, audience };
    this.agents.line(thread, { held, ...(since !== undefined ? { since } : {}) });
    // Recheck item 4: a new request remembers the line that opened it, and
    // its wait is written down, so a restart reads the same "waiting 0:34".
    const key = threadKey(thread);
    const open = this.agents.pending.find((r) => threadKey(r.thread) === key);
    if (open !== undefined && this.agentWaitSeq.get(key)?.id !== open.id) {
      const at = seq ?? this.lastLineSeq(channel, audience[0]!);
      if (at !== null) this.agentWaitSeq.set(key, { id: open.id, seq: at });
    }
    this.persistAgentWaits();
  }

  /** The newest line in `channel` addressed to exactly `who` (its seq). */
  private lastLineSeq(channel: string, who: string): number | null {
    const all = this.chat.all();
    for (let i = all.length - 1; i >= 0; i--) {
      const m = all[i]!;
      if (m.channel === channel && Array.isArray(m.audience) && m.audience.length === 1 && m.audience[0] === who) return m.seq;
    }
    return null;
  }

  /** Write every open agent request's wait (its opening line + the hub's
   *  `since`) and the pause stamp, for `requeueAgentThreads` after a restart. */
  private persistAgentWaits(): void {
    const waits: AgentWait[] = [];
    for (const r of this.agents.pending) {
      const key = threadKey(r.thread);
      const at = this.agentWaitSeq.get(key);
      const since = this.agents.sinceOf(r.id);
      if (at === undefined || at.id !== r.id || since === null) continue;
      waits.push({ key, seq: at.seq, since });
    }
    try {
      this.store.saveAgentWaits({ pausedAt: this.pausedAt, waits });
    } catch {
      // A full disk costs only the exact wait after a restart (the story
      // clock's estimate stands in).
    }
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
  private requeueAgentThreads(saved: AgentWaits | null = null): void {
    const sim = this.sim;
    if (sim === null) return;
    interface Tail {
      /** The newest line from someone else since the character's last real line. */
      owed: ChatMessage | null;
      /** The first of those lines: since when they have been waiting. */
      first: ChatMessage | null;
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
      let first = t?.first ?? null;
      let held = t?.held ?? false;
      // Recheck item 3: only a line the character *voiced* answers the
      // thread — a worker's reply or a director typing as him, as live (the
      // hub settles on `/api/agent/reply` / `answeredByHand`, whatever the
      // text). A line the story posted in his name ("Your fact for round 2
      // Q2 was not counted…", a scripted beat) is not him answering: it
      // carries its own `beat` key, which typed chat and a journaled `say`
      // never do. (Not `storyTag`'s text match: a reply that repeats a story
      // text was still him answering, and re-asking it answers twice.)
      if (m.from !== character) {
        // A story line from anyone else in the thread is not a guest asking.
        // Wave 28: a pick at a menu (`pick`) is the guest answering the
        // story, never a line owed his free reply.
        if (m.kind === "line" && !Object.hasOwn(m, "beat") && m.pick !== true) {
          owed = m;
          first ??= m;
        }
      } else if (def?.hold !== null && def?.hold !== undefined && m.text === def.hold) {
        if (owed !== null) held = true;
      } else if (!(def?.busy !== null && def?.busy !== undefined && m.text === def.busy) && !Object.hasOwn(m, "beat")) {
        owed = null;
        first = null;
        held = false;
      }
      tails.set(key, { owed, first, held, last: m });
    }
    const now = sim.elapsed();
    const wall = this.clock();
    for (const [key, { owed, first, held, last }] of tails) {
      if (owed === null || now - owed.ts > AGENT_QUEUE_MAX_AGE_MS) continue;
      // The guest has waited since their first unanswered line, not since
      // this restart: the wait written down live (recheck item 4: exact
      // across a pause and for two lines in one story second), else its
      // story time mapped onto the hub's wall clock.
      const kept = first === null ? undefined : saved?.waits.find((w) => w.key === key && w.seq >= first.seq && w.seq <= owed.seq);
      const since = kept !== undefined ? kept.since : first === null ? undefined : wall - Math.max(0, now - first.ts);
      this.agentHeard(last.channel, last.audience as string[], held, since, kept?.seq ?? first?.seq);
    }
  }

  /** No worker has picked up `req` in time: post the character's authored
   *  `hold:` line into the thread as an ordinary journaled say (the director
   *  can still answer as the character from Run). */
  private postAgentHold(req: AgentRequest): boolean {
    // Wave 32 (C4): never in the room — one `# hosts` line instead, and
    // only while its scene is still on (the hosts' card has moved on from
    // an old scene's request). It counts as heard either way.
    if (req.thread.public === true) {
      if (!this.talkStale(req)) this.postHostsNote(TALK_HOLD_NOTE);
      return true;
    }
    const line = this.sim?.model.characters.get(req.character)?.hold ?? null;
    if (line === null) return false;
    this.fanout(this.commit("say", req.character, req.thread.channel, line, null, req.thread.audience, answeredSeq(req)));
    return true;
  }

  /** `req` has waited behind a burst on a worker still answering: post the
   *  character's authored `busy:` line once in the thread — once ever, so a
   *  restart (which forgets the hub's own once-per-thread) never says it
   *  twice. */
  private postAgentBusy(req: AgentRequest): boolean {
    if (req.thread.public === true) return false; // wave 32 (C4): never in the room
    const line = this.sim?.model.characters.get(req.character)?.busy ?? null;
    if (line === null) return false;
    const who = req.thread.audience.join(",");
    const said = this.chat.all().some((m) => m.channel === req.thread.channel && m.from === req.character && m.text === line && Array.isArray(m.audience) && m.audience.join(",") === who);
    if (said) return false;
    this.fanout(this.commit("say", req.character, req.thread.channel, line, null, req.thread.audience, answeredSeq(req)));
    return true;
  }

  /** A worker stopped answering (its head waited 60 s): one line in the
   *  story's staff room (`# hosts`), so a director answers by hand. No staff
   *  room → nothing (Run still shows `agentQueue.stalled`). */
  /** Wave 18b: the `judge:` character's worker stopped ruling (two expiries
   *  in a row): one `# hosts` line; the queue waits, then falls back. */
  private postJudgeStall(): void {
    const sim = this.sim;
    const room = sim === null ? null : hostsRoomOf(sim.model);
    if (room === null || sim === null) return;
    this.fanout(this.commit("broadcast", `channel(${room})`, judgeStallNotice(sim.model.judge ?? "The judge")));
  }

  private postAgentStall(worker: { name: string; characters: string[] }, waiting: number): void {
    const sim = this.sim;
    const room = sim === null ? null : hostsRoomOf(sim.model);
    if (room === null) return;
    this.fanout(this.commit("broadcast", `channel(${room})`, agentStallNotice(worker, waiting)));
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
  private agentVarsOf(world: ReadonlyArray<{ path: string; value: string }>, o: { race?: boolean } = {}): (head: string) => Record<string, string> {
    const sim = this.sim!;
    const secretCodex = new Set([...sim.model.codex.values()].filter((e) => e.secret).map((e) => `codex.${Sim.codexSlug(e.id)}`));
    // `race` (the facts document, wave 18b D13 j): race sides too — the
    // document lists every program, so a side on each would count it. A
    // request keeps its speaker's own `group` (the mind courts its members).
    const hidden = (g: string) => this.agentHiddenGroup(g) || (o.race === true && this.agentHiddenRace(g));
    return (head: string): Record<string, string> => {
      const person = sim.persons.get(head);
      const secret = person === undefined ? null : (sim.model.roles.get(person.role)?.secret ?? null);
      // Wave 21 (C2): a character's `private:` slots never reach an agent.
      const ch = person === undefined ? sim.model.characters.get(head) : undefined;
      const out: Record<string, string> = {};
      for (const w of world) {
        if (!w.path.startsWith(`${head}.`)) continue;
        const key = w.path.slice(head.length + 1);
        if (secretCodex.has(key)) continue;
        if (isPrivateSlot(ch, key)) continue;
        if (key === "crew") continue; // w18 crews
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

  /** A world value as an agent's house-held text may read it (`recent`,
   *  the dossier): a character's `private:` slot reads as unset (wave 21, C2). */
  private agentPeek(path: string): string | null {
    const sim = this.sim!;
    const dot = path.indexOf(".");
    if (dot > 0 && isPrivateSlot(sim.model.characters.get(path.slice(0, dot)), path.slice(dot + 1))) return null;
    return worldString(sim.world.peek(path));
  }

  /** A `hidden: true` group the story has not revealed: an agent may not
   *  know it exists, let alone who is in it. */
  private agentHiddenGroup(group: string): boolean {
    if (isCrewId(group)) return true; // w18 crews: a guest-typed crew name never reaches an agent
    const sim = this.sim!;
    return (sim.model.factions.get(group)?.hidden ?? false) && !sim.factionRevealed(group);
  }

  /** Wave 18b (D13 j): in faction mode (`founding:`) every race side — a
   *  declared joinable group, revealed or not — is an agent's blind spot
   *  like a crew: its own world paths (`members`, `leader`) would let the
   *  worker count it and tell a founder the rival's number. Outside faction
   *  mode, false (requests unchanged). */
  private agentHiddenRace(group: string): boolean {
    const sim = this.sim!;
    if (!sim.crews.factionMode) return false;
    if (sim.crews.isRaceFaction(group)) return true;
    const want = foldName(group);
    for (const id of sim.model.factions.keys()) if (foldName(id) === want) return sim.crews.isRaceFaction(id);
    return false;
  }

  /** The world's globals as an agent may see them: every path whose head is
   *  neither a person nor a character, minus an unrevealed hidden group's
   *  own paths (`<Group>.members` would name its members) and, in faction
   *  mode, every race side's (`agentHiddenRace`). */
  private agentGlobals(world: ReadonlyArray<{ path: string; value: string }>): Record<string, string> {
    const sim = this.sim!;
    const globals: Record<string, string> = {};
    for (const w of world) {
      const head = w.path.split(".")[0]!;
      if (sim.persons.has(head) || sim.model.characters.has(head)) continue;
      if (this.agentHiddenGroup(head) || this.agentHiddenRace(head)) continue;
      globals[w.path] = w.value;
    }
    return globals;
  }

  /** Everything a worker needs to answer one thread, read from the live sim. */
  private buildAgentRequest(thread: AgentThread, id: string): AgentRequest | null {
    const sim = this.sim;
    if (sim === null) return null;
    if (thread.public === true) return this.buildTalkRequest(thread, id);
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
    const speakerDef = performer !== null ? sim.model.characters.get(performer) : undefined;
    return {
      id,
      character: thread.character,
      thread,
      speaker:
        performer !== null
          ? { kind: "performer", id: performer, name: performer, faction: sim.model.characters.get(performer)?.faction ?? null, ...(speakerDef?.player === true ? { player: true as const } : {}) }
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
        ...(speakerDef?.player === true ? { ranges: Object.fromEntries([...speakerDef.ranges].filter(([k]) => !isPrivateSlot(speakerDef, k))) } : {}),
        // Wave 58 (C5): a guest's one slot the voice may move, when the story names one.
        ...(performer === null && sim.model.warmth !== null ? { ranges: { [sim.model.warmth.slot]: [sim.model.warmth.min, sim.model.warmth.max] as [number, number] } } : {}),
      },
      world: globals,
      powers: this.agentPowers(),
      // The hub's clock (an injected one in tests), so its max-age check
      // and a pause's shift read the same time.
      at: this.clock(),
      ...(tag !== null ? this.agentRecentOf(thread, performer !== null ? "performer" : "guest", speakerId, speakerName, all, lines, tag) : {}),
      // Wave 20 (D26): the guest's night, only at his heart (else absent).
      ...(performer === null && agentDossierOn() ? this.agentDossierOf(thread, who, speakerName, all) : {}),
    };
  }

  /** `dossier` for one request (wave 20, D26): built only for a guest
   *  standing at his heart, from the sim log, the chat log, the world and
   *  the facts ledger, every time (never stored). */
  private agentDossierOf(thread: AgentThread, id: string, name: string, all: readonly ChatMessage[]): { dossier: AgentDossier } | Record<string, never> {
    const sim = this.sim!;
    const peek = (path: string) => this.agentPeek(path);
    const person = sim.persons.get(id);
    if (person === undefined || peek(`${id}.at_the_heart`) !== "true") return {};
    const unseen = (g: string) => this.agentHiddenGroup(g) || this.agentHiddenRace(g);
    const want = foldName(name);
    const played = [...sim.model.characters.values()].find((c) => !c.secret && foldName(c.id) === want);
    const book = this.factsBook();
    const filings =
      book === null
        ? []
        : this.factsWatch
            .all(sim, book.confirm)
            .filter((f) => f.person === id)
            .sort((a, b) => (a.logAt ?? 0) - (b.logAt ?? 0))
            .map((f) => ({ question: f.question, verdict: dossierVerdictOf(f), confidence: f.confidence, ...(f.logAt !== undefined ? { logAt: f.logAt } : {}) }));
    const leaks = this.agentLeakChecks();
    const dossier = buildDossier({
      character: thread.character,
      speaker: { id, name },
      storyAt: sim.elapsed(),
      log: sim.log.all(),
      messages: all,
      peek,
      secretSlots: sim.model.roles.get(person.role)?.secret ?? new Set<string>(),
      program: played?.id ?? null,
      faction: sim.publicFactionOf(id),
      groups: sim.groupsOf(id),
      groupVisible: (g) => !unseen(g),
      captured: sim.isCaptured(id),
      restricted: sim.isRestricted(id),
      persons: [...sim.persons.values()].map((p) => ({ id: p.id, name: p.name })),
      codex: sim.codexFor(id).map((e) => ({ title: e.title, text: e.text, secret: e.secret })),
      codexDef: (entry) => {
        const e = sim.model.codex.get(entry);
        return e === undefined ? undefined : { title: e.title, text: e.text, secret: e.secret };
      },
      quests: sim.questsFor(id).map((q) => ({ id: q.def.id, title: q.def.title, status: q.status })),
      location: (loc) => {
        const l = sim.model.locations.get(loc);
        return l === undefined ? null : inWorldLabel(l.label ?? l.id);
      },
      filings,
      currencySlot: sim.model.currency?.slot ?? null,
      ...(leaks.mentionsAnswer !== undefined ? { mentionsAnswer: leaks.mentionsAnswer } : {}),
      mentionsSecret: leaks.mentionsSecret,
      mentionsCode: codeMentions([...sim.model.codex.values()].flatMap((e) => (e.code === null ? [] : [e.code]))),
    });
    return dossier === null ? {} : { dossier };
  }

  /**
   * Answer `person`'s pending menu (`/api/guest/choose`, `/api/mod/choose`).
   * Wave 20 (D15, D18): `choice` names the menu by its id (absent: the
   * oldest), and `text` is the option the client showed at `index` — a click
   * racing a new menu is refused (409 `moved`), never misapplied, and an
   * index the named menu doesn't offer is refused too, never journaled as a
   * no-op pick. The menu id (with its beat and the option's text) rides
   * the journal line only when given, so an old client's line (and an old
   * journal) replays as before.
   */
  private chooseFor(person: string, body: Record<string, unknown>, res: ServerResponse): void {
    const idx = Number(body["index"] ?? -1);
    const text = typeof body["text"] === "string" ? body["text"] : undefined;
    const raw = body["choice"];
    const choice = raw === undefined || raw === null ? undefined : Number(raw);
    let key: [string, string] | null = null;
    if (text !== undefined || choice !== undefined) {
      const menus = this.reqSim().pendingChoicesFor(person);
      const menu = choice === undefined ? menus[0] : menus.find((m) => m.id === choice);
      if (menu === undefined) {
        sendJson(res, 409, { error: "no choice", options: null });
        return;
      }
      if (!Number.isInteger(idx) || idx < 0 || idx >= menu.options.length || (text !== undefined && menu.options[idx] !== text)) {
        sendJson(res, 409, { error: "moved", options: menu.options });
        return;
      }
      key = [menu.beat, menu.options[idx]!];
    }
    // The menu's beat + the option's text ride beside its id: the id is a
    // log index, so a replay over edited text finds the menu by them.
    this.fanout(choice === undefined ? this.commit("choose", person, idx) : this.commit("choose", person, idx, choice, ...(key ?? [])));
    sendJson(res, 200, { ok: true });
  }

  /** The leak checks a request's house-held text goes through (wave 12
   *  C0.1 / C1.2, shared by `recent` and the wave 20 dossier): the facts
   *  book's answer forms (absent with no book in force) and the current
   *  values of every `secret: true` character. */
  private agentLeakChecks(): { mentionsAnswer?: (text: string) => boolean; mentionsSecret: (text: string) => boolean } {
    const sim = this.sim!;
    const book = this.factsBook();
    const topics = new Map((book?.raw.questions ?? []).map((q) => [q.id, q.topics ?? []] as const));
    const mentionsAnswer = book === null ? undefined : answerMentions([...book.questions, ...book.answers].map((k) => ({ forms: k.forms, topics: topics.get(k.id) ?? [] })));
    const secretHeads = new Set([...sim.model.characters.values()].filter((c) => c.secret).map((c) => c.id));
    const secretValues = sim.world
      .entries()
      .flatMap(([path, v]) => (v.kind === "string" && secretHeads.has(path.split(".")[0]!) ? [v.value] : []));
    const mentionsSecret = secretMentions(secretValues, [...sim.persons.values()].map((p) => p.name));
    return { ...(mentionsAnswer !== undefined ? { mentionsAnswer } : {}), mentionsSecret };
  }

  /**
   * Wave 32 (C4): the public talk request — Clippy speaking aloud in the
   * Desktop. History = the room's own lines (kind `line`, not hidden, ANY
   * audience, every speaker; scripted ones `story: true`), newest
   * `AGENT_HISTORY`, each `from` its speaker's name; a line that carries a
   * facts answer or a secret value is left out (never the line he is asked
   * to answer). No dossier; `them.location` null; `stage {room, scene,
   * direction?}`. Null when nobody but him has said anything there.
   */
  private buildTalkRequest(thread: AgentThread, id: string): AgentRequest | null {
    const sim = this.sim!;
    const scene = this.talkNight();
    if (scene === null) return null;
    const who = thread.audience[0] ?? `@${TALK_AS}`;
    const performer = who.startsWith("@") ? who.slice(1) : who;
    const all = this.chat.all();
    const room = all.filter((m) => m.channel === thread.channel && m.kind === "line" && !m.hidden);
    const def = sim.model.characters.get(thread.character);
    const tag: StoryTagContext = { character: thread.character, hold: def?.hold ?? null, busy: def?.busy ?? null, storyTexts: storyTexts(all, thread.character) };
    // The line he answers: the speaker's newest (else anyone's but his).
    // A line that carries a facts answer, a secret value, a codex unlock
    // code or a hunt answer key never reaches him (as the dossier, wave 20):
    // only the performer's own line he answers is exempt.
    const { mentionsAnswer, mentionsSecret } = this.agentLeakChecks();
    const mentionsCode = codeMentions([...sim.model.codex.values()].flatMap((e) => (e.code === null ? [] : [e.code])));
    const leaks = (text: string): boolean => text.includes(HUNT_ANSWER_MARK) || mentionsSecret(text) || mentionsCode(text) || (mentionsAnswer?.(text) ?? false);
    let asked: ChatMessage | undefined;
    for (let i = room.length - 1; i >= 0 && asked === undefined; i--) if (room[i]!.from === performer) asked = room[i];
    for (let i = room.length - 1; i >= 0 && asked === undefined; i--) if (room[i]!.from !== thread.character && !leaks(room[i]!.text)) asked = room[i];
    if (asked === undefined) return null; // nothing said to answer
    const lines = room.filter((m) => m === asked || !leaks(m.text));
    const history: AgentLine[] = lines.slice(-AGENT_HISTORY).map((m) => ({
      seq: m.seq,
      mine: m.from === thread.character,
      from: m.from,
      text: m.text,
      ...(storyTag(m, tag) ? { story: true as const } : {}),
    }));
    const world = sim.worldEntries();
    const varsOf = this.agentVarsOf(world);
    const speakerDef = sim.model.characters.get(performer);
    const codex = (holder: string, text: boolean) =>
      sim
        .codexFor(holder)
        .filter((e) => !e.secret && (text || !(e.title.includes(HUNT_ANSWER_MARK) || e.text.includes(HUNT_ANSWER_MARK))))
        .map((e) => ({ id: e.id, title: e.title, about: e.about, text: text ? e.text : "" }));
    const recentOn = agentRecentOn();
    return {
      id,
      character: thread.character,
      thread,
      speaker: { kind: "performer", id: performer, name: performer, faction: speakerDef?.faction ?? null, ...(speakerDef?.player === true ? { player: true as const } : {}), stage: true },
      text: asked.text,
      history,
      self: { vars: varsOf(thread.character), ranges: Object.fromEntries(def?.ranges ?? []), codex: codex(thread.character, true) },
      them: {
        vars: varsOf(performer),
        codex: codex(performer, !recentOn),
        location: null,
        ...(speakerDef?.player === true ? { ranges: Object.fromEntries([...speakerDef.ranges].filter(([k]) => !isPrivateSlot(speakerDef, k))) } : {}),
      },
      world: this.agentGlobals(world),
      powers: this.agentPowers(),
      at: this.clock(),
      ...(recentOn ? this.agentRecentOf(thread, "performer", performer, performer, all, lines, tag) : {}),
      stage: { room: TALK_ROOM, scene, ...(this.talkDirection !== null && this.talkDirection.scene === scene ? { direction: this.talkDirection.text } : {}) },
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
    // C0.1: a house line filled in from a secret character (the Kernel) is
    // never his to read, whatever the hour.
    const { mentionsAnswer, mentionsSecret } = this.agentLeakChecks();
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
      peek: (path) => this.agentPeek(path),
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
    const varsOf = this.agentVarsOf(world, { race: true });
    const globals = this.agentGlobals(world);
    const online = new Set(this.agents.onlineCharacters());
    // Wave 18b (D13 j): no race side on any program or character either.
    const unseen = (g: string) => this.agentHiddenGroup(g) || this.agentHiddenRace(g);
    // The booths online, as `presence()` counts them (not the whole presence:
    // that builds the facts view too).
    const primes = new Set([...this.clients].filter((c) => c.role === "prime").map((c) => c.id));
    const nameOf = (id: string) => sim.persons.get(id)?.name ?? id;
    const programs = [...sim.persons.values()].map((p) => ({
      id: p.id,
      name: p.name,
      faction: ((f) => (f !== null && this.agentHiddenRace(f) ? null : f))(sim.publicFactionOf(p.id)),
      groups: sim.groupsOf(p.id).filter((g) => !unseen(g)),
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
        faction: c.faction !== null && unseen(c.faction) ? null : c.faction,
        listed: c.listed,
        mind: c.mind,
        online: c.mind === "external" ? online.has(c.id) : primes.has(c.id),
        vars: varsOf(c.id),
        codex: sim.codexFor(c.id).filter((e) => !e.secret).map((e) => e.title),
      })),
      // Trabolta's prompt: a label's crew note is the real house (wave 59).
      locations: [...sim.model.locations.values()].map((l) => ({
        id: l.id,
        label: inWorldLabel(l.label ?? l.id),
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
    const data = { channel: thread.channel, from: thread.character, on };
    if (thread.public === true) {
      // Wave 32 (C4): his thinking reaches the host booths and the directors
      // only — never a guest, never a player's booth.
      for (const c of this.clients) if (c.role === "mod" || (c.role === "prime" && (c.host === true || c.admin === true))) sseSend(c.res, "typing", { ...data, audience: thread.audience, public: true });
      return;
    }
    for (const c of this.clients) {
      if (this.seesAgentThread(c, thread)) sseSend(c.res, "typing", { ...data, audience: thread.audience });
    }
  }

  /** May `c` see a DM agent thread's typing and wait frames? Its guest, a
   *  performer whose cast thread it is, an admin booth, every director. */
  private seesAgentThread(c: Client, thread: AgentThread): boolean {
    const who = thread.audience[0]!;
    return c.role === "guest" ? c.id === who : c.role === "prime" ? `@${c.id}` === who || c.admin === true : true;
  }

  /** The `agentWait` frame's body (wave 42b, B2). */
  private static agentWaitFrame(thread: AgentThread, wait: AgentLineWait): Record<string, unknown> {
    return {
      channel: thread.channel,
      audience: thread.audience,
      character: thread.character,
      state: wait.state,
      ...(wait.position !== undefined ? { position: wait.position } : {}),
      ...(wait.etaS !== undefined ? { etaS: wait.etaS } : {}),
    };
  }

  /**
   * Wave 42b (B2): tell a DM thread where it stands in a windowed worker's
   * line (`agentWait {channel, audience, character, state, position?,
   * etaS?}`), to the same audience as its typing frames. Never for a public
   * talk thread (the hub never asks; this is the belt), never for a lean
   * house tool (it never reads them, and a burst sends several a second).
   * Memory only: a reconnecting stream gets its threads' current waits
   * after `history` (`replayAgentWaits`).
   */
  private pushAgentWait(thread: AgentThread, wait: AgentLineWait): void {
    if (thread.public === true) return;
    const frame = EventRuntime.agentWaitFrame(thread, wait);
    for (const c of this.clients) if (c.lean !== true && this.seesAgentThread(c, thread)) sseSend(c.res, "agentWait", frame);
  }

  /** A stream (re)opened: the waits of the threads it may see, as they
   *  stand now — typing is not replayed, so `answering` stands in for it. */
  private replayAgentWaits(c: Client): void {
    for (const { thread, wait } of this.agents.waitList()) {
      if (thread.public !== true && this.seesAgentThread(c, thread)) sseSend(c.res, "agentWait", EventRuntime.agentWaitFrame(thread, wait));
    }
  }

  /** `GET /api/agent/stream?characters=A,B&name=laptop[&capacity=N]` — one
   *  worker. Wave 42 (C1): `capacity` (1..16, the worker's
   *  `agents.concurrency`) makes it a windowed worker; missing or invalid
   *  keeps the legacy hub for it. */
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
    const capacity = agentCapacityOf(url.searchParams.get("capacity"));
    const worker: AgentWorker = {
      id: randomUUID(),
      name: url.searchParams.get("name") ?? "agent",
      characters,
      send: (event: string, data: unknown) => sseSend(res, event, data),
      ...(capacity !== null ? { capacity } : {}),
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
      // Wave 42 (C1): the window the server holds it to (null = legacy:
      // every request at once, as before), so the worker can log it.
      capacity,
    });
    this.agentStreams.add(res);
    this.agents.attach(worker);
    this.askPendingRulings();
    const ping = setInterval(() => sseWrite(res, ":ping\n\n"), 25000);
    req.on("close", () => {
      clearInterval(ping);
      this.agentStreams.delete(res);
      this.agents.detach(worker.id);
      this.letters.detach(worker.id);
    });
  }

  /** `POST /api/agent/reply {id, say?, adjust?: {var: delta}, worker?}`. */
  private agentReply(res: ServerResponse, body: Record<string, unknown>): void {
    // Wave 42: a windowed hub hands the freed slot out only after this
    // reply's say, adjustments and acts are committed (the `finally`), so
    // the next queued body — built at its dispatch — sees his new mood.
    const settled = this.agents.settle(str(body, "id"), str(body, "worker") || undefined, { defer: true });
    if (settled === null) {
      sendJson(res, 410, { error: "no such open request (answered, timed out, or the run restarted)" });
      return;
    }
    try {
      this.agentReplyCommit(res, body, settled);
    } finally {
      if (settled.pumpOwed === true) this.agents.pump();
    }
  }

  /** `agentReply`'s commit, once the hub has settled the request. */
  private agentReplyCommit(res: ServerResponse, body: Record<string, unknown>, settled: { req: AgentRequest; followUp: boolean }): void {
    const { req, followUp } = settled;
    const sim = this.sim;
    if (sim === null) {
      sendJson(res, 409, { error: "no scenario loaded" });
      return;
    }
    const text = str(body, "say").trim().slice(0, CHAT_TEXT_MAX);
    const isPublic = req.thread.public === true;
    if (isPublic && this.talkStale(req)) {
      // Wave 32 (C4): the scene it was asked in is over — the room moved
      // on; nothing lands (no line, no adjust), the hosts hear why.
      // Its follow-up (more said meanwhile) is dropped with it: those lines
      // belong to the closed scene (a Clippy line in the new one closes the
      // owed request first, in modTalk, and opens a fresh one).
      this.postHostsNote(TALK_LATE_NOTE);
      sendJson(res, 410, { error: "the talk scene closed" });
      return;
    }
    if (this.asleepSinceAsked(req)) {
      // Wave 58: he died with this reply in flight, and "his DMs stop". Nothing
      // lands (no line, no adjust, no act). The thread is asked again, because
      // the worker answers a closed gate itself: the new body reads him asleep,
      // so the guest gets the unavailable line, or the distress line if that is
      // what they sent.
      this.agents.line(req.thread);
      sendJson(res, 410, { error: "he went to sleep" });
      return;
    }
    if (text !== "") {
      // Wave 32 (C4): a public answer goes to the whole room (a `loc:`
      // channel's default audience is only its occupants).
      this.fanout(this.commit("say", req.character, req.thread.channel, text, null, isPublic ? "all" : req.thread.audience, answeredSeq(req)));
    }
    // Adjustments move only the character's own declared numeric ranges,
    // clamped to them. The story's watchers decide what the numbers mean.
    const ranges = sim.model.characters.get(req.character)?.ranges ?? new Map<string, [number, number]>();
    // Wave 21 (C7): `them.<slot>` moves a player speaker's own declared
    // range (never a `private:` one); a guest's `them.` keys are ignored,
    // but for the story's `warmth:` slot (wave 58, C5), ±1 whatever was asked.
    const who = req.thread.audience[0] ?? "";
    const them = who.startsWith("@") ? sim.model.characters.get(who.slice(1)) : undefined;
    const applied: Record<string, number> = {};
    for (const [name, delta] of agentAdjustments(body["adjust"])) {
      let range: [number, number] | undefined;
      let path: string;
      let step = delta;
      let start: number | undefined;
      if (name.startsWith("them.")) {
        const slot = name.slice("them.".length);
        const warmth = sim.model.warmth;
        if (them === undefined && warmth !== null && slot === warmth.slot && sim.persons.has(who)) {
          range = [warmth.min, warmth.max];
          path = `${who}.${slot}`;
          step = Math.sign(delta);
          start = 0;
        } else {
          if (them === undefined || !them.player || isPrivateSlot(them, slot)) continue;
          range = them.ranges.get(slot);
          path = `${them.id}.${slot}`;
        }
      } else {
        range = ranges.get(name);
        path = `${req.character}.${name}`;
      }
      if (range === undefined) continue;
      const current = Number(sim.worldEntries().find((w) => w.path === path)?.value ?? start ?? range[0]);
      const next = Math.max(range[0], Math.min(range[1], (Number.isFinite(current) ? current : (start ?? range[0])) + step));
      applied[name] = next;
      this.fanout(this.commit("setVar", path, String(next)));
    }
    // Doors closed (a pause): the words land, the acts don't (D10) — nothing
    // autonomous changes the house while nobody else may act, and a refused
    // act is not counted against its power's limit.
    const acts = agentActs(body["acts"]);
    const acted: AgentActResult[] = isPublic
      ? // Wave 32 (C4): nothing is done from the stage (the situation says `acts: none`).
        acts.map((a) => ({ kind: a.kind, ok: false, what: a.kind === "share" ? a.entry : a.name, error: "not from the stage" }))
      : this.phase === "open"
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

  /** Does this token alone open the camera feeds (a mod token or a game
   *  session)? The server asks first, so a terminal's token-bearing 1 s
   *  poll never pays for an author-session lookup. */
  camTokenReads(token: string | undefined): boolean {
    return this.spatialReader(token, false);
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
      // Who hears whom follows every flush (a move, a map swap, a session
      // that ended); the diffs are `listen` / `bye` frames, so a quiet tick
      // sends nothing.
      if (this.voice.size > 0) this.voice.route();
      if (!this.spatial.active && this.voice.size === 0) this.stopSpatialLoop();
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
      // The last one gone: the lights frame's timers stop.
      this.gameLights.changed();
    });
  }

  /**
   * `GET /api/mod/audio/walkers` (wave 49, C3.1): the router's footsteps, one
   * `walkers` event per `WalkersFrame`. `no-transform` keeps a compressing
   * proxy from sitting on a frame: this path ends in neither `/events` nor
   * `/stream`, and the router asks for gzip.
   */
  private openWalkersStream(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
    res.write(":ok\n\n");
    this.walkerStreams.add(res);
    const off = this.audio.onWalkers((frame) => sseSend(res, "walkers", frame));
    const ping = setInterval(() => sseWrite(res, ":ping\n\n"), 25000);
    req.on("close", () => {
      clearInterval(ping);
      this.walkerStreams.delete(res);
      off();
    });
  }

  /** The current map's terminal ids; feeds of any other spot are dropped
   *  (a terminal that left the map on a house change takes its feed along). */
  private camSpots(): Set<string> {
    const ids = new Set((this.spatialHouse()?.terminals ?? []).map((t) => t.id));
    this.cams.retain(ids);
    return ids;
  }

  /** (wave 50) The terminals the dream can break through in the games, while
   *  it runs and its frames are here: every spot on the map but the tent's.
   *  Null: not now. */
  private dreamSpots(): Set<string> | null {
    const dream = this.screens.dreamOf(this.sim);
    if (dream === null || this.clock() < dream.at || !this.dreamFeed.ready()) return null;
    return new Set((this.spatialHouse()?.terminals ?? []).filter((t) => t.view !== "reinstall").map((t) => t.id));
  }

  /** `POST /api/mod/spatial/cam {spot, jpeg, w, h}` — a terminal's frame
   *  (§2.3). Read under its own body cap, before the generic parse. */
  private async handleCamUpload(req: IncomingMessage, res: ServerResponse, moderator: boolean): Promise<boolean> {
    const body = await readBody(req, CAM_BODY_LIMIT);
    if (!moderator && !this.sessions.canModerate(tokenOf(req, body))) {
      sendJson(res, 403, { error: "moderators only" });
      return true;
    }
    const up = parseCamUpload(body);
    if (!up.ok) {
      sendJson(res, up.status, { error: up.error });
      return true;
    }
    if (!this.camSpots().has(up.spot)) {
      sendJson(res, 404, { error: "no such spot" });
      return true;
    }
    const out = this.cams.put(up.spot, up.jpeg, up.w, up.h);
    // `watched` (wave 26, C7): a player is in this spot's room now, so the
    // game shows the feed; the terminal slows down while nobody is.
    sendJson(res, 200, { ok: true, at: out.at, ...(out.dropped ? { dropped: true } : {}), watched: this.spatial.linked().has(up.spot) });
    return true;
  }

  /**
   * Who a voice call speaks for (§2.4): a terminal (a moderator — token or
   * author session — and a `spot` on the current map whose voice link is
   * on), or a game session (its token; no `spot`). Else the refusal as
   * `[status, error]`: 401 / 410 a session token, 403 `moderators only` a
   * non-mod token with a spot, 404 `no such spot`, 403 `voice is off at this
   * terminal`, 400 a mod token with no spot.
   */
  private voiceCaller(
    token: string | undefined,
    spot: string | null,
    moderator: boolean,
  ): { kind: "terminal"; spot: string } | { kind: "player"; session: string; joined: boolean } | { kind: "refused"; status: number; error: string; spot?: true } {
    if (spot !== null) {
      if (!moderator && !this.sessions.canModerate(token)) return { kind: "refused", status: 403, error: "moderators only" };
      const house = this.spatialHouse();
      if (house === null || !house.terminals.some((t) => t.id === spot)) return { kind: "refused", status: 404, error: "no such spot", spot: true };
      if (!voiceOn(house, spot)) return { kind: "refused", status: 403, error: "voice is off at this terminal", spot: true };
      return { kind: "terminal", spot };
    }
    const s = this.spatial.voiceSessionFor(token);
    if (s !== null) return { kind: "player", session: s.id, joined: s.joined };
    if (this.spatial.tokenState(token) === "over") return { kind: "refused", status: 410, error: "this session is over" };
    if (moderator || this.sessions.canModerate(token)) return { kind: "refused", status: 400, error: "a terminal names its spot (?spot=)" };
    return { kind: "refused", status: 401, error: "unknown session token" };
  }

  /** `POST /api/spatial/voice?seq=<n>[&spot=<id>]` — one chunk of μ-law
   *  (§2.4), raw bytes under their own cap, before the 2 KB spatial parse. */
  private async handleVoiceUpload(req: IncomingMessage, res: ServerResponse, url: URL, moderator: boolean): Promise<boolean> {
    const body = await readRawBody(req, VOICE_MAX_BYTES);
    const spotParam = url.searchParams.get("spot");
    const who = this.voiceCaller(queryTokenOf(req, url), spotParam === null ? null : spotParam.trim(), moderator);
    // Who first (401 / 403 / 410), then the chunk (400), then the spot (404 / 403).
    if (who.kind === "refused" && who.spot !== true) {
      sendJson(res, who.status, { error: who.error });
      return true;
    }
    const up = parseVoiceUpload(url.searchParams, body);
    if (!up.ok) {
      sendJson(res, up.status, { error: up.error });
      return true;
    }
    if (who.kind === "refused") {
      sendJson(res, who.status, { error: who.error });
      return true;
    }
    // A parked session (no pose yet) is heard by nobody.
    if (who.kind === "player" && !who.joined) {
      sendJson(res, 200, { ok: true, listening: false, dropped: true });
      return true;
    }
    const out = this.voice.upload(who.kind === "terminal" ? { kind: "terminal", spot: who.spot } : { kind: "player", session: who.session }, up.seq, up.bytes);
    sendJson(res, 200, { ok: true, listening: out.listening, ears: out.ears, ...(out.dropped ? { dropped: true } : {}) });
    return true;
  }

  /** `GET /api/spatial/voice/stream?token=<t>[&spot=<id>]` — what this
   *  device can hear (§2.4). Refusals are plain HTTP before it opens. */
  private openVoiceStream(req: IncomingMessage, res: ServerResponse, url: URL, moderator: boolean): void {
    const spotParam = url.searchParams.get("spot");
    const spot = spotParam === null ? null : spotParam.trim();
    if (spot !== null && (spot === "" || spot.length > 80)) {
      sendJson(res, 400, { error: "spot is a terminal id" });
      return;
    }
    const who = this.voiceCaller(queryTokenOf(req, url), spot, moderator);
    if (who.kind === "refused") {
      sendJson(res, who.status, { error: who.error });
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(":ok\n\n");
    // The stall cap is the lag cap: past it only control frames and the
    // ping are written, so a reader that stopped (a zero-window tablet, a
    // half-open socket) is dropped by the ping's write 15 s on (S2).
    sseCap(res, VOICE_LAG_BYTES);
    const id = randomUUID();
    const flag = (name: string): boolean | undefined => {
      const v = url.searchParams.get(name);
      return v === "0" ? false : v === "1" ? true : undefined;
    };
    const mic = flag("mic");
    const hear = flag("hear");
    const listener: VoiceListener = {
      id,
      ...(who.kind === "terminal" ? { kind: "terminal", spot: who.spot } : { kind: "player", session: who.session }),
      ...(mic !== undefined ? { mic } : {}),
      ...(hear !== undefined ? { hear } : {}),
      // A reader behind by seconds skips audio until it catches up: late
      // voice is worse than a gap. Control frames always go.
      send: (event, data) => {
        if (event === "voice" && sseQueued(res) > VOICE_LAG_BYTES) return;
        sseSend(res, event, data);
      },
      close: () => {
        try {
          res.end();
        } catch {
          /* already gone */
        }
      },
    };
    const ping = setInterval(() => sseWrite(res, ":ping\n\n"), VOICE_PING_MS);
    ping.unref?.();
    req.on("close", () => {
      clearInterval(ping);
      this.voice.disconnect(id);
    });
    this.voice.connect(listener);
    this.startSpatialLoop();
  }

  /** The spatial plane's GET routes. True when `path` matched. */
  private handleSpatialGet(req: IncomingMessage, res: ServerResponse, path: string, url: URL, moderator: boolean): boolean {
    const token = queryTokenOf(req, url);
    if (path === "/api/spatial/voice/stream") {
      this.openVoiceStream(req, res, url, moderator);
      return true;
    }
    if (path === "/api/spatial/cams" || path === "/api/spatial/cam") {
      // The camera feeds (§2.3): a game session or a moderator, like the map.
      if (!this.spatialReader(token, moderator)) {
        sendJson(res, 401, { error: "a moderator or game session token is required" });
        return true;
      }
      this.camSpots();
      // A game session sees only the feeds of its own presence room, never
      // the tent's (wave 26, C7); a moderator sees every feed.
      const seen = moderator || this.sessions.canModerate(token) ? null : this.spatial.camSpotsFor(token);
      const dream = this.dreamSpots();
      if (path === "/api/spatial/cams") {
        const cams = dream === null ? this.cams.list() : this.dreamFeed.list(dream, this.cams.list());
        sendJson(res, 200, { cams: seen === null ? cams : cams.filter((c) => seen.has(c.spot)) });
        return true;
      }
      const spot = (url.searchParams.get("spot") ?? "").trim();
      const allowed = seen === null || seen.has(spot);
      const frame = allowed ? this.cams.get(spot) : null;
      const send = (jpeg: Buffer, at: number): void => {
        if (seen !== null) this.cams.noteRead(spot);
        res.writeHead(200, { "content-type": "image/jpeg", "content-length": String(jpeg.length), "cache-control": "no-store", "x-cam-at": String(at) });
        res.end(jpeg);
      };
      const none = (): void => sendJson(res, 404, { error: "no feed" });
      if (allowed && dream?.has(spot) === true && this.dreamFeed.spurting(spot)) {
        void this.dreamFeed.frame(spot).then((f) => {
          if (f !== null) send(f.jpeg, f.at);
          else if (frame !== null) send(frame.jpeg, frame.at);
          else none();
        });
        return true;
      }
      if (frame === null) none();
      else send(frame.jpeg, frame.at);
      return true;
    }
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
      case "/api/mod/spatial/descent":
        sendJson(res, 200, { forced: this.spatial.forcedLevel });
        return true;
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
        // Once the night has ended the reinstallation is a party favour
        // (Q16 dropped): nobody is "marked" any more, so a program the story
        // lets in then says `favour`, never `marked`.
        const ended = this.nightEnded();
        const players = sortCandidates(
          [...sim.persons.values()].map((p) => {
            const captured = sim.isCaptured(p.id);
            const restricted = sim.isRestricted(p.id);
            // What `/api/mod/spatial/begin` lets in (without `force`).
            const eligible = eligibleFor(sim, p.id);
            return {
              id: p.id,
              name: p.name,
              captured,
              restricted,
              eligible,
              // C7: eligible by the story's `reinstall:` alone (neither
              // captured nor restricted) — the tablet / VR label "marked";
              // after the end, a party favour instead.
              marked: !ended && eligible && !captured && !restricted,
              favour: ended && eligible && !captured,
              location: sim.locationOf(p.id),
              avatar: this.avatars.keyFor(p.name),
              // ≥ 1: the intro video and tutorial may be skipped.
              reinstalled: this.spatial.reinstalledBy(p.id),
            };
          }),
        );
        sendJson(res, 200, { players, ended });
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
      case "/api/spatial/moment":
        this.handleMoment(res, token, body, refuse);
        return true;
      case "/api/spatial/ready": {
        // The game's intro (video, tutorial) is over: the run clock restarts.
        // Commits nothing, so it is open while the doors are closed.
        const out = this.spatial.ready(token);
        if (out !== "ok") refuse(out);
        else sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/spatial/reset": {
        // (wave 59) The run reset: back to the spawn, Gerald somewhere new.
        // Commits nothing, so it is open while the doors are closed.
        const out = this.spatial.runReset(token);
        if (out.kind === "ok") sendJson(res, 200, { ok: true, spawn: out.spawn, duck: out.duck });
        else if (out.kind === "found") sendJson(res, 409, { error: "already found" });
        else refuse(out.kind);
        return true;
      }
      case "/api/spatial/suspend": {
        // (wave 40) The headset was doffed, or the web tab hidden: hold the
        // walk so it can resume where it was. Commits nothing, so it is open
        // while the doors are closed. A dead token hears 401 / 410.
        const out = this.spatial.suspend(token);
        if (out !== "ok") refuse(out);
        else sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/spatial/resume": {
        // (wave 40) Pick a held walk back up: the assignment, the pose to
        // respawn at, and whether its intro was already done. A dead token
        // (the grace elapsed, or the station was taken) hears 401 / 410, and
        // the game starts fresh. Commits nothing to the story.
        const out = this.spatial.resume(token);
        if (out.kind !== "ok") refuse(out.kind);
        else sendJson(res, 200, { ok: true, assignment: out.assignment, pose: out.pose, ready: out.ready });
        return true;
      }
      case "/api/spatial/prefs": {
        // A program's game settings (VR: snap / smooth turning), saved for
        // its next reinstallation. Commits nothing to the story.
        if (!this.spatial.hasToken(token)) {
          refuse(this.spatial.tokenState(token));
          return true;
        }
        const prefs = parsePrefs(body);
        if (prefs === null) {
          sendJson(res, 400, { error: 'settings are {turn: "snap" | "smooth"}' });
          return true;
        }
        const out = this.spatial.setPrefs(token, prefs);
        if (out.kind !== "ok") refuse(out.kind);
        else sendJson(res, 200, { ok: true, prefs: out.prefs });
        return true;
      }
      case "/api/spatial/told": {
        // (wave 49) What a program told a talker, for its later visits.
        // Memory only and commits nothing, so it is open while the doors
        // are closed.
        if (!this.spatial.hasToken(token)) {
          refuse(this.spatial.tokenState(token));
          return true;
        }
        const told = parseTold(body);
        if (told === null) {
          sendJson(res, 400, { error: "told is {talker, mark}, strings of 1–64 characters" });
          return true;
        }
        const out = this.spatial.tell(token, told.talker, told.mark);
        if (out !== "ok") refuse(out);
        else sendJson(res, 200, { ok: true });
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

  /**
   * `POST /api/spatial/moment {kind, prop?}` (wave 26, C6): an escape into
   * the void, a visit to Trabolta's heart or a pickup, judged by the hub on
   * the session's last pose. A dead token hears 401 / 410 first, then a bad
   * body 400, then the doors (409 while closed: nothing commits). The
   * answer carries the lines the story said to this program in that one
   * commit (`momentLines`), game-only beats included: never a stream frame.
   */
  private handleMoment(res: ServerResponse, token: string | undefined, body: Record<string, unknown>, refuse: (state: "unknown" | "over") => void): void {
    if (!this.spatial.hasToken(token)) {
      refuse(this.spatial.tokenState(token));
      return;
    }
    const req = parseMomentRequest(body);
    if (req === null) {
      sendJson(res, 400, { error: "bad moment" });
      return;
    }
    if (!this.open || this.sim === null) {
      sendJson(res, 409, { error: "doors are closed" });
      return;
    }
    const out = this.spatial.moment(token, req, (s, signal, args) => this.commitMoment(s, signal, args));
    const metres = (n: number): number | null => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
    switch (out.kind) {
      case "unknown":
      case "over":
        refuse(out.kind);
        return;
      case "bad":
        sendJson(res, 400, { error: "bad moment" });
        return;
      case "parked":
        sendJson(res, 409, { error: "this session has not started — send a pose first" });
        return;
      case "noProp":
        sendJson(res, 404, { error: "no such prop" });
        return;
      case "notOut":
        sendJson(res, 409, { error: "not out", distance: metres(out.distance) });
        return;
      case "cooldown":
        sendJson(res, 409, { error: "cooldown", retryMs: Math.max(0, Math.ceil(out.retryMs)) });
        return;
      case "sealed":
        sendJson(res, 409, { error: "sealed" });
        return;
      case "notThere":
        sendJson(res, 409, { error: "not there" });
        return;
      case "far":
        sendJson(res, 409, { error: "far", distance: metres(out.distance) });
        return;
      case "already":
        sendJson(res, 409, { error: "already" });
        return;
      case "ok":
        if (req.kind === "escape") sendJson(res, 200, { ok: true, kind: "escape", lines: out.lines, spawn: out.spawn, cooldownMs: ESCAPE_COOLDOWN_MS });
        else if (req.kind === "heart") sendJson(res, 200, { ok: true, kind: "heart", lines: out.lines });
        else sendJson(res, 200, { ok: true, kind: "pickup", lines: out.lines, item: out.prop?.item ?? "", prop: out.prop?.id ?? req.prop });
        return;
    }
  }

  /** A game moment landed: the story's signal for the program, journaled
   *  `by` the game's device, fanned out as usual. Returns what that one
   *  commit said to the program (`momentLines`, in order). A story that
   *  throws on the signal says nothing (logged): the line is already in
   *  the journal (`commit` appends first), so the route still answers its
   *  200 and the hub's cooldown / re-seat match what was recorded. */
  private commitMoment(s: SessionRef, signal: string, args: Record<string, string>): MomentLine[] {
    const sim = this.sim;
    if (sim === null || !sim.persons.has(s.guest) || signal === "") return [];
    const actingBy = this.actingBy;
    this.actingBy = s.device;
    try {
      const events = this.commit("signal", signal, s.guest, args);
      this.fanout(events);
      return momentLines(events, s.guest);
    } catch (err) {
      process.stderr.write(`  ⚠️  event ${this.eventId}: the story failed on the game moment "${signal}" (${err instanceof Error ? err.message : String(err)})\n`);
      return [];
    } finally {
      this.actingBy = actingBy;
    }
  }

  /** A hit on the King landed: journaled `by` the game's device — his new
   *  hit points into the story world (his `health` path; a King the hub
   *  counts has none), then the story's `hit` signal for the hitter with
   *  `{hp, max}`, then `fallen` once he is down. A story that throws on
   *  one of them is logged, like `commitMoment`: the line is already in the
   *  journal (`commit` appends first) and the hub has counted the hit, so
   *  the route still answers its 200 with the King as recorded. */
  private commitKingHit(s: SessionRef, next: KingState, ref: KingRef): void {
    const sim = this.sim;
    if (sim === null) return;
    const actingBy = this.actingBy;
    this.actingBy = s.device;
    try {
      if (ref.path !== null) this.fanout(this.commit("setVar", ref.path, String(next.hp)));
      if (!sim.persons.has(s.guest)) return;
      const args = { hp: next.hp, max: next.max };
      this.fanout(this.commit("signal", kingSignal(ref.prop, "hit"), s.guest, args));
      if (next.fallen) this.fanout(this.commit("signal", kingSignal(ref.prop, "fallen"), s.guest, args));
    } catch (err) {
      process.stderr.write(`  ⚠️  event ${this.eventId}: the story failed on the King's hit (${err instanceof Error ? err.message : String(err)})\n`);
    } finally {
      this.actingBy = actingBy;
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
    // The screens' `found` moment reads the capture the find left (wave 17).
    this.screens.catchUp(this.sim);
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
    this.marks.observe(this.sim); // C6: a tick's changes, stamped as a replay would
    this.store.appendCommand(m, args, this.actingBy);
    this.factsWatch.mark(this.sim!, factsBy(m, args, this.actingBy), factsRuling(m, args, this.actingBy));
    const out = (this.sim![m] as (...a: unknown[]) => SimEvent[])(...args);
    if (m === "signal") notePress(this.sim!, out, this.actingBy); // the cue sheet judges a press by its own events (and names who made it)
    this.spatial.syncKing(); // a `king` frame when this moved his hit points (C2)
    this.marks.observe(this.sim);
    this.draftCrewNotices(out);
    return out;
  }

  /** Wave 18b: draft the crew notices the last mutation (or story tick)
   *  raised — a crew op's, or (faction mode) a `join` / `defect` / story
   *  `add` that took someone out of a crew — at once, as `restore` drafts
   *  them after each journal line; `fanout` posts them right after `out`'s
   *  last event (after the previous commit's, when `out` is empty). */
  private draftCrewNotices(out: readonly SimEvent[]): void {
    const sim = this.sim;
    if (sim === null) return;
    if (out.length > 0) this.commitTail = out[out.length - 1]!;
    const notices = sim.crews.takeNotices();
    if (notices.length === 0) return;
    const drafts = crewDrafts(sim, notices);
    const tail = this.commitTail;
    if (tail === null) this.crewHead.push(...drafts);
    else {
      const list = this.crewAfter.get(tail);
      if (list === undefined) this.crewAfter.set(tail, drafts);
      else list.push(...drafts);
    }
    if (notices.some((n) => n.kind === "answered")) this.crewAnswered = true;
  }

  /** Crew lines drafted and not yet posted (`draftCrewNotices`). */
  private get crewWaiting(): boolean {
    return this.crewHead.length > 0 || this.crewAfter.size > 0;
  }

  /** Apply one wallet op *and* journal it as a single `wallet` line — the
   *  book calls the sim (balances, codex grants, story signals) unjournaled
   *  inside, so a replay of the line lands on the same state. */
  private commitWallet(op: WalletOp): SimEvent[] {
    this.flushTick();
    this.marks.observe(this.sim);
    this.store.appendCommand("wallet", [op], this.actingBy);
    if (this.sim !== null) this.factsWatch.mark(this.sim, this.actingBy ?? null);
    const out = this.wallet!.apply(op);
    this.spatial.syncKing();
    this.marks.observe(this.sim);
    this.draftCrewNotices(out);
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

  /** Close the real booth streams for a character (not directors' panes)
   *  and unbind its booths' push devices — a part released or taken back. */
  private endBooths(character: string): void {
    for (const c of [...this.clients]) {
      if (c.role !== "prime" || c.id !== character || c.via !== undefined) continue;
      this.clients.delete(c);
      try {
        // Told at once: a reconnect's 401 takes the phone seconds (wave 59).
        sseSend(c.res, "lifecycle", { kind: "released", at: Date.now() });
        c.res.end();
      } catch {
        /* client already gone */
      }
    }
    this.boothSeen.delete(character);
    this.push.drop((owner) => owner === boothOwner(character));
    this.pushPresence();
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
  /**
   * Is this guest POST refused because the caller's phone is locked (wave
   * 26, C2)? Only a `/api/guest/*` route outside `LOCKED_OPEN`, called with
   * a token that names a guest (a dead token is left to the route's own
   * 401), while the story's `lock:` holds for them. `act` on a `restricted:
   * allow` interaction (Bathroom Mode) stays open.
   */
  private lockedOut(req: IncomingMessage, path: string, body: Record<string, unknown>): boolean {
    if (!path.startsWith("/api/guest/") || LOCKED_OPEN.includes(path)) return false;
    const sim = this.sim;
    if (sim === null || sim.model.lock === null) return false;
    const id = this.guestOf(tokenOf(req, body));
    if (id === null || !isLocked(sim, id)) return false;
    if (path === "/api/guest/act") {
      const def = sim.model.interactions.get(str(body, "name"));
      if (def !== undefined && def.who === "guest" && def.allowRestricted) return false;
    }
    return true;
  }

  private requireGuest(req: IncomingMessage, body: Record<string, unknown>, res: ServerResponse): string | null {
    const token = tokenOf(req, body);
    const id = this.guestOf(token);
    if (id === null) {
      sendJson(res, 401, { error: this.notSignedIn(token) });
      return null;
    }
    return id;
  }

  /** A dead guest token's 401: a released phone is told so. */
  private notSignedIn(token: string | undefined): string {
    return token !== undefined && this.releasedTokens.has(token) ? SIGNED_OUT : "not signed in — register first";
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

  /** Forget the channel of every menu no longer pending (D18). */
  private pruneMenuChannels(): void {
    if (this.menuChannels.size === 0) return;
    const pending = this.sim?.pendingChoiceIds() ?? new Set<number>();
    for (const menu of [...this.menuChannels.keys()]) if (!pending.has(menu)) this.menuChannels.delete(menu);
  }

  private resetChat(): void {
    this.chat.clear();
    this.store.clearHidden();
    this.decisionChannels.clear();
    this.menuChannels.clear();
    this.lastSpeakers.clear();
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
    this.filter.clear(); // w48: the journal about to be replayed (or none) refills it
    // The screens fold this sim from its (empty) start, so the entry beat
    // the doors play next is a live moment, not history (wave 17).
    this.screens.adopt(this.sim);
    const currency = this.sim.model.currency;
    this.wallet = currency !== null ? new WalletBook(currency, walletSeam(this.sim, currency)) : null;
    this.scenarioSource = source;
    this.scenarioName = name;
    this.setPhase("paused");
    this.seedAvatars();
    this.spatial.syncKing(); // a fresh world: a standing King (or the hub's own count)
    // C4: every booth's host follows its part in the story now loaded (a
    // restart or reload onto text that gives or takes `admin: true`), before
    // the fresh snapshots (`host`) and history (its agent threads) go out.
    this.rederiveHosts();
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
    this.syncConditionalAvatars();
    this.prefetchAvatars();
    this.lookupAvatars(lookups);
  }

  /**
   * Wave 18b: a character whose `avatar:` options carry `when <cond>`
   * (`picture:trabolta-broken.svg when self.broken == true`) wears the last
   * option whose condition holds (`self` bound to it), else its first.
   * Re-read after a load, a restore and every fanout; only a change writes
   * the book, the disk and the snapshots. True when a picture changed.
   */
  private syncConditionalAvatars(): boolean {
    const sim = this.sim;
    if (sim === null) return false;
    let changed = false;
    for (const c of sim.model.characters.values()) {
      const rules = c.avatarRules;
      if (rules === undefined || rules.length === 0) continue;
      let ref = c.avatar[0] ?? null;
      for (const r of rules) if (sim.holds(r.when, null, c.id)) ref = r.ref;
      if (ref === null || this.avatars.isChosen(c.id)) continue;
      const url = avatarRefUrl(ref);
      if (this.avatars.keyFor(c.id) === avatarKey(url)) continue;
      this.avatars.assign(c.id, url);
      void this.images.get(url);
      this.refreshGhosts(c.id);
      changed = true;
    }
    if (changed) this.persistAvatars();
    return changed;
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

  /** What the chat composer asks the runtime (C3: a readout's guest picture). */
  private readonly composeOpts: ComposeOptions = { avatarOf: (name) => this.avatars.keyFor(name), menuChannelOf: (menu) => this.menuChannels.get(menu) };

  /** Wave 18 (C6, C7): when each wanted guest was marked / captured, and
   *  when the night first ended — rebuilt by every replay. */
  private readonly marks = new StoryMarks();

  /** The names on a join screen's picker: the story's pool of programs
   *  for a guest, its parts for a performer — each with its picture,
   *  whether someone already holds it, and whether it is a reserved program
   *  locked for this caller (`claim`: the invitation's token, if any). */
  identities(role: "guest" | "prime", claim?: string | null): IdentityRow[] {
    if (this.sim === null) {
      // Before the doors there are no guests yet, but a booth may sign in
      // (the host who opens the doors among them): its parts come off the
      // story as written (recheck item 6).
      const model = role === "prime" ? this.declaredModel : null;
      if (model === null) return [];
      const held = heldCharacters(this.sessions.entries());
      return identityDefs(model)
        .filter(performerPickable)
        .map((d) => ({ name: d.name, faction: d.faction, avatar: this.avatars.keyFor(d.name), claimed: held.has(foldName(d.name)), reserved: false }));
    }
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
    // A story timer's crew lines (a faction-mode `add` in an `every` rule or
    // a watcher) post now, after the tick line, as a replay posts them.
    this.draftCrewNotices(evs);
    if (evs.length > 0 || this.crewWaiting) {
      this.flushTick();
      // C6 (m2): a mark a story timer made (the summons' late watcher) is
      // stamped now, at the tick line's end, as a replay stamps it — not at
      // the next journaled mutation, and never "now" in the meantime.
      this.marks.observe(this.sim);
      this.fanout(evs);
      this.spatial.syncKing(); // a story timer is a committed mutation too (journaled as the tick)
    } else if (this.pendingTickMs >= 15000) {
      this.flushTick();
    }
    // A caught poster's minute is up: the booths' boards drop it (BN2-FC).
    if (this.marks.postersLapsed(this.sim.elapsed())) this.pushSnapshots();
    this.checkPresence(ms);
    this.sweepEphemeral();
    this.sweepWallet();
    this.closeStaleTalk(); // wave 32 (C4): before the sweep, so no hold note for it
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
      this.persistAgentWaits(); // the shifted waits, and no pause
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
    // Wave 59: her ✓ Done behind paused doors was his cue, and the scene is gone.
    const owed = this.handoverOwed;
    this.handoverOwed = false;
    if (owed && this.sim !== null && worldString(this.sim.world.peek("Night.trabolta_introduced")) !== "true") this.deskFire(HANDOVER_CUE, PROMPTER_BY);
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
    this.persistAgentWaits(); // when the pause began, for a restart inside it
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
    this.releasedTokens.clear();
    this.persistGuests();
    this.pairing.clear();
    this.rejoin.clear();
    this.personaOwners.clear();
    // Wave 53: a guest's id dies with the run, a part's name does not, and
    // seqs start over: `10:Clippy` must not answer the new run's card 10.
    this.answeredWidgets.clear();
    this.caller = null; // C8: the caller claim is memory only, cut by every restart
    // Operator play-as sessions follow the sessions they stand in for: a
    // guest's dies with every restart, a booth's only when the show goes live.
    this.endImpersonations((imp) => imp.role === "guest" || kind === "golive");
    this.terminalVisits.clear();
    this.endClients("guest");
    // Push follows the sessions: every guest's device unbinds (the phone
    // re-subscribes when it re-joins), a booth's only when the show goes live.
    this.push.drop((owner) => owner.startsWith("guest:") || (kind === "golive" && owner.startsWith("prime:")));
    // Wave 41 (C4): the letters follow the same rule: every guest's inbox
    // dies with the story it was given in, a booth's when the show goes live.
    this.letters.clear((e) => e.kind === "guest" || kind === "golive");
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
    this.talkDirection = null; // wave 32: the public request was memory-only
    this.rulingsDue.clear();
    this.spatial.reset(kind);
    // (wave 39) The module plays the config's `boot` look after a story
    // reset: so does the estimate (before the entry beat's own cues).
    this.estimate();
    this.lightsEstimate.boot(this.lights.config(), this.spatialHouse(), this.clock());
    this.gameLights.changed();
    // Every session just ended: the voice streams close (games re-begin,
    // terminals reconnect to a fresh routing).
    this.voice.reset();
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
    clearInterval(this.lettersTimer);
    this.costume.clear();
    this.desk.dispose();
    if (this.prompterTimer !== null) clearInterval(this.prompterTimer);
    this.prompterTimer = null;
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
    this.gameLights.dispose();
    this.voice.reset();
    this.spatial.detachAll();
    this.audio.endWalkers();
    for (const s of [...this.spatialStreams, ...this.walkerStreams]) {
      try {
        s.end();
      } catch {
        /* viewer already gone */
      }
    }
    this.spatialStreams.clear();
    this.walkerStreams.clear();
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
      // C6: each line's changes, stamped at the story clock they happened at.
      this.marks.observe(this.sim);
      if (e.m === "tick" || (e.m === "fireBeat" && entry !== null && e.a[0] === entry)) this.entryPlayed = true;
      if (e.m === "wallet") {
        // A wallet op: the book re-applies it (balances, grants, signals,
        // cards) exactly as it did live.
        if (this.wallet !== null) {
          try {
            this.factsWatch.mark(this.sim!, e.by ?? null);
            const batch = this.wallet.apply(e.a[0] as WalletOp);
            events++;
            this.chat.append(composeGuestMessages(this.sim!, batch, this.composeOpts));
            const notices = this.sim!.crews.takeNotices(); // as `commitWallet` drafts them live
            if (notices.length > 0) this.chat.append(crewDrafts(this.sim!, notices));
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
            // Wave 48 (C2, C8): the filter's strength, flags and censors, from the journal.
            if (e.a[0] === SWEAR_FLAGGED || e.a[0] === SWEAR_CENSORED || e.a[0] === SWEAR_FILTER) this.replayFilter(e.a);
            // An agent's own use of a power counts against its `limit:` again.
            if (e.by === `${AGENT_BY}${String(e.a[3])}` && Array.isArray(out) && powerSpent(out as SimEvent[])) {
              const def = this.sim!.model.interactions.get(String(e.a[0]));
              if (def !== undefined && def.who === "agent") this.agentPowerUses.set(def.id, (this.agentPowerUses.get(def.id) ?? 0) + 1);
            }
          }
          if (Array.isArray(out)) {
            const batch = out as SimEvent[];
            for (const [menu, channel] of menuChannelsFor(batch, this.lastSpeakers)) this.menuChannels.set(menu, channel);
            for (const ev of batch) {
              if (ev.type === "choicePrompted" && ev.person !== null) {
                this.decisionChannels.set(ev.person, decisionChannelFor(batch, ev.person));
              }
            }
            const drafts = composeGuestMessages(this.sim!, batch, this.composeOpts);
            // A director's speech *as* a participant keeps its attribution
            // across a restart — the same rule `fanout` applies live.
            if (e.m === "say" && e.by !== undefined && this.sim!.persons.has(String(e.a[0]))) {
              for (const d of drafts) if (d.kind === "line") d.via = e.by;
            }
            this.chat.append(drafts);
          }
          // Wave 18b: after every line, as `commit` drafts them live (a crew
          // op's, or a faction-mode join / defect / add leaving a crew).
          const notices = this.sim!.crews.takeNotices();
          if (notices.length > 0) this.chat.append(crewDrafts(this.sim!, notices));
        } catch {
          /* tolerate a single bad/torn entry rather than abort recovery */
        }
      }
    }
    this.marks.observe(this.sim);
    if (this.sim !== null) for (const k of answeredInviteCards(this.chat.all(), this.sim.crews)) this.answeredWidgets.add(k); // w18 crews
    this.chat.loadHidden(this.store.loadHidden());
    this.spatial.restoreRuns(this.store.loadRuns().map(parseDuckRun).filter((r): r is DuckRun => r !== null));
    this.spatial.restorePrefs(parsePrefsBook(this.store.loadSpatialPrefs()));
    for (const m of this.chat.all()) if (this.isExpired(m)) this.notifiedExpired.add(m.seq);
    for (const id of [...this.decisionChannels.keys()]) {
      if (this.sim?.pendingChoiceFor(id) == null) this.decisionChannels.delete(id);
    }
    this.pruneMenuChannels();
    this.setPhase(meta.phase);
    for (const [id, owner] of meta.owners ?? []) this.personaOwners.set(id, owner);
    const entries = this.store.loadSessions();
    this.sessions.load(entries);
    // C4: host follows the part in the story this run plays (a session
    // signed in before `sync-show` gave its part `admin: true`, or since it
    // lost it).
    this.rederiveHosts();
    for (const [token, id] of this.store.loadGuests()) this.guestTokens.set(token, id);
    this.rejoin.badges.load(this.store.loadBadges());
    const waits = this.store.loadAgentWaits();
    this.requeueAgentThreads(waits);
    this.noteRulingsDue();
    this.syncConditionalAvatars(); // wave 18b: the replayed world's `when` pictures
    this.spatial.syncKing(); // the replayed world's King
    this.screens.adopt(this.sim!); // the replayed journal is the screens' history
    if (this.phase === "open") this.startTicker();
    // Restored with the doors paused: the re-asked requests wait out the
    // pause like live ones do — from when it began, if a restart came
    // inside it (so the resume shifts the whole pause, as live).
    else if (this.phase === "paused") this.pausedAt = waits?.pausedAt ?? this.clock();
    this.persistAgentWaits();
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
          sendJson(res, 401, { error: this.notSignedIn(token) });
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
        client.pane = imp.terminal !== true;
        client.token = token;
        client.admin = false;
        // A director's pane of a host part is a host booth (C4).
        client.host = imp.host === true;
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
        // Wave 42b (B2): a phone back from sleep learns its place in line.
        this.replayAgentWaits(client);
        // Wave 59: and where the prompter is. A scene that has gone reads null.
        const member = role === "guest" ? id : role === "prime" && client.host !== true && client.admin !== true ? `@${id}` : null;
        sseSend(res, "prompter", this.prompters.frame(member));
      }
      if (!fullMod) this.pushPresence();
      const ping = setInterval(() => {
        sseWrite(res, ":ping\n\n");
        if (ownGuest) this.seen(id, false, EventRuntime.STREAM_SEEN_EVERY_MS);
      }, 25000);
      req.on("close", () => {
        clearInterval(ping);
        // A part released or taken back (`endBooths`) left already: no grace.
        const live = this.clients.delete(client);
        if (ownGuest) this.seen(id, true);
        if (live && role === "prime") this.boothSeen.set(id, this.clock());
        if (role !== "mod") this.streamLeft.set(role === "prime" ? `@${id}` : id, Date.now());
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
      const token = queryTokenOf(req, url);
      if (opts.moderator !== true && !this.canHostToken(token)) {
        sendJson(res, 403, { error: "moderators only" });
        return true;
      }
      // Wave 59: a host's phone never receives a persona's row; Run does, and
      // a director's own phone or pane of a host part.
      const director = opts.moderator === true || this.sessions.canModerate(token) || this.directorPane(token);
      sendRecap(res, url, this.sim, { title: this.title, personas: this.personaOwners, duckRuns: this.spatial.runs(), ...(director ? {} : { hide: directorIds(this.sim, this.personaOwners) }) });
      return true;
    }
    // --- wave 41 (C5): Trabolta's letters (directors only, never a host booth) ---
    if (method === "GET" && path === "/api/mod/letters") {
      if (opts.moderator !== true && !this.sessions.canModerate(queryTokenOf(req, url))) sendJson(res, 403, { error: "moderators only" });
      else sendJson(res, 200, lettersView(this.lettersContext()));
      return true;
    }
    // --- wave 44 (C6): who opted out of the video (directors only, never a host booth) ---
    if (method === "GET" && path === VIDEO_ROUTE) {
      if (opts.moderator !== true && !this.sessions.canModerate(queryTokenOf(req, url))) sendJson(res, 403, { error: "moderators only" });
      else if (this.sim === null) sendJson(res, 409, { error: "no scenario loaded" });
      else sendVideoConsent(res, url, videoConsentView(this.sim, { isPersona: (id) => this.personaOwners.has(id) || id.startsWith("p-"), avatarOf: (name) => this.avatars.keyFor(name) }));
      return true;
    }
    // --- wave 44 (C5): the credits (a moderator always; a booth or guest once they roll) ---
    if (method === "GET" && path === CREDITS_ROUTE) {
      const token = queryTokenOf(req, url);
      const caller = opts.moderator === true || this.sessions.canModerate(token) ? "mod" : this.guestOf(token) !== null || this.sessions.has(token) ? "player" : "none";
      sendCredits(res, creditsAnswer(caller, await this.credits.read(), this.sim, (id) => this.personaOwners.has(id) || id.startsWith("p-")));
      return true;
    }
    // --- wave 14: the scan-from-the-screen cards (directors only, never a host booth) ---
    if (method === "GET" && path === "/api/mod/cards") {
      const token = queryTokenOf(req, url);
      if (opts.moderator === true || this.sessions.canModerate(token)) await this.sendCards(res);
      else sendJson(res, token === undefined ? 401 : 403, { error: "moderators only" });
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
        // Often a moment, not the picture (Wikipedia slow, the fetch still
        // running): never cached, so the phone's retry asks again (wave 36).
        res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: "no such picture" }));
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
          sendJson(res, 401, { error: this.notSignedIn(token) });
          return true;
        }
        sendJson(res, 200, this.guestViewFor(gid, new Set(this.agents.onlineCharacters()), undefined, undefined, this.directorPane(token)));
        return true;
      }
      if (role === "prime") {
        const character = this.characterOf(token);
        if (character === null) {
          sendJson(res, 403, { error: "no character — sign in" });
          return true;
        }
        sendJson(res, 200, this.primeViewFor(character, new Set(this.agents.onlineCharacters()), undefined, this.canHostToken(token), undefined, this.directorPane(token)));
        return true;
      }
      // `?host=1` (wave 13): a host booth's panel — the cue sheet, needs,
      // judging, wallet holds, parts, people and Trabolta's waiting guests.
      if (url.searchParams.get("host") === "1") {
        if (opts.moderator !== true && !this.canHostToken(token)) {
          sendJson(res, 403, { error: "moderators only" });
          return true;
        }
        res.setHeader("cache-control", "no-store");
        sendJson(res, 200, this.hostViewNow(this.directorPane(token)));
        return true;
      }
      if (opts.moderator !== true && !this.sessions.canModerate(token)) {
        sendJson(res, 403, { error: "moderators only" });
        return true;
      }
      // `?cues=1` (W-26): the director phone's lean read — just the cue sheet.
      if (url.searchParams.get("cues") === "1") {
        sendJson(res, 200, { ...cueSheetView(this.modViewNow()), rejoins: this.rejoin.asks(), prompter: this.prompters.status() });
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
          sendJson(res, 401, { error: this.notSignedIn(token) });
          return true;
        }
        id = gid;
      }
      const messages = this.chat.historyFor(id, admin).filter((m) => !this.isExpired(m));
      // A host booth moderates too, but reads no director's `via`.
      const booth = admin && opts.moderator !== true && this.characterOf(token) !== null;
      const hide = this.namesHiddenFrom(opts.moderator === true || this.directorPane(token));
      sendJson(res, 200, { messages: admin ? (booth ? messages.map((m) => forBooth(m, hide)) : messages) : messages.map((m) => forGuest(m, this.sim, id, hide)) });
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
      // Wave 25: a terminal's talk= / said= may end a desk speech step; wave
      // 59: or free the teleprompter.
      queueMicrotask(() => {
        this.desk.poke();
        this.prompters.tick();
      });
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
        () => showClock(this.sim, this.phase === "open"),
        // Programs walking the simulation right now: a house terminal shows
        // them even while the character is hidden or asleep.
        () => this.spatial.players().length,
        {
          // Wave 18b: the facts ledger's public results, built only while
          // a reading's slide is up or the verdict's window is open.
          results: (q) => {
            const book = this.factsBook();
            const view = this.factsView();
            return book === null || view === undefined ? [] : screenResultsOf(view, book, q.ids, { kind: q.kind, tv: q.tv, truths: q.truths });
          },
          // Q8: is this map spot on `audio.json`'s announce list?
          spotAnnounce: (spot) => this.audio.current().audio.announce?.terminals?.includes(spot) === true,
          // Wave 26 (C4, R5): players whose presence room is this spot's
          // room — the terminal's link to the Internet (null: no map / no such spot).
          spotHere: (spot) => this.spatial.spotHere(spot),
          // Wave 48b (C12): the filter's book for the Language Report.
          language: () => ({ words: this.filter.wordCounts(), unsaid: this.filter.unsaid, level: this.filter.level, stars: this.filter.stars }),
          // Wave 59: his lines wait for the teleprompter.
          voiceHeldFrom: (channel) => this.prompters.heldFrom(channel),
        },
      );
    }
    // --- the house speakers (wave 17, audio.ts): the config + stagehand's long poll ---
    // --- the house mixer (wave 40): a director's or a host's panel ---
    if (method === "GET" && path === "/api/mod/audio/mixer") return handleMixerGet(this.audio, this.audioContext(), req, res, url, (t) => opts.moderator === true || this.canHostToken(t));
    if (method === "GET" && path === "/api/mod/audio") return handleAudioGet(this.audio, this.audioContext(), req, res, url, (t) => opts.moderator === true || this.sessions.canModerate(t));
    // --- the footsteps (wave 49, C3.1): the router's stream, a director's alone ---
    if (method === "GET" && path === "/api/mod/audio/walkers") {
      if (opts.moderator !== true && !this.sessions.canModerate(queryTokenOf(req, url))) {
        sendJson(res, 403, { error: "moderators only" });
        return true;
      }
      this.openWalkersStream(req, res);
      return true;
    }
    // --- the house desk (wave 25, desk.ts): the view + its long poll (hosts too) ---
    if (method === "GET" && path === "/api/mod/desk") {
      const token = queryTokenOf(req, url);
      // A booth's view (a host) reads every director as "Director".
      const booth = opts.moderator !== true && (this.hostOnly(token) || this.characterOf(token) !== null);
      const model = this.sim?.model ?? this.declaredModel;
      return handleDeskGet(this.desk, this.deskContext(), req, res, url, (t) => opts.moderator === true || this.canHostToken(t), booth ? deskSeen((by) => seenName(by, model)) : undefined);
    }
    // --- the house lights (wave 20, lights.ts): the config + the lights module's long poll ---
    if (method === "GET" && path === "/api/mod/lights") return handleLightsGet(this.lights, this.lightsContext(), req, res, url, (t) => opts.moderator === true || this.sessions.canModerate(t));
    // Wave 59: the costume's switch and link (a director's; never on the host allowlist).
    if (method === "GET" && path === COSTUME_MOD_ROUTE) {
      if (opts.moderator !== true && !this.sessions.canModerate(queryTokenOf(req, url))) sendJson(res, 403, { error: "moderators only" });
      else sendJson(res, 200, { on: !this.store.loadCostumeOff(), url: this.costumeLink() });
      return true;
    }
    if (method === "GET" && path === "/api/mod/screen/terminals") return handleScreenTerminalsGet(this.screens, req, res, url, (t) => opts.moderator === true || this.sessions.canModerate(t), (spot) => this.cams.rate(spot));
    // A host booth may mute the TV and identify a terminal (§2.7). Both are
    // host-visible writes handled before the generic body parse, so they
    // drop the host panel's cached build themselves (recheck item 8: the
    // mute toggle's re-poll read the old state for up to 2 s).
    if (method === "POST" && (path === "/api/mod/screen/voice" || path === "/api/mod/screen/identify")) this.bumpHostWrites(res);
    if (method === "POST" && path === "/api/mod/screen/voice") return handleScreenVoicePost(this.screens, req, res, (t) => opts.moderator === true || this.canHostToken(t));
    if (method === "POST" && path === "/api/mod/screen/identify") return handleScreenIdentifyPost(this.screens, req, res, (t) => opts.moderator === true || this.canHostToken(t));

    // --- the descent's words (wave 49, C3.2): a game's, or the map editor's ---
    if (method === "GET" && path === "/api/spatial/descent") {
      if (!this.spatialReader(queryTokenOf(req, url), opts.moderator === true)) {
        sendJson(res, 401, { error: "a moderator or game session token is required" });
        return true;
      }
      sendJson(res, 200, { script: (await this.descent.read()).file });
      return true;
    }
    // --- the reinstallation games: the map, the stream, stations ---
    if (method === "GET" && (path.startsWith("/api/spatial/") || path.startsWith("/api/mod/spatial/"))) {
      if (this.handleSpatialGet(req, res, path, url, opts.moderator === true)) return true;
    }

    // --- K-31a push config (public) ---
    if (this.pushRoutes.handleGet(method, path, res)) return true;

    if (method !== "POST") return false;

    // --- the voice link (§2.4): raw μ-law chunks (≤ 8 KB, 5/s per source),
    // ahead of the 2 KB JSON cap below ---
    if (path === "/api/spatial/voice") return this.handleVoiceUpload(req, res, url, opts.moderator === true);
    // --- a game's own calls (pose at 10 Hz, found, end): tiny bodies, read
    // under their own cap before the generic parse ---
    if (path.startsWith("/api/spatial/")) {
      return this.handleSpatialPost(req, res, path, await readBody(req, SPATIAL_BODY_LIMIT));
    }
    // --- a terminal's camera frame (~3/s, ≤ 96 KB): its own cap, too ---
    if (path === "/api/mod/spatial/cam") return this.handleCamUpload(req, res, opts.moderator === true);

    const body = await readBody(req);

    // Wave 59: the costume's token opens these two and nothing else.
    if (path === COSTUME_MENU_ROUTE || path === COSTUME_FIRE_ROUTE) return this.handleCostume(req, res, path, body);

    // The host allowlist for POSTs (the same rule as the GETs above).
    if (opts.moderator !== true && this.hostOnly(tokenOf(req, body)) && isModSurface(method, path, body) && !isHostRoute(method, path, body, this.hostRouteContext())) {
      sendJson(res, 403, { error: NOT_FROM_A_BOOTH });
      return true;
    }
    this.noteHostWrite(path, tokenOf(req, body), res);

    if (this.pushRoutes.handlePost(req, res, path, body)) return true;
    if (path === RESUME_ROUTE) {
      if (this.throttled(req, res)) return true;
      if (this.pairing.handlePublic(path, res, body)) {
        if (res.statusCode !== 200) this.loginFailures.record(ipOf(req));
        return true;
      }
    }
    {
      // Wave 23: enter by badge / invitation, ask a host (routes/rejoin.ts).
      // The cheap check first: only a rejoin path is throttled here.
      if (path.startsWith("/api/guest/enter") || path.startsWith("/api/guest/rejoin")) {
        if (this.throttled(req, res, this.rejoin.passesLockout(path, body))) return true;
        const r = this.rejoin.handlePublic(path, res, body, tokenOf(req, body));
        if (r.handled) {
          if (r.failed) this.loginFailures.record(ipOf(req));
          return true;
        }
      }
    }
    if (path === BADGE_ROUTE) {
      const t = tokenOf(req, body);
      this.rejoin.linkFor(res, this.phoneGuest(t) ?? null, body);
      return true;
    }
    if (path === HOMESCREEN_ROUTE) {
      const t = tokenOf(req, body);
      return this.pairing.homescreen(res, this.phoneGuest(t));
    }
    if (path === LOGOUT_ROUTE) return this.pairing.logout(res, tokenOf(req, body));
    if (path === GUEST_LOGOUT_ROUTE) return this.pairing.guestLogout(res, this.phoneGuest(tokenOf(req, body)));

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
    if (path === "/api/agent/letter") {
      // Wave 41 (C6): the writer's draft of one letter.
      if (opts.moderator !== true && !this.sessions.canModerate(tokenOf(req, body))) {
        sendJson(res, 403, { error: "moderators only" });
        return true;
      }
      handleAgentLetter(this.letters, body, res);
      this.agents.pump(); // wave 42: the draft freed a windowed worker's slot
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
      // Wave 54: `invited` names the program a claim opens, so a printed
      // badge lands on that program, not the picker.
      const invited = role === "guest" ? this.claims.characterOf(this.sim?.model ?? null, claim) : null;
      sendJson(res, 200, { role, identities: this.identities(role, claim), search: role === "guest" && this.wiki !== null, doorsOpen: this.open, ...(invited !== null ? { invited } : {}) });
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
      if (!opts.moderator && !this.canHostToken(caller)) {
        sendJson(res, 403, { error: "moderators only" });
        return true;
      }
      // The journal's `by`: the author's name, the director of a play-as
      // pane (C4), a booth's own part (`Booth · Task Manager`), else a
      // headless mod token's "Director".
      const booth = opts.moderator === true ? null : this.characterOf(caller);
      const by = opts.moderatorName ?? imp?.by ?? (booth !== null ? `Booth · ${booth}` : "Director");
      const hostOnly = opts.moderator !== true && this.hostOnly(caller);
      // Wave 41 (C5): never on the host allowlist, so a host-only token
      // was refused above.
      if (handleLettersPost(this.lettersContext(), path, body, res, by)) return true;
      if (path === "/api/mod/spatial/house/project") return this.saveMapToProject(res, body, opts.moderatorName ?? "Director");
      if (path === "/api/mod/audio" || path.startsWith("/api/mod/audio/")) {
        const project = this.project;
        const link = project === null ? null : { writeFile: (file: string, text: string) => project.writeFile(file, text), saveSnapshot: () => project.saveSnapshot(this.dataSnapshot(this.projectMaps ?? {})) };
        if (await handleAudioPost(this.audio, this.audioContext(), path, body, res, link, by)) {
          this.noteDeskAudio(path, res, by);
          // Wave 53 (C5): 🔇 + the announcement cuts the phones too.
          if (path === "/api/mod/audio/stop" && body["announce"] === true && res.statusCode === 200) this.phoneAnnounce({ stop: true });
          return true;
        }
      }
      if (path === "/api/mod/desk" || path.startsWith("/api/mod/desk/")) {
        // A booth reaches go / standby / stop / check only (the host allowlist).
        const project = this.project;
        const link = project === null ? null : { writeFile: (file: string, text: string) => project.writeFile(file, text), saveSnapshot: () => project.saveSnapshot(this.dataSnapshot(this.projectMaps ?? {})) };
        if (await handleDeskPost(this.desk, this.deskContext(), path, body, res, link, by)) return true;
      }
      if (path === "/api/mod/lights" || path.startsWith("/api/mod/lights/")) {
        // A booth reaches only `/api/mod/lights/test` here (wave 25, the host allowlist).
        const project = this.project;
        const link = project === null ? null : { writeFile: (file: string, text: string) => project.writeFile(file, text), saveSnapshot: () => project.saveSnapshot(this.dataSnapshot(this.projectMaps ?? {})) };
        if (await handleLightsPost(this.lights, this.lightsContext(), path, body, res, link, by)) {
          if (path === "/api/mod/lights/test" && res.statusCode === 200) {
            const t = this.lights.tests().at(-1);
            if (t !== undefined) this.desk.note({ kind: t.look !== undefined ? "look" : "light", text: t.look !== undefined ? `💡 test look ${t.look}` : `💡 test ${t.fixture ?? "?"}${t.set !== undefined ? ` ${JSON.stringify(t.set)}` : ""}`, by });
          }
          return true;
        }
      }
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
      this.actingToken = caller;
      try {
        return this.handleMod(res, path, body, by, hostOnly);
      } finally {
        this.actingToken = undefined;
      }
    }

    return false;
  }

  /** Every codex entry with a code and its printable link — the QR a
   *  guest scans on the wall: `?code=<event>&unlock=<code>`. */
  private codexLinks(base: string, model: SimModel | null = this.sim?.model ?? null): { id: string; title: string; about: string | null; code: string; url: string; secret: boolean }[] {
    return [...(model?.codex.values() ?? [])]
      .filter((e) => e.code !== null)
      .map((e) => ({
        id: e.id,
        title: e.title,
        about: e.about,
        code: e.printed ?? e.code!,
        url: `${base}/?code=${encodeURIComponent(this.codes.event)}&unlock=${encodeURIComponent(e.code!)}`,
        secret: e.secret,
      }));
  }

  /** `GET /api/mod/cards` (wave 14): every QR card for the `/cards` page —
   *  the same links as `/api/mod/codes`, each drawn as an SVG. */
  private async sendCards(res: ServerResponse): Promise<void> {
    const base = this.joinBase();
    // Before the doors the story's declared model stands in (nothing played).
    const model = this.sim?.model ?? this.declaredModel ?? null;
    sendJson(
      res,
      200,
      await buildCards({
        title: this.title,
        eventPass: this.codes.event,
        codex: this.codexLinks(base, model),
        extras: printExtras(model, base, this.codes.event, this.claimSecret, this.factsBook()?.raw ?? null),
        claims: this.claims.links(model, base, this.codes.event),
        staff: this.performerParts.map((character) => {
          const part = partCode(this.claimSecret, character);
          return { character, code: printedCode(part), url: partUrl(base, this.codes.event, part) };
        }),
      }),
    );
  }

  /** A token holding the host capability but not the moderator one — a
   *  host part's booth, or a director's play-as pane of one (C4). */
  private hostOnly(token: string | undefined): boolean {
    const imp = token ? this.impersonations.get(token) : undefined;
    if (imp !== undefined) return imp.host === true;
    return this.sessions.canHost(token) && !this.sessions.canModerate(token);
  }

  /** Was this booth's scan of this guest (`key`) already made within
   *  `SCAN_REPEAT_MS`? Records the scan when it was not. In memory only. */
  private scanRepeated(key: string): boolean {
    const now = this.clock();
    const last = this.lastScans.get(key);
    if (last !== undefined && now - last >= 0 && now - last < SCAN_REPEAT_MS) return true;
    if (this.lastScans.size > 500) for (const [k, t] of this.lastScans) if (now - t >= SCAN_REPEAT_MS) this.lastScans.delete(k);
    this.lastScans.set(key, now);
    return false;
  }

  /** May this token act as a host (`canHost`, or a play-as pane of a host part)? */
  private canHostToken(token: string | undefined): boolean {
    const imp = token ? this.impersonations.get(token) : undefined;
    if (imp !== undefined) return imp.host === true;
    return this.sessions.canHost(token);
  }

  /**
   * C4: each booth session's host follows its part's `admin: true` in the
   * story now loaded — granted to a part that has it, taken from one that
   * lost it (a passcode admin keeps admin, so stays a host). Connected booth
   * streams follow (their next snapshot says `host`). Persisted on a change.
   */
  private rederiveHosts(): void {
    const model = this.sim?.model ?? this.declaredModel;
    if (model === null) return;
    let changed = false;
    for (const [token, session] of this.sessions.entries()) {
      if (session.character === null) continue;
      // C8: the caller capability follows the story's `by:` lines too.
      const calls = isCaller(model, session.character);
      if (calls !== (session.caller === true)) {
        if (calls) this.sessions.grant(token, { caller: true });
        else this.sessions.revokeCaller(token);
        changed = true;
      }
      const want = model.characters.get(session.character)?.admin === true;
      if (want === (session.host === true)) continue;
      if (want) this.sessions.grant(token, { host: true });
      else this.sessions.revokeHost(token);
      changed = true;
    }
    if (changed) this.persistSessions();
    for (const c of this.clients) {
      if (c.role !== "prime") continue;
      if (c.via !== undefined) {
        const imp = c.token !== undefined ? this.impersonations.get(c.token) : undefined;
        if (imp !== undefined) imp.host = model.characters.get(imp.id)?.admin === true;
        c.host = imp?.host === true;
        continue;
      }
      const own = this.sessions.entries().find(([, s]) => s.character === c.id);
      if (own !== undefined) c.host = this.sessions.canHost(own[0]);
    }
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
    // Wave 26 (C2): a locked phone writes nothing — checked once, here,
    // ahead of the crew and recruit routes (dispatched before the switch).
    if (this.lockedOut(req, path, body)) {
      sendJson(res, 403, { error: "locked" });
      return true;
    }
    if (this.crewRoutes.handleGuest(req, res, path, body)) return true; // w18 crews
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
        // Cleaned (NFKC, no zero-width / bidi / format characters): a
        // lookalike of a taken name folds onto it and is refused (409).
        let name = clipName(cleanGuestName(str(body, "name")), 48).trim() || "Guest";
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
          name = cleanGuestName(hit.title);
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
        // An invited badge carries its own invitation (wave 59).
        const rawBadge = str(body, "badge").trim();
        const claim = str(body, "claim").trim() || this.rejoin.claimOn(rawBadge);
        // Wave 59: a sent card speaks first (`Rejoin.joinCard`), so the loser
        // of a race reads the refused screen, then the name. Null once it has
        // answered. Asked again after every await below, or two phones could
        // both pass and become one program.
        const mayJoin = (): { badge: number | null } | null => {
          const card = this.rejoin.joinCard(rawBadge, claim, name);
          if (card.kind === "person") {
            this.rejoin.resume(res, card, undefined);
            return null;
          }
          if (card.kind === "reserved") {
            sendJson(res, 409, reservedAnswer(card.name));
            return null;
          }
          const refusal = guestNameRefusal(this.sim!.model, name, takenNames(this.sim!.persons.values()), (c) => this.claims.mayClaim(c, claim));
          if (refusal !== null) {
            sendJson(res, 409, { error: refusal });
            return null;
          }
          return card;
        };
        if (mayJoin() === null) return true;
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
        const joining = mayJoin();
        if (joining === null) return true;
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
        // Wave 23: the badge they scanned on the way in is theirs now.
        const { badge } = joining;
        if (badge !== null) this.rejoin.link(badge, id);
        sendJson(res, 200, { id, name, token, avatar: this.avatars.keyFor(name), ...(badge !== null ? { badge } : {}) });
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
        const stays = this.staysWithSide(id, side);
        if (stays !== null) {
          sendJson(res, 409, { error: stays });
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
        const stays = this.staysWithSide(id, side);
        if (stays !== null) {
          sendJson(res, 409, { error: stays });
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
        this.chooseFor(id, body, res);
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
        // An invitation is answered through its own route, which joins
        // (A8: answered here it was spent and joined nothing).
        if (m.widget.kind === "invite") {
          sendJson(res, 409, { error: "answer an invitation with /api/guest/recruit/answer" });
          return true;
        }
        const parsed = this.widgetArgsOf(body["result"], m.widget.kind);
        if (parsed === "bad_email" || parsed === null) {
          sendJson(res, 400, { error: parsed ?? "bad widget result" });
          return true;
        }
        const { args, email } = parsed;
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
        // Wave 41 (C2): the inbox goes to the letters book, never the journal.
        if (email !== null) this.letters.set("guest", id, email);
        // `card` rides the journaled args so a restart rebuilds the
        // answered set (`restore`) — the story sees it as one more argument.
        const answered = () => this.commit("signal", `${m.widget!.kind} answered`, id, { ...args, ...(judged?.args ?? {}), card: seq });
        // Not an exact match in auto mode: the story's `judge:` character
        // rules on it when its worker can (wave 11b near misses, wave 18b
        // every other filing) — else wave 11's rule: a near miss waits,
        // proposed accurate; a plain miss is judged at once.
        // The ruling is asked once the filing is in (and the mode is back),
        // before the `# hosts` line, so the line never claims an ask that
        // did not land.
        const ruler = judged !== null && judged.review ? judged.ruler : null;
        const who = this.sim!.persons.get(id)?.name ?? id;
        const question = args["question"];
        const notice = () => {
          if (judged === null) return null;
          const asked = ruler !== null && typeof question === "string" && this.askRuling(id, question) ? ruler : null;
          if (judged.near !== null) return nearNotice(who, args, judged.near, asked);
          return ruler === null ? null : missNotice(who, args, judged.verdict ?? "uncertain", asked);
        };
        this.fanout(judged?.review === true ? this.commitUnderReview(answered, notice) : answered());
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
        const said = this.fanout(this.commit("say", id, channel, this.unsaidMasked(text), parentSeq), this.actingBy);
        this.flagGuestLine(id, text, said); // w48
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

      case PRINTED_GUEST_ROUTE: {
        const id = this.requireGuest(req, body, res);
        if (id === null) return true;
        this.answerPrinted(res, id, body);
        return true;
      }

      case "/api/aloud": {
        // Wave 59: a phone on the shared teleprompter. Never journaled: no
        // story reads it, and a locked program's script still scrolls.
        const caller = this.prompterCaller(tokenOf(req, body));
        if (caller === null) {
          sendJson(res, 401, { error: "not signed in" });
          return true;
        }
        const op = readPrompterOp(body);
        const scene = Number(body["scene"]);
        if (op === null || !Number.isInteger(scene)) {
          sendJson(res, 400, { error: "scene and op" });
          return true;
        }
        const refused = this.prompters.op(scene, caller.who, caller.host, op);
        this.prompterClock();
        // Never a word a phone's session reads (`locked`, a 410): it reads the next frame.
        if (refused !== null) sendJson(res, 409, { error: `prompter: ${refused}` });
        else sendJson(res, 200, { ok: true });
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
        // No code is that long: a wall of text is refused before the journal
        // (a miss is journaled verbatim), and costs no miss.
        if (code.length > MAX_CODE_LENGTH) {
          sendJson(res, 400, { error: "not a code" });
          return true;
        }
        // Past the miss cap every redeem waits (a hit too — else guessing
        // just goes on unjournaled), and nothing reaches the journal.
        if (!this.redeemMisses.allowed(id)) {
          sendJson(res, 429, { error: "too many wrong codes — wait a minute" });
          return true;
        }
        // Wave 59: a badge's, a room's or a sign's printed code is no wrong
        // code, whichever box it came through: the Scan sheets ask first
        // (`/api/guest/printed`), a terminal's TYPE A CODE doesn't.
        const printed = this.printedHit(code);
        if (printed !== null) {
          sendJson(res, 200, { ok: true, unlocked: null, printed: printed.kind, codex: guestView(this.sim!, id).codex });
          return true;
        }
        // Wave 59: the Scan sheet's box takes a code with spaces in it and
        // offers a room's name, so a phrase from it (`spaced`) that opens
        // nothing was never a guess at a code: a plain answer and no story
        // event. It still counts against the throttle, or a space would buy
        // free guesses.
        if (body["spaced"] === true && /\s/u.test(code) && !this.sim!.model.codexCodes.has(foldCode(code))) {
          this.redeemMisses.record(id);
          sendJson(res, 200, { ok: true, unlocked: null, words: true, codex: guestView(this.sim!, id).codex });
          return true;
        }
        const events = this.commit("redeem", id, code);
        this.fanout(events);
        if (events.some((e) => e.type === "codexMissed" && e.person === id)) this.redeemMisses.record(id);
        const hit = events.find((e): e is Extract<SimEvent, { type: "codexUnlocked" }> => e.type === "codexUnlocked" && e.person === id);
        const missed = events.some((e) => e.type === "codexMissed" && e.person === id);
        // Wave 18b (R1): the entry's title for a hit, and for a code whose
        // entry the guest already holds (`already`) — looked up only once
        // they hold it, so a miss never names a code's entry.
        let already: string | null = null;
        if (hit === undefined && !missed) {
          const entry = this.sim!.model.codexCodes.get(foldCode(code));
          if (entry !== undefined && this.sim!.holdsCodex(id, entry)) already = entry;
        }
        const shown = hit !== undefined ? hit.entry : already;
        const title = shown !== null ? (this.sim!.model.codex.get(shown)?.title ?? null) : null;
        sendJson(res, 200, {
          ok: true,
          unlocked: hit !== undefined ? hit.entry : null,
          ...(title !== null ? { title } : {}),
          ...(already !== null ? { already } : {}),
          ...(missed ? { missed: true } : {}),
          codex: guestView(this.sim!, id).codex,
        });
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
      case PRINTED_PRIME_ROUTE: {
        const character = this.characterOf(tokenOf(req, body));
        if (!character) {
          sendJson(res, 403, { error: "no character — sign in" });
          return true;
        }
        this.answerPrinted(res, character, body);
        return true;
      }
      case "/api/prime/codex/redeem": {
        // Wave 58: a booth reads a codex QR (or types its code), so every
        // coded entry is everyone's to scan, `secret: true` ones too: `secret`
        // only hides an entry from an agent. Answers `/api/guest/codex/redeem`'s
        // shape, but a part is no Person: `Sim.redeem` would do nothing, so a
        // hit is the journaled `unlock` the mod route writes, and a miss is no
        // story event at all (no `codexMissed`, no `wrong code`, no doubt).
        // Only the limiter counts it. No ⭐, no award: those read Persons.
        const character = this.characterOf(tokenOf(req, body));
        if (!character) {
          sendJson(res, 403, { error: "no character — sign in" });
          return true;
        }
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        const code = str(body, "code").trim();
        if (code === "") {
          sendJson(res, 400, { error: "empty code" });
          return true;
        }
        if (code.length > MAX_CODE_LENGTH) {
          sendJson(res, 400, { error: "not a code" });
          return true;
        }
        if (!this.redeemMisses.allowed(character)) {
          sendJson(res, 429, { error: "too many wrong codes — wait a minute" });
          return true;
        }
        const sim = this.sim!;
        const entry = sim.model.codexCodes.get(foldCode(code));
        if (entry === undefined) {
          this.redeemMisses.record(character);
          sendJson(res, 200, { ok: true, unlocked: null, missed: true });
          return true;
        }
        // An operator playing an agent-voiced part (Run → Players) must not
        // launder lore into its prompt: the share routes' refusal holds here.
        const refusal = sim.agentRefusal(character, entry);
        if (refusal !== null) {
          sendJson(res, 403, { error: agentRefusalText(refusal) });
          return true;
        }
        const title = sim.model.codex.get(entry)?.title ?? null;
        if (sim.holdsCodex(character, entry)) {
          sendJson(res, 200, { ok: true, unlocked: null, already: entry, ...(title !== null ? { title } : {}) });
          return true;
        }
        this.fanout(this.commit("unlock", character, entry));
        sendJson(res, 200, { ok: true, unlocked: entry, ...(title !== null ? { title } : {}) });
        return true;
      }

      // --- performer (prime) login: grants the `character` capability ---
      case "/api/prime/login": {
        // A staff badge at a lockout is a printed card, not a guess (routes/rejoin.ts).
        if (this.throttled(req, res, normalizeCode(str(body, "part")) !== "" && this.rejoin.passesLockout(path, body))) return true;
        let character = str(body, "character");
        // Wave 54: a printed staff badge carries the guest code (the performer
        // code can rotate), which is good only beside a valid `part` below.
        const part = normalizeCode(str(body, "part"));
        if (!passOk(str(body, "passcode"), this.codes.prime) && !(part !== "" && passOk(str(body, "passcode"), this.codes.event))) {
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
        // Wave 23: a cast card's `part` code signs in as its part. Wave 59:
        // never by taking it: a held part refuses the card as it does the picker.
        if (part !== "") {
          const named = this.partOfCode(part);
          if (named === null) {
            this.loginFailures.record(ipOf(req));
            sendJson(res, 404, { error: "that cast card isn't one of tonight's" });
            return true;
          }
          character = named;
        }
        // A part is one performer's: every *other* session's character is
        // held; re-signing the same booth into the same part is fine.
        const others = this.sessions.entries().filter(([t]) => t !== token);
        const held = heldCharacters(others);
        const refusal = performerRefusal(model, character, held);
        if (refusal !== null) {
          const answer = held.has(foldName(character)) ? heldAnswer({ name: character }, refusal) : { error: refusal };
          sendJson(res, refusal === "unknown character" ? 404 : 409, answer);
          return true;
        }
        // A sign-in ends the asks on this part; a booth moving on frees its
        // old one, which ends those too. Its own re-scan is neither.
        const was = this.sessions.characterOf(token);
        if (was !== character) {
          this.rejoin.closeAsks(character);
          if (was !== null) this.rejoin.closeAsks(was);
        }
        token = token !== undefined && this.sessions.has(token) ? token : randomUUID();
        sendJson(res, 200, { token, character, ...this.signInPart(token, character, model) });
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
        // Wave 23: a guest's badge is their pass.
        const target = this.rejoin.scanTarget(str(body, "target"));
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
        // A double tap (📡 Scan again twice): the same booth scanning the
        // same guest again inside `SCAN_REPEAT_MS` is not a new story scan —
        // 429 `again`, nothing journaled, the fresh card for a client that
        // wants it (adversary finding: 20 taps were 20 journaled scans).
        if (scanAs !== null && this.scanRepeated(`${token ?? ""}|${scanAs}|${target}`)) {
          const again = guestCardView(this.sim!, this.chat.all(), scanAs, target, this.canHostToken(token));
          sendJson(res, 429, { error: "scanned a moment ago", again: true, ...(again !== null ? { card: again } : {}) });
          return true;
        }
        let responses: string[] = [];
        let lines: PressLines = {};
        let refused = false;
        if (scanAs !== null) {
          const events = this.commit("scan", scanAs, target);
          // D1: the story said no (only a staff-room line) — the card reads
          // "Not done: <line>" rather than a neutral note.
          refused = scanRefused(this.sim!, events);
          responses = events
            .filter((e): e is Extract<SimEvent, { type: "respond" }> => e.type === "respond" && e.to === scanAs)
            .map((e) => readoutText(e.text).text);
          // C1: the staff-room lines and what the character said to the guest.
          lines = this.boothPressLines(this.fanout(events), scanAs, target);
        }
        // Wave 13: the booth's card for this guest, after the scan's events.
        const card = scanAs !== null ? guestCardView(this.sim!, this.chat.all(), scanAs, target, this.canHostToken(token)) : null;
        sendJson(res, 200, {
          ok: true,
          scannedAs: scanAs,
          canModerate: admin,
          responses,
          ...lines,
          ...(refused ? { refused: true } : {}),
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
        const card = guestCardView(this.sim!, this.chat.all(), character, str(body, "guest"), this.canHostToken(token));
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
        // C4: a global button (some listener binds no subject) may be pressed
        // with no guest — `signal(name, null, null, character)`.
        const global = guest === "" && !interactionSubjectOnly(this.sim!, def.id);
        if (!global && !this.sim!.persons.has(guest)) {
          sendJson(res, 404, { error: "unknown guest" });
          return true;
        }
        const character = this.characterOf(token);
        // `by:` is whose button it is (its characters, a GROUP's members, and
        // any character owning a hook for it — `interactionActors`, what the
        // booth leads with): another booth's press is refused, so a ROLE hook
        // (which ignores the actor) can't be pressed from the wrong card. A
        // button with no `by:` stays anyone's; a moderator's or a host's
        // booth may press another's only when something outside its actors
        // hears it (a story rule or a ROLE hook — `pressRefusal`): the press
        // fires as the host's own character, so a button only the actors'
        // hooks hear would do nothing, and its card never offers it
        // (`primeViewFor` / `guestCardView` take `canHost`). A headless mod
        // token (no character) fires with no actor, which every hook hears,
        // so it is never refused; the director's quick-fire
        // (`/api/mod/signal`, with `actor`) still fires any.
        // Never "sign in" here: that answer drops a booth.
        const refusal = pressRefusal(this.sim!, def, character, this.canHostToken(token));
        if (refusal !== null) {
          sendJson(res, 403, { error: refusal });
          return true;
        }
        const pressed = this.commit("signal", name, global ? null : guest, null, character);
        // D1: the cue sheet's own judgement (`pressRefused`) — the story
        // turned the press down, at most saying why in a staff room.
        const refused = pressRefused(this.sim!, pressed);
        if (global) {
          const replies = character === null ? [] : pressed.flatMap((e) => (e.type === "respond" && e.to === character ? [readoutText(e.text).text] : []));
          const lines = this.boothPressLines(this.fanout(pressed), character, "");
          sendJson(res, 200, { ok: true, replies, ...lines, ...(refused ? { refused: true } : {}) });
          return true;
        }
        // Wave 13: the story's replies to this booth, and its fresh card.
        const replies = character === null ? [] : pressed.flatMap((e) => (e.type === "respond" && e.to === character ? [readoutText(e.text).text] : []));
        // C1: the staff-room lines (a refusal's reason) and what the
        // character said to the guest, for the card in place of a bare ✔.
        const lines = this.boothPressLines(this.fanout(pressed), character, guest);
        const card = character === null ? null : guestCardView(this.sim!, this.chat.all(), character, guest, this.canHostToken(token));
        sendJson(res, 200, { ok: true, guest: rosterRow(this.sim!, guest), replies, ...lines, ...(refused ? { refused: true } : {}), ...(card !== null ? { card } : {}) });
        return true;
      }
      case "/api/prime/cue": {
        // C8: a caller booth (Clippy) presses a `who: admin` cue its part is
        // named on (`by:`) — the cue sheet's own path (`/api/mod/signal`:
        // 409 `moved` / `doorsClosed`, `refused`), journaled `Booth · <part>`.
        const token = tokenOf(req, body);
        const character = this.characterOf(token);
        const name = str(body, "name");
        const model = this.sim?.model ?? this.declaredModel;
        const def = model?.interactions.get(name);
        if (character === null || !this.sessions.canCall(token) || model === null || def === undefined || def.who !== "admin" || !callsCue(model, character, def.id)) {
          sendJson(res, 404, { error: "no such cue for this booth" });
          return true;
        }
        const { token: _t, actor: _a, label: _l, ...press } = body;
        this.actingToken = token;
        try {
          return this.handleMod(res, "/api/mod/signal", press, `Booth · ${character}`);
        } finally {
          this.actingToken = undefined;
        }
      }
      case "/api/prime/letter": {
        // Wave 41 (C3): a performer's own inbox for Trabolta's letter. Posts
        // nothing into the story, so the doors may be closed.
        const character = this.characterOf(tokenOf(req, body));
        if (!character) {
          sendJson(res, 403, { error: "no performer capability — sign in" });
          return true;
        }
        handlePrimeLetter(this.letters, character, body, res);
        return true;
      }
      case "/api/prime/arrive": {
        // Wave 53 (C1): a booth reports in while the story's `arrival:`
        // header holds for its part. `booth_arrived` fires with the character
        // as subject AND actor (its own hooks alone hear it), once the story
        // has a sim, doors open or not: the crew arrives before the guests.
        const token = tokenOf(req, body);
        const character = this.characterOf(token);
        if (!character || !this.canScan(token)) {
          sendJson(res, 403, { error: "no performer capability — sign in" });
          return true;
        }
        if (this.sim === null) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        if (arrivalDue(this.sim, character)) this.fanout(this.commit("signal", BOOTH_ARRIVED, character, {}, character));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/prime/choose": {
        // Wave 53 (C2): a part on rails answers its menu, doors open or not.
        const token = tokenOf(req, body);
        const character = this.characterOf(token);
        if (!character || !this.canScan(token)) {
          sendJson(res, 403, { error: "no performer capability — sign in" });
          return true;
        }
        if (this.sim?.cutsceneFor(character) !== true) {
          sendJson(res, 409, { error: "no choice", options: null });
          return true;
        }
        this.chooseFor(character, body, res);
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
        // Wave 53 (C2): a part on rails finishes its upload before the doors.
        if (!open && this.sim?.cutsceneFor(character) !== true) {
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
        const parsed = this.widgetArgsOf(body["result"], m.widget.kind);
        if (parsed === "bad_email" || parsed === null) {
          sendJson(res, 400, { error: parsed ?? "bad widget result" });
          return true;
        }
        const { args, email } = parsed;
        if (!this.widgetAnswers.take(character)) {
          sendJson(res, 429, { error: "slow down — wait a minute" });
          return true;
        }
        this.answeredWidgets.add(key);
        if (email !== null) this.letters.set("performer", character, email);
        this.fanout(this.commit("signal", `${m.widget.kind} answered`, character, { ...args, card: seq }, character));
        sendJson(res, 200, { ok: true });
        return true;
      }
      case "/api/prime/censor":
      case "/api/prime/filter": {
        // Wave 48 (C2, C8): the censor's ✂ on a flagged guest line, and its
        // strength slider (`/filter`, wave 48b). ✂ journals `swear_censored`
        // as the censor (the story counts it, pays its ⭐ and raises the
        // program's suspicion), masks the line's hits at the current
        // strength and re-sends it to everyone who has it.
        const token = tokenOf(req, body);
        const character = this.characterOf(token);
        if (!character || !this.canScan(token)) {
          sendJson(res, 403, { error: "no performer capability — sign in" });
          return true;
        }
        if (this.sim === null || this.sim.model.censor !== character) {
          sendJson(res, 403, { error: "not the censor" });
          return true;
        }
        if (!open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        if (path === "/api/prime/filter") {
          const level = body["level"];
          if (!isFilterLevel(level)) {
            sendJson(res, 400, { error: "level is 0–100 in steps of 5" });
            return true;
          }
          const was = this.filter.level;
          if (level !== was) {
            this.filter.setLevel(level);
            this.fanout(this.commit("signal", SWEAR_FILTER, character, { level, was }, character));
          }
          sendJson(res, 200, { ok: true, level });
          return true;
        }
        const seq = Number(body["seq"]);
        const flagged = Number.isInteger(seq) ? this.filter.get(seq) : undefined;
        if (flagged === undefined || this.chat.get(seq)?.hidden !== false) {
          sendJson(res, 404, { error: "not flagged" });
          return true;
        }
        if (flagged.censored) {
          sendJson(res, 409, { error: "already censored" });
          return true;
        }
        const hits = this.filter.live(seq);
        if (hits.length === 0) {
          sendJson(res, 409, { error: "the filter no longer catches it" });
          return true;
        }
        const pay = this.filter.score(hits, Date.now());
        const fresh = this.filter.fresh(hits).join(", ");
        const m = this.applyCensor(seq, hits, pay, true);
        const args = {
          message: seq,
          words: hits.length,
          list: hitList(hits),
          fresh,
          unsaid: hits.filter((h) => h.unsaid).length,
          points: pay.points,
          mult: pay.mult,
          stars: pay.stars,
          top: this.filter.top(),
          distinct: this.filter.wordCounts().length,
          heat: pay.heat,
          heat_at: pay.at,
        };
        this.fanout(this.commit("signal", SWEAR_CENSORED, flagged.guest, args, character));
        sendJson(res, 200, { ok: true, seq, text: m?.text ?? "", points: pay.points, mult: pay.mult, stars: pay.stars });
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
          if (!boothChannels(this.sim!, character).some((c) => c.id === channel)) {
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
    if (path === REJOIN_DECIDE_ROUTE) {
      this.rejoin.decide(res, body, by);
      return true;
    }
    if (path === BADGES_ROUTE) {
      this.rejoin.printable(res, body);
      return true;
    }
    if (this.pushRoutes.handleMod(path, res)) return true;
    if (this.crewRoutes.handleMod(res, path, body)) return true; // w18 crews
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
        // `audio` (optional): the project's audio.json, like `facts`.
        const audio = body["audio"];
        if (audio !== undefined && audio !== null && typeof audio !== "string") {
          sendJson(res, 400, { error: "bad audio" });
          return true;
        }
        const audioText = typeof audio === "string" && audio.trim() !== "" ? audio : null;
        const audioBad = audioText !== null ? audioProblems(audioText) : [];
        if (audioBad.length > 0) {
          sendJson(res, 400, { error: `invalid ${AUDIO_FILE}`, problems: audioBad });
          return true;
        }
        // `lights` (optional): the project's lights.json, like `audio`.
        const lights = body["lights"];
        if (lights !== undefined && lights !== null && typeof lights !== "string") {
          sendJson(res, 400, { error: "bad lights" });
          return true;
        }
        const lightsText = typeof lights === "string" && lights.trim() !== "" ? lights : null;
        const lightsBad = lightsText !== null ? lightsProblems(lightsText) : [];
        if (lightsBad.length > 0) {
          sendJson(res, 400, { error: `invalid ${LIGHTS_FILE}`, problems: lightsBad });
          return true;
        }
        // `desk` (optional, wave 25): the project's desk.json, like `lights`.
        const desk = body["desk"];
        if (desk !== undefined && desk !== null && typeof desk !== "string") {
          sendJson(res, 400, { error: "bad desk" });
          return true;
        }
        const deskText = typeof desk === "string" && desk.trim() !== "" ? desk : null;
        const deskBad = deskText !== null ? deskProblems(deskText) : [];
        if (deskBad.length > 0) {
          sendJson(res, 400, { error: `invalid ${DESK_FILE}`, problems: deskBad });
          return true;
        }
        // (wave 39) The lights first: the restart boots the games' estimate
        // with the config's `boot` look, so it must read the new file.
        if (lights !== undefined) this.setProjectLights(lightsText);
        this.restart(source, name, { by });
        if (facts !== undefined) this.setProjectFacts(factsText);
        if (audio !== undefined) this.setProjectAudio(audioText);
        if (desk !== undefined) this.setProjectDesk(deskText);
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
        // Only a program the story marked for reinstallation (captured, or
        // marked = restricted) may enter, checked before `reinstallation
        // begun` fires so an unmarked guest never triggers the story's
        // capture. `force: true` is a director's override; no device sends it.
        if (body["force"] !== true && !eligibleFor(sim, guest)) {
          sendJson(res, 409, { error: NOT_MARKED });
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
          ...(body["force"] === true ? { forced: true } : {}),
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
      case "/api/mod/spatial/descent": {
        // (wave 49, C3.3) Force the level of the next deals, mostly to test.
        // Memory only; a story reset clears it; a walk under way keeps its own.
        const level = body["level"];
        if (level !== null && !isDescentLevel(level)) {
          sendJson(res, 400, { error: "level must be 0–4, or null for by visits" });
          return true;
        }
        this.spatial.forceDescent(level);
        sendJson(res, 200, { ok: true, forced: level });
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
        const codex = this.codexLinks(base).map(({ secret: _secret, ...e }) => e);
        sendJson(res, 200, {
          eventPass: this.codes.event,
          primePass: this.codes.prime,
          // A host booth never learns the moderator passcode.
          ...(hostOnly ? {} : { modPass: this.codes.mod }),
          joinUrl: base,
          codex,
          // W-03: each reserved program's invitation link (its claim token).
          claims: this.claims.links(this.sim?.model ?? this.declaredModel, base, this.codes.event),
          // Wave 23: each part's own cast-card link (signs in as it).
          castLinks: this.performerParts.map((character) => {
            const part = partCode(this.claimSecret, character);
            return { character, part, code: printedCode(part), url: partUrl(base, this.codes.event, part) };
          }),
          ...printExtras(this.sim?.model ?? this.declaredModel ?? null, base, this.codes.event, this.claimSecret, this.factsBook()?.raw ?? null),
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
      case "/api/mod/casino/bet": {
        // The casino terminal (`terminal/src/casino/`, `src/casino.ts`): a
        // scanned guest bets their own coin. The server throws the dice
        // (`rollFor`, `crypto.randomInt`) and settles; the roll + payout ride
        // one journaled `bet` op (`by` = the terminal's label), the card
        // lands in the guest's Wallet room, the story hears `casino won` /
        // `casino lost`. Mod token only (a terminal); a restricted program
        // is refused, one in the Internet too (a mark alone plays, Q30), a
        // frozen account too, and the doors must be open.
        if (this.sim === null || !this.open) {
          sendJson(res, 409, { error: "doors are closed" });
          return true;
        }
        if (this.wallet === null) {
          sendJson(res, 404, { error: "this story has no currency" });
          return true;
        }
        const who = str(body, "guest");
        const game = str(body, "game");
        const pick = str(body, "pick");
        const stake = Number(body["stake"]);
        const bad = this.wallet.checkBet(who, game, pick, stake);
        if (bad !== null) {
          sendJson(res, bad.status, { error: bad.error });
          return true;
        }
        if (this.sim.isRestricted(who)) {
          sendJson(res, 403, { error: "marked programs can't gamble" });
          return true;
        }
        // Wave 18 (Q30): a mark no longer hinders, but a program sent to the
        // Internet is in the tent, not at the tables.
        if (this.sim.isCaptured(who)) {
          sendJson(res, 403, { error: CASINO_CAPTURED });
          return true;
        }
        const now = Date.now();
        const last = this.casinoLast.get(who);
        if (last !== undefined && now - last < CASINO_BET_GAP_MS) {
          sendJson(res, 429, { error: "again" });
          return true;
        }
        this.casinoLast.set(who, now);
        // A headless mod token names itself (`Terminal · Casino`) as the journal's `by`.
        const label = str(body, "label").trim().slice(0, 60);
        if (label !== "" && by === "Director") this.actingBy = label;
        const g = game as CasinoGame;
        const roll = rollFor(g, (n) => randomInt(n));
        const payout = payoutOf(g, pick, roll, stake);
        const id = this.wallet.nextId("c");
        const at = this.sim.elapsed();
        this.fanout(this.commitWallet({ op: "bet", id, visit: this.wallet.casinoVisitFor(who, at, id), who, game: g, pick, stake, roll, payout, at }));
        sendJson(res, 200, { ok: true, game: g, pick, stake, roll, payout, net: payout - stake, balance: this.wallet.balanceOf(who), unit: this.wallet.currency.name });
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
        let args = rawArgs !== null && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? canonicalPlaceArgs(rawArgs as Record<string, unknown>, this.sim.model.locations.values()) : null;
        // Fired *as* a character (the performer-lens interaction path, like
        // `/api/prime/act`): only that character's hooks hear it.
        let actor = str(body, "actor");
        if (actor !== "" && !this.sim.model.characters.has(actor)) {
          sendJson(res, 404, { error: "unknown character" });
          return true;
        }
        // Wave 21: an actorless press of a player's button would run every
        // player's hooks (📢 would defect them all, a shared game button
        // would pay a player who never pressed it). Fire it as a non-player
        // it names (a host: ROLE hooks and rules still hear it), else as
        // its one player, else ask who presses it.
        // Wave 26 (B2): the stand-in's hooks hear `director: true` (journaled
        // with the press), so a story that names who pressed a button
        // (`↩ The Director pressed Not a Bingo`) never credits the stand-in.
        if (actor === "") {
          const def = [...this.sim.model.interactions.values()].find((i) => foldName(i.id) === foldName(str(body, "name")));
          const actors = def !== undefined && def.who === "performer" ? (interactionActors(this.sim).get(def.id) ?? []) : [];
          const isPlayer = (id: string) => this.sim?.model.characters.get(id)?.player === true;
          const players = actors.filter(isPlayer);
          if (players.length > 0) {
            const other = actors.find((id) => !isPlayer(id));
            if (other !== undefined) actor = other;
            else if (players.length === 1) actor = players[0]!;
            else {
              sendJson(res, 409, { error: `who presses it? fire it as one of: ${players.join(", ")}`, actors: players });
              return true;
            }
            args = { ...(args ?? {}), director: true };
          }
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
        // Only a cue (a declared INTERACTION) is judged: a device's own
        // signal (the door sensor's edge under the override, `terminal
        // opened`) that changes nothing is not a refused press.
        const signalled = foldName(str(body, "name"));
        const isCue = [...this.sim.model.interactions.values()].some((i) => foldName(i.id) === signalled);
        const refused = isCue && pressRefused(this.sim, press);
        // C8: what the press said (its lines) and the staff rooms' lines.
        const lines = cueLines(this.fanout(press), new Set(staffRoomChannels(this.sim.model)));
        // `presses`: the count after this press — the screen holds its lock
        // until its own snapshot shows it, so its next arm binds past it.
        const presses = cueState(this.sim).presses;
        sendJson(res, 200, refused ? { ok: true, refused: true, presses, ...lines } : { ok: true, presses, ...lines });
        return true;
      }
      case "/api/mod/caller": {
        // C8: "I'm calling the show" — a visible claim, never a lock. `on:
        // false` takes back your own claim (another's stands).
        const token = this.actingToken ?? null;
        // A headless mod token (the director's phone) names itself, as on
        // `/api/mod/signal`: "Phone · Ada".
        // A label never passes for a booth (A7): "Booth · Clippy" from a
        // mod token reads "Phone · Clippy"; only a real booth session's
        // by-line drops its "Booth · ".
        const BOOTH = "Booth · ";
        const label = str(body, "label").trim().slice(0, 60);
        const labelled = label !== "" && by === "Director";
        const name = labelled ? (label.startsWith(BOOTH) ? `Phone · ${label.slice(BOOTH.length)}` : label) : by.startsWith(BOOTH) ? by.slice(BOOTH.length) : by;
        const before = JSON.stringify(this.cueCaller());
        if (body["on"] === true) this.caller = { name, at: this.clock(), token, character: token !== null ? (this.sessions.get(token)?.character ?? null) : null };
        else if (this.caller !== null && this.caller.name === name) this.caller = null;
        // Every cue-sheet view carries the claim: push it now, not on the
        // next story change (m3 / BN-F15: Clippy's chip lagged).
        if (JSON.stringify(this.cueCaller()) !== before) this.pushSnapshots();
        sendJson(res, 200, { ok: true, caller: this.cueCaller() });
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
        // Wave 53 (C5): a line to everyone is an announcement a phone may say.
        const spoken = scope === "all" || scope === "everyone" ? spokenAnnounce(cue) : "";
        if (spoken !== "") this.phoneAnnounce({ text: spoken, at: Date.now() });
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
            else sseSend(c.res, "message", forGuest(m, this.sim, c.id, this.namesHiddenFrom(c.pane === true)));
          } else if (c.role === "mod") {
            sseSend(c.res, "messageModerated", m);
          } else if (visibleToPrime(m, c, this.agentVoiced, this.sim?.model)) {
            sseSend(c.res, "messageModerated", forBooth(m, this.namesHiddenFrom(c.pane === true)));
          }
        }
        sendJson(res, 200, { ok: true, seq, hidden: m.hidden });
        return true;
      }
      case COSTUME_MOD_ROUTE: {
        // Wave 59: the crew's kill switch (a director's; off the host allowlist).
        if (typeof body["on"] !== "boolean") {
          sendJson(res, 400, { error: "send {on}" });
          return true;
        }
        this.store.saveCostumeOff(!body["on"]);
        if (!body["on"]) this.costume.halt();
        sendJson(res, 200, { ok: true, on: body["on"] });
        return true;
      }
      case "/api/mod/aloud": {
        // Wave 59: a host's or a director's ▶ (every line of his left plays,
        // the prompter carries on) or ✓ Done (the scene is over).
        const action = str(body, "action");
        if (action !== "release" && action !== "done") {
          sendJson(res, 400, { error: "action is release or done" });
          return true;
        }
        const took = action === "release" ? this.prompters.release() : this.prompters.done();
        this.prompterClock();
        sendJson(res, 200, { ok: true, took });
        return true;
      }
      case "/api/mod/talk": {
        // Wave 32 (C3): a host speaks for Clippy in the Desktop (Trabolta
        // answers aloud), or fires one of his canned lines.
        this.modTalk(res, body);
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
        // Wave 32 (C3/C4): a director typing as him in the Desktop while a
        // talk scene is on (or a public request is owed) stands in for his
        // public reply — the whole room hears it, answering Clippy's line.
        const byHand = isCharacter && speaker === TALK_AGENT && channel === `loc:${TALK_ROOM}` && audience === undefined;
        const owed = byHand ? this.agents.openOn(this.talkThread()) : null;
        const aloud = byHand && (owed !== null || this.talkSceneNow() !== null);
        const said = this.fanout(
          aloud ? this.commit("say", speaker, channel, text, parentSeq, "all", owed === null ? null : answeredSeq(owed.req)) : this.commit("say", speaker, channel, isPerson ? this.unsaidMasked(text) : text, parentSeq, audience),
          isPerson ? by : undefined,
        );
        // A director's persona messaging an agent gets an answer, exactly as
        // the guest would — that's what makes a rehearsal of the bot real.
        if (isPerson) this.agentHeard(channel, [speaker]);
        // A director answering a guest AS the agent (its worker is down —
        // decision #35) closes the request that guest's line opened, so a
        // worker that comes back doesn't answer it a second time.
        else if (isCharacter && Array.isArray(audience) && this.isAgent(speaker)) this.agents.answeredByHand({ character: speaker, channel, audience });
        // Wave 32 (C4): a director typing as him in the Desktop answers an
        // owed public talk request by hand, too.
        else if (byHand) this.agents.answeredByHand(this.talkThread());
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
        const target = this.rejoin.scanTarget(str(body, "target"));
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
      case "/api/mod/clock": {
        // The show clock (wave 13 K3): a host sets it (`{time: "7:00 PM"}`)
        // or nudges it (`{nudge: ±minutes}`). Two journaled var writes —
        // `Clock.set_to` then `Clock.set_at` — so replay and a restart read
        // the same clock; every view carries it on its next snapshot.
        if (this.sim === null) {
          sendJson(res, 409, { error: "no scenario loaded" });
          return true;
        }
        const change = clockChange(this.sim, body);
        if ("error" in change) {
          sendJson(res, change.status, { error: change.error });
          return true;
        }
        this.fanout([...this.commit("setVar", CLOCK_SET_TO, String(change.setTo)), ...this.commit("setVar", CLOCK_SET_AT, String(change.setAt))]);
        sendJson(res, 200, { ok: true, clock: showClock(this.sim, this.phase === "open") ?? null });
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
        // C4: a booth pane of a host part (`admin: true`) is a host booth —
        // the NEXT bar and the host routes, journaled `by` this director.
        const host = role === "prime" && this.sim.model.characters.get(id)?.admin === true;
        this.impersonations.set(token, { role, id, by: label !== "" ? label : by, ...(host ? { host: true } : {}), ...(label !== "" ? { terminal: true as const } : {}) });
        const name = role === "guest" ? (this.sim.persons.get(id)?.name ?? id) : id;
        // Wave 28: `seq`, the newest chat seq now: a room terminal whose stream
        // history comes late floors its visit here (only this visit's lines).
        const all = this.chat.all();
        const seq = all.length > 0 ? all[all.length - 1]!.seq : -1;
        // Wave 28 (gap 2b): `visitSeq`, the visit's floor. A wall terminal
        // (labelled) scanning the same guest again soon after its last
        // session ended (a reload mid-visit) carries on that visit's floor,
        // so the reloaded page still shows the whole exchange.
        const visitSeq = role === "guest" && label !== "" ? this.terminalVisits.begin(id, label, seq, this.clock()) : seq;
        sendJson(res, 200, { token, role, id, name, eventId: this.eventId, title: this.title, seq, visitSeq, ...(role === "prime" ? { host } : {}) });
        return true;
      }
      case "/api/mod/impersonate/end": {
        // The editor closed a pane: end that play-as session and its stream.
        // (`session`, not `token` — that field is the caller's own credential.)
        const session = str(body, "session");
        const ending = this.impersonations.get(session);
        // Only the terminal's pagehide end (`resumable: true`) leaves the
        // visit to carry on; a leash end (thrown, timed out, done, left)
        // is a real end, and the next scan floors fresh.
        if (ending !== undefined && ending.role === "guest") this.terminalVisits.end(ending.id, ending.by, this.clock(), body["resumable"] === true);
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
        // `choice` / `text` as on `/api/guest/choose` (D15, D18): a director
        // may answer a menu that sits behind a stale one.
        this.chooseFor(person, body, res);
        return true;
      }
      default:
        sendJson(res, 404, { error: "unknown mod action" });
        return true;
    }
  }
}

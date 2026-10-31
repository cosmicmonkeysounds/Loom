//! Every write the host panel makes (wave 13, CONTRACTS §2.7 / §5.4): one
//! typed call per action, each on the server's **host allowlist** and
//! nothing else. A host token is refused (403 `not from a booth`) by every
//! other moderator route, so this file is the panel's whole reach: of the
//! lifecycle only the doors and a pause (C2), no free world writes, no log,
//! no Mind (D5).
//!
//! Pure over an injected `post`, so the tests can check every body and
//! that no call ever leaves the allowlist.

import { ALERT_LEVELS, type AlertLevel } from "../../../core/src/delivery.ts";
import { verdictCall, type FactsLike, type FactVerdictLike } from "../../../core/src/host-board.ts";
import type { MixChange, MusicCommand } from "../../../core/src/house-mixer.ts";
import type { VoiceFlavour } from "../../../core/src/voice-fx.ts";

/** The POST routes the panel may call — the server's host allowlist. */
export const HOST_ROUTES = [
  "/api/mod/signal",
  "/api/mod/var",
  "/api/mod/broadcast",
  "/api/mod/say",
  "/api/mod/wallet/approve",
  "/api/mod/wallet/deny",
  "/api/mod/wallet/approve-held",
  "/api/mod/wallet/unfreeze",
  "/api/mod/wallet/stimulus",
  "/api/mod/spatial/king",
  "/api/mod/screen/voice",
  // Stop every house sound (wave 18b Q7): one-shot, not journaled.
  "/api/mod/audio/stop",
  "/api/mod/screen/identify",
  "/api/mod/codes",
  "/api/mod/claim/unlock",
  "/api/mod/guest/gone",
  "/api/mod/guest/pair",
  // Wave 23: let a guest back in as their program (or not).
  "/api/mod/guest/rejoin",
  "/api/mod/prime/release",
  "/api/mod/guest/release",
  "/api/mod/act",
  "/api/mod/scan",
  // The doors and a pause (C2): `start` opens the doors or resumes, `stop`
  // pauses. Never reset / load / push / go live / end / resync.
  "/api/mod/start",
  "/api/mod/stop",
  // The show clock (wave 13 K5): set it to a time or nudge it by minutes.
  "/api/mod/clock",
  // Who is calling the show (wave 18 C8): claim it, or let it go.
  "/api/mod/caller",
  // A guest-founded crew: rename it, or dissolve it (fix round M3).
  "/api/mod/crew/rename",
  "/api/mod/crew/dissolve",
  // Wave 25, the house desk (docs/loom-house-desk.md §2.1, the H rows): GO,
  // the playhead, stop (one run, or all of them and the house sounds), a
  // check's mark, and the checks' tests — a sound or an announcement, a
  // speaker / output tone, a light or a look. Never a desk edit, never a
  // Save to project, never Reset marks.
  "/api/mod/desk/go",
  "/api/mod/desk/standby",
  "/api/mod/desk/stop",
  "/api/mod/desk/check",
  "/api/mod/audio/play",
  "/api/mod/audio/test",
  "/api/mod/lights/test",
  // Wave 32 (contract C3): the 🤖 Talk card — a line said as Clippy (Trabolta
  // answers it live in the Desktop) or a canned line as Trabolta himself.
  // Never under the Mind's agent routes (the Mind stays out of Play).
  "/api/mod/talk",
  // Wave 59: the teleprompter's ▶ (his lines may play) and ✓ Done.
  "/api/mod/aloud",
  // Wave 40 (contract C2 / C5): the house mixer from the Desk window — move
  // the live balance (never audio.json), and the soundtrack's transport
  // (skip, a scene by hand, stop, follow the story). Never the router's
  // own meters route.
  "/api/mod/audio/mix",
  "/api/mod/audio/music",
] as const;
export type HostRoute = (typeof HOST_ROUTES)[number];

/** The GET reads: the host view (`?role=mod&host=1`), the recap, (wave
 *  25) the house desk (`?after=<rev>&wait=<s>` long-polls it) and (wave
 *  40) the mixer, polled each second while the Desk's 🎚 Mixer is open. */
export const HOST_READS = ["/api/state?role=mod&host=1", "/api/mod/recap", "/api/mod/desk", "/api/mod/audio/mixer"] as const;

/** A desk check's test (`house-desk.ts` `DeskTestCall`): one of the three
 *  test routes and its body. */
export interface DeskTestLike {
  route: "/api/mod/audio/test" | "/api/mod/audio/play" | "/api/mod/lights/test";
  body: Record<string, unknown>;
}

/** The routes a desk check may test with. */
const DESK_TEST_ROUTES: ReadonlyArray<DeskTestLike["route"]> = ["/api/mod/audio/test", "/api/mod/audio/play", "/api/mod/lights/test"];

/** One POST to `route` with the booth token; resolves with the JSON body,
 *  rejects with `ApiError` on a refusal. */
export type HostPost = (route: HostRoute, body: Record<string, unknown>, signal?: AbortSignal) => Promise<Record<string, unknown>>;

/** The world path the facts judge reads its mode from (wave 18 C8: on
 *  the host `/api/mod/var` allowlist beside the alert dial). */
export const JUDGE_MODE_PATH = "Night.judge_mode";

/** The judge's two modes: the house judges (near misses wait), or every
 *  filing waits for a host. */
export const JUDGE_MODES = ["auto", "review"] as const;
export type JudgeMode = (typeof JUDGE_MODES)[number];

/** The event the story fires when a guest comes back from the bathroom
 *  (the show's `INTERACTION back from the bathroom`). */
export const BACK_FROM_BATHROOM = "back from the bathroom";

/** A re-pair QR (`/api/mod/guest/pair`). */
export interface PairCode {
  name: string;
  url: string;
  expiresAt: number;
}

/** The front-of-house codes (`/api/mod/codes`, never `modPass` for a host). */
export interface HostCodes {
  eventPass: string;
  primePass: string;
  joinUrl: string;
  claims: Array<{ character: string; claim: string; url: string }>;
}

/** The guest join link a QR carries: `<base>/?code=<event code>` (the
 *  editor's print sheet's link). */
export function joinLink(codes: Pick<HostCodes, "joinUrl" | "eventPass">, origin: string = typeof location !== "undefined" ? location.origin : ""): string {
  const base = codes.joinUrl.trim() !== "" ? codes.joinUrl.trim() : origin;
  return `${base.replace(/\/+$/u, "")}/?code=${encodeURIComponent(codes.eventPass)}`;
}

/** The cue as broadcast: `!`-prefixed for an alert, never twice. */
export function announceCue(text: string, alert: boolean): string {
  const t = text.trim();
  if (!alert || t.startsWith("!")) return t;
  return `!${t}`;
}

/** `/api/mod/signal` for a cue press: no `label` (the server journals a
 *  booth as `Booth · <character>` on its own). */
export function cueSignal(id: string, subject: string | null, args: { value: string | number } | null, presses?: number): Record<string, unknown> {
  return { name: id, ...(subject !== null ? { subject } : {}), ...(args !== null ? { args } : {}), ...(presses !== undefined ? { presses } : {}) };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** The panel's calls. `alertsPath` is the host view's `alerts.path` (the
 *  only world path a host may write). */
export function hostCalls(post: HostPost, alertsPath: () => string) {
  return {
    /** A cue from the NEXT bar or the Cues tab. Resolves with the server's
     *  answer: `refused` (the story turned it down), `moved` (409, another
     *  host pressed first) — any other refusal rejects. */
    cue: (id: string, subject: string | null, args: { value: string | number } | null, presses?: number, signal?: AbortSignal) => post("/api/mod/signal", cueSignal(id, subject, args, presses), signal),
    /** ✅ / 😤 / 🤷 on one filing (the facts' confirm event). Null when the
     *  story names no event for that verdict. */
    verdict: (confirm: FactsLike["confirm"], row: { person: string; question: string }, verdict: FactVerdictLike) => {
      const call = verdictCall({ confirm, questions: [] }, row, verdict);
      if (call === null) return null;
      return post("/api/mod/signal", { name: call.event, subject: call.person, args: call.args });
    },
    /** The interrupt dial (D2): every phone's alert level. */
    setAlertLevel: (level: AlertLevel) => {
      if (!ALERT_LEVELS.includes(level)) return Promise.reject(new Error(`not a level: ${level}`));
      return post("/api/mod/var", { path: alertsPath(), value: level });
    },
    /** The facts judge's mode (B8): `auto` (the house judges; near misses
     *  wait for a host) or `review` (every filing waits). */
    setJudgeMode: (mode: JudgeMode) => {
      if (!JUDGE_MODES.includes(mode)) return Promise.reject(new Error(`not a mode: ${mode}`));
      return post("/api/mod/var", { path: JUDGE_MODE_PATH, value: mode });
    },
    /** 📣 I'll call (`on`) / Stop calling: the caller claim every cue sheet
     *  shows (memory only on the server; a restart clears it). */
    caller: (on: boolean) => post("/api/mod/caller", { on }),
    /** Announce to everyone (🔔 = an alert every phone banners). */
    announce: (text: string, alert: boolean) => post("/api/mod/broadcast", { scope: "all", cue: announceCue(text, alert) }),
    /** Answer one guest's DM as an agent-voiced character (Trabolta): the
     *  guest's own thread (`guest:<id>`), never a bare `dm:` room. */
    answerAs: (agent: string, guest: string, text: string) => post("/api/mod/say", { channel: `guest:${guest}`, as: agent, text: text.trim() }),
    /** Wave 32 (C3): say a line in the Desktop during a talk scene — as
     *  Clippy (Trabolta's mind answers it; a canned line's hidden
     *  `direction` steers him) or as Trabolta (his canned line, at once). */
    talk: (as: "Clippy" | "Trabolta", text: string, direction?: string) => {
      const d = direction?.trim();
      return post("/api/mod/talk", { as, text: text.replace(/\s+/gu, " ").trim(), ...(as === "Clippy" && d !== undefined && d !== "" ? { direction: d } : {}) });
    },
    /** Wave 59: ▶ every line of his left plays, or ✓ Done the scene is over. */
    aloud: (action: "release" | "done") => post("/api/mod/aloud", { action }),
    walletApprove: (id: string) => post("/api/mod/wallet/approve", { id }),
    walletDeny: (id: string) => post("/api/mod/wallet/deny", { id }),
    walletApproveHeld: () => post("/api/mod/wallet/approve-held", {}),
    walletUnfreeze: (id: string) => post("/api/mod/wallet/unfreeze", { to: id }),
    walletStimulus: (amount: number) => post("/api/mod/wallet/stimulus", { amount }),
    kingHp: (hp: number) => post("/api/mod/spatial/king", { hp }),
    tvMute: (muted: boolean) => post("/api/mod/screen/voice", { muted }),
    /** (wave 56) His voice: follows the night, kept clean, or fully broken. */
    voiceFx: (fx: "auto" | "clean" | "broken") => post("/api/mod/screen/voice", { fx }),
    /** (wave 59, the Desk's 🖥 House) One flavour on his next words, in any mode. */
    voiceShot: (shot: VoiceFlavour) => post("/api/mod/screen/voice", { shot }),
    /** 🔇 Stop all house sounds (wave 18b Q7): every story sound and speaker
     *  test fades out; `announce` also cuts the announcement and its queue.
     *  The TV voice (its own mute), the terminals and live mics are untouched. */
    stopSounds: (announce: boolean) => post("/api/mod/audio/stop", { announce }),
    identify: (name: string) => post("/api/mod/screen/identify", { name }),
    codes: async (): Promise<HostCodes> => {
      const r = await post("/api/mod/codes", {});
      const claims = Array.isArray(r["claims"]) ? (r["claims"] as Array<Record<string, unknown>>) : [];
      return {
        eventPass: str(r["eventPass"]),
        primePass: str(r["primePass"]),
        joinUrl: str(r["joinUrl"]),
        claims: claims.map((c) => ({ character: str(c["character"]), claim: str(c["claim"]), url: str(c["url"]) })).filter((c) => c.character !== ""),
      };
    },
    /** 🔓 a reserved program for `minutes` (a lost invitation). */
    unlockClaim: (character: string, minutes = 2) => post("/api/mod/claim/unlock", { character, minutes }),
    gone: (id: string, gone: boolean) => post("/api/mod/guest/gone", { id, gone }),
    /** Wave 23: answer a guest's ask to get back in. */
    rejoin: (request: string, approve: boolean) => post("/api/mod/guest/rejoin", { request, approve }),
    pair: async (id: string): Promise<PairCode> => {
      const r = await post("/api/mod/guest/pair", { id });
      return { name: str(r["name"]), url: str(r["url"]), expiresAt: typeof r["expiresAt"] === "number" ? r["expiresAt"] : 0 };
    },
    release: (character: string) => post("/api/mod/prime/release", { character }),
    /** Wave 59: sign a guest's phone out; their badge signs in again. */
    releaseGuest: (id: string) => post("/api/mod/guest/release", { id }),
    renameCrew: (crew: string, name: string) => post("/api/mod/crew/rename", { crew, name }),
    dissolveCrew: (crew: string) => post("/api/mod/crew/dissolve", { crew }),
    restrict: (id: string, on: boolean) => post("/api/mod/act", { id, action: on ? "restrict" : "unrestrict" }),
    /** End a stale Bathroom Mode: the story's own "back" event on the guest. */
    backFromBathroom: (id: string) => post("/api/mod/signal", { name: BACK_FROM_BATHROOM, subject: id }),
    /** 🚪 Open the doors (before they open), or ▶ resume a paused show. */
    openDoors: () => post("/api/mod/start", {}),
    resume: () => post("/api/mod/start", {}),
    /** ⏸ Pause the show: the story clock stops, nothing is lost. */
    pause: () => post("/api/mod/stop", {}),
    /** 🕐 Set the show clock to a time of day ("7:05 PM"). */
    clockSet: (time: string) => post("/api/mod/clock", { time }),
    /** 🕐 Move the show clock by `minutes` (±, |n| ≤ 240). */
    clockNudge: (minutes: number) => post("/api/mod/clock", { nudge: minutes }),
    /** Scan a guest as another character (a late arrival's clearance). */
    scanAs: (as: string, target: string) => post("/api/mod/scan", { as, target }),
    /** Wave 25: GO the cue on standby. `standby` is the playhead this
     *  console showed: if another console moved it, the server answers 409
     *  `moved` and nothing fires. A `cue` GOes that cue instead. */
    deskGo: (standby: string | null, cue?: string) => post("/api/mod/desk/go", { standby, ...(cue !== undefined ? { cue } : {}) }),
    /** Put a cue on standby (null: the end of the list). */
    deskStandby: (cue: string | null) => post("/api/mod/desk/standby", { cue }),
    /** Stop one running desk cue. */
    deskStop: (run: number) => post("/api/mod/desk/stop", { run }),
    /** ■ STOP ALL: every desk run and the house sounds (`announce`: the
     *  announcement too). */
    deskStopAll: (announce = false) => post("/api/mod/desk/stop", { all: true, ...(announce ? { announce: true } : {}) }),
    /** A check's mark: ✓ (`ok`), ✗ (`bad`) or cleared (null). */
    deskMark: (key: string, mark: "ok" | "bad" | null, note?: string) => post("/api/mod/desk/check", { key, mark, ...(note !== undefined && note.trim() !== "" ? { note: note.trim() } : {}) }),
    /** Play a story sound (`{sound, to?, gain?}`) or an announcement (`{say, to?, chime?}`) on the house speakers. */
    audioPlay: (body: Record<string, unknown>) => post("/api/mod/audio/play", body),
    /** A test tone on one speaker or output (`{speaker}` / `{out}`). */
    audioTest: (body: Record<string, unknown>) => post("/api/mod/audio/test", body),
    /** A light test: a look (`{look}`), a fixture's identify (`{fixture}`), or one state (`{fixture, set}`). */
    lightsTest: (body: Record<string, unknown>) => post("/api/mod/lights/test", body),
    /** Wave 40: move the house mix (`{changes}`; a `reset` puts a key back
     *  at 0 dB, unmuted). Resolves with `{ok, mix}`. */
    mix: (changes: readonly MixChange[]) => post("/api/mod/audio/mix", { changes: changes.map((c) => ({ ...c })) }),
    /** Wave 40: the soundtrack — `next` (one bed or all), `scene` (by hand),
     *  `stop`, `story` (follow the story again). Resolves with `{ok, seq, router}`. */
    music: (cmd: MusicCommand) => post("/api/mod/audio/music", { ...cmd }),
    /** Run a desk check's test (`deskChecks`' `test` / `extra`), only on its three routes. */
    deskTest: (call: DeskTestLike) => {
      if (!DESK_TEST_ROUTES.includes(call.route)) return Promise.reject(new Error(`not a test route: ${call.route}`));
      return post(call.route, call.body);
    },
  };
}

export type HostCalls = ReturnType<typeof hostCalls>;

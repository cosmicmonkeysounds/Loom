//! The server half of `showctl doctor`: every answer the event server gives
//! a moderator, classified into green / amber / red check rows.
//!
//! Pure — each function takes what an endpoint answered and returns rows —
//! so the thresholds are unit-tested on fixtures and the same rules drive
//! `doctor`, `status` and every `preflight`. The thresholds are the ones the
//! show already uses elsewhere: a terminal is silent after the server's own
//! `silentMs` (20 s, `routes/screen.ts`; Run → Terminals turns it red at the
//! same mark), an agent request waiting 40 s is the Director glance's ⚠,
//! the audio router is online for 40 s after its last long poll
//! (`AUDIO_ROUTER_ONLINE_MS`).
//!
//! Nothing secret is ever echoed: the `ModView.world` table (the Kernel's
//! combos, the door code) is never read here, and a terminal row's fields
//! are the heartbeat's own (`door`, `mic`, …), which carry no codes.

import type { Check, Level } from "./ui.ts";
import { ago } from "./ui.ts";

type Json = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOf = (v: unknown): string | null => (typeof v === "string" ? v : null);
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v.filter((x) => x !== null && typeof x === "object") as Json[]) : []);
const row = (name: string, level: Level, detail: string, read: string): Check => ({ name, level, detail, read });

/** The terminal spots whose silence is red on show night (the rest of the
 *  map's spots are wall tablets the house may or may not hang tonight). */
export const KEY_SPOTS: Readonly<Record<string, string>> = {
  "desktop-tv": "the TV (John's Desktop)",
  "server-room": "the server-room terminal (Steph's laptop + the M4)",
  "server-room-door": "the Server Door chess tablet",
  "graphics-card": "the casino tablet",
  tent: "the tent laptop (wizard + game)",
};

/** An agent request this old is the Director glance's ⚠ (wave 11). */
export const AGENT_WAIT_WARN_MS = 40_000;

// ---------------------------------------------------------------- health

/** `GET /api/health`: 200 `{ok, controlPlane, events}`, else 503 `{reason}`. */
export function healthCheck(status: number | null, body: Json | null, error?: string): Check {
  const read = "GET /api/health";
  if (status === null) return row("VPS health", "fail", error ?? "no answer", read);
  if (status === 200 && body?.["ok"] === true) {
    const cp = body["controlPlane"] === true ? "control plane up" : "control plane OFF (no database: LAN mode)";
    const failed = Array.isArray(body["failed"]) ? body["failed"].length : 0;
    return row("VPS health", body["controlPlane"] === true && failed === 0 ? "ok" : "warn", `${cp} · ${num(body["events"]) ?? "?"} event(s) hosted${failed > 0 ? ` · ${failed} failed to load` : ""}`, read);
  }
  const reason = strOf(body?.["reason"]) ?? strOf(body?.["error"]) ?? `HTTP ${status}`;
  const advice: Record<string, string> = {
    database: "Postgres unreachable — on the VPS: docker compose ps / logs db",
    starting: "the server is still booting — wait 10 s and re-run",
    config: "a config error at boot — on the VPS: docker compose logs server",
    events: "an event failed to rehydrate — docker compose logs server",
  };
  return row("VPS health", "fail", `${reason}${advice[reason] ? ` — ${advice[reason]}` : ""}`, read);
}

// ---------------------------------------------------------------- the run

/** The run's phase, doors and scenario (off the full `ModView`), plus
 *  whether the server advertises it on `/` (`/api/landing`): only an open
 *  **live** event is — a preview never is, so "advertised" means live. */
export function runCheck(view: Json, title: string | null, landingTitle: string | null): Check[] {
  const read = "GET /api/state?role=mod";
  const out: Check[] = [];
  const phase = strOf(view["phase"]) ?? "?";
  if (view["scenario"] === null || view["scenario"] === undefined) {
    out.push(row("Run", "fail", "no story loaded on this event — Run → Push draft / sync-show", read));
    return out;
  }
  const doorsClosed = view["doorsClosed"] === true;
  if (phase === "open") out.push(row("Run", "ok", "doors OPEN, story running", read));
  else if (phase === "paused") out.push(row("Run", "warn", doorsClosed ? "PAUSED before the doors (Power On waits for 🚪 Open the doors)" : "PAUSED (the story clock is stopped; ▶ Resume from Run or the host dock)", read));
  else if (phase === "idle") out.push(row("Run", "warn", "doors never opened on this run (🚪 Open the doors plays Power On)", read));
  else out.push(row("Run", "warn", `phase ${phase}`, read));
  const live = landingTitle !== null && title !== null && landingTitle === title && phase === "open";
  out.push(row("Event mode", "info", live ? `LIVE — advertised on the server's front page as "${landingTitle}"` : landingTitle === null ? "not advertised on / (a preview, or no live event is open)" : `not this one: / advertises "${landingTitle}"`, "GET /api/landing"));
  return out;
}

/** Who is here: real guests (the live guard's rule: not a `p-…` persona,
 *  not a load-test bot), performers in their booths, director consoles. */
export function peopleChecks(view: Json): Check[] {
  const read = "GET /api/state?role=mod";
  const roster = arr(view["roster"]);
  const real = roster.filter((r) => !String(r["id"]).startsWith("p-") && !/^K32 Bot /u.test(String(r["name"])));
  const online = real.filter((r) => r["online"] === true).length;
  const gone = real.filter((r) => r["gone"] === true).length;
  const captured = real.filter((r) => r["captured"] === true).length;
  const restricted = real.filter((r) => r["restricted"] === true).length;
  const personas = roster.length - real.length;
  const cast = arr(view["cast"]);
  const parts = cast.filter((c) => c["part"] === true);
  const inBooth = parts.filter((c) => c["online"] === true).map((c) => String(c["id"]));
  const dropped = parts.filter((c) => c["held"] === true && c["online"] !== true).map((c) => String(c["id"]));
  const directors = Array.isArray(view["directors"]) ? (view["directors"] as unknown[]).map(String) : [];
  const out = [
    row("Guests", "info", `${real.length} real guest(s) · ${online} online · ${gone} gone home · ${captured} captured · ${restricted} restricted${personas > 0 ? ` · ${personas} persona(s)` : ""}`, read),
    row(
      "Performers",
      dropped.length > 0 ? "warn" : "info",
      `${inBooth.length}/${parts.length} parts streaming${inBooth.length > 0 ? ` (${inBooth.join(", ")})` : ""}${dropped.length > 0 ? ` · phone dropped: ${dropped.join(", ")} (⏏ Release or re-sign in)` : ""}`,
      read,
    ),
    row("Directors", "info", `${num(view["modsOnline"]) ?? directors.length} console(s)${directors.length > 0 ? `: ${directors.join(", ")}` : ""}`, read),
  ];
  return out;
}

/** Every agent-voiced character (Trabolta): its worker online, its line of
 *  requests, the mind the worker runs (`mind_mode: new` since wave 12). */
export function agentChecks(view: Json, nowMs: number): Check[] {
  const read = "GET /api/state?role=mod (cast · minds)";
  const minds = arr(view["minds"]);
  return arr(view["cast"])
    .filter((c) => c["agent"] === true)
    .map((c) => {
      const id = String(c["id"]);
      const q = (c["agentQueue"] ?? {}) as Json;
      const mind = minds.find((m) => m["character"] === id);
      const bits: string[] = [];
      let level: Level = "ok";
      if (c["online"] !== true) {
        level = "fail";
        bits.push("NO WORKER ONLINE — the hold line goes out, directors answer from Run; on the MacBook: stagehand launchd status --job agents");
      } else bits.push("worker online");
      const depth = num(q["depth"]) ?? 0;
      const oldest = num(q["oldestMs"]);
      if (q["stalled"] === true) {
        level = "fail";
        bits.push("STALLED (connected, not answering) — restart the agents job");
      }
      bits.push(`queue ${depth}${oldest !== null ? `, oldest ${ago(oldest)}` : ""}`);
      if (oldest !== null && oldest > AGENT_WAIT_WARN_MS && level === "ok") level = "warn";
      if (mind !== undefined) {
        const mode = strOf(mind["mode"]) ?? "classic";
        bits.push(`mind ${mode}${strOf(mind["phase"]) ? ` · ${mind["phase"]}` : ""} · worker "${strOf(mind["worker"]) ?? "?"}"`);
        if (mode !== "new" && level === "ok") {
          level = "warn";
          bits.push("(the show runs mind_mode: new — check laptop.yaml)");
        }
        const at = mindAtMs(mind);
        if (at !== null) bits.push(`mind last changed ${ago(Math.max(0, nowMs - at))} ago`);
      }
      return row(`${id}'s worker`, level, bits.join(" · "), read);
    });
}

/** A mind report's `updatedAt` in epoch ms (the Python worker sends
 *  seconds). The worker mirrors only on a change (wave 12 `wire.py`), so
 *  this is when the mind last moved, not when the worker last spoke. */
function mindAtMs(mind: Json): number | null {
  const at = num(mind["updatedAt"]);
  if (at === null || at <= 0) return null;
  return at < 1e12 ? at * 1000 : at;
}

/** Before the doors the mod view has no cast, so nothing says whether the
 *  worker is online; the mind debugger's trace still lists the minds the
 *  workers reported (`GET /api/mod/agent/trace`). Info only: the real
 *  check (`agentChecks`) runs once the doors open. */
export function agentsBeforeDoorsCheck(trace: Json | null, nowMs: number): Check {
  const read = "GET /api/mod/agent/trace?limit=1 (minds)";
  const minds = trace === null ? [] : arr(trace["minds"]);
  if (minds.length === 0) return row("Agent workers", "info", "checked once the doors open (no cast yet); no worker has reported a mind to this server", read);
  const bits = minds.map((m) => {
    const at = mindAtMs(m);
    return `${String(m["character"])} by worker "${strOf(m["worker"]) ?? "?"}"${strOf(m["mode"]) ? ` (mind ${m["mode"]})` : ""}${at !== null ? `, last changed ${ago(Math.max(0, nowMs - at))} ago` : ""}`;
  });
  return row("Agent workers", "info", `checked once the doors open (no cast yet); minds reported: ${bits.join("; ")}`, read);
}

/** Before the doors (no sim yet): the mod view carries no cast and no
 *  `facts`, so neither the worker nor the judge can be read off it. */
export function beforeDoors(view: Json): boolean {
  return arr(view["cast"]).length === 0 && arr(view["roster"]).length === 0 && (view["phase"] === "idle" || view["doorsClosed"] === true);
}

/** The facts judge (wave 4) and the `judge:` character's ruling queue
 *  (wave 18b: every non-exact filing goes to Trabolta). */
export function judgeCheck(view: Json): Check {
  const read = "GET /api/state?role=mod (facts · cast.agentQueue.judging)";
  const facts = view["facts"] as Json | undefined;
  if ((facts === undefined || facts === null) && beforeDoors(view)) return row("Judge", "info", "judged once the doors open (the mod view carries facts.json from then)", read);
  if (facts === undefined || facts === null) return row("Judge", "warn", "no facts.json on this event — filings aren't judged (sync-show pushes the show's)", read);
  const judge = strOf(facts["judge"]);
  const mode = strOf(facts["mode"]) ?? "?";
  const pending = num(facts["pending"]) ?? 0;
  const cast = arr(view["cast"]).find((c) => c["id"] === judge);
  const judging = ((cast?.["agentQueue"] as Json | undefined)?.["judging"] ?? null) as Json | null;
  let level: Level = "ok";
  const bits = [`mode ${mode}`, `${pending} filing(s) without a verdict`];
  if (judge === null) bits.push("no judge: character (near misses wait on the Judging card)");
  else {
    bits.push(`judge ${judge}`);
    if (judging !== null) {
      bits.push(`rulings ${num(judging["queued"]) ?? 0} queued · ${num(judging["out"]) ?? 0} out${num(judging["oldestMs"]) !== null ? ` · oldest ${ago(num(judging["oldestMs"])!)}` : ""}`);
      if (judging["stalled"] === true) {
        level = "fail";
        bits.push("JUDGE STALLED — directors rule on the Judging card");
      }
    }
  }
  return row("Judge", level, bits.join(" · "), read);
}

// ---------------------------------------------------------------- terminals

/** A terminal's patch-bay fields, once the M4 bay's heartbeat reports them
 *  (`patch` = V–D pairs read or "fault", `patchComplete`, `patchFault`). */
function patchText(t: Json): { text: string; level: Level } | null {
  const p = t["patch"];
  if (p === undefined) return null;
  if (p === "fault") return { text: `🔌 FAULT ${strOf(t["patchFault"]) ?? ""}`.trim(), level: "fail" };
  const between = num(t["patchBetween"]);
  return { text: `🔌 ${String(p)}${t["patchComplete"] === true ? " ✓" : ""}${between !== null && between > 0 ? ` (${between} between levels)` : ""}`, level: between !== null && between > 0 ? "warn" : "ok" };
}

/** One terminal's verdict off its last heartbeat (`/api/mod/screen/terminals`). */
export function terminalVerdict(t: Json, silentMs: number): { level: Level; notes: string[] } {
  const notes: string[] = [];
  let level: Level = "ok";
  const bump = (l: Level) => {
    const rank: Record<Level, number> = { ok: 0, info: 1, warn: 2, fail: 3 };
    if (rank[l] > rank[level]) level = l;
  };
  const agoMs = num(t["ago"]) ?? Infinity;
  if (agoMs >= silentMs) {
    bump("fail");
    notes.push(`SILENT ${ago(agoMs)} — check its Wi-Fi / power / that the page is open`);
  } else notes.push(`polled ${ago(agoMs)} ago`);
  if (t["visible"] === false) {
    bump("warn");
    notes.push("page hidden (screen off / app switched)");
  }
  if (t["fullscreen"] === false) {
    bump("warn");
    notes.push("not full screen (relaunch Chrome --kiosk / touch it once)");
  }
  if (t["audio"] === false) {
    bump("warn");
    notes.push("sound locked (touch the screen once)");
  }
  const mic = strOf(t["mic"]);
  if (mic === "denied" || mic === "insecure" || mic === "locked") {
    bump("warn");
    notes.push(`mic ${mic}`);
  } else if (mic !== null) notes.push(`mic ${mic}`);
  const bat = num(t["battery"]);
  if (bat !== null) {
    if (bat < 20 && t["charging"] !== true) {
      bump("warn");
      notes.push(`battery ${bat}% NOT CHARGING`);
    } else notes.push(`battery ${bat}%${t["charging"] === true ? " ⚡" : ""}`);
  }
  if (t["announce"] === true) notes.push("says announcements");
  const door = strOf(t["door"]);
  if (door !== null && door !== "none") {
    const lvl = num(t["doorLevel"]);
    if (door === "fault") {
      bump("fail");
      notes.push(`🚪 FAULT ${strOf(t["doorFault"]) ?? ""} — ⚙ on that terminal; the 🚪 buttons cover it`.replace("  ", " "));
    } else notes.push(`🚪 ${door === "closed" ? "shut" : "open"}${lvl !== null ? ` ${lvl}` : ""}`);
    if (strOf(t["doorWarn"]) !== null) {
      bump("warn");
      notes.push(`⚠ ${t["doorWarn"]}`);
    }
  }
  const patch = patchText(t);
  if (patch !== null) {
    bump(patch.level);
    notes.push(patch.text);
  }
  return { level, notes };
}

/**
 * Every terminal that has polled, plus the map's spots none has (a key spot
 * missing is red, a wall spot amber: the house may hang fewer tablets), plus
 * one row for builds that disagree (a tablet still on an old cached build).
 */
export function terminalChecks(answer: Json, mapSpots: readonly { id: string; name: string }[]): Check[] {
  const read = "GET /api/mod/screen/terminals";
  const silentMs = num(answer["silentMs"]) ?? 20_000;
  const terms = arr(answer["terminals"]);
  const out: Check[] = [];
  for (const t of terms) {
    const v = terminalVerdict(t, silentMs);
    const where = [strOf(t["spot"]), strOf(t["view"])].filter((x) => x).join(" / ");
    out.push(row(`📟 ${String(t["name"])}`, v.level, `${where !== "" ? `${where} · ` : ""}${v.notes.join(" · ")}`, read));
  }
  const seen = new Set(terms.map((t) => strOf(t["spot"])).filter((s): s is string => s !== null && s !== ""));
  const quiet: string[] = [];
  for (const s of mapSpots) {
    if (seen.has(s.id)) continue;
    const key = KEY_SPOTS[s.id];
    if (key !== undefined) out.push(row(`📟 ${s.name}`, "fail", `spot ${s.id} — ${key} — has not polled since the server started`, read));
    else quiet.push(s.id);
  }
  // The wall spots nobody polls fold into one row: the house may hang fewer
  // tablets than the map has spots.
  if (quiet.length > 0) out.push(row("Wall spots", "info", `no terminal on ${quiet.length} map spot(s): ${quiet.join(", ")} (fine where no tablet hangs tonight)`, read));
  const versions = [...new Set(terms.map((t) => strOf(t["version"])).filter((v): v is string => v !== null))];
  if (versions.length > 1) out.push(row("Terminal builds", "warn", `${versions.length} builds in use (${versions.join(", ")}) — reload the old ones`, read));
  if (answer["voiceMuted"] === true) out.push(row("TV voice", "warn", "MUTED by a director (Run → Terminals → 🔊)", read));
  if (terms.length === 0 && mapSpots.length === 0) out.push(row("Terminals", "warn", "no terminal has polled since the server started", read));
  return out;
}

// ---------------------------------------------------------------- house

/** The screen state as a terminal sees it (read with NO `name`, so the read
 *  never registers a fake terminal): Trabolta awake, the King, the door and
 *  patch-bay overrides that mean the story follows buttons, not sensors. */
export function screenChecks(state: Json): Check[] {
  const read = "GET /api/screen/state (no name: not a heartbeat)";
  const out: Check[] = [];
  const night = (state["night"] ?? {}) as Json;
  const ch = state["character"] as Json | null | undefined;
  if (ch) out.push(row(`${String(ch["id"])} on the screens`, "info", `${ch["hidden"] === true ? "hidden" : "introduced"} · ${ch["awake"] === true ? "awake" : "asleep"} · voice worker ${ch["online"] === true ? "online" : "offline"}`, read));
  const king = state["king"] as Json | null | undefined;
  if (king) out.push(row("The King", "info", `${num(king["hp"]) ?? "?"}/${num(king["max"]) ?? "?"}${king["fallen"] === true ? " · FALLEN" : ""}${king["armed"] === true ? " · for the code" : ""}`, read));
  if (night["phase"] !== undefined && night["phase"] !== null) out.push(row("Night.phase", "info", String(night["phase"]), read));
  // Wave 38: the scene the story last cued (the router's catch-up reads it).
  if (night["music"] !== undefined) out.push(row("Night.music", "info", night["music"] === null ? "none (the router plays off)" : String(night["music"]), read));
  if (night["server_door"] !== null && night["server_door"] !== undefined) out.push(row("Server-room door", "info", `story says ${String(night["server_door"])}`, read));
  if (night["door_override"] === true) out.push(row("Door sensor", "warn", "IGNORED: the story follows the 🚪 buttons (Night.door_override) — 🚪 Trust the door sensor again once it reads right", read));
  if (night["patch_override"] === true) out.push(row("Patch bay", "warn", "IGNORED: the story follows the 🔌 buttons (Night.patch_override) — trust_patch_bay once the bay reads right", read));
  return out;
}

/** The house sound router (stagehand `audio`), read without `router=1` so
 *  this read never counts as the router itself. */
export function audioCheck(view: Json): Check[] {
  const read = "GET /api/mod/audio";
  const r = (view["router"] ?? {}) as Json;
  const problems = Array.isArray(view["problems"]) ? (view["problems"] as unknown[]).map(String) : [];
  const warnings = Array.isArray(view["warnings"]) ? (view["warnings"] as unknown[]).map(String) : [];
  const out: Check[] = [];
  if (r["online"] === true) out.push(row("Sound router", "ok", `online${strOf(r["name"]) ? ` as "${r["name"]}"` : ""} · audio.json from ${strOf(view["source"]) ?? "?"}`, read));
  else out.push(row("Sound router", "fail", `OFFLINE${num(r["lastSeen"]) !== null ? "" : " (never polled since the server started)"} — no story sound or announcement plays; start the audio job (the Desktop: scripts\\house-desktop\\start-stagehand.ps1 -Status / -Restart audio; the MacBook fallback: stagehand launchd status --job audio)`, read));
  if (problems.length > 0) out.push(row("audio.json", "warn", `${problems.length} problem(s): ${problems.slice(0, 3).join("; ")}`, read));
  else if (warnings.length > 0) out.push(row("audio.json", "info", `${warnings.length} warning(s): ${warnings.slice(0, 2).join("; ")}`, read));
  out.push(...soundtrackChecks(view));
  return out;
}

/** dBFS for a row: one decimal is noise, a whole number reads. */
const db = (v: number): string => (v <= -120 ? "silent" : `${Math.round(v)} dBFS`);

/**
 * (wave 38) The router's soundtrack and its sidechain meters, off the audio
 * view's `health` (the router's last report; absent from an older server or
 * router, and then no row). The scene and its beds; a playlist with no file
 * or a stream underrun is amber (a bed is silent, or stuttered). The input
 * levels are the inputs `audio.json` gives a `role` (Clippy's mic, the TV),
 * each with its source's activity: the music ducks while it is up.
 */
export function soundtrackChecks(view: Json): Check[] {
  const read = "GET /api/mod/audio";
  const h = view["health"];
  if (h === null || typeof h !== "object" || Array.isArray(h)) return [];
  const health = h as Json;
  const out: Check[] = [];
  const music = health["music"];
  const underruns = num(health["underruns"]);
  if (music !== null && typeof music === "object" && !Array.isArray(music)) {
    const m = music as Json;
    const scene = strOf(m["scene"]);
    const beds = arr(m["beds"]);
    const missing = Array.isArray(m["missing"]) ? (m["missing"] as unknown[]).map(String) : [];
    const bedText = beds
      .map((b) => {
        const n = Array.isArray(b["speakers"]) ? (b["speakers"] as unknown[]).length : 0;
        const track = strOf(b["track"]);
        return `${String(b["playlist"])} on ${n} speaker(s)${track ? ` (${track})` : ""}`;
      })
      .join("; ");
    const bad = missing.length > 0 || (underruns !== null && underruns > 0);
    const detail = [
      scene === null ? "no scene yet" : `scene ${scene}`,
      beds.length > 0 ? bedText : scene === null || scene === "off" ? null : "no bed playing",
      missing.length > 0 ? `NO FILES for ${missing.join(", ")} (that bed is silent: put the tracks in stagehand/media/music/)` : null,
      underruns !== null && underruns > 0 ? `${underruns} underrun(s) (the stream starved: the Desktop is busy, or the files are slow to read)` : null,
    ]
      .filter((x) => x !== null)
      .join(" · ");
    out.push(row("Soundtrack", bad ? "warn" : "info", detail, read));
  } else if (underruns !== null && underruns > 0) out.push(row("Soundtrack", "warn", `${underruns} underrun(s)`, read));

  const inputs = health["inputs"];
  if (inputs !== null && typeof inputs === "object" && !Array.isArray(inputs)) {
    const levels = inputs as Json;
    const sources = (health["sources"] !== null && typeof health["sources"] === "object" ? health["sources"] : {}) as Json;
    const audio = (view["audio"] ?? {}) as Json;
    const roles = arr(audio["inputs"]).filter((i) => strOf(i["role"]) !== null && num(i["ch"]) !== null);
    const shown = roles.length > 0 ? roles.map((i) => ({ ch: String(i["ch"]), role: strOf(i["role"]) })) : Object.keys(levels).map((ch) => ({ ch, role: null as string | null }));
    const parts = shown.map(({ ch, role }) => {
      const peak = num(levels[ch]);
      const act = role === null ? null : num(sources[role]);
      return `${role ?? "in"} ${ch}: ${peak === null ? "not metered" : db(peak)}${act === null ? "" : ` (ducking ${Math.round(act * 100)}%)`}`;
    });
    if (parts.length > 0) out.push(row("Sidechain inputs", "info", parts.join(" · "), read));
  }
  return out;
}

/** The house lights module (stagehand `lights`), read without `module=1`;
 *  and whether Zigbee2MQTT knows the server room's bulb. */
export function lightsCheck(view: Json, bulb = "server_room_rgb"): Check[] {
  const read = "GET /api/mod/lights";
  const m = view["module"] as Json | null | undefined;
  const out: Check[] = [];
  if (m && m["online"] === true) out.push(row("Lights module", "ok", `online as "${String(m["name"])}"`, read));
  else out.push(row("Lights module", "fail", `${m ? `offline (last poll as "${String(m["name"])}")` : "never polled since the server started"} — no look reaches the bulb; start the lights job on the Desktop`, read));
  const devices = arr(view["devices"]);
  if (num(view["devicesAt"]) === null) out.push(row("Zigbee devices", "warn", "the lights module never reported Zigbee2MQTT's device list", read));
  else if (!devices.some((d) => d["friendly"] === bulb)) out.push(row("Zigbee devices", "fail", `${bulb} is not paired (Z2M lists ${devices.length} device(s)) — pair it, name it ${bulb}`, read));
  else out.push(row("Zigbee devices", "ok", `${bulb} paired · ${devices.length} device(s)`, read));
  const problems = Array.isArray(view["problems"]) ? (view["problems"] as unknown[]).map(String) : [];
  if (problems.length > 0) out.push(row("lights.json", "warn", `${problems.length} problem(s): ${problems.slice(0, 3).join("; ")}`, read));
  return out;
}

/** VR headsets / web stations (`/api/mod/spatial/stations`, never the
 *  `station?id=` read, which registers one). */
export function stationsCheck(answer: Json): Check {
  const read = "GET /api/mod/spatial/stations";
  const st = arr(answer["stations"]);
  if (st.length === 0) return row("VR stations", "info", "no headset has polled since the server started", read);
  const on = st.filter((s) => s["online"] === true);
  const off = st.filter((s) => s["online"] !== true).map((s) => String(s["name"] ?? s["id"]));
  return row("VR stations", off.length > 0 ? "warn" : "ok", `${on.length}/${st.length} online${off.length > 0 ? ` · offline: ${off.join(", ")}` : ""}`, read);
}

/** The server process's load between two `/api/mod/metrics` samples of our
 *  own window: CPU as a share of one core (Node is one thread), the event
 *  loop's p99, memory, open streams. */
export function metricsCheck(a: Json, b: Json): Check {
  const read = "GET /api/mod/metrics?window=showctl (×2)";
  const ca = (a["cpu"] ?? {}) as Json;
  const cb = (b["cpu"] ?? {}) as Json;
  const wall = ((num(b["at"]) ?? 0) - (num(a["at"]) ?? 0)) * 1000;
  const used = (num(cb["userUs"]) ?? 0) + (num(cb["systemUs"]) ?? 0) - (num(ca["userUs"]) ?? 0) - (num(ca["systemUs"]) ?? 0);
  const cpu = wall > 0 ? Math.round((used / wall) * 100) : null;
  const loop = (b["eventLoop"] ?? {}) as Json;
  const p99 = num(loop["p99Ms"]);
  const mem = (b["memory"] ?? {}) as Json;
  let level: Level = "ok";
  if ((cpu !== null && cpu > 80) || (p99 !== null && p99 > 200)) level = "warn";
  return row("Server load", level, `CPU ${cpu === null ? "?" : `${cpu}%`} of one core · event loop p99 ${p99 ?? "?"} ms · ${num(mem["rssMb"]) ?? "?"} MB · ${num(b["clients"]) ?? "?"} streams · up ${ago((num(b["uptimeS"]) ?? 0) * 1000)}`, read);
}

/** The join links the codes route hands out must point at the public https
 *  origin (`LOOM_BASE_URL`): a phone can't reach `localhost` or plain http.
 *  Only the origin is printed — the link itself carries the guest code. */
export function joinBaseCheck(codes: Json, server: string): Check {
  const read = "POST /api/mod/codes (origin only)";
  const url = strOf(codes["joinUrl"]);
  if (url === null) return row("Join links", "warn", "the codes route gave no joinUrl", read);
  let origin = "?";
  try {
    origin = new URL(url).origin;
  } catch {
    return row("Join links", "fail", "joinUrl is not a URL", read);
  }
  const bad = /^http:/u.test(origin) && /^https:/u.test(server);
  const local = /localhost|127\.0\.0\.1/u.test(origin) && !/localhost|127\.0\.0\.1/u.test(server);
  return row("Join links", bad || local ? "fail" : "ok", `QR and join links point at ${origin}${bad || local ? " — set LOOM_BASE_URL on the VPS to the public https origin" : ""}`, read);
}

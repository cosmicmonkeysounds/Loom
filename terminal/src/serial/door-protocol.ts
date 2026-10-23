//! The server-room door sensor's serial protocol (wave 20, CONTRACT-w20 §2.9):
//! the Grand Central M4 behind the heart terminal (`hardware/server-room-door/`)
//! writes one JSON object per `\n`-terminated line at 115200, and takes plain
//! text commands back. Pure: no Web Serial here (`door-serial.ts` is the
//! transport), so the parser is tested line for line against the firmware's
//! own fixture (`hardware/server-room-door/test/fixtures/lines.jsonl`).
//!
//! The firmware may be silent for up to 2 s after a restart (`set mode`,
//! `set settle`, `reset`) while a fault builds, and answers a calibration a
//! restart interrupted with `{"t":"err","error":"cal cancelled",…}`.

export type DoorMode = "mod" | "steady" | "auto";

/** A blocking fault (the bridge posts nothing while one stands). */
export type DoorFault = "ldr_saturated" | "led_dead" | "stale" | "no_port";
/** The faults the firmware itself reports on a `door` line. */
export const FIRMWARE_FAULTS: readonly string[] = ["ldr_saturated", "led_dead"];

export interface HelloLine {
  t: "hello";
  fw: string;
  mode: "mod" | "steady";
  auto: boolean;
  close: number;
  open: number;
  settle: number;
  cal: boolean;
  sense: boolean;
}

export interface DoorReading {
  t: "door";
  seq: number;
  open: boolean;
  level: number;
  lit: number;
  dark: number;
  /** A blocking fault (`ldr_saturated` | `led_dead`), else null. */
  fault: string | null;
  /** A non-blocking warning (`ldr_open`), else null. */
  warn: string | null;
}

export interface PongLine {
  t: "pong";
  up: number;
}

export interface CfgLine extends Omit<HelloLine, "t"> {
  t: "cfg";
  saved: boolean;
}

export interface CalLine {
  t: "cal";
  which: "closed" | "open";
  ref: number;
  close: number;
  open: number;
}

export interface OkLine {
  t: "ok";
  cmd: string;
}

export interface ErrLine {
  t: "err";
  error: string;
  cmd: string;
}

export type DoorLine = HelloLine | DoorReading | PongLine | CfgLine | CalLine | OkLine | ErrLine;

const LEVEL_MAX = 4095;

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isLevel = (v: unknown): v is number => isInt(v) && v >= 0 && v <= LEVEL_MAX;
const isCode = (v: unknown): v is string => typeof v === "string" && /^[a-z_]{1,24}$/u.test(v);
const codeOrNull = (v: unknown): string | null | undefined => (v === null ? null : isCode(v) ? v : undefined);

function settings(r: Record<string, unknown>): Omit<HelloLine, "t"> | null {
  const mode = r["mode"];
  if (typeof r["fw"] !== "string" || (mode !== "mod" && mode !== "steady")) return null;
  if (!isLevel(r["close"]) || !isLevel(r["open"]) || !isInt(r["settle"])) return null;
  return { fw: r["fw"], mode, auto: r["auto"] === true, close: r["close"], open: r["open"], settle: r["settle"], cal: r["cal"] === true, sense: r["sense"] === true };
}

/** One line off the port, or null (noise, a half line from before the port
 *  opened, a boot banner, anything not exactly the protocol). */
export function parseDoorLine(raw: string): DoorLine | null {
  const text = raw.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  switch (r["t"]) {
    case "hello": {
      const s = settings(r);
      return s === null ? null : { t: "hello", ...s };
    }
    case "cfg": {
      const s = settings(r);
      return s === null ? null : { t: "cfg", ...s, saved: r["saved"] === true };
    }
    case "door": {
      const fault = codeOrNull(r["fault"]);
      const warn = codeOrNull(r["warn"]);
      if (!isInt(r["seq"]) || typeof r["open"] !== "boolean" || !isLevel(r["level"]) || !isLevel(r["lit"]) || !isLevel(r["dark"]) || fault === undefined || warn === undefined) return null;
      return { t: "door", seq: r["seq"], open: r["open"], level: r["level"], lit: r["lit"], dark: r["dark"], fault, warn };
    }
    case "pong":
      return isInt(r["up"]) ? { t: "pong", up: r["up"] } : null;
    case "cal": {
      const which = r["which"];
      if ((which !== "closed" && which !== "open") || !isLevel(r["ref"]) || !isLevel(r["close"]) || !isLevel(r["open"])) return null;
      return { t: "cal", which, ref: r["ref"], close: r["close"], open: r["open"] };
    }
    case "ok":
      return typeof r["cmd"] === "string" ? { t: "ok", cmd: r["cmd"] } : null;
    case "err":
      return typeof r["error"] === "string" && typeof r["cmd"] === "string" ? { t: "err", error: r["error"], cmd: r["cmd"] } : null;
    default:
      return null;
  }
}

/**
 * Splits a byte stream's text into whole lines. A chunk may end mid-line (the
 * rest comes in the next read); a runaway line with no newline is dropped
 * after `max` characters so a babbling port can't grow memory.
 */
export class LineSplitter {
  private buf = "";
  constructor(private readonly max = 1024) {}
  push(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];
    let i = this.buf.indexOf("\n");
    while (i >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/u, "");
      if (line.trim() !== "") out.push(line);
      this.buf = this.buf.slice(i + 1);
      i = this.buf.indexOf("\n");
    }
    if (this.buf.length > this.max) this.buf = "";
    return out;
  }
}

// --- commands --------------------------------------------------------------------

export type DoorCommand =
  | { c: "ping" }
  | { c: "version" }
  | { c: "get" }
  | { c: "cal"; which: "closed" | "open" }
  | { c: "set"; key: "close" | "open"; value: number }
  | { c: "set"; key: "mode"; value: DoorMode }
  | { c: "set"; key: "settle"; value: number }
  | { c: "save" }
  | { c: "reset" };

/** A command as the firmware reads it (no newline; the transport adds it). */
export function formatCommand(cmd: DoorCommand): string {
  switch (cmd.c) {
    case "cal":
      return `cal ${cmd.which}`;
    case "set":
      return `set ${cmd.key} ${cmd.key === "mode" ? cmd.value : Math.round(cmd.value)}`;
    default:
      return cmd.c;
  }
}

/** The thresholds a terminal keeps for its sensor and re-sends on every connect. */
export interface DoorSettings {
  close: number;
  open: number;
  mode?: DoorMode;
  settle?: number;
}

export const DOOR_SETTINGS_KEY = "loom.terminal.door";

/** Stored settings, or null (none, or anything the firmware would refuse). */
export function parseDoorSettings(raw: string | null): DoorSettings | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!isLevel(v["close"]) || !isLevel(v["open"]) || v["open"] >= v["close"]) return null;
    const out: DoorSettings = { close: v["close"], open: v["open"] };
    if (v["mode"] === "mod" || v["mode"] === "steady" || v["mode"] === "auto") out.mode = v["mode"];
    if (isInt(v["settle"]) && v["settle"] >= 20 && v["settle"] <= 1000) out.settle = v["settle"];
    return out;
  } catch {
    return null;
  }
}

/** The firmware's own thresholds before anything is stored (`config.h` `DEF_CLOSE` / `DEF_OPEN`). */
export const FIRMWARE_DEFAULTS = { close: 1800, open: 1200 } as const;

/** What a board runs, as a stored `mode`: `auto` when its boot probe picked. */
export function boardMode(now: Pick<HelloLine, "mode" | "auto">): DoorMode {
  return now.auto ? "auto" : now.mode;
}

/**
 * Whether a terminal's stored settings belong to the board as it runs now.
 * Calibration stores the board's mode beside the thresholds, and a level in
 * `mod` (lit − dark, the LED pulsed on D2) is not a level in `steady` (the
 * raw reading, the LED on 5V): after a rewire and a reflash (the firmware's
 * `LED_MODE`) the old thresholds would judge the door wrong, so nothing is
 * re-sent and ⚙ asks for a calibration instead. Settings with no mode, or
 * an unknown board, fit.
 */
export function settingsFit(want: DoorSettings, now: Pick<HelloLine, "mode" | "auto"> | null): boolean {
  return want.mode === undefined || now === null || boardMode(now) === want.mode;
}

/**
 * The commands that put a just-connected board on the stored settings,
 * given what it says it runs now (`cfg` / `hello`). The firmware refuses an
 * `open` that is not below its current `close` (and the other way round), so
 * the two thresholds go in whichever order keeps `open < close` at every
 * step. Nothing is sent for a value that already matches; `settle` last (it
 * restarts the sampler: a silent gap of up to 2 s). The mode is never sent:
 * it is the wiring's, which the firmware's build (`LED_MODE`) or its own
 * flash knows; settings stored in another mode send nothing (`settingsFit`).
 */
export function settingsCommands(want: DoorSettings, now: Pick<HelloLine, "close" | "open" | "mode" | "auto" | "settle"> | null): DoorCommand[] {
  if (!settingsFit(want, now)) return [];
  const out: DoorCommand[] = [];
  const closeCmd: DoorCommand = { c: "set", key: "close", value: want.close };
  const openCmd: DoorCommand = { c: "set", key: "open", value: want.open };
  // Unknown settings: send both, ordered as if the board ran its defaults.
  if (now === null) out.push(...(want.close > FIRMWARE_DEFAULTS.open ? [closeCmd, openCmd] : [openCmd, closeCmd]));
  else {
    const needClose = now.close !== want.close;
    const needOpen = now.open !== want.open;
    // Raising close first keeps open below it; lowering it first could cross the current open.
    if (needClose && needOpen) out.push(...(want.close > now.open ? [closeCmd, openCmd] : [openCmd, closeCmd]));
    else if (needClose) out.push(closeCmd);
    else if (needOpen) out.push(openCmd);
  }
  if (want.settle !== undefined && (now === null || now.settle !== want.settle)) out.push({ c: "set", key: "settle", value: want.settle });
  return out;
}

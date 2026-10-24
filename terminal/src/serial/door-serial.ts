//! The door bridge, running (wave 20, a lazy chunk: only a terminal with
//! `door=serial` / `sim` loads it). Web Serial to the Grand Central M4 behind
//! the heart terminal (`navigator.serial`, desktop Chrome on https; feature
//! detected — anything else says so in ⚙), or the dev rig `door=sim` (the keys
//! O / C toggle a pretend door, F a fault). Lines go through the pure
//! `DoorBridge` (edges, reconcile, faults) and `POST /api/mod/signal` with the
//! terminal's `x-loom-token` (the server never reads `Authorization`).
//!
//! On every connect the board is asked `get`, and the thresholds this terminal
//! stored at its last calibration (`loom.terminal.door`) are re-sent in an
//! order the firmware accepts. A port granted once is reopened on every later
//! boot (`getPorts()`) and on a replug (the `connect` event). Close any serial
//! monitor first: the port is exclusive.
//!
//! The same board reads the patch bay (wave 22): its `patch` lines go through
//! the pure `PatchBridge` (a new complete set of four cables → `patch_changed
//! {combo}`), when the board says it has a bay (`pbd > 0`) and the config's
//! `bay` is on (`&bay=0` turns it off). `door=sim` fakes cables too, with
//! Shift held (a bare digit answers the heart's menu): Shift+1–8 picks a
//! source, then Shift+1–7 the input it goes into (Shift+0 pulls that
//! source's cable); Shift+0 on its own pulls them all.

import { baseOf, type TerminalConfig } from "../config.ts";
import { DoorBridge, type DoorSignal, type PostOutcome, type StoryDoor } from "./door-bridge.ts";
import { DOOR_SETTINGS_KEY, LineSplitter, PAIRS_RE, formatCommand, parseDoorLine, parseDoorSettings, settingsCommands, settingsFit, type BayCommand, type CalLine, type DoorCommand, type DoorLine, type ErrLine, type HelloLine, type PbcalLine } from "./door-protocol.ts";
import { PATCH_SIGNAL, PatchBridge, pairsOf, patchSummary, type StoryPatch } from "./patch-bridge.ts";
import { DOOR_OFF, doorStatus, onDoorRescan, patchDoorStatus, setDoorActions, setDoorStatus } from "./door-status.ts";

/** Adafruit's USB vendor id (the Grand Central M4). */
export const ADAFRUIT_VID = 0x239a;
export const DOOR_BAUD = 115200;
/** How long a calibration may take before ⚙ gives up on its answer (ms; the firmware averages 2 s). */
export const CAL_TIMEOUT_MS = 6000;
/** Look for a granted port again this often while none is open (ms). */
export const RESCAN_MS = 5000;
/** How long a `pb` command may take before ⚙ gives up on its answer (ms; `pb learn` averages 1 s). */
export const BAY_TIMEOUT_MS = 4000;

// --- Web Serial, minimally typed (not in TypeScript's DOM lib) ---------------------

export interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}

export interface SerialLike {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(o?: { filters?: Array<{ usbVendorId?: number }> }): Promise<SerialPortLike>;
  addEventListener(type: "connect" | "disconnect", fn: (e: Event) => void): void;
  removeEventListener(type: "connect" | "disconnect", fn: (e: Event) => void): void;
}

/** This browser's Web Serial, or null (Safari, Firefox, Android, plain http). */
export function serialApi(): SerialLike | null {
  try {
    return typeof navigator !== "undefined" && "serial" in navigator ? ((navigator as unknown as { serial: SerialLike }).serial ?? null) : null;
  } catch {
    return null;
  }
}

/** The port to use among the granted ones: an Adafruit board first. */
export function pickPort(ports: readonly SerialPortLike[]): SerialPortLike | null {
  return ports.find((p) => p.getInfo?.().usbVendorId === ADAFRUIT_VID) ?? ports[0] ?? null;
}

/** ⚙'s *Connect door sensor*: ask for the port (call it inside the click — a
 *  user gesture). Resolves with a problem to show, or null when granted. */
export async function requestDoorPort(serial: SerialLike | null = serialApi()): Promise<string | null> {
  if (serial === null) return "This browser has no Web Serial: use desktop Chrome on https.";
  try {
    await serial.requestPort({ filters: [{ usbVendorId: ADAFRUIT_VID }] });
    return null;
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    return name === "NotFoundError" ? "No port picked." : `Couldn't get the port (${(e as Error).message}).`;
  }
}

// --- the post ---------------------------------------------------------------------------

type SignalConfig = Pick<TerminalConfig, "eventId" | "token" | "name">;

/** A device signal to the event: `POST /api/mod/signal` with the terminal's
 *  `x-loom-token` and its name as the journal's `by`. */
export function signalRequest(config: SignalConfig, name: string, args: Record<string, string | number>): { url: string; init: RequestInit } {
  return {
    url: `${baseOf(config)}/api/mod/signal`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "x-loom-token": config.token },
      body: JSON.stringify({ name, args, label: `Terminal · ${config.name}`.slice(0, 60) }),
    },
  };
}

/** The `/api/mod/signal` request for an edge. */
export function doorSignalRequest(config: SignalConfig, signal: DoorSignal, level: number): { url: string; init: RequestInit } {
  return signalRequest(config, signal, { level: Math.round(level) });
}

/** The `/api/mod/signal` request for a combination: `patch_changed {combo}`. */
export function patchSignalRequest(config: SignalConfig, combo: string): { url: string; init: RequestInit } {
  if (!PAIRS_RE.test(combo)) throw new Error("not a pair list");
  return signalRequest(config, PATCH_SIGNAL, { combo });
}

async function postSignal(req: { url: string; init: RequestInit }, fetchFn: typeof fetch): Promise<PostOutcome> {
  try {
    const res = await fetchFn(req.url, req.init);
    return res.ok ? "ok" : "refused";
  } catch {
    return "network";
  }
}

export function postDoorSignal(config: SignalConfig, signal: DoorSignal, level: number, fetchFn: typeof fetch = fetch): Promise<PostOutcome> {
  return postSignal(doorSignalRequest(config, signal, level), fetchFn);
}

export function postPatchSignal(config: SignalConfig, combo: string, fetchFn: typeof fetch = fetch): Promise<PostOutcome> {
  return postSignal(patchSignalRequest(config, combo), fetchFn);
}

// --- the sources -----------------------------------------------------------------------

interface Source {
  /** Write one command (the firmware's text; a newline is added). */
  send(cmd: DoorCommand): Promise<void>;
  stop(): void;
}

interface Sink {
  line(l: DoorLine): void;
  connected(on: boolean, problem?: string | null): void;
}

/** The firmware's nominal source levels (`config.h` `PB_NOMINAL`): the sim's readings. */
export const SIM_LEVELS: readonly number[] = [445, 921, 1338, 1848, 2247, 2757, 3174, 3650];
const SIM_INPUTS = 7;

/** The dev rig: O / C open and shut a pretend door, F toggles a fault; a
 *  `door` line on every change and every second, like the firmware. With a
 *  bay (`bay`, the default) Shift+1–8 picks a source and the next Shift+1–7
 *  the input its cable goes into (Shift+0 instead pulls that source's cable;
 *  Shift+0 with nothing picked pulls every cable; Shift, because a bare digit
 *  answers the heart's menu), and a `patch` line goes out on
 *  every change (settled at once) and every second. Keys typed into a field
 *  (the composer) never move it. */
export function simSource(sink: Sink, target: Pick<Window, "addEventListener" | "removeEventListener" | "setInterval" | "clearInterval"> = window, bay = true): Source {
  let open = false;
  let fault = false;
  let seq = 0;
  let pseq = 0;
  /** Input → source (0: empty). */
  const plug: number[] = new Array<number>(SIM_INPUTS).fill(0);
  let picked: number | null = null;
  const levels = [...SIM_LEVELS];
  const emit = () => sink.line({ t: "door", seq: seq++, open: open || fault, level: fault ? 0 : open ? 20 : 2400, lit: fault ? 4095 : open ? 640 : 3020, dark: fault ? 4095 : 610, fault: fault ? "ldr_saturated" : null, warn: null });
  const emitPatch = () => {
    if (!bay) return;
    const src = [...plug];
    const sum = patchSummary(src);
    sink.line({ t: "patch", seq: pseq++, pairs: pairsOf(src), count: sum.count, complete: sum.count === 4 && sum.between === 0 && !sum.dup, raw: src.map((k) => (k > 0 ? levels[k - 1]! : 2)), src, stable: true });
  };
  const pbcal = (src: number, raw: number): PbcalLine => ({ t: "pbcal", src, raw, levels: [...levels], floor: 150, tol: 120, saved: false });
  const hello = { fw: "door-sim", mode: "steady" as const, auto: false, close: 1800, open: 1200, settle: 150, cal: false, sense: false, pbv: bay ? 8 : 0, pbd: bay ? SIM_INPUTS : 0 };
  const onKey = (e: KeyboardEvent) => {
    const el = e.target as { tagName?: string; isContentEditable?: boolean } | null;
    if (e.metaKey || e.ctrlKey || e.altKey || el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable === true) return;
    const k = e.key.toLowerCase();
    const digit = /^Digit([0-9])$/u.exec(e.code ?? "");
    if (bay && e.shiftKey && digit !== null) {
      const d = Number(digit[1]);
      if (picked === null) {
        if (d === 0) plug.fill(0);
        else if (d <= levels.length) picked = d;
        if (d !== 0) return;
      } else {
        const source = picked;
        picked = null;
        // A source's jack takes one plug: its cable leaves wherever it was.
        for (let i = 0; i < plug.length; i++) if (plug[i] === source) plug[i] = 0;
        if (d >= 1 && d <= SIM_INPUTS) plug[d - 1] = source;
        else if (d !== 0) return;
      }
      emitPatch();
      return;
    }
    if (k === "o") open = true;
    else if (k === "c") open = false;
    else if (k === "f") fault = !fault;
    else return;
    emit();
  };
  target.addEventListener("keydown", onKey as EventListener);
  sink.connected(true);
  sink.line({ t: "hello", ...hello });
  emit();
  emitPatch();
  const tick = target.setInterval(() => {
    emit();
    emitPatch();
  }, 1000);
  return {
    send: async (cmd) => {
      if (cmd.c === "cal") sink.line({ t: "cal", which: cmd.which, ref: cmd.which === "closed" ? 2400 : 20, close: 1800, open: 1200 });
      else if (cmd.c === "get") sink.line({ t: "cfg", ...hello, saved: false });
      else if (cmd.c === "pb") {
        if (!bay) sink.line({ t: "err", error: "pb: no bay", cmd: formatCommand(cmd) });
        else if (cmd.op === "learn") {
          const at = plug.flatMap((k, i) => (k > 0 ? [i] : []));
          if (at.length !== 1) sink.line({ t: "err", error: "pb: need exactly one cable", cmd: formatCommand(cmd) });
          else {
            const raw = levels[plug[at[0]!]! - 1]!;
            levels[cmd.source - 1] = raw;
            sink.line(pbcal(cmd.source, raw));
          }
        } else {
          if (cmd.op === "reset") levels.splice(0, levels.length, ...SIM_LEVELS);
          if (cmd.op === "get") emitPatch();
          sink.line(pbcal(0, 0));
        }
      } else sink.line({ t: "ok", cmd: formatCommand(cmd) });
    },
    stop: () => {
      target.removeEventListener("keydown", onKey as EventListener);
      target.clearInterval(tick);
      sink.connected(false);
    },
  };
}

/** Web Serial: reopen a granted port (now, on a replug, on ⚙'s grant and
 *  every `RESCAN_MS` while none is open), read lines, write commands. */
export function serialSource(sink: Sink, serial: SerialLike): Source {
  let port: SerialPortLike | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let stopped = false;
  let opening = false;
  let writes: Promise<void> = Promise.resolve();
  const encoder = new TextEncoder();

  const close = async () => {
    const p = port;
    port = null;
    try {
      await reader?.cancel();
    } catch {
      /* already gone */
    }
    reader = null;
    try {
      await p?.close();
    } catch {
      /* unplugged */
    }
  };

  const read = async (p: SerialPortLike) => {
    const split = new LineSplitter();
    const decoder = new TextDecoder();
    try {
      while (!stopped && p.readable !== null) {
        reader = p.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            for (const raw of split.push(decoder.decode(value, { stream: true }))) {
              const l = parseDoorLine(raw);
              if (l !== null) sink.line(l);
            }
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {
            /* released */
          }
        }
        if (port !== p) break;
      }
    } catch {
      /* the board went away mid-read */
    }
    if (port === p) {
      await close();
      if (!stopped) sink.connected(false, "the door sensor went away — reconnecting");
    }
  };

  const scan = async () => {
    if (stopped || port !== null || opening) return;
    opening = true;
    try {
      const p = pickPort(await serial.getPorts());
      if (p === null) {
        sink.connected(false, "door sensor not connected — press Connect door sensor (once per browser profile)");
        return;
      }
      try {
        await p.open({ baudRate: DOOR_BAUD });
      } catch (e) {
        sink.connected(false, `the door sensor's port won't open (${(e as Error).message}) — close any serial monitor`);
        return;
      }
      if (stopped) {
        await p.close().catch(() => {});
        return;
      }
      port = p;
      sink.connected(true);
      void read(p);
    } catch (e) {
      sink.connected(false, `door sensor: ${(e as Error).message}`);
    } finally {
      opening = false;
    }
  };

  const onConnect = () => void scan();
  const onDisconnect = () => {
    if (port !== null) void close().then(() => sink.connected(false, "the door sensor was unplugged"));
  };
  serial.addEventListener("connect", onConnect);
  serial.addEventListener("disconnect", onDisconnect);
  const offRescan = onDoorRescan(() => void scan());
  const timer = setInterval(() => void scan(), RESCAN_MS);
  void scan();

  return {
    send: (cmd) => {
      writes = writes.then(async () => {
        const w = port?.writable?.getWriter();
        if (w === undefined) return;
        try {
          await w.write(encoder.encode(`${formatCommand(cmd)}\n`));
        } finally {
          w.releaseLock();
        }
      }).catch(() => {});
      return writes;
    },
    stop: () => {
      stopped = true;
      clearInterval(timer);
      offRescan();
      serial.removeEventListener("connect", onConnect);
      serial.removeEventListener("disconnect", onDisconnect);
      void close();
    },
  };
}

// --- the link ----------------------------------------------------------------------------

function storage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The running bridge: start it with the terminal's config, feed it each screen state. */
export interface DoorLink {
  screen(night: StoryDoor & Partial<StoryPatch>): void;
  stop(): void;
}

export function startDoorLink(config: TerminalConfig, o: { fetchFn?: typeof fetch; serial?: SerialLike | null; store?: Pick<Storage, "getItem" | "setItem"> | null; keys?: Parameters<typeof simSource>[1] } = {}): DoorLink {
  const kind = config.door === "sim" ? "sim" : "serial";
  const bayOn = config.bay !== false;
  const store = o.store === undefined ? storage() : o.store;
  setDoorStatus({ ...DOOR_OFF, configured: true, kind });
  const bridge = new DoorBridge({
    now: () => Date.now(),
    post: (signal, level) => postDoorSignal(config, signal, level, o.fetchFn ?? fetch),
    later: (fn, ms) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    },
  });
  const patch = new PatchBridge({
    now: () => Date.now(),
    post: (combo) => {
      // Counted when sent, for ⚙'s line (never the pairs themselves).
      patchDoorStatus({ patchPosts: doorStatus().patchPosts + 1 });
      return postPatchSignal(config, combo, o.fetchFn ?? fetch);
    },
    later: (fn, ms) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    },
  });
  let applied = false;
  let waiting: { which: "closed" | "open"; resolve: (l: CalLine | ErrLine) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  let bayWaiting: { cmd: string; resolve: (l: PbcalLine | ErrLine) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  let source: Source | null = null;

  const bayDone = (l: PbcalLine | ErrLine) => {
    if (bayWaiting === null) return;
    clearTimeout(bayWaiting.timer);
    const w = bayWaiting;
    bayWaiting = null;
    w.resolve(l);
  };

  const settle = (l: CalLine | ErrLine) => {
    if (waiting === null) return;
    clearTimeout(waiting.timer);
    const w = waiting;
    waiting = null;
    w.resolve(l);
  };

  const sink: Sink = {
    connected: (on, problem = null) => {
      if (!on) {
        applied = false;
        bridge.disconnected();
        patch.disconnected();
      }
      patchDoorStatus({ connected: on, problem: on ? null : problem, ...(on ? {} : { sensor: null, patch: null }) });
      if (on && source !== null) void source.send({ c: "get" });
    },
    line: (l) => {
      switch (l.t) {
        case "door":
          bridge.line(l);
          patchDoorStatus({ sensor: bridge.reading });
          return;
        case "patch":
          if (!doorStatus().bay) return;
          patch.line(l);
          patchDoorStatus({ patch: patch.reading });
          return;
        case "pbcal":
          patchDoorStatus({ pbcal: l });
          bayDone(l);
          return;
        case "hello":
        case "cfg": {
          const { t: _t, ...board } = l as HelloLine & { saved?: boolean };
          const want = parseDoorSettings(store?.getItem(DOOR_SETTINGS_KEY) ?? null);
          // Stored settings from another mode (the LED rewired, the firmware
          // rebuilt) are not sent: ⚙ asks for a calibration instead.
          patchDoorStatus({ board, recal: want !== null && !settingsFit(want, l), bay: bayOn && l.pbd > 0 });
          // Put the board on this terminal's stored settings once per connect.
          if (!applied && want !== null && source !== null) {
            applied = true;
            for (const cmd of settingsCommands(want, l)) void source.send(cmd);
          } else applied = true;
          return;
        }
        case "cal": {
          patchDoorStatus({ cal: l });
          if (l.open < l.close) {
            patchDoorStatus({ recal: false });
            const b = doorStatus().board;
            const keep = { close: l.close, open: l.open, ...(b !== null ? { mode: b.mode, settle: b.settle } : {}) };
            try {
              store?.setItem(DOOR_SETTINGS_KEY, JSON.stringify(keep));
            } catch {
              /* no storage: the board's own flash still has it */
            }
            void source?.send({ c: "save" });
          }
          settle(l);
          return;
        }
        case "err":
          if (l.cmd.startsWith("cal")) {
            patchDoorStatus({ cal: l });
            settle(l);
          } else if (l.cmd.startsWith("pb")) {
            patchDoorStatus({ pbcal: l });
            bayDone(l);
          }
          return;
        default:
          return;
      }
    },
  };

  if (kind === "sim") source = simSource(sink, o.keys, bayOn);
  else {
    const serial = o.serial === undefined ? serialApi() : o.serial;
    if (serial === null) patchDoorStatus({ unsupported: true, problem: "the door sensor needs desktop Chrome on https (Web Serial)" });
    else source = serialSource(sink, serial);
  }

  setDoorActions({
    calibrate: (which) =>
      new Promise((resolve) => {
        if (waiting !== null) settle({ t: "err", error: "replaced", cmd: `cal ${waiting.which}` });
        const timer = setTimeout(() => settle({ t: "err", error: "no answer from the sensor", cmd: `cal ${which}` }), CAL_TIMEOUT_MS);
        waiting = { which, resolve, timer };
        if (source === null) settle({ t: "err", error: "no door sensor connected", cmd: `cal ${which}` });
        else void source.send({ c: "cal", which });
      }),
    bay: (cmd: BayCommand) =>
      new Promise((resolve) => {
        const text = formatCommand(cmd);
        if (bayWaiting !== null) bayDone({ t: "err", error: "replaced", cmd: bayWaiting.cmd });
        const timer = setTimeout(() => bayDone({ t: "err", error: "no answer from the board", cmd: text }), BAY_TIMEOUT_MS);
        bayWaiting = { cmd: text, resolve, timer };
        if (source === null || !doorStatus().connected) bayDone({ t: "err", error: "no board connected", cmd: text });
        else void source.send(cmd);
      }),
  });

  return {
    screen: (night) => {
      bridge.screen(night);
      patch.screen({ server_door: night.server_door, patch_override: night.patch_override ?? null });
    },
    stop: () => {
      bridge.stop();
      patch.stop();
      source?.stop();
      source = null;
      setDoorActions(null);
      setDoorStatus(DOOR_OFF);
    },
  };
}

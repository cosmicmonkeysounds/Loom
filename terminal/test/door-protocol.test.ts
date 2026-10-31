import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LineSplitter, boardMode, formatCommand, parseDoorLine, parseDoorSettings, settingsCommands, settingsFit } from "../src/serial/door-protocol.ts";

const OURS = fileURLToPath(new URL("./fixtures/door-lines.jsonl", import.meta.url));
const FIRMWARE = fileURLToPath(new URL("../../hardware/server-room-m4/test/fixtures/lines.jsonl", import.meta.url));
const lines = readFileSync(OURS, "utf8").split("\n").filter((l) => l.trim() !== "");

describe("the door sensor's protocol (§2.9)", () => {
  it("keeps its fixture byte-equal to the firmware's", () => {
    expect(readFileSync(OURS, "utf8")).toBe(readFileSync(FIRMWARE, "utf8"));
  });

  it("parses every example line of the firmware", () => {
    const parsed = lines.map(parseDoorLine);
    expect(parsed.every((p) => p !== null)).toBe(true);
    expect(parsed.map((p) => p?.t)).toEqual(["hello", "door", "door", "door", "door", "pong", "cfg", "cal", "ok", "err", "patch", "patch", "pbcal", "err"]);
    expect(parsed[0]).toEqual({ t: "hello", fw: "door-m4 1.3.0", mode: "steady", auto: false, close: 1800, open: 1200, settle: 150, cal: false, sense: false, pbv: 4, pbd: 4 });
    expect(parsed[1]).toEqual({ t: "door", seq: 17, open: false, level: 2410, lit: 3020, dark: 610, fault: null, warn: null });
    expect(parsed[3]).toMatchObject({ open: true, fault: null, warn: "ldr_open" });
    expect(parsed[4]).toMatchObject({ open: true, fault: "ldr_saturated", warn: null });
    expect(parsed[5]).toEqual({ t: "pong", up: 123456 });
    expect(parsed[6]).toMatchObject({ t: "cfg", mode: "mod", auto: false, cal: true, saved: true });
    expect(parsed[7]).toEqual({ t: "cal", which: "closed", ref: 2400, close: 1880, open: 1320 });
    expect(parsed[8]).toEqual({ t: "ok", cmd: "set close 1900" });
    expect(parsed[9]).toEqual({ t: "err", error: "cal span too small", cmd: "cal open" });
    expect(parsed[6]).toMatchObject({ pbv: 4, pbd: 4 });
    expect(parsed[10]).toEqual({ t: "patch", seq: 41, pairs: "V3-D1,V4-D3", count: 2, complete: false, raw: [2519, 1400, 3741, 3], src: [3, -1, 4, 0], stable: false });
    expect(parsed[11]).toMatchObject({ t: "patch", count: 4, complete: true, src: [3, 1, 4, 2], stable: true });
    expect(parsed[12]).toEqual({ t: "pbcal", src: 3, raw: 2531, levels: [1193, 1785, 2531, 3741], floor: 150, tol: 200, saved: false });
    expect(parsed[13]).toEqual({ t: "err", error: "pb: need exactly one cable", cmd: "pb learn V3" });
  });

  it("reads an older board's hello as one with no bay", () => {
    const old = '{"t":"hello","fw":"door-m4 1.1.0","mode":"steady","auto":false,"close":1800,"open":1200,"settle":150,"cal":false,"sense":false}';
    expect(parseDoorLine(old)).toMatchObject({ t: "hello", pbv: 0, pbd: 0 });
    expect(parseDoorLine(old.replace("}", ',"pbv":"8","pbd":99}'))).toMatchObject({ pbv: 0, pbd: 0 });
  });

  it("drops a patch or pbcal line off the protocol", () => {
    const good = { t: "patch", seq: 1, pairs: "V1-D2", count: 1, complete: false, raw: [0, 445, 0], src: [0, 1, 0], stable: true };
    expect(parseDoorLine(JSON.stringify(good))).not.toBeNull();
    for (const bad of [
      { ...good, pairs: "V1-D2 ,V3-D4" },
      { ...good, pairs: "V0-D2" },
      { ...good, pairs: "D2-V1" },
      { ...good, pairs: "V1-D2;drop" },
      { ...good, raw: [0, 5000, 0] },
      { ...good, src: [0, 1] },
      { ...good, src: [0, 12, 0] },
      { ...good, raw: [] , src: [] },
      { ...good, complete: "yes" },
      { ...good, stable: undefined },
    ]) expect(parseDoorLine(JSON.stringify(bad))).toBeNull();
    const cal = { t: "pbcal", src: 0, raw: 0, levels: [445, 921], floor: 150, tol: 120, saved: true };
    expect(parseDoorLine(JSON.stringify(cal))).toEqual(cal);
    expect(parseDoorLine(JSON.stringify({ ...cal, src: 3 }))).toBeNull(); // a source the levels don't have
    expect(parseDoorLine(JSON.stringify({ ...cal, levels: [445, -1] }))).toBeNull();
    expect(parseDoorLine(JSON.stringify({ ...cal, floor: "150" }))).toBeNull();
  });

  it("reads the firmware's newer errors as errors", () => {
    expect(parseDoorLine('{"t":"err","error":"cal cancelled","cmd":"cal closed"}')).toEqual({ t: "err", error: "cal cancelled", cmd: "cal closed" });
  });

  it("drops noise, half lines and anything off the protocol", () => {
    for (const bad of ["", "booting…", '{"t":"door","seq":1', '{"t":"door","seq":1,"open":"no","level":1,"lit":1,"dark":0,"fault":null,"warn":null}', '{"t":"door","seq":1,"open":true,"level":9999,"lit":1,"dark":0,"fault":null,"warn":null}', '{"t":"door","seq":1,"open":true,"level":1,"lit":1,"dark":0,"fault":"Bad Code!","warn":null}', '{"t":"nope"}', "[1,2]", '{"t":"hello","fw":"x","mode":"weird","close":1,"open":0,"settle":150}']) {
      expect(parseDoorLine(bad)).toBeNull();
    }
  });

  it("splits a stream into whole lines across reads", () => {
    const s = new LineSplitter(64);
    expect(s.push('{"t":"pong",')).toEqual([]);
    expect(s.push('"up":1}\r\n{"t":"ok","cmd":"x"}\n\n{"t"')).toEqual(['{"t":"pong","up":1}', '{"t":"ok","cmd":"x"}']);
    expect(s.push("x".repeat(100))).toEqual([]); // a runaway line is dropped
    expect(s.push('\n{"t":"pong","up":2}\n')).toEqual(['{"t":"pong","up":2}']);
  });

  it("formats every command as the firmware reads it", () => {
    expect(formatCommand({ c: "ping" })).toBe("ping");
    expect(formatCommand({ c: "get" })).toBe("get");
    expect(formatCommand({ c: "cal", which: "closed" })).toBe("cal closed");
    expect(formatCommand({ c: "cal", which: "open" })).toBe("cal open");
    expect(formatCommand({ c: "set", key: "close", value: 1900.4 })).toBe("set close 1900");
    expect(formatCommand({ c: "set", key: "mode", value: "mod" })).toBe("set mode mod");
    expect(formatCommand({ c: "set", key: "settle", value: 150 })).toBe("set settle 150");
    expect(formatCommand({ c: "save" })).toBe("save");
    expect(formatCommand({ c: "reset" })).toBe("reset");
    expect(formatCommand({ c: "pb", op: "learn", source: 3 })).toBe("pb learn V3");
    expect(formatCommand({ c: "pb", op: "get" })).toBe("pb get");
    expect(formatCommand({ c: "pb", op: "save" })).toBe("pb save");
    expect(formatCommand({ c: "pb", op: "reset" })).toBe("pb reset");
    expect(formatCommand({ c: "pb", op: "floor", value: 150.2 })).toBe("pb floor 150");
    expect(formatCommand({ c: "pb", op: "tol", value: 90 })).toBe("pb tol 90");
  });

  it("keeps stored settings only when the firmware would take them", () => {
    expect(parseDoorSettings('{"close":1880,"open":1320,"mode":"auto","settle":150}')).toEqual({ close: 1880, open: 1320, mode: "auto", settle: 150 });
    expect(parseDoorSettings('{"close":1200,"open":1800}')).toBeNull();
    expect(parseDoorSettings('{"close":1880,"open":1320,"mode":"x","settle":5}')).toEqual({ close: 1880, open: 1320 });
    expect(parseDoorSettings(null)).toBeNull();
    expect(parseDoorSettings("{")).toBeNull();
  });

  it("re-sends the stored thresholds in an order that never crosses them", () => {
    const now = { close: 1800, open: 1200, mode: "steady" as const, auto: true, settle: 150 };
    expect(settingsCommands({ close: 1800, open: 1200 }, now)).toEqual([]);
    // Up: close first (open 2000 is not below today's close 1800).
    expect(settingsCommands({ close: 3000, open: 2000 }, now).map(formatCommand)).toEqual(["set close 3000", "set open 2000"]);
    // Down below today's open: open first.
    expect(settingsCommands({ close: 900, open: 400 }, now).map(formatCommand)).toEqual(["set open 400", "set close 900"]);
    expect(settingsCommands({ close: 1800, open: 1300, mode: "auto", settle: 200 }, now).map(formatCommand)).toEqual(["set open 1300", "set settle 200"]);
    // Never a `set mode`: the wiring is the firmware's (its LED_MODE build).
    expect(settingsCommands({ close: 1800, open: 1300, mode: "auto" }, now).map(formatCommand)).toEqual(["set open 1300"]);
    expect(settingsCommands({ close: 1800, open: 1200 }, null).map(formatCommand)).toEqual(["set close 1800", "set open 1200"]);
    // Unknown settings: ordered as if the board ran its defaults (1800 / 1200).
    expect(settingsCommands({ close: 1000, open: 600 }, null).map(formatCommand)).toEqual(["set open 600", "set close 1000"]);
    expect(settingsCommands({ close: 3000, open: 2000 }, null).map(formatCommand)).toEqual(["set close 3000", "set open 2000"]);
  });

  it("never re-sends a calibration taken in another mode (the LED rewired, the firmware rebuilt)", () => {
    // Today's rig: the LED on 5V, the shipped build runs steady (not auto).
    const steady = { close: 1800, open: 1200, mode: "steady" as const, auto: false, settle: 150 };
    // Moved to D2 and reflashed LED_PULSED: the board says mod.
    const pulsed = { ...steady, mode: "mod" as const };
    const calSteady = { close: 3600, open: 2900, mode: "steady" as const, settle: 150 };
    const calPulsed = { close: 2100, open: 900, mode: "mod" as const, settle: 200 };
    expect(boardMode(steady)).toBe("steady");
    expect(boardMode({ mode: "mod", auto: true })).toBe("auto");
    expect(settingsFit(calSteady, steady)).toBe(true);
    expect(settingsCommands(calSteady, steady).map(formatCommand)).toEqual(["set close 3600", "set open 2900"]);
    expect(settingsFit(calSteady, pulsed)).toBe(false);
    expect(settingsCommands(calSteady, pulsed)).toEqual([]); // a steady level is not a lit − dark level
    expect(settingsCommands(calPulsed, steady)).toEqual([]); // and never forces the board back to mod
    expect(settingsCommands(calPulsed, pulsed).map(formatCommand)).toEqual(["set close 2100", "set open 900", "set settle 200"]);
    // A calibration stores the mode the board read in: an auto board that
    // probed steady and the shipped steady build read the same levels.
    expect(settingsFit(calSteady, { mode: "steady", auto: true })).toBe(true);
    expect(settingsFit(calPulsed, { mode: "mod", auto: true })).toBe(true);
    expect(settingsFit(calSteady, { mode: "mod", auto: true })).toBe(false);
    // A wave 20 record says only auto: it fits an auto board, never a fixed build.
    expect(settingsFit({ close: 2000, open: 1000, mode: "auto" }, { mode: "mod", auto: true })).toBe(true);
    expect(settingsFit({ close: 2000, open: 1000, mode: "auto" }, steady)).toBe(false);
    // Older stored settings with no mode, or a board not heard yet: sent as before.
    expect(settingsFit({ close: 2000, open: 1000 }, pulsed)).toBe(true);
    expect(settingsFit(calSteady, null)).toBe(true);
  });
});

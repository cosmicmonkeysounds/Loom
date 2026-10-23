import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LineSplitter, formatCommand, parseDoorLine, parseDoorSettings, settingsCommands } from "../src/serial/door-protocol.ts";

const OURS = fileURLToPath(new URL("./fixtures/door-lines.jsonl", import.meta.url));
const FIRMWARE = fileURLToPath(new URL("../../hardware/server-room-door/test/fixtures/lines.jsonl", import.meta.url));
const lines = readFileSync(OURS, "utf8").split("\n").filter((l) => l.trim() !== "");

describe("the door sensor's protocol (§2.9)", () => {
  it("keeps its fixture byte-equal to the firmware's", () => {
    expect(readFileSync(OURS, "utf8")).toBe(readFileSync(FIRMWARE, "utf8"));
  });

  it("parses every example line of the firmware", () => {
    const parsed = lines.map(parseDoorLine);
    expect(parsed.every((p) => p !== null)).toBe(true);
    expect(parsed.map((p) => p?.t)).toEqual(["hello", "door", "door", "door", "door", "pong", "cfg", "cal", "ok", "err"]);
    expect(parsed[0]).toEqual({ t: "hello", fw: "door-m4 1.0.0", mode: "steady", auto: true, close: 1800, open: 1200, settle: 150, cal: false, sense: false });
    expect(parsed[1]).toEqual({ t: "door", seq: 17, open: false, level: 2410, lit: 3020, dark: 610, fault: null, warn: null });
    expect(parsed[3]).toMatchObject({ open: true, fault: null, warn: "ldr_open" });
    expect(parsed[4]).toMatchObject({ open: true, fault: "ldr_saturated", warn: null });
    expect(parsed[5]).toEqual({ t: "pong", up: 123456 });
    expect(parsed[6]).toMatchObject({ t: "cfg", mode: "mod", auto: false, cal: true, saved: true });
    expect(parsed[7]).toEqual({ t: "cal", which: "closed", ref: 2400, close: 1880, open: 1320 });
    expect(parsed[8]).toEqual({ t: "ok", cmd: "set close 1900" });
    expect(parsed[9]).toEqual({ t: "err", error: "cal span too small", cmd: "cal open" });
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
    expect(settingsCommands({ close: 1800, open: 1200, mode: "mod" }, now).map(formatCommand)).toEqual(["set mode mod"]);
    expect(settingsCommands({ close: 1800, open: 1200 }, null).map(formatCommand)).toEqual(["set close 1800", "set open 1200"]);
  });
});

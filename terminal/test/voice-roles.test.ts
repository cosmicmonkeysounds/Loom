import { describe, expect, it } from "vitest";
import { validateHouse, type HouseMap } from "@loom/house";
import showHouse from "../../core/examples/trapped-in-the-internet/house.json";
import { VIEWS, defaultConfig, type TerminalConfig } from "../src/config.ts";
import { NO_VOICE, micBox, micDefault, micReport, voiceRoles } from "../src/voice/roles.ts";

const show = validateHouse(showHouse).house!;
const cfg = (over: Partial<TerminalConfig> = {}): TerminalConfig => defaultConfig({ eventId: "e", token: "t", spot: "hall", ...over });

describe("voiceRoles (D9)", () => {
  it("a placed wall terminal hears and is heard, on every view but the TV and the mirror", () => {
    for (const view of VIEWS) {
      const r = voiceRoles(cfg({ view }));
      if (view === "mirror") expect(r).toEqual(NO_VOICE);
      else if (view === "tv") expect(r).toEqual({ mic: false, voices: true });
      else expect(r).toEqual({ mic: true, voices: true });
      expect(micDefault(view)).toBe(view !== "tv" && view !== "mirror");
    }
  });
  it("⚙ turns either half off, and only the TV's microphone on", () => {
    expect(voiceRoles(cfg({ mic: false }))).toEqual({ mic: false, voices: true });
    expect(voiceRoles(cfg({ voices: false }))).toEqual({ mic: true, voices: false });
    expect(voiceRoles(cfg({ view: "tv", mic: true }))).toEqual({ mic: true, voices: true });
    expect(voiceRoles(cfg({ view: "mirror", mic: true, voices: true }))).toEqual(NO_VOICE);
  });
  it("nothing unplaced, nothing where the map turns the link off", () => {
    expect(voiceRoles(cfg({ spot: " " }))).toEqual(NO_VOICE);
    expect(voiceRoles(cfg({ voiceLink: false }))).toEqual(NO_VOICE);
    expect(voiceRoles(cfg({ spot: "tent" }), show)).toEqual(NO_VOICE);
    // The map wins over the stored flag both ways; a spot it lacks is off.
    expect(voiceRoles(cfg({ spot: "hall", voiceLink: false }), show)).toEqual({ mic: true, voices: true });
    expect(voiceRoles(cfg({ spot: "nowhere" }), show)).toEqual(NO_VOICE);
    const tentOn: HouseMap = { ...show, terminals: show.terminals.map((t) => (t.id === "tent" ? { ...t, voice: true } : t)) };
    expect(voiceRoles(cfg({ spot: "tent" }), tentOn).mic).toBe(true);
  });
});

describe("micReport (the heartbeat's mic=)", () => {
  it("off when it takes no part, muted when ⚙ turned it off", () => {
    expect(micReport(cfg({ view: "mirror" }), null, "live")).toBe("off");
    expect(micReport(cfg({ view: "tv" }), null, null)).toBe("off");
    expect(micReport(cfg({ spot: "tent" }), show, null)).toBe("off");
    expect(micReport(cfg({ mic: false }), null, null)).toBe("muted");
    expect(micReport(cfg({ view: "tv", mic: false }), null, null)).toBe("muted");
  });
  it("else the microphone's own state", () => {
    expect(micReport(cfg(), null, "live")).toBe("live");
    expect(micReport(cfg(), null, "denied")).toBe("denied");
    expect(micReport(cfg(), null, "insecure")).toBe("insecure");
    expect(micReport(cfg(), null, "starting")).toBeNull();
    expect(micReport(cfg(), null, null)).toBeNull();
  });
});

describe("⚙'s microphone box (T1)", () => {
  it("untouched it follows the screen picked (indeterminate); ticked or not it is the choice", () => {
    expect(micBox(undefined, "auto")).toEqual({ checked: true, follows: true });
    expect(micBox(undefined, "tv")).toEqual({ checked: false, follows: true });
    expect(micBox(false, "auto")).toEqual({ checked: false, follows: false });
    expect(micBox(true, "tv")).toEqual({ checked: true, follows: false });
  });
  it("a locked page's open microphone reports `locked`", () => {
    expect(micReport(cfg(), show, "locked")).toBe("locked");
    expect(micReport(cfg({ view: "mirror" }), show, "locked")).toBe("off");
  });
});

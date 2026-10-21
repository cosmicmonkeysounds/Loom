//! The voice link's mount (T6): what of the map it depends on, and what it
//! does before a map has been read.

import { describe, expect, it } from "vitest";
import { validateHouse } from "@loom/house";
import showHouse from "../../core/examples/trapped-in-the-internet/house.json";
import { defaultConfig } from "../src/config.ts";
import { NO_VOICE } from "../src/voice/roles.ts";
import { mapVoiceKey, rolesWithoutMap } from "../src/voice/hook.ts";

const show = validateHouse(showHouse).house!;

describe("useVoiceLink's map", () => {
  it("keys a map by the spot's voice link only (a re-read with the same answer changes nothing)", () => {
    expect(mapVoiceKey(show, "hall")).toBe("on");
    expect(mapVoiceKey(show, "tent")).toBe("off");
    expect(mapVoiceKey(show, "the-moon")).toBe("absent");
    expect(mapVoiceKey(null, "hall")).toBe("unread");
    const moved = { ...show, terminals: show.terminals.map((t) => (t.id === "hall" ? { ...t, voice: false } : t)) };
    expect(mapVoiceKey(moved, "hall")).toBe("off");
    expect(mapVoiceKey({ ...show, terminals: show.terminals.map((t) => ({ ...t, name: `${t.name}!` })) }, "hall")).toBe(mapVoiceKey(show, "hall"));
  });
  it("before a map is read, a config no map ever set takes no part; one a map set follows its flag", () => {
    const old = defaultConfig({ eventId: "e", token: "t", spot: "tent" });
    delete (old as { voiceLink?: boolean }).voiceLink;
    expect(rolesWithoutMap(old)).toEqual(NO_VOICE);
    expect(rolesWithoutMap({ ...old, voiceLink: false })).toEqual(NO_VOICE);
    expect(rolesWithoutMap({ ...old, spot: "hall", voiceLink: true })).toEqual({ mic: true, voices: true });
  });
});

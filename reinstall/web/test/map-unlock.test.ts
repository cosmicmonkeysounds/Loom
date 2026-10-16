import { describe, expect, it } from "vitest";
import { ApiError } from "@loom/play/client.ts";
import { checkModCode, editorTakesKey, MapUnlock, type ResolveCode } from "../src/map/unlock.ts";

const resolver = (reply: { eventId?: string; role?: string } | Error): ResolveCode & { calls: string[] } => {
  const calls: string[] = [];
  const f = (async (code: string) => {
    calls.push(code);
    if (reply instanceof Error) throw reply;
    return reply;
  }) as ResolveCode & { calls: string[] };
  f.calls = calls;
  return f;
};

describe("checkModCode — the map page's passcode re-check (W-15)", () => {
  it("accepts this event's moderator passcode (trimmed)", async () => {
    const r = resolver({ eventId: "evt", role: "mod" });
    expect(await checkModCode("  MOD-1 ", "evt", r)).toBeNull();
    expect(r.calls).toEqual(["MOD-1"]);
  });

  it("refuses a guest / performer code, another event's code, an unknown code, and an empty one", async () => {
    expect(await checkModCode("G", "evt", resolver({ eventId: "evt", role: "guest" }))).toMatch(/isn't the moderator passcode/);
    expect(await checkModCode("P", "evt", resolver({ eventId: "evt", role: "prime" }))).toMatch(/isn't the moderator passcode/);
    expect(await checkModCode("M", "evt", resolver({ eventId: "other", role: "mod" }))).toMatch(/another event/);
    expect(await checkModCode("X", "evt", resolver(new ApiError("unknown code", 404)))).toMatch(/isn't the moderator passcode/);
    expect(await checkModCode("X", "evt", resolver(new ApiError("slow down", 429)))).toMatch(/Too many tries/);
    expect(await checkModCode("X", "evt", resolver(new TypeError("Failed to fetch")))).toMatch(/Couldn't check the passcode \(Failed to fetch\)/);
    const r = resolver({ eventId: "evt", role: "mod" });
    expect(await checkModCode("   ", "evt", r)).toMatch(/Type the moderator passcode/);
    expect(r.calls).toEqual([]);
  });
});

describe("MapUnlock — no write before the passcode checks out", () => {
  const verifier = (good: string) => async (code: string) => (code === good ? null : "That isn't the moderator passcode.");

  it("a cancelled ask refuses the write and stays locked", async () => {
    const lock = new MapUnlock(verifier("MOD"));
    expect(await lock.ensure(async () => null)).toBe(false);
    expect(lock.open).toBe(false);
  });

  it("a wrong code asks again with the error; the right one unlocks for the rest of the page load", async () => {
    const lock = new MapUnlock(verifier("MOD"));
    const seen: Array<string | null> = [];
    const answers = ["nope", "MOD"];
    expect(await lock.ensure(async (error) => (seen.push(error), answers.shift() ?? null))).toBe(true);
    expect(seen).toEqual([null, "That isn't the moderator passcode."]);
    expect(lock.open).toBe(true);
    let asked = 0;
    expect(await lock.ensure(async () => (asked++, null))).toBe(true);
    expect(asked).toBe(0);
  });

  it("a wrong code then cancel refuses", async () => {
    const lock = new MapUnlock(verifier("MOD"));
    const answers = ["nope", null];
    expect(await lock.ensure(async () => answers.shift() ?? null)).toBe(false);
    expect(lock.open).toBe(false);
  });

  it("two writes at once share one ask", async () => {
    const lock = new MapUnlock(verifier("MOD"));
    let asked = 0;
    let release: (code: string | null) => void = () => {};
    const ask = () => (asked++, new Promise<string | null>((r) => (release = r)));
    const a = lock.ensure(ask);
    const b = lock.ensure(ask);
    await Promise.resolve();
    release("MOD");
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(asked).toBe(1);
  });
});

describe("editorTakesKey — the passcode dialog owns the keyboard", () => {
  it("a key on the page while the dialog is up never reaches the editor (a Backspace deletes nothing)", () => {
    // After a wrong code the disabled input lost focus: the key lands on <body>.
    expect(editorTakesKey({ typing: false, editing: true, asking: true })).toBe(false);
    expect(editorTakesKey({ typing: false, editing: true, asking: false })).toBe(true);
    expect(editorTakesKey({ typing: true, editing: true, asking: false })).toBe(false);
    expect(editorTakesKey({ typing: false, editing: false, asking: false })).toBe(false);
  });
});

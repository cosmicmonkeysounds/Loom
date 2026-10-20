import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { EventRegistry } from "../server/registry.ts";
import { Store } from "../server/store.ts";
import type { Passcodes } from "../server/auth.ts";

const dirs: string[] = [];
function freshStore(): Store {
  const d = mkdtempSync(join(tmpdir(), "loom-reg-"));
  dirs.push(d);
  return new Store(d);
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function runtime(eventId: string, codes: Passcodes, source = ""): EventRuntime {
  return new EventRuntime({
    eventId,
    store: freshStore(),
    codes,
    scenarioName: "demo",
    scenarioSource: source,
    joinBase: () => "http://localhost",
  });
}

describe("EventRegistry — code resolution", () => {
  const reg = new EventRegistry(tmpdir(), () => "http://localhost");
  reg.register(runtime("evt-a", { event: "AAAA11", prime: "AAAA22", mod: "AAAA33" }));
  reg.register(runtime("evt-b", { event: "BBBB11", prime: "BBBB22", mod: "BBBB33" }, "# Trapped in the Internet\n\n== start\n"));

  it("maps an event code to that event as a guest", () => {
    expect(reg.resolveCode("AAAA11")).toEqual({ eventId: "evt-a", role: "guest", title: "demo", theme: "plain" });
    expect(reg.resolveCode("BBBB11")).toEqual({ eventId: "evt-b", role: "guest", title: "Trapped in the Internet", theme: "plain" });
  });

  it("maps prime / mod codes to the performer / moderator roles", () => {
    expect(reg.resolveCode("AAAA22")).toEqual({ eventId: "evt-a", role: "prime", title: "demo", theme: "plain", characters: [] });
    expect(reg.resolveCode("BBBB33")).toEqual({ eventId: "evt-b", role: "mod", title: "Trapped in the Internet", theme: "plain", characters: [] });
  });

  it("lists the story's characters on a performer code, before the doors and after (recheck item 6)", () => {
    const d = mkdtempSync(join(tmpdir(), "loom-reg-"));
    dirs.push(d);
    const local = new EventRegistry(d, () => "http://localhost");
    const rt = local.register(
      runtime("evt-c", { event: "CCCC11", prime: "CCCC22", mod: "CCCC33" }, "# Cast\nstart: Go\n\nCHARACTER Clippy\nCHARACTER Alexa\n\n== Go\nHi.\n"),
    );
    expect(local.resolveCode("CCCC22")!.characters).toEqual(["Clippy", "Alexa"]);
    rt.openDoors();
    expect(local.resolveCode("CCCC22")!.characters).toEqual(["Clippy", "Alexa"]);
    expect(local.resolveCode("CCCC11")!.characters).toBeUndefined(); // guests get no cast list
  });

  it("lists the declared cast on a mod code before the doors (a terminal checks its character), and on a performer code (a booth signs in before them)", () => {
    const d = mkdtempSync(join(tmpdir(), "loom-reg-"));
    dirs.push(d);
    const local = new EventRegistry(d, () => "http://localhost");
    const rt = local.register(
      runtime("evt-d", { event: "DDDD11", prime: "DDDD22", mod: "DDDD33" }, "# Cast\nstart: Go\n\nCHARACTER Clippy\nCHARACTER Alexa\n\n== Go\nHi.\n"),
    );
    expect(local.resolveCode("DDDD33")!.characters).toEqual(["Clippy", "Alexa"]);
    expect(local.resolveCode("DDDD22")!.characters).toEqual(["Clippy", "Alexa"]);
    expect(rt.declaredCharacters).toEqual(["Clippy", "Alexa"]); // memoised, same answer again
    rt.openDoors();
    expect(local.resolveCode("DDDD33")!.characters).toEqual(["Clippy", "Alexa"]);
    expect(local.resolveCode("DDDD22")!.characters).toEqual(["Clippy", "Alexa"]);
  });

  it("is trimmed + case-insensitive (matching passOk)", () => {
    expect(reg.resolveCode("  aaaa11 ")).toEqual({ eventId: "evt-a", role: "guest", title: "demo", theme: "plain" });
  });

  it("returns null for an unknown or empty code", () => {
    expect(reg.resolveCode("ZZZZ99")).toBeNull();
    expect(reg.resolveCode("")).toBeNull();
    expect(reg.resolveCode("   ")).toBeNull();
  });

  it("get / has / all reflect what's registered; stop removes", () => {
    expect(reg.has("evt-a")).toBe(true);
    expect(reg.get("evt-a")?.eventId).toBe("evt-a");
    expect(reg.all().map((r) => r.eventId).sort()).toEqual(["evt-a", "evt-b"]);
    reg.stop("evt-b");
    expect(reg.has("evt-b")).toBe(false);
    expect(reg.resolveCode("BBBB11")).toBeNull();
  });
});

describe("EventRegistry — the bare landing's branding", () => {
  const story = (title: string) => `# ${title}\ntheme: aol97\nstart: Go\n\n== Go\nHi.\n`;
  const spec = (eventId: string, n: number, title: string, mode?: "live" | "preview") => ({
    eventId,
    codes: { event: `LAND${n}1`, prime: `LAND${n}2`, mod: `LAND${n}3` },
    scenarioName: "demo",
    scenarioSource: story(title),
    ...(mode !== undefined ? { mode } : {}),
  });

  it("names the one open live event; none or several open → no branding", () => {
    const d = mkdtempSync(join(tmpdir(), "loom-reg-"));
    dirs.push(d);
    const reg = new EventRegistry(d, () => "http://localhost");
    expect(reg.landing()).toBeNull();
    const show = reg.ensure(spec("evt-show", 1, "Trapped in the Internet", "live"));
    expect(reg.landing()).toBeNull(); // hosted, doors still closed
    show.openDoors();
    expect(reg.landing()).toEqual({ title: "Trapped in the Internet", theme: "aol97" });
    reg.ensure(spec("evt-other", 2, "Another Party", "live")).openDoors();
    expect(reg.landing()).toBeNull(); // two shows open: guess neither
  });

  it("never advertises a private preview — until it goes live in place", () => {
    const d = mkdtempSync(join(tmpdir(), "loom-reg-"));
    dirs.push(d);
    const reg = new EventRegistry(d, () => "http://localhost");
    reg.ensure(spec("evt-rehearsal", 3, "Secret Rehearsal", "preview")).openDoors();
    expect(reg.landing()).toBeNull();
    // A live show opening beside it is the one open live event.
    const show = reg.ensure(spec("evt-show", 4, "Trapped in the Internet", "live"));
    show.openDoors();
    expect(reg.landing()).toEqual({ title: "Trapped in the Internet", theme: "aol97" });
    reg.stop("evt-show");
    // Go live promotes the same event (same id): now it counts.
    reg.ensure(spec("evt-rehearsal", 3, "Secret Rehearsal", "live"));
    expect(reg.landing()).toEqual({ title: "Secret Rehearsal", theme: "aol97" });
  });
});

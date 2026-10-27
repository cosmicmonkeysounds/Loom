//! A room terminal tells the story when a line opens and closes there (wave 7:
//! the server-room terminal → `terminal opened` / `terminal closed`).

import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.ts";
import { LOCKED_PASS_NOTICE, VISIT_KEY, VisitLatch, beginPilot, closeVisit, endPilot, answersBeforeVisit, floorAfter, openVisit, visitLinesOf, parseStoredVisit, passLocked, postVisit, recoverVisit, refusesLockedPass, visitSignalBody, type VisitStorage } from "../src/pilot.ts";

const room = defaultConfig({ eventId: "evt 1", token: "mod-tok", name: "Server Room", spot: "server-room", view: "face", room: "The Server Room" });

function fakeFetch(status: number | Error, seen: Array<{ url: string; init: RequestInit }>): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    if (status instanceof Error) throw status;
    return { status, ok: status >= 200 && status < 300, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
}

/** A `localStorage` stand-in (the page's own survives a reload). */
function memStorage(): VisitStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** A storage that throws on every call (blocked site data). */
const brokenStorage: VisitStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const names = (seen: Array<{ init: RequestInit }>) => seen.map((x) => JSON.parse(String(x.init.body)) as { name: string; subject: string; args: { at: string } });

describe("visit signals", () => {
  it("the body: the guest as subject, the room as `at`, the terminal's label", () => {
    expect(visitSignalBody(room, "terminal opened", "g7")).toEqual({ name: "terminal opened", subject: "g7", args: { at: "The Server Room" }, label: "Terminal · Server Room" });
    expect(visitSignalBody(room, "terminal closed", "g7")?.name).toBe("terminal closed");
    // Only a room terminal tells the story; never for no guest.
    expect(visitSignalBody({ ...room, room: "" }, "terminal opened", "g7")).toBeNull();
    expect(visitSignalBody({ ...room, view: "tv" }, "terminal opened", "g7")).toBeNull();
    expect(visitSignalBody(room, "terminal opened", "")).toBeNull();
    expect(visitSignalBody({ ...room, name: "x".repeat(80) }, "terminal opened", "g7")!.label.length).toBe(60);
  });

  it("posts to the event's mod signal with the terminal's token; keepalive on pagehide; never throws", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    expect(await postVisit(room, "terminal opened", "g7", { fetchFn: fakeFetch(200, seen) })).toBe(true);
    expect(seen[0]!.url).toBe("/e/evt%201/api/mod/signal");
    expect(seen[0]!.init.method).toBe("POST");
    expect((seen[0]!.init.headers as Record<string, string>)["x-loom-token"]).toBe("mod-tok");
    expect(JSON.parse(String(seen[0]!.init.body))).toMatchObject({ name: "terminal opened", subject: "g7", args: { at: "The Server Room" } });
    expect(seen[0]!.init.keepalive).toBe(false);
    expect(await postVisit(room, "terminal closed", "g7", { keepalive: true, fetchFn: fakeFetch(200, seen) })).toBe(true);
    expect(seen[1]!.init.keepalive).toBe(true);
    expect(await postVisit(room, "terminal closed", "g7", { fetchFn: fakeFetch(409, seen) })).toBe(false);
    expect(await postVisit(room, "terminal closed", "g7", { fetchFn: fakeFetch(new Error("offline"), seen) })).toBe(false);
    // A plain terminal sends nothing at all.
    const before = seen.length;
    expect(await postVisit({ ...room, room: "" }, "terminal opened", "g7", { fetchFn: fakeFetch(200, seen) })).toBe(false);
    expect(seen.length).toBe(before);
  });

  it("closes each visit exactly once, however the line ends", () => {
    const latch = new VisitLatch();
    expect(latch.close()).toBeNull();
    latch.begin("g7");
    expect(latch.close()?.guestId).toBe("g7");
    expect(latch.close()).toBeNull(); // the pagehide after the leash: nothing more
  });

  it("never sends `terminal closed` ahead of its `terminal opened` (a DISCONNECT right after the scan)", async () => {
    const order: string[] = [];
    let land: () => void = () => {};
    const slowOpen = new Promise<void>((r) => (land = r));
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const name = (JSON.parse(String(init.body)) as { name: string }).name;
      if (name === "terminal opened") await slowOpen;
      order.push(name);
      return { status: 200, ok: true, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
    const latch = new VisitLatch();
    openVisit(room, latch, "g7", { fetchFn });
    const closing = closeVisit(room, latch, { fetchFn });
    expect(closing).not.toBeNull();
    expect(closeVisit(room, latch, { fetchFn })).toBeNull(); // once
    await Promise.resolve();
    expect(order).toEqual([]); // the close waits for the open to land
    land();
    expect(await closing).toBe(true);
    expect(order).toEqual(["terminal opened", "terminal closed"]);
  });

  it("the pagehide close goes at once (keepalive); a house terminal opens no visit", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const latch = new VisitLatch();
    latch.begin("g7", new Promise(() => {})); // an open that never lands
    expect(await closeVisit(room, latch, { keepalive: true, fetchFn: fakeFetch(200, seen) })).toBe(true);
    expect(seen.map((x) => [JSON.parse(String(x.init.body)).name, x.init.keepalive])).toEqual([["terminal closed", true]]);
    openVisit({ ...room, room: "" }, latch, "g7", { fetchFn: fakeFetch(200, seen) });
    expect(latch.close()).toBeNull();
    expect(seen.length).toBe(1);
  });

  it("ending a pilot can outlive the page (keepalive) and swallows a failure", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    await endPilot(room, { token: "imp", id: "g7", name: "Ada" }, { keepalive: true, fetchFn: fakeFetch(200, seen) });
    expect(seen[0]!.url).toBe("/e/evt%201/api/mod/impersonate/end");
    // The pagehide end alone is resumable (a reload re-scans onto the same floor).
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ session: "imp", resumable: true });
    expect(seen[0]!.init.keepalive).toBe(true);
    // A leash end (thrown, timed out, done, left) is a real end.
    await endPilot(room, { token: "imp", id: "g7", name: "Ada" }, { fetchFn: fakeFetch(200, seen) });
    expect(JSON.parse(String(seen[1]!.init.body))).toEqual({ session: "imp" });
    expect(seen[1]!.init.keepalive).toBe(false);
    await expect(endPilot(room, { token: "imp", id: "g7", name: "Ada" }, { fetchFn: fakeFetch(new Error("gone"), seen) })).resolves.toBeUndefined();
  });

  it("a visit left behind by a crash or a reload is closed on the next boot, before any line opens", async () => {
    const storage = memStorage();
    const seen: Array<{ url: string; init: RequestInit }> = [];
    // The page that crashed: the open is stored, its close never happened.
    const before = new VisitLatch(storage);
    openVisit(room, before, "g7", { fetchFn: fakeFetch(200, seen) });
    expect(parseStoredVisit(storage.map.get(VISIT_KEY) ?? null)).toEqual({ eventId: "evt 1", guestId: "g7", room: "The Server Room" });
    await before.close()!.opened;
    // The next boot: owes `terminal closed` for g7, in the room it opened in
    // (even if the terminal was set up for another room since).
    const after = new VisitLatch(storage);
    const order: string[] = [];
    let land: () => void = () => {};
    const slowClose = new Promise<void>((r) => (land = r));
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body)) as { name: string; subject: string; args: { at: string } };
      if (b.name === "terminal closed") await slowClose;
      order.push(`${b.name} ${b.subject} @${b.args.at}`);
      return { status: 200, ok: true, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
    const moved = { ...room, room: "The CPU" };
    const closing = recoverVisit(moved, after, { fetchFn });
    expect(closing).not.toBeNull();
    expect(storage.map.has(VISIT_KEY)).toBe(false); // owed once
    expect(recoverVisit(moved, after, { fetchFn })).toBeNull(); // once per page
    // A pass scanned at once: its open waits for the old close.
    openVisit(moved, after, "g9", { fetchFn });
    await Promise.resolve();
    expect(order).toEqual([]);
    land();
    expect(await closing).toBe(true);
    await after.close()!.opened;
    expect(order).toEqual(["terminal closed g7 @The Server Room", "terminal opened g9 @The CPU"]);
  });

  it("closing the visit forgets it; a clean boot owes nothing", async () => {
    const storage = memStorage();
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const latch = new VisitLatch(storage);
    openVisit(room, latch, "g7", { fetchFn: fakeFetch(200, seen) });
    expect(storage.map.has(VISIT_KEY)).toBe(true);
    await closeVisit(room, latch, { fetchFn: fakeFetch(200, seen) });
    expect(storage.map.has(VISIT_KEY)).toBe(false);
    // The pagehide close forgets it too (the reload then owes nothing).
    openVisit(room, latch, "g8", { fetchFn: fakeFetch(200, seen) });
    await closeVisit(room, latch, { keepalive: true, fetchFn: fakeFetch(200, seen) });
    expect(storage.map.has(VISIT_KEY)).toBe(false);
    const n = seen.length;
    expect(recoverVisit(room, new VisitLatch(storage), { fetchFn: fakeFetch(200, seen) })).toBeNull();
    expect(seen.length).toBe(n);
    expect(names(seen).map((b) => `${b.name} ${b.subject}`)).toEqual(["terminal opened g7", "terminal closed g7", "terminal opened g8", "terminal closed g8"]);
  });

  it("a close that never landed stays owed: it goes again before the next line opens, and on the next boot", async () => {
    const storage = memStorage();
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const latch = new VisitLatch(storage);
    recoverVisit(room, latch, { fetchFn: fakeFetch(200, seen) }); // the boot: nothing owed
    openVisit(room, latch, "g7", { fetchFn: fakeFetch(200, seen) });
    // A Wi-Fi blip eats the close: the visit is still on record.
    expect(await closeVisit(room, latch, { fetchFn: fakeFetch(new Error("offline"), seen) })).toBe(false);
    expect(parseStoredVisit(storage.map.get(VISIT_KEY) ?? null)?.guestId).toBe("g7");
    // The next pass on this page: g7's close goes first, then g9's open.
    openVisit(room, latch, "g9", { fetchFn: fakeFetch(200, seen) });
    await latch.ready;
    await latch.close()!.opened;
    expect(names(seen).map((b) => `${b.name} ${b.subject}`)).toEqual(["terminal opened g7", "terminal closed g7", "terminal closed g7", "terminal opened g9"]);
    // A pagehide close the page never hears back from: the next boot sends it again.
    const s2 = memStorage();
    const crashed = new VisitLatch(s2);
    openVisit(room, crashed, "g4", { fetchFn: fakeFetch(200, []) });
    await closeVisit(room, crashed, { keepalive: true, fetchFn: fakeFetch(503, []) });
    const again: Array<{ url: string; init: RequestInit }> = [];
    expect(await recoverVisit(room, new VisitLatch(s2), { fetchFn: fakeFetch(200, again) })).toBe(true);
    expect(names(again).map((b) => `${b.name} ${b.subject}`)).toEqual(["terminal closed g4"]);
    expect(s2.map.has(VISIT_KEY)).toBe(false);
  });

  it("a slow close never forgets the newer visit that replaced it", async () => {
    const storage = memStorage();
    const latch = new VisitLatch(storage);
    recoverVisit(room, latch, { fetchFn: fakeFetch(200, []) });
    openVisit(room, latch, "g7", { fetchFn: fakeFetch(200, []) });
    let land: (ok: boolean) => void = () => {};
    const slow = (async () => {
      const ok = await new Promise<boolean>((r) => (land = r));
      return { status: ok ? 200 : 503, ok, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
    const closing = closeVisit(room, latch, { keepalive: true, fetchFn: slow })!;
    openVisit(room, latch, "g9", { fetchFn: fakeFetch(200, []) });
    land(true);
    await closing;
    expect(parseStoredVisit(storage.map.get(VISIT_KEY) ?? null)?.guestId).toBe("g9");
  });

  it("a visit from another event is dropped, not closed here; junk is ignored", () => {
    const storage = memStorage();
    const seen: Array<{ url: string; init: RequestInit }> = [];
    storage.setItem(VISIT_KEY, JSON.stringify({ eventId: "old", guestId: "g7", room: "The Server Room" }));
    expect(recoverVisit(room, new VisitLatch(storage), { fetchFn: fakeFetch(200, seen) })).toBeNull();
    expect(storage.map.has(VISIT_KEY)).toBe(false);
    storage.setItem(VISIT_KEY, "{not json");
    expect(recoverVisit(room, new VisitLatch(storage), { fetchFn: fakeFetch(200, seen) })).toBeNull();
    expect(seen).toEqual([]);
    expect(parseStoredVisit(JSON.stringify({ eventId: "e", guestId: "", room: "x" }))).toBeNull();
    expect(parseStoredVisit(JSON.stringify({ eventId: "e", guestId: "g", room: " " }))).toBeNull();
  });

  it("works with no storage, or one that throws", async () => {
    for (const storage of [null, brokenStorage]) {
      const seen: Array<{ url: string; init: RequestInit }> = [];
      const latch = new VisitLatch(storage);
      expect(recoverVisit(room, latch, { fetchFn: fakeFetch(200, seen) })).toBeNull();
      openVisit(room, latch, "g7", { fetchFn: fakeFetch(200, seen) });
      expect(await closeVisit(room, latch, { fetchFn: fakeFetch(200, seen) })).toBe(true);
      expect(names(seen).map((b) => b.name)).toEqual(["terminal opened", "terminal closed"]);
    }
  });
});

describe("the visit floor (wave 27, B1)", () => {
  it("is set by the first history after the pilot changed, never moved by a reconnect", () => {
    let f = floorAfter(null, [{ seq: 3 }, { seq: 9 }, { seq: 5 }]);
    expect(f).toBe(9);
    f = floorAfter(f, [{ seq: 3 }, { seq: 9 }, { seq: 14 }]); // a Wi-Fi blip re-sends the history
    expect(f).toBe(9);
    expect(floorAfter(null, [])).toBe(-1);
  });

  it("pins at -1 when the talk opened before any history came; a pin never moves a set floor", () => {
    expect(floorAfter(null, "pin")).toBe(-1);
    expect(floorAfter(7, "pin")).toBe(7);
    expect(floorAfter(floorAfter(null, "pin"), [{ seq: 30 }])).toBe(-1);
  });

  it("wave 28: a pin floors at the scan's seq, so a late history still shows only this visit", async () => {
    // Slow venue wifi: no history in 2.5 s, the talk opens, the history lands later.
    const pinned = floorAfter(null, "pin", 41);
    expect(pinned).toBe(41);
    expect(floorAfter(pinned, [{ seq: 3 }, { seq: 41 }, { seq: 42 }, { seq: 43 }])).toBe(41);
    const late = [{ seq: 3 }, { seq: 20 }, { seq: 41 }, { seq: 42 }, { seq: 43 }];
    expect(visitLinesOf(late, pinned).map((l) => l.seq)).toEqual([42, 43]);
    // beginPilot keeps the server's seq (an older server sends none: -1 as before).
    const fetchFn = (async () => new Response(JSON.stringify({ token: "t", id: "g1", name: "Winamp", seq: 41 }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    const real = globalThis.fetch;
    globalThis.fetch = fetchFn;
    try {
      const p = await beginPilot({ eventId: "e", token: "m", name: "Server Room" } as unknown as Parameters<typeof beginPilot>[0], "g1");
      expect(p).toEqual({ token: "t", id: "g1", name: "Winamp", seq: 41 });
    } finally {
      globalThis.fetch = real;
    }
  });

  it("wave 28: his late answer to a phone DM from before the visit stays off the heart's thread; an answer to this visit's line shows", () => {
    // Phone DMs at 10..12, the scan at 20 (floor). The hold line answering
    // DM 12 lands at 25 (after the floor), his reply to it at 31; the
    // visit's own line 27 gets its answer at 30. A scripted line (no link) shows.
    const thread = [{ seq: 10 }, { seq: 11 }, { seq: 12 }, { seq: 21 }, { seq: 25, answers: 12 }, { seq: 27 }, { seq: 30, answers: 27 }, { seq: 31, answers: 12 }];
    expect(visitLinesOf(thread, 20).map((l) => l.seq)).toEqual([21, 27, 30]);
    expect(answersBeforeVisit({ answers: 12 }, 20)).toBe(true);
    expect(answersBeforeVisit({ answers: 20 }, 20)).toBe(true); // the floor itself is before the visit
    expect(answersBeforeVisit({ answers: 21 }, 20)).toBe(false);
    expect(answersBeforeVisit({}, 20)).toBe(false);
    // No floor yet (no history): every line, as before.
    expect(answersBeforeVisit({ answers: 12 }, null)).toBe(false);
    expect(visitLinesOf(thread, null)).toHaveLength(thread.length);
    // An older server sends no link: nothing is hidden by it.
    expect(visitLinesOf([{ seq: 25 }, { seq: 31 }], 20).map((l) => l.seq)).toEqual([25, 31]);
  });

  it("gap 2b: a reload mid-visit floors at the server's visitSeq, so his earlier lines from this visit stay and nothing older", async () => {
    // First page: scanned at seq 40, history newest 40. His lines and a pick follow.
    const thread = [{ seq: 12 }, { seq: 40 }, { seq: 41 }, { seq: 42 }, { seq: 43 }, { seq: 44 }];
    // The reload: the re-scan's history's newest is 44, but the server carries the visit at 40.
    const reloaded = floorAfter(null, thread, undefined, 40);
    expect(reloaded).toBe(40);
    expect(visitLinesOf(thread, reloaded).map((l) => l.seq)).toEqual([41, 42, 43, 44]);
    // The same when the history comes late (a pin) and a later history never moves it.
    const pinned = floorAfter(null, "pin", 44, 40);
    expect(pinned).toBe(40);
    expect(floorAfter(pinned, thread)).toBe(40);
    // Without visitSeq (an older server): the page's own floor, as before.
    expect(floorAfter(null, thread)).toBe(44);
    // beginPilot keeps it.
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ token: "t", id: "g1", name: "Winamp", seq: 44, visitSeq: 40 }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const p = await beginPilot({ eventId: "e", token: "m", name: "Server Room" } as unknown as Parameters<typeof beginPilot>[0], "g1");
      expect(p).toEqual({ token: "t", id: "g1", name: "Winamp", seq: 44, visitSeq: 40 });
    } finally {
      globalThis.fetch = real;
    }
  });

  it("keeps only the lines past it", () => {
    const lines = [{ seq: 2 }, { seq: 9 }, { seq: 10 }, { seq: 12 }];
    expect(visitLinesOf(lines, 9).map((l) => l.seq)).toEqual([10, 12]);
    expect(visitLinesOf(lines, null)).toEqual(lines);
    expect(visitLinesOf(lines, -1)).toEqual(lines);
  });
});

describe("a locked pass at a room terminal (wave 26, R1)", () => {
  const answer = (status: number, body: unknown, seen: Array<{ url: string; init: RequestInit }> = []): typeof fetch =>
    (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
    }) as unknown as typeof fetch;

  it("reads the pass's GuestView with the mod token, minting nothing", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    expect(await passLocked(room, "g 1", { fetchFn: answer(200, { id: "g 1", name: "Napster", locked: true }, seen) })).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/e/evt%201/api/state?role=guest&as=g%201");
    expect((seen[0]!.init.headers as Record<string, string>)["x-loom-token"]).toBe("mod-tok");
    expect(seen[0]!.url).not.toMatch(/impersonate/u);
  });

  it("opens the line for an unlocked pass, an older server, or any failure", async () => {
    expect(await passLocked(room, "g1", { fetchFn: answer(200, { name: "Winamp", locked: false }) })).toBe(false);
    expect(await passLocked(room, "g1", { fetchFn: answer(200, { name: "Winamp" }) })).toBe(false);
    expect(await passLocked(room, "g1", { fetchFn: answer(404, null) })).toBe(false);
    expect(await passLocked(room, "g1", { fetchFn: fakeFetch(new Error("offline"), []) })).toBe(false);
    const hang = (async (_u: string, init: RequestInit) =>
      new Promise((_r, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    expect(await passLocked(room, "g1", { fetchFn: hang, timeoutMs: 5 })).toBe(false);
  });

  it("only a room terminal refuses at the scan; the connect checks before it impersonates", async () => {
    expect(refusesLockedPass(room)).toBe(true);
    expect(refusesLockedPass({ ...room, room: "" })).toBe(false);
    expect(refusesLockedPass({ ...room, view: "reinstall" })).toBe(false);
    expect(refusesLockedPass({ ...room, view: "tv" })).toBe(false);
    expect(LOCKED_PASS_NOTICE).toMatch(/TENT/u);
    const { readFileSync } = await import("node:fs");
    const app = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");
    const gate = app.indexOf("if (refusesLockedPass(config) && (await passLocked(config, guestId)))");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(app.indexOf("const p = await beginPilot(config, guestId);"));
    expect(app.slice(gate, app.indexOf("const p = await beginPilot(config, guestId);"))).toMatch(/setFlash\(LOCKED_PASS_NOTICE\);[\s\S]*setScreen\(\{ kind: "attract" \}\);\s+return;/u);
  });
});

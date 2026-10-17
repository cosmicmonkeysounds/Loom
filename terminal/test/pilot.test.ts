//! A room terminal tells the story when a line opens and closes there (wave 7:
//! the server-room terminal → `terminal opened` / `terminal closed`).

import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config.ts";
import { VisitLatch, closeVisit, endPilot, openVisit, postVisit, visitSignalBody } from "../src/pilot.ts";

const room = defaultConfig({ eventId: "evt 1", token: "mod-tok", name: "Server Room", spot: "server-room", view: "face", room: "The Server Room" });

function fakeFetch(status: number | Error, seen: Array<{ url: string; init: RequestInit }>): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    if (status instanceof Error) throw status;
    return { status, ok: status >= 200 && status < 300, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
}

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
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ session: "imp" });
    expect(seen[0]!.init.keepalive).toBe(true);
    await expect(endPilot(room, { token: "imp", id: "g7", name: "Ada" }, { fetchFn: fakeFetch(new Error("gone"), seen) })).resolves.toBeUndefined();
  });
});

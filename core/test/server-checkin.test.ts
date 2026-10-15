//! K-13 — room check-in by QR: `POST /api/guest/checkin {at}` journals
//! `checked_in` with the exact LOCATION id (the story moves the guest), and
//! refuses captives, prisoners, guests on rails, hidden rooms, and repeats
//! inside the cooldown.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { CHECKIN_COOLDOWN_MS, checkinRefusal, checkinTarget } from "../server/routes/k13.ts";

const CODES = { event: "EVT131", prime: "PRM131", mod: "MOD131" };

const SOURCE = `# Check In
start: Hall

LOCATION Hall
LOCATION The Cache
LOCATION Attic
  hidden: true
LOCATION Jail
  prison: true
  sealed: true
LOCATION Login
  cutscene: true
LOCATION Vault
  checkin: false

ROLE Guest
  uploaded: bool = false
  cleared: bool = false
  when checked_in for guest:
    if at == "The Cache":
      move guest to The Cache
    else if at == "Attic":
      move guest to Attic
    else if at == "Hall":
      move guest to Hall

== Hall
  setting: Hall
Narrator: The hall.
`;

const dirs: string[] = [];
let clock = 1_000_000;
function fresh(): { rt: EventRuntime; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "loom-k13-"));
  dirs.push(dir);
  const rt = new EventRuntime({
    eventId: "evt",
    store: new Store(dir),
    codes: CODES,
    scenarioName: "checkin",
    scenarioSource: SOURCE,
    joinBase: () => "http://localhost",
    now: () => clock,
  });
  rt.openDoors();
  return { rt, dir };
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
  } as unknown as IncomingMessage;
}
function fakeRes(): ServerResponse & { statusCode: number; body: string } {
  const res = {
    statusCode: 0,
    body: "",
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    write() {
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
  };
  return res as unknown as ServerResponse & { statusCode: number; body: string };
}
async function post(rt: EventRuntime, path: string, body: unknown) {
  const res = fakeRes();
  await rt.handle(fakeReq(body), res, "POST", path, new URL(`http://x${path}`), { moderator: false });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}
async function guest(rt: EventRuntime, name = "Alice"): Promise<{ id: string; token: string }> {
  const r = await post(rt, "/api/guest/register", { name, passcode: CODES.event });
  return { id: r.json.id as string, token: r.json.token as string };
}
const checkin = (rt: EventRuntime, token: string, at: string) => post(rt, "/api/guest/checkin", { token, at });

describe("checkinTarget / checkinRefusal", () => {
  it("folds a sign's slug onto the exact LOCATION id", () => {
    const sim = Sim.fromSources(SOURCE);
    expect(checkinTarget(sim, "the-cache")).toBe("The Cache");
    expect(checkinTarget(sim, "THE_CACHE")).toBe("The Cache");
    expect(checkinTarget(sim, " The Cache ")).toBe("The Cache");
    expect(checkinTarget(sim, "the-garage")).toBeNull();
    expect(checkinTarget(sim, "")).toBeNull();
  });

  it("refuses prison and cutscene targets, and hidden rooms until revealed", () => {
    const sim = Sim.fromSources(SOURCE);
    sim.createPerson("g1", "Ada");
    expect(checkinRefusal(sim, "g1", "The Cache")).toBeNull();
    expect(checkinRefusal(sim, "g1", "Jail")?.status).toBe(403);
    expect(checkinRefusal(sim, "g1", "Login")?.status).toBe(403);
    expect(checkinRefusal(sim, "g1", "Vault")?.error).toMatch(/check-in point/); // `checkin: false`
    expect(checkinRefusal(sim, "g1", "Attic")?.error).toMatch(/isn't open yet/);
    sim.reveal("Attic", "g1");
    expect(checkinRefusal(sim, "g1", "Attic")).toBeNull();
  });
});

describe("POST /api/guest/checkin", () => {
  it("journals checked_in with the exact LOCATION and lands the guest in that room", async () => {
    const { rt, dir } = fresh();
    const g = await guest(rt);
    const r = await checkin(rt, g.token, "the-cache");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, at: "The Cache", channel: "loc:The Cache", moved: true });
    expect(rt.liveSim!.locationOf(g.id)).toBe("The Cache");
    // Journaled as a story signal (so a restart replays the move).
    const journal = readFileSync(join(dir, "journal.ndjson"), "utf8");
    expect(journal).toContain('"checked_in"');
    expect(journal).toContain('"at":"The Cache"');
  });

  it("needs a guest token and open doors", async () => {
    const { rt } = fresh();
    expect((await checkin(rt, "nope", "Hall")).status).toBe(401);
    const g = await guest(rt);
    rt.pause();
    expect((await checkin(rt, g.token, "Hall")).status).toBe(409);
  });

  it("refuses an unknown room, a captive, a prisoner, and a guest on rails — journaling nothing", async () => {
    const { rt } = fresh();
    const sim = rt.liveSim!;
    const a = await guest(rt, "Ada");
    expect((await checkin(rt, a.token, "the-garage")).status).toBe(404);

    const b = await guest(rt, "Bea");
    sim.capture(b.id);
    expect((await checkin(rt, b.token, "Hall")).json.error).toMatch(/captured/);

    const c = await guest(rt, "Cy");
    sim.arrive(c.id, "Jail");
    expect((await checkin(rt, c.token, "Hall")).status).toBe(409);

    const d = await guest(rt, "Di");
    sim.arrive(d.id, "Login");
    expect((await checkin(rt, d.token, "Hall")).json.error).toMatch(/Not yet/);

    const e = await guest(rt, "Ed");
    sim.setVar(`${e.id}.uploaded`, "true");
    expect((await checkin(rt, e.token, "The Cache")).status).toBe(409);
    sim.setVar(`${e.id}.cleared`, "true");
    expect((await checkin(rt, e.token, "The Cache")).status).toBe(200);

    const signals = sim.log.all().filter((x) => x.type === "signal" && x.name === "checked_in");
    expect(signals.map((x) => (x as { subject: string | null }).subject)).toEqual([e.id]);
  });

  it("refuses a hidden room until the story opens it", async () => {
    const { rt } = fresh();
    const g = await guest(rt);
    expect((await checkin(rt, g.token, "attic")).status).toBe(403);
    rt.liveSim!.reveal("Attic", g.id);
    expect((await checkin(rt, g.token, "attic")).status).toBe(200);
    expect(rt.liveSim!.locationOf(g.id)).toBe("Attic");
  });

  it("allows one check-in per cooldown", async () => {
    const { rt } = fresh();
    const g = await guest(rt);
    expect((await checkin(rt, g.token, "The Cache")).status).toBe(200);
    clock += 5_000;
    const again = await checkin(rt, g.token, "Hall");
    expect(again.status).toBe(429);
    expect(again.json.retryAfter).toBe(15);
    // A refusal doesn't start the cooldown; another guest isn't affected.
    const h = await guest(rt, "Hal");
    expect((await checkin(rt, h.token, "Hall")).status).toBe(200);
    clock += CHECKIN_COOLDOWN_MS;
    expect((await checkin(rt, g.token, "Hall")).status).toBe(200);
    expect(rt.liveSim!.locationOf(g.id)).toBe("Hall");
  });
});

describe("Trapped in the Internet's room signs", () => {
  it("every check-in point the story's if-chain handles has a sign slug, and the gates hold", async () => {
    const { scenarioSource } = await import("../examples/load.ts");
    const sim = Sim.fromSources(scenarioSource("trapped-in-the-internet"));
    const points = ["The Desktop", "The Start Bar", "The CPU", "The Steam Room", "The Tube", "Disk Cleanup", "The Cloud", "The RAM", "The Fan Closet", "The Graphics Card", "The Hard Drive"];
    for (const p of points) expect(checkinTarget(sim, p.toLowerCase().replace(/ /gu, "-")), p).toBe(p);
    // The Internet is the prison; the Optical Drive is the login cutscene.
    expect(checkinRefusal(sim, "nobody", "The Internet")).not.toBeNull();
    // The locked Server Room prints no sign (`checkin: false`) and refuses a typed slug.
    expect(checkinTarget(sim, "the-server-room")).toBe("The Server Room");
    sim.createPerson("g1", "Ada");
    sim.setVar("g1.uploaded", "true");
    sim.arrive("g1", "The Desktop");
    expect(checkinRefusal(sim, "g1", "The Desktop")?.error).toMatch(/Not yet/); // waiting for the Antivirus
    sim.setVar("g1.cleared", "true");
    expect(checkinRefusal(sim, "g1", "The Desktop")).toBeNull();
    expect(checkinRefusal(sim, "g1", "The Server Room")?.error).toMatch(/check-in point/);
    const signals = sim.signal("checked_in", "g1", { at: checkinTarget(sim, "the-desktop")! });
    expect(sim.locationOf("g1")).toBe("The Desktop");
    expect(signals.some((e) => e.type === "respond" && e.text.startsWith("📍"))).toBe(true);
  });
});

// Wave 44 (docs/loom-w44-contract.md C5, C6): the credits' source and
// `GET /api/credits`, `NightView.credits`, the credits slide that holds, and
// `GET /api/mod/video` (+ its CSV).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { CreditsSource, CREDITS_CACHE_MS } from "../server/credits.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { slidePersists } from "../server/routes/screen.ts";
import { videoConsentCsv, type VideoConsentView } from "../server/routes/video.ts";
import { Store } from "../server/store.ts";
import type { GuestView } from "../server/views.ts";
import type { CreditsView } from "../src/credits.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "loom-w44-"));
  dirs.push(d);
  return d;
};

const CREDITS = JSON.stringify({
  title: "The Night",
  sections: [
    { heading: "Cast", people: [{ role: "Clerk", name: "Jo" }, { role: "Nobody yet", name: "" }] },
    { heading: "Starring", programs: true },
  ],
  end: ["Thanks."],
});

describe("wave 44: the credits' source (C5)", () => {
  it("prefers the project's file, then LOOM_CREDITS; the scenario's own only with no project", async () => {
    const d = tmp();
    const env = join(d, "env.json");
    const own = join(d, "own.json");
    writeFileSync(env, CREDITS.replace("The Night", "From env"));
    writeFileSync(own, CREDITS.replace("The Night", "From the scenario"));
    let project: string | null = CREDITS.replace("The Night", "From the project");
    const withProject = new CreditsSource({ project: async () => project, envFile: env, scenarioFile: own, now: () => 0 });
    expect((await withProject.read()).file?.title).toBe("From the project");
    expect((await withProject.read()).source).toBe("project");
    project = null;
    withProject.invalidate();
    expect((await withProject.read()).file?.title).toBe("From env");
    // A project never falls back to the scenario's own (another story's credits).
    const projectOnly = new CreditsSource({ project: async () => null, envFile: null, scenarioFile: own });
    expect((await projectOnly.read()).file).toBeNull();
    const lan = new CreditsSource({ project: null, envFile: null, scenarioFile: own });
    expect(await lan.read()).toMatchObject({ source: "scenario", problems: [] });
  });

  it("caches a read, and reads an unusable file as none (logged once)", async () => {
    let now = 0;
    let reads = 0;
    const logs: string[] = [];
    const src = new CreditsSource({
      project: async () => {
        reads += 1;
        return "{ not json";
      },
      now: () => now,
      log: (m) => logs.push(m),
    });
    const a = await src.read();
    expect(a.file).toBeNull();
    expect(a.source).toBe("project");
    expect(a.problems[0]).toMatch(/not JSON/u);
    await src.read();
    expect(reads).toBe(1);
    now += CREDITS_CACHE_MS;
    await src.read();
    expect(reads).toBe(2);
    expect(logs).toHaveLength(1);
  });
});

describe("wave 44: the credits slide holds (C3)", () => {
  it("is persistent: no 45 s / 90 s drop back to attract", () => {
    expect(slidePersists("credits")).toBe(true);
  });
});

// ───────────────────────── the runtime ─────────────────────────

const CODES = { event: "EVT644", prime: "PRM644", mod: "MOD644" };
const STORY = `# Credits
start: Boot

LOCATION Lobby
  label: The Lobby

ROLE Program
  secret: video
  video: text = "none"
  featured: text = "none"

CHARACTER Clerk
  listed: true

INTERACTION roll
  who: admin

when roll:
  set Night.credits_roll += 1
  set Night.credits_at = Time.elapsed

== Boot
  setting: Lobby
set Night.credits_roll = 0
set Night.credits_at = 0
Nothing yet.
`;

function fakeReq(body: unknown, headers: Record<string, string> = {}) {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  const req = {
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
    destroy() {},
  } as unknown as IncomingMessage;
  return req;
}
function fakeRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: "",
    writeHead(s: number, h?: Record<string, string>) {
      res.statusCode = s;
      if (h !== undefined) Object.assign(res.headers, h);
      return res;
    },
    setHeader(k: string, v: string) {
      res.headers[k.toLowerCase()] = v;
    },
    write() {
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
  };
  return res as typeof res & ServerResponse;
}
async function call(rt: EventRuntime, method: "GET" | "POST", path: string, body: unknown = {}, moderator = false) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(body), res, method, url.pathname, url, moderator ? { moderator: true, moderatorName: "Ada" } : {});
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body || "{}") as Record<string, unknown>;
  } catch {
    /* csv */
  }
  return { status: res.statusCode, json, res };
}

function runtime(credits: string | null): EventRuntime {
  const d = tmp();
  let file: string | null = null;
  if (credits !== null) {
    file = join(d, "credits.json");
    writeFileSync(file, credits);
  }
  const rt = new EventRuntime({ eventId: "evt", store: new Store(join(d, "state")), codes: CODES, scenarioName: "credits", scenarioSource: STORY, joinBase: () => "http://localhost", creditsFile: file, houseFile: join(d, "nowhere", "house.json") });
  rt.openDoors();
  return rt;
}
async function guest(rt: EventRuntime, name: string) {
  const r = await call(rt, "POST", "/api/guest/register", { name, passcode: CODES.event });
  expect(r.status).toBe(200);
  return { id: r.json.id as string, token: r.json.token as string };
}

describe("wave 44: GET /api/credits (C5)", () => {
  it("a moderator always, with source and problems; a guest only once they roll", async () => {
    const rt = runtime(CREDITS);
    const g = await guest(rt, "Calculator");
    await guest(rt, "Notepad");
    const m = await call(rt, "GET", "/api/credits", {}, true);
    expect(m.status).toBe(200);
    expect(m.res.headers["cache-control"]).toBe("no-store");
    const view = m.json as unknown as CreditsView;
    expect(view.source).toBe("env");
    expect(view.problems).toEqual([]);
    expect(view.roll).toBe(0);
    expect(view.sections[0]!.people).toEqual([{ role: "Clerk", name: "Jo" }]);
    expect(view.sections[1]!.lines).toEqual(["Calculator", "Notepad"]);
    expect((await call(rt, "GET", `/api/credits?token=${g.token}`)).json).toEqual({ error: "not_yet" });
    expect((await call(rt, "GET", "/api/credits")).status).toBe(401);
    // The roll: the guest may read them now, without the mod-only fields.
    await call(rt, "POST", "/api/mod/signal", { name: "roll" }, true);
    const asGuest = await call(rt, "GET", `/api/credits?token=${g.token}`);
    expect(asGuest.status).toBe(200);
    expect(asGuest.json.roll).toBe(1);
    expect(asGuest.json.source).toBeUndefined();
    expect(asGuest.json.problems).toBeUndefined();
    // And the phone hears the roll on its night.
    const gv = (await call(rt, "GET", `/api/state?role=guest&token=${g.token}`)).json as unknown as GuestView;
    expect(gv.night?.credits).toEqual({ roll: 1, at: 0 });
  });

  it("404 no_credits with no file; a booth reads them once they roll", async () => {
    const rt = runtime(null);
    expect((await call(rt, "GET", "/api/credits", {}, true)).json).toEqual({ error: "no_credits" });
    const login = await call(rt, "POST", "/api/prime/login", { passcode: CODES.prime, character: "Clerk" });
    const token = login.json.token as string;
    expect((await call(rt, "GET", `/api/credits?token=${token}`)).json).toEqual({ error: "not_yet" });
    await call(rt, "POST", "/api/mod/signal", { name: "roll" }, true);
    expect((await call(rt, "GET", `/api/credits?token=${token}`)).json).toEqual({ error: "no_credits" });
  });
});

describe("wave 44: GET /api/mod/video (C6)", () => {
  it("lists every guest's answer, directors only, and downloads as CSV", async () => {
    const rt = runtime(null);
    const a = await guest(rt, "Calculator");
    const b = await guest(rt, "Notepad");
    await guest(rt, "Winamp");
    await call(rt, "POST", "/api/mod/var", { path: `${a.id}.video`, value: '"out"' }, true);
    await call(rt, "POST", "/api/mod/var", { path: `${b.id}.video`, value: '"ok"' }, true);
    const r = await call(rt, "GET", "/api/mod/video", {}, true);
    expect(r.status).toBe(200);
    const view = r.json as unknown as VideoConsentView;
    expect(view.counts).toEqual({ ok: 1, out: 1, unasked: 1 });
    expect(view.rows.map((x) => [x.name, x.video])).toEqual([
      ["Calculator", "out"],
      ["Notepad", "ok"],
      ["Winamp", "unasked"],
    ]);
    expect((await call(rt, "GET", `/api/mod/video?token=${a.token}`)).status).toBe(403);
    const csv = await call(rt, "GET", "/api/mod/video?format=csv", {}, true);
    expect(csv.res.headers["content-type"]).toMatch(/^text\/csv/u);
    expect(csv.res.headers["content-disposition"]).toBe('attachment; filename="video-consent.csv"');
    expect(csv.res.body.split("\n").slice(0, 3)).toEqual(["program,video,id", `Calculator,out,${a.id}`, expect.stringMatching(/^Winamp,unasked,/u)]);
  });

  it("the CSV quotes what it must and never starts a formula", () => {
    const view: VideoConsentView = { rows: [{ id: "g1", name: '=HYPERLINK("x"), Inc', video: "out", avatar: null }], counts: { ok: 0, out: 1, unasked: 0 } };
    expect(videoConsentCsv(view)).toBe(`program,video,id\n"'=HYPERLINK(""x""), Inc",out,g1\n`);
  });
});

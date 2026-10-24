// node --experimental-strip-types --no-warnings --test scripts/show/test/client.test.ts
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { cacheKey, defaultCachePath, type FetchLike, ShowClient, ShowError } from "../lib/client.ts";
import { authRoutes, fakeServer, MOD, SERVER, tempCache } from "./fake-server.ts";

const state = { status: 200, body: { phase: "open", roster: [] } };

test("one resolve + one login, then the cache carries the next run", async () => {
  const cache = tempCache();
  const srv = fakeServer({ ...authRoutes(), "GET /e/ev1/api/state?role=mod": state });
  const a = new ShowClient({ server: SERVER + "/", code: MOD, fetch: srv.fetch, cachePath: cache });
  assert.equal((await a.get("/api/state?role=mod")).status, 200);
  assert.deepEqual(a.calls, { resolve: 1, login: 1 });
  assert.equal(a.eventId, "ev1");
  assert.equal(a.title, "Test Show");
  const b = new ShowClient({ server: SERVER, code: MOD, fetch: srv.fetch, cachePath: cache });
  assert.equal((await b.get("/api/state?role=mod")).status, 200);
  assert.deepEqual(b.calls, { resolve: 0, login: 0 }, "a cached session needs no resolve (rate-limited) and no login");
  const sent = srv.seen.filter((s) => s.path.startsWith("/e/ev1/api/state"));
  assert.ok(sent.every((s) => s.headers["x-loom-token"] === "tok-1"), "the token rides the header");
  assert.ok(srv.seen.every((s) => !/token=/u.test(s.path)), "never in a URL");
});

test("the cache file holds a token but never the passcode", async () => {
  const cache = tempCache();
  const srv = fakeServer({ ...authRoutes(), "GET /e/ev1/api/state?role=mod": state });
  await new ShowClient({ server: SERVER, code: MOD, fetch: srv.fetch, cachePath: cache }).get("/api/state?role=mod");
  const text = readFileSync(cache, "utf8");
  assert.ok(!text.includes(MOD));
  assert.ok(text.includes(cacheKey(SERVER, MOD)));
  assert.notEqual(cacheKey(SERVER, MOD), cacheKey("https://other.example", MOD), "keyed by server too");
});

test("a 403 logs in again once, sending the old token so the session is upgraded, not minted", async () => {
  const cache = tempCache();
  let first = true;
  const srv = fakeServer({
    ...authRoutes(),
    "GET /e/ev1/api/state?role=mod": () => {
      if (first) {
        first = false;
        return { status: 403, body: { error: "moderators only" } };
      }
      return state;
    },
  });
  const c = new ShowClient({ server: SERVER, code: MOD, fetch: srv.fetch, cachePath: cache });
  await c.connect();
  const r = await c.get("/api/state?role=mod");
  assert.equal(r.status, 200);
  assert.equal(c.calls.login, 2);
  const logins = srv.seen.filter((s) => s.path === "/e/ev1/api/mod/login");
  assert.equal(logins[1]!.headers["x-loom-token"], "tok-1", "the re-login carries the cached token");
});

test("an ended event (404 unknown event) resolves the code again", async () => {
  const cache = tempCache();
  const srv = fakeServer({ ...authRoutes("ev2"), "GET /e/ev2/api/state?role=mod": state, "GET /e/old/api/state?role=mod": { status: 404, body: { error: "unknown event" } } });
  // A stale cache entry pointing at an event that is gone.
  const seed = new ShowClient({ server: SERVER, code: MOD, fetch: fakeServer(authRoutes("old")).fetch, cachePath: cache });
  await seed.connect();
  const c = new ShowClient({ server: SERVER, code: MOD, fetch: srv.fetch, cachePath: cache });
  assert.equal((await c.get("/api/state?role=mod")).status, 200);
  assert.equal(c.eventId, "ev2");
});

test("a 503 starting (the VPS booting) waits the retry-after and asks once more; other 503s pass through", async () => {
  const auth = fakeServer(authRoutes());
  let calls = 0;
  const waits: number[] = [];
  const fetch: FetchLike = async (url, init) => {
    if (!url.includes("/api/state")) return auth.fetch(url, init);
    calls++;
    const answer = calls === 1 ? { status: 503, body: { error: "starting" } } : url.includes("broken") ? { status: 503, body: { error: "event failed to load" } } : { status: 200, body: { ok: true } };
    return { status: answer.status, headers: { get: (h: string) => (h === "retry-after" && answer.status === 503 ? "2" : null) }, text: async () => JSON.stringify(answer.body) };
  };
  const c = new ShowClient({ server: SERVER, code: MOD, fetch, cachePath: tempCache(), sleep: async (ms) => void waits.push(ms) });
  assert.equal((await c.get("/api/state?role=mod")).status, 200);
  assert.deepEqual(waits, [2000]);
  calls = 0;
  const broken = await c.get("/api/state?role=mod&broken=1");
  assert.equal(broken.status, 503, "a load failure is answered as it is, after the one retry");
  assert.equal(calls, 2, "never more than one retry");
});

test("refusals are ShowErrors that name what was read", async () => {
  const cache = tempCache();
  const guest = fakeServer({ "POST /api/resolve-code": { status: 200, body: { eventId: "ev1", role: "guest", title: "x" } } });
  await assert.rejects(new ShowClient({ server: SERVER, code: "GUEST", fetch: guest.fetch, cachePath: cache }).connect(), (e: unknown) => e instanceof ShowError && /guest code, not the moderator/u.test(e.message) && e.read === "POST /api/resolve-code");
  const slow = fakeServer({ "POST /api/resolve-code": { status: 429, body: { error: "too many attempts" } } });
  await assert.rejects(new ShowClient({ server: SERVER, code: MOD, fetch: slow.fetch, cachePath: tempCache() }).connect(), /rate-limiting/u);
  await assert.rejects(new ShowClient({ server: SERVER, code: "", fetch: slow.fetch, cachePath: tempCache() }).connect(), /LOOM_MOD_CODE/u);
  const down: FetchLike = async () => {
    throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
  };
  await assert.rejects(new ShowClient({ server: SERVER, code: MOD, fetch: down, cachePath: tempCache() }).raw("GET", "/api/health"), /can't reach .*ECONNREFUSED/u);
});

test("the cache lives in the user's config dir (APPDATA on Windows)", () => {
  assert.equal(defaultCachePath({ SHOWCTL_CACHE: "/x/y.json" }, "darwin"), "/x/y.json");
  assert.match(defaultCachePath({ APPDATA: "C:\\Users\\j\\AppData\\Roaming" }, "win32"), /AppData.Roaming.loom.showctl-sessions\.json$/u);
  assert.match(defaultCachePath({ XDG_CONFIG_HOME: "/home/j/.cfg" }, "linux"), /^\/home\/j\/\.cfg\/loom\/showctl-sessions\.json$/u);
});

// node --experimental-strip-types --no-warnings --test scripts/show/test/commands.test.ts
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { parseArgs } from "../lib/args.ts";
import { ShowClient } from "../lib/client.ts";
import { type Ctx, doctor, fire, fireLabel, log, roster, rosterWhere, serverChecks, status, watchLoop } from "../lib/commands.ts";
import { ShowError } from "../lib/client.ts";
import type { Probe } from "../lib/local.ts";
import { entryMatches, formatEntry, isSecretPath } from "../lib/logfmt.ts";
import { authRoutes, fakeServer, type Handler, MOD, SERVER, tempCache } from "./fake-server.ts";

const E = "/e/ev1";
const persona = { id: "p-1", name: "Ivo", role: "Program", online: true };
const guest = { id: "g-1", name: "Winamp", role: "Program", online: true, location: "The Desktop", score: 3, captured: true, lastSeen: 0 };

function modView(roster: unknown[]) {
  return {
    title: "Test Show",
    phase: "open",
    scenario: "s",
    roster,
    cast: [{ id: "Trabolta", agent: true, online: true, agentQueue: { depth: 0, oldestMs: null, stalled: false } }, { id: "Kernel", secret: true }],
    minds: [{ character: "Trabolta", mode: "new", worker: "laptop", at: 0 }],
    facts: { mode: "auto", pending: 0, judge: "Trabolta" },
    interactions: [{ id: "patch_combo_a", who: "admin" }],
    modsOnline: 1,
    directors: ["John"],
    world: [{ path: "Kernel.door_code", value: "SECRET-DOOR" }],
  };
}

function routes(rosterRows: unknown[], extra: Record<string, Handler | { status: number; body: unknown }> = {}) {
  return {
    ...authRoutes(),
    "GET /api/health": { status: 200, body: { ok: true, controlPlane: true, events: 1 } },
    "GET /api/landing": { status: 200, body: { title: "Test Show" } },
    [`GET ${E}/api/state?role=mod`]: { status: 200, body: modView(rosterRows) },
    [`GET ${E}/api/state?role=mod&cues=1`]: { status: 200, body: { interactions: [{ id: "a", label: "B1 · Bingo", who: "admin" }, { id: "b", label: "B2 · Hunt", who: "admin" }], cues: { last: "a", fired: ["a"], lastName: "Task Manager" }, showClock: { minutes: 1260, running: true }, world: [{ path: "Night.phase", value: "bingo" }] } },
    [`POST ${E}/api/mod/codes`]: { status: 200, body: { joinUrl: SERVER, eventPass: "GUESTCODE", modPass: MOD } },
    [`GET ${E}/api/mod/screen/terminals`]: { status: 200, body: { silentMs: 20_000, voiceMuted: false, terminals: [{ name: "TV", spot: "desktop-tv", view: "tv", ago: 1000, fullscreen: true, audio: true }] } },
    [`GET ${E}/api/screen/state`]: { status: 200, body: { night: { phase: "bingo" }, character: { id: "Trabolta", hidden: false, awake: true, online: true } } },
    [`GET ${E}/api/mod/audio`]: { status: 200, body: { router: { online: true, name: "macbook" }, source: "project", problems: [], warnings: [] } },
    [`GET ${E}/api/mod/lights`]: { status: 200, body: { module: { name: "desktop", online: true }, devices: [{ friendly: "server_room_rgb" }], devicesAt: 1, problems: [] } },
    [`GET ${E}/api/mod/spatial/stations`]: { status: 200, body: { stations: [] } },
    [`GET ${E}/api/mod/metrics?window=showctl`]: { status: 200, body: { at: 1, cpu: { userUs: 0, systemUs: 0 }, eventLoop: { p99Ms: 10 }, memory: { rssMb: 200 }, clients: 3, uptimeS: 10 } },
    ...extra,
  };
}

function ctxFor(argv: string[], srv: ReturnType<typeof fakeServer>, confirmAnswer = false): Ctx & { lines: string[]; errs: string[] } {
  const lines: string[] = [];
  const errs: string[] = [];
  const ctx = {
    lines,
    errs,
    client: new ShowClient({ server: SERVER, code: MOD, fetch: srv.fetch, cachePath: tempCache() }),
    args: parseArgs(argv),
    color: false,
    json: argv.includes("--json"),
    out: (s: string) => lines.push(s),
    err: (s: string) => errs.push(s),
    probe: {} as Probe,
    sleep: async () => {},
    now: () => 60_000,
    mapSpots: [{ id: "desktop-tv", name: "TV" }],
    clear: () => {},
    confirm: async () => confirmAnswer,
  };
  return ctx;
}

test("doctor: a healthy night is green, and no read registers the caller as a device", async () => {
  const srv = fakeServer(routes([persona]));
  const ctx = ctxFor(["doctor"], srv);
  assert.equal(await doctor(ctx), 0, ctx.lines.join("\n"));
  for (const s of srv.seen) {
    assert.ok(!/[?&]name=/u.test(s.path), `a screen-state read with a name is a fake terminal: ${s.path}`);
    assert.ok(!/router=1|module=1|spatial\/station\?/u.test(s.path), `registers the caller: ${s.path}`);
    assert.ok(!/token=/u.test(s.path), "the token never rides a URL");
    assert.ok(!/\/events\b/u.test(s.path), "never a mod stream (it would count as a director console)");
  }
  const text = ctx.lines.join("\n");
  assert.ok(!text.includes(MOD) && !text.includes("GUESTCODE") && !text.includes("SECRET-DOOR") && !text.includes("tok-1"), "no code, token or secret world value prints");
});

test("doctor: red rows make exit 2; a server that is down stops after the health row", async () => {
  const srv = fakeServer(routes([persona], { [`GET ${E}/api/mod/audio`]: { status: 200, body: { router: { online: false, lastSeen: null }, problems: [] } } }));
  assert.equal(await doctor(ctxFor(["doctor"], srv)), 2);
  const down = fakeServer({ "GET /api/health": { status: 503, body: { ok: false, reason: "starting" } } });
  const rows = await serverChecks(ctxFor(["doctor"], down));
  assert.equal(rows[0]!.level, "fail");
});

test("status: LAST / NEXT off the lean cue sheet, the show clock, one line per area", async () => {
  const ctx = ctxFor(["status"], fakeServer(routes([guest])));
  assert.equal(await status(ctx), 0, ctx.lines.join("\n"));
  const text = ctx.lines.join("\n");
  assert.match(text, /show clock 9:00 PM/u);
  assert.match(text, /LAST B1 · Bingo \(Task Manager\) {3}NEXT B2 · Hunt {3}1\/2 cues fired/u);
  assert.match(text, /Terminals 1\/1 live/u);
  assert.match(text, /House: router online · lights online/u);
});

test("status: a key spot that never polled is red, as in doctor", async () => {
  const ctx = ctxFor(["status"], fakeServer(routes([guest], { [`GET ${E}/api/mod/screen/terminals`]: { status: 200, body: { silentMs: 20_000, terminals: [] } } })));
  ctx.mapSpots = [{ id: "desktop-tv", name: "TV" }, { id: "tent", name: "Tent" }, { id: "kitchen", name: "Kitchen" }];
  assert.equal(await status(ctx), 2, ctx.lines.join("\n"));
  const line = ctx.lines.find((l) => /Terminals/u.test(l))!;
  assert.match(line, /^FAIL/u);
  assert.match(line, /Terminals 0\/2 live: ✗ TV never polled · ✗ Tent never polled$/u);
});

test("fire: refused (exit 3, nothing posted) when a real guest is on the roster", async () => {
  const srv = fakeServer(routes([persona, guest]));
  const ctx = ctxFor(["fire", "patch_combo_a", "--yes"], srv);
  assert.equal(await fire(ctx), 3);
  assert.match(ctx.errs.join("\n"), /1 real guest.*Winamp.*--i-know-this-is-live/u);
  assert.ok(!srv.seen.some((s) => s.path.endsWith("/api/mod/signal")));
});

test("fire: without --yes it asks, and a no posts nothing", async () => {
  const srv = fakeServer(routes([persona]));
  assert.equal(await fire(ctxFor(["fire", "patch_combo_a"], srv, false)), 3);
  assert.ok(!srv.seen.some((s) => s.path.endsWith("/api/mod/signal")));
});

test("fire: a rehearsal fires with a label, a subject by name and typed args; an undeclared name warns", async () => {
  let body: Record<string, unknown> | null = null;
  const srv = fakeServer(routes([persona, guest], { [`POST ${E}/api/mod/signal`]: (r) => ((body = r.body), { status: 200, body: { ok: true, presses: 3, staff: ["🔌 Combo A is in."] } }) }));
  const ctx = ctxFor(["fire", "patch_combo_a", "--yes", "--i-know-this-is-live", "--subject", "winamp", "--arg", "level=3", "--arg", "combo=V1-D2"], srv);
  assert.equal(await fire(ctx), 0, ctx.errs.join("\n"));
  assert.deepEqual(body, { name: "patch_combo_a", label: fireLabel(), subject: "g-1", args: { level: 3, combo: "V1-D2" } });
  assert.match(ctx.lines.join("\n"), /fired "patch_combo_a" ✓\n {2}staff: 🔌 Combo A is in\./u);
  const typo = ctxFor(["fire", "patch_combo_z", "--yes"], fakeServer(routes([persona], { [`POST ${E}/api/mod/signal`]: { status: 200, body: { ok: true } } })));
  assert.equal(await fire(typo), 1);
  assert.match(typo.lines.join("\n"), /not a declared INTERACTION/u);
  assert.match(fireLabel("steph-laptop"), /^showctl · steph-laptop$/u);
});

test("roster: real guests by default, --all adds personas, --where filters, --csv", async () => {
  const srv = fakeServer(routes([persona, guest]));
  const a = ctxFor(["roster"], srv);
  await roster(a);
  assert.match(a.lines.join("\n"), /Winamp/u);
  assert.ok(!a.lines.join("\n").includes("Ivo"));
  const b = ctxFor(["roster", "--all", "--csv"], srv);
  await roster(b);
  assert.match(b.lines[0]!, /^NAME,ROLE,FACTION,WHERE,SCORE,STATE,SEEN\nIvo,/u);
  assert.equal(rosterWhere(guest, "captured"), true);
  assert.equal(rosterWhere(guest, "the desktop"), true);
  assert.equal(rosterWhere(persona, "captured"), false);
});

test("log: the last N lines, filtered; secret values masked", async () => {
  const entries = [
    { type: "worldSet", path: "Kernel.combo_a", value: "V2-D5,V4-D1" },
    { type: "worldSet", path: "Night.phase", value: "y2k" },
    { type: "tick", elapsedMs: 5 },
    { type: "signal", name: "patch_changed", subject: "g-1" },
    { type: "beatEntered", beat: "Login", setting: "The Optical Drive", subject: "g-1" },
  ];
  const srv = fakeServer(
    routes([guest], {
      [`GET ${E}/api/mod/log`]: (r) => {
        const after = Number(new URL(`http://x${r.path}`).searchParams.get("after"));
        const from = after + 1;
        return { status: 200, body: { entries: entries.slice(from), next: null, total: entries.length } };
      },
    }),
  );
  const ctx = ctxFor(["log"], srv);
  assert.equal(await log(ctx), 0);
  const text = ctx.lines.join("\n");
  assert.ok(!text.includes("V2-D5"), "the Kernel's combo never prints");
  assert.match(text, /Kernel\.combo_a = •••/u);
  assert.ok(!text.includes("tick"), "ticks are noise unless asked for");
  assert.match(text, /beatEntered {4}Login for Winamp @ The Optical Drive/u);
  const who = ctxFor(["log", "--who", "Winamp", "--type", "signal"], srv);
  await log(who);
  assert.equal(who.lines.length, 1);
  assert.match(who.lines[0]!, /signal {9}patch_changed for Winamp/u);
  const json = ctxFor(["log", "--json", "--type", "worldSet"], srv);
  assert.equal(await log(json), 0);
  assert.ok(!json.lines.join("\n").includes("V2-D5"), "--json masks the Kernel too");
  assert.deepEqual(JSON.parse(json.lines[0]!), { seq: 0, type: "worldSet", path: "Kernel.combo_a", value: "•••" });
  assert.equal(JSON.parse(json.lines[1]!).value, "y2k", "a public value stays");
});

test("logfmt: secret paths, people matching", () => {
  const heads = new Set(["kernel"]);
  assert.ok(isSecretPath("Kernel.anything", heads));
  assert.ok(isSecretPath("Night.door_code", new Set()));
  assert.ok(isSecretPath("Night.combo_b", new Set()));
  assert.ok(!isSecretPath("Night.phase", heads));
  assert.match(formatEntry(7, { type: "worldSet", path: "Night.door_code", value: "1234" }, new Set()), /= •••$/u);
  const names = new Map([["g-1", "Winamp"]]);
  assert.ok(entryMatches({ type: "chat", from: "Winamp" }, [], "winamp", names));
  assert.ok(entryMatches({ type: "signal", subject: "g-1" }, ["signal"], "Winamp", names));
  assert.ok(!entryMatches({ type: "signal", subject: "g-2" }, ["signal"], "Winamp", names));
});

test("watch: a frame that throws is a red line, and the watch keeps going", async () => {
  const ctx = ctxFor(["terminals", "--watch", "1"], fakeServer({}));
  let n = 0;
  const code = await watchLoop(ctx, 1, async () => {
    if (++n === 1) throw new ShowError("can't reach https://show.example: connect ECONNREFUSED", "GET /x");
    ctx.out("frame two");
    return 0;
  }, 2);
  assert.equal(n, 2, "the second frame ran");
  assert.equal(code, 0);
  assert.ok(ctx.lines.some((l) => /^FAIL .*ECONNREFUSED — retrying in 1 s/u.test(l)), ctx.lines.join("\n"));
  assert.ok(ctx.lines.includes("frame two"));
});

test("log --follow: a restarted run (a shorter ledger) is announced and followed from its start", async () => {
  let entries: unknown[] = [{ type: "signal", name: "one" }, { type: "signal", name: "two" }, { type: "signal", name: "three" }];
  const srv = fakeServer(
    routes([guest], {
      [`GET ${E}/api/mod/log`]: (r) => {
        const after = Number(new URL(`http://x${r.path}`).searchParams.get("after"));
        return { status: 200, body: { entries: entries.slice(after + 1), next: null, total: entries.length } };
      },
    }),
  );
  const ctx = ctxFor(["log", "--follow", "1"], srv);
  let sleeps = 0;
  ctx.sleep = async () => {
    sleeps++;
    if (sleeps === 1) entries = [{ type: "beatEntered", beat: "Power On" }];
    if (sleeps === 3) throw new Error("stop");
  };
  await assert.rejects(log(ctx), /stop/u);
  const text = ctx.lines.join("\n");
  assert.match(text, /signal {9}three/u);
  assert.match(text, /— the run restarted \(a new ledger\) —\n# {4}0 beatEntered {4}Power On/u);
  assert.equal(ctx.lines.filter((l) => /restarted/u.test(l)).length, 1, "announced once, then followed");
});

test("doctor before the doors: the minds off the trace, the judge as info", async () => {
  const closed = { title: "Test Show", phase: "idle", scenario: "s", roster: [], cast: [], characters: ["Trabolta"], modsOnline: 1 };
  const srv = fakeServer(routes([], { [`GET ${E}/api/state?role=mod`]: { status: 200, body: closed }, [`GET ${E}/api/mod/agent/trace?limit=1`]: { status: 200, body: { thoughts: [], minds: [{ character: "Trabolta", worker: "laptop", mode: "new", updatedAt: 30 }] } } }));
  const rows = await serverChecks(ctxFor(["doctor"], srv));
  const agent = rows.find((r) => r.name === "Agent workers")!;
  assert.equal(agent.level, "info");
  assert.match(agent.detail, /Trabolta by worker "laptop"/u);
  assert.equal(rows.find((r) => r.name === "Judge")!.level, "info");
});

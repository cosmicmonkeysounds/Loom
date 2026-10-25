//! The host panel's writes (wave 13, CONTRACTS §2.7 / §5.4): every call's
//! route and body, and that no call ever leaves the host allowlist.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { BACK_FROM_BATHROOM, HOST_READS, HOST_ROUTES, announceCue, cueSignal, hostCalls, joinLink, type HostRoute } from "../src/host/api.ts";
import { fetchHostPost } from "../src/host/client.ts";
import { ApiError } from "../src/client.ts";

function recorder(answer: Record<string, unknown> = { ok: true }) {
  const sent: Array<{ route: HostRoute; body: Record<string, unknown> }> = [];
  const calls = hostCalls(async (route, body) => {
    sent.push({ route, body });
    return answer;
  }, () => "Night.alerts");
  return { sent, calls };
}

describe("the host calls", () => {
  it("a verdict fires the facts' confirm event on the filer, with the question", async () => {
    const { sent, calls } = recorder();
    await calls.verdict({ accurate: "fact_accurate", lie: "fact_lie" }, { person: "g1", question: "Q2" }, "lie");
    expect(sent).toEqual([{ route: "/api/mod/signal", body: { name: "fact_lie", subject: "g1", args: { question: "Q2" } } }]);
    // No event for that verdict: nothing is sent.
    expect(calls.verdict({ accurate: "fact_accurate" }, { person: "g1", question: "Q2" }, "uncertain")).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("the alert dial writes only the story's alerts path, with a ladder level", async () => {
    const { sent, calls } = recorder();
    await calls.setAlertLevel("dialog");
    expect(sent).toEqual([{ route: "/api/mod/var", body: { path: "Night.alerts", value: "dialog" } }]);
    await expect(calls.setAlertLevel("loud" as never)).rejects.toThrow();
    expect(sent).toHaveLength(1);
  });

  it("Announce broadcasts to everyone; 🔔 prefixes ! once", async () => {
    const { sent, calls } = recorder();
    await calls.announce("  Come to the Desktop. ", false);
    await calls.announce("Come to the Desktop.", true);
    await calls.announce("!Already loud", true);
    expect(sent.map((s) => s.body)).toEqual([
      { scope: "all", cue: "Come to the Desktop." },
      { scope: "all", cue: "!Come to the Desktop." },
      { scope: "all", cue: "!Already loud" },
    ]);
    expect(sent.every((s) => s.route === "/api/mod/broadcast")).toBe(true);
    expect(announceCue("hi", false)).toBe("hi");
  });

  it("answering as Trabolta says into the guest's own thread, never a bare dm:", async () => {
    const { sent, calls } = recorder();
    await calls.answerAs("Trabolta", "g7", " I hear you. ");
    expect(sent).toEqual([{ route: "/api/mod/say", body: { channel: "guest:g7", as: "Trabolta", text: "I hear you." } }]);
    expect(String(sent[0]!.body["channel"]).startsWith("dm:")).toBe(false);
  });

  it("release, bathroom, restrict, gone, pair, scan, wallet, King, terminals, codes, unlock", async () => {
    const { sent, calls } = recorder({ ok: true, name: "Ada", url: "http://x/?pair=1", expiresAt: 5, eventPass: "E", primePass: "P", modPass: "M", joinUrl: "http://x", claims: [{ character: "Excel", claim: "c", url: "u" }] });
    await calls.release("Norton");
    await calls.backFromBathroom("g1");
    await calls.restrict("g1", true);
    await calls.restrict("g1", false);
    await calls.gone("g1", true);
    const pair = await calls.pair("g1");
    await calls.scanAs("Norton", "g1");
    await calls.walletApprove("t1");
    await calls.walletDeny("t2");
    await calls.walletApproveHeld();
    await calls.walletUnfreeze("g3");
    await calls.walletStimulus(10);
    await calls.kingHp(15);
    await calls.tvMute(true);
    await calls.identify("Kitchen");
    const codes = await calls.codes();
    await calls.unlockClaim("Excel");
    expect(sent.map((s) => [s.route, s.body])).toEqual([
      ["/api/mod/prime/release", { character: "Norton" }],
      ["/api/mod/signal", { name: BACK_FROM_BATHROOM, subject: "g1" }],
      ["/api/mod/act", { id: "g1", action: "restrict" }],
      ["/api/mod/act", { id: "g1", action: "unrestrict" }],
      ["/api/mod/guest/gone", { id: "g1", gone: true }],
      ["/api/mod/guest/pair", { id: "g1" }],
      ["/api/mod/scan", { as: "Norton", target: "g1" }],
      ["/api/mod/wallet/approve", { id: "t1" }],
      ["/api/mod/wallet/deny", { id: "t2" }],
      ["/api/mod/wallet/approve-held", {}],
      ["/api/mod/wallet/unfreeze", { to: "g3" }],
      ["/api/mod/wallet/stimulus", { amount: 10 }],
      ["/api/mod/spatial/king", { hp: 15 }],
      ["/api/mod/screen/voice", { muted: true }],
      ["/api/mod/screen/identify", { name: "Kitchen" }],
      ["/api/mod/codes", {}],
      ["/api/mod/claim/unlock", { character: "Excel", minutes: 2 }],
    ]);
    expect(pair).toEqual({ name: "Ada", url: "http://x/?pair=1", expiresAt: 5 });
    // A host's codes never carry the mod passcode, even if a server sent one.
    expect(codes).toEqual({ eventPass: "E", primePass: "P", joinUrl: "http://x", claims: [{ character: "Excel", claim: "c", url: "u" }] });
    expect(Object.keys(codes)).not.toContain("modPass");
  });

  it("C2: the doors and a pause — start opens or resumes, stop pauses; nothing else of the lifecycle", async () => {
    const { sent, calls } = recorder();
    await calls.openDoors();
    await calls.pause();
    await calls.resume();
    expect(sent.map((s) => [s.route, s.body])).toEqual([
      ["/api/mod/start", {}],
      ["/api/mod/stop", {}],
      ["/api/mod/start", {}],
    ]);
    for (const never of ["/api/mod/reset", "/api/mod/load", "/api/mod/resync"]) expect(HOST_ROUTES as readonly string[]).not.toContain(never);
  });

  it("the join QR's link is the print sheet's: the base, then ?code=", () => {
    expect(joinLink({ joinUrl: "https://loom.example/", eventPass: "GST 1" })).toBe("https://loom.example/?code=GST%201");
    expect(joinLink({ joinUrl: "", eventPass: "G" }, "http://lan:7000")).toBe("http://lan:7000/?code=G");
  });

  it("a cue press carries presses and no label", () => {
    expect(cueSignal("award_best_liar", "g1", { value: 3 }, 12)).toEqual({ name: "award_best_liar", subject: "g1", args: { value: 3 }, presses: 12 });
    expect(cueSignal("start_bingo", null, null)).toEqual({ name: "start_bingo" });
  });
});

describe("the house desk's calls (wave 25, docs/loom-house-desk.md §2.1)", () => {
  it("GO carries the standby it showed; standby, stop, stop all, a mark", async () => {
    const { sent, calls } = recorder();
    await calls.deskGo("heart_reveal");
    await calls.deskGo("heart_reveal", "pre_show");
    await calls.deskStandby("pre_show");
    await calls.deskStandby(null);
    await calls.deskStop(7);
    await calls.deskStopAll();
    await calls.deskStopAll(true);
    await calls.deskMark("speaker:s1", "ok");
    await calls.deskMark("speaker:s1", "bad", "  crackles ");
    await calls.deskMark("speaker:s1", null);
    expect(sent.map((s) => [s.route, s.body])).toEqual([
      ["/api/mod/desk/go", { standby: "heart_reveal" }],
      ["/api/mod/desk/go", { standby: "heart_reveal", cue: "pre_show" }],
      ["/api/mod/desk/standby", { cue: "pre_show" }],
      ["/api/mod/desk/standby", { cue: null }],
      ["/api/mod/desk/stop", { run: 7 }],
      ["/api/mod/desk/stop", { all: true }],
      ["/api/mod/desk/stop", { all: true, announce: true }],
      ["/api/mod/desk/check", { key: "speaker:s1", mark: "ok" }],
      ["/api/mod/desk/check", { key: "speaker:s1", mark: "bad", note: "crackles" }],
      ["/api/mod/desk/check", { key: "speaker:s1", mark: null }],
    ]);
  });

  it("a check's test goes to its own route, and only to the three test routes", async () => {
    const { sent, calls } = recorder();
    await calls.deskTest({ route: "/api/mod/audio/test", body: { speaker: "s1" } });
    await calls.deskTest({ route: "/api/mod/audio/play", body: { sound: "modem" } });
    await calls.deskTest({ route: "/api/mod/lights/test", body: { fixture: "bulb", set: { state: "OFF" } } });
    await calls.audioPlay({ say: "Doors in five", chime: true });
    await calls.audioTest({ out: 3 });
    await calls.lightsTest({ look: "heart_wake" });
    await expect(calls.deskTest({ route: "/api/mod/reset" as never, body: {} })).rejects.toThrow();
    expect(sent.map((s) => s.route)).toEqual(["/api/mod/audio/test", "/api/mod/audio/play", "/api/mod/lights/test", "/api/mod/audio/play", "/api/mod/audio/test", "/api/mod/lights/test"]);
  });

  it("the desk is on the host lists exactly as the contract marks H; never a desk edit or Reset marks", () => {
    for (const r of ["/api/mod/desk/go", "/api/mod/desk/standby", "/api/mod/desk/stop", "/api/mod/desk/check", "/api/mod/audio/play", "/api/mod/audio/test", "/api/mod/lights/test"]) expect(HOST_ROUTES as readonly string[]).toContain(r);
    expect(HOST_READS as readonly string[]).toContain("/api/mod/desk");
    for (const never of ["/api/mod/desk", "/api/mod/desk/project", "/api/mod/desk/check/reset", "/api/mod/audio/report", "/api/mod/lights/pair"]) expect(HOST_ROUTES as readonly string[]).not.toContain(never);
  });
});

describe("the allowlist", () => {
  it("every call lands on a host route (and only POSTs)", async () => {
    const { sent, calls } = recorder();
    // Call every method once with plausible arguments.
    const args: Record<string, unknown[]> = {
      cue: ["x", null, null],
      verdict: [{ accurate: "a" }, { person: "p", question: "q" }, "accurate"],
      setAlertLevel: ["bsod"],
      announce: ["hi", true],
      answerAs: ["Trabolta", "g1", "hi"],
      unlockClaim: ["Excel"],
      setJudgeMode: ["review"],
      deskGo: ["heart_reveal"],
      deskMark: ["speaker:s1", "ok"],
      audioPlay: [{ sound: "modem" }],
      audioTest: [{ speaker: "s1" }],
      lightsTest: [{ look: "heart_wake" }],
      deskTest: [{ route: "/api/mod/audio/test", body: { speaker: "s1" } }],
    };
    for (const [name, fn] of Object.entries(calls)) {
      await (fn as (...a: unknown[]) => unknown)(...(args[name] ?? ["g1", true]));
    }
    expect(sent.length).toBeGreaterThanOrEqual(Object.keys(calls).length);
    for (const s of sent) expect(HOST_ROUTES).toContain(s.route);
  });

  it("the fetch post refuses a route off the list before it leaves the phone", async () => {
    let fetched = 0;
    const post = fetchHostPost({ token: "t", eventId: "default" }, (async () => {
      fetched++;
      return new Response("{}", { status: 200 });
    }) as typeof fetch);
    await expect(post("/api/mod/reset" as HostRoute, {})).rejects.toBeInstanceOf(ApiError);
    expect(fetched).toBe(0);
  });

  it("the fetch post sends the booth token to the event, and a 409 moved resolves", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const post = fetchHostPost({ token: "tok", eventId: "ev 1" }, (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ error: "the cues moved", moved: true }), { status: 409 });
    }) as unknown as typeof fetch);
    await expect(post("/api/mod/signal", { name: "x" })).resolves.toEqual({ moved: true });
    expect(seen[0]!.url).toBe("/e/ev%201/api/mod/signal");
    expect((seen[0]!.init.headers as Record<string, string>)["x-loom-token"]).toBe("tok");
    const refuse = fetchHostPost({ token: "tok", eventId: "e" }, (async () => new Response(JSON.stringify({ error: "not from a booth" }), { status: 403 })) as unknown as typeof fetch);
    await expect(refuse("/api/mod/var", {})).rejects.toMatchObject({ status: 403, message: "not from a booth" });
  });

  it("no host source names a moderator route off the allowlist", () => {
    // Lifecycle, the var table's free writes, the log, the Mind: never in Play (D5).
    const dir = new URL("../src/host/", import.meta.url);
    const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/u.test(f));
    // The GET reads too (the recap, the desk's long poll), without a query.
    const allowed = new Set<string>([...HOST_ROUTES, ...HOST_READS.filter((r) => r.startsWith("/api/mod/")).map((r) => r.split("?")[0]!)]);
    for (const f of files) {
      const src = readFileSync(new URL(f, dir), "utf8");
      for (const m of src.matchAll(/["'`](\/api\/(?:mod|agent)\/[a-z/-]+)/gu)) expect(allowed, `${f}: ${m[1]}`).toContain(m[1]);
      // Of the lifecycle only the doors and a pause (C2): `start` / `stop`.
      expect(src).not.toMatch(/\/api\/mod\/(reset|load|resync|log|metrics|set|agent|impersonate|message|beat|reveal)\b/u);
      expect(src).not.toMatch(/\/api\/(projects|mod\/event)\//u);
    }
  });
});

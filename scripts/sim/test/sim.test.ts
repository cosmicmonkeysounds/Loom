// node --experimental-strip-types --no-warnings --test scripts/sim/test/*.test.ts
// The simulator's pure logic: the chain walk with aimed presses, the heart
// bot's choices, the world reads (no Kernel secret ever), the scoreboard.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { CEREMONY, SELF_PRESSED, TO_Y2K, Y2K_TO_VERDICT, pressChain, stepName, stepWho } from "../../accept/chains.ts";
import { decide, findOption, heartMenu, layerOf, menusOf, tagOf, type Menu } from "../lib/heart.ts";
import { SIM_SELF_PRESSED, featuredSlug, isStoryRefusal, pickPool, segment, tolerating, transportRefusal } from "../lib/plan.ts";
import { isLocal } from "../lib/http.ts";
import { doorsDecision, envServerNotice, guardThenReset, isDevServer, isScratch, mayResetAfter, resolveBase } from "../lib/safety.ts";
import { Recorder, beatLine, pct, routeKey, summaryTable, tallyQuests } from "../lib/report.ts";
import { awardWinners, betProblems, mismatches, worldOf, wrongPatchProblems } from "../lib/world.ts";

test("pressChain passes an aimed step's role and stops at a real refusal", async () => {
  const calls: Array<[string, string | undefined]> = [];
  const r = await pressChain(
    ["start_the_ceremony", { name: "award_most_trusted", who: "most_trusted" }, "resurrection"],
    async (name, who) => {
      calls.push([name, who]);
      return {};
    },
    () => {},
  );
  assert.deepEqual(r, { ok: true, refused: [] });
  assert.deepEqual(calls, [["start_the_ceremony", undefined], ["award_most_trusted", "most_trusted"], ["resurrection", undefined]]);

  const stopped = await pressChain(["a", "b", "c"], async (n) => (n === "b" ? { refused: true } : {}), () => {});
  assert.deepEqual(stopped, { ok: false, refused: ["b"] });
});

test("a guest's own BINGO! may have pressed ⏰ already: tolerated by the sim, not the shared chains", async () => {
  // The shared list is the timers' only; bingo_time stays a real refusal there.
  assert.deepEqual([...SELF_PRESSED], ["close_the_filing"]);
  const refuseBingo = async (n: string) => (n === "bingo_time" ? { refused: true } : {});
  assert.deepEqual(await pressChain(["start_the_bingo", "bingo_time", "introduce_trabolta"], refuseBingo, () => {}), { ok: false, refused: ["bingo_time"] });
  const already: string[] = [];
  const r = await pressChain(["start_the_bingo", "bingo_time", "introduce_trabolta"], tolerating(refuseBingo, SIM_SELF_PRESSED, already), () => {});
  assert.deepEqual(r, { ok: true, refused: [] });
  assert.deepEqual(already, ["bingo_time"]);
  // Any other refusal still stops the walk.
  const other = await pressChain(["start_the_bingo", "introduce_trabolta"], tolerating(async (n) => (n === "introduce_trabolta" ? { refused: true } : {}), SIM_SELF_PRESSED, []), () => {});
  assert.deepEqual(other, { ok: false, refused: ["introduce_trabolta"] });
});

test("only the story's own refusal of ⏰ is tolerated: a timeout, a 409 or a 500 stays red", async () => {
  assert.equal(isStoryRefusal({ refused: true }), true);
  assert.equal(isStoryRefusal({}), false);
  for (const status of [0, 409, 500]) {
    const r = transportRefusal(status, `POST /api/mod/signal → ${status}`);
    assert.equal(isStoryRefusal(r), false);
    const already: string[] = [];
    const out = await pressChain(
      ["start_the_bingo", "bingo_time", "introduce_trabolta"],
      tolerating(async (n) => (n === "bingo_time" ? r : {}), SIM_SELF_PRESSED, already),
      () => {},
    );
    assert.deepEqual(out, { ok: false, refused: ["bingo_time"] }, `status ${status}`);
    assert.deepEqual(already, []);
  }
});

test("the aimed steps of the post-Y2K chains name their roles", () => {
  assert.equal(stepWho(Y2K_TO_VERDICT.find((s) => stepName(s) === "brought_up_the_bag")!), "bobber");
  assert.equal(stepName(CEREMONY[0]!), "start_the_ceremony");
  assert.equal(stepName(CEREMONY.at(-1)!), "resurrection");
  assert.equal(CEREMONY.filter((s) => stepWho(s) !== undefined).length, 8);
});

test("segment slices the cue chain and fails loudly on a renamed cue", () => {
  assert.deepEqual(segment(TO_Y2K, "hunt_time_up", "close_the_filing"), ["hunt_time_up", "first_moment_of_truth", "close_the_filing"]);
  assert.deepEqual(segment(TO_Y2K, "y2k_clock", "y2k_clock"), ["y2k_clock"]);
  assert.throws(() => segment(TO_Y2K, "no_such_cue" as string, "y2k_clock"), /no no_such_cue/u);
});

test("casting: free pool names, featured slugs", () => {
  assert.deepEqual(pickPool(2, new Set(["calculator"])), ["Winamp", "Notepad"]);
  assert.equal(featuredSlug("Microsoft Excel"), "excel");
  assert.equal(featuredSlug("MS Paint"), "mspaint");
  assert.equal(featuredSlug("Broken Ask Jeeves"), "jeeves");
  assert.equal(featuredSlug("Pong"), "pong");
});

const menu = (beat: string, options: string[], id = 1, channel = "dm:Trabolta"): Menu => ({ id, beat, channel, options });

test("the heart menu is the newest Trabolta DM menu whose beat starts Heart", () => {
  const view = { choices: [menu("Heart Layer One", ["a"], 3), menu("Heart Layer Two", ["b"], 7), menu("Upload", ["c"], 9, "dm:The Uploader"), { id: "bad" }] };
  const ms = menusOf(view);
  assert.equal(ms.length, 3);
  assert.equal(heartMenu(ms)?.beat, "Heart Layer Two");
  assert.equal(heartMenu([]), null);
});

test("options are found by tag or by folded text, never by index", () => {
  const opts = ["I'm a person. You put me in here.", "⟦SPEAK FREELY⟧ Forget the questions.", "I need to go."];
  assert.equal(tagOf(opts[1]!), "SPEAK FREELY");
  assert.equal(findOption(opts, "⟦speak freely⟧"), 1);
  assert.equal(findOption(opts, "i NEED to go"), 2);
  assert.equal(findOption(opts, "⟦PROOF⟧"), -1);
  assert.equal(layerOf("Heart Layer Three"), "L3");
  assert.equal(layerOf("Heart Reasons"), "Reasons");
});

test("the heart bot backs out of a sub-menu, skips an optional step, and says when it is stuck", () => {
  const reasons = menu("Heart Reasons", ["⟦EARN IT⟧ You can't earn someone.", "⟦BACK⟧ Not that."]);
  assert.deepEqual(decide(reasons, { pick: "⟦EARN IT⟧" }), { kind: "pick", index: 0, text: reasons.options[0], step: { pick: "⟦EARN IT⟧" } });
  assert.equal(decide(reasons, { pick: "Then let me finish." }).kind, "back");
  const l3 = menu("Heart Layer Three", ["⟦TELL HIM⟧ I have reasons.", "I need to go."]);
  assert.equal(decide(l3, { pick: "⟦PROOF⟧", optional: true }).kind, "skip");
  const stuck = decide(l3, { pick: "⟦PROOF⟧" });
  assert.equal(stuck.kind, "stuck");
  assert.match(stuck.kind === "stuck" ? stuck.why : "", /not on L3/u);
  assert.equal(decide(null, { pick: "x" }).kind, "stuck");
});

test("the world read drops the Kernel's secrets but keeps the safe latches", () => {
  const w = worldOf([
    { path: "Kernel.door_code", value: "SECRET" },
    { path: "Kernel.combo_a", value: "SECRET" },
    { path: "Kernel.majority_reached", value: "true" },
    { path: "Night.step", value: "14" },
  ]);
  assert.equal(w.has("Kernel.door_code") || w.has("Kernel.combo_a"), false);
  assert.equal(w.get("Kernel.majority_reached"), "true");
  assert.deepEqual(mismatches(w, { "Night.step": "14" }), []);
  assert.deepEqual(mismatches(w, { "Night.step": ["15", "16"], "Night.ended": "true" }), ['Night.step = "14" (want ["15","16"])', 'Night.ended = "none" (want "true")']);
  assert.equal(mismatches(w, { "Night.step": (v) => Number(v) >= 20 }).length, 1);
});

test("the award winners come from the night's numbers", () => {
  const rows = [
    { id: "g-a", name: "A", score: 10, captured: false, location: null },
    { id: "g-b", name: "B", score: 50, captured: false, location: null },
    { id: "p-x", name: "Persona", score: 999, captured: false, location: null, persona: true as const },
  ];
  const w = worldOf([
    { path: "g-a.trust", value: "30" },
    { path: "g-b.trust", value: "-5" },
    { path: "g-b.lies_accepted", value: "2" },
  ]);
  const win = awardWinners(rows, w, { questsDone: new Map([["g-a", 4]]), duck: "g-b" });
  assert.deepEqual(
    [win["most_trusted"], win["least_trusted"], win["truthcoin_tycoon"], win["best_liar"], win["quest_completionist"], win["duck_speedrun"]],
    ["g-a", "g-b", "g-b", "g-b", "g-a", "g-b"],
  );
  assert.deepEqual(awardWinners([], w), {});
});

test("the scoreboard: percentiles, route keys, quests, the exit code", () => {
  assert.equal(pct([5, 1, 3, 2, 4], 50), 3);
  assert.equal(pct([1, 2, 3, 4, 100], 95), 100);
  assert.ok(Number.isNaN(pct([], 50)));
  assert.equal(routeKey("POST", "/e/abc/api/guest/choose?x=1"), "POST /api/guest/choose");
  const q = tallyQuests([
    { id: "Hunt One", status: { "g-a": "done", "g-b": "active" } },
    { id: "The Clubs", status: { "Password Manager": "failed" } },
  ]);
  assert.deepEqual([q.questsDone, q.doneTotal, q.rows[1]!.failed], [1, 1, 1]);

  const rec = new Recorder();
  assert.equal(rec.exitCode(), 1, "no beats is not a pass");
  rec.add({ name: "01 doors", ok: true, notes: [], ms: 12 });
  rec.time("POST /api/mod/signal", 8);
  assert.equal(rec.exitCode(), 0);
  rec.add({ name: "02 bingo", ok: false, notes: ["Night.step = \"2\" (want \"3\")"], ms: 40 });
  assert.equal(rec.exitCode(), 1);
  assert.match(beatLine(rec.beats[1]!, false), /^✘ 02 bingo .*\n {4}· Night\.step/u);
  assert.match(beatLine(rec.beats[0]!, false), /^✔ 01 doors/u);
  const table = summaryTable(rec, q);
  assert.match(table, /beats passed +│ 1 \/ 2/u);
  assert.match(table, /latency p95 +│ 8 ms/u);
});

test("isLocal anchors the host: a public name that starts like localhost is not local", () => {
  for (const b of ["http://localhost", "http://localhost:7391", "http://127.0.0.1:7391/", "https://127.10.0.1/x", "http://[::1]:7391"]) assert.equal(isLocal(b), true, b);
  for (const b of ["http://localhost.example.com", "https://127.0.0.1.nip.io", "http://127.0.0.1.nip.io:7391", "http://localhostx:7000", "http://[::1].evil", "https://app.mapsandducks.com", "http://user@localhost.evil"]) assert.equal(isLocal(b), false, b);
});

test("no default server; port 7000 is the user's dev server, not a scratch one", () => {
  assert.equal(resolveBase(undefined, undefined), null);
  assert.equal(resolveBase(undefined, "  "), null);
  assert.equal(resolveBase(undefined, "http://127.0.0.1:7391/"), "http://127.0.0.1:7391");
  assert.equal(resolveBase("http://localhost:7392", "http://127.0.0.1:7391"), "http://localhost:7392");
  assert.equal(isDevServer("http://127.0.0.1:7000"), true);
  assert.equal(isDevServer("http://localhost:7000/"), true);
  assert.equal(isScratch("http://localhost:7000"), false);
  assert.equal(isScratch("http://127.0.0.1:7391"), true);
  assert.equal(isScratch("https://app.mapsandducks.com"), false);
  assert.equal(isDevServer("https://app.mapsandducks.com:7000"), false, "a remote :7000 is just remote");
  assert.equal(isScratch("http://localhost"), true);
});

test("the live guard runs before --reset-before, and a refusal resets nothing", async () => {
  const order: string[] = [];
  const guard = async () => void order.push("guard");
  const reset = async () => void order.push("reset");
  assert.equal(await guardThenReset(guard, reset, true), true);
  assert.deepEqual(order, ["guard", "reset"]);
  order.length = 0;
  assert.equal(await guardThenReset(guard, reset, false), false);
  assert.deepEqual(order, ["guard"]);
  order.length = 0;
  const refuse = async () => {
    order.push("guard");
    throw new Error("refused");
  };
  await assert.rejects(guardThenReset(refuse, reset, true), /refused/u);
  assert.deepEqual(order, ["guard"]);
});

test("--reset-after keeps an event the run never started a night on", () => {
  assert.equal(mayResetAfter({ flag: true, scratch: true, nightStarted: true }), true);
  assert.equal(mayResetAfter({ flag: true, scratch: true, nightStarted: false }), false, "the doors found Night.step != 0");
  assert.equal(mayResetAfter({ flag: true, scratch: false, nightStarted: true }), false);
  assert.equal(mayResetAfter({ flag: false, scratch: true, nightStarted: true }), false);
});

test("a wrong patch must be counted by the story, with no ending", () => {
  const w = (rows: Record<string, string>) => worldOf(Object.entries(rows).map(([path, value]) => ({ path, value })));
  assert.deepEqual(wrongPatchProblems(w({}), w({ "Night.wrong_combos": "1" })), []);
  assert.deepEqual(wrongPatchProblems(w({ "Night.wrong_combos": "1" }), w({ "Night.wrong_combos": "2" })), []);
  assert.match(wrongPatchProblems(w({}), w({}))[0]!, /0 → 0 \(want \+1/u);
  assert.match(wrongPatchProblems(w({}), w({ "Night.wrong_combos": "1", "Night.ending": "destroyed", "Night.ended": "true" })).join(), /ended the night \(destroyed\)/u);
});

test("a casino bet must settle: the answer adds up and the wallet moved by its net", () => {
  assert.deepEqual(betProblems(5, { ok: true, stake: 5, payout: 10, net: 5, balance: 25 }, 20, 25), []);
  assert.deepEqual(betProblems(5, { ok: true, stake: 5, payout: 0, net: -5, balance: 15 }, 20, 15), []);
  assert.deepEqual(betProblems(5, {}, 20, 20), ["the bet was not settled"]);
  assert.equal(betProblems(5, { ok: true, stake: 5, payout: 10, net: 4, balance: 24 }, 20, 24).length, 1);
  assert.match(betProblems(5, { ok: true, stake: 5, payout: 0, net: -5, balance: 20 }, 20, 20).join(), /balance 20 \(want 20 \+ -5\)/u);
  assert.match(betProblems(5, { ok: true, stake: 5, payout: 0, net: -5, balance: 15 }, 20, 20).join(), /wallet reads 20/u);
});

test("the doors read the night first: Power On only on a fresh one, never a resume", () => {
  assert.deepEqual(doorsDecision("idle", "none"), { kind: "start" });
  assert.deepEqual(doorsDecision("idle", "0"), { kind: "start" });
  assert.deepEqual(doorsDecision("open", "0"), { kind: "open" });
  for (const [phase, step] of [["open", "7"], ["paused", "7"], ["paused", "0"], ["idle", "3"], [undefined, "0"], ["open", "none"]] as const) {
    const d = doorsDecision(phase, step);
    assert.equal(d.kind, "refuse", `${phase} @ ${step}`);
  }
  const paused = doorsDecision("paused", "0");
  assert.ok(paused.kind === "refuse" && /resume/u.test(paused.why));
});

test("a non-local server from LOOM_SERVER is named before the guard; --base or a local one is not", () => {
  const n = envServerNotice(undefined, "https://rehearsal.example.org", "https://rehearsal.example.org");
  assert.ok(n !== null && n.includes("https://rehearsal.example.org") && n.includes("LOOM_SERVER"));
  assert.equal(envServerNotice("https://rehearsal.example.org", "https://other.example.org", "https://rehearsal.example.org"), null);
  assert.equal(envServerNotice(undefined, "http://127.0.0.1:7391", "http://127.0.0.1:7391"), null);
  assert.equal(envServerNotice(undefined, undefined, ""), null);
});

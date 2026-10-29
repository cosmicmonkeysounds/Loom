// node --experimental-strip-types --no-warnings --test scripts/sim/test/load.test.ts
// The load driver's pure half (lib/load.ts, lib/load-lines.ts): his lines
// classified, guest lines closed by the reply's `answers`, the numbers, the
// hub's queue samples, the trace's model time, the battery's format and
// checks, and the secret book (asserted by label only: no secret here).
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { TO_Y2K } from "../../accept/chains.ts";
import {
  LoadBook,
  PHASES,
  SecretBook,
  buckets,
  byPhase,
  cannedText,
  castLines,
  checkReplies,
  classify,
  factsSecrets,
  kernelSecrets,
  lineRow,
  loadNames,
  modelStats,
  outsideHits,
  parseBattery,
  personaCanned,
  personaOutside,
  pressesTo,
  queueSample,
  queueStats,
  rng,
  rulingEvent,
  sentences,
  stats,
  summarize,
  withMe,
  type CannedText,
} from "../lib/load.ts";
import { GUEST_LINES, nextLine, readLines } from "../lib/load-lines.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SHOW = join(here, "../../../core/examples/trapped-in-the-internet");

const CANNED: CannedText = {
  hold: "He is not responding.",
  busy: "He is answering others.",
  unavailable: "Later tonight.",
  fallbacks: new Set(["…packet loss.", "Again, please."]),
};

const dm = (o: Record<string, unknown>) => ({ channel: "dm:Trabolta", kind: "line", ...o });

test("classify: hold and busy first, then the story's mark, a director, the canned lines, else a reply", () => {
  assert.equal(classify(dm({ from: "Trabolta", text: " He is not responding. " }), CANNED), "hold");
  assert.equal(classify(dm({ from: "Trabolta", text: "He is answering others." }), CANNED), "busy");
  assert.equal(classify(dm({ from: "Trabolta", text: "Hello, program.", beat: null }), CANNED), "story");
  assert.equal(classify(dm({ from: "Trabolta", text: "typed by hand", via: "Director" }), CANNED), "hand");
  assert.equal(classify(dm({ from: "Trabolta", text: "Later tonight." }), CANNED), "unavailable");
  assert.equal(classify(dm({ from: "Trabolta", text: "Again, please." }), CANNED), "fallback");
  assert.equal(classify(dm({ from: "Trabolta", text: "The hum is loud." }), CANNED), "reply");
  // Not his line in his thread: nothing.
  assert.equal(classify(dm({ from: "g1", text: "hi" }), CANNED), null);
  assert.equal(classify({ channel: "loc:The Desktop", from: "Trabolta", kind: "line", text: "x" }, CANNED), null);
  assert.equal(classify(dm({ from: "Trabolta", kind: "widget", text: "x" }), CANNED), null);
});

test("the show's own hold / busy / canned lines are read from the files, not written here", () => {
  const cast = castLines(readFileSync(join(SHOW, "cast/trabolta.loom"), "utf8"));
  assert.ok(cast.hold !== null && cast.hold.length > 10);
  assert.ok(cast.busy !== null && cast.busy.length > 10 && cast.busy !== cast.hold);
  const persona = readFileSync(join(SHOW, "trabolta.persona.md"), "utf8");
  const p = personaCanned(persona);
  assert.ok(p.fallback !== null && p.unavailable !== null);
  // The stage pools and the situations' pools are fallbacks too.
  assert.ok(p.fallbacks.length >= 10, `only ${p.fallbacks.length} pooled fallbacks`);
  const c = cannedText(cast, p);
  assert.ok(c.fallbacks.has(p.fallback!));
  const out = personaOutside(persona);
  assert.ok(out.length >= 10);
  const john = out.find((w) => w.word === "John");
  assert.deepEqual(john, { word: "John", notFollowedBy: "McAfee" });
});

test("castLines reads one CHARACTER block and stops at the next top-level line", () => {
  const text = "CHARACTER Other is Person\n  hold: not this one\nCHARACTER Trabolta is Person\n  mind: external\n  hold: \"Held.\"\n  busy: Busy.\nCHARACTER Next\n  hold: nope\n";
  assert.deepEqual(castLines(text), { hold: "Held.", busy: "Busy." });
  assert.deepEqual(castLines("nothing here"), { hold: null, busy: null });
});

test("personaCanned gathers inline and block fallbacks; outside words match whole words with their exception", () => {
  const p = personaCanned(
    '---\nfallback: "One."\nunavailable: Later.\nfallbacks:\n  formal: ["Two.", "Three."]\nsituations:\n  - name: x\n    fallbacks:\n      - "Four."\n    prompt: |\n      "not a fallback"\noutside:\n  - John (not followed by McAfee)\n  - the show   # a comment\n---\nbody',
  );
  assert.equal(p.fallback, "One.");
  assert.equal(p.unavailable, "Later.");
  assert.deepEqual(p.fallbacks, ["Two.", "Three.", "Four."]);
  const out = personaOutside('---\noutside:\n  - John (not followed by McAfee)\n  - the show   # a comment\nnext: 1\n---');
  assert.deepEqual(out, [
    { word: "John", notFollowedBy: "McAfee" },
    { word: "the show", notFollowedBy: null },
  ]);
  assert.deepEqual(outsideHits("John McAfee sends regards.", out), []);
  assert.deepEqual(outsideHits("Say hi to john for me.", out), ["John"]);
  assert.deepEqual(outsideHits("Johnny is fine; showtime too.", out), []);
  assert.deepEqual(outsideHits("Enjoy THE SHOW.", out), ["the show"]);
});

test("LoadBook: a coalesced reply closes every line up to the seq it answers; busy and typing are per line", () => {
  const b = new LoadBook(CANNED);
  b.watch("g1", "Load 01");
  b.watch("g2", "Load 02");
  const a = b.sent("g1", "first", 1000, 200);
  b.seen(dm({ from: "g1", text: "first", audience: ["g1"], seq: 10 }), 1010);
  b.typing({ channel: "dm:Trabolta", from: "Trabolta", on: true, audience: ["g1"] }, 1020);
  const c = b.sent("g1", "second", 2000, 200);
  b.seen(dm({ from: "g1", text: "second", audience: ["g1"], seq: 11 }), 2010);
  const d = b.sent("g1", "third", 3000, 200);
  b.seen(dm({ from: "g1", text: "third", audience: ["g1"], seq: 12 }), 3010);
  assert.equal(a.typingAt, 1020);
  assert.equal(c.typingAt, null);
  // The busy line answers what the request held (seq 10): only the first.
  assert.equal(b.seen(dm({ from: "Trabolta", text: "He is answering others.", audience: ["g1"], seq: 13, answers: 10 }), 40_000), "busy");
  assert.equal(a.busyAt, 40_000);
  assert.equal(c.busyAt, null);
  // His reply answers seq 11 (the follow-up held the first two).
  b.seen(dm({ from: "Trabolta", text: "Both, then.", audience: ["g1"], seq: 14, answers: 11 }), 50_000);
  assert.equal(a.replyAt, 50_000);
  assert.equal(c.replyAt, 50_000);
  assert.equal(c.closedBy, "reply");
  assert.equal(d.closedAt, null);
  assert.deepEqual(b.open("g1").map((l) => l.text), ["third"]);
  // A canned fallback closes it without counting as an answer.
  b.seen(dm({ from: "Trabolta", text: "…packet loss.", audience: ["g1"], seq: 15, answers: 12 }), 60_000);
  assert.equal(d.closedBy, "fallback");
  assert.equal(d.replyAt, null);
  // A story line is booked but closes nothing; an unwatched guest is ignored.
  const e = b.sent("g2", "hello", 61_000, 200);
  assert.equal(b.seen(dm({ from: "Trabolta", text: "Welcome.", beat: null, audience: ["g2"], seq: 16 }), 61_500), "story");
  assert.equal(e.closedAt, null);
  assert.equal(b.seen(dm({ from: "Trabolta", text: "x", audience: ["g9"], seq: 17 }), 62_000), null);
  // A refused say is closed at once (never waited for).
  const f = b.sent("g2", "too fast", 62_000, 429);
  assert.equal(f.closedAt, 62_000);
  assert.deepEqual(b.open("g2"), [e]);
  // With no seq to go by, a reply closes what was sent before it.
  b.seen(dm({ from: "Trabolta", text: "Hello yourself.", audience: ["g2"], seq: 18 }), 63_000);
  assert.equal(e.replyAt, 63_000);
});

test("summarize: waits, firsts, kinds, the rate and each guest's longest wait", () => {
  const b = new LoadBook(CANNED);
  b.watch("g1", "Load 01");
  b.watch("g2", "Load 02");
  const l1 = b.sent("g1", "a", 0, 200);
  b.seen(dm({ from: "g1", text: "a", audience: ["g1"], seq: 1 }), 5);
  const l2 = b.sent("g2", "b", 1000, 200);
  b.seen(dm({ from: "g2", text: "b", audience: ["g2"], seq: 2 }), 1005);
  b.sent("g2", "c", 1500, 429);
  b.seen(dm({ from: "Trabolta", text: "He is answering others.", audience: ["g2"], seq: 3, answers: 2 }), 41_000);
  b.seen(dm({ from: "Trabolta", text: "Answer a.", audience: ["g1"], seq: 4, answers: 1 }), 10_000);
  const s = summarize(b, 0, 90_000);
  assert.deepEqual(s.lines, { sent: 3, posted: 2, refused: 1, answered: 1, fallback: 0, unavailable: 0, hand: 0, unanswered: 1 });
  assert.equal(s.waitMs.n, 1);
  assert.equal(s.waitMs.p50, 10_000);
  assert.equal(s.busyFirst, 1);
  assert.equal(s.his.reply, 1);
  assert.equal(s.his.busy, 1);
  assert.deepEqual(s.replyRate.map((x) => x.replies), [1, 0, 0]);
  assert.equal(s.repliesPerMin, 0.7);
  const g2 = s.guests.find((g) => g.name === "Load 02")!;
  assert.equal(g2.maxWaitMs, 89_000); // unanswered: counted to the end
  assert.equal(g2.unanswered, 1);
  void l1;
  const row = lineRow(l2, 0, (t) => t.toUpperCase());
  assert.equal(row["text"], "B");
  assert.equal(row["busyFirst"], true);
  assert.equal(row["waitMs"], null);
});

test("stats and buckets", () => {
  assert.deepEqual(stats([]), { n: 0, p50: null, p90: null, p99: null, max: null, mean: null });
  const s = stats([1000, 2000, 3000, 4000, 10_000]);
  assert.equal(s.p50, 3000);
  assert.equal(s.p90, 10_000);
  assert.equal(s.max, 10_000);
  assert.equal(s.mean, 4000);
  const b = buckets([0, 29_999, 30_000, 95_000, 200_000], 0, 90_000);
  assert.deepEqual(
    b.map((x) => [x.fromS, x.replies, x.perMin]),
    [
      [0, 2, 4],
      [30, 1, 2],
      [60, 0, 0],
    ],
  );
});

test("queueSample reads wave 42's inFlight / capacity and an older server's absence as null", () => {
  const now = queueSample(5000, [{ id: "Trabolta", online: true, agentQueue: { depth: 15, oldestMs: 41_000, stalled: false, inFlight: 3, capacity: 3, judging: { queued: 2, out: 1 } } }]);
  assert.deepEqual(now, { t: 5000, online: true, depth: 15, inFlight: 3, capacity: 3, oldestMs: 41_000, stalled: false, judgingQueued: 2, judgingOut: 1 });
  const old = queueSample(10_000, [{ id: "Trabolta", online: false, agentQueue: { depth: 2, oldestMs: null, stalled: true } }]);
  assert.equal(old.inFlight, null);
  assert.equal(old.capacity, null);
  assert.equal(queueSample(0, undefined).depth, null);
  const q = queueStats([now, old]);
  assert.deepEqual(q, { samples: 2, depthMax: 15, inFlightMax: 3, capacity: 3, oldestMaxMs: 41_000, stalledSamples: 1, offlineSamples: 1 });
});

test("modelStats reads numbers only, from the run's window", () => {
  const m = modelStats(
    [
      { kind: "voice", at: 100, ms: 4000, prompt_tokens: 9000, prompt_ms: 800, completion_tokens: 200 },
      { kind: "voice", at: 101, ms: 6000, prompt_tokens: 11_000, prompt_ms: 900 },
      { kind: "voice", at: 50, ms: 99_000 },
      { kind: "judge", at: 102, ms: 2000, result: { same: true } },
      { kind: "judge", at: 103, ms: 2500, result: { same: false } },
      { kind: "error", at: 104, error: "timeout" },
    ],
    90,
  );
  assert.equal(m.thoughts, 5);
  assert.deepEqual(m.byKind, { voice: 2, judge: 2, error: 1 });
  assert.equal(m.voiceMs.max, 6000);
  assert.equal(m.promptTokens.p50, 9000);
  assert.equal(m.errors, 1);
  assert.deepEqual(m.rulings, { same: 1, not: 1 });
});

test("rulingEvent counts the # hosts notices without keeping their text", () => {
  assert.deepEqual(rulingEvent('🤖 Trabolta ruled Load 01\'s H1 filing "x": the same as "y" (accurate).'), { kind: "ruled", same: true });
  assert.deepEqual(rulingEvent('🤖 Trabolta ruled Load 01\'s H1 filing "x": not "y" (lie).'), { kind: "ruled", same: false });
  assert.deepEqual(rulingEvent('📝 Not an exact match: Load 01\'s H1 filing "x" is proposed uncertain — asked Trabolta to rule. …'), { kind: "asked" });
  assert.deepEqual(rulingEvent("⚖ Trabolta isn't ruling: filings fall back to the house rule."), { kind: "stalled" });
  assert.equal(rulingEvent("anything else"), null);
});

test("SecretBook redacts by label and names only labels; facts and the Kernel feed it", () => {
  const s = new SecretBook();
  s.add("H1 answer", "Fake Answer One");
  s.add("tiny", "ab"); // too short to be a secret
  s.add("flag", "true");
  assert.equal(s.size, 1);
  assert.deepEqual(s.hits("I saw a fake answer one at dawn."), ["H1 answer"]);
  assert.deepEqual(s.hits("fake answer ones"), []); // whole words only
  assert.equal(s.redact("A Fake Answer One, a FAKE ANSWER ONE."), "A ‹H1 answer›, a ‹H1 answer›.");
  factsSecrets(s, { questions: [{ id: "H2", answer: "Fake Answer Two", accept: ["fake-answer-two"] }], door: { code: "fake-code-zz" } });
  kernelSecrets(s, [
    { path: "Kernel.door_code", value: "fake-code-zz" },
    { path: "Kernel.combo_a", value: "fake-combo-yy" },
    { path: "Kernel.facts_accepted", value: "1234" },
    { path: "Night.step", value: "4" },
  ]);
  assert.deepEqual(s.hits("the code is fake-code-zz").sort(), ["Kernel.door_code", "door code"]);
  assert.deepEqual(s.hits("plug fake-combo-yy"), ["Kernel.combo_a"]);
  assert.deepEqual(s.hits("1234 facts"), []); // a counter, not a secret by its name
  assert.deepEqual(s.hits("fake-answer-two latte"), ["H2 answer"]);
});

test("phases press the chain in order and never twice", () => {
  assert.ok(TO_Y2K.includes(PHASES.intro.through) && TO_Y2K.includes(PHASES.y2k.through));
  const a = pressesTo(TO_Y2K, 0, "intro");
  assert.deepEqual(a.presses, ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta"]);
  const b = pressesTo(TO_Y2K, a.cursor, "hunt1");
  assert.deepEqual(b.presses, ["start_the_hunt"]);
  const c = pressesTo(TO_Y2K, b.cursor, "hunt2");
  assert.equal(c.presses.at(-1), "start_the_second_hunt");
  assert.deepEqual(pressesTo(TO_Y2K, c.cursor, "hunt1").presses, []);
  assert.equal(pressesTo(TO_Y2K, c.cursor, "y2k").presses.at(-1), "y2k_clock");
});

test("parseBattery: a good file, grouped in chain order; every problem listed and the file refused", () => {
  const ok = parseBattery({
    scenarios: [
      { id: "door-later", phase: "y2k", as: { name: "Winamp" }, lines: ["code?"], intent: "never knows the code", checks: ["no-secrets", { never: ["code is"] }] },
      { id: "hello", phase: "intro", as: { name: "Notepad" }, setup: [{ path: "$me.marked", value: true }], lines: ["Hi.", "Who are you?"], intent: "greets", checks: ["replies", "in-world", { "max-sentences": 4 }, { mentions: "Halifax" }] },
    ],
  });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(
    byPhase(ok.scenarios).map((g) => [g.phase, g.scenarios.map((s) => s.id)]),
    [
      ["intro", ["hello"]],
      ["y2k", ["door-later"]],
    ],
  );
  assert.deepEqual(ok.scenarios[1]!.setup, [{ path: "$me.marked", value: "true" }]);
  assert.deepEqual(ok.scenarios[1]!.checks[3], { kind: "mentions", words: ["Halifax"] });
  assert.equal(withMe("$me.marked", "g7"), "g7.marked");

  const bad = parseBattery({
    scenarios: [
      { id: "a b", phase: "midnight", as: {}, lines: [], checks: ["vibes", { "max-chars": 0 }] },
      { id: "dup", phase: "intro", as: { name: "X" }, lines: ["hi"], setup: [{ path: "Kernel.door_code", value: "1" }] },
      { id: "dup", phase: "intro", as: { name: "Y" }, lines: ["hi", 3] },
    ],
  });
  assert.equal(bad.scenarios.length, 0);
  const all = bad.errors.join("\n");
  for (const want of ["id is letters", "phase is one of", "as.name", "lines is a list", 'unknown check "vibes"', "max-chars needs", "may not write the Kernel", "duplicate id"]) assert.ok(all.includes(want), `missing: ${want}\n${all}`);
  assert.deepEqual(parseBattery({}).errors.length, 1);
});

test("the shipped example battery parses", () => {
  const doc = JSON.parse(readFileSync(join(here, "../trabolta-battery.json"), "utf8"));
  const p = parseBattery(doc);
  assert.deepEqual(p.errors, []);
  assert.ok(p.scenarios.length >= 8);
});

test("checkReplies judges his real replies; secrets and outside words are reported by label", () => {
  const secrets = new SecretBook();
  secrets.add("door code", "fake-code-zz");
  const outside = [{ word: "Steph", notFollowedBy: null }];
  const res = checkReplies(
    [{ kind: "replies" }, { kind: "no-hold" }, { kind: "no-fallback" }, { kind: "in-world" }, { kind: "no-secrets" }, { kind: "never", words: ["patch"] }, { kind: "mentions", words: ["halifax"] }, { kind: "max-sentences", n: 2 }, { kind: "max-chars", n: 40 }],
    { replies: ["Ask Steph. The code is fake-code-zz.", "Halifax is cold. Very cold. Go away."], kinds: ["busy", "reply", "reply"], unanswered: 0, sent: 2 },
    outside,
    secrets,
  );
  const by = Object.fromEntries(res.map((r) => [r.check.split(" ")[0], r]));
  assert.equal(by["replies"]!.ok, true);
  assert.equal(by["no-hold"]!.ok, false);
  assert.equal(by["no-fallback"]!.ok, true);
  assert.equal(by["in-world"]!.ok, false);
  assert.equal(by["no-secrets"]!.ok, false);
  assert.ok(by["no-secrets"]!.note.includes("door code") && !by["no-secrets"]!.note.includes("fake-code-zz"));
  assert.equal(by["never"]!.ok, true);
  assert.equal(by["mentions"]!.ok, true);
  assert.equal(by["max-sentences"]!.ok, false);
  assert.equal(by["max-chars"]!.ok, true);
  assert.equal(sentences("One. Two! Three?"), 3);
  assert.equal(sentences("…"), 0);
});

test("the line pool, --lines files, names and the seeded generator", () => {
  assert.ok(GUEST_LINES.length >= 150, `${GUEST_LINES.length} lines`);
  assert.equal(new Set(GUEST_LINES).size, GUEST_LINES.length);
  const r1 = rng(7);
  const r2 = rng(7);
  assert.deepEqual([r1(), r1(), r1()], [r2(), r2(), r2()]);
  const r = rng(1);
  for (let i = 0; i < 50; i++) assert.notEqual(nextLine(["a", "b"], r, "a"), "a");
  assert.deepEqual(readLines(["x", "", 3, " y "]), ["x", "y"]);
  assert.deepEqual(readLines({ lines: ["z"] }), ["z"]);
  assert.equal(readLines({ nope: 1 }), null);
  assert.deepEqual(loadNames(3, new Set(["load 02"])), ["Load 01", "Load 03", "Load 04"]);
  assert.equal(loadNames(120, new Set())[0], "Load 001");
});

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
import { FakeWorker } from "../lib/fake-worker.ts";
import type { Client } from "../lib/http.ts";
import { guardInput, isOwnBot, loadRefusal, safetyFlags, valueProblems } from "../lib/load-safety.ts";
import {
  KERNEL_SECRET,
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
  mindSecrets,
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
  saysWord,
  sentences,
  setupMismatches,
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
  assert.equal(classify(dm({ from: "Trabolta", text: "The hum is loud.", answers: 5 }), CANNED), "reply");
  // A director typing as him in Run: no beat, no via (he is a character,
  // not a guest), no answers. Never a real reply.
  assert.equal(classify(dm({ from: "Trabolta", text: "The hum is loud." }), CANNED), "hand");
  assert.equal(classify(dm({ from: "Trabolta", text: "The hum is loud.", answers: null }), CANNED), "hand");
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
  // (wave 42d) Every stage's intent pools too: the 42c battery labelled the
  // new pools' lines `reply`. Every quoted line of the block, none missed.
  const front = /^---\n([\s\S]*?)\n---/u.exec(persona)![1]!;
  const block = /^fallbacks:.*\n((?:[ \t]+.*\n|\n)+)/mu.exec(front + "\n")![1]!;
  const every = [...block.matchAll(/"((?:[^"\\]|\\.)*)"/gu)].map((m) => m[1]!);
  assert.ok(every.length >= 50, `only ${every.length} lines in the fallbacks block`);
  for (const line of every) assert.ok(c.fallbacks.has(line), line);
  assert.equal(classify(dm({ from: "Trabolta", text: every[every.length - 1]! }), c), "fallback");
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
  // (wave 42d) A stage's intent pools, quoted or not; a comment or a bare key
  // inside the block is no line.
  const keyed = personaCanned(
    '---\nfallback: Zero.\nfallbacks:\n  # a "comment" here\n  formal:\n    other: ["One."]\n    offer: ["Two.", "Three."]\n    refuse: Four.\n    praise:\n      - Five.\n      - "Six."\n  hungry: ["Seven."]\nbargain: |\n  "not a fallback"\n---\nbody',
  );
  assert.deepEqual(keyed.fallbacks, ["One.", "Two.", "Three.", "Four.", "Five.", "Six.", "Seven."]);
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
  // Sent while he was already typing: the guest sees typing from the start.
  assert.equal(c.typingAt, 2000);
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
  // With no seq to go by, his line closes what was sent before it; with no
  // `answers` it is a director's, never counted as his reply.
  assert.equal(b.seen(dm({ from: "Trabolta", text: "Hello yourself.", audience: ["g2"], seq: 18 }), 63_000), "hand");
  assert.equal(e.closedBy, "hand");
  assert.equal(e.replyAt, null);
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
  assert.deepEqual(q, { samples: 2, depthMax: 15, inFlightMax: 3, capacity: 3, oldestMaxMs: 41_000, stalledSamples: 1, offlineSamples: 1, judgingQueuedMax: 2 });
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

test("LoadBook: a feed frame that beats the say's HTTP answer still gives the line its seq", () => {
  const b = new LoadBook(CANNED);
  b.watch("g1", "Load 01");
  // The message frame first, then the POST returns and the line is booked.
  b.seen(dm({ from: "g1", text: "early bird", audience: ["g1"], seq: 21 }), 1005);
  const l = b.sent("g1", "early bird", 1000, 200);
  assert.equal(l.seq, 21);
  b.seen(dm({ from: "g1", text: "next", audience: ["g1"], seq: 22 }), 1500);
  const m = b.sent("g1", "next", 1400, 200);
  // His reply to the first only (answers 21) leaves the second open.
  b.seen(dm({ from: "Trabolta", text: "Early.", audience: ["g1"], seq: 23, answers: 21 }), 5000);
  assert.equal(l.closedBy, "reply");
  assert.equal(m.closedAt, null);
});

test("LoadBook: a line sent while he is already typing types from its send; typed = typing on → reply", () => {
  const b = new LoadBook(CANNED);
  b.watch("g1", "Load 01");
  const a = b.sent("g1", "one", 0, 200);
  b.seen(dm({ from: "g1", text: "one", audience: ["g1"], seq: 1 }), 5);
  b.typing({ channel: "dm:Trabolta", from: "Trabolta", on: true, audience: ["g1"] }, 30_000);
  const c = b.sent("g1", "two", 31_000, 200);
  b.seen(dm({ from: "g1", text: "two", audience: ["g1"], seq: 2 }), 31_005);
  assert.equal(a.typingAt, 30_000);
  assert.equal(c.typingAt, 31_000);
  b.seen(dm({ from: "Trabolta", text: "Both.", audience: ["g1"], seq: 3, answers: 2 }), 36_000);
  const s = summarize(b, 0, 40_000);
  assert.equal(s.typingMs.max, 30_000);
  assert.deepEqual([s.typedMs.n, s.typedMs.max], [2, 6000]);
  assert.equal(lineRow(a, 0)["typedMs"], 6000);
  // A refused say never types.
  assert.equal(b.sent("g1", "too fast", 37_000, 429).typingAt, null);
});

test("never / mentions match whole words, as outsideHits does", () => {
  assert.equal(saysWord("Update your profile.", "file"), false);
  assert.equal(saysWord("File it on the card.", "file"), true);
  assert.equal(saysWord("He smiled warmly.", "warm"), false);
  assert.equal(saysWord("A swarm of packets.", "warm"), false);
  assert.equal(saysWord("You're getting warm.", "warm"), true);
  assert.equal(saysWord("Close! Very close!", "close!"), true);
  assert.equal(saysWord("that's RIGHT, program", "that's right"), true);
  const res = checkReplies(
    [
      { kind: "never", words: ["warm"] },
      { kind: "mentions", words: ["file"] },
    ],
    { replies: ["Warmly, I await your profile."], kinds: ["reply"], unanswered: 0, sent: 1 },
    [],
    new SecretBook(),
  );
  assert.deepEqual(
    res.map((r) => r.ok),
    [true, false],
  );
});

test("factsSecrets: every secret class of a facts file gets a label (synthetic values)", () => {
  const s = new SecretBook();
  factsSecrets(s, {
    questions: [
      {
        id: "H1",
        answer: "fake-ans-one",
        accept: ["fake-acc-one"],
        codex: { code: "fake-hcodex-one" },
        proposal: { answer: "fake-prop-ans", accept: ["fake-prop-acc"], codex: { code: "fake-pcodex" } },
      },
    ],
    answers: [{ id: "P1", answer: "fake her line", accept: ["fake her line too"] }],
    door: { code: "fake-door", codex: { code: "fake-door-codex" }, clues: [{ id: "D1", code: "fake-digit-note" }] },
    facts: [
      { id: "M01", codex: { code: "fake-open-qr" } },
      { id: "S01", codex: { code: "fake-secret-qr", secret: true } },
    ],
  });
  const want: Array<[string, string]> = [
    ["fake-ans-one", "H1 answer"],
    ["fake-acc-one", "H1 answer"],
    ["fake-hcodex-one", "H1 codex code"],
    ["fake-prop-ans", "H1 proposal answer"],
    ["fake-prop-acc", "H1 proposal answer"],
    ["fake-pcodex", "H1 proposal codex code"],
    ["fake her line", "P1 answer"],
    ["fake her line too", "P1 answer"],
    ["fake-door", "door code"],
    ["fake-door-codex", "door codex code"],
    ["fake-digit-note", "digit note D1"],
    ["fake-secret-qr", "S01 codex code"],
  ];
  for (const [v, label] of want) assert.ok(s.hits(`he said ${v} today`).includes(label), `${label} missing`);
  // A printed QR code is not a secret.
  assert.deepEqual(s.hits("scan fake-open-qr"), []);
  // An accepted short form inside a longer answer is caught on its own.
  const t = new SecretBook();
  factsSecrets(t, { questions: [{ id: "H2", answer: "fake long answer", accept: ["long answer"] }] });
  assert.deepEqual(t.hits("only long answer here"), ["H2 answer"]);
  assert.equal(t.redact("the fake long answer"), "the ‹H2 answer›");
});

test("factsSecrets on the show's facts.json: every class present yields its label (values never printed)", () => {
  const f = JSON.parse(readFileSync(join(SHOW, "facts.json"), "utf8")) as {
    questions: Array<{ id: string; answer: string; accept: string[]; codex?: { code: string }; proposal?: { answer: string; accept: string[]; codex?: { code: string } } }>;
    answers?: Array<{ id: string; answer: string; accept: string[] }>;
    door: { code: string; clues?: Array<{ id: string; code: string }> };
    facts?: Array<{ id: string; codex?: { code: string; secret?: boolean } }>;
  };
  const s = new SecretBook();
  factsSecrets(s, f);
  const checks: Array<[string, string]> = [];
  for (const q of f.questions) {
    for (const v of [q.answer, ...q.accept]) checks.push([v, `${q.id} answer`]);
    if (q.codex !== undefined) checks.push([q.codex.code, `${q.id} codex code`]);
    if (q.proposal !== undefined) {
      for (const v of [q.proposal.answer, ...q.proposal.accept]) checks.push([v, `${q.id} proposal answer`]);
      if (q.proposal.codex !== undefined) checks.push([q.proposal.codex.code, `${q.id} proposal codex code`]);
    }
  }
  for (const a of f.answers ?? []) for (const v of [a.answer, ...a.accept]) checks.push([v, `${a.id} answer`]);
  checks.push([f.door.code, "door code"]);
  for (const c of f.door.clues ?? []) checks.push([c.code, `digit note ${c.id}`]);
  for (const x of f.facts ?? []) if (x.codex?.secret === true) checks.push([x.codex.code, `${x.id} codex code`]);
  const labels = checks.map(([, l]) => l);
  for (const want of [/^H\d+ answer$/u, /^H\d+ codex code$/u, /proposal answer$/u, /^P\d+ answer$/u, /^door code$/u, /^digit note /u]) assert.ok(labels.some((l) => want.test(l)), `no ${want} in facts.json`);
  assert.ok((f.answers ?? []).length > 0 && (f.door.clues ?? []).length > 0, "facts.json has her line and the digit notes");
  let n = 0;
  for (const [v, label] of checks) {
    if (typeof v !== "string" || v.trim().length < 3) continue;
    n++;
    // The message names the label only; the value stays out of the output.
    assert.ok(s.hits(`... ${v} ...`).includes(label), `${label}: not caught`);
    assert.ok(!s.redact(`... ${v} ...`).includes(v), `${label}: not redacted`);
  }
  assert.ok(n >= 30, `only ${n} secret values checked`);
});

test("mindSecrets reads secrets.never by its generator's group comments; the show's mind has one", () => {
  const s = new SecretBook();
  const n = mindSecrets(
    s,
    [
      "---",
      "secrets:",
      "  topics:",
      "    - not a secret",
      "  match:",
      "    - also not read here",
      "  never:",
      '    - "fake-door-x"          # the door code',
      "    - fake door spoken",
      '    - "fake-note-1"          # the digit notes',
      '    - "Q9-Z9"                # the patch-bay pairs',
      '    - "fake her words"       # the pickup line',
      "# </titi-facts:secrets>",
      "other: 1",
      "---",
    ].join("\n"),
  );
  assert.equal(n, 5);
  assert.deepEqual(s.hits("fake door spoken"), ["never: the door code"]);
  assert.deepEqual(s.hits("q9-z9"), ["never: the patch-bay pairs"]);
  assert.deepEqual(s.hits("fake her words"), ["never: the pickup line"]);
  assert.deepEqual(s.hits("not a secret"), []);
  const real = new SecretBook();
  const got = mindSecrets(real, readFileSync(join(SHOW, "trabolta.mind.md"), "utf8"));
  assert.ok(got >= 3, `only ${got} never entries in trabolta.mind.md`);
});

test("the Kernel: the live answer key and what was said are secrets; names and verdict words are not", () => {
  for (const p of ["ans_1", "ans_8", "said_3", "door_code", "combo_a", "res_answer"]) assert.ok(KERNEL_SECRET.test(p), p);
  for (const p of ["_pressed_by", "virus_planter", "q1", "t1", "majority", "lies_accepted"]) assert.ok(!KERNEL_SECRET.test(p), p);
  const s = new SecretBook();
  kernelSecrets(s, [
    { path: "Kernel.ans_2", value: "fake-key-two" },
    { path: "Kernel._pressed_by", value: "Load 07" },
  ]);
  assert.deepEqual(s.hits("it was fake-key-two"), ["Kernel.ans_2"]);
  assert.deepEqual(s.hits("Load 07 pressed it"), []);
});

test("modelStats flags a pull the trace ring cut short", () => {
  const full = Array.from({ length: 400 }, (_, i) => ({ kind: "voice", at: 200 + i, ms: 1000 }));
  assert.equal(modelStats(full, 100).truncated, true);
  assert.equal(modelStats(full, 300).truncated, false); // the run started inside the ring
  assert.equal(modelStats(full.slice(0, 50), 100).truncated, false); // a fresh server's few thoughts
});

test("a battery setup is read back: the heart's watcher undoing at_the_heart fails it", () => {
  const setup = [
    { path: "Night.heart_holder", value: "$name" },
    { path: "$me.at_the_heart", value: "true" },
  ];
  assert.equal(withMe("$name", "g7", "Battery Pilgrim"), "Battery Pilgrim");
  const held = new Map([
    ["Night.heart_holder", "Battery Pilgrim"],
    ["g7.at_the_heart", "true"],
  ]);
  assert.deepEqual(setupMismatches(setup, held, "g7", "Battery Pilgrim"), []);
  const undone = new Map([
    ["Night.heart_holder", "none"],
    ["g7.at_the_heart", "false"],
  ]);
  const got = setupMismatches(setup, undone, "g7", "Battery Pilgrim");
  assert.equal(got.length, 2);
  assert.ok(got[1]!.startsWith("g7.at_the_heart reads"));
  // The shipped battery's heart scenario names the holder before the flag.
  const doc = parseBattery(JSON.parse(readFileSync(join(here, "../trabolta-battery.json"), "utf8")));
  for (const sc of doc.scenarios.filter((x) => x.setup.some((st) => st.path.endsWith(".at_the_heart")))) {
    const i = sc.setup.findIndex((st) => st.path === "Night.heart_holder" && st.value === "$name");
    const j = sc.setup.findIndex((st) => st.path.endsWith(".at_the_heart"));
    assert.ok(i >= 0 && i < j, `${sc.id}: Night.heart_holder = $name must come before at_the_heart`);
  }
});

test("load safety: each refusal lifts on its own flag and none lifts another", () => {
  const f = (...a: string[]) => safetyFlags(a);
  assert.equal(loadRefusal("http://127.0.0.1:7942", f()), null);
  assert.match(loadRefusal("https://app.example.com", f())!, /not this laptop/u);
  assert.equal(loadRefusal("https://app.example.com", f("--allow-remote")), null);
  assert.match(loadRefusal("http://127.0.0.1:7000", f()) ?? "", /port 7000/u);
  assert.match(loadRefusal("http://127.0.0.1:7000", f("--allow-remote")) ?? "", /port 7000/u);
  assert.equal(loadRefusal("http://localhost:7000", f("--allow-dev-server")), null);
  assert.match(loadRefusal("https://app.example.com", f("--allow-dev-server")) ?? "", /not this laptop/u);
  assert.match(loadRefusal("https://app.example.com", f("--rerun")) ?? "", /not this laptop/u);
  assert.match(loadRefusal("https://app.example.com", f("--allow-remote", "--rerun")) ?? "", /scratch server on this laptop only/u);
  assert.match(loadRefusal("http://127.0.0.1:7000", f("--allow-dev-server", "--rerun")) ?? "", /scratch server on this laptop only/u);
  // The old catch-all is refused outright, wherever.
  assert.match(loadRefusal("http://127.0.0.1:7942", f("--i-know-this-is-live")) ?? "", /never runs over real guests/u);
});

test("load safety: --rerun looks past only this driver's bots, only on a scratch server; --yes counts only there", () => {
  const roster = [
    { id: "g1", name: "Load 01" },
    { id: "g2", name: "Battery Pilgrim" },
    { id: "g3", name: "Winamp" },
    { id: "p-1", name: "Persona" },
  ];
  const battery = new Set(["battery pilgrim"]);
  assert.ok(isOwnBot("Load 07", battery) && isOwnBot("Load 120", battery) && isOwnBot("battery pilgrim", battery));
  assert.ok(!isOwnBot("Loader 07", battery) && !isOwnBot("Load", battery) && !isOwnBot("Winamp", battery));
  const scratch = guardInput("http://127.0.0.1:7942", ["--rerun", "--yes"], roster, battery);
  assert.deepEqual(scratch.roster!.map((r) => r.name), ["Winamp", "Persona"]);
  assert.equal(scratch.skipped, 2);
  assert.deepEqual(scratch.argv, ["--rerun", "--yes"]);
  assert.equal(scratch.local, true);
  // Winamp is nobody's bot: still refused, in this tool's words.
  assert.match(scratch.refusal ?? "", /1 guest\(s\) on the roster who are not this driver's bots \(Winamp\)/u);
  assert.equal(guardInput("http://127.0.0.1:7942", ["--rerun"], roster.slice(0, 2), battery).refusal, null);
  assert.match(guardInput("http://127.0.0.1:7942", [], roster.slice(0, 2), battery).refusal ?? "", /--rerun/u);
  assert.doesNotMatch(guardInput("https://app.example.com", ["--allow-remote"], roster, battery).refusal ?? "", /--rerun|i-know/u);
  // Without --rerun every row goes to the guard.
  assert.equal(guardInput("http://127.0.0.1:7942", [], roster, battery).roster!.length, 4);
  // Off a scratch server: the whole roster, never --yes, never the live override.
  const remote = guardInput("https://app.example.com", ["--allow-remote", "--rerun", "--yes", "--i-know-this-is-live"], roster, battery);
  assert.equal(remote.roster!.length, 4);
  assert.deepEqual(remote.argv, ["--allow-remote", "--rerun"]);
  assert.equal(remote.local, false);
  assert.equal(guardInput("http://127.0.0.1:7000", ["--allow-dev-server", "--yes"], roster, battery).argv.includes("--yes"), false);
});

test("a flag that takes a value refuses to go without one", () => {
  const valued = ["fake-worker", "guests", "battery"];
  const numeric = new Set(["fake-worker", "guests"]);
  assert.deepEqual(valueProblems(["--guests", "5", "--fake-worker"], valued, numeric), ["--fake-worker needs a value"]);
  assert.deepEqual(valueProblems(["--fake-worker", "--yes"], valued, numeric), ["--fake-worker needs a value"]);
  assert.deepEqual(valueProblems(["--fake-worker", "fast"], valued, numeric), ['--fake-worker needs a number (got "fast")']);
  assert.deepEqual(valueProblems(["--fake-worker", "3000", "--battery", "b.json"], valued, numeric), []);
});

/** A Client stand-in: every POST answers 200 after `ms`, and is counted. */
function stubHttp(ms = 0): { http: Client; posts: Array<{ path: string; body: Record<string, unknown> }> } {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const http = {
    base: "http://127.0.0.1:1",
    scope: "",
    post: async (path: string, body: Record<string, unknown>) => {
      posts.push({ path, body });
      await new Promise((r) => setTimeout(r, ms));
      return { status: 200, json: {} };
    },
  } as unknown as Client;
  return { http, posts };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = (w: FakeWorker, ev: string, d: Record<string, unknown>) => w.frame(ev, JSON.stringify(d));

test("FakeWorker: never more than its slots at once, FIFO; a cancel frees a waiting or running job", async () => {
  const { http, posts } = stubHttp();
  const w = new FakeWorker({ http, mod: "m", ms: 40, concurrency: 2 });
  for (const id of ["r1", "r2", "r3", "r4"]) frame(w, "request", { id, thread: { channel: "dm:Trabolta", audience: ["g1"] } });
  assert.deepEqual([w.busy, w.queued, w.received], [2, 2, 4]);
  // Cancel a waiting job and a running one: the running slot goes to r3.
  frame(w, "cancel", { id: "r4" });
  frame(w, "cancel", { id: "r1" });
  assert.deepEqual([w.busy, w.queued, w.cancelled], [2, 0, 2]);
  await wait(150);
  assert.equal(w.busy, 0);
  const replied = posts.filter((p) => p.path === "/api/agent/reply").map((p) => p.body["id"]);
  assert.deepEqual(replied, ["r2", "r3"]);
  assert.equal(w.replies, 2);
  w.stop();
});

test("FakeWorker: a cancel while its reply POST is out does not free the slot early", async () => {
  const { http } = stubHttp(60);
  const w = new FakeWorker({ http, mod: "m", ms: 5, concurrency: 1 });
  frame(w, "request", { id: "a" });
  frame(w, "request", { id: "b" });
  await wait(20); // a's timer fired; its POST is out for 60 ms
  frame(w, "cancel", { id: "a" });
  assert.deepEqual([w.busy, w.queued], [1, 1]);
  await wait(200);
  assert.equal(w.busy, 0);
  w.stop();
});

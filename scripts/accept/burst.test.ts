// node --no-warnings --test scripts/accept/burst.test.ts
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { BurstClock, pct, personaLines, recordLine } from "./burst.ts";

const HOLD = "Jean Trabolta is not responding. Please do not move the mouse.";
const reply = (to: string[], text = "Hello, program.") => ({ from: "Trabolta", channel: "dm:Trabolta", text, audience: to });

test("only the character's first real reply in its dm thread to a timed bot counts", () => {
  const c = new BurstClock("Trabolta", HOLD);
  c.sent("p-1", 0);
  c.sent("p-2", 0);
  assert.deepEqual(c.seen({ from: "p-1", channel: "dm:Trabolta", text: "hi", audience: ["p-1"] }, 100), []); // the bot itself
  assert.deepEqual(c.seen({ from: "Trabolta", channel: "lobby", text: "x", audience: "all" }, 200), []); // another room
  assert.deepEqual(c.seen(reply(["p-9"]), 300), []); // not one of ours
  assert.deepEqual(c.seen(reply(["p-1"]), 2_000), ["p-1"]);
  assert.deepEqual(c.seen(reply(["p-1"], "And another thing."), 3_000), []); // only the first
  assert.deepEqual(c.waiting(), ["p-2"]);
});

test("a hold line is not an answer; a real reply after it still counts", () => {
  const c = new BurstClock("Trabolta", HOLD);
  c.sent("p-1", 0);
  c.sent("p-2", 0);
  assert.deepEqual(c.seen(reply(["p-1", "p-2"], ` ${HOLD} `), 20_000), []);
  assert.deepEqual(c.seen(reply(["p-2"]), 45_000), ["p-2"]);
  const s = c.summary();
  assert.equal(s.answered, 1);
  assert.equal(s.heldOnly, 1);
  assert.equal(s.missing, 0);
  assert.equal(s.p95, 45);
  assert.equal(s.pass, false);
});

test("the summary: percentiles over real replies, PASS at 90 % answered", () => {
  const c = new BurstClock("Trabolta", null);
  for (let i = 0; i < 10; i++) c.sent(`p-${i}`, 1_000);
  for (let i = 0; i < 9; i++) c.seen(reply([`p-${i}`]), 1_000 + (i + 1) * 2_000);
  const s = c.summary();
  assert.deepEqual([s.sent, s.answered, s.missing, s.heldOnly], [10, 9, 1, 0]);
  assert.equal(s.p50, 10);
  assert.equal(s.p95, 18);
  assert.equal(s.max, 18);
  assert.equal(s.pass, true);
  assert.match(recordLine(s, "2026-10-21", "app.mapsandducks.com"), /^record: 2026-10-21 · app\.mapsandducks\.com · 10 DMs at once → 9 answered, 1 unanswered · p50 10\.0 s · p95 18\.0 s · max 18\.0 s · PASS$/u);
  assert.match(recordLine(s, "x", "y", 60), / · 10 DMs over 60 s → /u);
});

test("pct: nearest rank; empty is NaN", () => {
  assert.equal(pct([5, 1, 3], 50), 3);
  assert.equal(pct([1, 2, 3, 4], 95), 4);
  assert.ok(Number.isNaN(pct([], 95)));
  assert.equal(new BurstClock("Trabolta", null).summary().pass, false);
});

const FALLBACK = "…packet loss. That matter is closed, program. The hunt is waiting.";
const GATE = "Jean Trabolta is unavailable at this time. Please do not move the mouse.";
const CANNED = { fallback: FALLBACK, unavailable: GATE };

test("the worker's fallback line is not an answer: a fallback-only burst FAILs and stops waiting", () => {
  const c = new BurstClock("Trabolta", "Jean Trabolta is not responding.", CANNED);
  for (let i = 0; i < 10; i++) c.sent(`p-${i}`, 0);
  for (let i = 0; i < 10; i++) assert.deepEqual(c.seen(reply([`p-${i}`], FALLBACK), 1_200), []);
  assert.equal(c.outstanding().length, 0); // the worker closed every request
  assert.equal(c.waiting().length, 10);
  const s = c.summary();
  assert.deepEqual([s.answered, s.fallbackOnly, s.gatedOnly, s.heldOnly, s.missing], [0, 10, 0, 0, 0]);
  assert.equal(s.pass, false);
  assert.match(recordLine(s, "x", "y"), / → 0 answered, 10 fallback only \(model failed\) · p50 — · p95 — · max — · FAIL$/u);
});

test("a fallback followed by a real reply counts the real reply", () => {
  const c = new BurstClock("Trabolta", null, CANNED);
  c.sent("p-1", 0);
  assert.deepEqual(c.seen(reply(["p-1"], ` ${FALLBACK}`), 1_000), []);
  assert.deepEqual(c.seen(reply(["p-1"]), 9_000), ["p-1"]);
  const s = c.summary();
  assert.deepEqual([s.answered, s.fallbackOnly, s.p95, s.pass], [1, 0, 9, true]);
});

test("the gate line (awake off) is tallied apart from the hold line", () => {
  const c = new BurstClock("Trabolta", "Jean Trabolta is not responding.", CANNED);
  c.sent("p-1", 0);
  c.sent("p-2", 0);
  c.sent("p-3", 0);
  c.seen(reply(["p-1"], GATE), 100);
  c.seen(reply(["p-2"], "Jean Trabolta is not responding."), 20_000);
  c.seen(reply(["p-3"], "Jean Trabolta is not responding."), 20_000);
  c.seen(reply(["p-3"], FALLBACK), 25_000); // the worker came back, then failed: the last word wins
  const s = c.summary();
  assert.deepEqual([s.gatedOnly, s.heldOnly, s.fallbackOnly, s.missing], [1, 1, 1, 0]);
  assert.deepEqual(c.outstanding(), ["p-2"]); // a hold keeps the request open
  assert.match(recordLine(s, "x", "y"), /, 1 hold line only, 1 fallback only \(model failed\), 1 gate closed · /u);
});

test("personaLines reads fallback + unavailable off the frontmatter (and the show's persona file)", async () => {
  assert.deepEqual(personaLines('---\ncharacter: X\nunavailable: "Not now."\nfallback: \'Static…\'\n---\nbody fallback: no\n'), { fallback: "Static…", unavailable: "Not now." });
  assert.deepEqual(personaLines("---\ncharacter: X\n---\n"), { fallback: null, unavailable: null });
  assert.deepEqual(personaLines("no frontmatter\nfallback: x\n"), { fallback: null, unavailable: null });
  const { readFileSync } = await import("node:fs");
  const show = personaLines(readFileSync(new URL("../../core/examples/trapped-in-the-internet/trabolta.persona.md", import.meta.url), "utf8"));
  assert.equal(show.fallback, FALLBACK);
  assert.equal(show.unavailable, GATE);
});

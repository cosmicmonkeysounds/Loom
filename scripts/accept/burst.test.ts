// node --no-warnings --test scripts/accept/burst.test.ts
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { BurstClock, pct, recordLine } from "./burst.ts";

const HOLD = "Jean Trabolta will make an appearance later tonight. Please do not move the mouse.";
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

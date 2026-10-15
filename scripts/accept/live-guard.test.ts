// node --no-warnings --test scripts/accept/live-guard.test.ts
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { judge, realGuests } from "./live-guard.ts";

const persona = { id: "p-ab12cd", name: "Ivo" };
const bot = { id: "g-1", name: "K32 Bot x7f 03" };
const phone = { id: "g-2", name: "Winamp" };

test("personas and the load test's own bots are not real guests", () => {
  assert.deepEqual(realGuests([persona, bot]), []);
  assert.deepEqual(realGuests([persona, bot, phone]), [phone]);
  assert.deepEqual(realGuests(undefined), []);
});

test("a rehearsal passes; a live roster refuses unless overridden", () => {
  assert.equal(judge([persona, bot], false, "load-test").ok, true);
  const live = judge([persona, phone], false, "load-test");
  assert.equal(live.ok, false);
  assert.match(live.ok ? "" : live.reason, /1 real guest.*Winamp.*--i-know-this-is-live/u);
  assert.equal(judge([phone], true, "load-test").ok, true);
});

// node --experimental-strip-types --no-warnings --test scripts/show/test/ui.test.ts
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { flagOn, flagStr, listFlag, parseArgs, watchSeconds } from "../lib/args.ts";
import { ago, type Check, clockText, exitCode, maskCode, renderChecks, renderCsv, renderTable, summary, width, worst } from "../lib/ui.ts";

const c = (level: Check["level"], name = "x"): Check => ({ name, level, detail: "d", read: "GET /r" });

test("exit codes: 0 green, 1 any amber, 2 any red", () => {
  assert.equal(exitCode([c("ok"), c("info")]), 0);
  assert.equal(exitCode([c("ok"), c("warn")]), 1);
  assert.equal(exitCode([c("warn"), c("fail"), c("ok")]), 2);
  assert.equal(exitCode([]), 0);
  assert.equal(worst("warn", "ok"), "warn");
  assert.equal(worst("info", "fail"), "fail");
});

test("a passcode prints as two characters and dots, never whole", () => {
  assert.equal(maskCode("MOD7391"), "MO•••••");
  assert.equal(maskCode("AB"), "••");
  assert.ok(!maskCode("SUPERSECRETCODE").includes("SECRET"));
});

test("the check table: aligned names, the source only on amber / red unless verbose, colour only when asked", () => {
  const rows = [c("ok", "VPS health"), c("fail", "Terminals")];
  const plain = renderChecks(rows, { color: false });
  assert.equal(plain, "OK    VPS health  d\nFAIL  Terminals   d  (GET /r)");
  assert.ok(!plain.includes("\u001b["), "no escape codes off a TTY");
  assert.ok(renderChecks(rows, { color: true }).includes("\u001b[31;1mFAIL"));
  assert.ok(renderChecks(rows, { color: false, verbose: true }).split("\n")[0]!.endsWith("(GET /r)"));
  assert.match(summary(rows, false), /^RED {2}1 ok · 0 warnings · 1 failure$/u);
});

test("tables pad by display width (emoji are two cells); CSV quotes commas", () => {
  assert.equal(width("📟 TV"), 5);
  assert.equal(renderTable(["A", "B"], [["📟", "x"], ["long", "y"]]), "A     B\n📟    x\nlong  y");
  assert.equal(renderCsv(["n"], [["Ivo, Marsh"], ['say "hi"']]), 'n\n"Ivo, Marsh"\n"say ""hi"""');
});

test("ages and the show clock", () => {
  assert.equal(ago(4_000), "4 s");
  assert.equal(ago(5 * 60_000), "5 min");
  assert.equal(ago(125 * 60_000), "2 h 5 min");
  assert.equal(ago(-1), "?");
  assert.equal(clockText(1140), "7:00 PM");
  assert.equal(clockText(5), "12:05 AM");
  assert.equal(clockText(1440 + 61), "1:01 AM");
});

test("argv: a command, positionals, valued and optional-valued flags", () => {
  const a = parseArgs(["fire", "patch_changed", "--arg", "combo=x", "--yes", "--subject=Winamp", "--i-know-this-is-live"]);
  assert.equal(a.command, "fire");
  assert.deepEqual(a.positionals, ["patch_changed"]);
  assert.deepEqual(a.argPairs, [["combo", "x"]]);
  assert.equal(flagStr(a, "subject"), "Winamp");
  assert.ok(flagOn(a, "yes") && flagOn(a, "i-know-this-is-live"));
  assert.equal(watchSeconds(parseArgs(["doctor", "--watch"]), "watch", 15), 15);
  assert.equal(watchSeconds(parseArgs(["doctor", "--watch", "30"])), 30);
  assert.equal(watchSeconds(parseArgs(["doctor"])), null);
  const w = parseArgs(["status", "--watch", "preflight"]);
  assert.equal(w.flags.get("watch"), true, "a non-number after --watch is not its value");
  assert.deepEqual(w.positionals, ["preflight"]);
  assert.deepEqual(listFlag(parseArgs(["log", "--type", "signal, beatEntered"]), "type"), ["signal", "beatEntered"]);
  assert.match(parseArgs(["log", "--who"]).error ?? "", /--who needs a value/u);
  assert.match(parseArgs(["fire", "--arg", "nokey"]).error ?? "", /key=value/u);
  assert.match(parseArgs(["doctor", "-x"]).error ?? "", /unknown flag/u);
});

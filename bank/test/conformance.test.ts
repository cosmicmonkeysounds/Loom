//! Cross-engine conformance — number formatting, arithmetic, and the
//! golden trace.
//!
//! These are the tests that exist purely because three hand-written
//! runtimes will silently disagree otherwise. They assert on things no
//! story depends on directly but every story's output depends on
//! indirectly.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { compileSources } from "../src/compile.ts";
import { BankVM } from "../src/interp.ts";
import { parseScenario, runScenario, toJsonl, diffTraces } from "../src/trace.ts";
import { formatNumber } from "../src/value.ts";
import { parseDirectiveArgs, splitTopLevel, findTopLevel, unquote } from "../src/directive-args.ts";
import { canonicalJson } from "../src/digest.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const SCENARIOS = join(import.meta.dirname, "scenarios");
const GOLDEN = join(import.meta.dirname, "golden");

/** Evaluate one authored expression and return its rendered text. */
function render(expression: string, world: Record<string, number | string> = {}): string {
  const bank = compileSources([`\n== q\n{${expression}}\n`], { bankName: "q" });
  const vm = new BankVM();
  vm.loadBank(bank);
  for (const [key, value] of Object.entries(world)) {
    vm.set(key, typeof value === "number" ? { kind: "number", value } : { kind: "string", value });
  }
  vm.start(vm.programByName("q"));
  const line = vm.run().find((s) => s.step === "line");
  return line?.step === "line" ? line.text : "";
}

describe("float-format", () => {
  // GDScript's `str(float)`, C#'s `ToString()`, and C's `%g` all disagree
  // here. The normative definition is ECMA-262 Number::toString, chosen
  // because the live engine's `display()` already is exactly that.
  const CASES: Array<[number, string]> = [
    [0, "0"],
    [-0, "0"],
    [1, "1"],
    [-1, "-1"],
    [42, "42"],
    [1.5, "1.5"],
    [-1.5, "-1.5"],
    [0.1, "0.1"],
    [1 / 3, "0.3333333333333333"],
    [0.1 + 0.2, "0.30000000000000004"],
    [1e20, "100000000000000000000"],
    [1e21, "1e+21"],
    [1e-7, "1e-7"],
    [123456789012345680, "123456789012345680"],
    [Number.MAX_SAFE_INTEGER, "9007199254740991"],
    [Infinity, "Infinity"],
    [-Infinity, "-Infinity"],
    [NaN, "NaN"],
  ];

  it.each(CASES)("formats %p as %p", (input, expected) => {
    expect(formatNumber(input)).toBe(expected);
  });

  it("renders integral values without a decimal point in a line", () => {
    expect(render("n", { n: 40 })).toBe("40");
    expect(render("n", { n: 40.5 })).toBe("40.5");
  });

  it("serialises non-finite numbers as strings in canonical JSON", () => {
    // JSON has no NaN or Infinity; they must not silently become null.
    expect(canonicalJson({ v: NaN })).toBe('{"v":"NaN"}');
    expect(canonicalJson({ v: Infinity })).toBe('{"v":"Infinity"}');
  });

  it("sorts keys and omits absent optionals", () => {
    expect(canonicalJson({ b: 1, a: 2, c: undefined })).toBe('{"a":2,"b":1}');
  });
});

describe("arith", () => {
  // f64 throughout. GDScript's integer `/` and `%` do NOT behave this way,
  // so a runtime must use float division and fmod.
  const CASES: Array<[string, string]> = [
    ["1 + 2", "3"],
    ["7 / 2", "3.5"],
    ["1 / 0", "Infinity"],
    ["-1 / 0", "-Infinity"],
    ["0 / 0", "NaN"],
    ["-7 % 3", "-1"],
    ["7 % -3", "1"],
    ["7.5 % 2", "1.5"],
    ["2 * 3 + 1", "7"],
    ["2 + 3 * 4", "14"],
    ["-(2 + 3)", "-5"],
    ["!0", "true"],
    ["!1", "false"],
    ['"a" + 1', "a1"],
    ['1 + "a"', "1a"],
    ["1 == 1", "true"],
    ["1 == true", "true"],
    ['"x" == "x"', "true"],
    ["null == null", "true"],
    ["1 != 2", "true"],
    ["2 > 1", "true"],
    ["1 >= 1", "true"],
  ];

  it.each(CASES)("evaluates %p to %p", (expression, expected) => {
    expect(render(expression)).toBe(expected);
  });

  it("coerces an unresolved path to 0 in arithmetic", () => {
    expect(render("missing + 5")).toBe("5");
  });

  it("treats NaN as falsey", () => {
    expect(render("(0 / 0) or 1")).toBe("true");
    expect(render("(0 / 0) and 1")).toBe("false");
  });

  it("yields a bool from short-circuit, not the operand", () => {
    // Authors compare the result, so returning `7` here would diverge.
    expect(render("5 and 7")).toBe("true");
  });
});

describe("directive argument convention", () => {
  it("splits on top-level commas only", () => {
    expect(splitTopLevel("a, b, c", ",")).toEqual(["a", " b", " c"]);
    expect(splitTopLevel("f(a, b), c", ",")).toEqual(["f(a, b)", " c"]);
    expect(splitTopLevel('"a, b", c', ",")).toEqual(['"a, b"', " c"]);
  });

  it("finds a top-level colon, ignoring nested and quoted ones", () => {
    expect(findTopLevel("scene: x", ":")).toBe(5);
    expect(findTopLevel('"a: b"', ":")).toBe(-1);
  });

  it("unquotes one layer", () => {
    expect(unquote('"hello"')).toBe("hello");
    expect(unquote("'hello'")).toBe("hello");
    expect(unquote("hello")).toBe("hello");
  });

  it("separates positional targets from named arguments", () => {
    expect(parseDirectiveArgs("projectors, scene: static, level: 0.7")).toEqual({
      positional: ["projectors"],
      named: [
        { key: "scene", value: "static" },
        { key: "level", value: "0.7" },
      ],
    });
  });

  it("does not mistake a time-like positional for a named argument", () => {
    // `10:30` has a colon but no identifier key.
    expect(parseDirectiveArgs("10:30")).toEqual({ positional: ["10:30"], named: [] });
  });

  it("handles an empty argument list", () => {
    expect(parseDirectiveArgs("")).toEqual({ positional: [], named: [] });
  });
});

describe("golden trace", () => {
  const bankOf = () => {
    const source = readFileSync(join(FIXTURES, "lighthouse.loom"), "utf8");
    return compileSources([{ path: "lighthouse.loom", source }], { bankName: "lighthouse" });
  };

  it("matches the committed golden for the reference scenario", () => {
    const script = parseScenario(readFileSync(join(SCENARIOS, "lighthouse.script"), "utf8"));
    const actual = toJsonl(runScenario(bankOf(), script));
    const goldenPath = join(GOLDEN, "lighthouse.jsonl");

    if (!existsSync(goldenPath) || process.env["REGEN_GOLDENS"] === "1") {
      writeFileSync(goldenPath, actual);
    }
    const result = diffTraces(readFileSync(goldenPath, "utf8"), actual);
    expect(
      result.ok,
      `line ${result.line}\n  expected: ${result.expected}\n  actual:   ${result.actual}`,
    ).toBe(true);
  });

  it("is deterministic across runs", () => {
    const script = parseScenario(readFileSync(join(SCENARIOS, "lighthouse.script"), "utf8"));
    // Determinism is the whole basis of golden-trace conformance; a bank
    // with unspec'd randomness would make the harness worthless.
    expect(toJsonl(runScenario(bankOf(), script))).toBe(toJsonl(runScenario(bankOf(), script)));
  });

  it("reports a save digest that is stable across a load round trip", () => {
    const script = parseScenario("start opening\nrun\nchoose 0\nrun\nsave\nload\n");
    const records = runScenario(bankOf(), script);
    const digests = records
      .filter((r): r is { cmd: string; digest?: string } => "cmd" in r)
      .map((r) => r.digest);
    const [saveDigest, loadDigest] = digests.slice(-2);
    expect(loadDigest).toBe(saveDigest);
  });
});

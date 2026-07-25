//! The two v1 gaps closed: `<shuffle:>` on the spec'd xorshift64* PRNG,
//! and locale banks (emission, validation, render-time override).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { compileLocaleBank, compileSources, stringsTemplate } from "../src/compile.ts";
import { BankVM } from "../src/interp.ts";
import { parseHex64, shufflePick, xorshift64Next, hex64 } from "../src/prng.ts";
import { parseScenario, runScenario, toJsonl } from "../src/trace.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const SCENARIOS = join(import.meta.dirname, "scenarios");

const shuffleBank = () =>
  compileSources(
    [{ path: "shuffle.loom", source: readFileSync(join(FIXTURES, "shuffle.loom"), "utf8") }],
    { bankName: "shuffle" },
  );

const localeBank = () =>
  compileSources(
    [{ path: "locale.loom", source: readFileSync(join(FIXTURES, "locale.loom"), "utf8") }],
    { bankName: "locale" },
  );

describe("shuffle PRNG", () => {
  it("matches the frozen xorshift64* vector", () => {
    // A hand-frozen vector: if the algorithm drifts, this fails before
    // any cross-runtime conformance run does.
    let state = parseHex64("123456789abcdef0");
    const expected: Array<[string, number]> = [
      ["69cf1fdabed68fcd", 2],
      ["3f4f79e9e0925f64", 0],
      ["03b095b28a1ee01e", 0],
    ];
    for (const [stateHex, pick] of expected) {
      state = xorshift64Next(state);
      expect(hex64(state)).toBe(stateHex);
      expect(shufflePick(state, 3)).toBe(pick);
    }
  });

  it("plays a variant per execution, deterministically", () => {
    const script = parseScenario(readFileSync(join(SCENARIOS, "shuffle.script"), "utf8"));
    const first = toJsonl(runScenario(shuffleBank(), script));
    expect(toJsonl(runScenario(shuffleBank(), script))).toBe(first);

    // Every shuffle line is one of its authored variants.
    const gullVariants = new Set([
      "A gull screams.",
      "Rope creaks against wood.",
      "The tide slaps the pilings.",
    ]);
    const lines = first
      .split("\n")
      .filter((l) => l.includes('"line"'))
      .map((l) => JSON.parse(l) as { text: string });
    const gullLines = lines.filter((l) => gullVariants.has(l.text));
    expect(gullLines.length).toBe(8); // two sites × four replays
  });

  it("varies across replays — the stream advances", () => {
    const vm = new BankVM();
    vm.loadBank(shuffleBank());
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      vm.start(vm.programByName("bell"));
      for (const step of vm.run()) if (step.step === "line") seen.add(step.text);
    }
    // Two variants, twelve draws: both appear with probability
    // 1 - 2^-11 — a failure means the stream is stuck.
    expect(seen.size).toBe(2);
  });

  it("round-trips shuffle state through save/load", () => {
    const vm = new BankVM();
    vm.loadBank(shuffleBank());
    vm.start(vm.programByName("pier"));
    vm.run();
    const save = vm.save();
    expect(save.shuffles.length).toBeGreaterThan(0);

    // Two futures from the same snapshot must agree exactly.
    const futureOf = (): string[] => {
      const replay = new BankVM();
      replay.loadBank(shuffleBank());
      expect(replay.load(save).ok).toBe(true);
      const out: string[] = [];
      for (let i = 0; i < 4; i++) {
        replay.start(replay.programByName("pier"));
        for (const step of replay.run()) if (step.step === "line") out.push(step.text);
      }
      return out;
    };
    expect(futureOf()).toEqual(futureOf());
  });
});

describe("locale banks", () => {
  const TRANSLATIONS = JSON.parse(
    readFileSync(join(FIXTURES, "locale.fr.json"), "utf8"),
  ) as Record<string, string>;

  it("emits a template with ordinal placeholders", () => {
    const template = stringsTemplate(localeBank());
    expect(template["greet/body/1/said/0"]).toBe("Mind the {0} o'clock ferry.");
    expect(Object.keys(template).length).toBe(5);
  });

  it("swaps literals at render time and keeps expressions live", () => {
    const content = localeBank();
    const vm = new BankVM();
    vm.loadBank(content);
    vm.loadBank(compileLocaleBank(content, "fr", TRANSLATIONS));
    vm.set("Time.hour", { kind: "number", value: 6 });

    vm.setLocale("fr");
    vm.start(vm.programByName("greet"));
    const french = vm.run().flatMap((s) => (s.step === "line" ? [s.text] : []));
    expect(french).toContain("Bienvenue sur le quai. L'horloge indique 6.");
    expect(french).toContain("Attention au ferry de 6 heures.");

    // Back to the source with no reload.
    vm.setLocale("");
    vm.start(vm.programByName("greet"));
    const english = vm.run().flatMap((s) => (s.step === "line" ? [s.text] : []));
    expect(english).toContain("Welcome to the quay. The clock reads 6.");
  });

  it("falls back per-key for untranslated texts", () => {
    const content = localeBank();
    const partial = compileLocaleBank(content, "fr", {
      "greet/body/1/said/0": TRANSLATIONS["greet/body/1/said/0"]!,
    });
    const vm = new BankVM();
    vm.loadBank(content);
    vm.loadBank(partial);
    vm.set("Time.hour", { kind: "number", value: 6 });
    vm.setLocale("fr");
    vm.start(vm.programByName("greet"));
    const lines = vm.run().flatMap((s) => (s.step === "line" ? [s.text] : []));
    expect(lines).toContain("Welcome to the quay. The clock reads 6."); // fallback
    expect(lines).toContain("Attention au ferry de 6 heures."); // translated
  });

  it("refuses a translation that invents or drops an interpolation", () => {
    const content = localeBank();
    const invented = compileLocaleBank(content, "xx", {
      "greet/body/2/opt1": "Partir à {0} heures.", // source has no exprs
    });
    expect(invented.diagnostics.some((d) => d.code === "badTranslation")).toBe(true);
    expect(invented.texts["greet/body/2/opt1"]).toBeUndefined();

    const dropped = compileLocaleBank(content, "xx", {
      "greet/body/1/said/0": "Attention au ferry.", // drops {0}
    });
    expect(dropped.diagnostics.some((d) => d.code === "badTranslation")).toBe(true);
  });

  it("warns on a translation for a key that does not exist", () => {
    const bank = compileLocaleBank(localeBank(), "xx", { "no/such/key": "hein ?" });
    expect(bank.diagnostics.some((d) => d.code === "unknownLocKey")).toBe(true);
  });

  it("escapes literal braces in the template", () => {
    const bank = compileSources(["\n== b\nUse {{curly}} braces.\n"], { bankName: "b" });
    const template = stringsTemplate(bank);
    expect(Object.values(template)).toContain("Use {{curly}} braces.");
  });
});

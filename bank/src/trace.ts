//! Scenario driver + golden traces.
//!
//! This is the mechanism that keeps three hand-written runtimes honest: a
//! scenario script is replayed by every implementation, and the resulting
//! canonical JSONL is diffed. A `digest` line after every command means
//! save/load divergence is caught too, not just output divergence.

import { BankVM } from "./interp.ts";
import type { SaveState } from "./interp.ts";
import type { Bank, LocaleBank, Step } from "./ir.ts";
import { canonicalJson, digestOf } from "./digest.ts";
import { parseLiteral } from "./value.ts";

export type TraceRecord =
  | ({ i: number } & Step)
  | { cmd: string; digest?: string };

/** One scenario command, already tokenised. */
export interface Command {
  verb: string;
  args: string[];
  raw: string;
}

export function parseScenario(text: string): Command[] {
  const out: Command[] = [];
  for (const line of text.split("\n")) {
    const stripped = line.replace(/#.*$/u, "").trim();
    if (stripped.length === 0) continue;
    const parts = stripped.split(/\s+/u);
    out.push({ verb: parts[0]!, args: parts.slice(1), raw: stripped });
  }
  return out;
}

export interface RunOptions {
  /** Emit a `digest` on every command line. On for conformance. */
  digests?: boolean;
  /**
   * Resolves a `loadbank <file>` command to bank data. The driver stays
   * filesystem-free; the CLI passes a reader rooted at the primary
   * bank's directory, and an engine's headless runner does the same.
   */
  resolveBank?: (file: string) => Bank | LocaleBank | null;
}

/**
 * Execute a scenario against a bank, returning the trace records. The
 * reference implementation of the driver semantics — an engine's headless
 * runner must behave identically.
 */
export function runScenario(bank: Bank, script: Command[], options: RunOptions = {}): TraceRecord[] {
  const digests = options.digests ?? true;
  const vm = new BankVM();
  vm.loadBank(bank);

  const records: TraceRecord[] = [];
  let index = 0;
  let lastSave: SaveState | null = null;

  const push = (step: Step): void => {
    records.push({ i: index, ...step });
    index += 1;
  };

  for (const command of script) {
    switch (command.verb) {
      case "start": {
        const name = command.args[0] ?? "";
        const bindings = new Map<string, string>();
        for (const pair of command.args.slice(1)) {
          const eq = pair.indexOf("=");
          if (eq > 0) bindings.set(pair.slice(0, eq), pair.slice(eq + 1));
        }
        vm.start(vm.programByName(name), bindings);
        break;
      }
      case "run":
        for (const step of vm.run()) push(step);
        break;
      case "advance": {
        const n = Number(command.args[0] ?? "1");
        for (let k = 0; k < n; k++) push(vm.advance());
        break;
      }
      case "choose":
        if (!vm.choose(Number(command.args[0] ?? "0"))) {
          push({ step: "error", code: "badChoice", message: command.raw });
        }
        break;
      case "signal":
        vm.signal(command.args[0] ?? "", command.args[1] ?? "", command.args[2] ?? "");
        break;
      case "set":
        vm.set(command.args[0] ?? "", parseLiteral(command.args.slice(1).join(" ")));
        break;
      case "tick":
        vm.tick(Number(command.args[0] ?? "0"));
        break;
      case "locale":
        vm.setLocale(command.args[0] ?? "");
        break;
      case "loadbank": {
        const extra = options.resolveBank?.(command.args[0] ?? "") ?? null;
        if (extra === null) {
          push({ step: "error", code: "bankNotLoaded", message: command.raw });
        } else {
          vm.loadBank(extra);
        }
        break;
      }
      case "save":
        lastSave = vm.save();
        break;
      case "load": {
        // A save/load round trip must be invisible. If it is not, the
        // digest on this line diverges and the harness says so.
        if (lastSave !== null) {
          const result = vm.load(lastSave);
          if (!result.ok) {
            push({ step: "error", code: "loadFailed", message: result.reason ?? "" });
          }
        }
        break;
      }
      default:
        push({ step: "error", code: "badCommand", message: command.raw });
        break;
    }

    records.push(
      digests ? { cmd: command.raw, digest: digestOf(vm.save()) } : { cmd: command.raw },
    );
  }
  return records;
}

/** Canonical JSONL — the on-disk golden format. */
export function toJsonl(records: TraceRecord[]): string {
  return records.map((r) => canonicalJson(r)).join("\n") + "\n";
}

export interface TraceDiff {
  ok: boolean;
  line: number;
  expected?: string;
  actual?: string;
  /** Set when a `digest` line differs, naming the state keys that drifted. */
  stateDelta?: string[];
}

/**
 * Diff two canonical traces, reporting the first divergence. When the
 * divergent line is a digest, the caller can pass both save states to
 * `diffStates` to name the keys that drifted rather than showing two
 * unequal hashes.
 */
export function diffTraces(expected: string, actual: string): TraceDiff {
  const a = expected.trimEnd().split("\n");
  const b = actual.trimEnd().split("\n");
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return {
        ok: false,
        line: i + 1,
        expected: a[i],
        actual: b[i],
      };
    }
  }
  return { ok: true, line: 0 };
}

/** Structural diff of two save states — what a digest mismatch really means. */
export function diffStates(expected: SaveState, actual: SaveState): string[] {
  const out: string[] = [];
  const flatten = (state: SaveState): Map<string, string> => {
    const map = new Map<string, string>();
    for (const [key, value] of Object.entries(state)) map.set(key, canonicalJson(value));
    return map;
  };
  const ea = flatten(expected);
  const ab = flatten(actual);
  for (const key of new Set([...ea.keys(), ...ab.keys()])) {
    const x = ea.get(key);
    const y = ab.get(key);
    if (x !== y) out.push(`${key}: expected ${x ?? "(absent)"} got ${y ?? "(absent)"}`);
  }
  return out;
}

//! `showctl`'s argv: one command word, then positionals and flags. Pure.
//!
//! Flags that take a value: `--watch [N]` (N optional, seconds), `--type`,
//! `--who`, `--where`, `--server`, `--code`, `--last`, `--subject`,
//! `--label`, `--router`, `--arg k=v` (repeatable). Everything else that starts with
//! `--` is a boolean. `-h` = `--help`, `-v` = `--verbose`.

export interface Args {
  command: string | null;
  positionals: string[];
  flags: Map<string, string | true>;
  /** `--arg k=v` pairs, in order. */
  argPairs: Array<[string, string]>;
  /** What went wrong parsing, if anything (an unknown short flag, …). */
  error: string | null;
}

const VALUED = new Set(["type", "who", "where", "server", "code", "last", "subject", "label", "router"]);

export function parseArgs(argv: readonly string[]): Args {
  const out: Args = { command: null, positionals: [], flags: new Map(), argPairs: [], error: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h") out.flags.set("help", true);
    else if (a === "-v") out.flags.set("verbose", true);
    else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      const inline = eq > 0 ? a.slice(eq + 1) : null;
      if (name === "arg") {
        const pair = inline ?? argv[++i] ?? "";
        const k = pair.indexOf("=");
        if (k <= 0) out.error = `--arg wants key=value, got "${pair}"`;
        else out.argPairs.push([pair.slice(0, k), pair.slice(k + 1)]);
      } else if (name === "watch" || name === "follow") {
        // An optional number of seconds.
        const next = inline ?? (argv[i + 1] !== undefined && /^\d+(\.\d+)?$/u.test(argv[i + 1]!) ? argv[++i]! : null);
        out.flags.set(name, next ?? true);
      } else if (VALUED.has(name)) {
        const v = inline ?? argv[++i];
        if (v === undefined) out.error = `--${name} needs a value`;
        else out.flags.set(name, v);
      } else out.flags.set(name, inline ?? true);
    } else if (a.startsWith("-") && a.length > 1) out.error = `unknown flag ${a}`;
    else if (out.command === null) out.command = a;
    else out.positionals.push(a);
  }
  return out;
}

/** A flag as a string (null when absent or boolean). */
export function flagStr(args: Args, name: string): string | null {
  const v = args.flags.get(name);
  return typeof v === "string" ? v : null;
}

/** A boolean flag. */
export function flagOn(args: Args, name: string): boolean {
  return args.flags.has(name);
}

/** `--watch [N]` → seconds (default `dflt`), or null when not given. */
export function watchSeconds(args: Args, name = "watch", dflt = 5): number | null {
  const v = args.flags.get(name);
  if (v === undefined) return null;
  if (v === true) return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? n : dflt;
}

/** `--type a,b` → ["a", "b"]. */
export function listFlag(args: Args, name: string): string[] {
  return (flagStr(args, name) ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
}

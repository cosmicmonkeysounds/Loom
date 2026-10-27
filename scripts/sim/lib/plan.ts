// The night's casting and the director's chain slices. Pure.

/** The story's pool (cast/pool.loom), the names a bot may register as.
 *  Trojan Horse is left out (the clowns' shared costume). */
export const POOL: readonly string[] = [
  "Calculator",
  "Winamp",
  "Notepad",
  "Solitaire",
  "Minesweeper",
  "Napster",
  "Encarta",
  "ICQ",
  "The Sims",
  "WinZip",
  "GarageBand",
  "LimeWire",
  "MSN Messenger",
  "3D Pinball",
  "RollerCoaster Tycoon",
  "Zoo Tycoon",
  "Ctrl Alt Del",
  "Netscape Navigator",
  "Paint Shop Pro",
  "RealPlayer",
  "Ring Doorbell",
];

/** `n` pool names nobody on the roster holds yet (case-folded). */
export function pickPool(n: number, taken: ReadonlySet<string>): string[] {
  return POOL.filter((p) => !taken.has(p.toLowerCase())).slice(0, Math.max(0, n));
}

/** The story's `program.featured` slug for a featured program's name. */
export function featuredSlug(name: string): string {
  const k = name.toLowerCase();
  if (k.includes("excel")) return "excel";
  if (k.includes("ask jeeves")) return "jeeves";
  if (k.includes("paint")) return "mspaint";
  return k.replace(/[^a-z]/gu, "");
}

/** The slice of a chain from one cue to another, both included. Throws on a
 *  cue the chain lacks, so a renamed cue fails loudly instead of skipping. */
export function segment<T extends string>(chain: readonly T[], from: T, to: T): T[] {
  const a = chain.indexOf(from);
  const b = chain.indexOf(to, Math.max(0, a));
  if (a < 0 || b < 0) throw new Error(`no ${a < 0 ? from : to} in the chain`);
  return chain.slice(a, b + 1);
}

/** Cues a bot's own action may already have pressed, so the director's
 *  press is refused harmlessly: ⏰ `bingo_time`, pressed by the first
 *  guest's 🎱 BINGO! (wave 26). The simulator's own list: the shared
 *  `SELF_PRESSED` (scripts/accept/chains.ts) stays the timers' only. */
export const SIM_SELF_PRESSED: ReadonlySet<string> = new Set(["bingo_time"]);

/** Wrap a chain's signal so a refusal of one of `names` reads as done
 *  (noted in `already`); every other refusal passes through and stops the
 *  walk. The beat's world check still says whether the night moved. */
export function tolerating<R extends Record<string, unknown>>(
  signal: (name: string, who?: string) => Promise<R>,
  names: ReadonlySet<string>,
  already: string[],
): (name: string, who?: string) => Promise<Record<string, unknown>> {
  return async (name, who) => {
    const r = await signal(name, who);
    if (r["refused"] === true && names.has(name)) {
      already.push(name);
      return {};
    }
    return r;
  };
}

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

/**
 * Who gets thrown out of the heart: by position, so a run is repeatable, but
 * never the bot the next heart beat needs. Its ⟦CHOSEN⟧ is only offered at a first
 * meeting (`heart_layer` only rises), and with pool bots first the fifth bot is
 * the first featured one at 5 to 7 guests.
 */
export function trapOf<B>(bots: readonly B[], chosen: B): B {
  return [4, 2, 3].map((i) => bots[i % bots.length]!).find((b) => b !== chosen) ?? bots[0]!;
}

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

/** A press that failed below the story (a timeout, a dropped connection, a
 *  409, a 500): the signal answers `{ refused: true, httpStatus }` so the
 *  chain stops, and `tolerating` never reads it as the story's refusal. */
export function transportRefusal(status: number, error?: string): Record<string, unknown> {
  return { refused: true, httpStatus: status, ...(error !== undefined ? { error } : {}) };
}

/** The story's own refusal: an HTTP 200 answer with `refused: true`. */
export function isStoryRefusal(r: Record<string, unknown>): boolean {
  return r["refused"] === true && r["httpStatus"] === undefined;
}

/** Wrap a chain's signal so the story's refusal (HTTP 200, `refused: true`)
 *  of one of `names` reads as done (noted in `already`); every other
 *  refusal, and every transport failure (`transportRefusal`), passes
 *  through and stops the walk. The beat's world check still says whether
 *  the night moved. */
export function tolerating<R extends Record<string, unknown>>(
  signal: (name: string, who?: string) => Promise<R>,
  names: ReadonlySet<string>,
  already: string[],
): (name: string, who?: string) => Promise<Record<string, unknown>> {
  return async (name, who) => {
    const r = await signal(name, who);
    if (names.has(name) && isStoryRefusal(r)) {
      already.push(name);
      return {};
    }
    return r;
  };
}

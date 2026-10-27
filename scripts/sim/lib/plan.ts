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

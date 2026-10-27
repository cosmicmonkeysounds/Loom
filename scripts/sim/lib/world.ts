// Reading the night off the director's view, safely. The mod world holds
// secrets (`Kernel.door_code`, the patch-bay combinations, …): `worldOf`
// drops every `Kernel.*` path except an allowlist, and nothing here ever
// prints a whole world. Pure, for `node --test`.

/** Kernel paths that carry no secret and that a beat may assert. */
export const KERNEL_OK: ReadonlySet<string> = new Set(["Kernel.majority_reached", "Kernel.verdict_wait", "Kernel.lies_accepted", "Kernel.facts_accepted"]);

/** `world: [{path, value}]` → a map, minus the Kernel's secrets. */
export function worldOf(rows: ReadonlyArray<{ path: string; value: string }> | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows ?? []) {
    if (r.path.startsWith("Kernel.") && !KERNEL_OK.has(r.path)) continue;
    m.set(r.path, r.value);
  }
  return m;
}

/** What a path should read: an exact value, a set of values, or a test. */
export type Want = string | readonly string[] | ((v: string) => boolean);

/** Unset paths read "none" (the mod view's convention). */
export const read = (w: ReadonlyMap<string, string>, path: string): string => w.get(path) ?? "none";

export const num = (w: ReadonlyMap<string, string>, path: string): number => {
  const n = Number(read(w, path));
  return Number.isFinite(n) ? n : NaN;
};

/** Every expectation that does not hold, as `path = got (want …)` lines. */
export function mismatches(w: ReadonlyMap<string, string>, want: Readonly<Record<string, Want>>): string[] {
  const out: string[] = [];
  for (const [path, x] of Object.entries(want)) {
    const got = read(w, path);
    const ok = typeof x === "function" ? x(got) : typeof x === "string" ? got === x : x.includes(got);
    if (!ok) out.push(`${path} = ${JSON.stringify(got)} (want ${typeof x === "function" ? x.toString().replace(/\s+/gu, " ").slice(0, 60) : JSON.stringify(x)})`);
  }
  return out;
}

export const atLeast = (n: number) => (v: string) => Number(v) >= n;
export const truthy = (v: string) => v === "true";
export const notNone = (v: string) => v !== "none" && v !== "";

/** A roster row as the mod view has it (the fields the bots read). */
export interface Row {
  id: string;
  name: string;
  score: number;
  captured: boolean;
  persona?: true;
  location: string | null;
}

/**
 * The ceremony's winners by role (chains.ts `CEREMONY`), from the night as it
 * stands: trust from `<id>.trust`, the Internet trips from `<id>.visits` /
 * `internet_visits`, the codex from `<id>.codex_count`, Truthcoin from the
 * roster score, lies from `<id>.lies_accepted`, the duck and quests from the
 * tallies the caller passes. Any role nobody leads goes to the first bot.
 */
export function awardWinners(
  rows: readonly Row[],
  w: ReadonlyMap<string, string>,
  extra: { questsDone?: ReadonlyMap<string, number>; codex?: ReadonlyMap<string, number>; duck?: string | null } = {},
): Record<string, string> {
  const people = rows.filter((r) => r.persona !== true);
  if (people.length === 0) return {};
  const by = (score: (r: Row) => number, low = false): string => {
    let best = people[0]!;
    for (const r of people) {
      const a = score(r);
      const b = score(best);
      if (Number.isFinite(a) && (!Number.isFinite(b) || (low ? a < b : a > b))) best = r;
    }
    return best.id;
  };
  const n = (r: Row, k: string) => num(w, `${r.id}.${k}`);
  return {
    most_trusted: by((r) => n(r, "trust")),
    least_trusted: by((r) => n(r, "trust"), true),
    frequent_flyer: by((r) => Math.max(n(r, "internet_visits") || 0, n(r, "visits") || 0)),
    lore_hoarder: by((r) => extra.codex?.get(r.id) ?? 0),
    truthcoin_tycoon: by((r) => r.score),
    best_liar: by((r) => n(r, "lies_accepted") || 0),
    duck_speedrun: extra.duck ?? people[0]!.id,
    quest_completionist: by((r) => extra.questsDone?.get(r.id) ?? 0),
  };
}

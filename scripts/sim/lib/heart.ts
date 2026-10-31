// The heart bot's brain: find the docked heart menu the way the server-room
// terminal does (terminal/src/heart/heart.ts: the newest `dm:Trabolta` menu
// whose beat starts `Heart `), and walk a plan of wanted options by TEXT —
// hidden options are filtered out of the menu, so indexes shift. Pure.

export interface Menu {
  id: number;
  beat: string;
  channel: string;
  options: string[];
}

const fold = (s: string): string => s.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();

/** The menus in a guest view (`choices`), shape-checked. */
export function menusOf(view: unknown): Menu[] {
  const raw = typeof view === "object" && view !== null ? (view as { choices?: unknown }).choices : undefined;
  if (!Array.isArray(raw)) return [];
  const out: Menu[] = [];
  for (const x of raw) {
    if (typeof x !== "object" || x === null) continue;
    const r = x as Record<string, unknown>;
    if (typeof r["id"] !== "number" || !Array.isArray(r["options"])) continue;
    out.push({ id: r["id"], beat: String(r["beat"] ?? ""), channel: String(r["channel"] ?? ""), options: r["options"].filter((o): o is string => typeof o === "string") });
  }
  return out;
}

/** The heart menu docked for a program at the server-room terminal, or null. */
export function heartMenu(menus: readonly Menu[], character = "Trabolta"): Menu | null {
  let best: Menu | null = null;
  for (const m of menus) {
    if (m.channel !== `dm:${character}` || !fold(m.beat).startsWith("heart ") || m.options.length === 0) continue;
    if (best === null || m.id > best.id) best = m;
  }
  return best;
}

/** `⟦PROOF⟧ Hold it up.` → "PROOF"; no tag → null. */
export function tagOf(option: string): string | null {
  const m = /^\s*⟦([^⟧]{1,40})⟧/u.exec(option);
  return m === null ? null : m[1]!.trim();
}

/** The index of the option a fragment names: a `⟦TAG⟧` (exact tag) or a
 *  piece of its text (case- and space-folded). -1 when it is not there. */
export function findOption(options: readonly string[], fragment: string): number {
  const tag = /^⟦(.+)⟧$/u.exec(fragment.trim());
  if (tag !== null) return options.findIndex((o) => fold(tagOf(o) ?? "") === fold(tag[1]!));
  const f = fold(fragment);
  return options.findIndex((o) => fold(o).includes(f));
}

/** The heart's layer menus, by beat (`Heart Layer Two` → 2; the sub-menus
 *  Evidence / Reasons / Speak → their own names). */
export function layerOf(beat: string): string {
  const b = fold(beat);
  if (b.includes("layer one") || b.endsWith("layer 1")) return "L1";
  if (b.includes("layer two")) return "L2";
  if (b.includes("layer three")) return "L3";
  if (b.includes("evidence")) return "Evidence";
  if (b.includes("reasons")) return "Reasons";
  if (b.includes("speak")) return "Speak";
  return beat;
}

/** One step of a heart walk: an option to pick, and whether it must be there. */
export interface HeartStep {
  pick: string;
  /** Skipped (noted) when the menu doesn't offer it. */
  optional?: boolean;
  /** Text to say freely right after (a ⟦SPEAK FREELY⟧ step). */
  say?: string;
}

export type Decision =
  | { kind: "pick"; index: number; text: string; step: HeartStep }
  | { kind: "back"; index: number; text: string }
  | { kind: "skip"; step: HeartStep; why: string }
  | { kind: "stuck"; step: HeartStep; why: string };

/**
 * What to press next for `step` on `menu`. A sub-menu (Evidence, Reasons,
 * Speak) that lacks the option is left by its ⟦BACK⟧ first, so a step aimed
 * at Layer Three still lands from inside a sub-menu.
 */
export function decide(menu: Menu | null, step: HeartStep): Decision {
  if (menu === null) return { kind: "stuck", step, why: "no heart menu docked" };
  const i = findOption(menu.options, step.pick);
  if (i >= 0) return { kind: "pick", index: i, text: menu.options[i]!, step };
  const layer = layerOf(menu.beat);
  const back = findOption(menu.options, "⟦BACK⟧");
  if ((layer === "Evidence" || layer === "Reasons" || layer === "Speak") && back >= 0) return { kind: "back", index: back, text: menu.options[back]! };
  const why = `"${step.pick}" not on ${layer} (${menu.options.map((o) => tagOf(o) ?? o.slice(0, 18)).join(" | ")})`;
  return step.optional === true ? { kind: "skip", step, why } : { kind: "stuck", step, why };
}

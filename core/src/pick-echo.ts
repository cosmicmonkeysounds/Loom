//! How a pick at a story menu reads as the picker's own line (wave 28).
//! One rule for the server (the `pick` chat line it posts for a `chose`
//! event), the heart terminal and the phone's optimistic echo, so the three
//! always agree: said words read as said, with any `⟦TAG⟧` dropped; a
//! tagged option that is a deed (`⟦PROOF⟧ Show him the Sandy File.`) reads
//! as one, in brackets: `[shows the Sandy File]`. Browser-safe, no imports.

/** The deed verbs a tagged option may start with → their third person. */
export const PICK_ACTS: Readonly<Record<string, string>> = {
  show: "shows",
  hold: "holds",
  hand: "hands",
  give: "gives",
  play: "plays",
  read: "reads",
  put: "puts",
  open: "opens",
  offer: "offers",
  point: "points",
  place: "places",
  lay: "lays",
  slide: "slides",
  push: "pushes",
  pull: "pulls",
  plug: "plugs",
  unplug: "unplugs",
  take: "takes",
  tap: "taps",
  turn: "turns",
};

/** `⟦PROOF⟧ Hold it up.` → `{tag: "PROOF", text: "Hold it up."}`; no tag → `tag` null. */
export function splitPickTag(option: string): { tag: string | null; text: string } {
  const m = /^\s*⟦([^⟧]{1,40})⟧\s*(.*)$/u.exec(option);
  return m === null ? { tag: null, text: option.trim() } : { tag: m[1]!.trim(), text: m[2]!.trim() };
}

/**
 * How a pick reads in the thread. Said words read as said (the tag
 * dropped); a tagged deed reads `[shows the Sandy File]`: its first
 * sentence, the verb in the third person, a "him" right after it dropped.
 */
export function echoOf(option: string): { text: string; action: boolean } {
  const { tag, text } = splitPickTag(option);
  if (tag !== null) {
    const m = /^(\p{L}+)\s+(.*)$/u.exec(text);
    const act = m === null ? undefined : PICK_ACTS[m[1]!.toLowerCase()];
    if (m !== null && act !== undefined) {
      const first = (/^(.*?[.!?])(\s|$)/u.exec(m[2]!)?.[1] ?? m[2]!)
        .replace(/[.!?…]+$/u, "")
        .replace(/^him\s+/iu, "")
        .trim();
      if (first !== "") return { text: `[${act} ${first}]`, action: true };
    }
  }
  return { text, action: false };
}

//! The Recycle Bin gags (wave 18, the moments lane; GUEST-SPEC §4.2, the
//! user's Q3: "there should sometimes be funny 'message delete' dialogs").
//! Which gag a delete plays is a pure function of the rows' seqs, so a
//! tester can predict it and a test can pin it. Copy here, verbatim from the
//! spec; the dialogs that show it are `gag-dialogs.tsx` (lazy).

/** How long the fake "Deleting…" bar runs. */
export const DELETE_BAR_MS = 1_200;
/** A row title in a gag is cut at this many characters. */
export const GAG_TITLE_MAX = 40;

/** "'You won a Bingo Ribbon.'" — a title cut at 40 characters with "…". */
export function gagTitle(title: string): string {
  const t = title.trim();
  return t.length <= GAG_TITLE_MAX ? t : `${t.slice(0, GAG_TITLE_MAX - 1).trimEnd()}…`;
}

/** Does ✕ on this row ask first (one in four), or delete at once? */
export function gagFor(seq: number | null): "confirm" | "none" {
  return seq !== null && seq % 4 === 0 ? "confirm" : "none";
}

/**
 * How Clear all ends (after its confirm and the bar): 0 all gone ("So is
 * your past."), 1 "Access is denied" (the rows with the most frequent
 * caption stay), 2 "full of beans" (everything goes anyway). `firstSeq` is
 * the seq of the top row (the newest; 0 when it has none).
 */
export function clearGag(n: number, firstSeq: number): 0 | 1 | 2 {
  return (((n + firstSeq) % 3) + 3) % 3 as 0 | 1 | 2;
}

/** The most frequent caption among some rows (ties: the first met), or null. */
export function mostFrequentCaption(captions: readonly string[]): string | null {
  const count = new Map<string, number>();
  let best: string | null = null;
  for (const c of captions) {
    const n = (count.get(c) ?? 0) + 1;
    count.set(c, n);
    if (best === null || n > (count.get(best) ?? 0)) best = c;
  }
  return best;
}

export const GAG_COPY = {
  confirmTitle: "Confirm File Delete",
  confirm: (title: string) => `Are you sure you want to send '${gagTitle(title)}' to the Recycle Bin?`,
  inUseTitle: "Error Deleting File",
  inUse: (title: string) => `Cannot delete '${gagTitle(title)}': This item is in use.`,
  clearTitle: "Confirm Multiple File Delete",
  clear: (n: number) => `Are you sure you want to delete these ${n} items?`,
  deletingTitle: "Deleting…",
  progress: (k: number, n: number) => `${k} of ${n}`,
  deniedTitle: "Error Deleting File",
  denied: (caption: string) => `Cannot delete '${gagTitle(caption)}': Access is denied.`,
  beansTitle: "Recycle Bin",
  beans: "The Recycle Bin is full of beans.",
  empty: "The Recycle Bin is empty. Nothing has interrupted you yet.",
  emptyPast: "The Recycle Bin is empty. So is your past.",
  yes: "Yes",
  no: "No",
  ok: "OK",
  cancel: "Cancel",
} as const;

// Wave 48 (C5): the censor's filter on one phone, for the booth to share
// between the pop-out driver, the tray's `🔑 n` and the filter window.
// It holds what the pure model needs and the view doesn't say: what this
// sign-in has seen and let go (host storage, `loom.booth.filter.<token>`),
// the lines this phone censored while the next snapshot is on its way, and
// the last refusal per line (said in place). Storage is handed in (the
// booth passes `usePlayHost().storage`), so the hooks harness can drive it.

import { useRef, useState } from "react";
import type { SessionStorage } from "../../host.ts";
import type { CensorResult, FilterLine, FilterView, PrimeView } from "../../types.ts";
import { FILTER_COPY, censorRefusal, filterOf, loadFilterMemory, pruneDropped, remember, saveFilterMemory, waitingLines, type CensorOutcome, type FilterMemory } from "./model.ts";

export interface FilterApi {
  /** `PrimeView.filter`, or null: this booth is not the censor (or an older server). */
  view: FilterView | null;
  /** The lines still to judge on this phone, oldest first (the tray's n). */
  waiting: FilterLine[];
  /** Lines this sign-in has seen (popped, or only counted). */
  seen: readonly number[];
  /** Changes whenever the waiting list or a refusal does (the driver's dependency). */
  key: string;
  /** Remember lines as seen (the driver, after a plan). */
  markSeen: (seqs: readonly number[]) => void;
  /** Let a line go: off this phone's list for good; never sent. */
  letGo: (seq: number) => void;
  /** ✂: POST it; `done` / `gone` drop the line here until the view catches up. */
  censor: (seq: number) => Promise<CensorOutcome>;
  /** The last refusal for a line, else null. */
  refusal: (seq: number) => string | null;
}

/** What the hook reads off the booth's session. */
export interface FilterSource {
  auth: { token: string } | null;
  view: PrimeView | null;
  censor?: (seq: number) => Promise<CensorResult>;
}

export function useFilter(s: FilterSource, storage: SessionStorage): FilterApi {
  const token = s.auth?.token ?? "";
  const mem = useRef<{ token: string; memory: FilterMemory } | null>(null);
  if (mem.current === null || mem.current.token !== token) mem.current = { token, memory: loadFilterMemory(storage, token) };
  const dropped = useRef(new Set<number>());
  const [refusals, setRefusals] = useState<ReadonlyMap<number, string>>(() => new Map());
  const [, setVersion] = useState(0);
  const source = useRef(s);
  source.current = s;
  const store = useRef(storage);
  store.current = storage;

  const view = filterOf(s.view);
  if (view !== null) pruneDropped(dropped.current, view.lines);
  const memory = mem.current.memory;
  const waiting = waitingLines(view, memory, dropped.current);

  const update = (f: (m: FilterMemory) => FilterMemory) => {
    const cur = mem.current!;
    const next = f(cur.memory);
    if (next === cur.memory) return;
    mem.current = { token: cur.token, memory: next };
    saveFilterMemory(store.current, cur.token, next);
    setVersion((n) => n + 1);
  };
  const forget = (seq: number) =>
    setRefusals((m) => {
      if (!m.has(seq)) return m;
      const next = new Map(m);
      next.delete(seq);
      return next;
    });

  const waitingSeqs = new Set(waiting.map((l) => l.seq));
  const shownRefusals = [...refusals].filter(([seq]) => waitingSeqs.has(seq));
  return {
    view,
    waiting,
    seen: memory.seen,
    key: `${waiting.map((l) => l.seq).join(",")}#${shownRefusals.map(([seq, t]) => `${seq}:${t}`).join("|")}`,
    markSeen: (seqs) => update((m) => remember(m, "seen", seqs)),
    letGo: (seq) => {
      forget(seq);
      update((m) => remember(remember(m, "seen", [seq]), "let", [seq]));
    },
    censor: async (seq) => {
      const call = source.current.censor;
      forget(seq);
      let out: CensorOutcome;
      if (call === undefined) out = { kind: "refused", text: FILTER_COPY.refused.offline };
      else
        try {
          await call(seq);
          out = { kind: "done" };
        } catch (e) {
          out = censorRefusal(e);
        }
      if (out.kind === "refused") {
        const text = out.text;
        setRefusals((m) => new Map(m).set(seq, text));
      } else {
        dropped.current.add(seq);
        update((m) => remember(m, "seen", [seq]));
        setVersion((n) => n + 1);
      }
      return out;
    },
    refusal: (seq) => (waitingSeqs.has(seq) ? (refusals.get(seq) ?? null) : null),
  };
}

// Wave 48 (C5): the censor's filter on one phone, for the booth to share
// between the pop-out driver, the tray's `🔑 n` and the filter window.
// It holds what the pure model needs and the view doesn't say: what this
// sign-in has seen and let go (host storage, `loom.booth.filter.<token>`),
// the lines this phone censored while the next snapshot is on its way, and
// the last refusal per line (said in place). Storage is handed in (the
// booth passes `usePlayHost().storage`), so the hooks harness can drive it.
// Wave 48b (C13): the strength (optimistic: the dial shows the pick until
// the view says it, rolls back and says so on a refusal; one POST at a
// time, the latest pick wins), the ⭐ game's heat with the wall time its
// view arrived (`game`, for `game.tsx`'s live meter), and the last ✂'s
// burst.
// Wave 57 (C15): 🛡 on a line's program, the booth's ordinary press
// (`FilterLine.send`); what came of it, per line, until the line leaves.

import { useRef, useState } from "react";
import type { SessionStorage } from "../../host.ts";
import type { CensorResult, FilterCombo, FilterLevelResult, FilterLine, FilterView, PrimeActResult, PrimeView } from "../../types.ts";
import {
  FILTER_COPY,
  FILTER_SEND_COPY,
  censorDone,
  censorRefusal,
  comboOf,
  filterOf,
  levelOf,
  levelRefusal,
  loadFilterMemory,
  pruneDropped,
  remember,
  saveFilterMemory,
  sendDone,
  sendRefusal,
  snapLevel,
  waitingLines,
  type CensorOutcome,
  type FilterBurstData,
  type FilterMemory,
  type SendOutcome,
} from "./model.ts";

/** The ⭐ game's heat as of a view, and the wall ms that view arrived (C11:
 *  the multiplier decays from the view's arrival). */
export interface FilterGame {
  combo: FilterCombo;
  at: number;
}

export interface FilterApi {
  /** `PrimeView.filter`, or null: this booth is not the censor (or an older server). */
  view: FilterView | null;
  /** The lines still to judge on this phone, oldest first (the tray's n). */
  waiting: FilterLine[];
  /** Lines this sign-in has seen (popped, or only counted). */
  seen: readonly number[];
  /** Changes whenever the waiting list (a line's marks or worth) or a refusal does (the driver's dependency). */
  key: string;
  /** Remember lines as seen (the driver, after a plan). */
  markSeen: (seqs: readonly number[]) => void;
  /** Let a line go: off this phone's list for good; never sent. */
  letGo: (seq: number) => void;
  /** ✂: POST it; `done` / `gone` drop the line here until the view catches up. */
  censor: (seq: number) => Promise<CensorOutcome>;
  /** The last refusal for a line, else null. */
  refusal: (seq: number) => string | null;
  /** Wave 57: 🛡 the line's program (`FilterLine.send`); a refusal is said in place. */
  send: (seq: number) => Promise<SendOutcome>;
  /** Wave 57: what a 🛡 on this line came to, else null. */
  sent: (seq: number) => string | null;
  /** Wave 48b: the strength the dial shows (the pick on its way, else the view's). */
  level: number;
  /** Wave 48b: a strength POST is on its way. */
  saving: boolean;
  /** Wave 48b: the last strength refusal (the dial rolled back), else null. */
  levelError: string | null;
  /** Wave 48b: set the strength (snapped to the dial; posted, latest wins). */
  setLevel: (level: number) => void;
  /** Wave 48b: the ⭐ game's heat, or null (an older server: no game). */
  game: FilterGame | null;
  /** Wave 48b: the last ✂'s "+n ⭐ ×m", until `clearBurst`. */
  burst: FilterBurstData | null;
  clearBurst: () => void;
}

/** What the hook reads off the booth's session. */
export interface FilterSource {
  auth: { token: string } | null;
  view: PrimeView | null;
  censor?: (seq: number) => Promise<CensorResult>;
  filterLevel?: (level: number) => Promise<FilterLevelResult>;
  act?: (name: string, guest?: string | null) => Promise<PrimeActResult>;
}

/** A line's part of the driver's key: its seq, its worth, its marks (a new
 *  strength re-marks a held pop-out in place) and whether 🛡 is on offer. */
const lineSig = (l: FilterLine) => `${l.seq}.${l.points ?? ""}.${(Array.isArray(l.hits) ? l.hits : []).map((h) => `${h.start}-${h.end}-${h.tier ?? ""}`).join("_")}.${l.send?.id ?? ""}`;

export function useFilter(s: FilterSource, storage: SessionStorage): FilterApi {
  const token = s.auth?.token ?? "";
  const mem = useRef<{ token: string; memory: FilterMemory } | null>(null);
  if (mem.current === null || mem.current.token !== token) mem.current = { token, memory: loadFilterMemory(storage, token) };
  const dropped = useRef(new Set<number>());
  const [refusals, setRefusals] = useState<ReadonlyMap<number, string>>(() => new Map());
  const [sentNotes, setSentNotes] = useState<ReadonlyMap<number, string>>(() => new Map());
  const [, setVersion] = useState(0);
  const [levelError, setLevelError] = useState<string | null>(null);
  const [burst, setBurst] = useState<FilterBurstData | null>(null);
  const bursts = useRef(0);
  // The strength picked and not yet in the view, and the one POST in flight.
  const want = useRef<number | null>(null);
  const posting = useRef<{ busy: boolean; next: number | null }>({ busy: false, next: null });
  // The heat re-bases on every view that carries a combo (C11).
  const heat = useRef<{ src: unknown; game: FilterGame | null }>({ src: undefined, game: null });
  const source = useRef(s);
  source.current = s;
  const store = useRef(storage);
  store.current = storage;

  const view = filterOf(s.view);
  if (view !== null) pruneDropped(dropped.current, view.lines);
  const memory = mem.current.memory;
  const waiting = waitingLines(view, memory, dropped.current);
  const viewLevel = levelOf(view);
  // The view caught up with the pick (or the pick was the view's already).
  if (want.current !== null && !posting.current.busy && want.current === viewLevel) want.current = null;
  if (heat.current.src !== view?.combo) {
    const combo = comboOf(view?.combo);
    heat.current = { src: view?.combo, game: combo !== null ? { combo, at: Date.now() } : null };
  }

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

  /** Post the newest pick until none is left; only the last answer decides. */
  const pump = async () => {
    const p = posting.current;
    p.busy = true;
    setVersion((n) => n + 1);
    while (p.next !== null) {
      const level = p.next;
      p.next = null;
      const call = source.current.filterLevel;
      try {
        if (call === undefined) throw new Error("offline");
        const r = await call(level);
        if (p.next === null) want.current = typeof r?.level === "number" ? snapLevel(r.level) : level;
      } catch (e) {
        if (p.next === null) {
          want.current = null;
          setLevelError(call === undefined ? levelRefusal(null) : levelRefusal(e));
        }
      }
    }
    p.busy = false;
    setVersion((n) => n + 1);
  };

  const waitingSeqs = new Set(waiting.map((l) => l.seq));
  const shownRefusals = [...refusals, ...sentNotes].filter(([seq]) => waitingSeqs.has(seq));
  return {
    view,
    waiting,
    seen: memory.seen,
    key: `${waiting.map(lineSig).join(",")}#${shownRefusals.map(([seq, t]) => `${seq}:${t}`).join("|")}`,
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
          out = censorDone(await call(seq));
        } catch (e) {
          out = censorRefusal(e);
        }
      if (out.kind === "refused") {
        const text = out.text;
        setRefusals((m) => new Map(m).set(seq, text));
      } else {
        dropped.current.add(seq);
        update((m) => remember(m, "seen", [seq]));
        if (out.kind === "done" && out.stars !== undefined) {
          bursts.current += 1;
          setBurst({ id: bursts.current, stars: out.stars, mult: out.mult ?? null, points: out.points ?? null });
        }
        setVersion((n) => n + 1);
      }
      return out;
    },
    refusal: (seq) => (waitingSeqs.has(seq) ? (refusals.get(seq) ?? null) : null),
    send: async (seq) => {
      const line = waiting.find((l) => l.seq === seq);
      const call = source.current.act;
      forget(seq);
      let out: SendOutcome;
      if (line?.send === undefined || call === undefined) out = { kind: "refused", text: FILTER_SEND_COPY.refused.notNow };
      else
        try {
          out = sendDone(await call(line.send.id, line.guest), line.name);
        } catch (e) {
          out = sendRefusal(e);
        }
      const { kind, text } = out;
      (kind === "done" ? setSentNotes : setRefusals)((m) => new Map(m).set(seq, text));
      return out;
    },
    sent: (seq) => (waitingSeqs.has(seq) ? (sentNotes.get(seq) ?? null) : null),
    level: want.current ?? viewLevel,
    saving: posting.current.busy,
    levelError,
    setLevel: (n) => {
      const level = snapLevel(n);
      setLevelError(null);
      // Nothing new: the dial already says it (or that pick is on its way).
      if (level === (want.current ?? viewLevel)) return;
      want.current = level;
      posting.current.next = level;
      setVersion((v) => v + 1);
      if (!posting.current.busy) void pump();
    },
    game: view !== null ? heat.current.game : null,
    burst,
    clearBurst: () => setBurst(null),
  };
}

//! The booth's NOW card (wave 13, pinned since the fix round): the live
//! objective for this character, pinned at the top of the booth — the title
//! bar "NOW: <title> · 2/3" (the full title, on up to two lines), then up to
//! three checklist lines, always in view. A to-do the story cannot tick (no
//! `done when`) is the performer's own checkbox, ticked by hand and kept for
//! the sign-in (`ticks.ts`). The drop-down is only for the rest: the brief,
//! which buttons the objective puts on a guest's card, the other to-dos and
//! "More objectives (n)"; a tap outside, Escape or opening a room folds it.
//! With no objective the bar names the character.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { checkCount } from "../ui/objective.tsx";
import { PersonAvatar } from "../ui/primitives.tsx";
import { usePlayHost } from "../host.ts";
import { eventRoot, tappedInside } from "../chrome/balloon.tsx";
import type { Interaction, ObjectiveCheck, ObjectiveView } from "../types.ts";
import { checkDone, loadTicks, saveTicks, tickable, toggleTick, withTicks } from "./ticks.ts";
import { ARM_LINE, useArmButtons } from "../arm.ts";
import { armsFirst } from "./model.ts";
import { pickLayout, type PickLayout } from "./popouts/model.ts";
import type { BoothObjective, ObjectiveTarget } from "./wire.ts";

/** The NOW card's one extra row (wave 18, BOOTH-SPEC §4.5); first match wins. */
export type NowRow =
  | { kind: "board"; n: number }
  | { kind: "target"; target: ObjectiveTarget; place: string | null }
  | { kind: "pick"; layout: Exclude<PickLayout, "target">; n: number; title: string }
  | { kind: "global"; buttons: Interaction[] };

/**
 * Which extra row the NOW card shows: the Wanted board while marks are
 * loose (a booth that gets the board), else the NOW objective's target, else
 * its picker, else its global buttons (C4, ≤ 2), else none.
 */
/** The NOW row's board count: only a booth that may claim (an Antivirus)
 *  leads with the Wanted board; a host keeps its picker row and reads the
 *  LED (BN-F6, §12.6). Null = no board row. */
export function boardRowCount(loose: number, hasBoard: boolean, mayClaim: boolean): number | null {
  return hasBoard && mayClaim ? loose : null;
}

export function nowRow(o: BoothObjective | undefined, opts: { wanted: number | null; interactions: readonly Interaction[]; globals: readonly string[]; placeTitle: (loc: string | null) => string | null }): NowRow | null {
  if (opts.wanted !== null && opts.wanted > 0) return { kind: "board", n: opts.wanted };
  if (o === undefined) return null;
  const layout = pickLayout(o, opts.interactions);
  if (layout === "target" && o.target !== undefined) return { kind: "target", target: o.target, place: opts.placeTitle(o.target.location ?? null) };
  if (layout === "steps" || layout === "rows") return { kind: "pick", layout, n: o.pick?.length ?? 0, title: o.title };
  const byId = new Map(opts.interactions.map((i) => [i.id, i]));
  const globals = o.buttons.filter((id) => opts.globals.includes(id) && byId.has(id)).slice(0, 2).map((id) => byId.get(id)!);
  return globals.length > 0 ? { kind: "global", buttons: globals } : null;
}

/** What the extra row's taps do (the booth binds them). */
export interface NowRowActions {
  onBoard?: () => void;
  onTarget?: (t: ObjectiveTarget) => void;
  onPick?: (objectiveId: string) => void;
  onGlobal?: (id: string) => Promise<unknown>;
}

/** The labels of the story buttons an objective puts on a guest's card. */
export function objectiveButtonLabels(o: Pick<ObjectiveView, "buttons">, interactions: readonly Interaction[]): string[] {
  const byId = new Map(interactions.map((i) => [i.id, i.label]));
  return o.buttons.filter((id) => id !== "pass" && id !== "scan" && byId.has(id)).map((id) => byId.get(id)!);
}

/** The NOW line's count: the shared rule (`ui/objective.tsx` `checkCount`),
 *  with the performer's own ticks counted as done. */
export function nowCount(o: ObjectiveView | Pick<ObjectiveView, "checklist">, ticks: ReadonlySet<string> = new Set()): string {
  return "id" in o ? checkCount(withTicks(o, ticks)) : checkCount(o);
}

/** What a paused show adds to the caption, the Win95 way (the guest's NOW bar's word, D3). */
export const PAUSED = " (Paused)";

/** How many checklist lines the pinned card always shows (2 while the extra row shows: never taller than before). */
export const PINNED_CHECKS = 3;

/**
 * The checklist lines pinned in view: all of them when there are three or
 * fewer; else the first three the story has not ticked (written order),
 * topped up with ticked ones when fewer are left. A performer's own tick
 * never moves a line: the one just ticked stays under the finger, to
 * untick.
 */
export function pinnedChecks(o: ObjectiveView, max: number = PINNED_CHECKS): { shown: number[]; rest: number[] } {
  const all = o.checklist.map((_, i) => i);
  if (all.length <= max) return { shown: all, rest: [] };
  const open = all.filter((i) => o.checklist[i]!.done !== true);
  const pick = new Set(open.slice(0, max));
  for (const i of all) if (pick.size < max) pick.add(i);
  const shown = all.filter((i) => pick.has(i));
  return { shown, rest: all.filter((i) => !pick.has(i)) };
}

/** One to-do line: the story's (a glyph, never tappable) or the performer's own (a checkbox). */
function CheckLine({ o, c, ticks, onTick }: { o: ObjectiveView; c: ObjectiveCheck; ticks: ReadonlySet<string>; onTick: (label: string) => void }) {
  const done = checkDone(c, o.id, ticks);
  if (!tickable(c)) {
    return (
      <li className={`booth-now-check ${done ? "done" : ""}`}>
        {/* A greyed (disabled) check box: the story ticks this one. */}
        <span className="booth-now-box story" aria-hidden title="The story ticks this one">
          {done ? "✓" : ""}
        </span>
        <span className="booth-now-label">
          {c.label}
          <span className="booth-sr">{done ? " (done)" : " (not yet)"}</span>
        </span>
      </li>
    );
  }
  return (
    <li className={`booth-now-check mine ${done ? "done" : ""}`}>
      <button type="button" className="booth-now-tick" role="checkbox" aria-checked={done} title="Tick it when it's done — the story can't tick this one" onClick={() => onTick(c.label)}>
        <span className="booth-now-box" aria-hidden>
          {done ? "✓" : ""}
        </span>
        <span className="booth-now-label">{c.label}</span>
      </button>
    </li>
  );
}

/** Another live objective in the drop-down: its title + count, then its brief and to-dos. */
function OtherObjective({ o, ticks, onTick, hint }: { o: ObjectiveView; ticks: ReadonlySet<string>; onTick: (label: string) => void; hint: ReactNode }) {
  const count = nowCount(o, ticks);
  return (
    <section className="booth-now-other" aria-label={o.title}>
      <div className="booth-now-other-head">
        <span className="booth-now-other-title">{o.title}</span>
        {count !== "" && <span className="booth-now-other-count">{count}</span>}
      </div>
      {o.brief !== "" && <p className="booth-now-brief">{o.brief}</p>}
      {o.checklist.length > 0 && (
        <ul className="booth-now-checks">
          {o.checklist.map((c, i) => (
            <CheckLine key={i} o={o} c={c} ticks={ticks} onTick={onTick} />
          ))}
        </ul>
      )}
      {hint}
    </section>
  );
}

export function NowCard({
  objectives,
  interactions,
  character,
  pill,
  closeKey,
  session = null,
  compact = false,
  paused = false,
  row = null,
  rowActions = {},
}: {
  objectives: readonly ObjectiveView[] | undefined;
  interactions: readonly Interaction[];
  character: string;
  /** "host" / "admin" when the booth holds that capability. */
  pill: string | null;
  /** Folds the drop-down when it changes (the open room). */
  closeKey: string | null;
  /** The sign-in the performer's own ticks belong to (null: kept in memory only). */
  session?: string | null;
  /** The keyboard is up: only the title bar stays (the checklist steps aside). */
  compact?: boolean;
  /** The show is paused (`PrimeView.paused`): the caption greys out and says
   *  "(Paused)", as the guest's NOW bar does (D3). */
  paused?: boolean;
  /** Wave 18 (§4.5): the one extra row under the checklist (`nowRow`). */
  row?: NowRow | null;
  rowActions?: NowRowActions;
}) {
  const host = usePlayHost();
  const [open, setOpen] = useState(false);
  const [ticks, setTicks] = useState<Set<string>>(() => loadTicks(host.storage, session));
  const box = useRef<HTMLDivElement>(null);
  const list = objectives ?? [];
  const now = list[0];
  useEffect(() => setTicks(loadTicks(host.storage, session)), [host.storage, session]);
  useEffect(() => setOpen(false), [closeKey]);
  useEffect(() => {
    if (!open) return;
    // Listen where the card lives: the document, or a Run → Players pane's
    // shadow root (whose host keeps keys from the document).
    const root = eventRoot(box.current);
    const away = (e: Event) => {
      if (box.current !== null && !tappedInside(e, box.current)) setOpen(false);
    };
    const esc = (e: Event) => {
      if ((e as KeyboardEvent).key === "Escape") setOpen(false);
    };
    root.addEventListener("pointerdown", away);
    root.addEventListener("keydown", esc);
    return () => {
      root.removeEventListener("pointerdown", away);
      root.removeEventListener("keydown", esc);
    };
  }, [open]);
  const tick = (o: ObjectiveView) => (label: string) =>
    setTicks((prev) => {
      const next = toggleTick(prev, o.id, label);
      saveTicks(host.storage, session, next);
      return next;
    });
  if (now === undefined) {
    return (
      <div className="booth-now" ref={box}>
        <div className={`booth-now-bar idle${paused ? " paused" : ""}`}>
          <PersonAvatar name={character} size="sm" kind="character" />
          <span className="booth-now-title">
            {character}
            {paused && PAUSED}
          </span>
          {row?.kind === "board" && (
            <button type="button" className="booth-now-chip" aria-label={`Wanted board: ${row.n}`} onClick={rowActions.onBoard}>
              🚨 {row.n}
            </button>
          )}
          {pill !== null && <span className="booth-now-pill">{pill}</span>}
        </div>
        {!compact && row?.kind === "board" && <NowExtra row={row} actions={rowActions} objectiveId="" />}
      </div>
    );
  }
  const count = nowCount(now, ticks);
  const others = list.slice(1);
  const { shown, rest } = pinnedChecks(now, row !== null ? PINNED_CHECKS - 1 : PINNED_CHECKS);
  const hint = (o: ObjectiveView) => {
    const labels = objectiveButtonLabels(o, interactions);
    return labels.length > 0 ? <p className="booth-now-hint">On a guest's card: {labels.join(" · ")}</p> : null;
  };
  const nowHint = hint(now);
  // What the drop-down holds, named on its button: never a toggle for nothing.
  const parts: string[] = [];
  if (now.brief !== "" || nowHint !== null) parts.push("Brief");
  if (rest.length > 0) parts.push(`${rest.length} more to-do${rest.length === 1 ? "" : "s"}`);
  if (others.length > 0) parts.push(`More objectives (${others.length})`);
  const hasMore = parts.length > 0;
  return (
    <div className={`booth-now pinned ${compact ? "compact" : ""}`} ref={box}>
      <div className={`booth-now-bar${paused ? " paused" : ""}`} role="group" aria-label={`Now: ${now.title}${paused ? PAUSED : ""}`}>
        <PersonAvatar name={character} size="sm" kind="character" />
        <span className="booth-now-k">NOW:</span>
        <span className="booth-now-title wrap">
          {now.title}
          {paused && PAUSED}
        </span>
        {count !== "" && <span className="booth-now-count">{count}</span>}
        {row?.kind === "board" && (
          <button type="button" className="booth-now-chip" aria-label={`Wanted board: ${row.n}`} onClick={rowActions.onBoard}>
            🚨 {row.n}
          </button>
        )}
        {pill !== null && <span className="booth-now-pill">{pill}</span>}
      </div>
      {!compact && row !== null && <NowExtra row={row} actions={rowActions} objectiveId={now.id} />}
      {!compact && (shown.length > 0 || hasMore) && (
        <div className="booth-now-body">
          {shown.length > 0 && (
            <ul className="booth-now-checks" aria-label="Checklist">
              {shown.map((i) => (
                <CheckLine key={i} o={now} c={now.checklist[i]!} ticks={ticks} onTick={tick(now)} />
              ))}
            </ul>
          )}
          {hasMore && (
            <button type="button" className="booth-now-more" aria-expanded={open} aria-controls="booth-now-panel" onClick={() => setOpen((v) => !v)}>
              <span aria-hidden>{open ? "▾" : "▸"}</span> {parts.join(" · ")}
            </button>
          )}
        </div>
      )}
      {open && !compact && (
        <div className="booth-now-panel" id="booth-now-panel">
          {now.brief !== "" && <p className="booth-now-brief">{now.brief}</p>}
          {nowHint}
          {rest.length > 0 && (
            <ul className="booth-now-checks">
              {rest.map((i) => (
                <CheckLine key={i} o={now} c={now.checklist[i]!} ticks={ticks} onTick={tick(now)} />
              ))}
            </ul>
          )}
          {others.length > 0 && (
            <>
              <div className="booth-now-h">More objectives ({others.length})</div>
              {others.map((o) => (
                <OtherObjective key={o.id} o={o} ticks={ticks} onTick={tick(o)} hint={hint(o)} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * *Your jobs* (wave 25): a host's NOW card laid open inside the Show
 * window — every live objective with its brief and its whole checklist
 * (the performer's own ticks, kept for the sign-in as on the card), and the
 * card's one extra row under the first. The pinned card steps aside while
 * Show is on screen.
 */
export function NowJobs({
  objectives,
  interactions,
  session = null,
  row = null,
  rowActions = {},
}: {
  objectives: readonly ObjectiveView[] | undefined;
  interactions: readonly Interaction[];
  session?: string | null;
  row?: NowRow | null;
  rowActions?: NowRowActions;
}) {
  const host = usePlayHost();
  const [ticks, setTicks] = useState<Set<string>>(() => loadTicks(host.storage, session));
  useEffect(() => setTicks(loadTicks(host.storage, session)), [host.storage, session]);
  const list = objectives ?? [];
  const tick = (o: ObjectiveView) => (label: string) =>
    setTicks((prev) => {
      const next = toggleTick(prev, o.id, label);
      saveTicks(host.storage, session, next);
      return next;
    });
  const hint = (o: ObjectiveView) => {
    const labels = objectiveButtonLabels(o, interactions);
    return labels.length > 0 ? <p className="booth-now-hint">On a guest's card: {labels.join(" · ")}</p> : null;
  };
  if (list.length === 0) {
    return (
      <div className="booth-now-jobs">
        {row?.kind === "board" && <NowExtra row={row} actions={rowActions} objectiveId="" />}
        <p className="booth-now-jobs-none">No job for you right now. The story gives you one when it needs you.</p>
      </div>
    );
  }
  return (
    <div className="booth-now-jobs">
      {list.map((o, k) => (
        <OtherObjective
          key={o.id}
          o={o}
          ticks={ticks}
          onTick={tick(o)}
          hint={
            <>
              {hint(o)}
              {k === 0 && row !== null && <NowExtra row={row} actions={rowActions} objectiveId={o.id} />}
            </>
          }
        />
      ))}
    </div>
  );
}

/** The NOW card's extra row (§4.5). */
function NowExtra({ row, actions, objectiveId }: { row: NowRow; actions: NowRowActions; objectiveId: string }) {
  const arm = useArmButtons();
  const [busy, setBusy] = useState<string | null>(null);
  if (row.kind === "board") {
    return (
      <button type="button" className="w95-btn booth-now-row alarm" onClick={actions.onBoard}>
        <span>🚨 Wanted board ({row.n})</span>
        <span aria-hidden>▸</span>
      </button>
    );
  }
  if (row.kind === "target") {
    return (
      <button type="button" className="w95-btn booth-now-row" onClick={() => actions.onTarget?.(row.target)}>
        <PersonAvatar name={row.target.name} size="sm" />
        <span className="booth-now-row-text">
          {row.target.name}
          {row.place !== null ? ` · 📍 ${row.place}` : ""}
        </span>
        <span aria-hidden>▸</span>
      </button>
    );
  }
  if (row.kind === "pick") {
    return (
      <button type="button" className="w95-btn booth-now-row" onClick={() => actions.onPick?.(objectiveId)}>
        <span>{row.layout === "steps" ? `🎮 PLAYER SELECT (${row.n})` : `📋 ${row.title} (${row.n})`}</span>
        <span aria-hidden>▸</span>
      </button>
    );
  }
  return (
    <div className="booth-now-globals">
      {row.buttons.map((b) => {
        const armed = arm.armed === b.id;
        return (
          <button
            key={b.id}
            type="button"
            className={`w95-btn booth-btn booth-now-global ${armed ? "armed" : ""}`}
            disabled={busy !== null}
            aria-busy={busy === b.id || undefined}
            onClick={() =>
              arm.tap(b.id, armsFirst(b), () => {
                if (actions.onGlobal === undefined) return;
                setBusy(b.id);
                void actions.onGlobal(b.id).finally(() => setBusy(null));
              })
            }
          >
            {busy === b.id ? `${b.label} …` : armed ? ARM_LINE : b.label}
          </button>
        );
      })}
    </div>
  );
}

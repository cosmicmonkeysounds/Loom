//! The booth's NOW card (wave 13): the live objective for this character,
//! pinned at the top of the booth as one 44 px line — "NOW: <title> · 2/3 ✓".
//! A tap drops the whole card over the stream (brief, checklist, which
//! buttons it puts on a guest's card, and "More objectives (n)"); a tap
//! outside, Escape or opening a room folds it again, so it never sits open
//! over the stream. With no objective the line names the character.

import { useEffect, useRef, useState } from "react";
import { checkCount, ObjectiveCard } from "../ui/objective.tsx";
import { PersonAvatar } from "../ui/primitives.tsx";
import type { Interaction, ObjectiveView } from "../types.ts";

/** The labels of the story buttons an objective puts on a guest's card. */
export function objectiveButtonLabels(o: Pick<ObjectiveView, "buttons">, interactions: readonly Interaction[]): string[] {
  const byId = new Map(interactions.map((i) => [i.id, i.label]));
  return o.buttons.filter((id) => id !== "pass" && id !== "scan" && byId.has(id)).map((id) => byId.get(id)!);
}

export function NowCard({
  objectives,
  interactions,
  character,
  pill,
  closeKey,
}: {
  objectives: readonly ObjectiveView[] | undefined;
  interactions: readonly Interaction[];
  character: string;
  /** "host" / "admin" when the booth holds that capability. */
  pill: string | null;
  /** Folds the card when it changes (the open room). */
  closeKey: string | null;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = objectives ?? [];
  const now = list[0];
  useEffect(() => setOpen(false), [closeKey]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current !== null && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (now === undefined) {
    return (
      <div className="booth-now" ref={box}>
        <div className="booth-now-bar idle">
          <PersonAvatar name={character} size="sm" kind="character" />
          <span className="booth-now-title">{character}</span>
          {pill !== null && <span className="booth-now-pill">{pill}</span>}
        </div>
      </div>
    );
  }
  const count = checkCount(now);
  const others = list.slice(1);
  const hint = (o: ObjectiveView) => {
    const labels = objectiveButtonLabels(o, interactions);
    return labels.length > 0 ? <p className="booth-now-hint">On a guest's card: {labels.join(" · ")}</p> : null;
  };
  return (
    <div className="booth-now" ref={box}>
      <button type="button" className="booth-now-bar" aria-expanded={open} aria-controls="booth-now-panel" onClick={() => setOpen((v) => !v)}>
        <PersonAvatar name={character} size="sm" kind="character" />
        <span className="booth-now-k">NOW:</span>
        <span className="booth-now-title">{now.title}</span>
        {count !== "" && <span className="booth-now-count">{count}</span>}
        {others.length > 0 && <span className="booth-now-count">+{others.length}</span>}
        {pill !== null && <span className="booth-now-pill">{pill}</span>}
        <span className="booth-now-caret" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div className="booth-now-panel" id="booth-now-panel">
          <ObjectiveCard objective={now} />
          {hint(now)}
          {others.length > 0 && (
            <>
              <div className="booth-now-h">More objectives ({others.length})</div>
              {others.map((o) => (
                <div key={o.id}>
                  <ObjectiveCard objective={o} compact />
                  {hint(o)}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

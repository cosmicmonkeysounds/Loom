//! The heart's choice panel (wave 20, CONTRACT-w20 §1.4 item 3, D28; wave
//! 27): the piloted program's docked heart menu under the thread,
//! Fallout-style — a YOUR ANSWER header with the layer, a keyed list (1–9,
//! 0, then letters), hover to light a line, click (or press its key) to say
//! it. A leading `⟦TAG⟧` is drawn as a chip.
//!
//! - **It waits** (`panelGate`): a new menu settles for a moment, then
//!   stays LISTENING… while his reply is still being said (capped), and
//!   while one of his heart scenes plays. Waiting, it takes no click and no
//!   key; a click on it or Space skips his voice to the end (`onSkip`).
//! - **A new menu** flashes in as it opens (its numbers may have shifted),
//!   and lights nothing under a resting pointer until the pointer moves.
//! - **The door open**: CLOSE THE DOOR above the greyed options, never over them.
//! - **The ⟦BACK⟧ menu** of a heart to heart is a bar under the composer (Esc picks it).

import "./heart.css";
import { useEffect, useRef, useState } from "react";
import { layerLabel, optionKey, optionOfKey, panelGate, panelModel, type HeartMenu } from "./heart.ts";

export function ChoicePanel({
  menu,
  doorOpen,
  onPick,
  numberKeys,
  onActivity,
  voiceBusy = false,
  sceneEndsAt = 0,
  layer = null,
  onSkip,
}: {
  menu: HeartMenu;
  /** The door, as the panel reads it (`doorOpenNow`). */
  doorOpen: boolean | null;
  /** Say option `index` of this menu; rejects with the reason it didn't land. */
  onPick: (index: number) => Promise<void>;
  /** Number keys pick (no composer is taking the keys). */
  numberKeys: boolean;
  onActivity: () => void;
  /** His reply is still being said (the speech queue, a reveal, the room voice). */
  voiceBusy?: boolean;
  /** One of his heart scenes is on screen until this (local ms; 0: none). */
  sceneEndsAt?: number;
  /** The layer this menu belongs to (the header), null: unknown. */
  layer?: number | null;
  /** Skip his voice to the end (a click or Space while it waits on him). */
  onSkip?: () => void;
}) {
  const model = panelModel(menu, doorOpen)!;
  const [sending, setSending] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [fresh, setFresh] = useState(true);
  // When this menu docked, and whether it has opened (both per menu id).
  const dock = useRef<{ id: number; at: number; opened: boolean }>({ id: -1, at: 0, opened: false });
  if (dock.current.id !== menu.id) dock.current = { id: menu.id, at: Date.now(), opened: false };
  const now = Date.now();
  const gate = panelGate({ sinceDock: now - dock.current.at, voiceBusy, sceneLeft: Math.max(0, sceneEndsAt - now), wasOpen: dock.current.opened });
  if (gate.open) dock.current.opened = true;
  const open = gate.open;
  // Look again when the answer can change by itself (the settle, the cap, a scene's end).
  const [, tick] = useState(0);
  useEffect(() => {
    if (gate.recheck === null) return;
    const t = window.setTimeout(() => tick((n) => n + 1), gate.recheck + 30);
    return () => window.clearTimeout(t);
  }, [gate.recheck === null ? null : Math.round(now + gate.recheck), menu.id]);

  // A new menu (or the same one re-docked) starts clean.
  useEffect(() => {
    setSending(null);
    setProblem(null);
    setFresh(true);
  }, [menu.id]);

  const pick = (index: number) => {
    onActivity();
    if (!open || model.greyed || sending !== null) return;
    setSending(index);
    setProblem(null);
    onPick(index).then(
      () => setSending(null),
      (e: Error) => {
        setSending(null);
        setProblem(e.message);
      },
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as { tagName?: string } | null)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if (model.chat) {
        if (e.key === "Escape") {
          e.preventDefault();
          pick(0);
        }
        return;
      }
      if (!numberKeys || typing) return;
      if (!open) {
        if (e.key === " " && gate.wait === "voice" && onSkip !== undefined) {
          e.preventDefault();
          onSkip();
        }
        return; // a key while he speaks, or a scene plays, never picks
      }
      const i = optionOfKey(e.key, model.options.length);
      if (i !== null) {
        e.preventDefault();
        pick(i);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // A scroll cue when the list is taller than its room.
  const list = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measure = () => {
    const el = list.current;
    if (el !== null) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  };
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [menu.id, model.options.length, open]);

  if (model.chat) {
    const o = model.options[0]!;
    return (
      <div className="heart-back" data-menu={menu.id}>
        <span className="heart-back-note">TALKING FREELY</span>
        <button type="button" className="heart-back-btn" disabled={model.greyed || sending !== null} onClick={() => pick(0)} title={o.raw}>
          {o.tag !== null && <span className="heart-tag">{o.tag}</span>}
          {o.text}
          <span className="heart-back-key">ESC</span>
        </button>
      </div>
    );
  }

  const label = layerLabel(layer);
  const state = !open ? " waiting" : "";
  return (
    <div
      className={`heart-panel${model.greyed ? " greyed" : ""}${state}${fresh ? " fresh" : ""}${more ? " more" : ""}`}
      role="listbox"
      aria-label="Your answer"
      aria-busy={!open}
      data-menu={menu.id}
      data-open={String(open)}
      onPointerMove={() => fresh && setFresh(false)}
      onClick={() => {
        if (!open && gate.wait === "voice") onSkip?.();
      }}
    >
      <div className="heart-head">
        <span className="heart-head-title">YOUR ANSWER</span>
        {!open ? (
          <span className="heart-head-wait">
            {gate.wait === "scene" ? "…" : "LISTENING"}
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
            {gate.wait === "voice" && onSkip !== undefined && <span className="heart-head-skip">{numberKeys ? "SPACE / CLICK TO SKIP" : "TAP TO SKIP"}</span>}
          </span>
        ) : (
          label !== "" && <span className="heart-head-layer">{label}</span>
        )}
      </div>
      {model.greyed && <div className="heart-panel-door">⚠ CLOSE THE DOOR</div>}
      <div className="heart-list" ref={list} onScroll={measure}>
        <ol className="heart-options" key={`${menu.id}:${open ? "open" : "wait"}`}>
          {model.options.map((o) => (
            <li key={`${menu.id}:${o.index}`}>
              <button
                type="button"
                className={`heart-option${sending === o.index ? " sending" : ""}`}
                disabled={!open || model.greyed || (sending !== null && sending !== o.index)}
                tabIndex={open ? undefined : -1}
                onClick={() => pick(o.index)}
                onMouseEnter={onActivity}
                aria-label={o.raw}
              >
                <span className="heart-num">{optionKey(o.index) ?? "·"}</span>
                {o.tag !== null && <span className="heart-tag">{o.tag}</span>}
                <span className="heart-text">{o.text}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      {more && <div className="heart-more" aria-hidden="true">▼ MORE</div>}
      {problem !== null && <div className="heart-problem">{problem}</div>}
    </div>
  );
}

//! The moments' surfaces (wave 13, the moments lane): each rung of the
//! interrupt ladder is the Win95 part that does that job — a system-tray
//! balloon tip, a sticky notification bar, a modal message box with OK, the
//! blue screen — plus the quiet feedback toast, the "You missed n moments"
//! list and the glitch that plays when the story changes the level. Plain
//! markup over `w95-*` primitives and lane classes (`moments-…`), every
//! colour from a token, so `plain` renders the same structure flat.

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { WinDialog } from "../ui/window.tsx";
import { faultAddress, type Moment, type Queued } from "./model.ts";

/** Taps this soon after a modal appears are ignored (a tap meant for the app underneath). */
export const MODAL_DEAD_MS = 400;

type IconKind = "warning" | "info";

/** Which Win95 icon a moment carries: a major moment is a warning, a minor one information. */
export function iconOf(m: Pick<Moment, "severity">): IconKind {
  return m.severity === "major" ? "warning" : "info";
}

/** The Win95 message-box icons, drawn (32 × 32 grid). */
export function MomentIcon({ kind, size = 32 }: { kind: IconKind; size?: number }) {
  return (
    <svg className={`moments-ico moments-ico-${kind}`} width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      {kind === "warning" && (
        <>
          <path className="moments-ico-warn" d="M16 2.5 30.5 28.5H1.5Z" />
          <rect className="moments-ico-mark" x="14.4" y="10" width="3.2" height="10.5" />
          <rect className="moments-ico-mark" x="14.4" y="22.6" width="3.2" height="3.2" />
        </>
      )}
      {kind === "info" && (
        <>
          <path className="moments-ico-bubble" d="M16 2.5c7.2 0 12.5 4.9 12.5 11.2S23.2 25 16 25c-1 0-2-.1-3-.3L6.5 29.5l1.8-6.2C5.2 21.3 3.5 17.8 3.5 13.7 3.5 7.4 8.8 2.5 16 2.5Z" />
          <rect className="moments-ico-i" x="14.3" y="6.4" width="3.4" height="3.4" />
          <rect className="moments-ico-i" x="14.3" y="11.6" width="3.4" height="9.4" />
        </>
      )}
    </svg>
  );
}

/** A moment's body: an objective's title in bold over its brief, else the text. */
function MomentText({ m, className }: { m: Moment; className: string }) {
  if (m.kind === "objective") {
    const [title, ...rest] = m.text.split("\n");
    return (
      <div className={className}>
        <strong className="moments-objective-title">{title}</strong>
        {rest.length > 0 && <span className="moments-objective-brief">{rest.join("\n")}</span>}
      </div>
    );
  }
  return <div className={className}>{m.text}</div>;
}

/** The exit a moment offers: its room, or the pass. */
function goLabel(m: Moment): string {
  return m.pass === true ? "Show my pass" : "Take me there";
}

/** Ignore taps for the first `MODAL_DEAD_MS` (a modal never eats a tap meant for what was under it). */
function useDeadTime(): () => boolean {
  const since = useRef(Date.now());
  return () => Date.now() - since.current >= MODAL_DEAD_MS;
}

// --- balloon ------------------------------------------------------------------

/** The system-tray balloon tip: bottom-right, its tail on the tray, times out (provider). */
export function Balloon({ q, canGo, onGo, onDismiss }: { q: Queued; canGo: boolean; onGo: () => void; onDismiss: () => void }) {
  const m = q.moment;
  return (
    <div className={`moments-balloon ${m.severity}`} role={m.severity === "major" ? "alert" : "status"} aria-live={m.severity === "major" ? "assertive" : "polite"}>
      <div className="moments-balloon-head">
        <MomentIcon kind={iconOf(m)} size={18} />
        <span className="moments-balloon-caption">{m.caption}</span>
        <button type="button" className="moments-balloon-x" aria-label="Close" onClick={onDismiss}>
          <span aria-hidden>×</span>
        </button>
      </div>
      <MomentText m={m} className="moments-balloon-text" />
      {canGo && (
        <button type="button" className="moments-balloon-go" onClick={onGo}>
          {goLabel(m)} ›
        </button>
      )}
    </div>
  );
}

// --- sticky -------------------------------------------------------------------

/** The sticky notification bar: under the title bar, in flow, until tapped. */
export function StickyBanner({ q, count, canGo, onGo, onDismiss }: { q: Queued; count: number; canGo: boolean; onGo: () => void; onDismiss: () => void }) {
  const m = q.moment;
  return (
    <div className={`moments-sticky ${m.severity}`} role={m.severity === "major" ? "alert" : "status"}>
      <button type="button" className="moments-sticky-body" onClick={onDismiss} aria-label={`${m.caption}: ${m.text}. Tap to dismiss.`}>
        <span className="moments-sticky-icon">
          <MomentIcon kind={iconOf(m)} size={24} />
        </span>
        <span className="moments-sticky-words">
          <span className="moments-sticky-caption">
            {m.caption}
            {count > 1 && <span className="moments-count"> · 1 of {count}</span>}
          </span>
          <MomentText m={m} className="moments-sticky-text" />
        </span>
      </button>
      <span className="moments-sticky-actions">
        {canGo && (
          <button type="button" className="w95-btn moments-go" onClick={onGo}>
            {goLabel(m)} ›
          </button>
        )}
        <button type="button" className="w95-btn moments-sticky-x" aria-label="Dismiss" onClick={onDismiss}>
          <span aria-hidden>×</span>
        </button>
      </span>
    </div>
  );
}

// --- dialog -------------------------------------------------------------------

/** The modal message box: caption, icon, text, OK (focused), "1 of 3". */
export function MomentDialog({ q, index, total, canGo, onGo, onDismiss }: { q: Queued; index: number; total: number; canGo: boolean; onGo: () => void; onDismiss: () => void }) {
  const m = q.moment;
  const ok = useRef<HTMLButtonElement>(null);
  const live = useDeadTime();
  // WinDialog focuses its first control (the caption's ×); a message box's default is OK.
  useEffect(() => {
    const t = window.setTimeout(() => ok.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);
  const guard = (fn: () => void) => () => {
    if (live()) fn();
  };
  return (
    <WinDialog title={m.caption} onClose={guard(onDismiss)} tone={m.severity === "major" && m.kind === "alert" ? "alarm" : undefined} label={`${m.caption}: ${m.text}`}>
      <div className="moments-dialog">
        <div className="moments-dialog-row">
          <MomentIcon kind={iconOf(m)} />
          <MomentText m={m} className="moments-dialog-text" />
        </div>
        <div className="moments-dialog-foot">
          {total > 1 ? (
            <span className="moments-dialog-count w95-inset" aria-label={`Message ${index} of ${total}`}>
              {index} of {total}
            </span>
          ) : (
            <span />
          )}
          <span className="moments-dialog-buttons">
            {canGo && (
              <button type="button" className="w95-btn" onClick={guard(onGo)}>
                {goLabel(m)}
              </button>
            )}
            <button ref={ok} type="button" className="w95-btn moments-ok" onClick={guard(onDismiss)}>
              OK
            </button>
          </span>
        </div>
      </div>
    </WinDialog>
  );
}

// --- blue screen ----------------------------------------------------------------

/** The blue screen: the whole phone, white on blue, "Press any key to continue". */
export function BlueScreen({ q, index, total, canGo, onGo, onDismiss }: { q: Queued; index: number; total: number; canGo: boolean; onGo: () => void; onDismiss: () => void }) {
  const m = q.moment;
  const box = useRef<HTMLDivElement>(null);
  const live = useDeadTime();
  useEffect(() => {
    const before = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    box.current?.focus();
    return () => before?.focus?.();
  }, []);
  const onClick = () => {
    if (live()) onDismiss();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") {
      // Two stops: the screen and its one button.
      e.preventDefault();
      const btn = box.current?.querySelector<HTMLButtonElement>("button");
      if (btn && document.activeElement !== btn) btn.focus();
      else box.current?.focus();
      return;
    }
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    if ((e.target as HTMLElement).tagName === "BUTTON" && (e.key === "Enter" || e.key === " ")) return;
    e.preventDefault();
    if (live()) onDismiss();
  };
  const go = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (live()) onGo();
  };
  const head = (m.caption || "Windows").toUpperCase();
  return (
    <div ref={box} className="moments-bsod" role="alertdialog" aria-modal="true" aria-labelledby="moments-bsod-head" aria-describedby="moments-bsod-text" tabIndex={-1} onClick={onClick} onKeyDown={onKey}>
      <div className="moments-bsod-inner">
        <div className="moments-bsod-headrow">
          <span id="moments-bsod-head" className="moments-bsod-head">
            {head}
          </span>
          {total > 1 && (
            <span className="moments-bsod-count">
              {index} of {total}
            </span>
          )}
        </div>
        <p className="moments-bsod-fault">
          A fatal exception 0E has occurred at {faultAddress(m.key)}. The current program has stopped to show you this:
        </p>
        <MomentText m={m} className="moments-bsod-text" />
        <ul className="moments-bsod-list">
          <li>Tap anywhere to continue.</li>
          {canGo && (
            <li>
              <button type="button" className="moments-bsod-go" onClick={go}>
                {goLabel(m)}
              </button>
            </li>
          )}
        </ul>
        <p id="moments-bsod-text" className="moments-bsod-press">
          Press any key to continue <span className="moments-bsod-caret" aria-hidden>_</span>
        </p>
      </div>
    </div>
  );
}

// --- missed list -------------------------------------------------------------------

/** "You missed n moments": every one in order, each with its exit. */
export function MissedList({ moments, canGo, onGo, onClose }: { moments: readonly Moment[]; canGo: (m: Moment) => boolean; onGo: (m: Moment) => void; onClose: () => void }) {
  const live = useDeadTime();
  const guard = (fn: () => void) => () => {
    if (live()) fn();
  };
  return (
    <WinDialog title={`You missed ${moments.length} moments`} onClose={guard(onClose)} label={`You missed ${moments.length} moments`}>
      <div className="moments-missed">
        <ol className="moments-missed-list w95-inset">
          {moments.map((m) => (
            <li key={m.key} className="moments-missed-row">
              <MomentIcon kind={iconOf(m)} size={20} />
              <span className="moments-missed-words">
                <span className="moments-missed-caption">{m.caption}</span>
                <span className="moments-missed-text">{m.text}</span>
              </span>
              {canGo(m) && (
                <button type="button" className="w95-btn moments-missed-go" aria-label={`${goLabel(m)}: ${m.caption}`} onClick={guard(() => onGo(m))}>
                  Go ›
                </button>
              )}
            </li>
          ))}
        </ol>
        <div className="moments-dialog-foot">
          <span />
          <button type="button" className="w95-btn moments-ok" onClick={guard(onClose)}>
            OK
          </button>
        </div>
      </div>
    </WinDialog>
  );
}

// --- toast + glitch ----------------------------------------------------------------

/** The quiet feedback toast (✔ Done, a refusal): a status strip, never an alarm. */
export function Toast({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <button type="button" className="moments-toast" role="status" onClick={onDismiss} aria-label={`${text}. Tap to dismiss.`}>
      {text}
    </button>
  );
}

/** The level-change glitch: its own overlay, never a filter on the app. */
export function Glitch() {
  const [still, setStill] = useState(false);
  useEffect(() => {
    setStill(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true);
  }, []);
  return <div className={`moments-glitch ${still ? "still" : ""}`} aria-hidden />;
}

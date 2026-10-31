// Win95 windows (wave 13; the chrome lane refines them, never renames):
// `WinWindow` — a window with its caption bar — and `WinDialog`, a modal
// dialog box built as divs (no `<dialog>`: Safari 15.4) with the focus
// trapped by hand. Under `plain` the same markup renders flat (`w95.css`
// takes every colour and bevel from the tokens).

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { focusedIn } from "./focus.ts";

/** A caption bar's tone: the normal title gradient, alarm red, restricted ochre. */
export type WinTone = "alarm" | "restricted";

export function WinWindow({ title, onClose, tone, children, className }: { title: ReactNode; onClose?: () => void; tone?: WinTone; children?: ReactNode; className?: string }) {
  return (
    <div className={`w95-window ${className ?? ""}`}>
      <div className={`w95-titlebar ${tone ?? ""}`}>
        <span className="w95-title">{title}</span>
        {onClose && (
          <button type="button" className="w95-btn w95-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The elements Tab may reach inside `root`, in order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

/** Where Tab (or Shift+Tab) moves next inside a trap: wraps at either end.
 *  `current` is the index of the focused element (-1 when focus is outside). */
export function trapNext(count: number, current: number, back: boolean): number {
  if (count === 0) return -1;
  if (current < 0) return back ? count - 1 : 0;
  return back ? (current - 1 + count) % count : (current + 1) % count;
}

/**
 * A modal dialog box: a scrim over the app, the window centred, focus moved
 * in on open (the first control) and kept in (Tab wraps), Escape closes,
 * and focus goes back where it was on close.
 */
export function WinDialog({ title, onClose, tone, children, label }: { title: ReactNode; onClose: () => void; tone?: WinTone; children?: ReactNode; label?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = focusedIn(box.current) as HTMLElement | null;
    const el = box.current;
    if (el !== null) (focusables(el)[0] ?? el).focus();
    return () => before?.focus?.();
  }, []);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close.current();
      return;
    }
    if (e.key !== "Tab" || box.current === null) return;
    const list = focusables(box.current);
    const at = list.indexOf(focusedIn(box.current) as HTMLElement);
    const next = trapNext(list.length, at, e.shiftKey);
    e.preventDefault();
    if (next >= 0) list[next]!.focus();
  };
  return (
    <div className="w95-dialog-backdrop">
      <div ref={box} className="w95-dialog" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={onKey}>
        <WinWindow title={title} onClose={onClose} tone={tone}>
          <div className="w95-body">{children}</div>
        </WinWindow>
      </div>
    </div>
  );
}

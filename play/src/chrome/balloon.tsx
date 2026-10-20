//! The system tray's balloon tip (wave 13): the yellow Win95 tooltip that
//! rises out of the tray when a tray item is tapped — the countdown's full
//! wording, the balance's holds, the one-time "Get alerts" offer. It sits
//! just above the taskbar at the right, closes on a tap anywhere else or by
//! itself after a while (like the real one), and never covers the stream
//! for long. The alerts offer is the exception: it stays until answered. Under `plain` it is a plain white tip (the tokens).
//!
//! This is the chrome's own tray tip; the interrupt ladder's `balloon` rung
//! is the moments lane's (`moments/**`), drawn the same way.

import { useEffect, useRef, type ReactNode } from "react";

/** How long a tray balloon stays up untouched. */
export const BALLOON_MS = 8000;

/** The part of the page that counts as "inside" a balloon: the tray slot
 *  it rose from (its own tap toggles it), else the tip itself. */
export function balloonScope(el: Element): Element {
  return el.parentElement?.classList.contains("tray-slot") === true ? el.parentElement : el;
}

/** Was this tap inside `scope`? Read off the event's composed path, so a tap
 *  inside an embedded pane (the editor's Run → Players shadow roots, where a
 *  listener sees `e.target` retargeted to the shadow host) still counts as
 *  inside (pure — `test/balloon.test.ts`). */
export function tappedInside(e: { target: EventTarget | null; composedPath?: () => EventTarget[] }, scope: Node): boolean {
  const path = typeof e.composedPath === "function" ? e.composedPath() : [];
  if (path.length > 0) return path.includes(scope);
  return e.target !== null && typeof (e.target as Node).nodeType === "number" && scope.contains(e.target as Node);
}

/** Where a chrome part listens for keys and taps: its own root — the
 *  document, or an embedded pane's shadow root (whose host stops keys
 *  before they reach the document). */
export function eventRoot(el: Node | null | undefined): Document | ShadowRoot {
  const r = el?.getRootNode?.();
  return r !== undefined && r !== null && typeof (r as Document | ShadowRoot).addEventListener === "function" && (r as Node).nodeType !== 1 ? (r as Document | ShadowRoot) : document;
}

/** A tray item with its balloon: one tray slot (the tray counts slots for
 *  its three-item rule, and the balloon's tap-away ignores its own item). */
export function TraySlot({ children }: { children: ReactNode }) {
  return <span className="tray-slot">{children}</span>;
}

export function TrayBalloon({
  title,
  children,
  onClose,
  timeoutMs = BALLOON_MS,
  label,
  floating = false,
  closeOnTapAway = true,
}: {
  title?: ReactNode;
  children?: ReactNode;
  onClose: () => void;
  /** null: stays until tapped away (the alerts offer). */
  timeoutMs?: number | null;
  label?: string;
  /** Not inside the tray (the alerts offer): pinned over the tray's corner of the screen. */
  floating?: boolean;
  /** false: a tap elsewhere leaves it up (the alerts offer only goes on its own buttons or Escape). */
  closeOnTapAway?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const t = timeoutMs === null ? null : setTimeout(() => close.current(), timeoutMs);
    const el = box.current;
    if (el === null) {
      return () => {
        if (t !== null) clearTimeout(t);
      };
    }
    // Listen where the tip lives: the document, or an embedded pane's shadow
    // root (whose host swallows keys before they reach the document).
    const root = eventRoot(el);
    // A tap anywhere outside the tip closes it (the tray item it rose from
    // toggles it itself). Registered on the next tick so the opening tap
    // doesn't close it at once.
    const away = (e: Event) => {
      if (!tappedInside(e, balloonScope(el))) close.current();
    };
    const key = (e: Event) => {
      if ((e as KeyboardEvent).key === "Escape") close.current();
    };
    const on = setTimeout(() => {
      if (closeOnTapAway) root.addEventListener("pointerdown", away, true);
      root.addEventListener("keydown", key);
    }, 0);
    return () => {
      if (t !== null) clearTimeout(t);
      clearTimeout(on);
      root.removeEventListener("pointerdown", away, true);
      root.removeEventListener("keydown", key);
    };
  }, [timeoutMs, closeOnTapAway]);
  return (
    <div ref={box} className={`tray-balloon${floating ? " floating" : ""}`} role="status" aria-label={label}>
      {title !== undefined && <div className="tray-balloon-title">{title}</div>}
      {children !== undefined && <div className="tray-balloon-body">{children}</div>}
    </div>
  );
}

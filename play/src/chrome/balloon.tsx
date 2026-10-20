//! The system tray's balloon tip (wave 13): the yellow Win95 tooltip that
//! rises out of the tray when a tray item is tapped — the countdown's full
//! wording, the balance's holds, the one-time "Get alerts" offer. It sits
//! just above the taskbar at the right, closes on a tap anywhere else or by
//! itself after a while (like the real one), and never covers the stream
//! for long. Under `plain` it is a plain white tip (the tokens).
//!
//! This is the chrome's own tray tip; the interrupt ladder's `balloon` rung
//! is the moments lane's (`moments/**`), drawn the same way.

import { useEffect, useRef, type ReactNode } from "react";

/** How long a tray balloon stays up untouched. */
export const BALLOON_MS = 8000;

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
}: {
  title?: ReactNode;
  children?: ReactNode;
  onClose: () => void;
  /** null: stays until tapped away (the alerts offer). */
  timeoutMs?: number | null;
  label?: string;
  /** Not inside the tray (the alerts offer): pinned over the tray's corner of the screen. */
  floating?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const t = timeoutMs === null ? null : setTimeout(() => close.current(), timeoutMs);
    // A tap anywhere outside the tip closes it (the tray item it rose from
    // toggles it itself). Registered on the next tick so the opening tap
    // doesn't close it at once.
    const away = (e: Event) => {
      const el = box.current;
      // Inside the tip, or on the tray item it rose from (its own tap toggles).
      const scope = el?.parentElement?.classList.contains("tray-slot") === true ? el.parentElement : el;
      if (scope !== null && scope !== undefined && e.target instanceof Node && scope.contains(e.target)) return;
      close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    const on = setTimeout(() => {
      document.addEventListener("pointerdown", away, true);
      document.addEventListener("keydown", key);
    }, 0);
    return () => {
      if (t !== null) clearTimeout(t);
      clearTimeout(on);
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key);
    };
  }, [timeoutMs]);
  return (
    <div ref={box} className={`tray-balloon${floating ? " floating" : ""}`} role="status" aria-label={label}>
      {title !== undefined && <div className="tray-balloon-title">{title}</div>}
      {children !== undefined && <div className="tray-balloon-body">{children}</div>}
    </div>
  );
}

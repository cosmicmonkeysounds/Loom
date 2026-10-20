//! A booth window over the app (wave 13): full screen on a phone, a centred
//! Win95 window on a wide screen. The scanner, a guest's card and the
//! Guests list open in one; Escape and × close it. Every one is a busy
//! surface for the moments layer (no dialog or blue screen covers it).

import { useEffect, useRef, type ReactNode } from "react";
import { useMomentsHold } from "../moments/provider.tsx";
import { WinWindow } from "../ui/window.tsx";

export function BoothLayer({ title, onClose, children, label, foot }: { title: ReactNode; onClose: () => void; children: ReactNode; label: string; foot?: ReactNode }) {
  useMomentsHold(true);
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, []);
  return (
    <div className="booth-layer" role="dialog" aria-modal="true" aria-label={label}>
      <div className="booth-layer-box" ref={box} tabIndex={-1}>
        <WinWindow title={title} onClose={onClose} className="booth-layer-win">
          <div className="booth-layer-body">{children}</div>
          {foot !== undefined && <div className="booth-layer-foot">{foot}</div>}
        </WinWindow>
      </div>
    </div>
  );
}

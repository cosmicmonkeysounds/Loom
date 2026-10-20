//! A booth window over the app (wave 13): full screen on a phone, a centred
//! Win95 window on a wide screen. The scanner, a guest's card and the
//! Guests list open in one; Escape and × close it. It is a real modal:
//! focus moves in on open, Tab stays inside (built by hand, as `WinDialog`
//! does), and focus goes back where it was on close. A sheet opened inside
//! it (the card's "Share lore…") takes Escape first. Every one is a busy
//! surface for the moments layer (no dialog or blue screen covers it).

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { usePlayHost } from "../host.ts";
import { useMomentsHold } from "../moments/provider.tsx";
import { WinWindow, focusables, trapNext } from "../ui/window.tsx";

/** Is Escape the booth window's to take? Not while a sheet or dialog is
 *  open inside it (the card's "Share lore…" picker): that one closes first,
 *  wherever focus sits. */
export function escapeIsOurs(layer: Pick<Element, "querySelector"> | null): boolean {
  return layer !== null && layer.querySelector('[role="dialog"]') === null;
}

/** The controls Tab may reach in the window: never one under an `inert`
 *  part (the scanner's camera, kept running under a card). */
function tabStops(root: HTMLElement): HTMLElement[] {
  return focusables(root).filter((el) => el.closest("[inert]") === null);
}

export function BoothLayer({ title, onClose, children, label, foot }: { title: ReactNode; onClose: () => void; children: ReactNode; label: string; foot?: ReactNode }) {
  useMomentsHold(true);
  const host = usePlayHost();
  const root = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    box.current?.focus();
    // On the host's key target: `window` on a phone (Escape still closes
    // with focus left on the body), the pane's own frame in Run → Players
    // (its shadow host stops keys before they reach the window).
    const target = host.keyTarget();
    const onKey = (e: Event) => {
      if ((e as KeyboardEvent).key === "Escape" && escapeIsOurs(root.current)) close.current();
    };
    target?.addEventListener("keydown", onKey);
    return () => {
      target?.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || box.current === null) return;
    const list = tabStops(box.current);
    const next = trapNext(list.length, list.indexOf(document.activeElement as HTMLElement), e.shiftKey);
    e.preventDefault();
    if (next >= 0) list[next]!.focus();
  };
  return (
    <div className="booth-layer" role="dialog" aria-modal="true" aria-label={label} ref={root}>
      <div className="booth-layer-box" ref={box} tabIndex={-1} onKeyDown={onTab}>
        <WinWindow title={title} onClose={onClose} className="booth-layer-win">
          <div className="booth-layer-body">{children}</div>
          {foot !== undefined && <div className="booth-layer-foot">{foot}</div>}
        </WinWindow>
      </div>
    </div>
  );
}

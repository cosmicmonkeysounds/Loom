//! Typing in the host console (wave 13): the keyboard rule hides the NEXT
//! bar and the taskbar, never the open drawer or a sheet, and never the
//! field being typed into. On a phone the on-screen keyboard covers the
//! bottom of the layout viewport (iOS Safari and Chrome ≥ 108 resize only
//! the *visual* viewport), so the drawer, anchored to the dock at the
//! bottom, would sit under it: while a field in the dock has focus the
//! drawer lifts by the part the keyboard covers and shrinks to the visible
//! height, and a sheet's backdrop (the answer-as-Trabolta sheet, the award
//! picker) is fitted to the visible viewport. Desktop keyboards and the
//! embedded Players panes cover nothing, so nothing moves there.

import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { isTextEntry } from "../chrome/keyboard.ts";

/** The dock's three states while the keyboard rule runs (pure). */
export interface DockKeyboard {
  /** Render the dock at all (its drawer, a picker sheet). */
  render: boolean;
  /** Show the NEXT bar. */
  bar: boolean;
}

/**
 * `keyboard`: a text field in the frame has focus (the frame's rule).
 * `inDock`: that field is inside the dock (the drawer, the award picker, the
 * answer sheet). A field elsewhere (the room composer) hides the whole dock
 * unless the drawer is open; a field inside it hides only the NEXT bar.
 */
export function dockKeyboard(keyboard: boolean, inDock: boolean, open: boolean): DockKeyboard {
  if (!keyboard) return { render: true, bar: true };
  if (inDock) return { render: true, bar: false };
  return open ? { render: true, bar: true } : { render: false, bar: false };
}

/** How far the drawer lifts and how tall it may be so its bottom edge sits
 *  on the keyboard's top (pure). Null when the keyboard covers none of it. */
export interface KeyboardFit {
  /** Px the drawer's bottom rises above the dock's top. */
  lift: number;
  /** The visible height the drawer may fill; null when no keyboard covers
   *  it (the drawer keeps its own height). */
  height: number | null;
}

/**
 * The drawer's bottom edge stays where it sat before typing began
 * (`restTop`: the dock's top with the NEXT bar and the taskbar showing), so
 * hiding them never slides the console under a finger or a mouse — a click
 * whose press blurred the field still lands on the row it was aimed at — and
 * it rises further to the keyboard's top when one covers it.
 */
export function keyboardFit(dockTop: number, vvTop: number, vvHeight: number, restTop: number | null = null): KeyboardFit | null {
  const visibleBottom = vvTop + vvHeight;
  const target = restTop !== null ? Math.min(restTop, visibleBottom) : visibleBottom;
  const lift = Math.round(dockTop - target);
  if (!(lift >= 1)) return null;
  const covered = visibleBottom < (restTop ?? dockTop) - 1;
  return { lift, height: covered ? Math.max(120, Math.floor(vvHeight - 8)) : null };
}

/** useLayoutEffect in a browser (no flash of a slid drawer), useEffect on
 *  the server render the tests use. */
export const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Does a text entry inside `el` have focus (the shadow root's focus too)? */
export function focusInside(el: HTMLElement | null): boolean {
  if (el === null || typeof document === "undefined") return false;
  const root = el.getRootNode() as Document | ShadowRoot;
  const a = root.activeElement ?? document.activeElement;
  return a !== null && el.contains(a) && isTextEntry(a);
}

/** Tracks `focusInside(el)` through focus moving in and out of `el`. */
export function useFocusInside(el: HTMLElement | null): boolean {
  const [inside, setInside] = useState(false);
  useEffect(() => {
    if (el === null) {
      setInside(false);
      return;
    }
    const read = () => setInside(focusInside(el));
    // focusout fires before focus lands elsewhere: read on the next tick.
    const later = () => setTimeout(read, 0);
    el.addEventListener("focusin", read);
    el.addEventListener("focusout", later);
    read();
    return () => {
      el.removeEventListener("focusin", read);
      el.removeEventListener("focusout", later);
    };
  }, [el]);
  return inside;
}

/** Holds a `true` for `ms` after it goes false: the NEXT bar comes back a
 *  moment after typing ends, so the tap that ended it (Send) lands on the
 *  button it was aimed at, not on what a reflow slid under the finger. */
export function useSettledTrue(value: boolean, ms: number): boolean {
  const [held, setHeld] = useState(value);
  useEffect(() => {
    if (value) {
      setHeld(true);
      return;
    }
    const t = setTimeout(() => setHeld(false), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return value || held;
}

const SHEET_PROPS = ["top", "bottom", "height"] as const;

/**
 * While `active` (a field in the dock has focus), keep it above the phone's
 * keyboard: returns the drawer's fit, and fits a sheet backdrop holding the
 * focused field to the visible viewport (undone when typing ends).
 */
export function useKeyboardFit(active: boolean, dock: HTMLElement | null, restTop?: MutableRefObject<number | null>): KeyboardFit | null {
  const [fit, setFit] = useState<KeyboardFit | null>(null);
  const reader = useRef<(() => void) | null>(null);
  // Every render while active: the bar or the taskbar may just have come or
  // gone (the frame's rule runs a tick after a blur), moving the dock; the
  // fit follows before the browser paints, so the drawer never jumps.
  useIsoLayoutEffect(() => {
    if (active) reader.current?.();
  });
  useIsoLayoutEffect(() => {
    if (!active || dock === null || typeof window === "undefined") {
      setFit(null);
      return;
    }
    const vv: Pick<VisualViewport, "height" | "offsetTop" | "addEventListener" | "removeEventListener"> = window.visualViewport ?? {
      height: window.innerHeight,
      offsetTop: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    let sheet: HTMLElement | null = null;
    const unfit = () => {
      if (sheet === null) return;
      for (const p of SHEET_PROPS) sheet.style.removeProperty(p);
      sheet = null;
    };
    const read = () => {
      const root = dock.getRootNode() as Document | ShadowRoot;
      const a = (root.activeElement ?? document.activeElement) as HTMLElement | null;
      const backdrop = a !== null && dock.contains(a) ? (a.closest(".sheet-backdrop") as HTMLElement | null) : null;
      if (backdrop !== null) {
        setFit(null);
        // A fixed backdrop fills the layout viewport: the keyboard covers
        // what lies below the visible one.
        const covered = window.innerHeight - (vv.offsetTop + vv.height);
        if (covered >= 1) {
          if (sheet !== backdrop) unfit();
          sheet = backdrop;
          backdrop.style.top = `${Math.round(vv.offsetTop)}px`;
          backdrop.style.bottom = "auto";
          backdrop.style.height = `${Math.round(vv.height)}px`;
        } else unfit();
      } else {
        unfit();
        const next = keyboardFit(dock.getBoundingClientRect().top, vv.offsetTop, vv.height, restTop?.current ?? null);
        setFit((prev) => (prev?.lift === next?.lift && prev?.height === next?.height ? prev : next));
      }
      // The field itself in view inside its scrolling panel.
      if (a !== null && dock.contains(a)) requestAnimationFrame(() => a.scrollIntoView?.({ block: "nearest" }));
    };
    reader.current = read;
    read();
    // The keyboard slides up over ~250 ms: read again once it has (and the
    // frame's taskbar may step aside a render later).
    const settle = setTimeout(read, 320);
    const next = typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame(read) : 0;
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      clearTimeout(settle);
      if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(next);
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
      reader.current = null;
      unfit();
      setFit(null);
    };
  }, [active, dock]);
  return fit;
}

/** Where a balloon tip goes while the console is open (item: a balloon
 *  never covers the console's controls): above the drawer's top edge on a
 *  phone (`tight` when there is little room: the tip is cut to it), beside
 *  it, to its left, on a wide screen. Pure; px from the frame's edges. */
export interface BalloonClearance {
  mode: "above" | "tight" | "beside";
  /** Px from the frame's bottom to the drawer's top edge. */
  lift: number;
  /** Px free above the drawer (the tip's most height). */
  room: number;
  /** Px from the frame's right edge to the drawer's left edge. */
  right: number;
}

/** Under this much room above the drawer the tip is cut to fit. */
export const BALLOON_ROOM_MIN = 160;

export function balloonClearance(frame: { top: number; bottom: number; right: number }, drawer: { top: number; left: number }, wide: boolean): BalloonClearance {
  const lift = Math.max(0, Math.round(frame.bottom - drawer.top));
  const room = Math.max(0, Math.round(drawer.top - frame.top - 28));
  const right = Math.max(0, Math.round(frame.right - drawer.left));
  if (wide) return { mode: "beside", lift, room, right };
  return { mode: room < BALLOON_ROOM_MIN ? "tight" : "above", lift, room, right };
}

/** Sets the clearance on the frame (`data-host-drawer` + `--host-drawer-*`,
 *  read by moments.css) while the drawer is open; clears it on close. */
export function useBalloonClearance(open: boolean, wide: boolean, dock: HTMLElement | null, frame: HTMLElement | null, fit: KeyboardFit | null): void {
  useEffect(() => {
    if (!open || dock === null || frame === null || typeof window === "undefined") return;
    const apply = () => {
      const drawer = dock.querySelector<HTMLElement>(".host-drawer");
      if (drawer === null) return;
      const c = balloonClearance(frame.getBoundingClientRect(), drawer.getBoundingClientRect(), wide);
      frame.dataset["hostDrawer"] = c.mode;
      frame.style.setProperty("--host-drawer-lift", `${c.lift}px`);
      frame.style.setProperty("--host-drawer-room", `${c.room}px`);
      frame.style.setProperty("--host-drawer-right", `${c.right}px`);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      delete frame.dataset["hostDrawer"];
      for (const p of ["--host-drawer-lift", "--host-drawer-room", "--host-drawer-right"]) frame.style.removeProperty(p);
    };
  }, [open, wide, dock, frame, fit]);
}

//! The keyboard rule (wave 13; frozen signature): while the phone's
//! on-screen keyboard is up for a text field inside the frame, the taskbar
//! and the NEXT bar step aside so a guest typing to Trabolta keeps the
//! stream.
//!
//! - **The viewport decides, where it can.** With `visualViewport` the
//!   keyboard is open once the viewport has shrunk ≥ `KEYBOARD_MIN_PX` below
//!   its height at rest with a text field focused, and closed again when it
//!   grows back (Android's back key, iOS's ⌄) with the field still focused.
//!   Without one (an old tablet) focus alone decides.
//! - **No on-screen keyboard, no hiding**: a fine pointer that can hover (a
//!   laptop, an editor pane) never hides the taskbar; nor does a focused
//!   field that never shrinks the viewport (a hardware keyboard).
//! - **A tap in the footer never moves its own target.** Tapping Send, File
//!   it or Say it moves focus off the field first; if the taskbar came back
//!   then, everything anchored to the bottom would jump 44 px and the tap
//!   would land on nothing. So while a pointer is down inside a
//!   `.stream-foot` the open layout is held, and focus moving to a button in
//!   that footer keeps it too; it is let go after the click (or when the
//!   viewport grows back).

import { useEffect, useRef, useState, type RefObject } from "react";

const NOT_TEXT = new Set(["button", "checkbox", "radio", "range", "submit", "reset", "file", "color", "image", "hidden"]);

/** Does this element take typed text (the phone's keyboard opens for it)? */
export function isTextEntry(el: Element | null): boolean {
  if (el === null) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") return !NOT_TEXT.has(((el as HTMLInputElement).type || "text").toLowerCase());
  return (el as HTMLElement).isContentEditable === true;
}

/** How much the visual viewport must shrink below its height at rest to be
 *  an on-screen keyboard (the browser's own toolbars move it less). */
export const KEYBOARD_MIN_PX = 150;

/** How long after a pointer lifts in the footer the open layout is still
 *  held when no click follows (a drag off the button, a cancelled tap). */
export const HOLD_RELEASE_MS = 600;

/** The footer whose taps hold the open layout. */
export const FOOT_SELECTOR = ".stream-foot";

/** What the rule remembers (pure — `test/keyboard.test.ts`). */
export interface KeyboardState {
  /** A text field inside the frame has focus. */
  text: boolean;
  /** The viewport's height the last time no field had focus. */
  rest: number | null;
  /** The keyboard was seen up (the viewport shrank) since the field took focus. */
  shown: boolean;
  /** …and has since gone down with the field still focused. */
  closed: boolean;
  /** A pointer is down in the footer (or the click it started has not landed yet). */
  held?: boolean;
}

export const KEYBOARD_REST: KeyboardState = { text: false, rest: null, shown: false, closed: false, held: false };

export type KeyboardInput =
  /** Focus moved. `foot`: the newly focused element is a control in the footer the field was in. */
  | { kind: "focus"; text: boolean; height: number | null; foot?: boolean }
  | { kind: "resize"; height: number | null }
  /** A pointer went down in the footer (`on`), or its click has landed (`!on`). */
  | { kind: "hold"; on: boolean };

/** The rule's next state (pure). */
export function keyboardStep(s: KeyboardState, e: KeyboardInput): KeyboardState {
  if (e.kind === "hold") {
    if (!e.on) return s.held === true ? { ...s, held: false } : s;
    return keyboardIsOpen(s) ? { ...s, held: true } : s;
  }
  if (e.kind === "focus") {
    if (!e.text) {
      // Focus left the field for a control in its own footer (Send, File
      // it), or while a tap there is under way: keep the layout as it is.
      if (s.text && (s.held === true || e.foot === true)) return s;
      return { text: false, rest: e.height ?? s.rest, shown: false, closed: false, held: false };
    }
    // A new field (or the same one again): the keyboard is coming up.
    return s.text ? { ...s, closed: false } : { text: true, rest: e.height ?? s.rest, shown: false, closed: false, held: false };
  }
  if (!s.text) return { ...s, rest: e.height ?? s.rest };
  if (e.height === null || s.rest === null) return s;
  if (s.rest - e.height >= KEYBOARD_MIN_PX) return { ...s, shown: true, closed: false };
  // Back near its height at rest after the keyboard was up: it closed (and
  // any hold goes with it — the layout it protected is gone).
  return s.shown ? { ...s, shown: false, closed: true, held: false } : s;
}

/** Is the keyboard (taken to be) open? With heights known, only once the
 *  viewport has shown it; with none, focus alone. */
export function keyboardIsOpen(s: KeyboardState): boolean {
  if (!s.text || s.closed) return false;
  return s.rest === null ? true : s.shown;
}

/** A device with no on-screen keyboard: a fine pointer that hovers (a laptop's
 *  trackpad, a mouse). Its taskbar never steps aside. */
export function noOnScreenKeyboard(match: ((q: string) => boolean) | null): boolean {
  return match !== null && match("(hover: hover) and (pointer: fine)");
}

export function useKeyboardOpen(frame: RefObject<HTMLElement | null>): boolean {
  const [open, setOpen] = useState(false);
  const state = useRef<KeyboardState>(KEYBOARD_REST);
  useEffect(() => {
    const el = frame.current;
    if (el === null || typeof document === "undefined") return;
    const match = typeof window !== "undefined" && typeof window.matchMedia === "function" ? (q: string) => window.matchMedia(q).matches : null;
    if (noOnScreenKeyboard(match)) return;
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    const height = () => vv?.height ?? null;
    const step = (e: KeyboardInput) => {
      state.current = keyboardStep(state.current, e);
      setOpen(keyboardIsOpen(state.current));
    };
    // The footer the focused text field sits in (a button there keeps the layout).
    let foot: Element | null = null;
    const read = () => {
      // The focused element, inside a shadow root too (the embedded panes).
      const root = el.getRootNode() as Document | ShadowRoot;
      const a = root.activeElement ?? document.activeElement;
      const inside = a !== null && el.contains(a);
      const text = inside && isTextEntry(a);
      if (text) foot = a.closest(FOOT_SELECTOR);
      const inFoot = !text && inside && foot !== null && foot.contains(a);
      step({ kind: "focus", text, height: height(), foot: inFoot });
    };
    // focusout fires before focus lands elsewhere: read on the next tick.
    const later = () => setTimeout(read, 0);
    const resize = () => step({ kind: "resize", height: height() });
    let release: ReturnType<typeof setTimeout> | null = null;
    const letGo = (ms: number) => {
      if (release !== null) clearTimeout(release);
      release = setTimeout(() => {
        release = null;
        step({ kind: "hold", on: false });
        read();
      }, ms);
    };
    const down = (e: Event) => {
      const t = e.target as Element | null;
      if (t === null || typeof t.closest !== "function" || t.closest(FOOT_SELECTOR) === null) return;
      if (release !== null) clearTimeout(release);
      release = null;
      step({ kind: "hold", on: true });
    };
    // The click is what the tap was for: let go once it has run.
    const clicked = () => {
      if (state.current.held === true) letGo(0);
    };
    const up = () => {
      if (state.current.held === true) letGo(HOLD_RELEASE_MS);
    };
    el.addEventListener("focusin", read);
    el.addEventListener("focusout", later);
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("pointerup", up, true);
    el.addEventListener("pointercancel", up, true);
    el.addEventListener("click", clicked);
    vv?.addEventListener("resize", resize);
    read();
    return () => {
      if (release !== null) clearTimeout(release);
      el.removeEventListener("focusin", read);
      el.removeEventListener("focusout", later);
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("pointerup", up, true);
      el.removeEventListener("pointercancel", up, true);
      el.removeEventListener("click", clicked);
      vv?.removeEventListener("resize", resize);
    };
  }, [frame]);
  return open;
}

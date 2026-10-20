//! The keyboard rule (wave 13; frozen signature): while a text input inside
//! the frame has focus, the taskbar and the NEXT bar step aside so a guest
//! typing to Trabolta keeps the stream. Focus decides — with one exception
//! the viewport tells us about: when the phone's keyboard closes while the
//! field keeps focus (Android's back key, iOS's ⌄), the `visualViewport`
//! grows back to its height at rest, and the taskbar comes back. Tapping
//! the field again opens the keyboard, the viewport shrinks, and it steps
//! aside again.

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
}

export const KEYBOARD_REST: KeyboardState = { text: false, rest: null, shown: false, closed: false };

export type KeyboardInput = { kind: "focus"; text: boolean; height: number | null } | { kind: "resize"; height: number | null };

/** The rule's next state (pure). */
export function keyboardStep(s: KeyboardState, e: KeyboardInput): KeyboardState {
  if (e.kind === "focus") {
    if (!e.text) return { text: false, rest: e.height ?? s.rest, shown: false, closed: false };
    // A new field (or the same one again): the keyboard is coming up.
    return s.text ? { ...s, closed: false } : { text: true, rest: e.height ?? s.rest, shown: false, closed: false };
  }
  if (!s.text) return { ...s, rest: e.height ?? s.rest };
  if (e.height === null || s.rest === null) return s;
  if (s.rest - e.height >= KEYBOARD_MIN_PX) return { ...s, shown: true, closed: false };
  // Back near its height at rest after the keyboard was up: it closed.
  return s.shown ? { ...s, shown: false, closed: true } : s;
}

/** Is the keyboard (taken to be) open? */
export function keyboardIsOpen(s: KeyboardState): boolean {
  return s.text && !s.closed;
}

export function useKeyboardOpen(frame: RefObject<HTMLElement | null>): boolean {
  const [open, setOpen] = useState(false);
  const state = useRef<KeyboardState>(KEYBOARD_REST);
  useEffect(() => {
    const el = frame.current;
    if (el === null || typeof document === "undefined") return;
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    const height = () => vv?.height ?? null;
    const step = (e: KeyboardInput) => {
      state.current = keyboardStep(state.current, e);
      setOpen(keyboardIsOpen(state.current));
    };
    const read = () => {
      // The focused element, inside a shadow root too (the embedded panes).
      const root = el.getRootNode() as Document | ShadowRoot;
      const a = root.activeElement ?? document.activeElement;
      step({ kind: "focus", text: a !== null && el.contains(a) && isTextEntry(a), height: height() });
    };
    // focusout fires before focus lands elsewhere: read on the next tick.
    const later = () => setTimeout(read, 0);
    const resize = () => step({ kind: "resize", height: height() });
    el.addEventListener("focusin", read);
    el.addEventListener("focusout", later);
    vv?.addEventListener("resize", resize);
    read();
    return () => {
      el.removeEventListener("focusin", read);
      el.removeEventListener("focusout", later);
      vv?.removeEventListener("resize", resize);
    };
  }, [frame]);
  return open;
}

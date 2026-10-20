//! The keyboard rule (wave 13; frozen signature): while a text input inside
//! the frame has focus, the taskbar and the NEXT bar step aside so a guest
//! typing to Trabolta keeps the stream. Focus decides; a `visualViewport`
//! resize re-reads it (the keyboard closing with the field still focused).

import { useEffect, useState, type RefObject } from "react";

const NOT_TEXT = new Set(["button", "checkbox", "radio", "range", "submit", "reset", "file", "color", "image", "hidden"]);

/** Does this element take typed text (the phone's keyboard opens for it)? */
export function isTextEntry(el: Element | null): boolean {
  if (el === null) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") return !NOT_TEXT.has(((el as HTMLInputElement).type || "text").toLowerCase());
  return (el as HTMLElement).isContentEditable === true;
}

export function useKeyboardOpen(frame: RefObject<HTMLElement | null>): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = frame.current;
    if (el === null || typeof document === "undefined") return;
    const read = () => {
      const a = document.activeElement;
      setOpen(a !== null && el.contains(a) && isTextEntry(a));
    };
    // focusout fires before focus lands elsewhere: read on the next tick.
    const later = () => setTimeout(read, 0);
    el.addEventListener("focusin", read);
    el.addEventListener("focusout", later);
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    vv?.addEventListener("resize", read);
    read();
    return () => {
      el.removeEventListener("focusin", read);
      el.removeEventListener("focusout", later);
      vv?.removeEventListener("resize", read);
    };
  }, [frame]);
  return open;
}

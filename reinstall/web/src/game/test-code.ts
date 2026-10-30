//! The test code: B B A A B A B A A B B on the keyboard, the same code as the
//! headset's (`reinstall/vr/game/test_combo.gd`, with its pause rule). During
//! the intro video it skips the video and the training; during the training,
//! the rest of it. For testing: a guest is never told, and the play help
//! never describes it.

import { useEffect, useRef } from "react";

export const TEST_CODE = "BBAABABAABB";
/** The longest pause between two presses (ms). */
export const TEST_CODE_GAP_MS = 1500;

/** Watches key presses for the code. */
export class TestCode {
  private typed = "";
  private last = 0;

  /** One press, `key` "A" or "B" at `now` (ms). True when it completes the code. */
  press(key: "A" | "B", now: number): boolean {
    if (now - this.last > TEST_CODE_GAP_MS) this.typed = "";
    this.last = now;
    this.typed += key;
    // Keep the longest tail that could still become the code.
    while (!TEST_CODE.startsWith(this.typed)) this.typed = this.typed.slice(1);
    if (this.typed !== TEST_CODE) return false;
    this.typed = "";
    return true;
  }
}

/** A keydown's press of the code, if it is one (a held key's repeats are not). */
export function codeKey(e: Pick<KeyboardEvent, "code" | "repeat">): "A" | "B" | null {
  if (e.repeat) return null;
  return e.code === "KeyA" ? "A" : e.code === "KeyB" ? "B" : null;
}

/** Calls `onCode` when the code is typed anywhere on the page while `active`. */
export function useTestCode(active: boolean, onCode: () => void): void {
  const fire = useRef(onCode);
  fire.current = onCode;
  useEffect(() => {
    if (!active) return;
    const code = new TestCode();
    const down = (e: KeyboardEvent): void => {
      const key = codeKey(e);
      if (key !== null && code.press(key, performance.now())) fire.current();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [active]);
}

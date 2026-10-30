//! The GameCube controller's loop (wave 52, `pad.ts`). It draws nothing: the
//! controller walks whatever is on screen with a `data-pad` attribute, in the
//! page's order, and A clicks the lit one, so a choice, a file and the voice
//! prompt are all the same to it.
//!
//! - `data-pad`: takes the focus. `data-pad-aside` too, but only when walked
//!   to, so a new menu lights its first answer and not the file strip.
//! - `data-pad-focus`: set here on the lit one (the CSS draws it). An
//!   attribute and not a class, so a React `className` never wipes it.
//! - `data-pad-skip`: A clicks this before anything lit (his voice, skipped).
//! - `data-pad-back`: B clicks the first of these on the page. Going back is
//!   only ever B: the ⟦BACK⟧ bar isn't `data-pad`, so no A press can take it.
//! - `data-pad-y`: Y clicks this (give him a file, where it's offered).
//! - `data-pad-hold`: holding Start clicks this (the virtual keyboard).
//!
//! While something holds the controller (`grabPad`), all of it goes there.

import { useEffect, useRef } from "react";
import { PadMachine, frameOf, movedTo, padHolder, type RawPad } from "./pad.ts";

function usable(el: HTMLElement): boolean {
  return !(el as HTMLButtonElement).disabled && el.offsetParent !== null;
}

function items(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-pad]")].filter(usable);
}

function pads(): ReadonlyArray<RawPad | null> {
  try {
    return [...navigator.getGamepads()];
  } catch {
    return [];
  }
}

export function PadNav({ onActivity }: { onActivity: () => void }) {
  const activity = useRef(onActivity);
  activity.current = onActivity;
  useEffect(() => {
    const machine = new PadMachine();
    let lit: HTMLElement | null = null;
    let raf = 0;
    const light = (el: HTMLElement | null) => {
      if (el === lit) return;
      lit?.removeAttribute("data-pad-focus");
      lit = el;
      lit?.setAttribute("data-pad-focus", "");
      lit?.scrollIntoView({ block: "nearest" });
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const list = items();
      if (lit === null || !list.includes(lit)) light(list.find((el) => !el.hasAttribute("data-pad-aside")) ?? null);
      const events = machine.step(frameOf(pads()), performance.now());
      for (const e of events) {
        activity.current();
        const holder = padHolder();
        if (holder !== null) {
          holder(e);
          continue;
        }
        if (e.t === "move") light(list[movedTo(lit === null ? -1 : list.indexOf(lit), e.dir, list.length)] ?? null);
        else if (e.t === "select") (document.querySelector<HTMLElement>("[data-pad-skip]") ?? lit)?.click();
        else if (e.t === "back") document.querySelector<HTMLElement>("[data-pad-back]")?.click();
        else if (e.t === "give") document.querySelector<HTMLElement>("[data-pad-y]")?.click();
        else if (e.t === "hold") document.querySelector<HTMLElement>("[data-pad-hold]")?.click();
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      lit?.removeAttribute("data-pad-focus");
    };
  }, []);
  return null;
}

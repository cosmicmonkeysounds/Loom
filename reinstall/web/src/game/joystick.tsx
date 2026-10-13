//! The on-screen twin sticks. Each is a **floating** stick living in its
//! own zone (the left / right lower corner): a finger landing anywhere in
//! the zone becomes the stick's centre, so a thumb never has to find a
//! target. Multi-touch by `pointerId` — each zone follows only the finger
//! that started in it, so walking and turning at once works. The maths
//! (knob clamp, dead zone) is `stickVector` in `input.ts`; the knob is moved
//! with direct style writes, not React renders.

import { useEffect, useRef } from "react";
import { CENTRED, stickVector, type StickVector } from "./input.ts";

/** Knob travel, px. */
const RADIUS = 56;

export function Joystick({ side, label, onChange }: { side: "left" | "right"; label: string; onChange: (v: StickVector) => void }) {
  const zone = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    const z = zone.current;
    const b = base.current;
    const k = knob.current;
    if (z === null || b === null || k === null) return;
    let pointer: number | null = null;
    let origin: [number, number] = [0, 0];

    const rest = (): void => {
      b.style.left = "";
      b.style.top = "";
      b.classList.remove("held");
      k.style.transform = "translate(-50%, -50%)";
      handler.current(CENTRED);
    };
    const down = (e: PointerEvent): void => {
      if (pointer !== null) return;
      e.preventDefault();
      pointer = e.pointerId;
      z.setPointerCapture?.(e.pointerId);
      const r = z.getBoundingClientRect();
      // Keep the whole base inside the zone.
      const x = Math.min(Math.max(e.clientX - r.left, RADIUS), r.width - RADIUS);
      const y = Math.min(Math.max(e.clientY - r.top, RADIUS), r.height - RADIUS);
      origin = [r.left + x, r.top + y];
      b.style.left = `${x}px`;
      b.style.top = `${y}px`;
      b.classList.add("held");
      update(e);
    };
    const update = (e: PointerEvent): void => {
      const s = stickVector(e.clientX - origin[0], e.clientY - origin[1], RADIUS);
      k.style.transform = `translate(calc(-50% + ${s.knob[0]}px), calc(-50% + ${s.knob[1]}px))`;
      handler.current(s.value);
    };
    const moveH = (e: PointerEvent): void => {
      if (e.pointerId !== pointer) return;
      e.preventDefault();
      update(e);
    };
    const up = (e: PointerEvent): void => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      rest();
    };
    z.addEventListener("pointerdown", down);
    z.addEventListener("pointermove", moveH);
    z.addEventListener("pointerup", up);
    z.addEventListener("pointercancel", up);
    z.addEventListener("lostpointercapture", up);
    return () => {
      z.removeEventListener("pointerdown", down);
      z.removeEventListener("pointermove", moveH);
      z.removeEventListener("pointerup", up);
      z.removeEventListener("pointercancel", up);
      z.removeEventListener("lostpointercapture", up);
      handler.current(CENTRED);
    };
  }, []);

  return (
    <div ref={zone} className={`stick-zone ${side}`} aria-label={label} role="application">
      <div ref={base} className="stick-base" style={{ width: RADIUS * 2, height: RADIUS * 2 }}>
        <div ref={knob} className="stick-knob" />
        <span className="stick-label">{label}</span>
      </div>
    </div>
  );
}

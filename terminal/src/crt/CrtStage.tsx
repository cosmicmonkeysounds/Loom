//! The CRT's screen (wave 52b): a 640 × 480 stage stretched to fill whatever
//! the laptop sends. The converter fills the tube with any signal, so a
//! widescreen one arrives squeezed into 4:3: drawing the stage wide cancels
//! that out, and the picture is right on the tube at any resolution. A true
//! 4:3 mode is still the one to use: fewer pixels thrown away, sharper text.
//! Everything inside is laid out in the stage's own pixels (`crt.css`).
//!
//! Also the idle screen: the pipes and nothing else (no ads, no windows, no
//! sound), with the scanner still reading passes behind them.

import "./crt.css";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { SaverCanvas, type SaverHandle } from "../idle-show/SaverCanvas.tsx";

export const CRT_WIDTH = 640;
export const CRT_HEIGHT = 480;

export function CrtStage({ children }: { children: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      stage.current?.style.setProperty("--crt-sx", String(window.innerWidth / CRT_WIDTH));
      stage.current?.style.setProperty("--crt-sy", String(window.innerHeight / CRT_HEIGHT));
    };
    fit();
    window.addEventListener("resize", fit);
    document.documentElement.classList.add("crt-page");
    return () => {
      window.removeEventListener("resize", fit);
      document.documentElement.classList.remove("crt-page");
    };
  }, []);
  return (
    <div ref={stage} className="crt-stage">
      {children}
    </div>
  );
}

const PIPES_SEED = 1999;

export function CrtPipes({ active }: { active: boolean }) {
  const handle = useRef<SaverHandle | null>(null);
  return (
    <div className="crt-pipes">
      <SaverCanvas saver="pipes" seed={PIPES_SEED} active={active} reduced={false} handle={handle} />
    </div>
  );
}

//! A scene's full-size stage: a background and a box the kit's absolutely
//! placed pieces hang from. `fit` keeps a 16:9 picture whole on any screen
//! (the TV is 16:9; a wall tablet 4:3 or portrait) — letterboxed, centred.

import type { CSSProperties, ReactNode } from "react";

export function Stage({ bg = "#000", fit = false, className, style, children }: { bg?: string; fit?: boolean; className?: string; style?: CSSProperties; children?: ReactNode }) {
  return (
    <div className={`kit-stage${className ? ` ${className}` : ""}`} style={{ background: bg, ...style }}>
      {fit ? <div className="kit-stage-fit">{children}</div> : children}
    </div>
  );
}

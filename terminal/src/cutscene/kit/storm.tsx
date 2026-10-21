//! A popup storm (wave 17): `count` Win98 message boxes landing on a seeded
//! schedule — slow, then faster, then a pile-up — cascading like a stuck
//! error. The same storm on every screen; a reload lands mid-pile.

import type { CSSProperties } from "react";
import type { SfxName, SfxOpts } from "../../sound/index.ts";
import { useCues } from "./cues.ts";
import { eased, ease, stormSchedule } from "./time.ts";
import { Win98Dialog, type IconKind } from "./win98.tsx";

export interface StormMessage {
  title: string;
  text: string;
  kind?: Extract<IconKind, "error" | "warning" | "info" | "question">;
  actions?: readonly string[];
}

/** The house's stock of nonsense (fiction-safe before the introduction: nobody named). */
export const STORM_MESSAGES: readonly StormMessage[] = [
  { title: "Error", text: "This program has performed a legal operation and will be shut down anyway.", kind: "error" },
  { title: "System", text: "Your computer is running low on fun.", kind: "warning" },
  { title: "Notepad", text: "Not enough disk space to store your feelings.", kind: "error" },
  { title: "Windows", text: "Click OK to continue. Click Cancel to continue.", kind: "question", actions: ["OK", "Cancel"] },
  { title: "Fatal", text: "A fatal exception 0D has occurred at 0028:C0FFEE13.", kind: "error" },
  { title: "Memory", text: "Out of memory. Delete a memory?", kind: "question", actions: ["Yes", "Also yes"] },
  { title: "New Hardware Found", text: "Windows has found new hardware: one (1) duck.", kind: "info" },
  { title: "Are you sure?", text: "Are you sure you want to be sure?", kind: "question", actions: ["Yes", "No", "Maybe"] },
  { title: "Network", text: "The internet is full. Please try again in 1999.", kind: "warning" },
  { title: "Error 0x0000DUCK", text: "Quack.", kind: "error" },
  { title: "Security", text: "Your password is showing. Please tuck it in.", kind: "warning" },
  { title: "Explorer", text: "Explorer is not responding. Neither are we.", kind: "error" },
];

/**
 * The storm at `t`: each box pops (overshoot) as its time comes; `sound`
 * plays on each landing through `sfx` (the bus keeps a pile-up from
 * clattering). `area` is where the boxes may land (the parent, by default).
 */
export function PopupStorm({
  t,
  seed = 1,
  count = 24,
  start = 0,
  span = 6000,
  messages = STORM_MESSAGES,
  width = "34%",
  sfx,
  sound = "error",
  reduced = false,
  className,
  style,
}: {
  t: number;
  seed?: number;
  count?: number;
  start?: number;
  span?: number;
  messages?: readonly StormMessage[];
  width?: string;
  sfx?: (name: SfxName, opts?: SfxOpts) => boolean;
  sound?: SfxName | null;
  reduced?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const pops = stormSchedule(seed, count, start, span);
  useCues(
    t,
    sfx !== undefined && sound !== null ? pops.map((p) => [p.at, () => void sfx(sound, { pitch: 0.9 + ((p.pick % 7) / 7) * 0.3 })] as const) : [],
    300,
  );
  return (
    <div className={`kit-fill kit-storm${className ? ` ${className}` : ""}`} style={style}>
      {pops.map((p) => {
        if (t < p.at || messages.length === 0) return null;
        const m = messages[p.pick % messages.length]!;
        return (
          <Win98Dialog
            key={p.i}
            title={m.title}
            message={m.text}
            kind={m.kind ?? "error"}
            actions={m.actions ?? ["OK"]}
            x={p.x * 100}
            y={p.y * 100}
            width={width}
            open={eased(t, p.at, 180, ease.linear)}
            inactive={pops[p.i + 1] !== undefined && t >= pops[p.i + 1]!.at}
            reduced={reduced}
            zIndex={p.i + 1}
          />
        );
      })}
    </div>
  );
}

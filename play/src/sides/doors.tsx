//! The doors (wave 18, GUEST-SPEC §9.1, F2): the side reveal as two Win95
//! windows on a black screen, each a side with its leader and its head
//! count, and *Neither* under them. Walk in joins (the switching join, no
//! confirm: it is reversible), says *You are in {Side}.* for 1.2 s, then
//! answers the card (the big moment closes on the answer). Neither answers
//! with no call (neither is the default). A card in its room renders the
//! same doors; answered, it says what was chosen.

import { useEffect, useRef, useState } from "react";
import type { WidgetProps } from "../widgets.tsx";
import { BlockBar } from "../ui/progress.tsx";
import { useSides } from "./context.ts";
import { countLine, sidesOf } from "./model.ts";

/** How long the chosen door says so before the card answers. */
export const DOOR_SAY_MS = 1200;

/** An answer sent after a pause — or at once when flushed (an unmount).
 *  Sent exactly once either way. */
export class DeferredAnswer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private send: (() => void) | null = null;
  schedule(send: () => void, ms: number): void {
    this.flush();
    this.send = send;
    this.timer = setTimeout(() => this.flush(), ms);
  }
  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const send = this.send;
    this.send = null;
    send?.();
  }
}

/** The card's words as the kicker (line 1) and the headline (line 2). A
 *  one-line text splits after its first sentence, so the kicker never
 *  repeats the headline (GN-F8). */
export function doorWords(text: string): { kicker: string; say: string } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) return { kicker: lines[0]!, say: lines[1]! };
  const one = lines[0] ?? "";
  const m = /^(.+?[.!?])\s+(\S.*)$/u.exec(one);
  if (m !== null) return { kicker: m[1]!, say: m[2]! };
  return { kicker: one, say: "Two doors have opened in the computer." };
}

export function Doors({ card, onAnswer, answered }: WidgetProps) {
  const { view, calls } = useSides();
  const rows = sidesOf(view);
  const [chosen, setChosen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The answer waiting out DOOR_SAY_MS. An unmount (the big closing under
  // it, a room switch) sends it at once: the join already happened, so the
  // card must settle (wave 18 fix: Walk in left the card open all night).
  const later = useRef<DeferredAnswer | null>(null);
  if (later.current === null) later.current = new DeferredAnswer();
  useEffect(() => () => later.current?.flush(), []);
  const { kicker, say } = doorWords(card.text);
  const live = onAnswer !== undefined && calls !== null && answered == null;
  const pickedName = (answered?.["side"] as string | undefined) ?? null;
  const walk = (id: string, name: string) => {
    if (!live || busy) return;
    setBusy(true);
    setErr(null);
    void calls!.join(name).then(
      () => {
        setChosen(name);
        later.current!.schedule(() => onAnswer!({ side: id }), DOOR_SAY_MS);
      },
      (e: unknown) => {
        setBusy(false);
        setErr(String((e as { message?: unknown }).message ?? "That door didn't open — try again."));
      },
    );
  };
  if (!live && answered != null) {
    const side = pickedName === "neither" ? null : (rows.find((r) => r.id === pickedName)?.name ?? pickedName);
    return (
      <div className="widget doors-done">
        <div className="widget-title">🚪 {kicker || "The doors"}</div>
        <div className="widget-sub">{side === null ? "You chose neither." : `You are in ${side}.`}</div>
      </div>
    );
  }
  return (
    <div className="doors" role="group" aria-label="Choose a side">
      {kicker !== "" && <div className="doors-kicker">{kicker}</div>}
      <div className="doors-say">{say}</div>
      <div className="doors-row">
        {rows.map((r) => (
          <section key={r.id} className={`w95-window door${chosen === r.name ? " open" : ""}`} aria-label={r.name}>
            <div className="w95-titlebar">
              <span className="w95-title">▣ {r.name.toUpperCase()}</span>
            </div>
            <div className="door-body">
              {chosen === r.name ? (
                <p className="door-in">You are in {r.name}.</p>
              ) : (
                <>
                  {r.leader !== null && <p className="door-leader">led by {r.leader}</p>}
                  {r.needs !== null && r.members !== null && <BlockBar done={r.members} total={r.needs} cells={10} />}
                  {countLine(r) !== "" && <p className="door-count">{countLine(r)}</p>}
                  <button type="button" className="choice primary door-go" disabled={!live || busy} onClick={() => walk(r.id, r.name)}>
                    Walk in ▸
                  </button>
                </>
              )}
            </div>
          </section>
        ))}
      </div>
      <button type="button" className="choice doors-neither" disabled={!live || busy} onClick={() => onAnswer?.({ side: "neither" })}>
        Neither. I'll pursue my own interests.
      </button>
      {err !== null && <p className="err doors-err">{err}</p>}
      <p className="doors-foot">You can switch sides from ⊞ Start → Sides.</p>
    </div>
  );
}

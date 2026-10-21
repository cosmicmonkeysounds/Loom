//! The house's big wins on the screens (wave 18, lane edges): when the story
//! makes a big house broadcast of a win (`broadcast "!!🎀 … wins a Bingo
//! Ribbon!"`, an award's 🏆 line — `ScreenMoment` kind `big`, `../../screen.ts`),
//! the TV and the wall terminals pop a short Win98 "Congratulations!" over
//! whatever is up: confetti, the winner's name, the line itself. Only a
//! win: a big line led by one of `WIN_GLYPHS`. Any other big broadcast is
//! the phones' (it may ask something of one program); the screens stay as
//! they are. An older server sends no big moments, so nothing here plays.
//!
//! Drawn from `t` like every scene; under Reduce Motion it only fades.
//! Chrome 87 / Safari 14 safe: no `inset`, no flex `gap`, no `:has()`.

import "./house.css";
import type { SceneDef, SceneProps } from "../types.ts";
import { Confetti, Marquee, Typewriter, Win98Button, Win98Window, clamp01, ease, eased, progress, useSfxCues } from "../kit/index.ts";

/** The glyphs that make a big line a win (the story's ribbon, trophy and medals). */
export const WIN_GLYPHS: readonly string[] = ["🎀", "🏆", "🥇", "🏅", "🎉", "🎊", "👑", "🥳"];

/** How long the popup stays (ms): the phones' everyone-popup closes after 6 s. */
export const WIN_MS = 8000;

const W = { open: 150, glyph: 300, who: 700, line: 1200, out: WIN_MS - 700 } as const;

/** The win's glyph and the rest of its line (`🎀 Encarta wins …` → `🎀`, `Encarta wins …`). */
export function splitWin(line: string): { glyph: string; text: string } {
  const l = line.trim();
  for (const g of WIN_GLYPHS) {
    if (l.startsWith(g)) {
      // The glyph may carry a variation selector (U+FE0F) after it.
      return { glyph: g, text: l.slice(g.length).replace(/^️/u, "").trim() };
    }
  }
  return { glyph: "🏆", text: l };
}

/** Is a big line a win the screens celebrate? */
export function isWinLine(line: string): boolean {
  const l = line.trim();
  return WIN_GLYPHS.some((g) => l.startsWith(g));
}

/** The name the popup leads with: the moment's program, else none (the line names them). */
export function winnerName(who: string | null): string | null {
  const w = who === null ? "" : who.trim();
  return w === "" ? null : w.toUpperCase();
}

function HouseWin({ t, value, who, sfx, reduced, target }: SceneProps) {
  useSfxCues(t, sfx, [
    [0, "fanfare", { gain: 0.5, over: true }],
    [W.who, "tada", { gain: 0.55, over: true }],
    [W.line + 400, "sparkle", { gain: 0.45, over: true }],
  ]);
  const { glyph, text } = splitWin(value);
  const name = winnerName(who);
  const shade = clamp01(progress(t, 0, 300) * (1 - progress(t, W.out, 600)));
  const open = (reduced ? progress(t, W.open, 300) : eased(t, W.open, 420, ease.linear)) * (1 - progress(t, W.out, 500));
  const pop = reduced ? 1 : 0.4 + 0.6 * eased(t, W.glyph, 600, ease.outBack);
  const bob = reduced ? 0 : Math.sin(t / 260) * 0.08;
  const wall = target === "wall";
  return (
    <div className={`kit-stage hw-stage${wall ? " hw-wall" : ""}`} style={{ background: `rgba(0, 0, 40, ${(0.55 * shade).toFixed(3)})` }}>
      {!reduced && <Confetti t={t} start={W.open} dur={2600} density={wall ? 0.6 : 1} seed={17} />}
      <Win98Window title="Congratulations!" icon="info" x={50} y={50} center width={wall ? "86%" : "62%"} open={open} reduced={reduced} className="hw-win" bodyClassName="hw-body">
        <div className="hw-row">
          <div className="hw-glyph" aria-hidden="true" style={{ transform: `scale(${(pop + bob).toFixed(3)})` }}>
            {glyph}
          </div>
          <div className="hw-copy">
            {name !== null && (
              <div className="hw-who" style={{ opacity: progress(t, W.who, 300) }}>
                {name}
              </div>
            )}
            <div className={`hw-line${name === null ? " hw-line-big" : ""}`}>
              <Typewriter text={text} t={t} start={W.line} cps={40} caret={false} />
            </div>
          </div>
        </div>
        <div className="hw-marquee" style={{ opacity: progress(t, W.line, 400) }}>
          <Marquee t={t} speed={reduced ? 0 : 140}>★ WINNER ★ EVERYONE CHEER ★ WINNER ★ EVERYONE CHEER ★</Marquee>
        </div>
        <div className="hw-actions">
          <Win98Button primary className="hw-ok">OK</Win98Button>
        </div>
      </Win98Window>
    </div>
  );
}

/** Every win scene: one per glyph (the queue matches a big line by its leading glyph). */
export const SCENES: SceneDef[] = [
  {
    id: "house_win",
    when: WIN_GLYPHS.map((g) => ({ moment: "big" as const, name: `${g}*` })),
    ms: WIN_MS,
    tv: HouseWin,
    wall: HouseWin,
    priority: 3,
    over: true,
    face: "pleased",
  },
];

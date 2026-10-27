//! The ad burst (wave 32): a ⚡ in a talk scene, or its timer, from the ad
//! attack on. The story cues `screens_glitch` with the burst's own line
//! (`Night.glitch_text`); on the walls and the TV that is no 8 s takeover but
//! this: `BURST_MS` of adverts tearing through whatever is up — a torn band,
//! the hijack's popups (`AD_MESSAGES`) landing fast, the burst's line slammed
//! across the middle as a banner ad — then gone. It draws over the scene and
//! never replaces it (no slide, no moment, no queue): the scene under it runs
//! on, and nothing of it is history (`slides.ts` `burstLayer` decides when,
//! live only). Takes no taps. A pure picture of `t`, like every scene.

import { AD_MESSAGES } from "../scenes/act1.tsx";
import type { SfxName, SfxOpts } from "../../sound/index.ts";
import { BURST_MS } from "../../slides.ts";
import { useSfxCues } from "./cues.ts";
import { Noise } from "./effects.tsx";
import { PopupStorm, type StormMessage } from "./storm.tsx";
import { ease, eased, progress } from "./time.ts";

/** The burst's beats (ms): the tear, the popups, the banner, the fade. */
export const BURST_BEATS = { tear: 0, storm: 120, banner: 250, fade: BURST_MS - 600, end: BURST_MS } as const;
/** How many popups land, and over how long. */
export const BURST_POPUPS = { count: 8, span: 1700 } as const;

/** The popups: the burst's own line first (as the offer it is), then the hijack's stock. */
export function burstMessages(text: string): StormMessage[] {
  return [{ title: "SPECIAL OFFER", text, kind: "warning" }, ...AD_MESSAGES];
}

/** Its accents, all `over` (he may be talking): a crackle as it tears in, the popups' own pops. */
export const BURST_SFX: ReadonlyArray<readonly [number, SfxName, SfxOpts?]> = [
  [0, "static", { gain: 0.3, over: true }],
  [BURST_BEATS.banner, "glitch", { gain: 0.35, over: true }],
];

export function AdBurst({ t, seq, text, sfx, reduced }: { t: number; seq: number; text: string; sfx?: (name: SfxName, opts?: SfxOpts) => boolean; reduced: boolean }) {
  useSfxCues(t, sfx ?? (() => false), BURST_SFX);
  if (t >= BURST_BEATS.end) return null;
  const out = 1 - progress(t, BURST_BEATS.fade, BURST_BEATS.end - BURST_BEATS.fade);
  const slam = reduced ? 1 : eased(t, BURST_BEATS.banner, 220, ease.outBack);
  return (
    <div className="cutscene-stage cutscene-burst" data-burst={seq} aria-hidden="true" style={{ opacity: out }}>
      <div className="kit-stage ad-burst">
        <div className="kit-stage-fit">
          {!reduced && t < 400 && <div className="ad-burst-tear" style={{ opacity: 1 - progress(t, 150, 250) }} />}
          <PopupStorm t={t} seed={seq * 7 + 11} count={BURST_POPUPS.count} start={BURST_BEATS.storm} span={BURST_POPUPS.span} messages={burstMessages(text)} width="18em" sfx={sfx} sound="popup" reduced={reduced} />
          {t >= BURST_BEATS.banner && (
            <div className="ad-burst-banner" style={{ transform: `translate(-50%, -50%) scale(${(0.6 + 0.4 * slam).toFixed(3)}) rotate(-3deg)` }}>
              <div className="ad-burst-star">★ ★ ★</div>
              <div className="ad-burst-text">{text}</div>
            </div>
          )}
        </div>
        {!reduced && t < 600 && <Noise t={t} alpha={0.35 * (1 - progress(t, 200, 400))} reduced={reduced} />}
      </div>
    </div>
  );
}

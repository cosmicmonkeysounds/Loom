//! (wave 39, C4) The game's graphics quality — pure, node-tested, like
//! `physics.ts`. Three tiers (`low` / `medium` / `high`) set the pixel
//! ratio, the pool of real point lights, the bloom, the grade and the
//! multisampling; `auto` (the default) starts at `medium` on a desktop and
//! `low` on a touch screen, then follows the frame time (`AutoQuality`):
//! down a step when the median of a 2 s window is over 24 ms (under ~42 fps),
//! up a step after 10 s holding the display's rate, at most one change per
//! 5 s, never above the cap. Below `low` sits one more step for an
//! overloaded machine: `low` at a 0.75 pixel ratio.
//!
//! The cap is the device's URL (`?quality=low|medium|high`, `config.ts`; the
//! tent terminal's link passes it through): the in-game setting picks under
//! it, and `auto` adapts under it. The setting is remembered per device in
//! `localStorage` (`QUALITY_KEY`, every access guarded).

export const QUALITY_TIERS = ["low", "medium", "high"] as const;
export type QualityTier = (typeof QUALITY_TIERS)[number];
export const QUALITY_CHOICES = ["auto", ...QUALITY_TIERS] as const;
export type QualityChoice = (typeof QUALITY_CHOICES)[number];

/** What a tier draws. */
export interface QualitySettings {
  tier: QualityTier;
  /** The highest pixel ratio (the device's own is used when lower). */
  pixelRatio: number;
  /** The fixed pool of real `PointLight`s the house lights get. */
  pointLights: number;
  /** Bloom: none, at half the post-processing's resolution, or at its full. */
  bloom: "off" | "half" | "full";
  /** The post-processing pipeline runs (bloom + the grade pass); off: the
   *  renderer's own tone map straight to the screen. */
  post: boolean;
  /** The grade's vignette + film grain. */
  film: boolean;
  /** The grade's faint chromatic edge. */
  chroma: boolean;
  /** MSAA samples on the post-processing's render target (WebGL2); 0: none. */
  msaa: number;
  /** (wave 47) The haze sheets per floor (`HouseScene.setHaze`): 0, 1 (over the floor) or 2 (under the ceiling too). */
  haze: number;
}

export const TIERS: Readonly<Record<QualityTier, Readonly<QualitySettings>>> = {
  low: { tier: "low", pixelRatio: 1, pointLights: 2, bloom: "off", post: false, film: false, chroma: false, msaa: 0, haze: 0 },
  medium: { tier: "medium", pixelRatio: 1, pointLights: 4, bloom: "half", post: true, film: true, chroma: false, msaa: 0, haze: 1 },
  high: { tier: "high", pixelRatio: 1.5, pointLights: 8, bloom: "full", post: true, film: true, chroma: true, msaa: 4, haze: 2 },
};

/** `low` under pressure (auto only): the pixel ratio drops to this. */
export const PRESSURE_PIXEL_RATIO = 0.75;

/**
 * The steps `auto` moves between: 0 = `low` under pressure, 1 = `low`,
 * 2 = `medium`, 3 = `high`.
 */
export type QualityLevel = 0 | 1 | 2 | 3;
export const LEVEL_OF: Readonly<Record<QualityTier, QualityLevel>> = { low: 1, medium: 2, high: 3 };

export function tierOf(level: QualityLevel): QualityTier {
  return level <= 1 ? "low" : level === 2 ? "medium" : "high";
}

/** What a level draws on a device of pixel ratio `dpr`. */
export function settingsAt(level: QualityLevel, dpr = 1): QualitySettings {
  const t = TIERS[tierOf(level)];
  const max = level === 0 ? PRESSURE_PIXEL_RATIO : t.pixelRatio;
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return { ...t, pixelRatio: Math.min(d, max) };
}

/** A choice off the URL / storage / the settings control, null when it isn't one. */
export function parseQuality(v: unknown): QualityChoice | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return (QUALITY_CHOICES as readonly string[]).includes(s) ? (s as QualityChoice) : null;
}

/** The device's cap (the URL's `quality`): `auto` / none = `high`. */
export function capOf(url: QualityChoice | null | undefined): QualityTier {
  return url === undefined || url === null || url === "auto" ? "high" : url;
}

/** Where a session starts: `auto` at `medium` on a desktop GPU and `low` on a
 *  coarse pointer; a fixed tier at itself; never above the cap. */
export function startLevel(choice: QualityChoice, cap: QualityTier, coarse: boolean): QualityLevel {
  const want: QualityLevel = choice === "auto" ? (coarse ? 1 : 2) : LEVEL_OF[choice];
  return Math.min(want, LEVEL_OF[cap]) as QualityLevel;
}

/** The setting as the settings control shows it: the choices over the cap are off. */
export function choiceAllowed(choice: QualityChoice, cap: QualityTier): boolean {
  return choice === "auto" || LEVEL_OF[choice] <= LEVEL_OF[cap];
}

// ── auto ────────────────────────────────────────────────────────────────

/** The adaptive rule's numbers (frame intervals, ms). */
export const AUTO = {
  /** The median is taken over this much of the newest frames. */
  windowMs: 2000,
  /** Down a step when the window's median is over this (under ~42 fps). */
  downMs: 24,
  /**
   * Up a step after `upHoldMs` with every window's median under this. A
   * frame's interval can't go under the display's (16.7 ms at 60 Hz) and
   * the GPU's work isn't measurable from script, so "holding 60 fps" is the
   * sign there's room (the contract's 13 ms is only reachable on a 90 Hz+
   * screen).
   */
  upMs: 17.5,
  upHoldMs: 10_000,
  /** At most one change per this. */
  gapMs: 5000,
  /** A frame longer than this is a pause (a hidden tab, a GC, a shader
   *  compile after a change), not the frame rate: ignored. */
  ignoreAboveMs: 250,
  /** Each time a level was left for being too slow, going back up to it
   *  needs this many times longer (10 s, 30 s, 90 s …): no ping-pong. */
  backoff: 3,
} as const;

/**
 * The adaptive quality: feed it every frame's interval (`sample`), apply the
 * level it answers with. A fixed choice never moves (`adaptive` false).
 */
export class AutoQuality {
  level: QualityLevel;
  readonly max: QualityLevel;
  readonly adaptive: boolean;
  private frames: Array<{ t: number; ms: number }> = [];
  private changedAt: number;
  /** Since when every window's median has been fast enough to step up (null: not now). */
  private fastSince: number | null = null;
  /** Times each level was stepped down from. */
  private readonly fails: number[] = [0, 0, 0, 0];

  constructor(o: { start: QualityLevel; max: QualityLevel; adaptive: boolean; now: number }) {
    this.max = o.max;
    this.level = Math.min(o.start, o.max) as QualityLevel;
    this.adaptive = o.adaptive;
    this.changedAt = o.now;
  }

  /** Forget the window (after a pause: a hidden tab); no change for `gapMs`. */
  reset(now: number): void {
    this.frames = [];
    this.fastSince = null;
    this.changedAt = now;
  }

  /** The median interval of the window, null while it spans under `windowMs`. */
  median(): number | null {
    const f = this.frames;
    if (f.length < 2 || f[f.length - 1]!.t - f[0]!.t < AUTO.windowMs * 0.9) return null;
    const ms = f.map((x) => x.ms).sort((a, b) => a - b);
    const mid = ms.length >> 1;
    return ms.length % 2 === 1 ? ms[mid]! : (ms[mid - 1]! + ms[mid]!) / 2;
  }

  /** One frame's interval at `now`: the new level when it changes, else null. */
  sample(now: number, frameMs: number): QualityLevel | null {
    if (!this.adaptive) return null;
    if (!(frameMs > 0) || frameMs > AUTO.ignoreAboveMs) return null;
    this.frames.push({ t: now, ms: frameMs });
    while (this.frames.length > 0 && now - this.frames[0]!.t > AUTO.windowMs) this.frames.shift();
    const m = this.median();
    if (m === null) return null;
    if (m >= AUTO.upMs) this.fastSince = null;
    else this.fastSince ??= now;
    if (now - this.changedAt < AUTO.gapMs) return null;
    if (m > AUTO.downMs && this.level > 0) {
      this.fails[this.level] = (this.fails[this.level] ?? 0) + 1;
      return this.move((this.level - 1) as QualityLevel, now);
    }
    if (this.fastSince !== null && this.level < this.max) {
      const up = (this.level + 1) as QualityLevel;
      const hold = AUTO.upHoldMs * AUTO.backoff ** (this.fails[up] ?? 0);
      if (now - this.fastSince >= hold) return this.move(up, now);
    }
    return null;
  }

  private move(level: QualityLevel, now: number): QualityLevel {
    this.level = level;
    this.changedAt = now;
    this.frames = [];
    this.fastSince = null;
    return level;
  }
}

// ── the remembered setting ──────────────────────────────────────────────

export const QUALITY_KEY = "loom.reinstall.quality";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The device's remembered setting (`auto` when none, or storage is blocked). */
export function loadQuality(s: Pick<Storage, "getItem"> | null = storage()): QualityChoice {
  try {
    return parseQuality(s?.getItem(QUALITY_KEY) ?? null) ?? "auto";
  } catch {
    return "auto";
  }
}

export function saveQuality(choice: QualityChoice, s: Pick<Storage, "setItem"> | null = storage()): void {
  try {
    s?.setItem(QUALITY_KEY, choice);
  } catch {
    /* private mode: the setting lasts this page */
  }
}

/** The settings control's labels. DRAFT w39 (UI copy). */
export const QUALITY_LABEL: Readonly<Record<QualityChoice, string>> = { auto: "Auto", low: "Low", medium: "Medium", high: "High" };

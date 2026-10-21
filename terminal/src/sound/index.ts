//! The terminal's own sounds (wave 17): `sfx(name)` for the accents a page
//! makes out of its device's speaker, on one bus (`bus.ts`) with the
//! synthesised library (`library.ts`). Story sounds are the house speakers'.

export { MIN_GAP_MS, OVER_GAIN, VIEW_VOLUME, playChime, playNotes, setSoundContext, setSoundMuted, setSoundView, setSoundVolume, sfx, sfxGate, soundMuted, soundVolume, type SfxOpts, type SoundContext } from "./bus.ts";
export { SFX_NAMES, isSfxName, recipe, sfxLength, type SfxName } from "./library.ts";

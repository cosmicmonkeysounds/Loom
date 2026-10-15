//! A synthesised alert chime for the director's editor (K-29: a silent wall
//! terminal). Web Audio only — no asset. Browsers keep an AudioContext
//! suspended until the page has had a user gesture, so the context is made
//! (or resumed) on the first pointer/key press and the chime is a no-op until
//! then. A background tab may throttle it: keep the Run tab in front.

let ctx: AudioContext | null = null
let armed = false

function context(): AudioContext | null {
  if (ctx !== null) return ctx
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (Ctor === undefined) return null
  try {
    ctx = new Ctor()
  } catch {
    return null
  }
  return ctx
}

/** Unlock audio on the first gesture (idempotent; call once at boot). */
export function armChime(): void {
  if (armed || typeof window === 'undefined') return
  armed = true
  const unlock = () => {
    const c = context()
    if (c !== null && c.state === 'suspended') void c.resume().catch(() => {})
  }
  window.addEventListener('pointerdown', unlock, { capture: true })
  window.addEventListener('keydown', unlock, { capture: true })
}

/** Three falling two-tone pairs (~1.5 s) — distinct from anything the show plays. */
export function playChime(): void {
  const c = context()
  if (c === null) return
  if (c.state === 'suspended') void c.resume().catch(() => {})
  const t0 = c.currentTime + 0.02
  for (let i = 0; i < 3; i++) {
    for (const [j, hz] of [988, 659].entries()) {
      const at = t0 + i * 0.5 + j * 0.18
      const osc = c.createOscillator()
      const gain = c.createGain()
      osc.type = 'triangle'
      osc.frequency.value = hz
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16)
      osc.connect(gain).connect(c.destination)
      osc.start(at)
      osc.stop(at + 0.18)
    }
  }
}

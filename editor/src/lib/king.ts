//! The shared King on the Run → House map card (wave 11 C2): one health
//! bar for every guest all night (15 HP on the show's map), a point off for
//! each reinstallation visit's hit, kneeling at 0 — and the bar sets how well
//! he plays chess at the door terminal. The director reads it off the lean
//! screen state (`GET /api/screen/state` → `king`) and sets / restores it with
//! `POST /api/mod/spatial/king {hp}`. The editor has no `@loom/house`
//! dependency, so the wire shape is parsed here, defensively: an older server
//! sends no `king` and the card shows no King.

/** The King as the card shows it. `armed`: the prop's `armed` path holds (a
 *  win counts for the code); null when the map names no path, or when the
 *  answer came from the hit route (which doesn't say). */
export interface KingView {
  hp: number
  max: number
  fallen: boolean
  armed: boolean | null
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A `KingState` (`{id, hp, max, fallen}`) or the screen state's `{hp, max,
 *  fallen, armed}` → the card's view; null for anything else. */
export function kingFromWire(v: unknown): KingView | null {
  if (!isRecord(v) || !isCount(v['hp']) || !isCount(v['max']) || v['max'] <= 0) return null
  const hp = Math.max(0, Math.min(v['max'], Math.round(v['hp'])))
  return {
    hp,
    max: Math.round(v['max']),
    fallen: v['fallen'] === true || hp <= 0,
    armed: typeof v['armed'] === 'boolean' ? v['armed'] : null,
  }
}

/** The screen state's `king` (null / absent = no King, or an older server). */
export function kingFromScreen(state: unknown): KingView | null {
  return isRecord(state) ? kingFromWire(state['king']) : null
}

/** `12 / 15` — what the bar reads (the games' bar reads the same). */
export function kingHpText(k: KingView): string {
  return `${k.hp} / ${k.max}`
}

/** The bar's fill, 0–1. */
export function kingFill(k: KingView): number {
  return k.max <= 0 ? 0 : Math.max(0, Math.min(1, k.hp / k.max))
}

/** A typed health for Set…: a whole number 0..max, else null (the route
 *  refuses anything else, so the card never sends it). */
export function parseKingHp(text: string, max: number): number | null {
  const t = text.trim()
  if (!/^\d{1,3}$/u.test(t)) return null
  const n = Number(t)
  return n >= 0 && n <= max ? n : null
}

/** The line under the bar: kneeling (his door open in both games), or
 *  whether a checkmate at the door terminal counts right now. */
export function kingStatusLine(k: KingView): string {
  if (k.fallen) return 'Kneeling — his door is open in both games for everyone. 👑 Restore stands him up and shuts it.'
  const hits = k.max - k.hp
  const base = hits === 0 ? 'Full health: the door terminal plays at its best.' : `${hits} hit${hits === 1 ? '' : 's'} so far: the door terminal plays weaker.`
  if (k.armed === false) return `${base} A checkmate does not count for the code now.`
  return base
}

/** The confirm before a Set… / Restore (it moves every game and the door
 *  terminal at once). */
export function kingConfirm(k: KingView, hp: number): { title: string; body: string } {
  const restore = hp === k.max
  const lines = [
    `The King goes from ${kingHpText(k)} to ${hp} / ${k.max} for everyone: the tent tablet, the headsets and the chess terminal by the server-room door all follow at once.`,
  ]
  if (hp === 0) lines.push('At 0 he kneels and his guarded door opens in both games.')
  else if (k.fallen) lines.push('He stands up again and his door shuts in both games.')
  return { title: restore ? `Restore the King to full health (${k.max})?` : `Set the King's health to ${hp}?`, body: lines.join('\n\n') }
}

/** Orders the card's King polls against a Set… / Restore: a poll begun
 *  before a write's answer was adopted may carry the old health, so its
 *  answer is dropped (it would flash the pre-restore bar back for a poll
 *  period and invite a second restore). */
export class KingReadOrder {
  private n = 0
  private floor = 0
  /** A poll starts: its ticket. */
  begin(): number {
    return ++this.n
  }
  /** A write's answer was adopted: every poll begun before now is stale. */
  adopt(): void {
    this.floor = ++this.n
  }
  /** Whether a poll's answer may still be shown. */
  fresh(ticket: number): boolean {
    return ticket > this.floor
  }
}

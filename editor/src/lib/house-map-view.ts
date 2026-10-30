//! The house map in Loom Edit (wave 49, C7), pure: the way into Run → House →
//! 🗺 Map, the address of the map's own page, which files are maps, and the
//! Run page's descent select. Copy here is `DRAFT w49`.

import { DESCENT_MAX } from '@loom/house'

/** What the ways in (the palette, the `house*.json` banner, the Run card) do now. */
export type HouseMapRoute = { kind: 'open' } | { kind: 'tell'; title: string; body: string; toRun: boolean }

export function houseMapRoute(s: { server: boolean; running: boolean; lens: boolean }): HouseMapRoute {
  if (!s.server) {
    return {
      kind: 'tell',
      title: 'The house map lives on the event server',
      body: 'This run is in your browser, so there is no house to reach. Open a server project and start its rehearsal to edit the map.',
      toRun: false,
    }
  }
  if (!s.running) {
    return { kind: 'tell', title: 'Start a rehearsal first', body: 'The map is edited on the run: start a rehearsal, then open Run → House → 🗺 Map.', toRun: true }
  }
  if (s.lens) return { kind: 'tell', title: 'Switch to Operator first', body: 'The house map is closed while you are looking as someone else.', toRun: false }
  return { kind: 'open' }
}

/** `/reinstall/map?code=<mod>` on the event server: never this page's origin,
 *  which in development is Vite's. Null with no run. */
export function mapPageUrl(joinUrl: string | null, modCode: string | null): string | null {
  const origin = serverOrigin(joinUrl)
  if (origin === null || modCode === null || modCode === '') return null
  return `${origin}/reinstall/map?code=${encodeURIComponent(modCode)}`
}

/** The event server's origin, off the run's join URL. */
export function serverOrigin(joinUrl: string | null): string | null {
  if (joinUrl === null) return null
  try {
    return new URL(joinUrl).origin
  } catch {
    return null
  }
}

/** A project map file: `house.json` or `house.<variant>.json` at the project's
 *  root (the server's `isMapFile`, `core/server/house-maps.ts`). */
export function isHouseMapFile(path: string | null): boolean {
  return path !== null && /^\/?house(\.[A-Za-z0-9_-]{1,40})?\.json$/u.test(path)
}

/** The select's values: `''` is by visits, else the level forced. */
export const DESCENT_BY_VISITS = ''

export function descentChoices(): { value: string; label: string }[] {
  return [{ value: DESCENT_BY_VISITS, label: 'by visits' }, ...Array.from({ length: DESCENT_MAX + 1 }, (_, n) => ({ value: String(n), label: String(n) }))]
}

export const descentValue = (forced: number | null): string => (forced === null ? DESCENT_BY_VISITS : String(forced))

/** A select value → the `level` to post, null for by visits. */
export function descentLevelOf(value: string): number | null {
  const n = value === DESCENT_BY_VISITS ? NaN : Number(value)
  return Number.isInteger(n) && n >= 0 && n <= DESCENT_MAX ? n : null
}

/** `{forced}` off the wire: anything but a level reads as by visits. */
export function descentFromWire(raw: unknown): number | null {
  const forced = (raw as { forced?: unknown } | null)?.forced
  return typeof forced === 'number' && Number.isInteger(forced) && forced >= 0 && forced <= DESCENT_MAX ? forced : null
}

//! The Log page's participant filter: does a raw `SimEvent` mention a
//! given guest / persona / character id? Pure, so the super-admin's "show
//! me everything that happened to Alice" is unit-testable.

import type { SimEvent } from '@loom/core/sim'

/**
 * True when any string field of the event (or any member of a string
 * array, e.g. `audience` / `speakers`) equals `id`. The event `type` itself
 * never counts. Generic on purpose: a new event kind that names a
 * participant in a new field is matched without touching this file.
 */
export function eventMentions(event: SimEvent, id: string): boolean {
  for (const [key, value] of Object.entries(event as Record<string, unknown>)) {
    if (key === 'type') continue
    if (typeof value === 'string' && value === id) return true
    if (Array.isArray(value) && value.some((v) => v === id)) return true
  }
  return false
}

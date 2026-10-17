import { describe, expect, it } from 'vitest'
import type { CastSummary } from '@/store/cockpit'
import { PartPresence, isSignedIn, partPresence, partPresenceTitle, performerParts } from './parts'

const row = (id: string, more: Partial<CastSummary> = {}): CastSummary => ({ id, faction: null, ...more })

describe('performer parts (T7-04)', () => {
  it('lists only the parts when the server flags them', () => {
    const cast = [
      row('Clippy', { part: true, online: true, held: true }),
      row('Norton', { part: true, online: false, held: false }),
      row('Microsoft Excel', { part: false }),
      row('Kernel', { part: false }),
      row('Trabolta', { part: false, agent: true, online: true }),
    ]
    expect(performerParts(cast).map((c) => c.id)).toEqual(['Clippy', 'Norton'])
  })

  it('an older server flags nothing: every non-agent character, as before', () => {
    const cast = [row('Clippy', { online: false }), row('Trabolta', { agent: true, online: true })]
    expect(performerParts(cast).map((c) => c.id)).toEqual(['Clippy'])
  })

  it('a held part whose phone is not streaming is signed in, phone offline', () => {
    expect(partPresence({ online: true, held: true })).toBe(PartPresence.Online)
    expect(partPresence({ online: false, held: true })).toBe(PartPresence.PhoneOffline)
    expect(partPresence({ online: false, held: false })).toBe(PartPresence.Free)
    expect(partPresence({ online: false })).toBe(PartPresence.Free)
    expect(partPresence({})).toBe(PartPresence.Unknown)
    expect(isSignedIn(PartPresence.PhoneOffline)).toBe(true)
    expect(isSignedIn(PartPresence.Free)).toBe(false)
    expect(partPresenceTitle('Clippy', PartPresence.PhoneOffline)).toContain('phone offline')
    expect(partPresenceTitle('Clippy', PartPresence.Free)).toBe('Nobody is signed in as Clippy')
  })
})

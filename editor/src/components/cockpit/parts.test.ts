import { describe, expect, it } from 'vitest'
import type { CastSummary } from '@/store/cockpit'
import { PartPresence, castPresence, isSignedIn, partPresence, partPresenceTitle, performerParts } from './parts'

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

  it('an agent keeps its worker dot, never counted as a signed-in performer', () => {
    // `online` on an agent row = a stagehand worker is voicing it.
    expect(castPresence({ agent: true, online: true }, false)).toBe(PartPresence.Voiced)
    expect(castPresence({ agent: true, online: false }, false)).toBe(PartPresence.Unvoiced)
    expect(castPresence({ agent: true }, false)).toBe(PartPresence.Unknown)
    expect(isSignedIn(PartPresence.Voiced)).toBe(false)
    expect(partPresenceTitle('Trabolta', PartPresence.Voiced)).toBe('A worker is voicing Trabolta')
    expect(partPresenceTitle('Trabolta', PartPresence.Unvoiced)).toContain('No worker is voicing Trabolta')
    // A part reads its performer presence; the rest of the ensemble has no dot.
    expect(castPresence({ online: false, held: true }, true)).toBe(PartPresence.PhoneOffline)
    expect(castPresence({ online: true }, false)).toBe(PartPresence.Unknown)
  })
})

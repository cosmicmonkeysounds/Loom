// The Mixer's pure view model (wave 40 C4): the wire read, the optimistic
// levels and their release, the words.

import { describe, expect, it } from 'vitest'
import { scopeStrips } from '@loom/core/house-mixer'
import { fixtureMixer } from '@/lib/test/mixer-fixture'
import { bedProgress, bedRooms, formatClock, levelChange, meterTone, mixerMusicOf, mixerViewOf, releasePending, shownLevels, stripNote, type PendingMix } from './house-mixer-view'

describe('reading the mixer off the wire', () => {
  it('fills what an answer leaves out, and refuses one with no mix', () => {
    const v = mixerViewOf({ mix: { seq: 4, levels: { 'src:music': { db: -6, mute: false }, bogus: { db: 1 } } } })!
    expect(v.mix).toEqual({ seq: 4, levels: { 'src:music': { db: -6, mute: false } } })
    expect(v.sources).toEqual([])
    expect(v.rooms).toEqual([])
    expect(v.meters).toBe(null)
    expect(v.music).toBe(null)
    expect(v.router).toEqual({ online: false, lastSeen: null, name: null })
    expect(mixerViewOf({ rooms: [] })).toBe(null)
    expect(mixerViewOf('nope')).toBe(null)
  })

  it('keeps the soundtrack’s wave 40 fields only when sound', () => {
    const m = mixerMusicOf({ scene: 'act_1', beds: [{ playlist: 'lounge', speakers: ['a'], track: 't', posS: 3, durS: 0 }, { nope: 1 }], missing: ['x', 2], hand: true, scenes: ['off', 'act_1'] })!
    expect(m.beds).toEqual([{ playlist: 'lounge', speakers: ['a'], track: 't', posS: 3 }])
    expect(m.missing).toEqual(['x'])
    expect(m.hand).toBe(true)
    expect(m.scenes).toEqual(['off', 'act_1'])
    expect(mixerMusicOf({ scene: null, beds: [], missing: [] })).toEqual({ scene: null, beds: [], missing: [] })
  })
})

describe('the optimistic levels', () => {
  const server = { 'src:music': { db: -6, mute: false }, 'room:living': { db: 0, mute: true } }

  it('lays the pending moves over the server’s levels', () => {
    const pending: PendingMix = {
      'src:music': { change: { key: 'src:music', db: -12, mute: false }, version: 1, until: null },
      'room:living': { change: { key: 'room:living', reset: true }, version: 2, until: 5 },
      'spk:living_sub': { change: { key: 'spk:living_sub', db: 3, mute: false }, version: 3, until: 7 },
    }
    expect(shownLevels(server, pending)).toEqual({ 'src:music': { db: -12, mute: false }, 'spk:living_sub': { db: 3, mute: false } })
    expect(shownLevels(server, {})).toEqual(server)
  })

  it('releases a move once the server’s seq reaches its answer, never one unanswered', () => {
    const pending: PendingMix = {
      a: { change: { key: 'master', db: -1 }, version: 1, until: null },
      b: { change: { key: 'src:sfx', db: -1 }, version: 2, until: 5 },
      c: { change: { key: 'src:tracks', db: -1 }, version: 3, until: 6 },
    }
    expect(Object.keys(releasePending(pending, 4))).toEqual(['a', 'b', 'c'])
    expect(Object.keys(releasePending(pending, 5))).toEqual(['a', 'c'])
    expect(Object.keys(releasePending(pending, 9))).toEqual(['a'])
  })

  it('a change carries the whole level, clamped to the grid', () => {
    expect(levelChange(server, 'room:living', { db: -3.26 })).toEqual({ key: 'room:living', db: -3.5, mute: true })
    expect(levelChange(server, 'src:music', { mute: true })).toEqual({ key: 'src:music', db: -6, mute: true })
    expect(levelChange({}, 'master', { db: 99 })).toEqual({ key: 'master', db: 10, mute: false })
  })
})

describe('the words', () => {
  it('“plays at” when the levels above move a strip, “silent” when they mute it', () => {
    const v = fixtureMixer({ levels: { 'src:music': { db: -6, mute: false }, master: { db: 0, mute: true } } })
    const living = scopeStrips(v, { kind: 'room', room: 'living' })
    const music = living.find((s) => s.source === 'music')!
    expect(stripNote(music)).toBe('silent: a level above is muted or down')
    const all = scopeStrips(v, { kind: 'all' })
    expect(stripNote(all[0]!)).toBe(null) // the muted master itself: its button says so
    const v2 = fixtureMixer({ levels: { 'src:music': { db: -6, mute: false } } })
    const lm = scopeStrips(v2, { kind: 'room', room: 'living' }).find((s) => s.source === 'music')!
    expect(stripNote(lm)).toBe('plays at −6.0 dB')
    expect(stripNote(scopeStrips(v2, { kind: 'all' }).find((s) => s.source === 'music')!)).toBe(null)
  })

  it('names a bed’s rooms, its progress and the clock', () => {
    const v = fixtureMixer()
    expect(bedRooms(v, v.music!.beds[0]!)).toEqual(['Living room'])
    expect(bedRooms(v, { speakers: ['kitchen', 'living_sub'] })).toEqual(['Living room', 'Kitchen'])
    expect(bedProgress(v.music!.beds[0]!)).toBe(0.25)
    expect(bedProgress(v.music!.beds[1]!)).toBe(null)
    expect(bedProgress({ posS: 500, durS: 100 })).toBe(1)
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(125.9)).toBe('2:05')
    expect([meterTone(null), meterTone(-70), meterTone(-20), meterTone(-6), meterTone(-0.5)]).toEqual(['off', 'off', 'ok', 'hot', 'clip'])
  })
})

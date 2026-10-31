import { describe, expect, it } from 'vitest'
import {
  announceTerminalsOf,
  audioStatusOf,
  routerLine,
  routerOf,
  sourceLabel,
  StopOutcome,
  parseAudioFile,
  sameBesideHouseList,
  withAnnounceTerminals,
  stopButtonLabel,
  stopFailedText,
  stopOutcomeOf,
  stopResultText,
  withAnnounceTerminal,
} from './house-audio'

const AUDIO = {
  version: 1,
  device: { name: '828x', inputs: 24, outputs: 22 },
  inputs: [],
  outputs: [],
  speakers: [{ id: 'kitchen', name: 'Kitchen', out: [1, 2] }],
  zones: [],
  routes: [],
  cues: { dance_song: { to: ['everywhere'] } },
  announce: { to: ['everywhere'], chime: true },
}

describe('audioStatusOf', () => {
  it('reads the GET answer; anything else is null', () => {
    const s = audioStatusOf({ audio: AUDIO, version: 'v1', source: 'project', router: { online: true, lastSeen: 5, name: 'house-mac' }, problems: [], warnings: ['x'], now: 9, tests: [], stops: [] })
    expect(s).toMatchObject({ version: 'v1', source: 'project', router: { online: true, name: 'house-mac' }, warnings: ['x'], now: 9 })
    expect(audioStatusOf({ version: 'v1' })).toBeNull()
    expect(audioStatusOf(null)).toBeNull()
    expect(audioStatusOf({ audio: AUDIO, version: 'v1', source: 'weird' })?.source).toBe('default')
    expect(routerOf(undefined)).toEqual({ online: false, lastSeen: null, name: null })
  })
})

describe('the house list (announce.terminals)', () => {
  it('ticks a spot on and off, keeping everything else', () => {
    expect(announceTerminalsOf(AUDIO)).toEqual([])
    const on = withAnnounceTerminal(AUDIO, 'casino', true)
    expect(announceTerminalsOf(on)).toEqual(['casino'])
    expect(on['announce']).toEqual({ to: ['everywhere'], chime: true, terminals: ['casino'] })
    expect(on['cues']).toEqual(AUDIO.cues)
    // The input is never mutated.
    expect(AUDIO.announce).toEqual({ to: ['everywhere'], chime: true })
    const two = withAnnounceTerminal(on, 'tent', true)
    expect(announceTerminalsOf(two)).toEqual(['casino', 'tent'])
    // Ticking a listed spot again changes nothing (its place kept).
    expect(announceTerminalsOf(withAnnounceTerminal(two, 'casino', true))).toEqual(['casino', 'tent'])
    const off = withAnnounceTerminal(withAnnounceTerminal(on, 'casino', false), 'tent', false)
    expect(off['announce']).toEqual({ to: ['everywhere'], chime: true })
  })

  it('a config with no announce block gets the router default, so the speakers never move', () => {
    const { announce: _drop, ...bare } = AUDIO
    void _drop
    expect(withAnnounceTerminal(bare, 'tent', true)['announce']).toEqual({ to: ['everywhere'], terminals: ['tent'] })
  })
})

describe('the card lines', () => {
  it('says whether the router listens', () => {
    expect(routerLine({ online: true, lastSeen: 1, name: 'house-mac' }, 2)).toBe('Router online · house-mac')
    expect(routerLine({ online: false, lastSeen: null, name: null }, 2)).toMatch(/none has polled/u)
    expect(routerLine({ online: false, lastSeen: 0, name: null }, 4 * 60_000)).toBe('No router listening (last seen 4 min ago)')
    expect(routerLine({ online: false, lastSeen: 0, name: 'mac' }, 10_000)).toBe('No router listening (last seen under a minute ago, mac)')
  })

  it('says what a stop came to', () => {
    const online = { ok: true as const, seq: 1, router: { online: true, lastSeen: 1, name: null } }
    expect(stopResultText(online, false)).toBe('■ Stopped the house sounds')
    expect(stopResultText(online, true)).toBe('■ Stopped the house sounds and the announcement')
    const deaf = { ...online, router: { online: false, lastSeen: null, name: null } }
    // No router: the stop can't reach the Desktop, which may still be playing.
    expect(stopResultText(deaf, false)).toMatch(/^No router is listening, so the stop can’t reach the Desktop: stop it there/u)
    expect(stopResultText(deaf, false)).toContain('stagehand sounds stop')
    expect(stopResultText(deaf, false)).not.toMatch(/nothing was playing/u)
    expect(stopOutcomeOf(online)).toBe(StopOutcome.Stopped)
    expect(stopOutcomeOf(deaf)).toBe(StopOutcome.NoRouter)
  })

  it('a failed stop says nothing was stopped, never "no router"', () => {
    expect(stopFailedText('Unauthorized')).toMatch(/^The stop failed \(Unauthorized\): nothing was stopped\. Press it again/u)
    expect(stopButtonLabel(StopOutcome.Failed)).toBe('■ Stop failed: retry')
    expect(stopButtonLabel(StopOutcome.NoRouter)).toMatch(/^■ No router/u)
    expect(stopButtonLabel(StopOutcome.Stopped)).toBe('■ Stopped')
  })

  it('names where the config comes from; a director save points at Save to project', () => {
    expect(sourceLabel('director')).toMatch(/Save to project/u)
    expect(sourceLabel('project')).toBe('the project’s audio.json')
  })

  it('compares two configs on everything but the house list', () => {
    const project = { version: 1, speakers: [{ id: 'a' }], cues: { x: { to: ['a'] } } }
    // A tick on a config with no announce block adds the router's default one: still only the list.
    expect(sameBesideHouseList(project, withAnnounceTerminals(project, ['tent']))).toBe(true)
    expect(sameBesideHouseList({ ...project, announce: { to: ['everywhere'], terminals: ['x'] } }, { cues: project.cues, speakers: project.speakers, version: 1 })).toBe(true)
    // Another speaker, or announcements moved: more than the list.
    expect(sameBesideHouseList(project, { ...project, speakers: [{ id: 'a' }, { id: 'b' }] })).toBe(false)
    expect(sameBesideHouseList(project, { ...project, announce: { to: ['kitchen'] } })).toBe(false)
  })

  it('sets the house list exactly, and reads a project file', () => {
    expect(withAnnounceTerminals({ announce: { to: ['a'], terminals: ['x'] } }, ['tent', 'casino'])).toEqual({ announce: { to: ['a'], terminals: ['tent', 'casino'] } })
    expect(withAnnounceTerminals({ announce: { to: ['a'], terminals: ['x'] } }, [])).toEqual({ announce: { to: ['a'] } })
    expect(parseAudioFile('{"version":1}')).toEqual({ version: 1 })
    expect(parseAudioFile('')).toBeNull()
    expect(parseAudioFile('not json')).toBeNull()
    expect(parseAudioFile('[1]')).toBeNull()
    expect(parseAudioFile(undefined)).toBeNull()
  })
})

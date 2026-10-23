import { describe, expect, it } from 'vitest'
import {
  SpotClaim,
  TERMINAL_VIEWS,
  TerminalView,
  characterOptions,
  doubleClaims,
  isStationView,
  isTerminalView,
  mapLocations,
  mapTerminals,
  pickSpot,
  pickView,
  roomHelp,
  roomOptions,
  spotClaim,
  suggestRoom,
  suggestView,
  terminalBase,
  terminalLink,
  unclaimedSpots,
  viewHasCharacter,
  viewHasDoor,
  viewHasKeys,
  type TerminalSetup,
} from '@/lib/terminal-setup'

const HOUSE = {
  house: {
    rooms: [
      { id: 'desktop', location: 'The Desktop' },
      { id: 'server-room', location: 'The Server Room' },
      { id: 'basement-hall', location: 'The Tube' },
      { id: 'tent' },
    ],
    terminals: [
      { id: 'desktop-tv', name: 'Desktop TV', room: 'desktop' },
      { id: 'server-room', name: 'Server Room', room: 'server-room' },
      { id: 'server-room-door', name: 'Server Door', room: 'basement-hall' },
      { id: 'tent', name: '', room: 'tent' },
      { id: 'tent', name: 'dupe', room: 'tent' },
      { name: 'no id' },
    ],
  },
  version: 'v1',
}

const BLANK: TerminalSetup = { name: '', spot: '', view: TerminalView.Auto, room: '', character: 'Trabolta', announce: false }

describe('TERMINAL_VIEWS', () => {
  it('lists every view the terminal app takes, shadow included, each with a label and help', () => {
    // Kept in step with terminal/src/config.ts `VIEWS` (wave 18b: reinstall, the tent laptop).
    expect(TERMINAL_VIEWS.map((v) => v.id)).toEqual(['auto', 'world', 'face', 'mirror', 'tv', 'chess', 'shadow', 'casino', 'reinstall'])
    for (const v of TERMINAL_VIEWS) {
      expect(v.label).not.toBe('')
      expect(v.help.length).toBeGreaterThan(10)
    }
    expect(isTerminalView('shadow')).toBe(true)
    expect(isTerminalView('kiosk')).toBe(false)
  })
})

describe('mapTerminals', () => {
  it('reads the spots off the house answer with each room’s LOCATION; skips dupes and junk', () => {
    expect(mapTerminals(HOUSE)).toEqual([
      { id: 'desktop-tv', name: 'Desktop TV', room: 'desktop', location: 'The Desktop' },
      { id: 'server-room', name: 'Server Room', room: 'server-room', location: 'The Server Room' },
      { id: 'server-room-door', name: 'Server Door', room: 'basement-hall', location: 'The Tube' },
      { id: 'tent', name: 'tent', room: 'tent', location: '' },
    ])
  })
  it('takes a bare map too, and nothing from garbage', () => {
    expect(mapTerminals(HOUSE.house).map((t) => t.id)).toHaveLength(4)
    expect(mapTerminals(null)).toEqual([])
    expect(mapTerminals({ house: 3 })).toEqual([])
  })
  it('lists the map’s LOCATIONs', () => {
    expect(mapLocations(HOUSE)).toEqual(['The Desktop', 'The Server Room', 'The Tube'])
  })
})

describe('suggestions', () => {
  const map = mapTerminals(HOUSE)
  const spot = (id: string) => map.find((t) => t.id === id)!
  it('the TV spot plays tv, the door chess, the server room face, the rest auto', () => {
    expect(suggestView('desktop-tv')).toBe(TerminalView.Tv)
    expect(suggestView('server-room-door')).toBe(TerminalView.Chess)
    expect(suggestView('server-room')).toBe(TerminalView.Face)
    expect(suggestView('start-bar')).toBe(TerminalView.Auto)
    expect(suggestView('tent')).toBe(TerminalView.Reinstall)
  })
  it('the reinstallation station (wave 18b) is roomless and speaks for nobody', () => {
    expect(isStationView(TerminalView.Reinstall)).toBe(true)
    expect(isStationView(TerminalView.Face)).toBe(false)
    expect(viewHasCharacter(TerminalView.Reinstall)).toBe(false)
    expect(suggestRoom(spot('server-room'), TerminalView.Reinstall)).toBe('')
    expect(pickSpot(BLANK, spot('tent'))).toMatchObject({ spot: 'tent', view: 'reinstall', room: '' })
    expect(roomHelp(TerminalView.Reinstall)).toMatch(/no room/u)
    const link = new URL(terminalLink('https://x.test/terminal/', 'M', { ...BLANK, spot: 'tent', view: TerminalView.Reinstall, room: 'The Internet', announce: true })).searchParams
    expect(link.get('view')).toBe('reinstall')
    expect(link.has('character')).toBe(false)
    expect(link.has('room')).toBe(false)
    expect(link.get('announce')).toBe('1')
  })
  it('only the TV and the server-room spot get a room; chess never', () => {
    expect(suggestRoom(spot('desktop-tv'), TerminalView.Tv)).toBe('The Desktop')
    expect(suggestRoom(spot('server-room'), TerminalView.Face)).toBe('The Server Room')
    expect(suggestRoom(spot('server-room'), TerminalView.Chess)).toBe('')
    expect(suggestRoom(spot('server-room-door'), TerminalView.Auto)).toBe('')
    expect(suggestRoom(null, TerminalView.Tv)).toBe('')
  })
  it('picking a spot fills name, view and room; picking a view re-derives the room', () => {
    const s = pickSpot(BLANK, spot('server-room-door'))
    expect(s).toMatchObject({ spot: 'server-room-door', name: 'Server Door', view: 'chess', room: '', character: 'Trabolta' })
    const tv = pickSpot(s, spot('desktop-tv'))
    expect(tv).toMatchObject({ name: 'Desktop TV', view: 'tv', room: 'The Desktop' })
    expect(pickView(tv, TerminalView.World, spot('desktop-tv')).room).toBe('')
  })
  it('the map’s own screen and room-terminal flag win over the guess', () => {
    const wire = { house: { ...HOUSE.house, terminals: [
      { id: 'graphics-card', name: 'Casino', room: 'desktop', view: 'casino' },
      { id: 'hall', name: 'Hall', room: 'server-room', speaks: true },
      { id: 'server-room', name: 'Server Room', room: 'server-room', speaks: false },
      { id: 'odd', name: 'Odd', room: 'desktop', view: 'kiosk', speaks: 'yes' },
    ] } }
    const m = mapTerminals(wire)
    expect(m[3]).not.toHaveProperty('view')
    expect(m[3]).not.toHaveProperty('speaks')
    expect(pickSpot(BLANK, m[0]!)).toMatchObject({ name: 'Casino', view: 'casino', room: '' })
    expect(pickSpot(BLANK, m[1]!)).toMatchObject({ view: 'auto', room: 'The Server Room' })
    expect(pickSpot(BLANK, m[2]!)).toMatchObject({ view: 'face', room: '' })
  })
  it('carries the map’s voice-link flag only when it is a boolean', () => {
    const m = mapTerminals({ house: { ...HOUSE.house, terminals: [
      { id: 'tent', name: 'Tent', room: 'tent', voice: false },
      { id: 'hall', name: 'Hall', room: 'hall', voice: true },
      { id: 'cpu', name: 'CPU', room: 'cpu' },
      { id: 'odd', name: 'Odd', room: 'cpu', voice: 'no' },
    ] } })
    expect(m.map((t) => t.voice)).toEqual([false, true, undefined, undefined])
    expect(m[2]).not.toHaveProperty('voice')
    expect(m[3]).not.toHaveProperty('voice')
  })
  it('room options: the map’s, then the story’s, unique', () => {
    expect(roomOptions(map, mapLocations(HOUSE), ['The Desktop', 'The Cloud', 'the tube'])).toEqual(['The Desktop', 'The Server Room', 'The Tube', 'The Cloud'])
  })
  it('characters: agent-voiced first', () => {
    expect(characterOptions([{ id: 'Clippy' }, { id: 'Trabolta', agent: true }, { id: 'Adobe' }])).toEqual([
      { id: 'Trabolta', agent: true },
      { id: 'Adobe', agent: false },
      { id: 'Clippy', agent: false },
    ])
  })
})

describe('terminalLink', () => {
  it('builds the provisioning link off the join URL’s origin', () => {
    expect(terminalBase('https://app.example.com/?code=ABCD')).toBe('https://app.example.com/terminal/')
    expect(terminalBase('not a url')).toBeNull()
    const link = terminalLink('https://x.test/terminal/', 'MOD1', { name: 'Server Room', spot: 'server-room', view: TerminalView.Face, room: 'The Server Room', character: 'Trabolta', announce: false })
    expect(link).toBe('https://x.test/terminal/?code=MOD1&name=Server%20Room&character=Trabolta&spot=server-room&view=face&room=The%20Server%20Room')
    // Unticked, the link names no announce: the tablet follows the house setting (wave 18b).
    expect(new URL(link).searchParams.has('announce')).toBe(false)
    const p = new URL(link).searchParams
    expect(p.get('room')).toBe('The Server Room')
  })
  it('chess carries no character and no room; a blank spot or room is left out', () => {
    const chess = new URL(terminalLink('https://x.test/terminal/', 'M', { ...BLANK, name: 'Door', spot: 'server-room-door', view: TerminalView.Chess, room: 'The Tube' })).searchParams
    expect(chess.has('character')).toBe(false)
    expect(chess.has('room')).toBe(false)
    expect(chess.get('view')).toBe('chess')
    const bare = new URL(terminalLink('https://x.test/terminal/', 'M', { ...BLANK, announce: true })).searchParams
    expect(bare.has('spot')).toBe(false)
    expect(bare.has('name')).toBe(false)
    expect(bare.get('announce')).toBe('1')
  })
})

describe('spot claims', () => {
  const map = mapTerminals(HOUSE)
  it('a row’s spot is on the map, off it, unplaced, or unknown without a map', () => {
    expect(spotClaim('tent', map)).toBe(SpotClaim.OnMap)
    expect(spotClaim('kitchen', map)).toBe(SpotClaim.OffMap)
    expect(spotClaim('', map)).toBe(SpotClaim.Unplaced)
    expect(spotClaim('kitchen', null)).toBe(SpotClaim.Unknown)
  })
  it('unclaimed = map spots with no live terminal; a silent one leaves its spot unclaimed', () => {
    const rows = [
      { spot: 'tent', status: 'live' },
      { spot: 'server-room', status: 'silent' },
      { spot: 'desktop-tv', status: 'live' },
    ]
    expect(unclaimedSpots(map, rows).map((t) => t.id)).toEqual(['server-room', 'server-room-door'])
  })
  it('flags a spot two live terminals claim', () => {
    expect([...doubleClaims([{ spot: 'tent', status: 'live' }, { spot: 'tent', status: 'live' }, { spot: 'ram', status: 'live' }, { spot: 'ram', status: 'silent' }])]).toEqual(['tent'])
  })
})

describe('the keyboard and the door sensor (wave 20)', () => {
  const map = mapTerminals(HOUSE)
  const spot = (id: string) => map.find((t) => t.id === id)!
  const link = (s: Partial<TerminalSetup>) => new URL(terminalLink('https://x.test/terminal/', 'M', { ...BLANK, ...s })).searchParams

  it('a keyboard is the default: no keys key unless unticked', () => {
    expect(link({ view: TerminalView.Face }).has('keys')).toBe(false)
    expect(link({ view: TerminalView.Face, keys: true }).has('keys')).toBe(false)
    expect(link({ view: TerminalView.Face, keys: false }).get('keys')).toBe('0')
  })

  it('door=serial only when ticked', () => {
    expect(link({ view: TerminalView.Face }).has('door')).toBe(false)
    expect(link({ view: TerminalView.Face, door: true }).get('door')).toBe('serial')
  })

  it('neither rides a view with no composer (stations, the TV, a mirror)', () => {
    for (const view of [TerminalView.Chess, TerminalView.Casino, TerminalView.Reinstall, TerminalView.Tv, TerminalView.Mirror]) {
      expect(viewHasKeys(view)).toBe(false)
      expect(viewHasDoor(view)).toBe(false)
      const p = link({ view, keys: false, door: true })
      expect(p.has('keys')).toBe(false)
      expect(p.has('door')).toBe(false)
    }
    for (const view of [TerminalView.Auto, TerminalView.Face, TerminalView.World, TerminalView.Shadow]) expect(viewHasKeys(view)).toBe(true)
  })

  it('picking the server room’s spot ticks the door sensor; another spot clears it', () => {
    const sr = pickSpot(BLANK, spot('server-room'))
    expect(sr).toMatchObject({ view: 'face', door: true })
    expect(link(sr).get('door')).toBe('serial')
    expect(pickSpot(sr, spot('desktop-tv')).door).toBe(false)
    expect(pickSpot(sr, spot('server-room-door')).door).toBe(false)
  })

  it('the server room’s whole link', () => {
    const s = { ...pickSpot(BLANK, spot('server-room')), keys: false }
    expect(terminalLink('https://x.test/terminal/', 'MOD1', s)).toBe(
      'https://x.test/terminal/?code=MOD1&name=Server%20Room&character=Trabolta&spot=server-room&view=face&room=The%20Server%20Room&keys=0&door=serial',
    )
  })
})

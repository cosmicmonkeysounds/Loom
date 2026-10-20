import { describe, expect, it } from 'vitest'
import {
  SpotClaim,
  TERMINAL_VIEWS,
  TerminalView,
  characterOptions,
  doubleClaims,
  isTerminalView,
  mapLocations,
  mapTerminals,
  pickSpot,
  pickView,
  roomOptions,
  spotClaim,
  suggestRoom,
  suggestView,
  terminalBase,
  terminalLink,
  unclaimedSpots,
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
    expect(TERMINAL_VIEWS.map((v) => v.id)).toEqual(['auto', 'world', 'face', 'mirror', 'tv', 'chess', 'shadow', 'casino'])
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
    expect(link).toBe('https://x.test/terminal/?code=MOD1&name=Server%20Room&character=Trabolta&spot=server-room&view=face&room=The%20Server%20Room&announce=0')
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

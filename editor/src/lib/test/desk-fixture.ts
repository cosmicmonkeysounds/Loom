// A fixture `DeskView` (wave 25) for the House page's tests: a small house
// with two speakers, two outputs, two story sounds (one missing on the
// house Mac), one RGB bulb, one look, and a three-cue desk.

import type { DeskConfig, DeskHouse, DeskView } from '@loom/core/house-desk'

export function fixtureDesk(): DeskConfig {
  return {
    version: 1,
    cues: [
      { id: 'preshow', number: '1', name: 'Pre-show', section: 'Doors', steps: [{ kind: 'look', look: 'warm' }, { kind: 'sound', sound: 'lobby_loop', start: 'with' }] },
      {
        id: 'heart_reveal',
        number: '12',
        name: 'The Heart wakes',
        section: 'The Heart',
        done: 'heart_reveal_done',
        steps: [
          { kind: 'look', look: 'warm' },
          { kind: 'sound', sound: 'server_hum', to: ['Server room speaker'], start: 'with', wait: 500 },
          { kind: 'event', event: 'heart_speaks' },
          { kind: 'speech', room: 'The Server Room', start: 'with', max: 30000 },
        ],
      },
      { id: 'blackout', name: 'Blackout', steps: [{ kind: 'wait', ms: 2000 }] },
    ],
  }
}

export function fixtureHouse(over: Partial<DeskHouse> = {}): DeskHouse {
  return {
    router: { online: true, lastSeen: 1_000, name: 'house-mac' },
    health: { at: 1_000, ok: true, device: 'MOTU 828x', layout: 'ok', voices: 0, xruns: 0, peakDb: null, announce: 'on', missing: ['lobby_loop'], placeholders: [], files: 1 },
    speakers: [
      { id: 'sr', name: 'Server room speaker', room: 'server', roomName: 'Server room', out: [1] },
      { id: 'lr', name: 'Living room speaker', room: 'living', roomName: 'Living room', out: [2] },
    ],
    outputs: [
      { ch: 1, label: 'Out 1' },
      { ch: 2, label: 'Out 2' },
    ],
    zones: [],
    sounds: [
      { name: 'lobby_loop', to: null, file: 'missing', ms: null },
      { name: 'server_hum', to: ['sr'], file: 'ok', ms: 4000 },
    ],
    audioTargets: ['Server room speaker', 'Living room speaker', 'everywhere'],
    lightsModule: { online: true, lastSeen: 1_000, name: 'desktop' },
    fixtures: [{ id: 'server_room_rgb', name: 'Server room RGB', room: 'server', roomName: 'Server room', kind: 'bulb', caps: { color: true, ct: true, dim: true }, safety: false, device: 'server_room_rgb', inZ2m: true }],
    lightZones: [],
    looks: [{ name: 'warm', to: ['server_room_rgb'], ms: 1500, loop: false }],
    lightTargets: ['server_room_rgb', 'Server room', 'everywhere'],
    pairUntil: null,
    rooms: ['The Server Room', 'The Living Room'],
    events: ['heart_speaks', 'heart_reveal_done'],
    ...over,
  }
}

export function fixtureView(over: Partial<DeskView> = {}): DeskView {
  return {
    desk: fixtureDesk(),
    version: 'v1',
    source: 'project',
    problems: [],
    warnings: [],
    rev: 1,
    now: 10_000,
    standby: 'preshow',
    runs: [],
    marks: {},
    live: false,
    house: fixtureHouse(),
    recent: [],
    ...over,
  }
}

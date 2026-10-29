// A small house for the Mixer's tests: two rooms (the living room with its
// sub), the TV routed, Clippy's mic meter-only, a soundtrack with two beds.

import { mixerRooms, mixerSources, type MixerAudioShape, type MixerView, type MixLevel } from '@loom/core/house-mixer'

export const MIXER_AUDIO: MixerAudioShape = {
  inputs: [
    { ch: 3, label: 'TV', role: 'trabolta' },
    { ch: 4, label: 'Clippy mic', role: 'clippy' },
  ],
  speakers: [
    { id: 'living_l', name: 'Living L', room: 'living', out: [9] },
    { id: 'living_sub', name: 'Living sub', room: 'living', out: [1] },
    { id: 'kitchen', name: 'Kitchen', room: 'kitchen', out: [3] },
  ],
  routes: [{ in: 3, out: [9, 3] }],
}

const ROOM_NAMES: Record<string, string> = { living: 'Living room', kitchen: 'Kitchen' }

export function fixtureMixer(over: { levels?: Record<string, MixLevel>; seq?: number } & Partial<Omit<MixerView, 'mix'>> = {}): MixerView {
  const { levels, seq, ...rest } = over
  return {
    mix: { seq: seq ?? 1, levels: levels ?? {} },
    sources: mixerSources(MIXER_AUDIO),
    rooms: mixerRooms(MIXER_AUDIO, (id) => ROOM_NAMES[id] ?? null),
    meters: { at: 1000, outputs: { '9': -12, '1': -30, '3': -70 }, inputs: { '3': -20, '4': -8 }, sources: {}, buses: { music: { '9': -14, '3': -40 } } },
    music: {
      scene: 'act_1',
      beds: [
        { playlist: 'lounge', speakers: ['living_l', 'living_sub'], track: 'Dial-up Dreams', posS: 30, durS: 120 },
        { playlist: 'kitchen_bed', speakers: ['kitchen'], track: null, posS: 0 },
      ],
      missing: ['heart'],
      scenes: ['off', 'doors', 'act_1', 'act_2'],
      playlists: [{ name: 'lounge', tracks: 4, loop: true }],
    },
    router: { online: true, lastSeen: 1000, name: 'house-desktop' },
    now: 1000,
    ...rest,
  }
}

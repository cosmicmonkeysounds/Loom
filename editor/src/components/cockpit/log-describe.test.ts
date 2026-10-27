import { describe, expect, it } from 'vitest'
import { SimEventType, type SimEvent, type WalletCard } from '@loom/core/sim'
import { describeEvent } from './log-describe'

const card: WalletCard = {
  kind: 'offer',
  id: 'o7',
  step: 'accepted',
  from: 'g-1',
  fromName: 'Excel',
  to: 'g-2',
  toName: 'Winamp',
  amount: 40,
  unit: 'Truthcoin',
  entry: 'kernel_combo',
  entryTitle: 'The Kernel Combo',
  by: 'CRA Agent Software',
}

/** One sample per event kind — typed as a full record, so a new kind needs a sample here too. */
const SAMPLES: { [K in SimEventType]: Extract<SimEvent, { type: K }> } = {
  accountCreated: { type: 'accountCreated', person: 'g-1', name: 'Excel', role: 'guest' },
  joined: { type: 'joined', person: 'g-1', faction: 'Mods' },
  defected: { type: 'defected', person: 'g-1', from: null, to: 'Mods' },
  betrayed: { type: 'betrayed', person: 'g-1', displayed: 'Mods', secret: 'Chatters' },
  factionRevealed: { type: 'factionRevealed', faction: 'Antivirus' },
  revealed: { type: 'revealed', target: 'The Tube', kind: 'location', person: 'g-1' },
  scanned: { type: 'scanned', scanner: 'Norton', person: 'g-1' },
  captured: { type: 'captured', person: 'g-1', location: 'The Internet', by: 'Norton' },
  released: { type: 'released', person: 'g-1', location: 'The Internet' },
  escaped: { type: 'escaped', person: 'g-1' },
  arrived: { type: 'arrived', person: 'g-1', location: 'The Desktop', from: 'The Tube' },
  cast: { type: 'cast', person: 'g-1', role: 'program' },
  promoted: { type: 'promoted', person: 'g-1', role: 'admin' },
  worldSet: { type: 'worldSet', path: 'Night.phase', value: '3' },
  relationshipChanged: { type: 'relationshipChanged', subject: 'Trabolta', relation: 'trusts', object: 'g-1', value: 5 },
  broadcast: { type: 'broadcast', cue: 'lights out', audience: [], scope: '' },
  dialogue: { type: 'dialogue', speaker: 'Clippy', text: 'hi', audience: [], setting: null, beat: null },
  chat: { type: 'chat', from: 'Excel', channel: 'lobby', text: 'yo', audience: 'all', parentSeq: null },
  channelInvited: { type: 'channelInvited', channel: 'room:x', person: 'g-2', by: 'g-1' },
  channelLeft: { type: 'channelLeft', channel: 'room:x', person: 'g-2' },
  action: { type: 'action', text: 'The lights flicker.', setting: null, beat: null },
  directive: { type: 'directive', verb: 'cue', args: 'blackout' },
  beatEntered: { type: 'beatEntered', beat: 'Login', setting: null, subject: 'g-1' },
  choicePrompted: { type: 'choicePrompted', person: 'g-1', promptId: 'p1', options: ['a', 'b'] },
  chose: { type: 'chose', person: 'g-1', id: 3, beat: 'Heart Layer One', text: 'I am a person.' },
  choiceUpdated: { type: 'choiceUpdated', person: 'g-1', id: 3, options: ['a', 'b', 'c'] },
  respond: { type: 'respond', to: 'Norton', text: 'clean' },
  widget: { type: 'widget', widget: 'captcha', text: 'Prove it', params: {}, audience: ['g-1'], scope: 'g-1', setting: null, beat: null },
  signal: { type: 'signal', name: 'the golden duck', subject: 'g-1' },
  codexUnlocked: { type: 'codexUnlocked', person: 'g-1', entry: 'duck', via: 'code', from: null },
  codexMissed: { type: 'codexMissed', person: 'g-1', code: 'XYZ' },
  quest: { type: 'quest', person: 'g-1', quest: 'Bingo', action: 'complete', text: 'Five in a row.' },
  restricted: { type: 'restricted', person: 'g-1', places: ['The Tube', 'The Internet'] },
  unrestricted: { type: 'unrestricted', person: 'g-1' },
  pinned: { type: 'pinned', text: '!GO TO THE INTERNET', channel: null, person: 'g-1', key: 'g-1' },
  unpinned: { type: 'unpinned', text: null, channel: 'room:quarantine', person: null, key: '' },
  wallet: { type: 'wallet', to: 'g-2', card, root: false },
  ambient: { type: 'ambient', source: 'Fan', text: 'whirr' },
  tick: { type: 'tick', elapsedMs: 1000 },
  diagnostic: { type: 'diagnostic', message: 'unresolved divert' },
}

describe('describeEvent', () => {
  it('renders every event kind as more than its bare type name', () => {
    for (const type of Object.values(SimEventType)) {
      const line = describeEvent(SAMPLES[type])
      expect(line, type).not.toBe(type)
      expect(line.length, type).toBeGreaterThan(0)
    }
  })

  it('renders the wave 3/4 events with their person, place, card and amount', () => {
    expect(describeEvent(SAMPLES.revealed)).toBe('The Tube opened (location) for g-1')
    expect(describeEvent({ ...SAMPLES.revealed, person: null })).toBe('The Tube opened (location)')
    expect(describeEvent(SAMPLES.widget)).toBe('show captcha "Prove it" → g-1 (1)')
    expect(describeEvent({ ...SAMPLES.widget, text: '', audience: [], scope: '' })).toBe('show captcha → all (all)')
    expect(describeEvent(SAMPLES.quest)).toBe('g-1 quest Bingo: complete — Five in a row.')
    expect(describeEvent({ ...SAMPLES.quest, action: 'start', text: null })).toBe('g-1 quest Bingo: start')
    expect(describeEvent(SAMPLES.restricted)).toBe('g-1 restricted → The Tube, The Internet')
    expect(describeEvent({ ...SAMPLES.restricted, places: [] })).toBe('g-1 restricted')
    expect(describeEvent(SAMPLES.unrestricted)).toBe('g-1 unrestricted')
    expect(describeEvent(SAMPLES.pinned)).toBe('pin "!GO TO THE INTERNET" for g-1')
    expect(describeEvent({ ...SAMPLES.pinned, channel: 'loc:The Tube', person: null })).toBe('pin "!GO TO THE INTERNET" in loc:The Tube')
    expect(describeEvent(SAMPLES.unpinned)).toBe('unpin in room:quarantine')
    expect(describeEvent({ ...SAMPLES.unpinned, text: 'escort', channel: null, person: 'g-1' })).toBe('unpin "escort" for g-1')
    expect(describeEvent(SAMPLES.wallet)).toBe(
      'wallet g-2 offer/accepted Excel → Winamp 40 Truthcoin (The Kernel Combo) by CRA Agent Software',
    )
    const plain: WalletCard = { ...card, kind: 'transfer', step: 'pending', entryTitle: undefined, by: undefined }
    expect(describeEvent({ type: 'wallet', to: 'g-1', card: plain, root: true })).toBe(
      'wallet g-1 transfer/pending Excel → Winamp 40 Truthcoin',
    )
  })
})

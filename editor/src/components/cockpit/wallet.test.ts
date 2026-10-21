import { describe, expect, it } from 'vitest'
import type { WalletModView, WalletTxView } from '@loom/core/views'
import { WalletAction, type RosterRow } from '@/store/cockpit'
import { countdown, deadlineLabel, freezeByName, freezesInForce, heldTransfers, requestCancellable, stimulusAmount, txActions, walletBalances, walletCardTag } from './wallet'

const tx = (id: string, state: WalletTxView['state'], settleAt: number | null = null): WalletTxView => ({
  id,
  from: 'g-1',
  fromName: 'Excel',
  to: 'g-2',
  toName: 'Winamp',
  amount: 50,
  state,
  settleAt,
  via: 'send',
  at: 0,
})

const view = (transfers: WalletTxView[]): WalletModView => ({
  name: 'Truthcoin',
  slot: 'score',
  approver: 'CRA_Agent_Software',
  minter: 'Runescape',
  minterPerson: null,
  counter: 3,
  stimulus: { uses: 0, limit: 3 },
  grants: { uses: 0, limit: 3 },
  frozen: [],
  open: { transfers, requests: [], offers: [] },
})

const row = (id: string, name: string, score: number): RosterRow =>
  ({ id, name, role: 'program', faction: null, trueFaction: null, location: null, captured: false, restricted: false, score, beat: null, visited: {} }) as RosterRow

describe('wallet card rules', () => {
  it('txActions: approve only what is held; a pending one can be denied or cancelled', () => {
    expect(txActions(tx('t1', 'held'))).toEqual([WalletAction.Approve, WalletAction.Deny, WalletAction.Cancel])
    expect(txActions(tx('t2', 'pending'))).toEqual([WalletAction.Deny, WalletAction.Cancel])
    expect(txActions(tx('t3', 'settled'))).toEqual([])
  })

  it('requestCancellable: only an open request', () => {
    expect(requestCancellable('open')).toBe(true)
    expect(requestCancellable('paying')).toBe(false)
  })

  it('heldTransfers: the held ones, in the view order', () => {
    expect(heldTransfers(view([tx('t1', 'held'), tx('t2', 'pending'), tx('t3', 'held')])).map((t) => t.id)).toEqual(['t1', 't3'])
    expect(heldTransfers(null)).toEqual([])
  })

  it('countdown: m:ss to the deadline, 0:00 once due, null when unknown', () => {
    expect(countdown(300_000, 0)).toBe('5:00')
    expect(countdown(61_500, 0)).toBe('1:02')
    expect(countdown(1_000, 5_000)).toBe('0:00')
    expect(countdown(null, 0)).toBeNull()
    expect(countdown(1_000, null)).toBeNull()
    expect(deadlineLabel('held')).toBe('auto-approves in')
    expect(deadlineLabel('pending')).toBe('settles in')
  })

  it('walletBalances: richest first then by name; another slot reads the world', () => {
    const roster = [row('g-1', 'Excel', 20), row('g-2', 'Winamp', 120), row('g-3', 'Bonzi', 20)]
    expect(walletBalances(roster, [], 'score').map((b) => `${b.name}:${b.balance}`)).toEqual(['Winamp:120', 'Bonzi:20', 'Excel:20'])
    const world = [
      { path: 'g-1.coin', value: '7' },
      { path: 'g-2.coin', value: '3' },
    ]
    expect(walletBalances(roster, world, 'coin').map((b) => `${b.name}:${b.balance}`)).toEqual(['Excel:7', 'Winamp:3', 'Bonzi:0'])
  })

  it('freezesInForce: the minter\'s freezes still on at now, soonest thaw first; an old server sends none', () => {
    const f = (id: string, until: number) => ({ id, target: `g-${id}`, targetName: id, by: 'g-9', until, at: 0 })
    const v = { ...view([]), frozen: [f('f1', 900_000), f('f2', 300_000), f('f3', 50_000)] }
    expect(freezesInForce(v, 100_000).map((x) => x.id)).toEqual(['f2', 'f1'])
    expect(freezesInForce(v, null).map((x) => x.id)).toEqual(['f3', 'f2', 'f1'])
    expect(freezesInForce({ ...view([]), frozen: undefined } as unknown as WalletModView, 0)).toEqual([])
    expect(freezesInForce(null, 0)).toEqual([])
  })

  it('freezeByName: the roster names the minter\'s guest; a director\'s freeze reads as written', () => {
    const roster = [row('g-3f2a1c', 'Runescape', 0), row('g-1', 'Excel', 0)]
    expect(freezeByName({ by: 'g-3f2a1c' }, roster)).toBe('Runescape')
    expect(freezeByName({ by: 'Director' }, roster)).toBe('Director')
    expect(freezeByName({ by: 'g-gone' }, [])).toBe('g-gone')
  })

  it('stimulusAmount: a whole number from 1', () => {
    expect(stimulusAmount(' 25 ')).toBe(25)
    expect(stimulusAmount('0')).toBeNull()
    expect(stimulusAmount('2.5')).toBeNull()
    expect(stimulusAmount('')).toBeNull()
  })
})

describe('walletCardTag (the cockpit chat row)', () => {
  const card = { id: 't1', from: 'g-1', fromName: 'Excel', to: 'g-2', toName: 'Winamp', amount: 20, unit: 'Truthcoin' } as const
  it('names the kind, the step, both parties and the amount', () => {
    expect(walletCardTag({ ...card, kind: 'transfer', step: 'pending' })).toBe('💰 transfer · pending · Excel → Winamp · 20 Truthcoin')
    expect(walletCardTag({ ...card, kind: 'approval', step: 'held' })).toBe('💰 approval · 🚩 held · Excel → Winamp · 20 Truthcoin')
    // Wave 18b (R13): the recipient's flagged card, and the audit's name when the story gives one.
    expect(walletCardTag({ ...card, kind: 'transfer', step: 'flagged', audit: 'a CRA audit' })).toBe('💰 transfer · 🚩 flagged for a CRA audit · Excel → Winamp · 20 Truthcoin')
    expect(walletCardTag({ ...card, kind: 'transfer', step: 'held', audit: 'a CRA audit' })).toBe('💰 transfer · 🚩 held for a CRA audit · Excel → Winamp · 20 Truthcoin')
  })
  it('a freeze names both sides and no amount (it moves no coin)', () => {
    expect(walletCardTag({ ...card, amount: 0, kind: 'freeze', step: 'frozen' })).toBe('🧊 freeze · frozen · Excel → Winamp')
  })
  it('an offer names its fact; a stimulus names only the minter', () => {
    expect(walletCardTag({ ...card, kind: 'offer', step: 'offered', entry: 'f1', entryTitle: 'The Zip' })).toBe('💰 offer · offered · Excel → Winamp · 20 Truthcoin · “The Zip”')
    expect(walletCardTag({ ...card, kind: 'stimulus', step: 'minted', fromName: 'Runescape' })).toBe('💰 stimulus · minted · Runescape · 20 Truthcoin')
  })
})

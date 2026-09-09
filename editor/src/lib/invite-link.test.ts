import { describe, expect, it } from 'vitest'
import { clearLinkIntent, parseLinkIntent, peekLinkIntent, stashLinkIntent, stripLinkParams } from './invite-link'

function memStore() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

describe('invite-link', () => {
  it('parses an invite token or a project id, invite winning', () => {
    expect(parseLinkIntent('?invite=abc')).toEqual({ kind: 'invite', token: 'abc' })
    expect(parseLinkIntent('?project=p1')).toEqual({ kind: 'project', id: 'p1' })
    expect(parseLinkIntent('?project=p1&invite=abc')).toEqual({ kind: 'invite', token: 'abc' })
    expect(parseLinkIntent('?invite=')).toBeNull()
    expect(parseLinkIntent('')).toBeNull()
  })

  it('strips only the link params from the URL', () => {
    expect(stripLinkParams('https://x.test/edit/?invite=abc&keep=1')).toBe('https://x.test/edit/?keep=1')
    expect(stripLinkParams('https://x.test/edit/?project=p1')).toBe('https://x.test/edit/')
  })

  it('round-trips through storage and tolerates junk', () => {
    const s = memStore()
    expect(peekLinkIntent(s)).toBeNull()
    stashLinkIntent({ kind: 'invite', token: 't' }, s)
    expect(peekLinkIntent(s)).toEqual({ kind: 'invite', token: 't' })
    clearLinkIntent(s)
    expect(peekLinkIntent(s)).toBeNull()
    s.setItem('loom.pending-link', '{not json')
    expect(peekLinkIntent(s)).toBeNull()
    s.setItem('loom.pending-link', JSON.stringify({ kind: 'invite' }))
    expect(peekLinkIntent(s)).toBeNull()
  })
})

// The in-app dialog queue — the replacement for the native
// prompt/confirm/alert the desktop webview doesn't implement.

import { beforeEach, describe, expect, it } from 'vitest'
import { confirmAction, confirmTyped, DialogKind, notify, promptText, useDialog } from '@/store/dialog'

function open() {
  const c = useDialog.getState().current
  if (!c) throw new Error('no dialog is open')
  return c
}

describe('dialog store', () => {
  beforeEach(() => {
    useDialog.setState({ current: null, queue: [] })
  })

  it('resolves a prompt with the trimmed value', async () => {
    const p = promptText({ title: 'New beat' })
    expect(open().req.kind).toBe(DialogKind.Prompt)
    useDialog.getState().settle('  opening  '.trim())
    expect(await p).toBe('opening')
  })

  it('resolves a cancelled prompt with null, a cancelled confirm with false', async () => {
    const p = promptText({ title: 'New beat' })
    useDialog.getState().settle(null)
    expect(await p).toBeNull()

    const c = confirmAction({ title: 'Delete?' })
    useDialog.getState().settle(false)
    expect(await c).toBe(false)
  })

  it('carries the danger flag and labels through to the request', async () => {
    const c = confirmAction({ title: 'Delete?', confirmLabel: 'Delete', danger: true })
    const req = open().req
    expect(req).toMatchObject({ kind: DialogKind.Confirm, confirmLabel: 'Delete', danger: true })
    useDialog.getState().settle(true)
    expect(await c).toBe(true)
  })

  it('defaults prompts to requiring a value, and opts out with allowEmpty', () => {
    void promptText({ title: 'Name' })
    expect(open().req).toMatchObject({ requireValue: true })
    useDialog.getState().settle(null)

    void promptText({ title: 'Value', allowEmpty: true })
    expect(open().req).toMatchObject({ requireValue: false })
  })

  it('queues concurrent requests and serves them in order', async () => {
    const first = promptText({ title: 'first' })
    const second = confirmAction({ title: 'second' })
    expect(open().req.title).toBe('first')
    expect(useDialog.getState().queue).toHaveLength(1)

    useDialog.getState().settle('a')
    expect(await first).toBe('a')
    // The queued one is promoted immediately.
    expect(open().req.title).toBe('second')
    useDialog.getState().settle(true)
    expect(await second).toBe(true)
    expect(useDialog.getState().current).toBeNull()
  })

  it('gives every request a distinct id (the host keys its view on it)', () => {
    void notify({ title: 'a' })
    const a = open().id
    useDialog.getState().settle(true)
    void notify({ title: 'b' })
    expect(open().id).not.toBe(a)
  })

  it('ignores a settle with nothing open', () => {
    expect(() => useDialog.getState().settle(true)).not.toThrow()
  })

  it('a typed code confirms only on a match, forgiving case and spaces (T7-06)', async () => {
    const ok = confirmTyped({ title: 'End the live event?', body: 'Guests are disconnected.', code: 'AB12CD' })
    expect(open().req).toMatchObject({ kind: DialogKind.Prompt, placeholder: 'AB12CD' })
    expect(open().req.body).toContain('Type the event code (AB12CD) to confirm.')
    useDialog.getState().settle(' ab12cd ')
    expect(await ok).toBe(true)
    expect(useDialog.getState().current).toBeNull()
  })

  it('a cancelled typed code is a quiet no', async () => {
    const no = confirmTyped({ title: 'End?', body: '', code: 'AB12CD' })
    useDialog.getState().settle(null)
    expect(await no).toBe(false)
    expect(useDialog.getState().current).toBeNull()
  })

  it('a wrong typed code says nothing changed (T7-06)', async () => {
    const no = confirmTyped({ title: 'End?', body: '', code: 'AB12CD' })
    useDialog.getState().settle('WRONG1')
    expect(await no).toBe(false)
    expect(open().req).toMatchObject({ kind: DialogKind.Alert, title: 'Nothing changed' })
    expect(open().req.body).toContain('WRONG1')
    expect(open().req.body).toContain('AB12CD')
  })
})

// Live-stack check: editor dev (:5173, proxying to :7000) + the real
// event server on the local loom_dev database. One editor tab plays
// Author A; a raw API client plays co-author B doing things from "their"
// editor. Asserts A's Run cockpit follows launch / restart / push-draft /
// go-live / end — with the co-writer banner naming who did what.
import { test, expect, request as pwRequest } from '@playwright/test'

const BASE = 'http://localhost:5173'
const MAIN = `entry: opening

LOCATION Party
  label: The Party

ROLE Guest
  score: 0 to 100 = 0

== opening
  The lights dim.
  Narrator: Welcome to draft one.
  * Take the stairs
    -> stairs
  * Take the lift
    -> lift

== stairs
  You climb.
  -> END

== lift
  You ride.
  -> END
`

test('live cockpit follows a co-author', async ({ browser }) => {
  test.setTimeout(120_000)
  // Skip cleanly when the stack isn't up (this suite is opt-in).
  const probe = await pwRequest.newContext({ baseURL: BASE })
  const health = await probe.get('/api/projects').catch(() => null)
  test.skip(health === null || health.status() === 503 || health.status() >= 500, 'event server + database not running')
  const stamp = Date.now()
  const api = await pwRequest.newContext({ baseURL: BASE })
  const email = `smoke-${stamp}@example.test`
  const password = `pw-${stamp}-${Math.random().toString(36).slice(2)}`
  let r = await api.post('/api/auth/sign-up/email', { data: { name: 'Ada Smoke', email, password } })
  expect(r.ok(), await r.text()).toBeTruthy()
  r = await api.post('/api/projects', { data: { name: `smoke-${stamp}` } })
  expect(r.ok(), await r.text()).toBeTruthy()
  const project = (await r.json()) as { id?: string; project?: { id: string } }
  const pid = project.id ?? project.project!.id
  r = await api.put(`/api/projects/${pid}/files`, { data: { path: 'main.loom', content: MAIN } })
  expect(r.ok(), await r.text()).toBeTruthy()

  const ctx = await browser.newContext({ storageState: await api.storageState() })
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${BASE}/?project=${pid}`)
  await expect(page.getByTestId('mode-bar')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('mode-run').click()
  await expect(page.getByTestId('run-stage-status')).toHaveText(/no active event/)
  await expect(page.getByTestId('run-start')).toBeVisible()

  // Co-author B launches a shared rehearsal from their editor.
  r = await api.post(`/api/projects/${pid}/event`, { data: { mode: 'preview' } })
  expect(r.ok(), await r.text()).toBeTruthy()
  const event = (await r.json()).event as { id: string; codes: Record<string, string> }
  await expect(page.getByTestId('run-stage-status')).toHaveText(/shared rehearsal/, { timeout: 20_000 })
  await expect(page.getByTestId('run-backend')).toHaveText(/Shared rehearsal/)
  // A's console shows it's directing (named), and the entry beat landed.
  await page.getByRole('tab', { name: 'Run' }).click()
  await expect(page.getByTestId('run-directors')).toContainText('Ada Smoke', { timeout: 10_000 })
  await expect(page.getByTestId('run-join-code-event')).toHaveText(event.codes.event)
  await expect(page.getByTestId('run-push-draft')).toHaveAttribute('data-stale', 'false')
  await page.getByRole('tab', { name: 'Chat' }).click()
  await expect(page.getByText('Welcome to draft one.')).toBeVisible({ timeout: 10_000 })

  // A speaks; B restarts the story → A's feed must drop the old line.
  r = await api.post(`/e/${event.id}/api/mod/say`, { data: { channel: 'lobby', text: 'hello from B' } })
  expect(r.ok()).toBeTruthy()
  await expect(page.getByText('hello from B')).toBeVisible({ timeout: 10_000 })
  r = await api.post(`/e/${event.id}/api/mod/reset`, { data: {} })
  expect(r.ok()).toBeTruthy()
  await expect(page.getByText('hello from B')).toHaveCount(0, { timeout: 10_000 })
  await expect(page.getByText('Welcome to draft one.')).toBeVisible()
  // A is told who restarted it (B's raw mod call is anonymous → "A co-writer").
  await expect(page.getByTestId('run-notice')).toContainText(/restarted/i)
  await page.getByTestId('run-notice-dismiss').click()

  // B edits the draft; A's console flags it stale.
  r = await api.put(`/api/projects/${pid}/files`, { data: { path: 'main.loom', content: MAIN.replace('draft one', 'draft two') } })
  expect(r.ok()).toBeTruthy()
  await expect(page.getByTestId('run-push-draft')).toHaveAttribute('data-stale', 'true', { timeout: 40_000 })
  // A pushes the draft from the header.
  await page.getByTestId('run-push-draft').click()
  await page.getByTestId('dialog-confirm').click()
  await expect(page.getByTestId('run-push-draft')).toHaveAttribute('data-stale', 'false', { timeout: 20_000 })
  await page.getByRole('tab', { name: 'Chat' }).click()
  await expect(page.getByText('Welcome to draft two.')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Welcome to draft one.')).toHaveCount(0)

  // Log tab holds the ledger + export is enabled.
  await page.getByRole('tab', { name: 'Log' }).click()
  await expect(page.getByText('beatEntered')).toBeVisible()
  await expect(page.getByTestId('run-export')).toBeEnabled()

  // Mode switch Run → Writing → Run keeps the feed (the store is attached
  // for the project's lifetime, not the mode's).
  await page.getByTestId('mode-writing').click()
  await expect(page.getByTestId('mode-run-dot')).toBeVisible()
  await page.getByTestId('mode-run').click()
  await page.getByRole('tab', { name: 'Chat' }).click()
  await expect(page.getByText('Welcome to draft two.')).toBeVisible()

  // A goes live in place: same codes, the story restarts, LIVE chrome.
  await page.getByTestId('run-restart').click()
  await page.getByTestId('run-go-live').click()
  await page.getByTestId('dialog-confirm').click()
  await expect(page.getByTestId('run-stage-status')).toHaveText(/live event/, { timeout: 20_000 })
  r = await api.get(`/api/projects/${pid}/event`)
  const promoted = (await r.json()).event as { mode: string; codes: Record<string, string> }
  expect(promoted.mode).toBe('live')
  expect(promoted.codes).toEqual(event.codes)

  // B ends it → A's console returns to "no active event", keeps the run for export.
  r = await api.post(`/api/projects/${pid}/event/end`)
  expect(r.ok()).toBeTruthy()
  await expect(page.getByTestId('run-stage-status')).toHaveText(/no active event/, { timeout: 20_000 })
  await expect(page.getByTestId('run-last-run')).toBeVisible()
  expect(errors).toEqual([])
  await ctx.close()
})

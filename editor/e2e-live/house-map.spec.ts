// Live-stack check for Run → House → 🗺 Map (wave 49, C7): the real map editor
// in a shadow root, on a real server and a throwaway author. Opt-in; give it a
// scratch stack, never the dev database:
//   LOOM_E2E_BASE=http://localhost:5349 LOOM_E2E_EDIT=/edit/ \
//     pnpm --filter loom-app test:e2e:live house-map
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, request as pwRequest, type Locator, type Page } from '@playwright/test'

const BASE = process.env.LOOM_E2E_BASE ?? 'http://localhost:5173'
const EDIT = process.env.LOOM_E2E_EDIT ?? '/'
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SHOW = join(REPO, 'core/examples/trapped-in-the-internet')
const MAIN = `entry: opening

LOCATION Party
  label: The Party

ROLE Guest
  score: 0 to 100 = 0

== opening
  The lights dim.
  -> END
`

async function author() {
  const stamp = Date.now()
  const api = await pwRequest.newContext({ baseURL: BASE })
  const password = `pw-${stamp}-${Math.random().toString(36).slice(2)}`
  const r = await api.post('/api/auth/sign-up/email', { data: { name: 'Ada Map', email: `map-${stamp}@example.test`, password } })
  expect(r.ok(), await r.text()).toBeTruthy()
  return { api, stamp }
}

async function project(api: Awaited<ReturnType<typeof author>>['api'], name: string, files: Record<string, string>): Promise<string> {
  let r = await api.post('/api/projects', { data: { name } })
  expect(r.ok(), await r.text()).toBeTruthy()
  const made = (await r.json()) as { id?: string; project?: { id: string } }
  const pid = made.id ?? made.project!.id
  for (const [path, content] of Object.entries(files)) {
    r = await api.put(`/api/projects/${pid}/files`, { data: { path, content } })
    expect(r.ok(), `${path}: ${await r.text()}`).toBeTruthy()
  }
  return pid
}

const page2 = (page: Page) => ({
  panel: page.getByTestId('house-map-panel'),
  mapPage: page.locator('.map-page'),
  rooms: page.locator('svg.plan polygon.room'),
  edit: page.locator('.map-toolbar label.checkbox input[type=checkbox]').first(),
  save: page.locator('.map-toolbar').getByRole('button', { name: /Save/ }).first(),
})

/** Every key that reaches the window's bubble phase: what the shell's shortcuts see. */
async function spyOnShell(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const w = window as unknown as { __keys: string[] }
    w.__keys = []
    window.addEventListener('keydown', (e) => {
      if (!['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) w.__keys.push(`${e.metaKey || e.ctrlKey ? 'mod+' : ''}${e.key}`)
    })
  })
  return async () => page.evaluate(() => (window as unknown as { __keys: string[] }).__keys.splice(0))
}

const TEXT_FIELD = '.inspect input:not([type=color]):not([type=checkbox]):not([type=number])'
const firstRoomInput = (panel: Locator) => panel.locator(TEXT_FIELD).first()

test('the map editor is a view of Run → House', async ({ browser }) => {
  test.setTimeout(240_000)
  const probe = await pwRequest.newContext({ baseURL: BASE })
  const health = await probe.get('/api/projects').catch(() => null)
  test.skip(health === null || health.status() === 503 || health.status() >= 500, 'event server + database not running')

  const { api, stamp } = await author()
  const house = readFileSync(join(SHOW, 'house.json'), 'utf8')
  const pid = await project(api, `map-${stamp}`, { 'main.loom': MAIN, 'house.json': house })
  const bare = await project(api, `bare-${stamp}`, { 'main.loom': MAIN })
  const launched = await api.post(`/api/projects/${pid}/event`, { data: { mode: 'preview' } })
  expect(launched.ok(), await launched.text()).toBeTruthy()
  const event = (await launched.json()).event as { id: string; codes: Record<string, string> }

  const ctx = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1500, height: 950 } })
  ctx.setDefaultTimeout(15_000)
  const page = await ctx.newPage()
  const errors: string[] = []
  const requests: string[] = []
  const nativeDialogs: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('request', (r) => requests.push(r.url()))
  page.on('dialog', (d) => {
    nativeDialogs.push(d.message())
    void d.dismiss()
  })

  await page.goto(`${BASE}${EDIT}?project=${pid}`)
  await expect(page.getByTestId('mode-bar')).toBeVisible({ timeout: 30_000 })

  await test.step('a house*.json in Writing has the banner, and it opens the map', async () => {
    await page.getByTestId('mode-writing').click()
    await page.getByTestId('editing-rail-files').click()
    await page.getByText('house.json', { exact: true }).first().click()
    await expect(page.getByTestId('house-map-banner')).toBeVisible()
    await page.getByTestId('mode-run').click()
  })

  // The chunks stay out of the first load.
  expect(requests.filter((u) => /\/embed-[^/]*\.js|Preview3D|\/three/.test(u) && !u.includes('@')).length).toBe(0)

  await test.step('the Run page card opens Run → House → 🗺 Map, signed in with no passcode', async () => {
    await page.getByRole('tab', { name: 'Run', exact: true }).click()
    await page.getByTestId('run-house-map-edit').click()
    await expect(page.getByTestId('house-view-map')).toHaveAttribute('aria-selected', 'true')
    await expect(page2(page).mapPage).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('moderator passcode')).toHaveCount(0)
    expect(requests.some((u) => /\/embed[-.]/.test(u) || u.includes('/map/embed.tsx'))).toBeTruthy()
    expect(requests.some((u) => /Preview3D/.test(u))).toBeFalsy()
  })

  const { panel, rooms, edit, save } = page2(page)
  await expect(rooms.first()).toBeAttached()
  if (process.env.MAP_SHOTS !== undefined) await page.screenshot({ path: join(process.env.MAP_SHOTS, 'house-map.png') })
  const roomCount = await rooms.count()

  await test.step('the styles reached the shadow root, and VT323 the document', async () => {
    const look = await page.locator('.map-frame').evaluate((el) => {
      const s = getComputedStyle(el)
      return { font: s.fontFamily, bg: s.backgroundColor, selectable: s.userSelect, tokens: getComputedStyle(el).getPropertyValue('--pixel') }
    })
    expect(look.font).toContain('Tahoma')
    expect(look.tokens).toContain('VT323')
    expect(look.bg).toBe('rgb(0, 128, 128)')
    expect(await page.evaluate(() => document.fonts.load('16px VT323').then((f) => f.length))).toBeGreaterThan(0)
    await expect(page.locator('.map-main')).toHaveCSS('display', 'grid')
    expect((await page.locator('.map-main').evaluate((el) => getComputedStyle(el).gridTemplateColumns)).split(' ').length).toBe(2)
    // The map's own ✕ goes back to the game: it has no place in the editor.
    await expect(page.locator('.map-toolbar a[title="Back to the game"]')).toHaveCount(0)
    await page.setViewportSize({ width: 820, height: 950 })
    await expect(page.locator('.map-main')).toHaveJSProperty('nodeName', 'MAIN')
    expect((await page.locator('.map-main').evaluate((el) => getComputedStyle(el).gridTemplateColumns)).split(' ').length).toBe(1)
    await page.setViewportSize({ width: 1500, height: 950 })
  })

  const shell = await spyOnShell(page)

  await test.step('something selected, typing in its field never deletes it', async () => {
    await edit.check()
    await rooms.nth(2).click({ position: { x: 5, y: 5 }, force: true })
    const field = firstRoomInput(panel)
    await field.click()
    const before = await field.inputValue()
    await field.press('End')
    await page.keyboard.type('xy')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Delete')
    await page.keyboard.press('ArrowLeft')
    await expect(field).toHaveValue(`${before}x`)
    expect(nativeDialogs).toEqual([])
    await expect(rooms).toHaveCount(roomCount)
    expect(await shell()).toEqual([])
    // ⌘Z in a field is the field's own: never the story's undo.
    await page.keyboard.press('Meta+z')
    expect(await shell()).toEqual([])
    await field.fill(before)
  })

  await test.step('the map takes its keys off the plan, and they stop there', async () => {
    await page.locator('svg.plan').click({ position: { x: 4, y: 4 } })
    await rooms.nth(2).click({ position: { x: 5, y: 5 }, force: true })
    // A prop goes at once and ⌘Z brings it back; a room asks first (dismissed).
    const prop = (await page.locator('.inspect').first().innerText()).includes('Prop')
    await page.keyboard.press('Delete')
    if (prop) {
      await expect(save).toBeEnabled()
      await page.keyboard.press('Meta+z')
      await expect(save).toBeDisabled()
    } else expect(nativeDialogs.length).toBe(1)
    await expect(rooms).toHaveCount(roomCount)
    await page.keyboard.press('Escape')
    await page.keyboard.press('r')
    await expect(page.locator('.map-toolbar .tool.pressed')).toContainText('Room')
    await page.keyboard.press('Escape')
    await expect(page.locator('.map-toolbar .tool.pressed')).toContainText('Select')
    expect(await shell()).toEqual([])
  })

  await test.step('an edit, ⌘Z and ⌘⇧Z are the map’s own', async () => {
    await rooms.nth(2).click({ position: { x: 5, y: 5 }, force: true })
    const field = firstRoomInput(panel)
    await field.click()
    const was = await field.inputValue()
    await field.fill(`${was} w49`)
    await field.press('Tab')
    await page.locator('svg.plan').click({ position: { x: 4, y: 4 } })
    await expect(save).toBeEnabled()
    await page.keyboard.press('Meta+z')
    await expect(save).toBeDisabled()
    await page.keyboard.press('Meta+Shift+z')
    await expect(save).toBeEnabled()
    expect(await shell()).toEqual([])
  })

  await test.step('host shortcuts the map doesn’t answer still work, and a draft outlives leaving', async () => {
    await page.keyboard.press('Meta+1')
    await expect(page.getByTestId('mode-writing')).toHaveAttribute('aria-pressed', 'true').catch(() => undefined)
    await expect(page.locator('.cm-editor').first()).toBeVisible()
    await page.keyboard.press('Meta+2')
    await expect(page.getByTestId('house-map')).toBeAttached()
    await expect(save).toBeEnabled()
    await page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await expect(page.getByTestId('house-map')).toHaveCount(0)
    await page.getByRole('tab', { name: 'House', exact: true }).click()
    await page.getByTestId('house-view-desk').click()
    await expect(page.getByTestId('house-map')).toHaveCount(0)
    // The desk's keys are the desk's: the kept map takes none.
    await shell()
    await page.keyboard.press('r')
    await page.keyboard.press('Meta+z')
    expect(await shell()).toEqual(['r', 'mod+z'])
    await page.getByTestId('house-view-map').click()
    await expect(page.locator('.map-toolbar .tool.pressed')).toContainText('Select')
    await expect(save).toBeEnabled()
    // Back on the map the keys are its own, though the tab was the last click.
    await page.keyboard.press('Meta+z')
    await expect(save).toBeDisabled()
    await page.keyboard.press('Meta+Shift+z')
    await expect(save).toBeEnabled()
    expect(await shell()).toEqual([])
  })

  await test.step('the palette opens it, and a save asks for nothing', async () => {
    await page.getByTestId('house-view-desk').click()
    await page.keyboard.press('Meta+Shift+p')
    await expect(page.locator('input:focus')).toHaveValue('>')
    await page.keyboard.type('house map')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('house-view-map')).toHaveAttribute('aria-selected', 'true')
    await save.click()
    await expect(page.getByText('moderator passcode')).toHaveCount(0)
    await expect(save).toBeDisabled({ timeout: 10_000 })
    const served = await (await api.get(`/e/${event.id}/api/spatial/house`)).json()
    expect(JSON.stringify(served)).toContain(' w49')
  })

  await test.step('a story restart leaves it working', async () => {
    const r = await api.post(`/e/${event.id}/api/mod/reset`, { data: {} })
    expect(r.ok(), await r.text()).toBeTruthy()
    await page.locator('svg.plan').click({ position: { x: 4, y: 4 } })
    await rooms.nth(2).click({ position: { x: 5, y: 5 }, force: true })
    const field = firstRoomInput(panel)
    await field.fill(`${await field.inputValue()} again`)
    await field.press('Tab')
    await expect(save).toBeEnabled()
    await save.click()
    await expect(save).toBeDisabled({ timeout: 10_000 })
    await expect(page.getByText('moderator passcode')).toHaveCount(0)
    expect(JSON.stringify(await (await api.get(`/e/${event.id}/api/spatial/house`)).json())).toContain(' again')
  })

  await test.step('the 3D preview is its own lazy chunk', async () => {
    expect(requests.some((u) => /Preview3D/.test(u))).toBeFalsy()
    await page.locator('.map-toolbar').getByRole('button', { name: /3D/ }).first().click()
    await expect(page.locator('.map-3d canvas, .map-canvas canvas').first()).toBeAttached({ timeout: 20_000 })
    expect(requests.some((u) => /Preview3D/.test(u))).toBeTruthy()
    await page.locator('.map-toolbar').getByRole('button', { name: /3D|Plan/ }).first().click()
  })

  await test.step('Open in a new tab ↗ is the map’s own page, signed in and scrubbed', async () => {
    const link = page.getByTestId('house-map-new-tab')
    const href = await link.getAttribute('href')
    expect(href).toContain(`/reinstall/map?code=${event.codes.mod}`)
    const tab = await ctx.newPage()
    const tabErrors: string[] = []
    tab.on('pageerror', (e) => tabErrors.push(String(e)))
    await tab.goto(href!)
    await expect(tab.locator('.map-page')).toBeVisible({ timeout: 20_000 })
    expect(tab.url()).not.toContain('code=')
    await tab.locator('.map-toolbar label.checkbox input[type=checkbox]').first().check()
    await tab.locator('svg.plan polygon.room').nth(2).click({ position: { x: 5, y: 5 }, force: true })
    const field = tab.locator(TEXT_FIELD).first()
    const was = await field.inputValue()
    await field.fill(`${was}!`)
    await field.press('Tab')
    await tab.locator('.map-toolbar').getByRole('button', { name: /Save/ }).first().click()
    await expect(tab.getByText('moderator passcode')).toHaveCount(0)
    await expect(tab.locator('.map-toolbar').getByRole('button', { name: /Save/ }).first()).toBeDisabled({ timeout: 10_000 })
    expect(tabErrors).toEqual([])
    await tab.close()
  })

  await test.step('the descent select reads and forces the real level', async () => {
    const url = `/e/${event.id}/api/mod/spatial/descent`
    const forced = async () => ((await (await api.get(url)).json()) as { forced: number | null }).forced
    await page.getByRole('tab', { name: 'Run', exact: true }).click()
    await expect(page.getByTestId('run-house-map-edit')).toBeVisible()
    const select = page.getByTestId('run-house-descent-select')
    await expect(select).toHaveValue('')
    await select.selectOption('3')
    await expect.poll(forced).toBe(3)
    await select.selectOption('')
    await expect.poll(forced).toBeNull()
  })

  await test.step('with no run it says to start a rehearsal', async () => {
    await page.goto(`${BASE}${EDIT}?project=${bare}`)
    await expect(page.getByTestId('mode-bar')).toBeVisible({ timeout: 30_000 })
    await page.keyboard.press('Meta+Shift+p')
    await expect(page.locator('input:focus')).toHaveValue('>')
    await page.keyboard.type('house map')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Start a rehearsal first')).toBeVisible()
  })

  expect(errors).toEqual([])
})

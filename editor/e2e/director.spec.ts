// Run → Director on a local workspace (wave 10): the story's admin cues by
// act, the NOW card, arm-then-fire with the dead time, refusals shown as
// "Not taken", the past act folding, Watching mode leaving the keys alone,
// and the Tools drawer opening for a story with no cues at all.

import { test, expect, type Page } from '@playwright/test'
import { openLocalProject, startRehearsal } from './helpers'

/** Two acts, six cues: one aside, one repeat, one `while:`-gated cue. */
const CUES_LOOM = `entry: opening
watch: Night.step as Step

GROUP Hosts
  joinable: false

CHANNEL hosts
  kind: faction
  faction: Hosts

LOCATION Party
  label: The Party

INTERACTION open_doors
  label: A1 · 🚪 Open the doors
  who: admin
  act: A · Doors
  description: Let everyone in from the street.

INTERACTION read_out
  label: A2 · 📋 Read the results
  who: admin
  repeat: true

INTERACTION lights_fallback
  label: 💡 Lights (hardware fallback)
  who: admin
  sequence: false

INTERACTION close_act
  label: A3 · 🎬 Close act one
  who: admin

INTERACTION last_call
  label: B1 · 🔔 Last call
  who: admin
  act: B · Close
  while: Night.step >= 3

INTERACTION goodnight
  label: B2 · 🌙 Goodnight
  who: admin

when open_doors:
  set Night.step = 1

when read_out:
  set Night.reads += 1

when lights_fallback:
  set Night.lights = true

when close_act:
  set Night.step = 3

when last_call:
  if Night.step == 3:
    set Night.step = 4
  else:
    broadcast "🔔 Not yet: close act one first." to channel(hosts)

when goodnight:
  set Night.step = 5

== opening
  The lights dim.
`

async function openDirector(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Director' }).click()
  await expect(page.getByTestId('director')).toBeVisible()
}

/** Arm, wait out the dead time, fire. */
async function fire(page: Page, id: string): Promise<void> {
  await page.getByTestId(`cue-${id}`).click()
  await page.waitForTimeout(400)
  await page.getByTestId(`cue-${id}`).click()
}

test.describe('run mode · the Director page', () => {
  test.describe('a story with acts', () => {
    test.beforeEach(async ({ page }) => {
      await openLocalProject(page, [{ path: 'main.loom', content: CUES_LOOM }])
      await startRehearsal(page)
      await openDirector(page)
    })

    test('the stepper shows two acts with the first focused', async ({ page }) => {
      await expect(page.getByTestId('director-step-A')).toHaveAttribute('data-state', 'focus')
      await expect(page.getByTestId('director-step-B')).toHaveAttribute('data-state', 'future')
      await expect(page.getByTestId('director-act-A')).toContainText('starting')
      await expect(page.getByTestId('director-next')).toContainText('Open the doors')
      await expect(page.getByTestId('director-now')).toContainText('Let everyone in from the street.')
      // The aside is on hand, not a numbered row.
      await expect(page.getByTestId('director-onhand')).toContainText('Lights')
      await expect(page.getByTestId('director-onhand')).toContainText('hardware fallback')
    })

    test('Space then Space fires NEXT and the NOW card shows Taken', async ({ page }) => {
      await page.keyboard.press(' ')
      await expect(page.getByTestId('cue-armed-open_doors')).toBeVisible()
      await page.waitForTimeout(400)
      await page.keyboard.press(' ')
      await expect(page.getByTestId('director-result')).toContainText('Taken')
      await expect(page.getByTestId('cue-last')).toContainText('Open the doors')
      await expect(page.getByTestId('director-did')).toContainText('Night.step → 1')
      // The repeat cue is NEXT now, then itself again.
      await expect(page.getByTestId('director-next')).toContainText('Read the results')
      await page.waitForTimeout(1100) // NEXT's cooldown after a press
      await fire(page, 'read_out')
      await expect(page.getByTestId('director-next')).toContainText('Again?')
    })

    test('a double-click on a cue only arms it', async ({ page }) => {
      await page.getByTestId('cue-open_doors').dblclick()
      await expect(page.getByTestId('cue-armed-open_doors')).toBeVisible()
      await page.waitForTimeout(300)
      await expect(page.getByTestId('cue-last')).toContainText('nothing fired yet')
      // Esc disarms.
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('cue-armed-open_doors')).toHaveCount(0)
    })

    test('an out-of-turn press shows Not taken', async ({ page }) => {
      await page.getByTestId('director-step-B').click()
      await expect(page.getByTestId('cue-last_call')).toContainText('not on offer')
      await fire(page, 'last_call')
      const result = page.getByTestId('director-result')
      await expect(result).toContainText('Not taken')
      await expect(result).toContainText('Not yet: close act one first.')
      await expect(page.getByTestId('cue-last')).toContainText('nothing fired yet')
      await expect(page.getByTestId('glance-needs')).toContainText('not taken')
    })

    test('the past act folds once NEXT moves into act two', async ({ page }) => {
      await fire(page, 'open_doors')
      await expect(page.getByTestId('cue-last')).toContainText('Open the doors')
      await page.waitForTimeout(1100) // NEXT's cooldown
      await fire(page, 'close_act')
      await expect(page.getByTestId('cue-last')).toContainText('Close act one')
      await expect(page.getByTestId('director-step-A')).toHaveAttribute('data-state', 'past')
      await expect(page.getByTestId('director-step-B')).toHaveAttribute('data-state', 'focus')
      await expect(page.getByTestId('director-act-A')).toContainText('✓ 2/3')
      await expect(page.getByTestId('cue-open_doors')).toHaveCount(0)
      await expect(page.getByTestId('director-next')).toContainText('Last call')
      // Act A's aside stays on hand as the previous act's line.
      await expect(page.getByTestId('director-onhand-prev')).toContainText('from A')
      await expect(page.getByTestId('cue-lights_fallback')).toBeVisible()
    })

    test('Watching mode ignores Space', async ({ page }) => {
      await page.getByTestId('director-mode-watching').click()
      await expect(page.getByTestId('director')).toHaveAttribute('data-mode', 'watching')
      await page.getByTestId('director').focus()
      await page.keyboard.press(' ')
      await page.waitForTimeout(400)
      await page.keyboard.press(' ')
      await page.waitForTimeout(300)
      await expect(page.getByTestId('cue-armed-open_doors')).toHaveCount(0)
      await expect(page.getByTestId('cue-last')).toContainText('—')
      // The choice outlives the tab (kept per console).
      await page.getByRole('tab', { name: 'Log' }).click()
      await openDirector(page)
      await expect(page.getByTestId('director')).toHaveAttribute('data-mode', 'watching')
    })
  })

  test('a story with no admin cues opens Tools', async ({ page }) => {
    await openLocalProject(page)
    await startRehearsal(page)
    await openDirector(page)
    await expect(page.getByTestId('director-tools')).toHaveAttribute('open', '')
    await expect(page.getByTestId('director-now')).toHaveCount(0)
    await expect(page.locator('section', { hasText: 'Fire beat' })).toBeVisible()
  })
})

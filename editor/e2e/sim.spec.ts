// Run mode's Sim source end-to-end: start the local simulator, act as
// a persona making choices, fire enumerated named events from the
// header, and watch the runtime overlay light the story map.

import { test, expect } from '@playwright/test'
import { openProject, switchMode } from './helpers'

test.describe('run mode · sim source', () => {
  test.beforeEach(async ({ page }) => {
    await openProject(page)
    await switchMode(page, 'run') // Sim is the default source
    await page.getByTestId('sim-start').click()
    await page.waitForTimeout(500)
  })

  test('start creates a persona, fires the entry beat, and offers its choice', async ({ page }) => {
    await expect(page.getByTestId('sim-persona-p1')).toBeVisible()
    // The entry menu suspended unbound → the global choice card.
    await expect(page.getByTestId('choice-__global-0')).toContainText('Take the stairs')
    await expect(page.getByTestId('choice-__global-1')).toContainText('Take the lift')
  })

  test('answering a choice resumes the story into the chosen beat', async ({ page }) => {
    await page.getByTestId('choice-__global-0').click()
    await page.waitForTimeout(300)
    await expect(page.getByTestId('choice-__global-0')).toHaveCount(0)

    await page.getByRole('tab', { name: 'Log' }).click()
    const log = page.getByTestId('sim-log')
    await expect(log).toContainText('== opening')
    await expect(log).toContainText('== stairs')
    await expect(log).toContainText('Welcome, traveler.')
  })

  test('the story map lights up with visits from the local run', async ({ page }) => {
    await page.getByTestId('choice-__global-1').click()
    await page.getByRole('tab', { name: 'Story' }).click()
    await expect(page.getByTestId('graph-beat-lift')).toBeVisible()
    await page.waitForTimeout(1200) // layout settles
    // Visit badges on the beats the run entered.
    await expect(page.getByTestId('graph-beat-opening')).toContainText('1')
    await expect(page.getByTestId('graph-beat-lift')).toContainText('1')
  })

  test('quick-fire enumerates named events and firing one reaches its room', async ({ page }) => {
    const select = page.getByTestId('sim-quickfire-select')
    await expect(select).toBeVisible()
    await expect(select.locator('option', { hasText: 'lockdown' })).toHaveCount(1)

    await select.selectOption('lockdown')
    await page.getByTestId('sim-quickfire-button').click()
    await page.waitForTimeout(300)

    // The broadcast lands in the faction room via the rooms rail.
    await page.getByRole('button', { name: /#mods/ }).click()
    await expect(page.getByText('Lockdown — the Algorithm tightens its grip.')).toBeVisible()
  })

  test('adding a persona and scanning it fires the character hook', async ({ page }) => {
    await page.getByTestId('sim-persona-name').fill('Beta')
    await page.getByTestId('sim-persona-add').click()
    await expect(page.getByTestId('sim-persona-p2')).toBeVisible()

    // Open its Inspector and scan as the Greeter → +5 score.
    await page.getByTestId('sim-persona-p2').click()
    const tray = page.locator('select', { hasText: 'scan as character' }).first()
    await tray.selectOption('Greeter')
    await page.getByRole('button', { name: 'Scan', exact: true }).click()
    await page.waitForTimeout(300)
    await page.getByRole('tab', { name: 'Roster' }).click()
    const row = page.getByRole('row').filter({ hasText: 'Beta' })
    await expect(row).toContainText('5')
  })

  test('stop clears the session', async ({ page }) => {
    await page.getByRole('button', { name: '■ Stop' }).click()
    await expect(page.getByTestId('sim-start')).toBeVisible()
    await expect(page.getByTestId('sim-persona-p1')).toHaveCount(0)
  })

  test('the Stage shows the floor plan and a fired beat becomes the persona’s story position', async ({ page }) => {
    await page.getByRole('tab', { name: 'Stage' }).click()
    // Authored location card + the unplaced persona under Elsewhere.
    await expect(page.getByTestId('stage-location-Party')).toContainText('The Party')
    await expect(page.getByTestId('stage-location-elsewhere')).toBeVisible()
    const chip = page.getByTestId('stage-guest-p1')
    await expect(chip).toContainText('Writer')
    await expect(chip).toContainText('no beat yet')

    // Fire the entry beat AT the persona from the Director…
    await page.getByRole('tab', { name: 'Director' }).click()
    const beatSection = page.locator('section', { hasText: 'Fire beat' })
    await beatSection.locator('select').first().selectOption('opening')
    await beatSection.locator('select').nth(1).selectOption({ label: 'Writer (p1)' })
    await beatSection.getByRole('button', { name: 'Fire' }).click()
    await page.waitForTimeout(300)

    // …and the Stage chip now carries their story position + pending choice.
    await page.getByRole('tab', { name: 'Stage' }).click()
    await expect(chip).toContainText('⤷ opening')
    await expect(chip).toContainText('⏳')
  })

  test('the World tab browses live variables; the rail spawns personas', async ({ page }) => {
    await page.getByRole('tab', { name: 'World' }).click()
    // The persona's variable group is live (role default `score = 0`).
    await page.getByTestId('world-var-filter').fill('score')
    await expect(page.getByTestId('world-group-p1')).toContainText('score')

    // Spawn a persona straight from the rail's Guests section.
    await page.getByTestId('rail-persona-name').fill('Gamma')
    await page.getByTestId('rail-persona-add').click()
    await expect(page.getByTestId('rail-guest-p2')).toContainText('Gamma')
  })

  test('double-clicking a World value edits it live through the engine', async ({ page }) => {
    await page.getByRole('tab', { name: 'World' }).click()
    await page.getByTestId('world-var-filter').fill('score')
    const cell = page.getByTestId('var-value-p1.score')
    await expect(cell).toHaveText('0')
    await cell.dblclick()
    await page.getByTestId('var-input-p1.score').fill('42')
    await page.getByTestId('var-input-p1.score').press('Enter')
    await expect(page.getByTestId('var-value-p1.score')).toHaveText('42')
    // The write went through the real mutator — the roster agrees.
    await page.getByRole('tab', { name: 'Roster' }).click()
    await expect(page.getByRole('row').filter({ hasText: 'Writer' })).toContainText('42')
  })

  test('dragging a guest chip onto a location moves them there', async ({ page }) => {
    await page.getByRole('tab', { name: 'Stage' }).click()
    const chip = page.getByTestId('stage-guest-p1')
    await expect(page.getByTestId('stage-location-elsewhere')).toContainText('Writer')

    // HTML5 DnD via dispatched events sharing one DataTransfer.
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
    await chip.dispatchEvent('dragstart', { dataTransfer })
    await page.getByTestId('stage-location-Party').dispatchEvent('drop', { dataTransfer })

    // The journaled arrive moved them: the chip now lives in The Party.
    await expect(page.getByTestId('stage-location-Party')).toContainText('Writer')
    await expect(page.getByTestId('stage-location-elsewhere')).toHaveCount(0)
  })
})

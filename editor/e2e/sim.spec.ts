// Run mode on a local workspace end-to-end: start a rehearsal (the
// in-browser engine), act as a persona making choices, fire enumerated
// named events from the header, watch the runtime overlay light the story
// map, be a persona through the identity control, and end the run.

import { test, expect } from '@playwright/test'
import { answerDialog, openLocalProject, startRehearsal } from './helpers'

test.describe('run mode · local backend', () => {
  test.beforeEach(async ({ page }) => {
    await openLocalProject(page)
    await startRehearsal(page)
  })

  test('start creates a persona named after you, fires the entry beat, lands on Chat with its choice docked', async ({ page }) => {
    await expect(page.getByTestId('rail-guest-p1')).toContainText('Writer')
    await expect(page.getByTestId('run-stage-status')).toHaveText(/local · in-browser/)
    await expect(page.getByTestId('run-backend')).toHaveText(/Local run/)
    // The cockpit landed on Chat; the entry menu suspended unbound → the
    // global decision tray is docked in the room.
    await expect(page.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true')
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
    await page.getByTestId('rail-persona-name').fill('Beta')
    await page.getByTestId('rail-persona-add').click()
    await expect(page.getByTestId('rail-guest-p2')).toBeVisible()

    // Open its Inspector and scan as the Greeter → +5 score.
    await page.getByTestId('rail-guest-p2').click()
    const tray = page.locator('select', { hasText: 'scan as character' }).first()
    await tray.selectOption('Greeter')
    await page.getByRole('button', { name: 'Scan', exact: true }).click()
    await page.waitForTimeout(300)
    await page.getByRole('tab', { name: 'Roster' }).click()
    const row = page.getByRole('row').filter({ hasText: 'Beta' })
    await expect(row).toContainText('5')
  })

  test('end clears the session and keeps the run for export', async ({ page }) => {
    await page.getByTestId('run-restart').click() // the lifecycle split menu
    await page.getByTestId('run-end').click()
    await answerDialog(page)
    await expect(page.getByTestId('run-start')).toBeVisible()
    await expect(page.getByTestId('rail-guest-p1')).toHaveCount(0)
    await expect(page.getByTestId('run-last-run')).toContainText('Ended by Writer')
    await expect(page.getByTestId('run-stage-status')).toHaveText('no active event')
  })

  test('the identity control: be the persona, then Esc back to the Operator', async ({ page }) => {
    await page.getByTestId('cockpit-perspective').selectOption('p1')
    await expect(page.getByTestId('chat-viewing-as')).toContainText('viewing as Writer')
    // World / Director close under a lens; the composer speaks as the persona.
    await expect(page.getByTestId('run-tab-world')).toBeDisabled()
    await expect(page.getByTestId('chat-post-as')).toContainText('Writer')
    await page.locator('input[placeholder^="Message"]').fill('hello as me')
    await page.keyboard.press('Enter')
    await expect(page.getByText('hello as me')).toBeVisible()
    await expect(page.getByText('via Writer')).toBeVisible() // attributed to the director
    // Esc outside a text field returns to the Operator (the composer keeps focus after Enter).
    await page.getByTestId('run-stage-status').click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('chat-viewing-as')).toHaveCount(0)
    await expect(page.getByTestId('run-tab-world')).toBeEnabled()
  })

  test('the Log filters to one participant', async ({ page }) => {
    await page.getByRole('tab', { name: 'Log' }).click()
    await page.getByTestId('log-filter').selectOption('p1')
    const log = page.getByTestId('sim-log')
    await expect(log).toContainText('joined as')
    await expect(log).not.toContainText('== opening') // the entry beat named nobody
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

    // Spawn a second persona straight from the rail's Guests section.
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

// The Studio shell: the four-mode Mode Bar (Writing / Run /
// Integrations / Deploy), ⌘1..⌘4 switching, the Writing editor ⇄
// story-graph split, and the ⌘\ graph-pane toggle.

import { test, expect } from '@playwright/test'
import { answerDialog, cancelDialog, openProject, switchMode } from './helpers'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test.describe('studio shell', () => {
  test.beforeEach(async ({ page }) => {
    await openProject(page)
  })

  test('mode bar shows all four modes with keybinding hints', async ({ page }) => {
    for (const id of ['writing', 'run', 'integrations', 'deploy'] as const) {
      await expect(page.getByTestId(`mode-${id}`)).toBeVisible()
    }
    await expect(page.getByTestId('mode-writing')).toContainText('Writing')
    await expect(page.getByTestId('mode-run')).toContainText('Run')
    await expect(page.getByTestId('mode-integrations')).toContainText('Integrations')
    await expect(page.getByTestId('mode-deploy')).toContainText('Deploy')
  })

  test('writing mode shows the text editor AND the story graph together', async ({ page }) => {
    await switchMode(page, 'writing')
    await expect(page.getByText('main.loom').first()).toBeVisible()
    await expect(page.getByTestId('graph-crumb-project')).toBeVisible()
    await expect(page.getByTestId('graph-beat-opening')).toBeVisible()
  })

  test('modes switch by click and by ⌘1..⌘4', async ({ page }) => {
    await page.keyboard.press(`${mod}+2`)
    await expect(page.getByTestId('mode-run')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('sim-start')).toBeVisible() // Sim source is the default

    await page.keyboard.press(`${mod}+3`)
    await expect(page.getByTestId('mode-integrations')).toHaveAttribute('aria-pressed', 'true')

    await page.keyboard.press(`${mod}+4`)
    await expect(page.getByTestId('mode-deploy')).toHaveAttribute('aria-pressed', 'true')

    await page.keyboard.press(`${mod}+1`)
    await expect(page.getByTestId('mode-writing')).toHaveAttribute('aria-pressed', 'true')
  })

  test('run mode has the Sim ⇄ Live source switch', async ({ page }) => {
    await switchMode(page, 'run')
    await expect(page.getByTestId('run-source-sim')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('run-source-live')).toBeVisible()
  })

  test('⌘\\ hides and re-shows the story-graph pane', async ({ page }) => {
    await switchMode(page, 'writing')
    // The pane collapses to width 0 (allotment clips, it doesn't unmount),
    // so assert with the clipping-aware viewport check.
    await expect(page.getByTestId('graph-crumb-project')).toBeInViewport()
    await page.keyboard.press(`${mod}+\\`)
    await expect(page.getByTestId('graph-crumb-project')).not.toBeInViewport()
    await page.keyboard.press(`${mod}+\\`)
    await expect(page.getByTestId('graph-crumb-project')).toBeInViewport()
  })

  test('⌘B and ⌘⌥B collapse the left rail and properties tray', async ({ page }) => {
    await switchMode(page, 'writing')
    const rail = page.getByTestId('editing-rail-story')
    await expect(rail).toBeInViewport()
    await page.keyboard.press(`${mod}+b`)
    await expect(rail).not.toBeInViewport()
    await page.keyboard.press(`${mod}+b`)
    await expect(rail).toBeInViewport()

    const tray = page.getByRole('tab', { name: 'Properties' })
    await expect(tray).toBeInViewport()
    await page.keyboard.press(`${mod}+Alt+b`)
    await expect(tray).not.toBeInViewport()
    await page.keyboard.press(`${mod}+Alt+b`)
    await expect(tray).toBeInViewport()
  })

  test('integrations mode hosts the game-engine targets', async ({ page }) => {
    await switchMode(page, 'integrations')
    await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible()
    // Browser build: linking a Godot project needs the desktop app.
    await expect(page.getByText('Game engine — Godot')).toBeVisible()
    await expect(page.getByText('Loom desktop app')).toBeVisible()
  })

  // Regression: these flows used to call `window.prompt`, which the
  // desktop WKWebView silently no-ops — every create button looked dead.
  test('creating a beat runs through the in-app dialog, not window.prompt', async ({ page }) => {
    await switchMode(page, 'writing')
    await expect(page.getByTestId('graph-beat-opening')).toBeVisible()

    // Cancelling writes nothing.
    await page.getByTestId('graph-new-beat').click()
    await cancelDialog(page)
    await expect(page.getByTestId('graph-beat-cellar')).toHaveCount(0)

    await page.getByTestId('graph-new-beat').click()
    await answerDialog(page, 'cellar')
    await expect(page.getByTestId('graph-beat-cellar')).toBeVisible()
    const source = await page.evaluate(async () => {
      const ws = await import('/src/store/workspace.ts')
      return ws.useWorkspace.getState().openFiles['main.loom']?.contents ?? ''
    })
    expect(source).toContain('== cellar')
  })

  test('native prompt is never used (it is a no-op in the desktop webview)', async ({ page }) => {
    let nativeDialogs = 0
    page.on('dialog', () => {
      nativeDialogs += 1
    })
    await switchMode(page, 'writing')
    await page.getByTestId('graph-new-beat').click()
    await expect(page.getByTestId('dialog-host')).toBeVisible()
    await cancelDialog(page)
    expect(nativeDialogs).toBe(0)
  })
})

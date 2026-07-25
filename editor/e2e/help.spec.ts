// The in-app Help overlay: open via the TopBar button / ⌘/, browse the
// sidebar, search, follow a cross-link, and close with Esc.

import { test, expect } from '@playwright/test'
import { openProject } from './helpers'

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('opens from the TopBar button and shows the welcome article', async ({ page }) => {
  await openProject(page)
  await page.getByTestId('open-help').click()
  await expect(page.getByTestId('help-overlay')).toBeVisible()
  await expect(page.getByTestId('help-article')).toContainText('Welcome to Loom')
  // The sidebar lists the manual's sections.
  await expect(page.getByTestId('help-nav')).toContainText('Start Here')
  await expect(page.getByTestId('help-nav')).toContainText('Language')
  await expect(page.getByTestId('help-nav')).toContainText('Reference')
})

test('⌘/ toggles; Esc closes', async ({ page }) => {
  await openProject(page)
  await page.keyboard.press(`${mod}+/`)
  await expect(page.getByTestId('help-overlay')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('help-overlay')).not.toBeVisible()
})

test('sidebar navigation opens an article', async ({ page }) => {
  await openProject(page)
  await page.getByTestId('open-help').click()
  await page.getByTestId('help-nav-choices').click()
  await expect(page.getByTestId('help-article')).toContainText('Choices & branching')
  await expect(page.getByTestId('help-article')).toContainText('sticky')
})

test('search finds an article; Enter opens it; Esc clears back to browsing', async ({ page }) => {
  await openProject(page)
  await page.getByTestId('open-help').click()
  const search = page.getByTestId('help-search')
  await search.fill('sticky choice')
  await expect(page.getByTestId('help-results')).toContainText('Choices')
  await search.press('Enter')
  await expect(page.getByTestId('help-article')).toContainText('Choices & branching')
  // Esc with a query clears it, second Esc closes.
  await search.fill('broadcast')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('help-results')).not.toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('help-overlay')).not.toBeVisible()
})

test('cross-links navigate between articles', async ({ page }) => {
  await openProject(page)
  await page.getByTestId('open-help').click()
  // The welcome article links to the cheat sheet.
  await page.getByTestId('help-article').getByRole('button', { name: 'cheat sheet' }).first().click()
  await expect(page.getByTestId('help-article')).toContainText('Cheat sheet')
})

test('the command palette opens Help too', async ({ page }) => {
  await openProject(page)
  await page.keyboard.press(`${mod}+Shift+P`)
  await page.keyboard.type('keyboard shortcuts')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('help-overlay')).toBeVisible()
  await expect(page.getByTestId('help-article')).toContainText('Keyboard shortcuts')
})

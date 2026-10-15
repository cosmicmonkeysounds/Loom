// The Inspector's codex + quest grants (OCT31 S4) on the local backend:
// grant a codex entry the guest lacks, then start → update → complete a
// quest, each step asking for its thread line.

import { test, expect } from '@playwright/test'
import { MAIN_LOOM, answerDialog, openLocalProject, startRehearsal } from './helpers'

const EXTRAS = `CODEX The Sandy File
  text: She kept the receipts.

QUEST The Hunt
  text: Find three facts.
`

test('grant a codex entry and walk a quest from the guest Inspector', async ({ page }) => {
  await openLocalProject(page, [
    { path: 'main.loom', content: MAIN_LOOM },
    { path: 'extras.loom', content: EXTRAS },
  ])
  await startRehearsal(page)
  await page.getByTestId('rail-guest-p1').click()

  const codex = page.getByTestId('inspector-codex-p1')
  await expect(codex).toContainText('Codex · 0/1 held')
  await page.getByTestId('inspector-codex-pick-p1').selectOption('The Sandy File')
  await page.getByTestId('inspector-codex-grant-p1').click()
  await expect(codex).toContainText('Codex · 1/1 held')
  await expect(codex).toContainText('holds every entry')

  const quest = page.getByTestId('inspector-quest-The Hunt')
  await expect(quest).toContainText('not given')
  await page.getByTestId('inspector-quest-start-The Hunt').click()
  await answerDialog(page)
  await expect(quest).toContainText('active')
  await page.getByTestId('inspector-quest-update-The Hunt').click()
  await answerDialog(page, 'One down, two to go.')
  await page.getByTestId('inspector-quest-complete-The Hunt').click()
  await answerDialog(page, 'All three.')
  await expect(quest).toContainText('✓ done')
  await expect(page.getByTestId('inspector-quest-start-The Hunt')).toHaveCount(0)
})

// Shared helpers for the editor e2e suite. The suite runs against the
// Vite dev server (see playwright.config.ts webServer) with no backend:
// a workspace is injected straight into the zustand store through
// Vite's module graph (`/src/store/workspace.ts` resolves to the same
// module instance the app uses), which mirrors a server project being
// opened without needing auth or a Postgres control plane.

import { expect, type Page } from '@playwright/test'

/** A small but representative project: entry beat, dialogue, choices,
 *  cross-beat diverts, a character with a scan hook + a named event. */
export const MAIN_LOOM = `entry: opening

FACTION Mods
  ethos: order

LOCATION Party
  label: The Party

ROLE Guest
  score: 0 to 100 = 0

CHARACTER Greeter
  faction: Mods
  on lockdown
    <broadcast: lockdown_siren to faction(Mods)>
  on scan guest
    <set: guest.score += 5>

== opening
  The lights dim.
  GREETER
    Welcome, traveler.
  * Take the stairs
    -> stairs
  * Take the lift
    -> lift

== stairs
  You climb into the dark.
  -> summit

== lift
  You ride. Muzak plays.
  -> summit

== summit
  The city glitters below.
  -> END
`

/** Open the app and inject `files` as an in-memory SERVER project. There
 *  is no server behind it, so the run store's status poll is answered with
 *  "no event" here — Run mode shows its empty state, never a 500. Use
 *  `openLocalProject` for anything that actually runs the story. */
export async function openProject(
  page: Page,
  files: Array<{ path: string; content: string }> = [{ path: 'main.loom', content: MAIN_LOOM }],
): Promise<void> {
  await page.route('**/api/projects/e2e/event*', (r) => r.fulfill({ json: { event: null } }))
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.evaluate(async (fs) => {
    const ws = await import('/src/store/workspace.ts')
    await ws.useWorkspace.getState().openServerProject({ id: 'e2e', name: 'e2e-project' }, fs)
  }, files)
  // The studio shell mounts once the workspace root lands; indexing is
  // debounced, so wait for the mode bar and give the LSP a beat.
  await expect(page.getByTestId('mode-bar')).toBeVisible()
  await page.waitForTimeout(600)
}

/** Open the app and inject `files` as an in-memory LOCAL workspace (no
 *  project id) — Run mode resolves to the in-browser engine, exactly like
 *  a folder opened with the picker. */
export async function openLocalProject(
  page: Page,
  files: Array<{ path: string; content: string }> = [{ path: 'main.loom', content: MAIN_LOOM }],
): Promise<void> {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.evaluate(async (fs) => {
    const ws = await import('/src/store/workspace.ts')
    await ws.useWorkspace.getState().openLocalFiles('e2e-project', fs)
  }, files)
  await expect(page.getByTestId('mode-bar')).toBeVisible()
  await page.waitForTimeout(600)
}

/** Switch modes via the Mode Bar (Writing / Run / Integrations). */
export async function switchMode(page: Page, mode: 'writing' | 'run' | 'integrations'): Promise<void> {
  await page.getByTestId(`mode-${mode}`).click()
}

/** Start a rehearsal on the open workspace and wait for the cockpit to land. */
export async function startRehearsal(page: Page): Promise<void> {
  await switchMode(page, 'run')
  await page.getByTestId('run-start').click()
  await expect(page.getByTestId('rail-guest-p1')).toBeVisible()
  await page.waitForTimeout(300)
}

/** Answer the in-app dialog (the app no longer uses native prompt/confirm —
 *  see `src/store/dialog.ts`: the desktop webview has no `window.prompt`). */
export async function answerDialog(page: Page, value?: string): Promise<void> {
  await expect(page.getByTestId('dialog-host')).toBeVisible()
  if (value !== undefined) await page.getByTestId('dialog-input').fill(value)
  await page.getByTestId('dialog-confirm').click()
  await expect(page.getByTestId('dialog-host')).toHaveCount(0)
}

/** Dismiss the in-app dialog without acting. */
export async function cancelDialog(page: Page): Promise<void> {
  await page.getByTestId('dialog-cancel').click()
  await expect(page.getByTestId('dialog-host')).toHaveCount(0)
}

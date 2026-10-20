// Wave 13 on a local run: being a character is its booth's own PrimeView —
// its performer buttons on a guest thread and never an admin cue — a scan's
// readout lands in the thread (off the character's Inbox), and the
// Inspector lists the booth's live objectives.

import { test, expect } from '@playwright/test'
import { openLocalProject, startRehearsal } from './helpers'

const BOOTH_LOOM = `entry: opening

ROLE Guest
  score: 0 to 100 = 0

CHARACTER Greeter
  on scan guest
    <set: guest.score += 5>
    reply Ticket checked.

INTERACTION wave_in
  label: 👋 Wave in
  who: performer

INTERACTION power_on
  label: ⚡ Power on
  who: admin

OBJECTIVE door_duty
  for: Greeter
  title: Work the door
  text:
    Scan everyone who arrives.
    - Scan a guest, done when Greeter.scans >= 1
    - Smile at them
  buttons: wave_in, scan

== opening
  The lights dim.
`

const SHOTS = process.env.LOOM_E2E_SHOTS

test('a performer lens: booth buttons only, the readout in the thread, objectives in the Inspector', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openLocalProject(page, [{ path: 'main.loom', content: BOOTH_LOOM }])
  await startRehearsal(page)

  await page.getByTestId('cockpit-perspective').selectOption('Greeter')
  await expect(page.getByTestId('chat-viewing-as')).toContainText('being Greeter')
  await page.getByTestId('rail-room-guest:p1').click()

  // The booth's own button, never the admin cue.
  await expect(page.getByTestId('chat-interaction-wave_in')).toBeVisible()
  await expect(page.getByTestId('chat-interaction-power_on')).toHaveCount(0)

  // A scan: the story's reply shows in the thread, from the Inbox.
  await page.getByTestId('chat-scan-guest').click()
  await expect(page.getByTestId('chat-readout')).toContainText('Ticket checked.')

  // The Inspector on Greeter lists the booth's NOW objective.
  await page.evaluate(async () => {
    const sim = await import('/src/store/sim.ts')
    sim.useSim.getState().select({ kind: 'character', id: 'Greeter' })
  })
  await expect(page.getByTestId('inspector-booth-view')).toBeVisible()
  await expect(page.getByTestId('inspector-objective-door_duty')).toContainText('Work the door')
  await expect(page.getByTestId('inspector-objective-door_duty')).toContainText('Smile at them')
  await expect(page.getByTestId('inspector-readout')).toContainText('Ticket checked.')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/editor-booth-lens.png` })

  // Back to the Operator: the character's own dm is its Inbox, by name.
  await page.getByTestId('cockpit-perspective').selectOption({ index: 0 })
  await expect(page.getByTestId('chat-viewing-as')).toHaveCount(0)
  await expect(page.getByTestId('rail-room-dm:Greeter#@Greeter')).toContainText('Greeter · Inbox')
  await page.getByTestId('rail-room-dm:Greeter#@Greeter').click()
  await expect(page.getByTestId('chat-readout')).toContainText('Ticket checked.')
  await expect(page.getByTestId('chat-read-only')).toContainText('nobody types here')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/editor-operator-inbox.png` })
})

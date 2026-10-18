// The glance shows once: the tray holds it only in Calling mode, since
// Watching already shows the whole column on the page.

import { describe, expect, it } from 'vitest'
import { DirectorMode } from './director-keys'
import { glanceInTray } from './tray'

describe('glanceInTray', () => {
  it('an open tray on an empty Director page holds the glance while Calling', () => {
    expect(glanceInTray(true, true, DirectorMode.Calling)).toBe(true)
  })
  it('Watching keeps the glance on the page, so the tray does not repeat it', () => {
    expect(glanceInTray(true, true, DirectorMode.Watching)).toBe(false)
  })
  it('a closed tray or a selection is never the glance', () => {
    expect(glanceInTray(false, true, DirectorMode.Calling)).toBe(false)
    expect(glanceInTray(true, false, DirectorMode.Calling)).toBe(false)
  })
})

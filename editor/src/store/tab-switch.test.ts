// The Director's `+N more ↗ Log` press focus is dropped on explicit
// navigation away from the Log, never on the Log page's unmount (StrictMode
// remounts every page in dev, which used to unmask the whole ledger).

import { describe, expect, it } from 'vitest'
import { CockpitTab, tabSwitch } from '@/store/cockpit'
import { useSim } from '@/store/sim'

describe('tabSwitch', () => {
  it('keeps the press focus when the Log opens', () => {
    expect(tabSwitch({ logPress: 7 }, CockpitTab.Log)).toEqual({ activeTab: CockpitTab.Log, logPress: 7 })
  })
  it('drops it on any other tab', () => {
    expect(tabSwitch({ logPress: 7 }, CockpitTab.Director)).toEqual({ activeTab: CockpitTab.Director, logPress: null })
  })
  it('the local store follows: focus, open the Log, leave it', () => {
    const s = useSim.getState()
    s.setLogPress(12)
    s.setTab(CockpitTab.Log)
    expect(useSim.getState().logPress).toBe(12)
    useSim.getState().setTab(CockpitTab.Director)
    expect(useSim.getState().logPress).toBeNull()
  })
})

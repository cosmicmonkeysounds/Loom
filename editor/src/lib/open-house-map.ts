//! Every way into the house map lands here (the Run card, the palette, the
//! `house*.json` banner): open Run → House → 🗺 Map, or say what's missing.

import { currentCockpit } from '@/components/cockpit/providers'
import { CockpitTab, RunBackend } from '@/store/cockpit'
import { notify } from '@/store/dialog'
import { useHouseView } from '@/store/house-view'
import { useMode } from '@/store/mode'
import { runBackend } from '@/store/run'
import { houseMapRoute } from '@/lib/house-map-view'

export function openHouseMap(): void {
  const st = currentCockpit().getState()
  const route = houseMapRoute({
    server: (st.run?.backend ?? runBackend()) === RunBackend.Server,
    running: st.run !== null,
    lens: st.lens !== null,
  })
  if (route.kind === 'tell') {
    if (route.toRun) {
      useMode.getState().setMode('run')
      st.setTab(CockpitTab.Run)
    }
    void notify({ title: route.title, body: route.body })
    return
  }
  useHouseView.getState().setView('map')
  useMode.getState().setMode('run')
  st.setTab(CockpitTab.House)
}

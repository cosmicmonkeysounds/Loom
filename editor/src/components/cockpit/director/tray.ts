//! Where the glance column sits (wave 10 integration): the Inspector tray,
//! open with nothing selected on the Director page, would only say "Select
//! a guest…" — so it holds the column instead, and Calling mode leaves its
//! own strip / column out. Watching keeps its wide one on the page (the page
//! *is* the house at a glance there), so the tray stays the Inspector's and
//! the glance shows once. At 1400 px with both side panels open the tab area
//! is below the two-column width, so without this the column never showed.

import { CockpitTab, useCockpit } from '@/store/cockpit'
import { useMode } from '@/store/mode'
import { DirectorMode } from './director-keys'
import { useDirectorMode } from './director-mode'

/** Whether the tray holds the glance: open, on an empty Director page, and
 *  in Calling mode (Watching shows it on the page already). */
export function glanceInTray(trayOpen: boolean, emptyDirector: boolean, mode: DirectorMode): boolean {
  return trayOpen && emptyDirector && mode !== DirectorMode.Watching
}

export function useGlanceInTray(): boolean {
  const trayOpen = useMode((s) => s.mode === 'run' && s.ui.run.trayOpen)
  const director = useCockpit((s) => s.activeTab === CockpitTab.Director && s.selection === null && s.lens === null && s.run !== null)
  const [mode] = useDirectorMode()
  return glanceInTray(trayOpen, director, mode)
}

//! A `house*.json` open in Writing: one line saying the plan is one click
//! away (wave 49). A local folder has no event server to edit it on.

import { useWorkspace } from '@/store/workspace'
import { isHouseMapFile } from '@/lib/house-map-view'
import { openHouseMap } from '@/lib/open-house-map'

export function HouseMapBanner() {
  const path = useWorkspace((s) => s.activePath)
  const server = useWorkspace((s) => s.projectId !== null)
  if (!server || !isHouseMapFile(path)) return null
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-white/5 bg-indigo-950/30 px-3 py-1 text-[11px] text-zinc-300" data-testid="house-map-banner">
      <span>This is the house map. It’s easier to edit on the plan.</span>
      <button type="button" className="rounded border border-zinc-700 px-2 py-0.5 text-indigo-300 hover:bg-zinc-900" onClick={openHouseMap}>
        🗺 Edit the map
      </button>
    </div>
  )
}

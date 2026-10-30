//! Where the Map view lives. Once opened, the panel stays mounted for that
//! run, above the shell's per-mode layout (`HouseMapKeeper`, in `StudioShell`),
//! so an unsaved draft outlives a hop to Chat, the Desk or ⌘1: leaving the
//! view only takes its one DOM node off the page, and coming back puts the same
//! node back (`HouseMapSlot`, in `HouseTab`). While it is off the page it
//! takes no keys (`useHouseView.mapShown`), and it goes when the run does.

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { RunCockpit } from '@/components/cockpit/providers'
import { useCockpit } from '@/store/cockpit'
import { useHouseView } from '@/store/house-view'
import { HouseMapPanel } from './HouseMapPanel'

let holder: HTMLDivElement | null = null
function mapHolder(): HTMLDivElement {
  if (holder === null) {
    holder = document.createElement('div')
    holder.className = 'h-full w-full'
  }
  return holder
}

function KeptPanel({ mapEvent }: { mapEvent: string }) {
  const eventId = useCockpit((s) => s.run?.eventId ?? null)
  return eventId === mapEvent ? <HouseMapPanel /> : null
}

/** In `StudioShell`: nothing until the Map view is first opened. */
export function HouseMapKeeper() {
  const mapEvent = useHouseView((s) => s.mapEvent)
  if (mapEvent === null) return null
  return createPortal(
    <RunCockpit shared>
      <KeptPanel mapEvent={mapEvent} />
    </RunCockpit>,
    mapHolder(),
  )
}

/** The Map view in `HouseTab`: the place on the page the kept panel shows in. */
export function HouseMapSlot({ eventId }: { eventId: string | null }) {
  const slot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = slot.current
    if (el === null) return
    const held = mapHolder()
    el.append(held)
    useHouseView.getState().showMap(eventId)
    return () => {
      useHouseView.getState().showMap(null)
      held.remove()
    }
  }, [eventId])
  return <div ref={slot} className="min-h-0 flex-1" data-testid="house-map" />
}

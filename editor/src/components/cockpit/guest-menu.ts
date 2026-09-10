//! The shared guest context menu — Inspect / Be them / Open DM thread /
//! Capture-Release — used anywhere a guest renders as a chip or row
//! (the rail's Guests section, the Stage floor plan, roster surfaces).
//! Under a non-Operator lens the world-changing entries are absent:
//! you are someone else right now, not the director.

import { CockpitTab, SelectionKind, useCockpit, type RosterRow } from '@/store/cockpit'
import { openContextMenu } from '@/store/context-menu'
import { useRooms } from './rooms'
import { useInspect } from './inspect'

export function useGuestMenu(): (r: RosterRow, e: React.MouseEvent) => void {
  const setPerspective = useCockpit((s) => s.setPerspective)
  const selectChannel = useCockpit((s) => s.selectChannel)
  const setTab = useCockpit((s) => s.setTab)
  const capture = useCockpit((s) => s.capture)
  const release = useCockpit((s) => s.release)
  const locked = useCockpit((s) => s.lens !== null)
  const inspect = useInspect()
  const rooms = useRooms()

  return (r, e) => {
    e.preventDefault()
    const dm = rooms.find((room) => room.dmGuest === r.id)
    openContextMenu(
      [
        { label: `Inspect ${r.name}`, onSelect: () => inspect({ kind: SelectionKind.Guest, id: r.id }) },
        { label: `Be ${r.name}`, onSelect: () => setPerspective(r.id) },
        ...(dm
          ? [
              {
                label: 'Open DM thread',
                onSelect: () => {
                  selectChannel(dm.key)
                  setTab(CockpitTab.Chat)
                },
              },
            ]
          : []),
        ...(locked
          ? []
          : [
              { separator: true as const },
              r.captured
                ? { label: 'Release', onSelect: () => void release(r.id) }
                : { label: 'Capture', kind: 'danger' as const, onSelect: () => void capture(r.id) },
            ]),
      ],
      { x: e.clientX, y: e.clientY },
    )
  }
}

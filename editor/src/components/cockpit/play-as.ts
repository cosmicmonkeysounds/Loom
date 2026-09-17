//! "▶ Play <name>" from anywhere in the cockpit (rail menu, Inspector, the
//! Players toolbar): seat the participant in the Players lineup and jump to
//! the page. Playing a REAL guest (not a director's persona) is an explicit,
//! confirmed act — everything done in that pane happens to them.

import { CockpitTab, PlayerRole, isPersonaId, useCockpit } from '@/store/cockpit'
import { confirmAction } from '@/store/dialog'
import { usePlayers } from '@/store/players'

export function usePlayAs(): (role: PlayerRole, id: string, name: string) => Promise<void> {
  const setTab = useCockpit((s) => s.setTab)
  return async (role, id, name) => {
    if (role === PlayerRole.Guest && !isPersonaId(id)) {
      const ok = await confirmAction({
        title: `Play as ${name}?`,
        body: `${name} is a real guest. Their pane is their own session: every message, choice and answer you make there happens to them (the director feed records that you did it). They are not marked online while you look.`,
        confirmLabel: `Play as ${name}`,
        danger: true,
      })
      if (!ok) return
    }
    usePlayers.getState().add(role, id, name)
    setTab(CockpitTab.Players)
  }
}

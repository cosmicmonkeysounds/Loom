// Every way into the map lands on `openHouseMap`.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  cockpit: {} as Record<string, unknown>,
  told: [] as Array<{ title: string; body?: string }>,
}))
vi.mock('@/components/cockpit/providers', () => ({ currentCockpit: () => ({ getState: () => fake.cockpit }) }))
vi.mock('@/store/dialog', () => ({
  notify: async (o: { title: string; body?: string }) => void fake.told.push(o),
}))

import { CockpitTab, RunBackend } from '@/store/cockpit'
import { useHouseView } from '@/store/house-view'
import { useMode } from '@/store/mode'
import { useWorkspace } from '@/store/workspace'
import { openHouseMap } from './open-house-map'

let tabs: CockpitTab[]
const server = { backend: RunBackend.Server }

beforeEach(() => {
  tabs = []
  fake.told = []
  fake.cockpit = { run: server, lens: null, setTab: (t: CockpitTab) => tabs.push(t) }
  useHouseView.getState().setView('desk')
  useMode.getState().setMode('writing')
  useWorkspace.setState({ projectId: 'p1' })
})

describe('openHouseMap', () => {
  it('lands on Run → House → 🗺 Map', () => {
    openHouseMap()
    expect(useHouseView.getState().view).toBe('map')
    expect(useMode.getState().mode).toBe('run')
    expect(tabs).toEqual([CockpitTab.House])
    expect(fake.told).toEqual([])
  })

  it('with no run it says so, from the Run page', () => {
    fake.cockpit = { ...fake.cockpit, run: null }
    openHouseMap()
    expect(fake.told[0]?.title).toBe('Start a rehearsal first')
    expect(useMode.getState().mode).toBe('run')
    expect(tabs).toEqual([CockpitTab.Run])
    expect(useHouseView.getState().view).toBe('desk')
  })

  it('a local folder has no event server, run or not', () => {
    useWorkspace.setState({ projectId: null })
    fake.cockpit = { ...fake.cockpit, run: null }
    openHouseMap()
    expect(fake.told[0]?.title).toMatch(/event server/u)
    expect(tabs).toEqual([])
  })

  it('a scratch run has no house to reach', () => {
    fake.cockpit = { ...fake.cockpit, run: { backend: RunBackend.Local } }
    openHouseMap()
    expect(fake.told[0]?.title).toMatch(/event server/u)
    expect(useMode.getState().mode).toBe('writing')
    expect(tabs).toEqual([])
  })

  it('under a lens it says to switch back', () => {
    fake.cockpit = { ...fake.cockpit, lens: { id: 'g-1' } }
    openHouseMap()
    expect(fake.told[0]?.title).toBe('Switch to Operator first')
    expect(useHouseView.getState().view).toBe('desk')
  })
})

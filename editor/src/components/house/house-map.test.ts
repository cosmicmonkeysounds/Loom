// Run → House → 🗺 Map (wave 49): the panel's states over a fixture run, the
// view's two flags, and the fence that keeps three.js out of the first load.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({ desktop: false }))
vi.mock('@/lib/desktop', () => ({ isDesktop: () => fake.desktop }))

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { create } from 'zustand'
import { CockpitContext, RunBackend, RunMode, nullCockpit, type CockpitState } from '@/store/cockpit'
import { useHouseView } from '@/store/house-view'
import { HouseMapPanel } from './HouseMapPanel'
import { DescentRow } from '@/components/run/HouseMapCard'

const run = {
  backend: RunBackend.Server,
  mode: RunMode.Rehearsal,
  scratch: false,
  scenario: 'Trapped',
  stale: false,
  codes: { event: 'E', prime: 'P', mod: 'MOD 1' },
  joinUrl: 'https://app.example/?code=E',
  eventId: 'ev1',
  startedAt: null,
  startedBy: null,
}

function render(state: Partial<CockpitState>): string {
  const store = create<CockpitState>(() => ({ ...nullCockpit.getState(), ...state }))
  return renderToStaticMarkup(createElement(CockpitContext.Provider, { value: store }, createElement(HouseMapPanel)))
}

beforeEach(() => {
  fake.desktop = false
})

describe('the Map panel', () => {
  it('with no run, says to start a rehearsal', () => {
    const html = render({ run: null })
    expect(html).toContain('Start a rehearsal to edit the map.')
    expect(html).not.toContain('house-map-panel')
  })

  it('signs in with the run, Open in a new tab ↗ beside it', () => {
    const html = render({ run })
    expect(html).toContain('data-testid="house-map-panel"')
    expect(html).toContain('Signing in to the map…')
    expect(html).toContain('href="https://app.example/reinstall/map?code=MOD%201"')
    expect(html).toContain('Open in a new tab ↗')
  })

  it('in the desktop shell, offers the browser instead of the embed', () => {
    fake.desktop = true
    const html = render({ run })
    expect(html).toContain('Open in browser ↗')
    expect(html).toContain('href="https://app.example/reinstall/map?code=MOD%201"')
    expect(html).toContain('Copy link')
    expect(html).not.toContain('house-map-panel')
  })
})

describe('the view’s flags', () => {
  it('remembers the run it was opened for after it leaves the screen', () => {
    const v = useHouseView.getState()
    expect(v.mapEvent).toBeNull()
    v.showMap('ev1')
    expect(useHouseView.getState()).toMatchObject({ mapEvent: 'ev1', mapShown: true })
    v.showMap(null)
    expect(useHouseView.getState()).toMatchObject({ mapEvent: 'ev1', mapShown: false })
  })
})

describe('the descent select', () => {
  const row = (forced: number | null) => renderToStaticMarkup(createElement(DescentRow, { eventId: 'ev1', forced, onForced: () => undefined }))

  it('reads by visits, and each level', () => {
    expect(row(null)).toContain('Descent:')
    expect(row(null)).toContain('by visits')
    expect(row(3)).toMatch(/<option value="3" selected="">3<\/option>/u)
    expect(row(null)).toMatch(/<option value="" selected="">by visits<\/option>/u)
  })
})

/** Every source file of the editor. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sources(full, out)
    else if (/\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name)) out.push(full)
  }
  return out
}

describe('the first load', () => {
  it('never imports the map or three.js statically', () => {
    const offenders = sources(join(__dirname, '../..')).filter((f) => /^import\s(?!type\s)[^\n]*from\s+'(@loom\/reinstall\/[^']*|three[^']*|@loom\/house\/three)'/mu.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('loads the embed through a dynamic import', () => {
    expect(readFileSync(join(__dirname, 'HouseMapPanel.tsx'), 'utf8')).toContain("import('@loom/reinstall/map')")
  })
})

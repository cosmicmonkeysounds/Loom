//! The glance column (spec §3): Needs you · Watch · People · Cast · Staff
//! room, in that order, each hiding itself when it has nothing to show.
//! Read-only — every row is a link to the page that acts on it. Below the
//! two-column width it becomes a strip of one-line chips, each opening its
//! section inline, one at a time. Pure rules in `glance.ts`.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { CockpitPhase, CockpitTab, SelectionKind, useCockpit } from '@/store/cockpit'
import { useInspect } from '../inspect'
import { PresenceDot } from '../presence'
import { PartPresence, partPresenceTitle } from '../parts'
import { logClock } from '../log-describe'
import { useDirector } from './context'
import { useNow } from './clock'
import {
  MASK,
  RoleAggKind,
  ValueTone,
  agentGlance,
  boothSummary,
  changedPaths,
  changedRecently,
  formatWatchValue,
  needsYou,
  peopleGlance,
  recentGlobals,
  staffFeed,
  watchRows,
  worldValue,
  type GlanceLink,
  type RoleAgg,
  type Seen,
  type WatchRow,
} from './glance'

/** Lines a section shows before `▸ more` at the middle width. */
const FIRST_LINES = 3

/** Follow a glance link. */
function useGo(): (link: GlanceLink) => void {
  const setTab = useCockpit((s) => s.setTab)
  const selectChannel = useCockpit((s) => s.selectChannel)
  const setWorldFilter = useCockpit((s) => s.setWorldFilter)
  const inspect = useInspect()
  return (link) => {
    if (link.kind === 'inspect') {
      inspect(link.selection)
      return
    }
    if (link.channel !== undefined) selectChannel(link.channel)
    if (link.worldFilter !== undefined) setWorldFilter(link.worldFilter)
    setTab(link.tab)
  }
}

function Label({ children }: { children: ReactNode }) {
  return <span className="text-[10px] uppercase tracking-widest text-zinc-500">{children}</span>
}

function Section({ title, link, testid, children }: { title: string; link?: { label: string; go: () => void }; testid: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-1 border-b border-zinc-800 px-3 py-2 last:border-b-0" data-testid={testid}>
      <div className="flex items-baseline gap-2">
        <Label>{title}</Label>
        {link !== undefined && (
          <button onClick={link.go} className="ml-auto text-[10px] text-zinc-500 hover:text-indigo-300">
            ↗ {link.label}
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

/** A list that shows its first lines and a `▸ more` toggle at the middle
 *  width (every line at the widest, where the column has room). */
function Lines({ items }: { items: ReactNode[] }) {
  const [more, setMore] = useState(false)
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((it, i) => (
        <div key={i} className={clsx(i >= FIRST_LINES && !more && 'hidden @6xl:block')}>
          {it}
        </div>
      ))}
      {items.length > FIRST_LINES && !more && (
        <button onClick={() => setMore(true)} className="self-start text-[10px] text-zinc-500 hover:text-zinc-300 @6xl:hidden">
          ▸ {items.length - FIRST_LINES} more
        </button>
      )}
    </div>
  )
}

function valueTone(tone: ValueTone): string {
  return tone === ValueTone.True ? 'text-emerald-400' : tone === ValueTone.False || tone === ValueTone.None ? 'text-zinc-500' : 'text-zinc-100'
}

// ---------------------------------------------------------------------------
// Needs you
// ---------------------------------------------------------------------------

function useNeeds() {
  const { arm } = useDirector()
  const messages = useCockpit((s) => s.messages)
  const channels = useCockpit((s) => s.channels)
  const world = useCockpit((s) => s.world)
  const facts = useCockpit((s) => s.facts)
  const wallet = useCockpit((s) => s.wallet)
  const cast = useCockpit((s) => s.cast)
  const doorsOpen = useCockpit((s) => s.phase === CockpitPhase.Open)
  const now = useNow(arm.refused !== null, 1000)
  return needsYou({ refused: arm.refused, now, messages, channels, world, facts, wallet, cast, doorsOpen })
}

function NeedsYou() {
  const items = useNeeds()
  const go = useGo()
  if (items.length === 0) return null
  return (
    <Section title="Needs you" testid="glance-needs">
      <Lines
        items={items.map((n) => (
          <button key={n.key} onClick={() => go(n.link)} className="flex w-full flex-col text-left text-xs hover:text-indigo-300" data-testid={`glance-need-${n.kind}`}>
            <span className={n.kind === 'refused' ? 'text-red-400' : 'text-zinc-200'}>{n.text}</span>
            {n.detail !== undefined && <span className="truncate pl-3 text-zinc-500">“{n.detail}”</span>}
          </button>
        ))}
      />
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Watch
// ---------------------------------------------------------------------------

/** 10 cells, `count` of `total` filled. */
function Cells({ count, total }: { count: number; total: number }) {
  const filled = total === 0 ? 0 : Math.round((count / total) * 10)
  return (
    <span className="inline-flex gap-px" aria-hidden>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={clsx('h-2 w-1.5 rounded-sm', i < filled ? 'bg-indigo-400' : 'bg-zinc-800')} />
      ))}
    </span>
  )
}

function AggValue({ agg }: { agg: RoleAgg }) {
  if (agg.type === RoleAggKind.Bool) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="tabular-nums text-zinc-100">
          {agg.count}/{agg.total}
        </span>
        <Cells count={agg.count} total={agg.total} />
      </span>
    )
  }
  if (agg.type === RoleAggKind.Number) {
    return (
      <span className="tabular-nums text-zinc-100">
        {agg.sum} · max {Number.isFinite(agg.max) ? agg.max : '—'}
      </span>
    )
  }
  return <span className="truncate text-zinc-100">{agg.top.length === 0 ? '—' : agg.top.map((t) => `${t.value} ×${t.count}`).join(' · ')}</span>
}

/** A secret value: masked; press and hold 👁 to read it for 5 s. */
function SecretValue({ path }: { path: string }) {
  const world = useCockpit((s) => s.world)
  const [shown, setShown] = useState(false)
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => setShown(false), 5000)
    return () => clearTimeout(t)
  }, [shown])
  const cancel = () => {
    if (hold.current !== null) clearTimeout(hold.current)
    hold.current = null
  }
  return (
    <span className="flex items-center gap-1">
      <span className="tabular-nums text-zinc-100" data-testid="glance-secret">
        {shown ? formatWatchValue(worldValue(world, path)).text : MASK}
      </span>
      <button
        onPointerDown={(e) => {
          e.stopPropagation()
          cancel()
          hold.current = setTimeout(() => setShown(true), 400)
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onClick={(e) => e.stopPropagation()}
        className="text-[11px] text-zinc-500 hover:text-zinc-200"
        title="press and hold to show for 5 s"
      >
        👁
      </button>
    </span>
  )
}

function WatchLine({ row, changed }: { row: WatchRow; changed: boolean }) {
  const go = useGo()
  const lockIcon = row.kind === 'value' && row.secret
  // A secret row links nowhere: World filtered to it would print the value
  // in clear, undoing the hold-to-reveal on a projected laptop.
  const linked = !lockIcon
  const onClick = () => {
    if (row.kind === 'value') go({ kind: 'tab', tab: CockpitTab.World, worldFilter: row.path })
    else if (row.kind === 'role') go({ kind: 'tab', tab: CockpitTab.Roster })
    else if (row.id !== null) go({ kind: 'inspect', selection: { kind: row.guest ? SelectionKind.Guest : SelectionKind.Character, id: row.id } })
  }
  return (
    <div
      role={linked ? 'button' : undefined}
      tabIndex={linked ? -1 : undefined}
      onClick={linked ? onClick : undefined}
      className={clsx('flex items-baseline gap-2 rounded px-1 text-xs', linked && 'cursor-pointer hover:bg-zinc-900/60', changed && 'underline decoration-amber-500 underline-offset-2')}
      data-testid={`glance-watch-${row.label}`}
    >
      <span className="w-28 shrink-0 truncate text-zinc-400" title={row.kind === 'person' ? row.label : row.path}>
        {lockIcon && '🔒 '}
        {row.label}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-1">
        {row.kind === 'value' && (row.secret ? <SecretValue path={row.path} /> : <span className={clsx('truncate tabular-nums', valueTone(row.value.tone))}>{row.value.text}</span>)}
        {row.kind === 'role' && <AggValue agg={row.agg} />}
        {row.kind === 'person' &&
          (row.id === null ? (
            <span className="text-zinc-600">not here</span>
          ) : (
            <span className="flex min-w-0 items-center gap-1 truncate text-zinc-200">
              <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', row.online === true ? 'bg-emerald-400' : row.online === false ? 'border border-zinc-600' : 'bg-zinc-700')} />
              <span className="truncate">{row.location ?? '—'}</span>
              {row.faction !== null && (
                <span className="shrink-0 text-[10px] text-zinc-500" title={row.faction}>
                  · {initials(row.faction)}
                </span>
              )}
              {row.prison && <span title="in a prison location">⛓</span>}
              {row.restricted && <span title="restricted">⛔</span>}
            </span>
          ))}
        {changed && <span className="text-amber-400">◆</span>}
      </span>
    </div>
  )
}

/** A faction's initials (`Unlimited Power` → `UP`). */
function initials(name: string): string {
  const words = name.split(/[\s_-]+/u).filter((w) => w !== '')
  return words.length > 1 ? words.map((w) => w[0]!.toUpperCase()).join('').slice(0, 3) : name.slice(0, 3)
}

function WatchList() {
  const watch = useCockpit((s) => s.watch)
  const declared = useCockpit((s) => s.watchDeclared)
  const world = useCockpit((s) => s.world)
  const roster = useCockpit((s) => s.roster)
  const cast = useCockpit((s) => s.cast)
  const log = useCockpit((s) => s.log)
  const clock = useCockpit((s) => s.storyClock)
  const go = useGo()
  const seen = useRef<Map<string, Seen>>(new Map())
  const [changes, setChanges] = useState<Map<string, Seen>>(new Map())
  useEffect(() => {
    seen.current = changedPaths(seen.current, world, Date.now())
    setChanges(seen.current)
  }, [world])
  const now = useNow(true, 2000)
  const rows = useMemo(() => watchRows(watch, world, roster, cast), [watch, world, roster, cast])
  const recent = useMemo(
    () => (declared ? [] : recentGlobals(log, world, roster.map((r) => r.id), cast.map((c) => c.id), 8)),
    [declared, log, world, roster, cast],
  )
  const toWorld = { label: 'World', go: () => go({ kind: 'tab', tab: CockpitTab.World }) }
  if (declared) {
    if (rows.length === 0) return null
    return (
      <Section title="Watch" link={toWorld} testid="glance-watch">
        <Lines items={rows.map((r) => <WatchLine key={r.key} row={r} changed={r.kind === 'value' && !r.secret && changedRecently(changes, r.path, now)} />)} />
      </Section>
    )
  }
  if (recent.length === 0) return null
  const storyMs = clock?.ms ?? null
  return (
    <Section title="Recently changed" link={toWorld} testid="glance-watch">
      <Lines
        items={recent.map((r) => (
          <button key={r.path} onClick={() => go({ kind: 'tab', tab: CockpitTab.World, worldFilter: r.path })} className="flex w-full items-baseline gap-2 rounded px-1 text-left text-xs hover:bg-zinc-900/60">
            <span className="w-28 shrink-0 truncate font-mono text-[11px] text-zinc-400">{r.path}</span>
            <span className={clsx('min-w-0 flex-1 truncate tabular-nums', valueTone(r.value.tone))}>{r.value.text}</span>
            {r.at !== undefined && storyMs !== null && <span className="shrink-0 text-[10px] text-zinc-600">{Math.max(0, Math.round((storyMs - r.at) / 60000))} min ago</span>}
          </button>
        ))}
      />
      <p className="text-[10px] text-zinc-600">
        Declare <code>watch:</code> lines in the story's header to choose what shows here.
      </p>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

function People() {
  const roster = useCockpit((s) => s.roster)
  const factions = useCockpit((s) => s.factions)
  const locations = useCockpit((s) => s.locations)
  const go = useGo()
  const g = useMemo(() => peopleGlance(roster, factions, locations), [roster, factions, locations])
  if (g.joined === 0) return null
  const lines: ReactNode[] = []
  for (const p of g.prisons) {
    lines.push(
      <div key={`p:${p.id}`} className="flex flex-wrap items-center gap-1 text-xs text-zinc-300">
        <span>
          ⛓ {p.people.length} in {p.label}:
        </span>
        {p.people.slice(0, 6).map((x) => (
          <button key={x.id} onClick={() => go({ kind: 'inspect', selection: { kind: SelectionKind.Guest, id: x.id } })} className="rounded bg-zinc-800 px-1 text-[11px] hover:text-indigo-300">
            {x.name}
          </button>
        ))}
        {p.people.length > 6 && <span className="text-zinc-500">+{p.people.length - 6}</span>}
      </div>,
    )
  }
  if (g.restricted > 0) lines.push(<div key="restricted" className="text-xs text-zinc-300">⛔ {g.restricted} restricted</div>)
  for (const f of g.factions) {
    const pct = (n: number) => `${f.joined === 0 ? 0 : Math.min(100, (n / f.joined) * 100)}%`
    lines.push(
      <button
        key={`f:${f.id}`}
        onClick={() => go({ kind: 'inspect', selection: { kind: SelectionKind.Faction, id: f.id } })}
        className="flex w-full items-center gap-2 text-left text-xs hover:text-indigo-300"
        title={`${f.count} of ${f.joined} · a majority is ${f.majority}`}
        data-testid={`glance-faction-${f.id}`}
      >
        <span className="w-28 shrink-0 truncate text-zinc-300">{f.id}</span>
        <span className="relative h-2 min-w-12 flex-1 rounded-sm bg-zinc-800">
          <span className="absolute inset-y-0 left-0 rounded-sm bg-indigo-400" style={{ width: pct(f.count) }} />
          <span className="absolute -inset-y-0.5 w-px bg-amber-400" style={{ left: pct(f.majority) }} />
        </span>
        <span className="w-6 shrink-0 text-right tabular-nums text-zinc-100">{f.count}</span>
        {f.hidden && <span className="shrink-0 text-[10px] text-zinc-500">🔒 hidden</span>}
      </button>,
    )
  }
  if (g.crowded.length > 0) {
    lines.push(
      <button key="crowded" onClick={() => go({ kind: 'tab', tab: CockpitTab.Stage })} className="truncate text-left text-xs text-zinc-400 hover:text-indigo-300">
        {g.crowded.map((l) => `${l.label} ${l.count}`).join(' · ')} ↗
      </button>,
    )
  }
  return (
    <Section title="People" link={{ label: 'Stage', go: () => go({ kind: 'tab', tab: CockpitTab.Stage }) }} testid="glance-people">
      <div className="text-xs text-zinc-200">
        <span className="tabular-nums">{g.joined}</span> joined
        {g.online !== null && (
          <>
            {' · '}
            <span className="tabular-nums">{g.online}</span> online
          </>
        )}
      </div>
      <Lines items={lines} />
      {g.factions.length > 0 && <div className="text-[10px] text-zinc-600">┊ = a majority ({g.factions[0]!.majority})</div>}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Cast
// ---------------------------------------------------------------------------

function Cast() {
  const cast = useCockpit((s) => s.cast)
  const minds = useCockpit((s) => s.minds)
  const go = useGo()
  const booths = useMemo(() => boothSummary(cast), [cast])
  const agents = useMemo(() => agentGlance(minds, cast), [minds, cast])
  if (booths.dots.length === 0 && agents.length === 0) return null
  return (
    <Section title="Cast" testid="glance-cast">
      {booths.dots.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-zinc-400">booths</span>
          {booths.dots.map((b) => (
            <button
              key={b.id}
              onClick={() => go({ kind: 'inspect', selection: { kind: SelectionKind.Character, id: b.id } })}
              className="flex h-4 w-4 items-center justify-center rounded hover:bg-zinc-800"
              title={partPresenceTitle(b.id, b.presence)}
              data-testid={`glance-booth-${b.id}`}
            >
              {b.presence === PartPresence.Unknown ? <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" /> : <PresenceDot presence={b.presence} />}
            </button>
          ))}
          {booths.tracked && (
            <span className="tabular-nums text-zinc-300">
              {booths.signedIn}/{booths.dots.length}
              {booths.offline > 0 && <span className="text-amber-300"> · {booths.offline} offline</span>}
            </span>
          )}
        </div>
      )}
      {agents.map((a) => (
        <button key={a.id} onClick={() => go({ kind: 'tab', tab: CockpitTab.Mind })} className="flex items-center gap-1.5 text-left text-xs text-zinc-200 hover:text-indigo-300" data-testid={`glance-agent-${a.id}`}>
          <span>🤖 {a.id}</span>
          <PresenceDot presence={a.presence} />
          <span className="text-zinc-400">
            {a.presence === PartPresence.Voiced ? 'voiced' : a.presence === PartPresence.Unvoiced ? 'no worker' : ''}
            {a.stage !== null && ` · ${a.stage}${a.stageIndex !== null ? ` (${a.stageIndex}/${a.stageCount})` : ''}`}
            {a.mood !== null && ` · ${a.mood}`}
          </span>
        </button>
      ))}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Staff room
// ---------------------------------------------------------------------------

function StaffRoom({ lines }: { lines: number }) {
  const messages = useCockpit((s) => s.messages)
  const channels = useCockpit((s) => s.channels)
  const go = useGo()
  const feed = useMemo(() => staffFeed(messages, channels, lines), [messages, channels, lines])
  const room = channels.find((c) => c.staff === true)
  if (room === undefined) return null
  return (
    <Section title={room.title} link={{ label: 'Chat', go: () => go({ kind: 'tab', tab: CockpitTab.Chat, channel: room.id }) }} testid="glance-staff">
      {feed.length === 0 ? (
        <div className="text-xs text-zinc-600">Nothing yet.</div>
      ) : (
        feed.map((m) => (
          <button key={m.seq} onClick={() => go({ kind: 'tab', tab: CockpitTab.Chat, channel: m.channel })} className="flex w-full items-baseline gap-2 text-left text-xs hover:text-indigo-300">
            <span className="shrink-0 font-mono text-[10px] text-zinc-600">{logClock(m.ts)}</span>
            <span className="min-w-0 flex-1 truncate text-zinc-300" title={m.text}>
              {m.text}
            </span>
          </button>
        ))
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// The column and the strip
// ---------------------------------------------------------------------------

export function GlanceColumn({ watching }: { watching: boolean }) {
  return (
    <div
      className={clsx('flex flex-col rounded-xl border border-zinc-800 empty:hidden', watching && '@4xl:grid @4xl:grid-cols-2 @6xl:grid-cols-3')}
      data-testid="director-glance"
    >
      <NeedsYou />
      <WatchList />
      <People />
      <Cast />
      <StaffRoom lines={watching ? 12 : 5} />
    </div>
  )
}

const StripSection = {
  Needs: 'needs',
  Watch: 'watch',
  People: 'people',
  Cast: 'cast',
  Staff: 'staff',
} as const
type StripSection = (typeof StripSection)[keyof typeof StripSection]

/** The narrow layout: one line of chips, each opening its section inline. */
export function GlanceStrip({ watching }: { watching: boolean }) {
  const [open, setOpen] = useState<StripSection | null>(null)
  const needs = useNeeds()
  const roster = useCockpit((s) => s.roster)
  const factions = useCockpit((s) => s.factions)
  const locations = useCockpit((s) => s.locations)
  const cast = useCockpit((s) => s.cast)
  const minds = useCockpit((s) => s.minds)
  const messages = useCockpit((s) => s.messages)
  const channels = useCockpit((s) => s.channels)
  const watch = useCockpit((s) => s.watch)
  const declared = useCockpit((s) => s.watchDeclared)
  const g = useMemo(() => peopleGlance(roster, factions, locations), [roster, factions, locations])
  const booths = useMemo(() => boothSummary(cast), [cast])
  const agents = useMemo(() => agentGlance(minds, cast), [minds, cast])
  const staff = channels.find((c) => c.staff === true)
  const staffCount = useMemo(() => staffFeed(messages, channels, 99).length, [messages, channels])
  const chip = (id: StripSection, label: string, tone?: string) => (
    <button
      key={id}
      onClick={() => setOpen((o) => (o === id ? null : id))}
      className={clsx('rounded-full border px-2 py-0.5 text-[11px]', open === id ? 'border-indigo-500/70 bg-indigo-500/10' : 'border-zinc-800 hover:border-zinc-600', tone ?? 'text-zinc-300')}
      data-testid={`glance-chip-${id}`}
    >
      {label}
    </button>
  )
  const chips: ReactNode[] = []
  if (needs.length > 0) chips.push(chip(StripSection.Needs, `⚑ ${needs.length}`, 'text-red-400'))
  if ((declared && watch.length > 0) || !declared) chips.push(chip(StripSection.Watch, declared ? 'watch' : 'changed'))
  if (g.joined > 0) {
    const parts = [g.online !== null ? `${g.online}/${g.joined} online` : `${g.joined} joined`]
    const jailed = g.prisons.reduce((n, p) => n + p.people.length, 0)
    if (jailed > 0) parts.push(`⛓${jailed}`)
    if (g.restricted > 0) parts.push(`⛔${g.restricted}`)
    chips.push(chip(StripSection.People, parts.join(' · ')))
  }
  if (booths.dots.length > 0 || agents.length > 0) {
    const parts: string[] = []
    if (booths.tracked) parts.push(`booths ${booths.signedIn}/${booths.dots.length}`)
    for (const a of agents) parts.push(`🤖 ${a.presence === PartPresence.Voiced ? 'voiced' : a.presence === PartPresence.Unvoiced ? 'no worker' : a.id}`)
    chips.push(chip(StripSection.Cast, parts.length > 0 ? parts.join(' · ') : 'cast'))
  }
  if (staff !== undefined) chips.push(chip(StripSection.Staff, `${staff.title} ${staffCount}`))
  if (chips.length === 0) return null
  return (
    <div className="flex flex-col gap-1" data-testid="director-glance-strip">
      <div className="flex flex-wrap gap-1">{chips}</div>
      {open !== null && (
        <div className="rounded-lg border border-zinc-800">
          {open === StripSection.Needs && <NeedsYou />}
          {open === StripSection.Watch && <WatchList />}
          {open === StripSection.People && <People />}
          {open === StripSection.Cast && <Cast />}
          {open === StripSection.Staff && <StaffRoom lines={watching ? 12 : 5} />}
        </div>
      )}
    </div>
  )
}

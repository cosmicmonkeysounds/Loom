//! The cockpit's right tray: the Inspector. Bound to the Roster/World
//! selection, it's where the director changes a guest's stats on the fly
//! (score / faction / location / captured), fires narrative at one
//! person, answers a pending choice, or — for a cast member — fires that
//! character's owned beats. It is also the super-admin's peek: **Their
//! view** (what that participant's own screen says right now) and **Their
//! feed** (every message they have seen — hidden ones greyed — or, for a
//! character, every line they spoke and every scan readout they got), with
//! one button to *be* them. Under a non-Operator lens the editors are
//! closed: you are a participant right now, not the director.

import { useMemo, useState, type ReactNode } from 'react'
import { CockpitTab, SelectionKind, useCockpit, type CockpitMessage } from '@/store/cockpit'
import { useGraph } from '@/store/graph'
import { promptText } from '@/store/dialog'
import { FactionPill } from './ui'
import { entityVars, GUEST_STANDARD_FIELDS } from './world'
import { VarTable } from './VarTable'

/** How many recent messages "Their feed" shows. */
const FEED_LIMIT = 60

function Note({ children }: { children: ReactNode }) {
  return <p className="px-3 pb-1 text-[10px] text-zinc-600">{children}</p>
}

/** A compact, read-only message list (a participant's feed). */
function FeedList({ rows, roomOf }: { rows: CockpitMessage[]; roomOf: (m: CockpitMessage) => string }) {
  if (rows.length === 0) return <Note>Nothing yet.</Note>
  return (
    <ul className="mx-3 mb-1 flex max-h-72 flex-col gap-0.5 overflow-auto rounded border border-zinc-800 p-1 text-xs" data-testid="inspector-feed">
      {rows.map((m) => (
        <li key={m.seq} className={m.hidden ? 'opacity-40' : ''} title={m.hidden ? 'hidden by a moderator' : undefined}>
          <span className="text-[9px] uppercase tracking-wide text-zinc-600">{roomOf(m)}</span>{' '}
          {m.kind === 'line' && <span className="font-semibold text-zinc-300">{m.from}: </span>}
          <span className={m.kind === 'narration' ? 'italic text-zinc-400' : m.kind === 'line' ? 'text-zinc-200' : 'text-zinc-500'}>{m.text}</span>
          {m.via && <span className="ml-1 text-[9px] text-violet-400">via {m.via}</span>}
        </li>
      ))}
    </ul>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 px-3 py-1.5 text-xs">
      <span className="w-20 shrink-0 text-zinc-500">{label}</span>
      {children}
    </label>
  )
}

const inputCls =
  'min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-indigo-500'

// ---------------------------------------------------------------------------
// Pending choice (answer on a participant's behalf — identical on both backends)
// ---------------------------------------------------------------------------

export function PendingChoice({ person }: { person: string }) {
  const options = useCockpit((s) => s.choices[person])
  const choose = useCockpit((s) => s.choose)
  if (options === undefined || options.length === 0) return null
  return (
    <div className="mx-3 mb-2 rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-2">
      <div className="pb-1 text-[10px] uppercase tracking-widest text-emerald-400">Pending choice</div>
      <div className="flex flex-col gap-1">
        {options.map((opt, i) => (
          <button
            key={i}
            onClick={() => void choose(person, i)}
            className="rounded border border-emerald-800/60 px-2 py-1 text-left text-xs text-emerald-100 hover:bg-emerald-900/40"
            data-testid={`choice-${person}-${i}`}
          >
            {i + 1}. {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Guest inspector
// ---------------------------------------------------------------------------

/** Where this guest is in the story — current beat + their whole trail,
 *  every entry clicking through to the node on the story map. */
function StoryTrail({ beat, visited }: { beat: string | null | undefined; visited: Record<string, number> | undefined }) {
  const setTab = useCockpit((s) => s.setTab)
  const show = (b: string) => {
    setTab(CockpitTab.Story)
    useGraph.getState().reveal(b)
  }
  const trail = Object.entries(visited ?? {}).sort((a, b) => b[1] - a[1])
  if (!beat && trail.length === 0) return null
  return (
    <div>
      <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-zinc-500">Story position</div>
      {beat != null && (
        <button
          onClick={() => show(beat)}
          title="Show on the story map"
          className="mx-3 mb-1 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg border border-amber-700/50 bg-amber-950/20 px-2 py-1.5 text-left text-sm text-amber-200 hover:bg-amber-950/40"
          data-testid="inspector-story-position"
        >
          <span className="animate-pulse">◉</span>
          <span className="min-w-0 flex-1 truncate">{beat}</span>
          <span className="shrink-0 text-[10px] text-amber-400/70">show on map →</span>
        </button>
      )}
      {trail.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-1">
          {trail.map(([b, n]) => (
            <button
              key={b}
              onClick={() => show(b)}
              title={`${b} — visited ${n}×; click to show on the map`}
              className="rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-amber-700/60 hover:text-amber-200"
            >
              {b}
              {n > 1 && <span className="text-zinc-600"> ×{n}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Every non-standard variable on this entity — live, straight from the
 *  world table (`suspicion: 7`, role-slot defaults, story-set state);
 *  double-click a value to edit it in place. */
function VarsSection({ id }: { id: string }) {
  const world = useCockpit((s) => s.world)
  const vars = entityVars(world, id, new Set(GUEST_STANDARD_FIELDS))
  if (vars.length === 0) return null
  return (
    <div>
      <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-zinc-500">Variables</div>
      <VarTable rows={vars} className="mx-3 mb-1 w-[calc(100%-1.5rem)] rounded border border-zinc-800 text-xs" />
    </div>
  )
}

/** What the guest's own screen says right now — from the lens projection
 *  when they ARE the lens, else the roster's public-facing summary. */
function TheirView({ id }: { id: string }) {
  const lens = useCockpit((s) => s.lens)
  const row = useCockpit((s) => s.roster.find((r) => r.id === id))
  const choice = useCockpit((s) => s.choices[id])
  const exact = lens !== null && lens.kind === 'guest' && lens.id === id ? lens.view : null
  const faction = exact ? exact.faction : (row?.faction ?? null)
  const location = exact ? exact.location : (row?.location ?? null)
  const score = exact ? exact.score : (row?.score ?? 0)
  const pending = exact ? exact.pendingChoice : (choice ?? null)
  const rooms = exact ? exact.channels.length : null
  return (
    <div data-testid="inspector-their-view">
      <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-zinc-500">
        Their view {exact ? <span className="text-indigo-400/80">· exact</span> : null}
      </div>
      <div className="mx-3 mb-1 grid grid-cols-2 gap-x-3 gap-y-0.5 rounded border border-zinc-800 px-2 py-1.5 text-xs">
        <span className="text-zinc-500">side</span>
        <span className="text-zinc-200">{faction ?? 'none yet'}</span>
        <span className="text-zinc-500">where</span>
        <span className="text-zinc-200">{location ?? '—'}</span>
        <span className="text-zinc-500">score</span>
        <span className="text-zinc-200">{score}</span>
        <span className="text-zinc-500">deciding</span>
        <span className="text-zinc-200">{pending ? pending.join(' / ') : '—'}</span>
        {rooms !== null && (
          <>
            <span className="text-zinc-500">rooms</span>
            <span className="text-zinc-200">{rooms} authored</span>
          </>
        )}
        {exact && exact.interactions.length > 0 && (
          <>
            <span className="text-zinc-500">can</span>
            <span className="text-zinc-200">{exact.interactions.map((i) => i.label).join(', ')}</span>
          </>
        )}
      </div>
      <Note>A hidden allegiance reads as “none yet” here, exactly as on their phone.</Note>
    </div>
  )
}

/** Every message this guest has seen, newest last, hidden ones greyed. */
function GuestFeed({ id }: { id: string }) {
  const messages = useCockpit((s) => s.messages)
  const rows = useMemo(
    () => messages.filter((m) => m.audience === 'all' || (Array.isArray(m.audience) && m.audience.includes(id))).slice(-FEED_LIMIT),
    [messages, id],
  )
  return (
    <div>
      <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-zinc-500">Their feed · last {Math.min(rows.length, FEED_LIMIT)}</div>
      <FeedList rows={rows} roomOf={(m) => m.title ?? m.channel} />
    </div>
  )
}

function GuestInspector({ id }: { id: string }) {
  const row = useCockpit((s) => s.roster.find((r) => r.id === id))
  const factions = useCockpit((s) => s.factions)
  const locations = useCockpit((s) => s.locations)
  const cast = useCockpit((s) => s.cast)
  const events = useCockpit((s) => s.events)
  const me = useCockpit((s) => s.me)
  const locked = useCockpit((s) => s.lens !== null)
  const setStat = useCockpit((s) => s.setStat)
  const fireSignal = useCockpit((s) => s.fireSignal)
  const scanAs = useCockpit((s) => s.scanAs)
  const say = useCockpit((s) => s.say)
  const setPerspective = useCockpit((s) => s.setPerspective)
  const setTab = useCockpit((s) => s.setTab)

  const [score, setScore] = useState('')
  const [scoreSeen, setScoreSeen] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [signal, setSignal] = useState('')
  const [scanChar, setScanChar] = useState('')

  if (!row) return <Empty msg="This guest has left the event." />

  // Resync the field to the live value only when the operator isn't mid-edit,
  // so an incoming snapshot (a tick, another mod's action) can't clobber a
  // half-typed score.
  if (!editing && row.score !== scoreSeen) {
    setScoreSeen(row.score)
    setScore(String(row.score))
  }

  const commitScore = () => {
    setEditing(false)
    setScoreSeen(row.score)
    const n = Number(score)
    if (Number.isFinite(n) && n !== row.score) void setStat(id, 'score', n)
  }

  const dm = () => {
    void (async () => {
      const text = await promptText({
        title: `Message ${row.name}`,
        body: 'Sent as Operator.',
        confirmLabel: 'Send',
      })
      if (text) await say(`guest:${id}`, text)
    })()
  }

  return (
    <div className="h-full overflow-auto">
      <div className="border-b border-zinc-800 px-3 py-2">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500">
          {row.owner ? (row.owner === me ? 'Your persona' : `${row.owner}'s persona`) : 'Guest'}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-100">{row.name}</span>
          {row.captured && <span className="text-xs text-red-400">🔒 captured</span>}
          <button
            onClick={() => {
              setPerspective(id)
              setTab(CockpitTab.Chat)
            }}
            className="ml-auto rounded border border-indigo-900 px-2 py-0.5 text-[10px] text-indigo-300 hover:bg-indigo-950"
            title={`See and act exactly as ${row.name}`}
            data-testid={`inspector-view-as-${id}`}
          >
            👁 Be {row.name}
          </button>
        </div>
        <div className="text-[10px] text-zinc-600">{row.id}</div>
      </div>

      <div className="pt-2">
        <PendingChoice person={id} />
      </div>

      <TheirView id={id} />
      <StoryTrail beat={row.beat} visited={row.visited} />
      <GuestFeed id={id} />
      <VarsSection id={id} />

      {locked && (
        <div className="mx-3 mt-3 rounded border border-indigo-900/60 bg-indigo-950/30 px-2 py-1.5 text-[10px] text-indigo-200" data-testid="inspector-locked">
          Switch to Operator to edit.
        </div>
      )}
      <fieldset disabled={locked} className="py-1 disabled:opacity-50">
        <Field label="Score">
          <input
            className={inputCls}
            value={score}
            inputMode="numeric"
            onFocus={() => setEditing(true)}
            onChange={(e) => {
              setEditing(true)
              setScore(e.target.value)
            }}
            onBlur={commitScore}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              else if (e.key === 'Escape') {
                setEditing(false)
                setScore(String(row.score))
              }
            }}
          />
        </Field>

        <Field label="Faction">
          <select
            className={inputCls}
            value={row.faction ?? ''}
            onChange={(e) => e.target.value && void setStat(id, 'faction', e.target.value)}
          >
            <option value="" disabled>
              — set faction —
            </option>
            {factions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.id}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Location">
          <select
            className={inputCls}
            value={row.location ?? ''}
            onChange={(e) => e.target.value && void setStat(id, 'location', e.target.value)}
          >
            <option value="" disabled>
              — set location —
            </option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label || l.id}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Captured">
          <button
            onClick={() => void setStat(id, 'captured', !row.captured)}
            className={
              row.captured
                ? 'rounded bg-emerald-700/40 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-700/60'
                : 'rounded bg-amber-700/40 px-3 py-1 text-xs text-amber-300 hover:bg-amber-700/60'
            }
          >
            {row.captured ? 'Release' : 'Capture'}
          </button>
        </Field>
      </fieldset>

      <fieldset disabled={locked} className="disabled:opacity-50">
      <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-zinc-500">Fire on this guest</div>
      <div className="flex items-center gap-2 px-3 pb-2">
        <select className={inputCls} value={signal} onChange={(e) => setSignal(e.target.value)}>
          <option value="">— named event —</option>
          {events.map((ev) => (
            <option key={ev} value={ev}>
              {ev}
            </option>
          ))}
        </select>
        <button
          onClick={() => signal && void fireSignal(signal, id)}
          disabled={!signal}
          className="shrink-0 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
        >
          Fire
        </button>
      </div>

      <div className="flex items-center gap-2 px-3 pb-2">
        <select className={inputCls} value={scanChar} onChange={(e) => setScanChar(e.target.value)}>
          <option value="">— scan as character —</option>
          {cast.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id}
            </option>
          ))}
        </select>
        <button
          onClick={() => scanChar && void scanAs(scanChar, id)}
          disabled={!scanChar}
          className="shrink-0 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
        >
          Scan
        </button>
      </div>

      <div className="flex flex-col gap-1.5 px-3 pb-4 pt-1">
        <button onClick={dm} className="w-full rounded border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">
          ✉️ Direct message
        </button>
      </div>
      </fieldset>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Character (cast) inspector
// ---------------------------------------------------------------------------

/** Every line this character spoke (any room / DM) plus every scan
 *  readout the booth received — the performer's own history. */
function CharacterFeed({ id }: { id: string }) {
  const messages = useCockpit((s) => s.messages)
  const log = useCockpit((s) => s.log)
  const rows = useMemo(
    () => messages.filter((m) => m.from === id || m.channel === `dm:${id}`).slice(-FEED_LIMIT),
    [messages, id],
  )
  const readouts = useMemo(
    () => log.filter((e) => e.event.type === 'respond' && e.event.to === id).slice(-20),
    [log, id],
  )
  return (
    <div>
      <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-zinc-500">Their feed · last {Math.min(rows.length, FEED_LIMIT)}</div>
      <FeedList rows={rows} roomOf={(m) => (m.channel.startsWith('dm:') ? 'dm' : (m.title ?? m.channel))} />
      {readouts.length > 0 && (
        <>
          <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-zinc-500">Scan readouts</div>
          <ul className="mx-3 mb-1 flex flex-col gap-0.5 rounded border border-emerald-900/50 p-1 text-xs">
            {readouts.map((e) => (
              <li key={e.seq} className="italic text-emerald-100/90">
                {e.event.type === 'respond' ? e.event.text : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function CharacterInspector({ id }: { id: string }) {
  const member = useCockpit((s) => s.cast.find((c) => c.id === id))
  const beats = useCockpit((s) => s.beats)
  const locked = useCockpit((s) => s.lens !== null)
  const fireBeat = useCockpit((s) => s.fireBeat)
  const setPerspective = useCockpit((s) => s.setPerspective)
  const setTab = useCockpit((s) => s.setTab)

  // Beats this character owns are keyed `Owner.beat`.
  const owned = beats.filter((b) => b.startsWith(`${id}.`))

  return (
    <div className="h-full overflow-auto">
      <div className="border-b border-zinc-800 px-3 py-2">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500">Character</div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-100">{id}</span>
          <FactionPill faction={member?.faction ?? null} />
          <button
            onClick={() => {
              setPerspective(id)
              setTab(CockpitTab.Chat)
            }}
            className="ml-auto rounded border border-indigo-900 px-2 py-0.5 text-[10px] text-indigo-300 hover:bg-indigo-950"
            title={`Be ${id}: their booth, their rooms, their voice`}
            data-testid={`inspector-view-as-${id}`}
          >
            👁 Be {id}
          </button>
        </div>
      </div>

      {member?.online === true && <Note>A performer is signed in as {id} right now.</Note>}
      <CharacterFeed id={id} />
      <VarsSection id={id} />

      <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-zinc-500">Owned beats</div>
      {owned.length === 0 ? (
        <p className="px-3 py-2 text-xs text-zinc-600">
          No beats owned by this character. Use the Director tab to fire any global beat, or the Chat composer to speak as {id}.
        </p>
      ) : (
        <div className="flex flex-col gap-1 px-3 pb-4">
          {locked && <Note>Switch to Operator to fire beats.</Note>}
          {owned.map((b) => (
            <button
              key={b}
              disabled={locked}
              onClick={() => void fireBeat(b)}
              className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-1.5 text-left text-sm hover:bg-zinc-800 disabled:opacity-50"
            >
              <span className="truncate text-zinc-200">{b.slice(id.length + 1)}</span>
              <span className="shrink-0 text-xs text-indigo-400">fire →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Faction inspector
// ---------------------------------------------------------------------------

function FactionInspector({ id }: { id: string }) {
  const faction = useCockpit((s) => s.factions.find((f) => f.id === id))
  const roster = useCockpit((s) => s.roster)
  const locked = useCockpit((s) => s.lens !== null)
  const reveal = useCockpit((s) => s.reveal)
  const broadcast = useCockpit((s) => s.broadcast)
  const select = useCockpit((s) => s.select)
  const [cue, setCue] = useState('')

  if (!faction) return <Empty msg="This faction is no longer in the world." />
  if (locked && faction.hidden && !faction.revealed) return <Empty msg="Switch to Operator to inspect a hidden group." />
  const nameOf = (gid: string) => roster.find((r) => r.id === gid)?.name ?? gid

  return (
    <div className="h-full overflow-auto">
      <div className="border-b border-zinc-800 px-3 py-2">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500">Faction</div>
        <div className="flex items-center gap-2">
          <FactionPill faction={faction.id} />
          {faction.hidden && (
            <span className={faction.revealed ? 'text-xs text-red-400' : 'text-xs text-zinc-600'}>
              {faction.revealed ? 'exposed' : 'hidden'}
            </span>
          )}
        </div>
      </div>

      <div className="py-1 text-xs">
        {faction.ethos && (
          <div className="px-3 py-1">
            <span className="text-zinc-500">Ethos </span>
            <span className="text-zinc-300">{faction.ethos}</span>
          </div>
        )}
        {faction.rival && (
          <div className="px-3 py-1">
            <span className="text-zinc-500">Rival </span>
            <span className="text-zinc-300">{faction.rival}</span>
          </div>
        )}
        <div className="px-3 py-1 text-zinc-500">{faction.members.length} members</div>
      </div>

      {faction.hidden && !faction.revealed && (
        <div className="px-3 pb-2">
          <button
            onClick={() => void reveal(faction.id)}
            disabled={locked}
            className="w-full rounded bg-red-900/50 px-3 py-1.5 text-xs text-red-200 hover:bg-red-900/70 disabled:opacity-50"
          >
            ⚠️ Expose this faction
          </button>
        </div>
      )}

      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-zinc-500">Broadcast to faction</div>
      {locked && <Note>Switch to Operator to broadcast.</Note>}
      <div className={locked ? 'pointer-events-none flex items-center gap-2 px-3 pb-2 opacity-50' : 'flex items-center gap-2 px-3 pb-2'}>
        <input
          className={inputCls}
          value={cue}
          placeholder="cue (e.g. rally)"
          onChange={(e) => setCue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && cue.trim() && void broadcast(`faction(${faction.id})`, cue.trim())}
        />
        <button
          onClick={() => cue.trim() && void broadcast(`faction(${faction.id})`, cue.trim())}
          className="shrink-0 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
        >
          Send
        </button>
      </div>

      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-zinc-500">Members</div>
      <div className="flex flex-col px-1 pb-4">
        {faction.members.length === 0 && <div className="px-2 py-1 text-xs text-zinc-600">No members.</div>}
        {faction.members.map((gid) => (
          <button
            key={gid}
            onClick={() => select({ kind: SelectionKind.Guest, id: gid })}
            className="rounded px-2 py-1 text-left text-sm text-zinc-300 hover:bg-zinc-800"
          >
            {nameOf(gid)}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Location inspector
// ---------------------------------------------------------------------------

function LocationInspector({ id }: { id: string }) {
  const location = useCockpit((s) => s.locations.find((l) => l.id === id))
  const roster = useCockpit((s) => s.roster)
  const locked = useCockpit((s) => s.lens !== null)
  const broadcast = useCockpit((s) => s.broadcast)
  const select = useCockpit((s) => s.select)
  const [cue, setCue] = useState('')

  if (!location) return <Empty msg="This location is no longer in the world." />
  const nameOf = (gid: string) => roster.find((r) => r.id === gid)?.name ?? gid

  return (
    <div className="h-full overflow-auto">
      <div className="border-b border-zinc-800 px-3 py-2">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500">Location</div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-100">{location.label || location.id}</span>
          {location.prison && <span className="text-xs text-red-400">prison</span>}
        </div>
        <div className="text-[10px] text-zinc-600">{location.id}</div>
      </div>

      <div className="px-3 py-1 text-xs text-zinc-500">{location.occupants.length} here</div>

      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-zinc-500">Broadcast to location</div>
      {locked && <Note>Switch to Operator to broadcast.</Note>}
      <div className={locked ? 'pointer-events-none flex items-center gap-2 px-3 pb-2 opacity-50' : 'flex items-center gap-2 px-3 pb-2'}>
        <input
          className={inputCls}
          value={cue}
          placeholder="cue (e.g. lights_out)"
          onChange={(e) => setCue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && cue.trim() && void broadcast(`location(${location.id})`, cue.trim())}
        />
        <button
          onClick={() => cue.trim() && void broadcast(`location(${location.id})`, cue.trim())}
          className="shrink-0 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
        >
          Send
        </button>
      </div>

      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-zinc-500">Occupants</div>
      <div className="flex flex-col px-1 pb-4">
        {location.occupants.length === 0 && <div className="px-2 py-1 text-xs text-zinc-600">Empty.</div>}
        {location.occupants.map((gid) => (
          <button
            key={gid}
            onClick={() => select({ kind: SelectionKind.Guest, id: gid })}
            className="rounded px-2 py-1 text-left text-sm text-zinc-300 hover:bg-zinc-800"
          >
            {nameOf(gid)}
          </button>
        ))}
      </div>
    </div>
  )
}

function Empty({ msg }: { msg: string }) {
  return <div className="grid h-full place-items-center px-4 text-center text-xs text-zinc-600">{msg}</div>
}

export function CockpitInspector() {
  const selection = useCockpit((s) => s.selection)
  return (
    <div className="h-full w-full bg-zinc-950 text-zinc-100">
      {selection === null ? (
        <Empty msg="Select a guest, cast member, faction, or location to inspect and edit it." />
      ) : selection.kind === SelectionKind.Guest ? (
        <GuestInspector key={selection.id} id={selection.id} />
      ) : selection.kind === SelectionKind.Character ? (
        <CharacterInspector key={selection.id} id={selection.id} />
      ) : selection.kind === SelectionKind.Faction ? (
        <FactionInspector key={selection.id} id={selection.id} />
      ) : (
        <LocationInspector key={selection.id} id={selection.id} />
      )}
    </div>
  )
}

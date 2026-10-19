//! The cockpit's right tray: the Inspector. Bound to the Roster/World
//! selection, it's where the director changes a guest's stats on the fly
//! (score / faction / location / captured / restricted), fires narrative at one
//! person, answers a pending choice, or — for a cast member — fires that
//! character's owned beats. It is also the super-admin's peek: **Their
//! view** (what that participant's own screen says right now) and **Their
//! feed** (every message they have seen — hidden ones greyed — or, for a
//! character, every line they spoke and every scan readout they got), with
//! one button to *be* them. Under a non-Operator lens the editors are
//! closed: you are a participant right now, not the director.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CockpitTab, isPersonaId, PlayerRole, RunBackend, RunMode, SelectionKind, useCockpit, type CockpitMessage, type QuestAction } from '@/store/cockpit'
import { useGraph } from '@/store/graph'
import { confirmAction, notify, promptText } from '@/store/dialog'
import { FactionPill } from './ui'
import { PartPresence, castPresence, partPresence } from './parts'
import { entityVars, GUEST_STANDARD_FIELDS } from './world'
import {
  codexGrantOptions,
  codexHeldCount,
  codexOptionLabel,
  QUEST_ACTION_LABEL,
  questActionNeedsText,
  questRows,
  questStatusLabel,
} from './grants'
import { VarTable } from './VarTable'
import { usePlayAs } from './play-as'
import { qrSvg } from '@/lib/print-sheet'
import { GlanceTray } from './director/Glance.tsx'
import { useGlanceInTray } from './director/tray'
import { useDirectorMode } from './director/director-mode'
import { DirectorMode } from './director/director-keys'
import { useNow } from './director/clock'
import { isGone, isPersonaRow, seenLine } from './guests'

/** How many recent messages "Their feed" shows. */
const FEED_LIMIT = 60

/** N-02: a lost guest's way back in — a fresh session for the SAME guest
 *  (codex, quests, score intact; no ghost), shown as a QR their new phone
 *  scans (`?code=<event>&pair=<code>`). The code works once, for ten
 *  minutes; the panel only lives while it is open, and Done forgets it. */
function RePair({ id, name }: { id: string; name: string }) {
  const pairGuest = useCockpit((s) => s.pairGuest)
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [revoked, setRevoked] = useState(false)
  const mint = async (revokeOthers = false) => {
    setBusy(true)
    try {
      const r = await pairGuest(id, revokeOthers ? { revokeOthers: true } : undefined)
      if (r !== null) {
        setLink(r.url)
        setRevoked(revokeOthers)
      }
    } finally {
      setBusy(false)
    }
  }
  if (link === null) {
    return (
      <button
        onClick={() => void mint()}
        disabled={busy}
        className="rounded border border-amber-900 px-2 py-0.5 text-[10px] text-amber-300 hover:bg-amber-950 disabled:opacity-50"
        title={`${name} lost their phone or browser? Show a QR that signs a phone back in as ${name}`}
        data-testid={`inspector-repair-${id}`}
      >
        🔁 Re-pair
      </button>
    )
  }
  return (
    <div className="mt-2 w-full rounded border border-amber-900/70 bg-amber-950/20 p-2 text-center" data-testid={`inspector-repair-qr-${id}`}>
      <p className="mb-1 text-[11px] text-amber-200">Have {name} scan this with their phone's camera.</p>
      <LocalQr text={link} label={`Re-pair QR for ${name}`} />
      <p className="mt-1 text-[10px] text-zinc-500">It signs one phone in as {name}, once, within 10 minutes — keep it off the big screen.</p>
      <div className="mt-1 flex justify-center gap-2">
        <button
          onClick={() => void navigator.clipboard?.writeText(link)}
          className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800"
        >
          Copy link
        </button>
        <button onClick={() => void mint()} disabled={busy} className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800">
          New code
        </button>
        <button
          onClick={() => void mint(true)}
          disabled={busy || revoked}
          className="rounded border border-red-900 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-950 disabled:opacity-50"
          title={`Someone else has ${name}'s old phone? Sign every other phone out of ${name} (a fresh code replaces this one)`}
          data-testid={`inspector-repair-revoke-${id}`}
        >
          {revoked ? 'Old phones signed out' : 'Sign out old phones'}
        </button>
        <button onClick={() => setLink(null)} className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800">
          Done
        </button>
      </div>
    </div>
  )
}

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

/** S4: hand this guest a codex entry they don't hold yet — what a found
 *  clue, a solved puzzle or a performer's say-so would have unlocked. */
function CodexGrant({ id, name }: { id: string; name: string }) {
  const codex = useCockpit((s) => s.codex)
  const grantCodex = useCockpit((s) => s.grantCodex)
  const [entry, setEntry] = useState('')
  const options = useMemo(() => codexGrantOptions(codex, id), [codex, id])
  if (codex.length === 0) return null
  const held = codexHeldCount(codex, id)
  // A grant that just landed drops out of the options — clear the pick.
  const picked = options.some((e) => e.id === entry) ? entry : ''
  return (
    <div data-testid={`inspector-codex-${id}`}>
      <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-zinc-500">
        Codex · {held}/{codex.length} held
      </div>
      {options.length === 0 ? (
        <Note>{name} holds every entry.</Note>
      ) : (
        <div className="flex items-center gap-2 px-3 pb-2">
          <select className={inputCls} value={picked} onChange={(e) => setEntry(e.target.value)} data-testid={`inspector-codex-pick-${id}`}>
            <option value="">— grant codex entry… —</option>
            {options.map((e) => (
              <option key={e.id} value={e.id}>
                {codexOptionLabel(e)}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              if (picked === '') return
              setEntry('')
              void grantCodex(id, picked)
            }}
            disabled={picked === ''}
            className="shrink-0 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
            title={`Unlock it for ${name}: it lands in their Codex room and fires their “learns” rules`}
            data-testid={`inspector-codex-grant-${id}`}
          >
            Grant
          </button>
        </div>
      )}
    </div>
  )
}

/** S4: every declared quest and where it stands for this guest, with the
 *  steps that would do something (start one they haven't got; update,
 *  complete or fail an active one). Each step asks for the line their
 *  quest thread shows — required for an update, optional otherwise. */
function QuestSteps({ id, name }: { id: string; name: string }) {
  const quests = useCockpit((s) => s.quests)
  const stepQuest = useCockpit((s) => s.stepQuest)
  const rows = useMemo(() => questRows(quests, id), [quests, id])
  if (rows.length === 0) return null
  const step = async (quest: string, title: string, action: QuestAction) => {
    const needs = questActionNeedsText(action)
    const text = await promptText({
      title: `${QUEST_ACTION_LABEL[action].replace('…', '')} “${title}” for ${name}`,
      body: needs ? 'The line their Quest Log thread shows.' : 'A line for their Quest Log thread (optional).',
      placeholder: needs ? 'One down, two to go.' : 'Leave blank for none',
      confirmLabel: QUEST_ACTION_LABEL[action].replace('…', ''),
      allowEmpty: !needs,
    })
    if (text === null) return
    await stepQuest(id, quest, action, text === '' ? null : text)
  }
  return (
    <div data-testid={`inspector-quests-${id}`}>
      <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-zinc-500">Quests</div>
      <ul className="mx-3 mb-1 flex flex-col gap-0.5 rounded border border-zinc-800 p-1 text-xs">
        {rows.map((q) => (
          <li key={q.id} className="flex items-center gap-2 px-1 py-0.5" data-testid={`inspector-quest-${q.id}`}>
            <span className="min-w-0 flex-1 truncate text-zinc-200" title={q.giver ? `${q.title} — from ${q.giver}` : q.title}>
              {q.title}
            </span>
            <span
              className={
                q.status === 'active' ? 'text-amber-300'
                : q.status === 'done' ? 'text-emerald-400'
                : q.status === 'failed' ? 'text-red-400'
                : 'text-zinc-600'
              }
            >
              {questStatusLabel(q.status)}
            </span>
            {q.actions.map((a) => (
              <button
                key={a}
                onClick={() => void step(q.id, q.title, a)}
                className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800"
                data-testid={`inspector-quest-${a}-${q.id}`}
              >
                {QUEST_ACTION_LABEL[a]}
              </button>
            ))}
          </li>
        ))}
      </ul>
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
  const server = useCockpit((s) => s.run?.backend === RunBackend.Server)
  const live = useCockpit((s) => s.run?.mode === RunMode.Live)
  const playAs = usePlayAs()
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
  const world = useCockpit((s) => s.world)
  const markGone = useCockpit((s) => s.markGone)
  const now = useNow(row?.lastSeen !== undefined, 30_000)

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

  // A bare `restrict` (no place list) / `unrestrict`: only the story's
  // `restricted` / `unrestricted` rules run. It is NOT the story's own mark
  // (a show's mark event may set flags and pins this never touches) — that
  // is fired under "Fire on this guest". On a real guest at a live show, ask
  // first.
  const toggleMark = async () => {
    const next = !row.restricted
    if (live && !isPersonaId(id)) {
      const ok = await confirmAction({
        title: next ? `Restrict ${row.name}?` : `Unrestrict ${row.name}?`,
        body: next
          ? `${row.name}'s phone goes read-only: no buttons, only their DMs (no places). Only the story's "restricted" rules run — this is not the story's own mark (no pins, no flags); fire the story's mark event below for that.`
          : `${row.name} gets their full phone back. Only the story's "unrestricted" rules run — this is not the story's own unmark (its pins and flags stay); fire the story's unmark event below for that.`,
        confirmLabel: next ? 'Restrict' : 'Unrestrict',
        danger: next,
      })
      if (!ok) return
    }
    await setStat(id, 'restricted', next)
  }

  const gone = isGone(world, id)
  const persona = isPersonaRow(row, world)
  const seen = seenLine(row, persona, now)

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
          {row.owner ? (row.owner === me ? 'Your persona' : `${row.owner}'s persona`) : persona ? 'Persona' : 'Guest'}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-100">{row.name}</span>
          {persona && (
            <span className="rounded bg-violet-500/20 px-1 text-[9px] uppercase tracking-wide text-violet-300" title="A Run persona, not a real guest" data-testid="inspector-persona">
              persona
            </span>
          )}
          {gone && (
            <span className="text-xs text-zinc-400" title="A director marked them gone home" data-testid="inspector-gone">
              👋 went home
            </span>
          )}
          {row.captured && <span className="text-xs text-red-400">🔒 captured</span>}
          {row.restricted && <span className="text-xs text-red-400" title="restricted">⛔ restricted</span>}
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
          {server && (
            <button
              onClick={() => void playAs(PlayerRole.Guest, id, row.name)}
              className="rounded border border-emerald-900 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-950"
              title={`Open ${row.name}'s own play app on the Players page`}
              data-testid={`inspector-play-${id}`}
            >
              ▶ Play
            </button>
          )}
        </div>
        <div className="text-[10px] text-zinc-600">
          {row.id}
          {seen !== null && (
            <span className={row.online === true ? 'text-emerald-500' : undefined} title={typeof row.lastSeen === 'number' ? new Date(row.lastSeen).toLocaleTimeString() : undefined} data-testid="inspector-seen">
              {' · '}
              {seen}
            </span>
          )}
        </div>
        {server && !row.owner && (
          <div className="mt-1 flex flex-wrap">
            <RePair id={id} name={row.name} />
          </div>
        )}
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

        <Field label="Restricted">
          <button
            onClick={() => void toggleMark()}
            className={
              row.restricted
                ? 'rounded bg-emerald-700/40 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-700/60'
                : 'rounded bg-amber-700/40 px-3 py-1 text-xs text-amber-300 hover:bg-amber-700/60'
            }
            data-testid={`inspector-mark-${id}`}
          >
            {row.restricted ? 'Unrestrict' : 'Restrict'}
          </button>
        </Field>

        <Field label="Went home">
          <button
            onClick={() => void markGone(id, !gone)}
            className={
              gone
                ? 'rounded bg-emerald-700/40 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-700/60'
                : 'rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-700'
            }
            title={gone ? `${row.name} is back: count them again` : `${row.name} went home: the story can leave them out of its counts (a majority)`}
            data-testid={`inspector-gone-${id}`}
          >
            {gone ? 'Back' : '👋 Went home'}
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

      <CodexGrant id={id} name={row.name} />
      <QuestSteps id={id} name={row.name} />

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
  const server = useCockpit((s) => s.run?.backend === RunBackend.Server)
  const playAs = usePlayAs()
  const beats = useCockpit((s) => s.beats)
  const locked = useCockpit((s) => s.lens !== null)
  const fireBeat = useCockpit((s) => s.fireBeat)
  const releasePart = useCockpit((s) => s.releasePart)
  const setPerspective = useCockpit((s) => s.setPerspective)
  const setTab = useCockpit((s) => s.setTab)

  // N-10: a performer's phone died — free the part so they can re-sign on a
  // loaner (the prime code + the cast picker). Their threads stay.
  const release = async () => {
    const ok = await confirmAction({
      title: `Release ${id}?`,
      body: `Signs out whichever booth is ${id} right now, so the performer can sign in again on another phone. ${id}'s threads and buttons stay.`,
      confirmLabel: 'Release',
      danger: true,
    })
    if (!ok) return
    const n = await releasePart(id)
    if (n === null) return
    await notify({
      title: n > 0 ? `${id} is free` : `Nobody held ${id}`,
      body: n > 0 ? `The performer can sign in again with the performer code and pick ${id}.` : `${id} was already free to sign in to.`,
    })
  }

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
          {server && (
            <button
              onClick={() => void playAs(PlayerRole.Performer, id, id)}
              className="rounded border border-emerald-900 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-950"
              title={`Open ${id}'s performer booth on the Players page`}
              data-testid={`inspector-play-${id}`}
            >
              ▶ Play
            </button>
          )}
        </div>
      </div>

      {member !== undefined && member.agent !== true && partPresence(member) === PartPresence.Online && <Note>A performer is signed in as {id} right now.</Note>}
      {member !== undefined && member.agent !== true && partPresence(member) === PartPresence.PhoneOffline && (
        <Note>Signed in as {id}, but the phone is offline (asleep, off the Wi-Fi, or lost). Lost? ⏏ Release frees the part for a loaner.</Note>
      )}
      {member !== undefined && castPresence(member, false) === PartPresence.Voiced && <Note>A stagehand worker is voicing {id} right now.</Note>}
      {member !== undefined && castPresence(member, false) === PartPresence.Unvoiced && (
        <Note>No worker is voicing {id}: its hold: line (if it has one) answers, and a director can reply as {id} from Chat.</Note>
      )}
      {server && (
        <div className="px-3 pt-2">
          <button
            onClick={() => void release()}
            className="rounded border border-red-900 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-950"
            title={`Performer lost their phone? Free ${id} so they can sign in again on a loaner`}
            data-testid={`inspector-release-${id}`}
          >
            ⏏ Release {id}
          </button>
        </div>
      )}
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
  const select = useCockpit((s) => s.select)
  const onDirector = useCockpit((s) => s.activeTab === CockpitTab.Director)
  // On the Director page an empty tray holds the house at a glance (Calling
  // only: Watching shows it on the page, so the tray stays the Inspector's).
  const glance = useGlanceInTray()
  const [directorMode] = useDirectorMode()
  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100">
      {onDirector && selection !== null && directorMode !== DirectorMode.Watching && (
        <button onClick={() => select(null)} className="shrink-0 border-b border-zinc-800 px-3 py-1 text-left text-[11px] text-zinc-500 hover:text-zinc-200" data-testid="inspector-to-glance">
          ← the house at a glance
        </button>
      )}
      <div className="min-h-0 flex-1">
      {glance ? (
        <GlanceTray />
      ) : selection === null ? (
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
    </div>
  )
}

/** A QR drawn in the browser (`qrcode` → SVG) — the re-pair link carries a
 *  sign-in token, so it never goes to the server's `/api/qr` in a GET (and
 *  its access log). */
function LocalQr({ text, label }: { text: string; label: string }) {
  const [drawn, setDrawn] = useState<{ text: string; svg: string } | null>(null)
  useEffect(() => {
    let live = true
    void qrSvg(text).then((svg) => {
      if (live) setDrawn({ text, svg })
    })
    return () => {
      live = false
    }
  }, [text])
  const svg = drawn !== null && drawn.text === text ? drawn.svg : null
  return (
    <div
      role="img"
      aria-label={label}
      className="mx-auto block h-40 w-40 rounded bg-white p-1 [&>svg]:h-full [&>svg]:w-full"
      dangerouslySetInnerHTML={{ __html: svg ?? '' }}
    />
  )
}

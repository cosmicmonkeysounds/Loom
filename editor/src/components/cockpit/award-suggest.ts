//! The ceremony's award suggestions (W-24, the Oct 31 cut): each award cue
//! on the cue sheet mapped to its K-26 recap list, so the director reads a
//! winner off `GET /e/:id/api/mod/recap` instead of cross-checking the text
//! tab by hand. Suggestions only: the cue sheet pre-fills an *empty* winner
//! picker and value box and never touches what the director chose.
//!
//! Rehearsal personas are skipped, ties at the top (or the bottom, for
//! Least Trusted) are all listed, and a count award with nobody above 0
//! suggests no one.

/** The slice of the recap (`core/server/recap.ts` `Recap`) the sheet reads. */
export interface RecapRowWire {
  id: string
  name: string
  value: number
  persona: boolean
}

export interface RecapDuckRowWire {
  id: string
  name: string
  ms: number
  time: string
  persona: boolean
}

export interface RecapWire {
  ending: string | null
  lists: Partial<Record<RecapListName, RecapRowWire[]>>
  duck?: RecapDuckRowWire[]
  text: string
}

export type RecapListName = 'trust' | 'truths' | 'lies' | 'internetVisits' | 'codex' | 'quests' | 'truthcoin'

/** Which end of a list wins, and whether 0 can win at all. */
interface AwardSource {
  list: RecapListName | 'duck'
  end: 'top' | 'bottom'
  /** A count (lies, trips, entries…): nobody wins with 0. */
  count: boolean
}

/** Each award cue (`main.loom` `INTERACTION award_*`) and its recap list. */
export const AWARD_SOURCES: Readonly<Record<string, AwardSource>> = {
  award_most_trusted: { list: 'trust', end: 'top', count: false },
  award_least_trusted: { list: 'trust', end: 'bottom', count: false },
  award_frequent_flyer: { list: 'internetVisits', end: 'top', count: true },
  award_lore_hoarder: { list: 'codex', end: 'top', count: true },
  award_truthcoin_tycoon: { list: 'truthcoin', end: 'top', count: true },
  award_best_liar: { list: 'lies', end: 'top', count: true },
  award_duck_speedrun: { list: 'duck', end: 'top', count: false },
  award_quest_completionist: { list: 'quests', end: 'top', count: true },
}

export interface AwardSuggestion {
  /** The suggested winner (the first of any tie, in the recap's order). */
  id: string
  name: string
  /** What the value box gets: the number, or the duck's `m:ss`. */
  value: string
  /** Everyone else tied with the winner. */
  ties: Array<{ id: string; name: string }>
}

/** The suggestion for one award cue, or null (not an award, nobody
 *  qualifies, or the list is missing). */
export function awardSuggestion(cueId: string, recap: RecapWire | null): AwardSuggestion | null {
  const src = AWARD_SOURCES[cueId]
  if (src === undefined || recap === null) return null
  if (src.list === 'duck') {
    // The duck board is fastest first; ties share the same ms.
    const rows = (recap.duck ?? []).filter((r) => !r.persona)
    const best = rows[0]
    if (best === undefined) return null
    const tied = rows.filter((r) => r.ms === best.ms)
    return { id: best.id, name: best.name, value: best.time, ties: tied.slice(1).map(({ id, name }) => ({ id, name })) }
  }
  // Lists are high → low (ties by name); re-rank without the personas.
  const rows = (recap.lists[src.list] ?? []).filter((r) => !r.persona)
  if (rows.length === 0) return null
  const edge = src.end === 'top' ? rows[0]!.value : rows[rows.length - 1]!.value
  if (src.count && edge <= 0) return null
  const tied = rows.filter((r) => r.value === edge)
  const [first, ...rest] = tied
  return { id: first!.id, name: first!.name, value: String(first!.value), ties: rest.map(({ id, name }) => ({ id, name })) }
}

/** `suggested: Ada (82) · tied: Bob, Cy` — the row's hint. */
export function suggestionHint(s: AwardSuggestion): string {
  const tie = s.ties.length > 0 ? ` · tied: ${s.ties.map((t) => t.name).join(', ')}` : ''
  return `suggested: ${s.name} (${s.value})${tie}`
}

/** What the sheet has in its winner pickers / value boxes, plus what it
 *  filled in itself (so a refresh may replace its own guess, never the
 *  director's). */
export interface AwardFields {
  winners: Record<string, string>
  values: Record<string, string>
  /** Per cue, the winner / value the sheet last filled. */
  auto: Record<string, { winner: string; value: string }>
}

/** Fill each award row from its suggestion where the field is empty or still
 *  holds the sheet's own earlier guess. A winner the director picked keeps
 *  its value box untouched too (the suggested number is someone else's). A
 *  winner not on the roster is not filled (the picker can't show it). */
export function fillAwards(
  fields: AwardFields,
  suggestions: Record<string, AwardSuggestion | null>,
  roster: ReadonlySet<string>,
): AwardFields {
  const winners = { ...fields.winners }
  const values = { ...fields.values }
  const auto = { ...fields.auto }
  for (const [cue, s] of Object.entries(suggestions)) {
    if (s === null || !roster.has(s.id)) continue
    const was = auto[cue]
    const w = winners[cue] ?? ''
    const v = values[cue] ?? ''
    const winnerOurs = w === '' || (was !== undefined && w === was.winner)
    if (!winnerOurs) continue
    const valueOurs = v === '' || (was !== undefined && v === was.value)
    winners[cue] = s.id
    if (valueOurs) values[cue] = s.value
    auto[cue] = { winner: s.id, value: valueOurs ? s.value : (was?.value ?? '') }
  }
  return { winners, values, auto }
}

/** The director picks a winner: the row is theirs from now on (`auto`
 *  dropped), and a value box still holding the sheet's suggested number is
 *  cleared — that number was the suggested winner's, not this person's. */
export function pickWinner(fields: AwardFields, cue: string, winner: string): AwardFields {
  const winners = { ...fields.winners, [cue]: winner }
  const values = { ...fields.values }
  const auto = { ...fields.auto }
  const was = auto[cue]
  if (was !== undefined) {
    if (winner !== was.winner && (values[cue] ?? '') === was.value) delete values[cue]
    if (winner !== was.winner) delete auto[cue]
  }
  return { winners, values, auto }
}

/** The story's `Night.ended` is true (the sheet then fetches the recap). */
export function nightEnded(world: Array<{ path: string; value: string }>): boolean {
  return world.find((w) => w.path === 'Night.ended')?.value.trim() === 'true'
}

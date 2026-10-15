//! The Inspector's codex + quest grants (OCT31 S4), as pure logic: which
//! codex entries a holder could still be handed, and where each declared
//! quest stands for one guest with the steps a director may take on it.
//! The steps mirror the engine's own rule (`Sim.stepQuest`): `start` only a
//! quest they haven't been handed, `update` / `complete` / `fail` only an
//! active one; a settled quest takes nothing.

import type { CodexSummary, QuestSummary } from '@loom/core/views'
import { QuestAction } from '@/store/cockpit'

/** The codex entries `holder` doesn't hold yet, in declared order. */
export function codexGrantOptions(codex: readonly CodexSummary[], holder: string): CodexSummary[] {
  return codex.filter((e) => !e.holders.includes(holder))
}

/** How many declared entries `holder` already holds. */
export function codexHeldCount(codex: readonly CodexSummary[], holder: string): number {
  return codex.reduce((n, e) => (e.holders.includes(holder) ? n + 1 : n), 0)
}

/** The picker's label for an entry: its title, plus whom it is about. */
export function codexOptionLabel(e: CodexSummary): string {
  return e.about !== null && e.about !== '' ? `${e.title} · about ${e.about}` : e.title
}

export type QuestStatus = QuestSummary['status'][string]

export interface QuestRow {
  id: string
  title: string
  giver: string | null
  /** Where it stands for this guest; null = never handed out. */
  status: QuestStatus | null
  /** The steps that would do something right now. */
  actions: QuestAction[]
}

/** The steps a director can take on a quest in `status`. */
export function questActions(status: QuestStatus | null): QuestAction[] {
  if (status === null) return [QuestAction.Start]
  if (status === 'active') return [QuestAction.Update, QuestAction.Complete, QuestAction.Fail]
  return []
}

/** Every declared quest as one guest's row: handed-out quests first (in
 *  declared order), then the ones they could still be given. */
export function questRows(quests: readonly QuestSummary[], person: string): QuestRow[] {
  const rows = quests.map((q): QuestRow => {
    const status = q.status[person] ?? null
    return { id: q.id, title: q.title, giver: q.giver, status, actions: questActions(status) }
  })
  return [...rows.filter((r) => r.status !== null), ...rows.filter((r) => r.status === null)]
}

/** The status chip's text. */
export function questStatusLabel(status: QuestStatus | null): string {
  switch (status) {
    case 'active':
      return 'active'
    case 'done':
      return '✓ done'
    case 'failed':
      return '✕ failed'
    default:
      return 'not given'
  }
}

/** A step's button text. */
export const QUEST_ACTION_LABEL: Record<QuestAction, string> = {
  [QuestAction.Start]: 'Start',
  [QuestAction.Update]: 'Update…',
  [QuestAction.Complete]: 'Complete',
  [QuestAction.Fail]: 'Fail',
}

/** `update` needs a line (it is a message in the quest's thread); the
 *  other steps take an optional one. */
export function questActionNeedsText(action: QuestAction): boolean {
  return action === QuestAction.Update
}

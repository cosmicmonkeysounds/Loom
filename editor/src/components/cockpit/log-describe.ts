//! The Log page's one-line rendering of a raw `SimEvent`. Pure, so every
//! event kind's line is unit-testable, and exhaustive: the switch ends in a
//! `never` guard, so a new `SimEventType` breaks the build here instead of
//! rendering as its bare type name.

import { SimEventType, type SimEvent } from '@loom/core/sim'

/** The Log's time column: a row's story-clock ms as `mm:ss` (both backends
 *  stamp story time), `—` for a row this console never saw land. */
export function logClock(ts: number | undefined): string {
  if (ts === undefined) return '—'
  const s = Math.floor(ts / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** One-line human rendering of a sim event. */
export function describeEvent(e: SimEvent): string {
  switch (e.type) {
    case SimEventType.AccountCreated:
      return `${e.name} joined as ${e.role} (${e.person})`
    case SimEventType.Joined:
      return `${e.person} joined ${e.faction}`
    case SimEventType.Defected:
      return `${e.person} defected ${e.from ?? 'unaligned'} → ${e.to}`
    case SimEventType.Betrayed:
      return `${e.person} secretly serves ${e.secret}`
    case SimEventType.FactionRevealed:
      return `${e.faction} exposed`
    case SimEventType.Revealed:
      return `${e.target} opened (${e.kind})${e.person ? ` for ${e.person}` : ''}`
    case SimEventType.Scanned:
      return `${e.scanner} scanned ${e.person}`
    case SimEventType.Captured:
      return `${e.person} captured → ${e.location}${e.by ? ` by ${e.by}` : ''}`
    case SimEventType.Released:
      return `${e.person} released from ${e.location}`
    case SimEventType.Escaped:
      return `${e.person} escaped`
    case SimEventType.Arrived:
      return `${e.person} → ${e.location}${e.from ? ` (from ${e.from})` : ''}`
    case SimEventType.Cast:
      return `${e.person} cast as ${e.role}`
    case SimEventType.Promoted:
      return `${e.person} promoted to ${e.role}`
    case SimEventType.WorldSet:
      return `${e.path} = ${e.value}`
    case SimEventType.RelationshipChanged:
      return `${e.subject}.${e.relation}.${e.object} = ${e.value}`
    case SimEventType.Broadcast:
      return `broadcast "${e.cue}" → ${e.scope || 'all'} (${e.audience.length || 'all'})`
    case SimEventType.Dialogue:
      return `${e.speaker}: ${e.text}`
    case SimEventType.Chat:
      return `${e.from} #${e.channel}: ${e.text}`
    case SimEventType.ChannelInvited:
      return `${e.person} invited to ${e.channel} by ${e.by}`
    case SimEventType.ChannelLeft:
      return `${e.person} left ${e.channel}`
    case SimEventType.Action:
      return e.text
    case SimEventType.Directive:
      return `<${e.verb}: ${e.args}>`
    case SimEventType.BeatEntered:
      return `== ${e.beat}`
    case SimEventType.ChoicePrompted:
      return `choice for ${e.person ?? 'story'}: ${e.options.join(' | ')}`
    case SimEventType.Respond:
      return `${e.to} ⇐ ${e.text}`
    case SimEventType.Widget:
      return `show ${e.widget}${e.text ? ` "${e.text}"` : ''} → ${e.scope || 'all'} (${e.audience.length || 'all'})`
    case SimEventType.Signal:
      return `signal "${e.name}"${e.subject ? ` on ${e.subject}` : ''}`
    case SimEventType.CodexUnlocked:
      return `${e.person} learned ${e.entry} (${e.via}${e.from ? ` from ${e.from}` : ''})`
    case SimEventType.CodexMissed:
      return `${e.person} tried the code "${e.code}" — nothing`
    case SimEventType.Quest:
      return `${e.person} quest ${e.quest}: ${e.action}${e.text ? ` — ${e.text}` : ''}`
    case SimEventType.Restricted:
      return `${e.person} restricted${e.places.length ? ` → ${e.places.join(', ')}` : ''}`
    case SimEventType.Unrestricted:
      return `${e.person} unrestricted`
    case SimEventType.Pinned:
      return `pin "${e.text}"${e.channel ? ` in ${e.channel}` : ''}${e.person ? ` for ${e.person}` : ''}`
    case SimEventType.Unpinned:
      return `unpin${e.text ? ` "${e.text}"` : ''}${e.channel ? ` in ${e.channel}` : ''}${e.person ? ` for ${e.person}` : ''}`
    case SimEventType.Wallet: {
      const c = e.card
      return (
        `wallet ${e.to} ${c.kind}/${c.step} ${c.fromName} → ${c.toName} ${c.amount} ${c.unit}` +
        `${c.entryTitle ? ` (${c.entryTitle})` : ''}${c.by ? ` by ${c.by}` : ''}`
      )
    }
    case SimEventType.Ambient:
      return `${e.source}: ${e.text}`
    case SimEventType.Tick:
      return `tick +${e.elapsedMs}ms`
    case SimEventType.Diagnostic:
      return e.message
    default: {
      const unreachable: never = e
      return (unreachable as { type: string }).type
    }
  }
}

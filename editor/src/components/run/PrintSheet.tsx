//! Run → Print (K-12): a full-screen print sheet over the editor — the join
//! poster, the iPhone door sign (worded off `/api/push/config`'s
//! `homescreen`), every codex poster (title + QR + typed code, sorted by
//! fact stack with a coloured band + the pile printed as text), a check-in
//! sign per room, the cast cards (always 8-up business cards, on their
//! own page) and the **Invitations** (wave 11 C5: one claim QR per reserved
//! program, 4-up on their own page, with a screen-only 🔓 that opens a lost
//! one to anyone for two minutes), from `/api/mod/codes`. A digit clue for
//! the door code prints its title + QR only (`DIGIT_CLUE_STACK`). QRs are drawn in the browser
//! (`lib/print-sheet.ts`), so a 60–80 card sheet never hits `/api/qr`'s
//! rate limit. The toolbar (sections, skip a card, cards per page) never
//! prints; `@media print` hides the editor and lays out one card per
//! 1/2/4 of a Letter page. Print-to-PDF from Safari works as-is.

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { modApi } from '@/lib/api'
import { buildPrintItems, PrintKind, qrSvg, stackInk, stackLine, unlockButton, unlockOpenUntil, UnlockPhase, type PerPage, type PrintItem } from '@/lib/print-sheet'
import { useCockpit } from '@/store/cockpit'
import { useNow } from '@/components/cockpit/director/clock'

const SECTION_LABEL: Record<PrintKind, string> = {
  [PrintKind.Join]: 'Join poster',
  [PrintKind.Door]: 'Door sign',
  [PrintKind.Codex]: 'Codex posters',
  [PrintKind.Room]: 'Room check-in signs',
  [PrintKind.Cast]: 'Cast cards',
  [PrintKind.Invite]: 'Invitations',
}

// Plain CSS (not Tailwind) so the print layout doesn't depend on the dark
// app theme or utility purging; scoped under `.loom-print`.
const CSS = `
.loom-print { position: fixed; inset: 0; z-index: 1000; overflow: auto; background: #e4e4e7; color: #000; font-family: -apple-system, system-ui, sans-serif; }
.loom-print-bar { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 8px 16px; background: #18181b; color: #e4e4e7; font-size: 13px; }
.loom-print-bar button, .loom-print-bar select { border: 1px solid #52525b; border-radius: 6px; background: #27272a; color: #e4e4e7; padding: 4px 10px; font-size: 13px; }
.loom-print-bar .primary { background: #4f46e5; border-color: #4f46e5; }
.loom-print-grid { display: grid; gap: 0.25in; padding: 0.25in; justify-content: center; }
.loom-print-card { position: relative; box-sizing: border-box; background: #fff; border: 1px dashed #a1a1aa; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0.3in; break-inside: avoid; page-break-inside: avoid; }
.loom-print-card.skipped { opacity: 0.25; }
.loom-print-card h2 { margin: 0 0 0.08in; font-weight: 800; line-height: 1.1; }
.loom-print-card .hint { margin: 0 0 0.12in; color: #3f3f46; }
.loom-print-card .qr svg { display: block; width: 100%; height: 100%; }
.loom-print-card .code { margin-top: 0.12in; font-family: ui-monospace, Menlo, monospace; font-weight: 700; letter-spacing: 0.12em; }
.loom-print-card .ref { position: absolute; right: 0.15in; bottom: 0.1in; font-size: 9pt; color: #71717a; font-family: ui-monospace, Menlo, monospace; }
.loom-print-card .note, .loom-print-card .skip { position: absolute; left: 0.15in; top: 0.1in; font-size: 10px; color: #b45309; }
.loom-print-card .steps { margin: 0 0 0.12in; padding-left: 1.4em; text-align: left; color: #3f3f46; }
.loom-print-card .band { position: absolute; left: 0; right: 0; top: 0; height: 0.15in; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.loom-print-card .stack { margin-top: 0.08in; font-size: 9pt; color: #3f3f46; font-weight: 600; }
.loom-print-card.banded .note { top: 0.2in; }
.loom-print-card .url { position: absolute; left: 0.15in; right: 0.6in; bottom: 0.1in; font-size: 9px; color: #2563eb; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loom-print-card .skip { left: auto; right: 0.15in; color: #52525b; background: #f4f4f5; border: 1px solid #d4d4d8; border-radius: 4px; padding: 1px 6px; cursor: pointer; }
.loom-print-card .unlock { position: absolute; right: 0.15in; top: 0.4in; font-size: 10px; color: #92400e; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 4px; padding: 1px 6px; cursor: pointer; }
.pp-1 { grid-template-columns: 7.5in; } .pp-1 .loom-print-card { height: 10in; }
.pp-1 h2 { font-size: 40pt; } .pp-1 .hint { font-size: 18pt; } .pp-1 .qr { width: 5.5in; height: 5.5in; } .pp-1 .code { font-size: 30pt; }
.pp-2 { grid-template-columns: 7.5in; } .pp-2 .loom-print-card { height: 4.9in; }
.pp-2 h2 { font-size: 26pt; } .pp-2 .hint { font-size: 13pt; } .pp-2 .qr { width: 2.7in; height: 2.7in; } .pp-2 .code { font-size: 20pt; }
.pp-4 { grid-template-columns: 3.65in 3.65in; } .pp-4 .loom-print-card { height: 4.9in; }
.pp-4 h2 { font-size: 18pt; } .pp-4 .hint, .pp-4 .steps { font-size: 10pt; } .pp-4 .qr { width: 2.6in; height: 2.6in; } .pp-4 .code { font-size: 15pt; }
.pp-1 .steps { font-size: 18pt; } .pp-2 .steps { font-size: 13pt; }
.pp-8 { grid-template-columns: 3.5in 3.5in; gap: 0.2in; }
.pp-8 .loom-print-card { height: 2in; padding: 0.15in; display: grid; grid-template-columns: 1.45in 1fr; grid-auto-rows: min-content; column-gap: 0.12in; align-content: center; justify-items: start; text-align: left; }
.pp-8 .qr { grid-column: 1; grid-row: 1 / span 6; width: 1.45in; height: 1.45in; align-self: center; }
.pp-8 h2, .pp-8 .hint, .pp-8 .steps, .pp-8 .code, .pp-8 .stack { grid-column: 2; }
.pp-8 h2 { font-size: 13pt; } .pp-8 .hint, .pp-8 .steps { font-size: 8pt; margin-bottom: 0.05in; } .pp-8 .code { font-size: 12pt; margin-top: 0.04in; } .pp-8 .stack { font-size: 7pt; }
@media print {
  @page { size: letter; margin: 0.25in; }
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body > *:not(.loom-print) { display: none !important; }
  .loom-print { position: static; overflow: visible; background: #fff; }
  .loom-print-bar, .loom-print-card.skipped, .loom-print-card .note, .loom-print-card .skip, .loom-print-card .unlock, .loom-print-card .url { display: none !important; }
  .loom-print-grid { padding: 0; gap: 0.2in 0.2in; }
  .loom-print-grid + .loom-print-grid { break-before: page; page-break-before: always; }
  .loom-print-card { border-color: #d4d4d8; }
  .pp-2 .loom-print-card, .pp-4 .loom-print-card { height: 5in; }
}
`

/** 🔓 on an invitation (screen only): a lost card's program opens to anyone
 *  for two minutes (`POST /api/mod/claim/unlock`). Tap twice — the sheet
 *  sits above the app's dialogs, so the confirm is the button itself. The
 *  label follows the real window (the cast row's `unlockedUntil`): a
 *  countdown while open, idle again once it closes; tap twice to shut. */
function UnlockClaim({ eventId, character }: { eventId: string; character: string }) {
  const [phase, setPhase] = useState<UnlockPhase>(UnlockPhase.Idle)
  const cast = useCockpit((s) => s.cast)
  const castUntil = cast.find((c) => c.id === character)?.unlockedUntil
  // This console's own answer, kept only until the next snapshot: then the
  // cast row is the truth (a closed or restarted window drops the field).
  const [local, setLocal] = useState<{ until: number | null; cast: unknown } | null>(null)
  const localUntil = local !== null && local.cast === cast ? local.until : null
  const now = useNow(castUntil !== undefined || localUntil !== null, 1000)
  const open = unlockOpenUntil(castUntil, localUntil, now)
  useEffect(() => {
    if (phase !== UnlockPhase.Armed) return
    const t = setTimeout(() => setPhase(UnlockPhase.Idle), 4000)
    return () => clearTimeout(t)
  }, [phase])
  const press = async () => {
    if (phase !== UnlockPhase.Armed) {
      setPhase(UnlockPhase.Armed)
      return
    }
    setPhase(UnlockPhase.Busy)
    try {
      const until = await modApi.claimUnlock(eventId, character, open !== null ? 0 : 2)
      setLocal({ until, cast })
      setPhase(UnlockPhase.Idle)
    } catch {
      setPhase(UnlockPhase.Failed)
    }
  }
  const { label, title } = unlockButton(character, phase, open, now)
  return (
    <button className="unlock" onClick={() => void press()} disabled={phase === UnlockPhase.Busy} title={title} data-testid={`print-unlock-${character}`}>
      {label}
    </button>
  )
}

function Card({ item, svg, skipped, onToggle, eventId }: { item: PrintItem; svg: string | undefined; skipped: boolean; onToggle: () => void; eventId: string }) {
  return (
    <div className={`loom-print-card${skipped ? ' skipped' : ''}${item.stack ? ' banded' : ''}`} data-testid={`print-card-${item.ref}`}>
      {item.stack && <span className="band" style={{ background: stackInk(item.stack.colour) }} />}
      {item.note && <span className="note">{item.note}</span>}
      <button className="skip" onClick={onToggle}>{skipped ? 'include' : 'skip'}</button>
      {item.kind === PrintKind.Invite && item.character !== undefined && <UnlockClaim eventId={eventId} character={item.character} />}
      <h2>{item.title}</h2>
      {item.hint !== '' && <p className="hint">{item.hint}</p>}
      {item.steps && item.steps.length > 0 && (
        <ol className="steps">
          {item.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
      {/* `qrcode`'s own SVG output for our own link — no user markup. */}
      <div className="qr" dangerouslySetInnerHTML={{ __html: svg ?? '' }} />
      {item.code !== '' && <div className="code">{item.code}</div>}
      {item.stack && <div className="stack">{stackLine(item.stack)}</div>}
      <span className="url" title={item.url}>{item.url}</span>
      <span className="ref">{item.ref}</span>
    </div>
  )
}

export function PrintSheet({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const [items, setItems] = useState<PrintItem[] | null>(null)
  const [svgs, setSvgs] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [sections, setSections] = useState<Record<PrintKind, boolean>>({ join: true, door: true, codex: true, room: true, cast: true, invite: true })
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set())
  const [perPage, setPerPage] = useState<PerPage>(4)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // The door sign's wording follows K-31b's switch; an older server
        // (or any failure) prints the plain "Scan to join" sign.
        const [codes, push] = await Promise.all([modApi.codes(eventId), modApi.pushConfig(eventId).catch(() => null)])
        const list = buildPrintItems(codes, { homescreen: push?.homescreen === true })
        if (cancelled) return
        setItems(list)
        const drawn = await Promise.all(list.map(async (i) => [i.ref, await qrSvg(i.url)] as const))
        if (!cancelled) setSvgs(Object.fromEntries(drawn))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [eventId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const shown = useMemo(() => (items ?? []).filter((i) => sections[i.kind]), [items, sections])
  const posters = shown.filter((i) => i.kind !== PrintKind.Cast && i.kind !== PrintKind.Invite)
  const castCards = shown.filter((i) => i.kind === PrintKind.Cast)
  const invites = shown.filter((i) => i.kind === PrintKind.Invite)
  const printing = shown.filter((i) => !skipped.has(i.ref)).length
  const ready = items !== null && shown.every((i) => svgs[i.ref] !== undefined)

  const toggle = (ref: string) =>
    setSkipped((s) => {
      const next = new Set(s)
      if (next.has(ref)) next.delete(ref)
      else next.add(ref)
      return next
    })

  return createPortal(
    <div className="loom-print" data-testid="print-sheet">
      <style>{CSS}</style>
      <div className="loom-print-bar">
        <strong>Print sheet</strong>
        {(Object.keys(SECTION_LABEL) as PrintKind[]).map((k) => (
          <label key={k} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={sections[k]} onChange={(e) => setSections((s) => ({ ...s, [k]: e.target.checked }))} />
            {SECTION_LABEL[k]} ({(items ?? []).filter((i) => i.kind === k).length})
          </label>
        ))}
        <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value) as PerPage)} aria-label="Cards per page">
          <option value={1}>1 per page (poster)</option>
          <option value={2}>2 per page</option>
          <option value={4}>4 per page</option>
          <option value={8}>8 per page (business cards)</option>
        </select>
        <span style={{ color: '#a1a1aa' }}>{printing} cards · Letter</span>
        <span style={{ flex: 1 }} />
        <button className="primary" disabled={!ready} onClick={() => window.print()} data-testid="print-sheet-print">
          {ready ? 'Print…' : 'Drawing QRs…'}
        </button>
        <button onClick={onClose}>Close</button>
      </div>
      {error && <p style={{ padding: 16, color: '#b91c1c' }}>Could not load the codes: {error}</p>}
      {items === null && error === null && <p style={{ padding: 16 }}>Loading…</p>}
      {posters.length > 0 && (
        <div className={`loom-print-grid pp-${perPage}`}>
          {posters.map((i) => (
            <Card key={i.ref} item={i} svg={svgs[i.ref]} skipped={skipped.has(i.ref)} onToggle={() => toggle(i.ref)} eventId={eventId} />
          ))}
        </div>
      )}
      {/* Cast cards are business cards whatever the poster size, on their own page. */}
      {castCards.length > 0 && (
        <div className="loom-print-grid pp-8" data-testid="print-cast-grid">
          {castCards.map((i) => (
            <Card key={i.ref} item={i} svg={svgs[i.ref]} skipped={skipped.has(i.ref)} onToggle={() => toggle(i.ref)} eventId={eventId} />
          ))}
        </div>
      )}
      {/* Invitations: one per reserved program, 4-up, on their own page. */}
      {invites.length > 0 && (
        <div className="loom-print-grid pp-4" data-testid="print-invite-grid">
          {invites.map((i) => (
            <Card key={i.ref} item={i} svg={svgs[i.ref]} skipped={skipped.has(i.ref)} onToggle={() => toggle(i.ref)} eventId={eventId} />
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}

//! Run → Print (K-12, wave 54): a full-screen print sheet over the editor,
//! for Letter paper at 100%. **Badges** are 3 × 2 in, 10 to a sheet: a staff
//! badge per performer part, an invited badge per reserved program (with a
//! screen-only 🔓 that opens a lost one to anyone for two minutes) and the
//! numbered blank badges (`/api/mod/badges`: the director picks the count and
//! the first number; who linked one shows on screen only). **Location cards**
//! are 3 × 2 in too: a check-in card per room, then the story's signs (`qr:`,
//! the show: 🚻 Bathroom Mode), as many copies as there are doors. **Fact
//! cards** print four to a row, 20 to a sheet, by fact stack with a coloured
//! band; a count per stack prints a few, and a digit clue for the door code
//! prints its title + QR only (`DIGIT_CLUE_STACK`). The join poster and the
//! door sign (worded off `/api/push/config`'s `homescreen`) stay posters, off
//! until ticked. QRs are drawn in the browser (`lib/print-sheet.ts`), keyed by
//! link, so a full run never hits `/api/qr`'s rate limit. Sheets are cut here,
//! not by the browser, so every page holds exactly its cards: a skipped card
//! leaves the sheets for the tray at the bottom. The toolbar and the tray
//! never print. Print-to-PDF from Safari or Chrome works as-is.

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { modApi } from '@/lib/api'
import { BADGE_DEFAULT_COUNT, BADGE_KINDS, badgeRange, buildBadgeItems, buildPrintItems, defaultFactCount, factLine, factStacks, limitFacts, LOCATION_KINDS, nextBadgeFrom, printBaseProblem, PrintKind, qrSvg, SHEET_3X2, SHEET_FACTS, sheetsOf, SIGN_DEFAULT_COPIES, stackInk, unlockButton, unlockOpenUntil, UnlockPhase, type PerPage, type PrintBadge, type PrintCodes, type PrintItem } from '@/lib/print-sheet'
import { useCockpit } from '@/store/cockpit'
import { useWorkspace } from '@/store/workspace'
import { useNow } from '@/components/cockpit/director/clock'

const SECTION_LABEL: Record<PrintKind, string> = {
  [PrintKind.Cast]: 'Staff badges',
  [PrintKind.Invite]: 'Invited badges',
  [PrintKind.Badge]: 'Blank badges',
  [PrintKind.Room]: 'Location cards',
  [PrintKind.Sign]: 'Signs',
  [PrintKind.Codex]: 'Fact cards',
  [PrintKind.Join]: 'Join poster',
  [PrintKind.Door]: 'Door sign',
}

// Plain CSS (not Tailwind) so the print layout doesn't depend on the dark
// app theme or utility purging; scoped under `.loom-print`.
const CSS = `
.loom-print { position: fixed; inset: 0; z-index: 1000; overflow: auto; background: #e4e4e7; color: #000; font-family: -apple-system, system-ui, sans-serif; }
.loom-print-bar { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 8px 16px; background: #18181b; color: #e4e4e7; font-size: 13px; }
.loom-print-bar button, .loom-print-bar select { border: 1px solid #52525b; border-radius: 6px; background: #27272a; color: #e4e4e7; padding: 4px 10px; font-size: 13px; }
.loom-print-bar .primary { background: #4f46e5; border-color: #4f46e5; }
.loom-print-bar input[type=number], .loom-print-bar input[type=text] { border: 1px solid #52525b; border-radius: 6px; background: #27272a; color: #e4e4e7; padding: 3px 6px; font-size: 13px; }
.loom-print-bar .row { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; color: #a1a1aa; }
.loom-print-bar .warn { flex-basis: 100%; background: #7f1d1d; color: #fff; border-radius: 6px; padding: 6px 10px; font-weight: 600; }
.loom-print-sheet { position: relative; box-sizing: border-box; width: 8in; height: 10.4in; margin: 0.25in auto; background: #fff; display: grid; justify-content: center; align-content: start; overflow: hidden; }
.loom-print-sheet.s3x2 { grid-template-columns: repeat(2, 3in); grid-auto-rows: 2in; }
.loom-print-sheet.facts { grid-template-columns: repeat(4, 1.95in); grid-auto-rows: 1.95in; }
.loom-print-foot { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; align-items: center; gap: 0.15in; font-size: 7pt; color: #52525b; }
.loom-print-foot .inch { display: inline-block; width: 1in; border-bottom: 1pt solid #52525b; border-left: 1pt solid #52525b; border-right: 1pt solid #52525b; height: 0.06in; }
.loom-print-card { position: relative; box-sizing: border-box; background: #fff; border: 0.25pt solid #a1a1aa; break-inside: avoid; page-break-inside: avoid; }
.loom-print-card .qr { flex: none; }
.loom-print-card .qr svg { display: block; width: 100%; height: 100%; }
.loom-print-card .ref { position: absolute; right: 0.08in; bottom: 0.05in; font-size: 6.5pt; color: #71717a; font-family: ui-monospace, Menlo, monospace; }
.loom-print-card .note { position: absolute; left: 0.1in; top: 0.03in; font-size: 9px; color: #b45309; }
.loom-print-card .skip { position: absolute; right: 0.06in; top: 0.04in; font-size: 10px; color: #52525b; background: #f4f4f5; border: 1px solid #d4d4d8; border-radius: 4px; padding: 0 5px; cursor: pointer; }
.loom-print-card .unlock { position: absolute; right: 0.06in; top: 0.26in; font-size: 10px; color: #92400e; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 4px; padding: 0 5px; cursor: pointer; }
.card32 { display: flex; align-items: center; gap: 0.1in; padding: 0.12in 0.12in 0.12in 0.14in; overflow: hidden; }
.card32 .qr { width: 1.6in; height: 1.6in; }
.card32 .side { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.05in; }
.card32 .eyebrow { font-size: 6.5pt; font-weight: 600; color: #52525b; line-height: 1.15; }
.card32 h2 { margin: 0; font-size: 13pt; font-weight: 800; line-height: 1.08; overflow-wrap: anywhere; }
.card32 .program { font-size: 8pt; font-weight: 600; border-bottom: 0.75pt solid #000; padding-bottom: 0.22in; }
.card32 .code { font-family: ui-monospace, Menlo, monospace; font-size: 8pt; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap; }
.card32 .hint { margin: 0; font-size: 6.5pt; line-height: 1.2; color: #3f3f46; }
.card32 .tier { position: absolute; left: 0; top: 0; bottom: 0; width: 0.07in; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cardfact { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding: 0.11in 0.08in 0.04in; text-align: center; overflow: hidden; }
.cardfact .band { position: absolute; left: 0; right: 0; top: 0; height: 0.07in; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cardfact h2 { flex: none; margin: 0 0 0.02in; font-size: 7.5pt; font-weight: 800; line-height: 1.1; max-height: 3.3em; overflow: hidden; }
.cardfact .qr { width: 1.28in; height: 1.28in; }
.cardfact .code { font-family: ui-monospace, Menlo, monospace; font-size: 6.5pt; font-weight: 700; white-space: nowrap; }
.cardfact .stack { font-size: 5pt; line-height: 1.1; color: #52525b; max-height: 2.2em; overflow: hidden; }
.cardfact .note { display: none; }
.cardfact .ref { right: 0.04in; bottom: 0.02in; font-size: 5pt; }
.loom-print-grid { display: grid; gap: 0.25in; padding: 0.25in; justify-content: center; }
.poster { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0.3in; }
.poster h2 { margin: 0 0 0.08in; font-weight: 800; line-height: 1.1; }
.poster .hint { margin: 0 0 0.12in; color: #3f3f46; }
.poster .code { margin-top: 0.12in; font-family: ui-monospace, Menlo, monospace; font-weight: 700; letter-spacing: 0.12em; }
.poster .steps { margin: 0 0 0.12in; padding-left: 1.4em; text-align: left; color: #3f3f46; }
.pp-1 { grid-template-columns: 7.5in; } .pp-1 .poster { height: 10in; }
.pp-1 h2 { font-size: 40pt; } .pp-1 .hint { font-size: 18pt; } .pp-1 .qr { width: 5.5in; height: 5.5in; } .pp-1 .code { font-size: 30pt; } .pp-1 .steps { font-size: 18pt; }
.pp-2 { grid-template-columns: 7.5in; } .pp-2 .poster { height: 4.9in; }
.pp-2 h2 { font-size: 26pt; } .pp-2 .hint { font-size: 13pt; } .pp-2 .qr { width: 2.7in; height: 2.7in; } .pp-2 .code { font-size: 20pt; } .pp-2 .steps { font-size: 13pt; }
.pp-4 { grid-template-columns: 3.65in 3.65in; } .pp-4 .poster { height: 4.9in; }
.pp-4 h2 { font-size: 18pt; } .pp-4 .hint, .pp-4 .steps { font-size: 10pt; } .pp-4 .qr { width: 2.6in; height: 2.6in; } .pp-4 .code { font-size: 15pt; }
.loom-print-tray { max-width: 8in; margin: 0.25in auto; padding: 8px 10px; background: #fff; border-radius: 6px; font-size: 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; color: #52525b; }
.loom-print-tray button { border: 1px solid #d4d4d8; border-radius: 4px; background: #f4f4f5; padding: 1px 6px; font-size: 11px; cursor: pointer; }
@media print {
  @page { size: letter; margin: 0.25in; }
  html, body { margin: 0 !important; background: #fff !important; height: auto !important; overflow: visible !important; }
  body > *:not(.loom-print) { display: none !important; }
  .loom-print { position: static; overflow: visible; background: #fff; }
  .loom-print-bar, .loom-print-tray, .loom-print-card .note, .loom-print-card .skip, .loom-print-card .unlock { display: none !important; }
  .loom-print-sheet { margin: 0; break-after: page; page-break-after: always; }
  .loom-print-grid { padding: 0; gap: 0.2in 0.2in; }
  .loom-print-sheet:last-child { break-after: auto; page-break-after: auto; }
  .pp-2 .poster, .pp-4 .poster { height: 5in; }
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

/** What every 3 × 2 in card and fact card shares on screen only. */
function CardTools({ item, onSkip, eventId }: { item: PrintItem; onSkip: () => void; eventId: string }) {
  return (
    <>
      {item.note && <span className="note">{item.note}</span>}
      <button className="skip" onClick={onSkip}>skip</button>
      {item.kind === PrintKind.Invite && item.character !== undefined && <UnlockClaim eventId={eventId} character={item.character} />}
    </>
  )
}

/** The tier strip down a badge's edge: who to hand it to, at a glance. */
const TIER_INK: Partial<Record<PrintKind, string>> = { [PrintKind.Cast]: '#111111', [PrintKind.Invite]: '#d4a017' }

/** A 3 × 2 in card: a badge, a room or a sign. */
function Card32({ item, svg, eyebrow, onSkip, eventId }: { item: PrintItem; svg: string | undefined; eyebrow: string; onSkip: () => void; eventId: string }) {
  const tier = TIER_INK[item.kind]
  return (
    <div className="loom-print-card card32" data-testid={`print-card-${item.ref}`} title={item.url}>
      {tier !== undefined && <span className="tier" style={{ background: tier }} />}
      <CardTools item={item} onSkip={onSkip} eventId={eventId} />
      {/* `qrcode`'s own SVG output for our own link — no user markup. */}
      <div className="qr" dangerouslySetInnerHTML={{ __html: svg ?? '' }} />
      <div className="side">
        {eyebrow !== '' && <div className="eyebrow">{eyebrow}</div>}
        {item.kind === PrintKind.Badge ? <div className="program">Program:</div> : <h2>{item.title}</h2>}
        {item.code !== '' && <div className="code">{item.code}</div>}
        {item.hint !== '' && <p className="hint">{item.hint}</p>}
      </div>
      <span className="ref">{item.ref}</span>
    </div>
  )
}

/** A fact card: four to a row. */
function CardFact({ item, svg, onSkip, eventId }: { item: PrintItem; svg: string | undefined; onSkip: () => void; eventId: string }) {
  return (
    <div className="loom-print-card cardfact" data-testid={`print-card-${item.ref}`} title={item.url}>
      {item.stack && <span className="band" style={{ background: stackInk(item.stack.colour) }} />}
      <CardTools item={item} onSkip={onSkip} eventId={eventId} />
      <h2>{item.title}</h2>
      <div className="qr" dangerouslySetInnerHTML={{ __html: svg ?? '' }} />
      {item.code !== '' && <div className="code">{item.code}</div>}
      {item.stack && <div className="stack">{factLine(item.stack)}</div>}
      <span className="ref">{item.ref}</span>
    </div>
  )
}

/** The join poster or the door sign. */
function Poster({ item, svg, onSkip }: { item: PrintItem; svg: string | undefined; onSkip: () => void }) {
  return (
    <div className="loom-print-card poster" data-testid={`print-card-${item.ref}`} title={item.url}>
      <button className="skip" onClick={onSkip}>skip</button>
      <h2>{item.title}</h2>
      {item.hint !== '' && <p className="hint">{item.hint}</p>}
      {item.steps && item.steps.length > 0 && (
        <ol className="steps">
          {item.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
      <div className="qr" dangerouslySetInnerHTML={{ __html: svg ?? '' }} />
      {item.code !== '' && <div className="code">{item.code}</div>}
      <span className="ref">{item.ref}</span>
    </div>
  )
}

/** One run of sheets: each holds exactly `per` cards, with a footer to sort
 *  them by and an inch to check the printer kept the scale. */
function Sheets({ items, per, shape, label, card }: { items: PrintItem[]; per: number; shape: 's3x2' | 'facts'; label: string; card: (i: PrintItem) => React.ReactNode }) {
  const sheets = sheetsOf(items, per)
  return (
    <>
      {sheets.map((sheet, n) => (
        <section key={sheet[0]!.ref} className={`loom-print-sheet ${shape}`} data-testid={`print-sheet-${shape}`}>
          {sheet.map(card)}
          <div className="loom-print-foot">
            <span>{label} · sheet {n + 1} of {sheets.length}</span>
            <span className="inch" aria-hidden />
            <span>this line is 1 inch: print at 100%</span>
          </div>
        </section>
      ))}
    </>
  )
}

export function PrintSheet({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const [codes, setCodes] = useState<PrintCodes | null>(null)
  const [homescreen, setHomescreen] = useState(false)
  const [svgs, setSvgs] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [sections, setSections] = useState<Record<PrintKind, boolean>>({ cast: true, invite: true, badge: true, room: true, sign: true, codex: true, join: false, door: false })
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set())
  const [perPage, setPerPage] = useState<PerPage>(4)
  const projectName = useWorkspace((s) => s.projectName ?? s.root?.name ?? '')
  const [badgeTitle, setBadgeTitle] = useState(projectName)
  // The badge range being edited, and the one applied (fetched).
  const [badgeFrom, setBadgeFrom] = useState(1)
  const [badgeCount, setBadgeCount] = useState(BADGE_DEFAULT_COUNT)
  const [badgeAsk, setBadgeAsk] = useState(() => badgeRange(1, BADGE_DEFAULT_COUNT))
  const [badges, setBadges] = useState<PrintBadge[] | null>(null)
  const [badgeError, setBadgeError] = useState<string | null>(null)
  const [signCopies, setSignCopies] = useState(SIGN_DEFAULT_COPIES)
  // Colour → how many of that fact stack to print; unset is its default.
  const [factCounts, setFactCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // The door sign's wording follows K-31b's switch; an older server
        // (or any failure) prints the plain "Scan to join" sign.
        const [c, push] = await Promise.all([modApi.codes(eventId), modApi.pushConfig(eventId).catch(() => null)])
        if (cancelled) return
        setCodes(c)
        setHomescreen(push?.homescreen === true)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [eventId])

  // The blank badges, fetched once ticked and again for a new range; an
  // older server (no `/api/mod/badges`) says so in the toolbar.
  useEffect(() => {
    if (!sections.badge) return
    let cancelled = false
    void (async () => {
      try {
        const r = await modApi.badges(eventId, badgeAsk.from, badgeAsk.count)
        if (cancelled) return
        setBadges(r.badges)
        setBadgeError(null)
      } catch (e) {
        if (!cancelled) setBadgeError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [eventId, badgeAsk, sections.badge])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const items = useMemo(() => (codes === null ? null : buildPrintItems(codes, { homescreen, signCopies })), [codes, homescreen, signCopies])
  const everything = useMemo(() => [...(items ?? []), ...buildBadgeItems(badges ?? [])], [items, badges])
  const stacks = useMemo(() => factStacks(everything), [everything])

  // QRs are keyed by link: two copies of a sign share one.
  useEffect(() => {
    const missing = [...new Set(everything.map((i) => i.url))].filter((url) => svgs[url] === undefined)
    if (missing.length === 0) return
    let cancelled = false
    void Promise.all(missing.map(async (url) => [url, await qrSvg(url)] as const)).then((drawn) => {
      if (!cancelled) setSvgs((s) => ({ ...s, ...Object.fromEntries(drawn) }))
    })
    return () => {
      cancelled = true
    }
  }, [everything, svgs])

  const shown = useMemo(() => limitFacts(everything, factCounts).filter((i) => sections[i.kind]), [everything, factCounts, sections])
  const printed = shown.filter((i) => !skipped.has(i.ref))
  const ofKinds = (kinds: readonly PrintKind[]) => kinds.flatMap((k) => printed.filter((i) => i.kind === k))
  const badgeCards = ofKinds(BADGE_KINDS)
  const locationCards = ofKinds(LOCATION_KINDS)
  const factCards = ofKinds([PrintKind.Codex])
  const posters = ofKinds([PrintKind.Join, PrintKind.Door])
  const inTray = shown.filter((i) => skipped.has(i.ref))
  const linked = (badges ?? []).filter((b) => b.holder !== null).length
  const ready = items !== null && printed.every((i) => svgs[i.url] !== undefined)
  const baseProblem = codes === null ? null : printBaseProblem(codes.joinUrl)
  const countOf = (k: PrintKind) => (k === PrintKind.Badge ? (badges?.length ?? '–') : k === PrintKind.Codex ? shown.filter((i) => i.kind === k).length : (items ?? []).filter((i) => i.kind === k).length)

  const toggle = (ref: string) =>
    setSkipped((s) => {
      const next = new Set(s)
      if (next.has(ref)) next.delete(ref)
      else next.add(ref)
      return next
    })
  const title = badgeTitle.trim()
  const eyebrowOf = (i: PrintItem): string => {
    if (i.kind === PrintKind.Cast) return title === '' ? 'Staff' : `${title} · Staff`
    if (i.kind === PrintKind.Room) return 'Location'
    return i.kind === PrintKind.Sign ? '' : title
  }
  const card32 = (i: PrintItem) => <Card32 key={i.ref} item={i} svg={svgs[i.url]} eyebrow={eyebrowOf(i)} onSkip={() => toggle(i.ref)} eventId={eventId} />

  return createPortal(
    <div className="loom-print" data-testid="print-sheet">
      <style>{CSS}</style>
      <div className="loom-print-bar">
        <strong>Print sheet</strong>
        {(Object.keys(SECTION_LABEL) as PrintKind[]).map((k) => (
          <label key={k} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={sections[k]} onChange={(e) => setSections((s) => ({ ...s, [k]: e.target.checked }))} />
            {SECTION_LABEL[k]} ({countOf(k)})
          </label>
        ))}
        <span style={{ color: '#a1a1aa' }}>{printed.length} cards · Letter · print at 100%</span>
        <span style={{ flex: 1 }} />
        <button className="primary" disabled={!ready} onClick={() => window.print()} data-testid="print-sheet-print">
          {ready ? 'Print…' : 'Drawing QRs…'}
        </button>
        <button onClick={onClose}>Close</button>
        {baseProblem !== null && <div className="warn" role="alert" data-testid="print-base-problem">{baseProblem}</div>}
        {(sections.cast || sections.invite || sections.badge) && (
          <div className="row" data-testid="print-badge-range">
            <input type="text" value={badgeTitle} onChange={(e) => setBadgeTitle(e.target.value)} placeholder="Title on the badges" aria-label="Title on the badges" style={{ width: 180 }} />
            {sections.badge && (
              <>
                <input type="number" min={1} value={badgeCount} onChange={(e) => setBadgeCount(Number(e.target.value))} aria-label="How many blank badges" style={{ width: 60 }} />
                blank badges from #
                <input type="number" min={1} value={badgeFrom} onChange={(e) => setBadgeFrom(Number(e.target.value))} aria-label="First blank badge number" style={{ width: 60 }} />
                <button onClick={() => setBadgeAsk(badgeRange(badgeFrom, badgeCount))}>Load</button>
                {badges !== null && badges.length > 0 && (
                  <span>
                    {linked} linked · next batch from #{nextBadgeFrom(badges)}
                  </span>
                )}
              </>
            )}
            {badgeError !== null && <span style={{ color: '#fca5a5' }}>blank badges unavailable: {badgeError}</span>}
          </div>
        )}
        {(sections.sign || sections.codex || sections.join || sections.door) && (
          <div className="row">
            {sections.sign && (codes?.actions?.length ?? 0) > 0 && (
              <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                Copies of each sign
                <input type="number" min={1} max={10} value={signCopies} onChange={(e) => setSignCopies(Math.max(1, Math.min(10, Math.floor(Number(e.target.value)) || 1)))} aria-label="Copies of each sign" style={{ width: 50 }} />
              </label>
            )}
            {sections.codex &&
              stacks.map((r) => (
                <label key={r.colour} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: stackInk(r.colour) }} />
                  {r.label}
                  <input
                    type="number"
                    min={0}
                    max={r.total}
                    value={factCounts[r.colour] ?? defaultFactCount(r.colour, r.total)}
                    onChange={(e) => setFactCounts((c) => ({ ...c, [r.colour]: Math.max(0, Math.min(r.total, Math.floor(Number(e.target.value)) || 0)) }))}
                    aria-label={`How many ${r.label} fact cards`}
                    style={{ width: 50 }}
                  />
                  of {r.total}
                </label>
              ))}
            {(sections.join || sections.door) && (
              <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value) as PerPage)} aria-label="Posters per page">
                <option value={1}>1 poster per page</option>
                <option value={2}>2 posters per page</option>
                <option value={4}>4 posters per page</option>
              </select>
            )}
          </div>
        )}
        <div className="row" data-testid="print-lock-note">
          🔒 Every code stays good through Restart, Go live, End → relaunch and new performer + moderator codes. Renaming a part or a reserved program retires its badge.
        </div>
      </div>
      {error && <p style={{ padding: 16, color: '#b91c1c' }}>Could not load the codes: {error}</p>}
      {items === null && error === null && <p style={{ padding: 16 }}>Loading…</p>}
      <Sheets items={badgeCards} per={SHEET_3X2} shape="s3x2" label="Badges" card={card32} />
      <Sheets items={locationCards} per={SHEET_3X2} shape="s3x2" label="Location cards" card={card32} />
      <Sheets items={factCards} per={SHEET_FACTS} shape="facts" label="Fact cards" card={(i) => <CardFact key={i.ref} item={i} svg={svgs[i.url]} onSkip={() => toggle(i.ref)} eventId={eventId} />} />
      {posters.length > 0 && (
        <div className={`loom-print-grid pp-${perPage}`}>
          {posters.map((i) => (
            <Poster key={i.ref} item={i} svg={svgs[i.url]} onSkip={() => toggle(i.ref)} />
          ))}
        </div>
      )}
      {inTray.length > 0 && (
        <div className="loom-print-tray" data-testid="print-skipped">
          Skipped:
          {inTray.map((i) => (
            <button key={i.ref} onClick={() => toggle(i.ref)}>
              {i.ref} {i.title} ↩
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}

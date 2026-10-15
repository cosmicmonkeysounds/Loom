//! Run → Print (K-12): a full-screen print sheet over the editor — the join
//! poster, every codex poster (title + QR + typed code) and a check-in sign
//! per room, from `/api/mod/codes`. QRs are drawn in the browser
//! (`lib/print-sheet.ts`), so a 60–80 card sheet never hits `/api/qr`'s
//! rate limit. The toolbar (sections, skip a card, cards per page) never
//! prints; `@media print` hides the editor and lays out one card per
//! 1/2/4 of a Letter page. Print-to-PDF from Safari works as-is.

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { modApi } from '@/lib/api'
import { buildPrintItems, PrintKind, qrSvg, type PerPage, type PrintItem } from '@/lib/print-sheet'

const SECTION_LABEL: Record<PrintKind, string> = {
  [PrintKind.Join]: 'Join poster',
  [PrintKind.Codex]: 'Codex posters',
  [PrintKind.Room]: 'Room check-in signs',
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
.loom-print-card .url { position: absolute; left: 0.15in; right: 0.6in; bottom: 0.1in; font-size: 9px; color: #2563eb; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loom-print-card .skip { left: auto; right: 0.15in; color: #52525b; background: #f4f4f5; border: 1px solid #d4d4d8; border-radius: 4px; padding: 1px 6px; cursor: pointer; }
.pp-1 { grid-template-columns: 7.5in; } .pp-1 .loom-print-card { height: 10in; }
.pp-1 h2 { font-size: 40pt; } .pp-1 .hint { font-size: 18pt; } .pp-1 .qr { width: 5.5in; height: 5.5in; } .pp-1 .code { font-size: 30pt; }
.pp-2 { grid-template-columns: 7.5in; } .pp-2 .loom-print-card { height: 4.9in; }
.pp-2 h2 { font-size: 26pt; } .pp-2 .hint { font-size: 13pt; } .pp-2 .qr { width: 2.7in; height: 2.7in; } .pp-2 .code { font-size: 20pt; }
.pp-4 { grid-template-columns: 3.65in 3.65in; } .pp-4 .loom-print-card { height: 4.9in; }
.pp-4 h2 { font-size: 18pt; } .pp-4 .hint { font-size: 10pt; } .pp-4 .qr { width: 2.6in; height: 2.6in; } .pp-4 .code { font-size: 15pt; }
@media print {
  @page { size: letter; margin: 0.25in; }
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body > *:not(.loom-print) { display: none !important; }
  .loom-print { position: static; overflow: visible; background: #fff; }
  .loom-print-bar, .loom-print-card.skipped, .loom-print-card .note, .loom-print-card .skip, .loom-print-card .url { display: none !important; }
  .loom-print-grid { padding: 0; gap: 0.2in 0.2in; }
  .loom-print-card { border-color: #d4d4d8; }
  .pp-2 .loom-print-card, .pp-4 .loom-print-card { height: 5in; }
}
`

function Card({ item, svg, skipped, onToggle }: { item: PrintItem; svg: string | undefined; skipped: boolean; onToggle: () => void }) {
  return (
    <div className={`loom-print-card${skipped ? ' skipped' : ''}`} data-testid={`print-card-${item.ref}`}>
      {item.note && <span className="note">{item.note}</span>}
      <button className="skip" onClick={onToggle}>{skipped ? 'include' : 'skip'}</button>
      <h2>{item.title}</h2>
      <p className="hint">{item.hint}</p>
      {/* `qrcode`'s own SVG output for our own link — no user markup. */}
      <div className="qr" dangerouslySetInnerHTML={{ __html: svg ?? '' }} />
      <div className="code">{item.code}</div>
      <span className="url" title={item.url}>{item.url}</span>
      <span className="ref">{item.ref}</span>
    </div>
  )
}

export function PrintSheet({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const [items, setItems] = useState<PrintItem[] | null>(null)
  const [svgs, setSvgs] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [sections, setSections] = useState<Record<PrintKind, boolean>>({ join: true, codex: true, room: true })
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set())
  const [perPage, setPerPage] = useState<PerPage>(4)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = buildPrintItems(await modApi.codes(eventId))
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
      <div className={`loom-print-grid pp-${perPage}`}>
        {shown.map((i) => (
          <Card key={i.ref} item={i} svg={svgs[i.ref]} skipped={skipped.has(i.ref)} onToggle={() => toggle(i.ref)} />
        ))}
      </div>
    </div>,
    document.body,
  )
}

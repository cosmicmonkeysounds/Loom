//! The Win95 block progress bar (wave 18): a sunken trough filled with
//! navy blocks — Mission's checklist (`1 / 2`), the Sides sheet's head
//! counts. `blocksOf` is pure (`test/mission-window.test.tsx`).

/** How many of `cells` blocks a fraction fills (never a sliver: 0 stays 0,
 *  anything above 0 shows at least one). */
export function blocksOf(done: number, total: number, cells = 20): number {
  if (total <= 0 || done <= 0) return 0;
  return Math.max(1, Math.min(cells, Math.round((done / total) * cells)));
}

export function BlockBar({ done, total, label, cells = 20 }: { done: number; total: number; label?: string; cells?: number }) {
  const n = blocksOf(done, total, cells);
  return (
    <div className="block-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label ?? `${done} of ${total}`}>
      <span className="block-bar-trough" aria-hidden>
        {Array.from({ length: cells }, (_, i) => (
          <span key={i} className={i < n ? "block on" : "block"} />
        ))}
      </span>
      {label !== undefined && <span className="block-bar-label">{label}</span>}
    </div>
  );
}

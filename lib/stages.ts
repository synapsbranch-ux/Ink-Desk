// What the studio says while something generates — a pure elapsed-seconds →
// sentence mapping, so nothing on screen ever looks frozen. The provider
// reports no real progress, so the stage lines are timed storytelling; the
// elapsed count beside them is real. Added in slice 5b from the checkpoint
// verdict; see `devpost/prd.md > Look and Feel` (pencil-sketch placeholder).
//
// Shared with the browser, so no Node imports.

export type Stages = readonly (readonly [number, string])[]

/** A panel being inked. Thresholds sit inside the measured 19–22s `low` runs
 *  and leave the tail honest at `medium` and above. */
export const PANEL_STAGES: Stages = [
  [0, 'Sketching the pose…'],
  [8, 'Inking the lines…'],
  [22, 'Adding screentone…'],
  [50, 'Still inking — a dense scene takes longer…'],
  [110, 'Taking its time, but not stuck. Hold on…'],
]

/** Redraw sheet: the DNA is kept, so it goes straight to drawing. */
export const SHEET_STAGES: Stages = [
  [0, 'Sketching front, three-quarter, expressions…'],
  [10, 'Inking the lines…'],
  [24, 'Adding screentone…'],
  [50, 'Still drawing — a model sheet is dense…'],
  [110, 'Taking its time, but not stuck. Hold on…'],
]

/** Draw sheet: Claude writes the visual DNA first, then the picture starts. */
export const SHEET_FRESH_STAGES: Stages = [
  [0, 'Claude is writing the visual DNA…'],
  [8, 'Sketching front, three-quarter, expressions…'],
  [18, 'Inking the lines…'],
  [32, 'Adding screentone…'],
  [58, 'Still drawing — a model sheet is dense…'],
  [110, 'Taking its time, but not stuck. Hold on…'],
]

/** A text wait (synopsis, cast proposal, page script): the caller's own first
 *  line, then honesty about a slow one. */
export function textStages(base: string): Stages {
  return [
    [0, base],
    [15, 'Still thinking…'],
    [40, 'Taking longer than usual, but still working…'],
  ]
}

/** The last stage whose threshold has passed. Total above every threshold. */
export function stageLine(stages: Stages, elapsedSeconds: number): string {
  let line = stages[0][1]
  for (const [at, text] of stages) {
    if (elapsedSeconds >= at) line = text
  }
  return line
}

/** `0:07`, `1:05`, `12:40` — real time, counted beside the storytelling. */
export function formatElapsed(elapsedSeconds: number): string {
  const s = Math.max(0, Math.floor(elapsedSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

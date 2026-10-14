// The edit as data — pure, no Remotion import, so `npm run check:demo-timeline`
// (root) and `prepare.mts` (Node) can run it, and the compositions only ever
// render what it resolved.
//
//   timeline.json  marks written by capture/record.mts as the real app runs
//   cut.ts         the edit: segments of shots, each footage shot a pair of marks
//   narration.md   the learner's script, one section per segment (captions)
//
// resolvePlan(cut, marks) → frames for every shot. Every shot lasts exactly
// its budget, so the beats, the narration's word budgets and the captions all
// agree whatever the capture did. A footage shot between two marks plays at
// real speed when it fits its budget — then holds its last frame for the rest
// — and is time-lapsed (sped up, never slowed, never faked) when it does not.
// A shot whose marks are not in the capture yet is a labelled slate.

export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080
/** The hackathon's rule is "under three minutes". */
export const MAX_SECONDS = 180
/** Narration starts this long after its segment begins. */
export const NARRATION_LEAD_SECONDS = 0.4

/**
 * Marks the recorder writes, in journey order. The edit refers to them by
 * name; the recorder must write exactly these names.
 */
export const MARKS = [
  { name: 'dashboard', when: 'the dashboard is on screen, before anything is clicked' },
  { name: 'project-created', when: 'the studio for the new project has opened on Story' },
  { name: 'scenario-ready', when: 'the scenario is on the desk (sample pasted or typed) and Story is complete' },
  { name: 'library-open', when: 'the Library station is on screen with the cast proposed' },
  { name: 'import-done', when: 'the imported picture is the sheet and its DNA is on the card' },
  { name: 'cast-locked', when: 'both characters carry the Locked stamp' },
  { name: 'director-open', when: 'the Director station is on screen' },
  { name: 'plan-ready', when: 'the chapter plan and its cost estimate are on screen' },
  { name: 'pages-queued', when: 'Generate page / Generate all was clicked' },
  { name: 'page1-inked', when: 'every panel of page 1 has inked in' },
  { name: 'bubble-edited', when: 'a speech bubble was edited on page 1' },
  { name: 'redraw-done', when: "a panel's redraw has inked in" },
  { name: 'chapter-inked', when: 'every planned page and the cover are inked' },
  { name: 'reader-open', when: 'Ink & Publish is on screen with the cover' },
  { name: 'pdf-exported', when: 'the PDF export has finished' },
  { name: 'end', when: 'the last frame worth keeping' },
] as const

export type MarkName = (typeof MARKS)[number]['name']
export type Mark = { name: MarkName; t: number }

/** The money shot's pictures, as paths under video/public. */
export type MoneyShotStills = {
  title: string
  character: { name: string; reference: string; source: 'upload' | 'sheet' }
  panels: { src: string; page: number; panel: number }[]
  cover: string | null
}

/** What capture/record.mts writes to video/timeline.json. */
export type CaptureTimeline = {
  version: 1
  recordedAt: string | null
  /** IMAGE_PANEL_QUALITY the capture ran at — 'low' is a test capture. */
  quality: string | null
  /** Path under video/public, e.g. 'capture/footage.mp4'. */
  footage: string | null
  /** Seconds of footage. */
  duration: number | null
  marks: Mark[]
  stills: MoneyShotStills | null
}

export type Shot =
  | { kind: 'intro'; seconds: number }
  | { kind: 'section'; title: string; kicker: string; seconds: number }
  | { kind: 'footage'; from: MarkName; to: MarkName; seconds: number; label: string }
  | { kind: 'moneyshot'; seconds: number }
  | { kind: 'method'; seconds: number }
  | { kind: 'outro'; seconds: number }

/** One segment of the edit = one section of narration.md (same id). */
export type Segment = { id: string; label: string; shots: Shot[] }

export type ResolvedShot = Shot & {
  startFrame: number
  durationInFrames: number
  /** Footage only. Source frames at FPS; playbackRate ≥ 1. */
  trimBefore?: number
  trimAfter?: number
  playbackRate?: number
  /** Footage only: frames of moving footage; the rest of the shot holds the last one. */
  playFrames?: number
  /** Footage only: seconds of real time this shot covers. */
  realSeconds?: number
  /** Footage only: true when the marks are not in the capture — render a slate. */
  missing?: boolean
}

export type ResolvedSegment = {
  id: string
  label: string
  startFrame: number
  durationInFrames: number
  shots: ResolvedShot[]
}

export type ResolvedPlan = { segments: ResolvedSegment[]; durationInFrames: number; seconds: number }

export class TimelineError extends Error {}

const frames = (seconds: number) => Math.round(seconds * FPS)

/**
 * Marks must be known names, in journey order, at non-decreasing times, each
 * at most once. A capture that broke off early simply has fewer marks.
 */
export function checkMarks(marks: readonly Mark[], duration: number | null): void {
  const order = MARKS.map((m) => m.name as string)
  let lastIndex = -1
  let lastT = -Infinity
  for (const m of marks) {
    const i = order.indexOf(m.name)
    if (i < 0) throw new TimelineError(`Unknown mark "${m.name}".`)
    if (i <= lastIndex) throw new TimelineError(`Mark "${m.name}" is out of journey order or repeated.`)
    if (!Number.isFinite(m.t) || m.t < 0) throw new TimelineError(`Mark "${m.name}" has an invalid time.`)
    if (m.t < lastT) throw new TimelineError(`Mark "${m.name}" is earlier than the mark before it.`)
    if (duration !== null && m.t > duration + 0.5) {
      throw new TimelineError(`Mark "${m.name}" is past the end of the footage.`)
    }
    lastIndex = i
    lastT = m.t
  }
}

export function resolvePlan(cut: readonly Segment[], marks: readonly Mark[], hasFootage: boolean): ResolvedPlan {
  const at = new Map(marks.map((m) => [m.name, m.t]))
  const ids = new Set<string>()
  let cursor = 0
  const segments = cut.map((seg): ResolvedSegment => {
    if (ids.has(seg.id)) throw new TimelineError(`Segment "${seg.id}" appears twice.`)
    ids.add(seg.id)
    if (seg.shots.length === 0) throw new TimelineError(`Segment "${seg.id}" has no shots.`)
    const start = cursor
    const shots = seg.shots.map((shot): ResolvedShot => {
      if (!(shot.seconds > 0)) throw new TimelineError(`A shot in "${seg.id}" has no length.`)
      const budget = frames(shot.seconds)
      if (shot.kind !== 'footage') {
        const r = { ...shot, startFrame: cursor, durationInFrames: budget }
        cursor += budget
        return r
      }
      const from = at.get(shot.from)
      const to = at.get(shot.to)
      if (!hasFootage || from === undefined || to === undefined) {
        const r = { ...shot, startFrame: cursor, durationInFrames: budget, missing: true }
        cursor += budget
        return r
      }
      const real = to - from
      if (!(real > 0)) throw new TimelineError(`Footage "${shot.label}" runs from ${shot.from} to ${shot.to}, which is not forward.`)
      // Time-lapse only when the real span does not fit; never slow motion.
      const playbackRate = Math.max(1, real / shot.seconds)
      const playFrames = Math.min(budget, Math.max(1, Math.round((real / playbackRate) * FPS)))
      const r: ResolvedShot = {
        ...shot,
        startFrame: cursor,
        durationInFrames: budget,
        playFrames,
        trimBefore: frames(from),
        // Rounded up: the closing frame is never before its mark, so a hold
        // shows the moment itself, not the frame before it.
        trimAfter: Math.ceil(to * FPS - 1e-9),
        playbackRate,
        realSeconds: real,
      }
      cursor += budget
      return r
    })
    return { id: seg.id, label: seg.label, startFrame: start, durationInFrames: cursor - start, shots }
  })
  return { segments, durationInFrames: cursor, seconds: cursor / FPS }
}

/** The budgeted length of the edit, before any footage is known. */
export const budgetSeconds = (cut: readonly Segment[]) =>
  cut.reduce((sum, seg) => sum + seg.shots.reduce((s, shot) => s + shot.seconds, 0), 0)

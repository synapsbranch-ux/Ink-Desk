// The edit as data — pure, no Remotion import, so `npm run check:demo-timeline`
// (root) and `prepare.mts` (Node) can run it, and the compositions only ever
// render what it resolved.
//
//   timeline.json  marks written by capture/record.mts as the real app runs
//   cut.ts         the edit: segments of shots, each footage shot a pair of marks
//   narration.md   the learner's script, one section per narrated segment (captions)
//
// resolvePlan(cut, marks) → frames for every shot. Every shot lasts exactly
// its budget, so the beats, the narration's word budgets and the captions all
// agree whatever the capture did. A footage shot between two marks plays at
// real speed when it fits its budget — then holds its last frame for the rest
// — and is time-lapsed (sped up, never slowed, never faked) when it does not,
// landing LANDING_FRAMES early so the closing mark's frame is seen, not only
// cut away from. A shot whose marks are not in the capture yet is a labelled
// slate.
//
// Two captures can feed the same edit (v3): a fresh project generated on
// camera, or a finished chapter walked station by station (`--project`). They
// name some moments differently, so a footage shot may give several marks for
// one end and the first one the capture has is used (`MarkRef`).

export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080
/** The hackathon's rule is "under three minutes". */
export const MAX_SECONDS = 180
/** Narration starts this long after its segment begins. */
export const NARRATION_LEAD_SECONDS = 0.4
/**
 * A time-lapsed shot lands this many frames early and holds its closing
 * mark's frame — the lock, the export done, the redrawn panel — so the moment
 * the shot was cut to is on screen before the next cut or the beat's ink wipe
 * (which covers a beat's last 9 frames), not only in its last frame.
 */
export const LANDING_FRAMES = 18

/**
 * Marks the recorder writes, in journey order. The edit refers to them by
 * name; the recorder must write exactly these names. Two paths share the list
 * (capture/record.mts): a fresh project generated on camera writes the marks
 * noted "fresh", a finished chapter walked with `--project <id>` writes the
 * ones noted "seeded"; the sign-in, dashboard, reader, export and share marks
 * are common. Either path visits the list in this order, skipping the other's.
 */
export const MARKS = [
  { name: 'sign-in', when: 'the sign-in card is on screen, nothing typed yet (a private studio)' },
  { name: 'signed-in', when: 'Sign in was accepted and the desk has appeared' },
  { name: 'dashboard', when: 'the dashboard is on screen with the pointer in view, before anything is clicked' },
  { name: 'project-created', when: 'fresh: the studio for the new project has opened on Story' },
  { name: 'project-open', when: 'seeded: the studio for the finished chapter has opened' },
  { name: 'scenario-ready', when: 'fresh: the scenario is on the desk (sample pasted or typed) and Story is complete' },
  { name: 'scenario-shown', when: 'seeded: the saved scenario has been read on the Story station' },
  { name: 'library-open', when: 'fresh: the Library station is on screen with the cast proposed' },
  { name: 'import-done', when: 'fresh: the imported picture is the sheet and its DNA is on the card' },
  { name: 'cast-locked', when: 'fresh: both characters carry the Locked stamp' },
  { name: 'library-shown', when: 'seeded: both locked cards and the DNA beside the sheet have been shown' },
  { name: 'director-open', when: 'fresh: the Director station is on screen' },
  { name: 'plan-ready', when: 'fresh: the chapter plan and its cost estimate are on screen' },
  { name: 'director-shown', when: 'seeded: the plan and its estimate have been shown on the Director' },
  { name: 'pages-queued', when: 'fresh: Generate page / Generate all was clicked' },
  { name: 'page1-inked', when: 'fresh: every panel of page 1 has inked in' },
  { name: 'pages-shown', when: 'seeded: the Page station is open on page 1 with every panel inked in' },
  { name: 'bubble-edited', when: 'a speech bubble was edited on page 1' },
  { name: 'redraw-done', when: "fresh: a panel's redraw has inked in" },
  { name: 'chapter-inked', when: 'fresh: every planned page and the cover are inked' },
  { name: 'chapter-shown', when: 'seeded: every page of the chapter has been shown inked in' },
  { name: 'reader-open', when: 'Ink & Publish is on screen with the cover' },
  { name: 'pdf-exported', when: 'the PDF export has finished' },
  { name: 'share-link', when: 'the Share dialog shows the public link' },
  { name: 'share-opened', when: 'the public page is on screen in a signed-out window' },
  { name: 'end', when: 'the last frame worth keeping' },
] as const

export type MarkName = (typeof MARKS)[number]['name']
export type Mark = { name: MarkName; t: number }
/** One mark, or several in order of preference: the first the capture has is the one used. */
export type MarkRef = MarkName | readonly MarkName[]

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
  /** Which journey was filmed (v3): a fresh project generated on camera, or a finished chapter walked with --project. Absent on a v2 capture. */
  path?: 'fresh' | 'seeded'
  /** The public share page the capture opened, as its path (`/s/<token>`) — a public link by design; absent before the share beat. */
  share?: string | null
}

export type Shot =
  | { kind: 'intro'; seconds: number }
  | { kind: 'section'; title: string; kicker: string; seconds: number }
  | { kind: 'footage'; from: MarkRef; to: MarkRef; seconds: number; label: string }
  | { kind: 'moneyshot'; seconds: number }
  | { kind: 'method'; seconds: number }
  | { kind: 'learned'; seconds: number }
  | { kind: 'outro'; seconds: number }

/**
 * One segment of the edit = one section of narration.md (same id). A `silent`
 * segment is a title card with no words over it: it has no section, no
 * captions and no voice (the outro).
 */
export type Segment = { id: string; label: string; shots: Shot[]; silent?: true }

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
  /** Footage only: which of the shot's marks the capture had. */
  fromMark?: MarkName
  toMark?: MarkName
  /** Footage only: true when the shot cuts straight in, no fade — it opens its beat (the ink wipe covers that cut) or follows footage. */
  cutIn?: boolean
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

/** The first of a shot's marks that the capture has, with its time. */
export function pickMark(ref: MarkRef, at: ReadonlyMap<string, number>): { name: MarkName; t: number } | null {
  for (const name of typeof ref === 'string' ? [ref] : ref) {
    const t = at.get(name)
    if (t !== undefined) return { name, t }
  }
  return null
}

/** Every mark a shot may use, for checks and messages. */
export const markNames = (ref: MarkRef): readonly MarkName[] => (typeof ref === 'string' ? [ref] : ref)

export function resolvePlan(cut: readonly Segment[], marks: readonly Mark[], hasFootage: boolean): ResolvedPlan {
  const at = new Map(marks.map((m) => [m.name, m.t]))
  const ids = new Set<string>()
  let cursor = 0
  const segments = cut.map((seg): ResolvedSegment => {
    if (ids.has(seg.id)) throw new TimelineError(`Segment "${seg.id}" appears twice.`)
    ids.add(seg.id)
    if (seg.shots.length === 0) throw new TimelineError(`Segment "${seg.id}" has no shots.`)
    const start = cursor
    const shots = seg.shots.map((shot, i): ResolvedShot => {
      if (!(shot.seconds > 0)) throw new TimelineError(`A shot in "${seg.id}" has no length.`)
      const budget = frames(shot.seconds)
      if (shot.kind !== 'footage') {
        const r = { ...shot, startFrame: cursor, durationInFrames: budget }
        cursor += budget
        return r
      }
      // Footage cuts straight in unless a section card is before it. A beat's
      // first cut is already under the ink wipe — a fade there would wash the
      // part the wipe drains off to paper — and after footage the closing
      // frame of the shot before is the point, which a fade would blur. Only
      // footage after a section card fades in, from the card's paper.
      const cutIn = i === 0 || seg.shots[i - 1].kind === 'footage'
      const from = hasFootage ? pickMark(shot.from, at) : null
      const to = hasFootage ? pickMark(shot.to, at) : null
      if (!from || !to) {
        const r = { ...shot, startFrame: cursor, durationInFrames: budget, missing: true, cutIn }
        cursor += budget
        return r
      }
      const real = to.t - from.t
      if (!(real > 0)) throw new TimelineError(`Footage "${shot.label}" runs from ${from.name} to ${to.name}, which is not forward.`)
      // A span that fits plays at real speed and holds its closing frame for
      // the rest. One that does not is time-lapsed — never slow motion — into
      // the budget less the landing, and the landing holds the closing frame.
      const realFrames = Math.max(1, Math.round(real * FPS))
      const fits = realFrames <= budget
      const playFrames = fits ? realFrames : Math.max(1, budget - LANDING_FRAMES)
      const playbackRate = fits ? 1 : realFrames / playFrames
      const r: ResolvedShot = {
        ...shot,
        startFrame: cursor,
        durationInFrames: budget,
        playFrames,
        cutIn,
        // Both rounded up: the closing frame is never before its mark, so a
        // hold shows the moment itself, not the frame before it — and where one
        // shot's closing mark opens the next, the held frame and the next
        // shot's first frame are the same frame, so the cut never steps back.
        trimBefore: Math.ceil(from.t * FPS - 1e-9),
        trimAfter: Math.ceil(to.t * FPS - 1e-9),
        playbackRate,
        realSeconds: real,
        fromMark: from.name,
        toMark: to.name,
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

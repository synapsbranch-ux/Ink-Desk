// What the studio knows about the queue (v3, slice 18), as pure helpers over
// the `Activity` that desk replies carry: which cards, panels and covers are
// being drawn, which job failed with what sentence, whether the studio should
// keep polling, and the calm line for a queue that is down. The browser derives
// "Drawing…", "Inking…" and a failed sheet's notice from these, never from a
// request being open — a generation is a job on the server, and a reload, a
// second tab or a restart sees the same truth. See `devpost/spec.md > Queue and
// Worker (v3)` and `> As built — slice 18`.
//
// Shared with the browser, so no Node imports.
import { BUSY, isActive, type Activity, type JobView } from './queue/jobs'
import type { Chapter, PanelStatus } from './types'

/** Every job still waiting or drawing. */
export function activeJobs(activity: Activity | undefined): JobView[] {
  return activity?.jobs.filter(isActive) ?? []
}

export function anyActive(activity: Activity | undefined): boolean {
  return activeJobs(activity).length > 0
}

/** A reply without `activity` says nothing new about the queue (an edit, the
 *  plan, the cast): the studio keeps the last one it had. */
export function mergeActivity(previous: Activity | undefined, next: Activity | undefined): Activity | undefined {
  return next ?? previous
}

// --- Character sheets -----------------------------------------------------------

export type SheetJob = {
  job: JobView
  /** `redrawing` keeps the DNA (Redraw sheet); `drawing` writes it fresh (Draw sheet). */
  busy: 'drawing' | 'redrawing'
}

/** The active sheet job for a character's card, if any. */
export function sheetJob(activity: Activity | undefined, characterId: string): SheetJob | null {
  const job = activeJobs(activity).find((j) => j.kind === 'sheet' && j.target.characterId === characterId)
  if (!job) return null
  return { job, busy: job.target.reuseDna ? 'redrawing' : 'drawing' }
}

const newestFirst = (a: JobView, b: JobView) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)

/** Failed sheet jobs that still have a sentence to show, newest first — less
 *  any the user has already moved past (`dismissed`, by job id). */
export function failedSheetJobs(
  activity: Activity | undefined,
  characterId: string,
  dismissed: readonly string[] = []
): JobView[] {
  return (activity?.jobs ?? [])
    .filter(
      (j) =>
        j.kind === 'sheet' &&
        j.status === 'failed' &&
        j.error &&
        j.target.characterId === characterId &&
        !dismissed.includes(j.id)
    )
    .sort(newestFirst)
}

/** The sentence for a card whose last draw failed. Gone while a new draw is under way. */
export function failedSheetSentence(
  activity: Activity | undefined,
  characterId: string,
  dismissed: readonly string[] = []
): string | null {
  if (sheetJob(activity, characterId)) return null
  return failedSheetJobs(activity, characterId, dismissed)[0]?.error ?? null
}

// --- Panels and the cover -------------------------------------------------------

const sameChapter = (job: JobView, chapterId: string | undefined) =>
  chapterId === undefined || job.target.chapterId === undefined || job.target.chapterId === chapterId

const onPanel = (job: JobView, pageIndex: number, index: number, chapterId: string | undefined) =>
  job.kind === 'panel' && job.target.pageIndex === pageIndex && job.target.index === index && sameChapter(job, chapterId)

/** The active job drawing this panel, if any. */
export function panelJob(
  activity: Activity | undefined,
  pageIndex: number,
  index: number,
  chapterId?: string
): JobView | null {
  return activeJobs(activity).find((j) => onPanel(j, pageIndex, index, chapterId)) ?? null
}

/** How many of a page's panels have a job waiting or drawing. */
export function pageJobCount(activity: Activity | undefined, pageIndex: number, chapterId?: string): number {
  return activeJobs(activity).filter(
    (j) => j.kind === 'panel' && j.target.pageIndex === pageIndex && sameChapter(j, chapterId)
  ).length
}

/** The sentence for a panel whose job failed before the desk could say so (a blank panel the worker never got to). */
export function failedPanelSentence(
  activity: Activity | undefined,
  pageIndex: number,
  index: number,
  chapterId?: string
): string | null {
  if (panelJob(activity, pageIndex, index, chapterId)) return null
  const failed = (activity?.jobs ?? [])
    .filter((j) => j.status === 'failed' && j.error && onPanel(j, pageIndex, index, chapterId))
    .sort(newestFirst)
  return failed[0]?.error ?? null
}

/** The active cover job, if any. */
export function coverJob(activity: Activity | undefined, chapterId?: string): JobView | null {
  return activeJobs(activity).find((j) => j.kind === 'cover' && sameChapter(j, chapterId)) ?? null
}

/**
 * Is this panel (or the cover) waiting or inking? Its own status says `inking`,
 * or a job targets it. `empty` alone is NOT in flight: a blank panel nothing is
 * drawing used to read "Pencilling…" for ever after a restart (CR-9).
 */
export function inFlight(status: PanelStatus, job: JobView | null): boolean {
  return status === 'inking' || job !== null
}

/** Blank, and nothing is drawing it: it shows its blank state and can be started. */
export function isIdleBlank(status: PanelStatus, job: JobView | null): boolean {
  return status === 'empty' && job === null
}

// --- Polling --------------------------------------------------------------------

/** Anything on the desk itself that says it is inking (a panel, a page's count, the cover). */
export function deskInking(desk: Pick<Chapter, 'script' | 'pages' | 'cover'>): boolean {
  return (
    (desk.script?.some((p) => p.status === 'inking') ?? false) ||
    desk.pages.some((p) => p.inking > 0) ||
    desk.cover?.status === 'inking'
  )
}

/** Does the studio need to keep re-reading the desk? An idle, finished project must not poll at all. */
export function pollWanted(desk: Pick<Chapter, 'script' | 'pages' | 'cover'> | null, activity: Activity | undefined): boolean {
  return anyActive(activity) || (desk !== null && deskInking(desk))
}

// --- The queue itself -----------------------------------------------------------

const NO_WORKER = 'Nobody is at the drawing desk just now — what you start will wait its turn.'

/** The calm status line when the queue is down or has no worker; null when all is well. */
export function queueNotice(activity: Activity | undefined): string | null {
  const queue = activity?.queue
  if (!queue || queue.state === 'ok') return null
  return queue.message ?? (queue.state === 'busy' ? BUSY : NO_WORKER)
}

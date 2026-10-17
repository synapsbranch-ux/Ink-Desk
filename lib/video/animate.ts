// Animate a page, the web's side (v3, slice 22). Server only. The routes under
// `/api/projects/<id>/pages/<n>/animate` and `/api/videos/**` call this after they
// have proved the project or the trailer is the caller's; nothing here checks who
// is asking. The worker's side is `lib/video/run.ts`; the pure rules are
// `lib/video/{plan,record}.ts`.
//
//   estimateFor   GET  — what Animate would take, and the page's newest trailer. Spends nothing.
//   startTrailer  POST — Confirm: re-plan from the project NOW, write the record, take the hold, queue the job.
//   retryShot     POST — Try again on one shot (or the assembly): re-open the record, queue a smaller job.
//   removeVideo   DELETE — the files, the share and the record.
//
// CONFIRM, STEP BY STEP (each step leaves nothing behind if a later one refuses):
//   1. The studio must be open for generation AND for video (the picture routes' own sentence for the first).
//   2. The plan is made again from the project as it stands now (`planTrailer`). The estimate the person saw is
//      advisory; this plan is the truth, and it is pinned on the record — an edit to a panel while the trailer
//      animates changes nothing. A page that is not complete is "Finish this page first".
//   3. Each character that speaks and has no voice is given the one the plan chose, ONCE, on `Character.voice`
//      (`store.updateProject`): chosen the first time a page is animated and kept — a trailer never changes it.
//   4. The record is written first (`queued`), then the job is queued with the whole plan's spend (`planUses`,
//      `planUsd`) as ONE hold. A person has one trailer in flight (`trailerKey`): `created: false` means another is
//      running — this record is deleted and the answer is 409 ONE_TRAILER_AT_A_TIME. A refusal from the hold or the
//      caps (quota, dollars, the pause, the credit breaker, a busy queue) deletes the record and is rethrown as it is.
//
// TRY AGAIN re-opens the record BEFORE its job exists (the record is the truth the worker reads), and puts it back as
// it was if the job is refused, so a refusal never strands a trailer as "queued".
import 'server-only'
import { randomUUID } from 'node:crypto'
import { videoEnabled, videoSettings } from '../config'
import { Refused } from '../errors'
import { assertGenerationEnabled } from '../generation'
import { enqueueJob } from '../queue/enqueue'
import { isJobLive } from '../queue/status'
import { trailerKey } from '../queue/jobs'
import { chapterTitle } from '../reader'
import { cleanText } from '../share/snapshot'
import { unpublishVideo } from '../share/service'
import type { VideoRecord } from '../share/types'
import { store } from '../store'
import type { Project } from '../types'
import { newVideoRecord, queueReassemble, queueRetry, videoKeys } from './record'
import { liveTrailerJob, settleStaleVideo, videoViewOf } from './status'
import { pageIsComplete, planTrailer, planUsd, planUses } from './plan'
import { FINISH_THIS_PAGE_FIRST, ONE_TRAILER_AT_A_TIME, VIDEO_IS_CLOSED, type AnimateEstimate, type TrailerPlan, type VideoView } from './types'

export const NOT_RETRYABLE = 'That shot can’t be tried again right now.'
export const STILL_MAKING = 'This trailer is still being made. Remove it once it has finished.'
const NO_SUCH_PAGE = 'There is no such page.'

/** The studio's title for the chapter, as the card and the share show it: control-free, one line, capped. */
function titleOf(project: Project): string {
  const chapter = project.chapters[0]
  return cleanText(chapterTitle({ cover: chapter?.cover ?? null, synopsis: project.story.synopsis, title: project.title }), 150) || 'Untitled chapter'
}

/** `video` closed ⇒ the one sentence; `generation` closed ⇒ the same refusal the picture routes give. */
export function assertVideoOpen(): void {
  assertGenerationEnabled()
  if (!videoEnabled()) throw new Refused(VIDEO_IS_CLOSED, 503)
}

/** The plan for page `n` of the project as it stands. Throws `Refused` 404 for no such page, 409 "Finish this page first" for an incomplete one. */
export async function planFor(userId: string, project: Project, n: number): Promise<TrailerPlan> {
  const chapter = project.chapters[0]
  const page = chapter && Number.isInteger(n) && n >= 0 ? chapter.pages[n] : undefined
  if (!chapter || !page) throw new Refused(NO_SUCH_PAGE, 404)
  if (!pageIsComplete(page.panels)) throw new Refused(FINISH_THIS_PAGE_FIRST, 409)
  const settings = videoSettings()
  const defaults = (await store.settings.get(userId))?.voices
  try {
    return planTrailer({
      title: titleOf(project),
      page: n,
      panels: page.panels,
      characters: project.library.characters,
      ...(defaults ? { voices: defaults } : {}),
      model: settings.model,
      resolution: settings.resolution,
      method: settings.method,
    })
  } catch {
    // The planner's only complaints are about a page that is not whole: the person's way forward is the same sentence.
    throw new Refused(FINISH_THIS_PAGE_FIRST, 409)
  }
}

/** The person's live trailer job, if any — the one-at-a-time key's holder. Reads only. */
async function liveTrailerOf(ownerId: string): Promise<{ videoId: string } | null> {
  const jobs = await store.jobs.listJobs({ ownerId, status: ['queued', 'running'] })
  const now = new Date()
  for (const job of jobs) if (job.payload.kind === 'trailer' && isJobLive(job, now)) return { videoId: job.payload.videoId }
  return null
}

/** The page's newest trailer for this person, as the browser sees it (settled first), or null. */
async function newestVideoOfPage(userId: string, projectId: string, page: number): Promise<VideoView | null> {
  const mine = await store.videos.listOf(userId) // newest first
  const latest = mine.find((v) => v.projectId === projectId && v.page === page)
  return latest ? videoViewOf(latest) : null
}

/** GET …/animate: the estimate Confirm would commit to, and the page's newest trailer. Never spends and never writes. */
export async function estimateFor(userId: string, project: Project, n: number): Promise<{ estimate: AnimateEstimate; video: VideoView | null }> {
  if (!videoEnabled()) return { estimate: { ok: false, reason: VIDEO_IS_CLOSED }, video: null }
  const video = await newestVideoOfPage(userId, project.id, n)
  let plan: TrailerPlan
  try {
    plan = await planFor(userId, project, n)
  } catch (err) {
    if (err instanceof Refused && err.status === 409) return { estimate: { ok: false, reason: err.message }, video }
    throw err
  }
  const busy = await liveTrailerOf(userId)
  return {
    estimate: {
      ok: true,
      page: n,
      shots: plan.shots.map((s) => ({ panel: s.panel, seconds: s.seconds, aspect: s.aspect })),
      shotSeconds: plan.shotSeconds,
      runSeconds: plan.runSeconds,
      speechChars: plan.speechChars,
      usd: planUsd(plan),
      uses: planUses(plan),
      model: plan.model,
      resolution: plan.resolution,
      busyVideoId: busy?.videoId ?? null,
    },
    video,
  }
}

/** Give each character that speaks in the plan and has no voice the one the plan chose. Chosen once, kept; a voice already there is never changed. */
async function keepVoices(projectId: string, plan: TrailerPlan): Promise<void> {
  const chosen = new Map<string, string>()
  for (const shot of plan.shots) if (shot.line?.characterId) chosen.set(shot.line.characterId, shot.line.voice)
  if (chosen.size === 0) return
  await store.updateProject(projectId, (project) => {
    const needs = project.library.characters.some((c) => !c.voice && chosen.has(c.id))
    if (!needs) return project
    return { ...project, library: { ...project.library, characters: project.library.characters.map((c) => (!c.voice && chosen.has(c.id) ? { ...c, voice: chosen.get(c.id) } : c)) } }
  })
}

/** Remove a record a refusal leaves unwanted — unless a live job already names it. Never throws: the original refusal is the answer. */
async function discard(record: VideoRecord): Promise<void> {
  try {
    if (await liveTrailerJob(record)) return
    await store.videos.delete(record.id)
  } catch (err) {
    console.warn(`[trailer ${record.id.slice(0, 8)}] could not remove the record a refused request left:`, err instanceof Error ? err.message : err)
  }
}

/** POST …/animate: Confirm. Returns the new trailer's view (queued). Leaves no record behind on any refusal. */
export async function startTrailer(userId: string, project: Project, n: number): Promise<VideoView> {
  assertVideoOpen()
  const plan = await planFor(userId, project, n)
  await keepVoices(project.id, plan)

  const record = newVideoRecord({ id: randomUUID(), ownerId: userId, projectId: project.id, plan })
  await store.videos.put(record) // first: the job's first read finds it
  try {
    const { created } = await enqueueJob({
      key: trailerKey(userId),
      ownerId: userId,
      projectId: project.id,
      kind: 'trailer',
      payload: { kind: 'trailer', videoId: record.id },
      spend: { units: planUses(plan), usd: planUsd(plan) },
    })
    if (!created) throw new Refused(ONE_TRAILER_AT_A_TIME, 409) // another trailer holds the key: this record has no job
  } catch (err) {
    await discard(record)
    throw err
  }
  return videoViewOf(record)
}

/**
 * POST /api/videos/<id> `{action: 'retry', shot?: 0..3}`. With a `shot`: Try again on that one — allowed only for a
 * `failed`/`orphaned` shot of a trailer that is not running; a new `trailer` job with `only: [shot]` and its own,
 * smaller hold (no voices, no music). Without one: put the trailer together again when every shot is made and only the
 * assembly failed (`only: []`, nothing new to pay for).
 */
export async function retryShot(video: VideoRecord, shot: number | null): Promise<VideoView> {
  assertVideoOpen()
  const current = await settleStaleVideo(video) // ends a trailer whose job is gone, so its shots can be tried again
  if (await liveTrailerJob(current)) throw new Refused(NOT_RETRYABLE, 409)

  const only = shot === null ? [] : [shot]
  const now = new Date()
  const reopened = await store.videos.update(current.id, (v) => (shot === null ? queueReassemble(v, now) : queueRetry(v, shot, now)))
  if (!reopened) throw new Refused(NOT_RETRYABLE, 409)

  try {
    const { created } = await enqueueJob({
      key: trailerKey(current.ownerId),
      ownerId: current.ownerId,
      projectId: current.projectId,
      kind: 'trailer',
      payload: { kind: 'trailer', videoId: current.id, only },
      spend: { units: planUses(current.plan, only), usd: planUsd(current.plan, only) },
    })
    if (!created) throw new Refused(ONE_TRAILER_AT_A_TIME, 409)
  } catch (err) {
    // Put it back as it was: no job is coming for it, and "queued" would be a spinner that never ends.
    const back = new Date()
    await store.videos.update(current.id, (v) => (v.status === 'queued' ? { ...current, rev: v.rev, updatedAt: back.toISOString() } : null)).catch(() => {})
    throw err
  }
  return videoViewOf((await store.videos.get(current.id)) ?? reopened)
}

/**
 * DELETE /api/videos/<id>: refused (409) while it is being made; otherwise its share goes first (the address is dead
 * before the file is), then its files (`videos/<owner>/<id>/`), then the record. Idempotent past the refusal.
 */
export async function removeVideo(video: VideoRecord): Promise<void> {
  const fresh = await settleStaleVideo(video) // a trailer whose job is gone is ended, and can be removed
  if (fresh.status === 'queued' || fresh.status === 'making') throw new Refused(STILL_MAKING, 409)
  await unpublishVideo(video)
  await store.outputs.deletePrefix(videoKeys(video.ownerId, video.id).folder)
  await store.videos.delete(video.id)
}

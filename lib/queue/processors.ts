// What a worker does with one job (v3, slice 18). Server only. The same
// function runs under BullMQ in the `worker` service and in the web process on
// the inline queue, so the checks exercise exactly the production path.
//
//   1. CLAIM  — the record goes `running` under this worker with a lease. A job
//      that already ended is never taken again: a redelivery (BullMQ brings a
//      stalled job back) of finished work is a no-op, which is half of
//      "never paid for twice". The other half is the checkpoint in `run`.
//   2. HEARTBEAT — every `LEASE_RENEW_MS` the lease is renewed, for as long as
//      the job can legitimately run (`maxRunMs`). A worker that dies stops
//      renewing; its lease lapses and the job is recovered (BullMQ re-delivers
//      it, or the web calls it dead). A job that hangs past the ceiling stops
//      being renewed too, so nothing holds a claim forever (CR-13).
//   3. WORK   — the panel, cover or sheet engine, which never throws for a
//      provider problem: that is its outcome, written to the project and to the
//      job. It throws only when the store failed after the picture was paid for
//      — then BullMQ retries and the retry attaches the stored picture.
//   4. FINISH — `done`, or `failed` with the sentence the card shows.
//
// Slice 22 adds the `trailer` kind (lib/video/run.ts): one job makes a whole trailer — its shots side by side, the
// voices, the music, the assembly — checkpointing every part on the video record, so a redelivery resumes and nothing
// paid for is paid for twice. Its differences: it runs on the `video` lane; its ceiling is `TRAILER_RUN_MS`; and the
// credit breaker is NOT checked at the door. A trailer may have nothing left to pay for (a retry of a shot, an
// assembly of parts already bought), and failing that at the door would strand work that is already paid for — so the
// runner asks the breaker itself, before each paid call, and a trailer with nothing to buy runs on.
//
// Slice 21 adds the account kinds, `export` and `delete-account` (lib/account):
// the same four steps, with three differences. They call no paid provider, so
// the credit breaker does not stop them; their ceiling is the account lane's
// (`ACCOUNT_RUN_MS`: ten minutes for an export, fifteen for a deletion); and a
// `delete-account` job's own record is deleted the moment it ends `done` —
// the person it was about no longer exists, and nothing about them may stay,
// this record included. A `failed` one stays, with its sentence, for the status
// route to tell them. Unlike the image engines, an account runner may THROW
// (a store that went away mid-sweep): the job stays claimed, BullMQ retries it
// (or the reconciler re-runs it), and every step of both is safe to repeat.
import 'server-only'
import { inkCover } from '../director'
import { configSentence, ProviderError } from '../errors'
import { inkPanel } from '../panels'
import { drawSheet } from '../sheet'
import { store } from '../store'
import { creditsBreakerOpen } from './breaker'
import { endJob } from './ending'
import { maxRunMs } from './status'
import { LEASE_MS, LEASE_RENEW_MS, NO_ACCOUNT_TO_DELETE, PAUSED, LOCAL_OWNER, checkpoint, claim, finish, isAccountKind, isActive, leaseExpired, renew, type AccountJobKind, type JobPayload, type JobRecord } from './jobs'
import type { JobRun, Outcome } from './run'

export type Handled = 'done' | 'failed' | 'skipped'

type Pinned = { __inkdeskRunning?: Set<string> }
const g = globalThis as typeof globalThis & Pinned
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Take one job and run it. Two guards come before the claim, because a job can
 * be delivered while it is still being worked on — BullMQ re-delivers when a
 * worker's lock lapses (a Redis blip longer than the lock, a long pause), and
 * a worker that lost its lock keeps working:
 *   • the same process already has it → this delivery is dropped;
 *   • another worker holds it under a live lease → wait for it to finish or for
 *     its lease to lapse (a dead worker's does), rather than drawing a second,
 *     paid, picture beside it.
 */
export async function processJob(jobId: string, ctx: { workerId: string; maxRunMs?: number }): Promise<Handled> {
  const running = (g.__inkdeskRunning ??= new Set())
  if (running.has(jobId)) {
    console.warn(`[worker] job ${jobId} was delivered again while this process is still working on it; leaving it`)
    return 'skipped'
  }
  running.add(jobId)
  try {
    return await run(jobId, ctx)
  } finally {
    running.delete(jobId)
  }
}

async function run(jobId: string, ctx: { workerId: string; maxRunMs?: number }): Promise<Handled> {
  const { workerId } = ctx

  const waitedFrom = Date.now()
  for (;;) {
    const current = await store.jobs.getJob(jobId)
    if (!current || !isActive(current)) {
      console.log(`[worker] job ${jobId} is already finished or gone; leaving it`)
      return 'skipped'
    }
    const heldByAnother = current.status === 'running' && current.workerId !== workerId && current.leaseUntil !== null && Date.parse(current.leaseUntil) > Date.now()
    if (!heldByAnother || Date.now() - waitedFrom > LEASE_MS + 15_000) break
    await sleep(2_000)
  }

  const job = await store.jobs.updateJob(jobId, (j) => claim(j, workerId, new Date()))
  if (!job) {
    console.log(`[worker] job ${jobId} is already finished or gone; leaving it`)
    return 'skipped'
  }
  const tag = `${job.kind} ${job.id.slice(0, 8)}`

  // A job that only has to attach a picture it already paid for calls nobody, so the breaker does not stop it.
  // An account job calls no provider at all: the breaker has nothing to say about it. A trailer asks the breaker itself, before each paid call (see above).
  if (!isAccountKind(job.kind) && job.kind !== 'trailer' && !job.resultImageId && (await creditsBreakerOpen())) {
    // Fail it without calling anyone: the account is out of credit (CR-10).
    console.warn(`[worker] ${tag} — credit breaker open; not calling the provider`)
    await end(job, { outcome: 'failed', error: PAUSED })
    return 'failed'
  }

  // The heartbeat: renew the lease while the work runs.
  const deadline = Date.now() + (ctx.maxRunMs ?? maxRunMs(job.kind === 'panel' || job.kind === 'cover' || job.kind === 'trailer' || isAccountKind(job.kind) ? job.kind : 'sheet'))
  const beat = setInterval(() => {
    if (Date.now() > deadline) return
    store.jobs.updateJob(job.id, (j) => renew(j, workerId, new Date())).catch((err: unknown) => {
      console.warn(`[worker] ${tag} — could not renew its lease:`, err instanceof Error ? err.message : err)
    })
  }, LEASE_RENEW_MS)
  beat.unref?.()

  const jobRun: JobRun = {
    jobId: job.id,
    resultImageId: job.resultImageId,
    costUsd: job.costUsd,
    checkpoint: async (imageId, costUsd) => {
      await store.jobs.updateJob(job.id, (j) => checkpoint(j, workerId, { resultImageId: imageId, costUsd: costUsd ?? 0 }, new Date()))
    },
    patchPayload: async (patch) => {
      await store.jobs.updateJob(job.id, (j) => checkpoint(j, workerId, { payload: { ...j.payload, ...patch } as JobPayload }, new Date()))
    },
    spent: async (costUsd) => {
      await store.jobs.updateJob(job.id, (j) => checkpoint(j, workerId, { costUsd }, new Date()))
    },
    isCurrent: async () => {
      const j = await store.jobs.getJob(job.id)
      return !!j && j.status === 'running' && j.workerId === workerId && !leaseExpired(j, new Date())
    },
  }

  let outcome: Outcome
  try {
    outcome = await work(job, jobRun)
  } finally {
    clearInterval(beat)
  }

  const ended = await end(job, { outcome: outcome.outcome, error: outcome.error, costUsd: outcome.costUsd })
  if (job.kind === 'delete-account' && outcome.outcome === 'done') await forgetDeletion(job, tag)
  // An ending written elsewhere first (the worker's ceiling, a lease let go, a cancel) stands; the log says so rather than the run's word.
  console.log(`[worker] ${tag} — ${ended ? outcome.outcome : `${outcome.outcome}, but the job had already been ended elsewhere`}`)
  return outcome.outcome === 'done' ? 'done' : outcome.outcome === 'skipped' ? 'skipped' : 'failed'
}

/** Dispatch on the kind. The payload is read from the record, never from the queue. */
async function work(job: JobRecord, run: JobRun): Promise<Outcome> {
  const p = job.payload
  switch (p.kind) {
    case 'panel':
      return inkPanel({ projectId: job.projectId, chapterId: p.chapterId, pageIndex: p.pageIndex }, p.index, run)
    case 'cover':
      return inkCover(job.projectId, run)
    case 'sheet':
      return drawSheet(job.projectId, p.characterId, p.reuseDna, run)
    case 'trailer':
      return (await withoutMediaTools(job)) ?? videoRunners.trailer(job, run)
    case 'export':
      return accountRunners.export(job, run)
    case 'delete-account':
      // Belt and braces beside the door (`enqueueAccountJob`): on a desk without accounts the one owner is the whole desk.
      if (job.ownerId === LOCAL_OWNER) return { outcome: 'refused', error: NO_ACCOUNT_TO_DELETE }
      return accountRunners['delete-account'](job, run)
  }
}

/**
 * The two account runners (`lib/account`), looked up on every job. Each loads its module on first use, not at the top:
 * the account code reaches into every store, and a web bundle that only enqueues must not carry it. They sit in an
 * object, not behind two imports, so a check can stand in for them the way it stands in for a store call.
 */
export const accountRunners: Record<AccountJobKind, (job: JobRecord, run: JobRun) => Promise<Outcome>> = {
  export: async (job, run) => (await import('../account')).runExport(job, run),
  'delete-account': async (job, run) => (await import('../account')).runDeleteAccount(job, run),
}

/**
 * The trailer runner (`lib/video`), looked up on every job and loaded on first use, like the account runners: it pulls in
 * ffmpeg, sharp and the provider clients, which a web bundle that only enqueues must not carry. In an object so
 * `check:video` and `check:queue` can stand in for it without a provider or a film.
 */
export const videoRunners: { trailer: (job: JobRecord, run: JobRun) => Promise<Outcome> } = {
  trailer: async (job, run) => (await import('../video/run')).runTrailer(job, run),
}

/** What a trailer is refused with on a machine without ffmpeg (a production studio says `UNAVAILABLE` instead, SEC-11). */
export const TRAILER_NEEDS_FFMPEG = 'The studio can’t make trailers without ffmpeg. Install ffmpeg (it brings ffprobe) and restart the worker.'

/** Why ffmpeg or ffprobe cannot be run on this machine, or null when both answer. Asked afresh each time: two short spawns, and a trailer is rare. */
export async function mediaToolsMissing(): Promise<string | null> {
  const { execFile } = await import('node:child_process')
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const err = await new Promise<Error | null>((resolve) => execFile(/*turbopackIgnore: true*/ tool, ['-version'], { timeout: 15_000 }, (e) => resolve(e)))
    if (err) return `${tool}: ${err.message}`
  }
  return null
}

/**
 * A trailer pays for its shots before the assembly needs ffmpeg, so on a machine without it the job is refused before
 * anything is sent (after-audit #12): its video record is failed with the sentence, and nothing is spent. Null when the
 * tools are there. (The worker also refuses to start without them while video is open.)
 */
async function withoutMediaTools(job: JobRecord): Promise<Outcome | null> {
  const missing = await mediaToolsMissing()
  if (!missing) return null
  console.error(`[worker] trailer ${job.id.slice(0, 8)} — refused before any paid call: ${missing}`)
  const sentence = configSentence(new ProviderError(TRAILER_NEEDS_FFMPEG, 'config'))
  if (job.payload.kind === 'trailer') {
    const { markVideoFailed, recoverShots } = await import('../video/record')
    // A redelivered trailer may have shots out at the provider already: nothing will collect them now, so they end
    // orphaned (counted at the formula's price) and Try again can take them, as when the web finds a job gone.
    const now = new Date()
    await store.videos.update(job.payload.videoId, (v) => (v.ownerId === job.ownerId ? markVideoFailed(recoverShots(v, now, { jobGone: true }), sentence, now) : null))
  }
  return { outcome: 'failed', error: sentence }
}

/** The deletion succeeded, so its own record goes too — the last trace of the person. A store that blips here leaves a finished record the reconciler prunes after a week; it is not worth failing a deletion that is complete. */
async function forgetDeletion(job: JobRecord, tag: string): Promise<void> {
  try {
    await store.jobs.deleteJob(job.id)
  } catch (err) {
    console.warn(`[worker] ${tag} — finished, but its own record could not be deleted yet (it is pruned within a week):`, err instanceof Error ? err.message : err)
  }
}

/** End the job, and settle or release what it held (slice 20). `finish` refuses a job that already ended (the web let it go as dead, say), and the first ending stands. */
function end(job: JobRecord, result: Parameters<typeof finish>[1]): Promise<JobRecord | null> {
  // `endJob` settles the job's hold when this write ends it: done → its real cost; anything else → released.
  return endJob(job.id, (j) => finish(j, result, new Date()))
}

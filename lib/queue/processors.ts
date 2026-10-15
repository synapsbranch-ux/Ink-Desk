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
import 'server-only'
import { inkCover } from '../director'
import { inkPanel } from '../panels'
import { drawSheet } from '../sheet'
import { store } from '../store'
import { creditsBreakerOpen } from './breaker'
import { endJob } from './ending'
import { maxRunMs } from './status'
import { LEASE_MS, LEASE_RENEW_MS, PAUSED, checkpoint, claim, finish, isActive, renew, type JobPayload, type JobRecord } from './jobs'
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
  if (!job.resultImageId && (await creditsBreakerOpen())) {
    // Fail it without calling anyone: the account is out of credit (CR-10).
    console.warn(`[worker] ${tag} — credit breaker open; not calling the provider`)
    await end(job, { outcome: 'failed', error: PAUSED })
    return 'failed'
  }

  // The heartbeat: renew the lease while the work runs.
  const deadline = Date.now() + (ctx.maxRunMs ?? maxRunMs(job.kind === 'panel' || job.kind === 'cover' ? job.kind : 'sheet'))
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
  }

  let outcome: Outcome
  try {
    outcome = await work(job, jobRun)
  } finally {
    clearInterval(beat)
  }

  await end(job, { outcome: outcome.outcome, error: outcome.error, costUsd: outcome.costUsd })
  console.log(`[worker] ${tag} — ${outcome.outcome}`)
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
  }
}

/** End the job, and settle or release what it held (slice 20). `finish` refuses a job that already ended (the web let it go as dead, say), and the first ending stands. */
function end(job: JobRecord, result: Parameters<typeof finish>[1]): Promise<JobRecord | null> {
  // `endJob` settles the job's hold when this write ends it: done → its real cost; anything else → released.
  return endJob(job.id, (j) => finish(j, result, new Date()))
}

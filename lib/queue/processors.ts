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
import { maxRunMs } from './status'
import { LEASE_RENEW_MS, PAUSED, checkpoint, claim, finish, renew, type JobPayload, type JobRecord } from './jobs'
import type { JobRun, Outcome } from './run'

export type Handled = 'done' | 'failed' | 'skipped'

export async function processJob(jobId: string, ctx: { workerId: string; maxRunMs?: number }): Promise<Handled> {
  const { workerId } = ctx
  const job = await store.jobs.updateJob(jobId, (j) => claim(j, workerId, new Date()))
  if (!job) {
    console.log(`[worker] job ${jobId} is already finished or gone; leaving it`)
    return 'skipped'
  }
  const tag = `${job.kind} ${job.id.slice(0, 8)}`

  if (await creditsBreakerOpen()) {
    // Fail it without calling anyone: the account is out of credit (CR-10).
    console.warn(`[worker] ${tag} — credit breaker open; not calling the provider`)
    await end(job, { outcome: 'failed', error: PAUSED })
    return 'failed'
  }

  // The heartbeat: renew the lease while the work runs.
  const deadline = Date.now() + (ctx.maxRunMs ?? maxRunMs())
  const beat = setInterval(() => {
    if (Date.now() > deadline) return
    store.jobs.updateJob(job.id, (j) => renew(j, workerId, new Date())).catch((err: unknown) => {
      console.warn(`[worker] ${tag} — could not renew its lease:`, err instanceof Error ? err.message : err)
    })
  }, LEASE_RENEW_MS)
  beat.unref?.()

  const run: JobRun = {
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
    outcome = await work(job, run)
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

/** End the job. `finish` refuses a job that already ended (the web let it go as dead, say), and the first ending stands. */
function end(job: JobRecord, result: Parameters<typeof finish>[1]): Promise<JobRecord | null> {
  return store.jobs.updateJob(job.id, (j) => finish(j, result, new Date()))
}

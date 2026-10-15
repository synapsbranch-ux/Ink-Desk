// The reconciler (v3, slice 18): Mongo says what should be running; Redis says
// what is. Where they disagree, Mongo wins. It runs in the worker, once at
// start and then every minute, under a short Redis lock so two workers do not
// both do it. Server only.
//
//   • A record `queued` that Redis does not hold (Redis was flushed, replaced,
//     or the web service wrote the record and died before queuing it) goes back
//     on the queue — the only way a flushed Redis loses nothing.
//   • A record `running` whose lease lapsed and whose queue entry is gone (the
//     worker died and so did Redis's memory of it) goes back to `queued` and on
//     the queue. If BullMQ still holds it, BullMQ's own stalled-job recovery
//     brings it back and nothing is done here.
//   • A job claimed `MAX_CLAIMS` times and still not finished is failed with a
//     calm sentence instead of being put back for ever.
//   • An ended job whose reservation was never settled (slice 20: a crash
//     between its ending and the settle) is settled now — idempotently.
//   • Records that finished long ago are pruned.
// Nothing here ever draws or pays: it only moves records and queue entries.
import 'server-only'
import type { Job } from 'bullmq'
import { sweepUnsettled } from '../limits/jobs'
import { store } from '../store'
import { endJob } from './ending'
import { KEEP_FINISHED_MS, REQUEUE_AFTER_MS, TOO_MANY_RESTARTS, finish, leaseExpired, priorityFor, requeue, type JobRecord } from './jobs'
import { bullQueue, addToQueue } from './queues'
import { producerRedis, redisKey, within } from './redis'

/** A job claimed this many times without finishing is poison; it is failed, not retried again. */
export const MAX_CLAIMS = 6

const IN_REDIS = new Set(['waiting', 'prioritized', 'delayed', 'active', 'waiting-children'])

export type Reconciled = { requeued: number; failed: number; pruned: number; settled: number; skipped: boolean }

export async function reconcileOnce(ownerTag: string, now = new Date()): Promise<Reconciled> {
  const report: Reconciled = { requeued: 0, failed: 0, pruned: 0, settled: 0, skipped: false }
  const redis = producerRedis()
  // One reconciler at a time across workers; the lock outlives one pass and no more.
  const got = await within(redis.set(redisKey('lock', 'reconcile'), ownerTag, 'EX', 55, 'NX'))
  if (got !== 'OK') return { ...report, skipped: true }

  const active = await store.jobs.listJobs({ status: ['queued', 'running'], limit: 2_000 })
  const perOwner = new Map<string, number>()
  for (const job of active) perOwner.set(job.ownerId, (perOwner.get(job.ownerId) ?? 0) + 1)

  for (const job of active) {
    try {
      const entry = await bullQueue(job.queue).getJob(job.id)
      const state = entry ? await entry.getState() : null
      if (IN_REDIS.has(state ?? '')) continue // Redis has it; its own rules apply

      if (job.status === 'queued') {
        if (now.getTime() - Date.parse(job.updatedAt) < REQUEUE_AFTER_MS) continue // just written; the web is about to queue it
        if (await putBack(job, entry, perOwner, report, now)) report.requeued++
      } else if (leaseExpired(job, now)) {
        const queued = await store.jobs.updateJob(job.id, (j) => (leaseExpired(j, now) ? requeue(j, now) : null))
        if (queued && (await putBack(queued, entry, perOwner, report, now))) report.requeued++
      }
    } catch (err) {
      console.warn(`[reconcile] ${job.kind} job ${job.id} could not be checked:`, err instanceof Error ? err.message : err)
    }
  }
  // A job that ended while its hold was still `held` (a crash between the ending and the settle, a counter store that was down) is settled now.
  report.settled = (await sweepUnsettled()).settled
  report.pruned = await store.jobs.pruneJobs(new Date(now.getTime() - KEEP_FINISHED_MS).toISOString())
  if (report.requeued || report.failed || report.pruned || report.settled) {
    console.log(`[reconcile] put back ${report.requeued}, failed ${report.failed}, settled ${report.settled}, pruned ${report.pruned}`)
  }
  return report
}

/** Put one record's job back on its queue, or fail it if it has been claimed too many times. True if it was queued. */
async function putBack(job: JobRecord, entry: Job | undefined, perOwner: Map<string, number>, report: Reconciled, now: Date): Promise<boolean> {
  if (job.attempts >= MAX_CLAIMS) {
    await endJob(job.id, (j) => finish(j, { outcome: 'failed', error: TOO_MANY_RESTARTS }, now))
    report.failed++
    return false
  }
  // A leftover completed or failed entry holds the id; clear it so the add is not a no-op.
  if (entry) await entry.remove().catch(() => {})
  await addToQueue(job, priorityFor((perOwner.get(job.ownerId) ?? 1) - 1))
  console.log(`[reconcile] ${job.kind} job ${job.id} was not on the queue; put it back`)
  return true
}

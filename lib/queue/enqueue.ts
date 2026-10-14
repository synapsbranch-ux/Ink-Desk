// Putting work on the queue (v3, slice 18) — the one entry every generation
// route uses. Server only.
//
// The order is the whole design: the job's record is written to the store
// FIRST (`queued`), and only then is it handed to a queue. So a crash between
// the two leaves a record the reconciler puts back, never a job nobody has
// heard of; a Redis that is down refuses the work at the door with the studio's
// busy sentence and leaves nothing behind; and asking for work that is already
// waiting or running hands back that job instead of a second paid one.
//
// Refusals, each one a calm sentence and a status the studio already shows:
//   • the credit breaker is open (a 402 was seen)            → 503
//   • Redis is down, or not configured                       → 503
//   • this person has `QUEUE_USER_INFLIGHT` jobs in flight   → 429  (SEC-08, CR-10)
//   • the whole studio has `QUEUE_MAX_WAITING` in flight     → 503
// Fairness: a person's jobs go on the queue with a priority equal to how many
// they already have in flight, so someone with one panel waiting goes ahead of
// someone whose Generate all queued twenty-four.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { queueSettings } from '../config'
import { Refused } from '../errors'
import { singletons } from '../singleton'
import { store } from '../store'
import { creditsBreakerOpen } from './breaker'
import { ABANDONED, BUSY, PAUSED, TOO_MANY, abandon, finish, newJob, priorityFor, type JobRecord, type NewJob } from './jobs'
import { within } from './redis'
import { addToQueue } from './queues'
import { isJobLive } from './status'

const ACTIVE = ['queued', 'running'] as const

export type Enqueued = { job: JobRecord; created: boolean }

/** The job that holds this key right now, if there is a live one. A dead one (lease lapsed, nothing to renew it) is let go on the way. */
export async function activeJob(key: string): Promise<JobRecord | null> {
  const [job] = await store.jobs.listJobs({ key, status: ACTIVE, limit: 1 })
  if (!job) return null
  if (isJobLive(job)) return job
  await store.jobs.updateJob(job.id, (j) => abandon(j, ABANDONED, new Date()))
  return null
}

/** Is work with this key waiting or running? */
export async function isQueued(key: string): Promise<boolean> {
  return (await activeJob(key)) !== null
}

export async function enqueueJob(input: NewJob): Promise<Enqueued> {
  const settings = queueSettings()

  if (await creditsBreakerOpen()) throw new Refused(PAUSED, 503)
  if (settings.mode === 'bullmq' && !settings.redisUrl) throw new Refused(BUSY, 503)

  const existing = await activeJob(input.key)
  if (existing) return { job: existing, created: false }

  const mine = await store.jobs.listJobs({ ownerId: input.ownerId, status: ACTIVE, limit: settings.userInflight + 1 })
  if (mine.length >= settings.userInflight) throw new Refused(TOO_MANY, 429)
  const everyone = await store.jobs.listJobs({ status: ACTIVE, limit: settings.maxWaiting + 1 })
  if (everyone.length >= settings.maxWaiting) throw new Refused(BUSY, 503)

  // Written before it is queued, so there is never a queued job without a record.
  const inserted = await store.jobs.insertJob(newJob(input, randomUUID(), new Date()))
  if (!inserted.created) return inserted
  const job = inserted.job

  try {
    await dispatch(job, priorityFor(mine.length))
  } catch (err) {
    // Not queued, so not coming: end the record, or the reconciler would put it
    // on the queue later and the person would be charged for a click that said "busy".
    await store.jobs.updateJob(job.id, (j) => finish(j, { outcome: 'cancelled', error: BUSY }, new Date())).catch(() => {})
    console.error('[queue] could not queue a job:', err instanceof Error ? err.message : err)
    throw err instanceof Refused ? err : new Refused(BUSY, 503)
  }
  return { job, created: true }
}

/** Hand a written record to whatever runs it: the in-process runner, or BullMQ. */
async function dispatch(job: JobRecord, priority: number): Promise<void> {
  if (queueSettings().mode === 'inline') {
    // Loaded here, not at the top: the processors import the panel engine, which imports this file.
    const { processJob } = await import('./processors')
    const workerId = `inline-${singletons.serverRunId.slice(0, 8)}`
    singletons.queue.enqueue(job.id, async () => {
      try {
        await processJob(job.id, { workerId })
      } catch (err) {
        console.error(`[queue] ${job.kind} job ${job.id} failed outside its own handler:`, err)
      }
    })
    return
  }
  await within(addToQueue(job, priority))
}

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
// Slice 20 puts the spend reservation between the checks and the write: after
// the dedupe and the caps above, and BEFORE the record is written, the job's
// picture is held against the person's quota and dollar cap and the studio's
// caps (`lib/limits`), atomically — so a refusal leaves nothing behind and
// parallel requests cannot over-spend. Every ending of the job settles or
// releases the hold (`ending.ts`); a back-out here is one of those endings.
//
// Refusals, each one a calm sentence and a status the studio already shows:
//   • the studio's daily/total cap, or the person's quota/dollar cap → 503 / 429
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
import { holdForJob, releaseUnlinked, sweepUnsettled } from '../limits/jobs'
import { singletons } from '../singleton'
import { store } from '../store'
import { creditsBreakerOpen } from './breaker'
import { endJob } from './ending'
import { ABANDONED, BUSY, KEEP_FINISHED_MS, LOCAL_OWNER, PAUSED, TOO_MANY, abandon, finish, newJob, priorityFor, type JobRecord, type NewJob } from './jobs'
import { within } from './redis'
import { addToQueue } from './queues'
import { isJobLive } from './status'

const ACTIVE = ['queued', 'running'] as const

export type Enqueued = { job: JobRecord; created: boolean }

/** The job that holds this key right now, if there is a live one. A dead one (lease lapsed, nothing to renew it) is let go on the way — judged again on the fresh record, so a worker that renewed in between is not abandoned. */
export async function activeJob(key: string): Promise<JobRecord | null> {
  const [job] = await store.jobs.listJobs({ key, status: ACTIVE, limit: 1 })
  if (!job) return null
  if (isJobLive(job)) return job
  const now = new Date()
  const ended = await endJob(job.id, (j) => (isJobLive(j, now) ? null : abandon(j, ABANDONED, now)))
  return ended ? null : ((await store.jobs.getJob(job.id)) ?? null)
}

/** Is work with this key waiting or running? */
export async function isQueued(key: string): Promise<boolean> {
  return (await activeJob(key)) !== null
}

/**
 * Everything that would refuse new work, without writing anything — so a
 * route that is about to pay for something first (Rewrite's text call) can
 * ask before it spends. Throws `Refused`; the caps are checked again, after
 * the insert, by `enqueueJob` itself.
 */
export async function assertCanEnqueue(ownerId: string): Promise<void> {
  const settings = queueSettings()
  if (await creditsBreakerOpen()) throw new Refused(PAUSED, 503, { code: 'paused' })
  if (settings.mode === 'bullmq' && !settings.redisUrl) throw new Refused(BUSY, 503)
  const mine = await store.jobs.listJobs({ ownerId, status: ACTIVE, limit: settings.userInflight + 1 })
  if (mine.length >= settings.userInflight) throw new Refused(TOO_MANY, 429)
  const everyone = await store.jobs.listJobs({ status: ACTIVE, limit: settings.maxWaiting + 1 })
  if (everyone.length >= settings.maxWaiting) throw new Refused(BUSY, 503)
}

/**
 * The picture a new job of this key should attach (CR-16): the newest ended job for the key paid for one and never
 * landed it. Only when that job is the newest ending of all — a later job that finished has attached it (or drawn
 * another), and carrying the old picture on would turn every Redraw into a no-op that still takes a quota unit — and
 * only while the picture is still in the bucket: a refused attach deletes it, and a job that carried a deleted
 * picture's cost would draw a fresh one and count it as nothing.
 */
async function strandedPicture(key: string): Promise<Pick<NewJob, 'resultImageId' | 'costUsd'>> {
  const [last] = await store.jobs.listJobs({ key, status: ['done', 'failed'], limit: 1 })
  if (last?.status !== 'failed' || !last.resultImageId) return {}
  if (!(await store.getBlob(last.resultImageId))) return {}
  return { resultImageId: last.resultImageId, costUsd: last.costUsd }
}

let lastPrune = 0
/**
 * Old finished records are let go from the web side too (the inline queue has no worker to do it), at most every
 * ten minutes — and so is the sweep for ended jobs whose hold was never settled (slice 20), for the same reason.
 */
function prune(): void {
  if (Date.now() - lastPrune < 10 * 60_000) return
  lastPrune = Date.now()
  void sweepUnsettled()
  store.jobs.pruneJobs(new Date(Date.now() - KEEP_FINISHED_MS).toISOString()).catch((err: unknown) => {
    console.warn('[queue] could not prune finished job records:', err instanceof Error ? err.message : err)
  })
}

/**
 * Whose the job is (slice 19): the owner of the project it draws for. The
 * engines that queue work (`lib/panels.ts`, `lib/sheet.ts`, `lib/director.ts`)
 * pass `local` because they only know a project id; the route has already
 * checked the caller owns that project, so the project's owner is the caller.
 * An explicit owner is kept as given.
 */
async function ownerFor(input: NewJob): Promise<string> {
  if (input.ownerId !== LOCAL_OWNER) return input.ownerId
  return (await store.readProject(input.projectId)).ownerId ?? LOCAL_OWNER
}

export async function enqueueJob(request: NewJob): Promise<Enqueued> {
  const settings = queueSettings()
  const input: NewJob = { ...request, ownerId: await ownerFor(request) }

  const existing = await activeJob(input.key)
  if (existing) return { job: existing, created: false }
  await assertCanEnqueue(input.ownerId)
  prune()

  // The hold comes after every check that needs no money and before the record: a refusal (the person's
  // quota, their dollar cap, the studio's pause, a counter store that is down) leaves nothing behind. The id is
  // made first because settle and release are idempotent on it. Everything the record needs that can be read is
  // read first, so the only thing between the hold and the record is the write itself: a process that dies in
  // that gap leaves a hold nothing tracks (a unit and an estimate until the day resets), and the gap is one write wide.
  const id = randomUUID()
  const stranded = await strandedPicture(input.key)
  const hold = await holdForJob({ id, ownerId: input.ownerId, kind: input.kind })

  // Written before it is queued, so there is never a queued job without a record.
  let inserted: Enqueued
  try {
    inserted = await store.jobs.insertJob(newJob({ ...input, ...stranded, ...hold }, id, new Date()))
  } catch (err) {
    if (hold.reservation === 'held') await releaseUnlinked(id)
    throw err
  }
  if (!inserted.created) {
    // Another request took the key first: its job is the answer, and this hold backs nothing.
    if (hold.reservation === 'held') await releaseUnlinked(id)
    return inserted
  }
  const job = inserted.job

  // The caps were checked before the insert, and requests racing each other all
  // saw room. Count again now that this one is in; a request that put the count
  // over backs out (two racers may both back out, which is the safe direction).
  const mine = await store.jobs.listJobs({ ownerId: input.ownerId, status: ACTIVE, limit: settings.userInflight + 2 })
  const everyone = mine.length > settings.userInflight ? mine : await store.jobs.listJobs({ status: ACTIVE, limit: settings.maxWaiting + 2 })
  const overOwner = mine.length > settings.userInflight
  if (overOwner || everyone.length > settings.maxWaiting) {
    await endJob(job.id, (j) => finish(j, { outcome: 'cancelled', error: overOwner ? TOO_MANY : BUSY }, new Date())).catch(() => {})
    throw new Refused(overOwner ? TOO_MANY : BUSY, overOwner ? 429 : 503)
  }

  try {
    await dispatch(job, priorityFor(Math.max(0, mine.length - 1)))
  } catch (err) {
    // Not queued, so not coming: end the record, or the reconciler would put it
    // on the queue later and the person would be charged for a click that said "busy".
    await endJob(job.id, (j) => finish(j, { outcome: 'cancelled', error: BUSY }, new Date())).catch(() => {})
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

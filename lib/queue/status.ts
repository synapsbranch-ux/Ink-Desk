// What the queue looks like from the web side (v3, slice 18): which jobs are
// really alive, what the studio should show about them, and whether the queue
// and its worker are up. Server only.
//
// A job is "alive" while its record says queued, or running with a lease that
// has not lapsed. On the inline queue a lapsed lease means the only process
// there is restarted; on the real queue BullMQ brings a stalled job back, so
// the web waits `ABANDON_GRACE_MS` longer before it calls one dead. This is
// what replaced the `serverRunId` rule (CR-1, CR-13): a panel is "inking" only
// while a live job holds its claim, however many web instances there are.
import 'server-only'
import { generationEnabled, generationTimeoutMs, queueSettings } from '../config'
import { read } from '../chapter'
import { store, type Check } from '../store'
import type { Desk, PageRef } from '../types'
import { ABANDON_GRACE_MS, ABANDONED, BUSY, abandon, isLive, visibleJobs, SHOW_FAILED_MS, type Activity, type JobRecord, type QueueState } from './jobs'
import { producerRedis, redisKey, within } from './redis'

const ACTIVE = ['queued', 'running'] as const

/** The longest a job may legitimately hold a claim: two attempts of the image call, the text call before a sheet, and margin. Past it nothing renews the lease and the stale floor lets the claim go (CR-13). */
export function maxRunMs(): number {
  return 2 * generationTimeoutMs() + 180_000
}

/** How long past a lapsed lease the web keeps believing in a job. */
export function leaseGraceMs(): number {
  return queueSettings().mode === 'bullmq' ? ABANDON_GRACE_MS : 0
}

export function isJobLive(job: JobRecord, now = new Date()): boolean {
  return isLive(job, now, leaseGraceMs())
}

/** A project's queued and running jobs, after letting go of any that are dead. */
export async function liveJobs(projectId: string, now = new Date()): Promise<JobRecord[]> {
  const jobs = await store.jobs.listJobs({ projectId, status: ACTIVE })
  const live: JobRecord[] = []
  for (const job of jobs) {
    if (isJobLive(job, now)) live.push(job)
    else {
      console.warn(`[queue] ${job.kind} job ${job.id} has no live worker (its lease lapsed); letting it go`)
      await store.jobs.updateJob(job.id, (j) => abandon(j, ABANDONED, now)).catch(() => {})
    }
  }
  return live
}

/** What the studio shows: the live jobs, and a failure still worth its sentence. */
export async function projectActivity(projectId: string, now = new Date()): Promise<{ activity: Activity; live: Set<string> }> {
  const jobs = await liveJobs(projectId, now)
  // Recent ones of any ending, so a failure that a newer job has since replaced can be told apart.
  const recent = await store.jobs.listJobs({
    projectId,
    updatedSince: new Date(now.getTime() - SHOW_FAILED_MS).toISOString(),
    limit: 100,
  })
  return { activity: { jobs: visibleJobs([...jobs, ...recent], now), queue: await queueState() }, live: new Set(jobs.map((j) => j.id)) }
}

/** The project's desk with its activity — the reply every generation route gives. */
export async function readWithActivity(projectId: string, at?: PageRef): Promise<Desk> {
  const desk = await read(projectId, at)
  const { activity } = await projectActivity(projectId)
  return { ...desk, activity }
}

// --- The queue itself ---------------------------------------------------------------

/** The worker writes this key every 15 s with a 45 s life; no key means nobody is drawing. */
export const HEARTBEAT_KEY = redisKey('heartbeat', 'worker')
export const HEARTBEAT_TTL_S = 45

export const NO_WORKER = 'The drawing worker isn’t running right now — your pages will ink as soon as it is back.'

type Cached = { at: number; state: QueueState }
type Pinned = { __inkdeskQueueState?: Cached }
const g = globalThis as typeof globalThis & Pinned

/** Redis and the worker, as the status line needs them. Cached for three seconds: every poll asks. Never throws. */
export async function queueState(): Promise<QueueState> {
  const settings = queueSettings()
  if (settings.mode === 'inline') return { mode: 'inline', state: 'ok', message: null }
  // A studio that cannot generate yet has no use for a queue; do not alarm anyone about it.
  if (!generationEnabled()) return { mode: 'bullmq', state: 'ok', message: null }
  const cached = g.__inkdeskQueueState
  if (cached && Date.now() - cached.at < 3_000) return cached.state
  const state = await probe()
  g.__inkdeskQueueState = { at: Date.now(), state }
  return state
}

/** Forget the cached answer — for the checks, which change Redis under it. */
export function forgetQueueState(): void {
  g.__inkdeskQueueState = undefined
}

async function probe(): Promise<QueueState> {
  try {
    const redis = producerRedis()
    await within(redis.ping())
    const beat = await within(redis.get(HEARTBEAT_KEY))
    return beat ? { mode: 'bullmq', state: 'ok', message: null } : { mode: 'bullmq', state: 'no-worker', message: NO_WORKER }
  } catch (err) {
    console.warn('[queue] the status probe could not reach Redis:', err instanceof Error ? err.message : err)
    return { mode: 'bullmq', state: 'busy', message: BUSY }
  }
}

/** For `/api/health`: Redis answers a ping, and a worker has beaten its heart lately. `n/a` where there is no queue to ask. */
export async function queueHealth(timeoutMs: number): Promise<{ redis: Check; worker: Check }> {
  const settings = queueSettings()
  if (settings.mode === 'inline' || !settings.redisUrl) return { redis: 'n/a', worker: 'n/a' }
  try {
    const redis = producerRedis()
    await within(redis.ping(), timeoutMs)
    const beat = await within(redis.get(HEARTBEAT_KEY), timeoutMs)
    return { redis: 'ok', worker: beat ? 'ok' : 'down' }
  } catch {
    return { redis: 'down', worker: 'down' }
  }
}

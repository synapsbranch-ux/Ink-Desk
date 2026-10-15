// Where the counters live (v3, slice 20): a seam with two implementations.
//
//   redis   the real one. Sliding windows, the daily quota counters, the spend
//           ledgers and the reservation markers are Redis keys under the
//           studio's `inkdesk:` prefix, changed by Lua scripts so that two
//           requests on two instances cannot both pass a cap. Every command is
//           bounded by the queue's own timeout.
//   memory  the same rules in this process: a bare dev desk and the checks.
//           Never used where strangers are — production without Redis has no
//           backend at all (`unavailable`), and says the studio is busy to
//           anything that spends.
//
// `check:limits` drives one script through both and compares every answer.
// See `devpost/spec.md > Limits, Quotas and the Kill Switch (v3)`.
import 'server-only'
import { limitsSettings, redisUrl } from '../config'
import { isProduction } from '../auth/config'
import { createMemoryBackend } from './memory'
import { createRedisBackend } from './redis'
import type { Caps, Counters, Hold, Refusal, Units } from './rules'

/** A sliding-window hit: allowed, or refused with how long until a slot frees. */
export type HitResult = { ok: true } | { ok: false; retryAfterMs: number }

export type ReserveInput = {
  /** The job id, or the id of a text call or a new project — what settle and release are idempotent on. */
  id: string
  userId: string
  units: Units
  usdMicros: number
  caps: Caps
  /** True for a hold no job record backs: it is swept if never settled. */
  tracked: boolean
}

export type ReserveResult = { ok: true; duplicate: boolean } | ({ ok: false } & Refusal)

export type FinishInput = {
  /** What was really spent, in micro-dollars; null keeps the reserved estimate. */
  actualMicros: number | null
  /** Give the quota units back (a job that failed). */
  refundUnits: boolean
}

export interface LimitsBackend {
  readonly kind: 'redis' | 'memory'
  /** Record a hit in the `bucket` window of `id` if it fits `limit` per `windowMs`; a refused hit is not recorded. */
  hit(bucket: string, id: string, limit: number, windowMs: number): Promise<HitResult>
  /** Check every cap and, if all pass, raise ALL the counters and write the hold — or change nothing. Atomic. */
  reserve(input: ReserveInput): Promise<ReserveResult>
  /** Settle or release the hold `id`: adjust the counters it raised, then remove it. `gone` when nothing is held (already settled, never reserved, or expired). Atomic and idempotent. */
  finish(id: string, how: FinishInput): Promise<'done' | 'gone'>
  /** The person's counters for today and this month, with the studio's, read together. */
  counters(userId: string): Promise<Counters>
  /** Ids of tracked holds past their deadline (never settled). */
  orphans(limit?: number): Promise<string[]>
  /** The hold `id` records, or null. */
  hold(id: string): Promise<Hold | null>
  /** A key's value and time to live (milliseconds), for the checks. Relative key name, without the prefix. */
  peek(key: string): Promise<{ value: number | null; ttlMs: number | null }>
}

/** Thrown by anything that needs counters when there is nowhere to keep them. */
export class LimitsUnavailable extends Error {
  constructor(message = 'The limits have nowhere to keep their counters.') {
    super(message)
    this.name = 'LimitsUnavailable'
  }
}

type Pinned = { __inkdeskLimits?: { key: string; backend: LimitsBackend } }
const g = globalThis as typeof globalThis & Pinned

const unavailable: LimitsBackend = {
  kind: 'memory',
  hit: () => Promise.reject(new LimitsUnavailable()),
  reserve: () => Promise.reject(new LimitsUnavailable()),
  finish: () => Promise.reject(new LimitsUnavailable()),
  counters: () => Promise.reject(new LimitsUnavailable()),
  orphans: () => Promise.reject(new LimitsUnavailable()),
  hold: () => Promise.reject(new LimitsUnavailable()),
  peek: () => Promise.reject(new LimitsUnavailable()),
}

/**
 * The backend this process uses: Redis whenever REDIS_URL is set; otherwise
 * the in-process one on a development desk and in the checks, and none in
 * production (a web service with generation closed may run without Redis, and
 * then nothing can spend). Pinned to `globalThis`, so Next's separate route
 * bundles share one memory backend, and rebuilt if REDIS_URL changes.
 */
export function backend(): LimitsBackend {
  const url = redisUrl()
  const key = url ? 'redis' : isProduction() ? 'none' : 'memory'
  const pinned = g.__inkdeskLimits
  if (pinned?.key === key) return pinned.backend
  const made = key === 'redis' ? createRedisBackend() : key === 'memory' ? createMemoryBackend() : unavailable
  g.__inkdeskLimits = { key, backend: made }
  return made
}

/** Forget the pinned backend and its memory — for the checks. */
export function resetBackend(): void {
  g.__inkdeskLimits = undefined
}

/** The ceilings for a plan, from the environment as it is now. */
export function capsFor(plan: 'free' | 'allowlisted'): Caps {
  const s = limitsSettings()
  const p = s.plans[plan]
  return {
    quota: { image: p.image, project: p.project, videoSeconds: p.videoSeconds, audioChars: p.audioChars },
    userDailyMicros: Math.round(p.dailyUsd * 1e6),
    globalDailyMicros: Math.round(s.globalDailyUsd * 1e6),
    globalTotalMicros: s.globalTotalUsd === null ? null : Math.round(s.globalTotalUsd * 1e6),
  }
}

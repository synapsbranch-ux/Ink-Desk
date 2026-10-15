// Reserve, settle, release (v3, slice 20) — the spend reservation. Server only.
//
// BEFORE anything is paid for, `reserve` asks the backend, atomically, whether
// the spend fits the person's quotas and dollar cap, the studio's daily cap and
// the optional total cap, and raises ALL the counters or NONE: parallel
// requests cannot over-spend, because the check and the increments are one
// step. When the work ends, `settle` replaces the estimate with what the
// provider really billed (`usage.cost`), and `release` gives a failed job's
// quota and estimate back. Both are idempotent per id: the second finds nothing
// held and does nothing — which is what lets the reconciler repair a crash
// between a job's ending and its settle.
//
// Redis down (or absent in production) fails CLOSED here: the caller gets the
// studio-busy sentence and nothing is spent. See `devpost/spec.md > Limits,
// Quotas and the Kill Switch (v3)` and `> Failure Modes (v3)`.
import 'server-only'
import { Refused } from '../errors'
import { creditsBreakerOpen } from '../queue/breaker'
import { BUSY, PAUSED } from '../queue/jobs'
import { backend, capsFor } from './backend'
import { nowMs } from './clock'
import { describeRefusal, evaluate, toMicros, type Units } from './rules'
import { planOf } from './plan'

export type ReserveRequest = {
  /** A job id, or any unique id for a call or a project: what settle and release are idempotent on. */
  id: string
  userId: string
  units: Units
  /** The estimate, in dollars, held against the caps. */
  usd: number
  /** True for a hold no job record backs (a text call, a new project): swept if never settled. */
  tracked?: boolean
}

/** The refusal as a `Refused` carrying its `RefusalBody` fields. */
function refused(info: ReturnType<typeof describeRefusal>): Refused {
  return new Refused(info.message, info.status, { code: info.code, ...(info.resetsAt ? { resetsAt: info.resetsAt } : {}) })
}

/** The studio-busy refusal for a counter store that did not answer. */
function busy(err: unknown, what: string): Refused {
  console.warn(`[limits] ${what} — the counters did not answer:`, err instanceof Error ? err.message : err)
  return new Refused(BUSY, 503)
}

/**
 * The credit breaker is the studio's pause too (an out-of-credit 402 was seen): the usage view tells every screen
 * that generation is paused for everyone, so the server refuses every spend, a text call and a new project included —
 * what the meter shows is what is enforced. Waiting jobs and new ones are held to the same breaker by the queue.
 */
async function assertCreditsOpen(): Promise<void> {
  if (await creditsBreakerOpen()) throw new Refused(PAUSED, 503, { code: 'paused' })
}

/**
 * Hold this spend against every cap, or throw `Refused` (429 for a person's
 * own limit, 503 for the studio's pause or a counter store that is down) and
 * change nothing.
 */
export async function reserve(req: ReserveRequest): Promise<void> {
  await assertCreditsOpen()
  const caps = capsFor(await planOf(req.userId))
  let result
  try {
    result = await backend().reserve({ id: req.id, userId: req.userId, units: req.units, usdMicros: toMicros(req.usd), caps, tracked: req.tracked ?? false })
  } catch (err) {
    throw busy(err, 'reserve')
  }
  if (!result.ok) throw refused(describeRefusal(result, caps, nowMs()))
}

/**
 * The same checks as `reserve`, with nothing changed: for a route that must
 * know a spend would fit BEFORE it pays for something else first (Rewrite asks
 * before it pays Claude to rephrase a panel it could not then draw).
 */
export async function preflight(userId: string, units: Units, usd: number): Promise<void> {
  await assertCreditsOpen()
  const caps = capsFor(await planOf(userId))
  let counters
  try {
    counters = await backend().counters(userId)
  } catch (err) {
    throw busy(err, 'preflight')
  }
  const verdict = evaluate(counters, caps, units, toMicros(usd))
  if (!verdict.ok) throw refused(describeRefusal(verdict, caps, nowMs()))
}

/** Replace the hold `id`'s estimate with what was really spent (dollars); the quota units stay used. Idempotent. Throws if the counters did not answer — the caller decides whether to retry or let the sweep do it. */
export async function settle(id: string, actualUsd: number | null): Promise<'done' | 'gone'> {
  return backend().finish(id, { actualMicros: actualUsd === null ? null : toMicros(actualUsd), refundUnits: false })
}

/** The hold `id` ends in failure: its quota units come back, and the dollars it really spent (a picture paid for and never landed) stay counted. Idempotent. */
export async function release(id: string, spentUsd = 0): Promise<'done' | 'gone'> {
  return backend().finish(id, { actualMicros: toMicros(spentUsd), refundUnits: true })
}

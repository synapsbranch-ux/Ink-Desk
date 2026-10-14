// The credit breaker (CR-10). A 402 from the image provider means the account
// is out of credit, and every other job waiting would fail the same way — each
// printing its own banner and each costing a round trip. The first 402 trips
// this; until it resets, new work is refused with one calm sentence and waiting
// jobs fail at once without calling anyone. It resets by itself after
// `BREAKER_MS`, so a top-up needs no restart.
//
// In the process it is a plain timestamp; on the real queue it is also a
// Redis key with a time to live, so the worker that saw the 402 tells the web
// service (and every other worker). The global daily spend cap of slice 20
// takes over the "paused for today" message; this is only the credit floor.
import 'server-only'
import { queueSettings } from '../config'
import { PREFIX, producerRedis, redisKey, within } from './redis'

export const BREAKER_MS = 10 * 60_000
const KEY = redisKey('breaker', 'credits')

type Pinned = { __inkdeskBreakerUntil?: number }
const g = globalThis as typeof globalThis & Pinned

/** Open the breaker for `BREAKER_MS`. Best effort on Redis: the local flag is set first and always. */
export async function tripCredits(): Promise<void> {
  g.__inkdeskBreakerUntil = Date.now() + BREAKER_MS
  console.error('[queue] image credits are out (402) — generation is paused for a few minutes')
  if (queueSettings().mode !== 'bullmq') return
  try {
    await within(producerRedis().set(KEY, '1', 'PX', BREAKER_MS))
  } catch (err) {
    console.warn('[queue] could not share the credit breaker through Redis:', err instanceof Error ? err.message : err)
  }
}

/** Is it open? Redis being unreachable never opens it (that is a different sentence). */
export async function creditsBreakerOpen(): Promise<boolean> {
  if ((g.__inkdeskBreakerUntil ?? 0) > Date.now()) return true
  if (queueSettings().mode !== 'bullmq') return false
  try {
    const open = (await within(producerRedis().exists(KEY))) === 1
    if (open) g.__inkdeskBreakerUntil = Date.now() + 30_000 // remember for a moment: no Redis round trip per poll
    return open
  } catch {
    return false
  }
}

/** For the checks. */
export function resetBreaker(): void {
  g.__inkdeskBreakerUntil = 0
}

export { PREFIX }

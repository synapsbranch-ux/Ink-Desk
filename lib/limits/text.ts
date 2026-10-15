// The text calls that stay in the request (v3, slice 20) — synopsis, cast,
// reroll, rewrite, the Director's plan, the page script, the import's DNA read.
// Each takes a small estimated hold BEFORE the provider is called, is settled
// to the meter's real `costUsd` afterwards, and is released if the call fails
// (what a failed call already spent still counts). The rate window for these is
// the `text` bucket, taken by `requireUser` (`requests.ts`). Server only.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { limitsEnabled } from '../config'
import { ProviderError } from '../errors'
import { textMeter, type TextMeter } from '../llm'
import { tripCredits } from '../queue/breaker'
import { TEXT_ESTIMATE_USD, type TextKind } from './estimate'
import { release, reserve, settle } from './hold'

/**
 * Run `work` — a route's text call(s), given a fresh meter — under a hold of
 * this kind's estimate. A refusal throws `Refused` before `work` starts, so a
 * refused click costs nothing. With the limits off it is just `work(meter)`.
 */
export async function spendText<T>(userId: string, what: TextKind, work: (meter: TextMeter) => Promise<T>): Promise<T> {
  const meter = textMeter()
  if (!limitsEnabled()) return work(meter).catch(tripOnCredits)
  const id = `text-${randomUUID()}`
  await reserve({ id, userId, units: {}, usd: TEXT_ESTIMATE_USD[what], tracked: true })
  try {
    const out = await work(meter)
    await settle(id, meter.costUsd).catch(logLater(id))
    return out
  } catch (err) {
    // Whatever the provider already billed before the failure still counts; the estimate does not.
    await release(id, meter.costUsd).catch(logLater(id))
    return tripOnCredits(err)
  }
}

/** An account out of credit is out for the pictures too: the studio pauses for everyone, as it does when a picture finds out. Rethrows. */
async function tripOnCredits(err: unknown): Promise<never> {
  if (err instanceof ProviderError && err.code === 'credits') await tripCredits()
  throw err
}

/** A hold that could not be settled right now is swept at its estimate later; say so, and carry on with the person's result. */
const logLater = (id: string) => (err: unknown) => {
  console.warn(`[limits] could not settle the text hold ${id} yet; the sweep will:`, err instanceof Error ? err.message : err)
}

/**
 * A new project takes today's project quota (no dollars): held before it is
 * created, kept once it exists, given back if creating it fails.
 */
export async function spendProject<T>(userId: string, work: () => Promise<T>): Promise<T> {
  if (!limitsEnabled()) return work()
  const id = `project-${randomUUID()}`
  await reserve({ id, userId, units: { project: 1 }, usd: 0, tracked: true })
  try {
    const out = await work()
    await settle(id, 0).catch(logLater(id))
    return out
  } catch (err) {
    await release(id, 0).catch(logLater(id))
    throw err
  }
}

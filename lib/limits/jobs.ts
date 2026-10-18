// A job's hold, from the enqueue to the ending (v3, slice 20). Server only.
//
//   holdForJob     at the door, before the record is written: reserve the
//                  picture's quota unit and estimated dollars, or refuse.
//   settleEnded    when a job ends — for ANY reason — settle it to what it
//                  really cost (done) or release it (everything else), then
//                  mark the record `settled`. Never throws: a settle that
//                  could not land leaves the record `held`, and the sweep
//                  repairs it.
//   sweepUnsettled the backstop: ended jobs still `held` (a crash between the
//                  ending and the settle) are settled now, and holds no job
//                  backs (a text call, a new project) that were never settled
//                  are let go at their estimate. Idempotent, so any number of
//                  sweepers may run at once.
//
// Cost arithmetic: what a job is charged is its `costUsd` less `carriedUsd`,
// the cost an earlier job of the same key already had counted when its picture
// was paid for and never landed (CR-16) — so that picture is counted once, at
// the job that paid, and the job that only attaches it is charged nothing.
import 'server-only'
import { limitsEnabled } from '../config'
import { store } from '../store'
import { LOCAL_OWNER, reservationOf, settled, type JobRecord, type ReservationState } from '../queue/jobs'
import { backend } from './backend'
import { jobSpend, type Spend } from './estimate'
import { release, reserve, settle } from './hold'

/**
 * Reserve for a job that is about to be written. `none` when limits are off or the kind spends nothing here. Throws `Refused`.
 *
 * `spend` is what the caller says the job will use, for the kinds whose spend is not fixed by the kind (slice 22: a
 * `trailer`, held for its whole plan at once). A `trailer` with limits on and no `spend` is a bug in the caller, not a
 * person's mistake — it would run unmetered — so it throws a plain Error and nothing is held.
 */
export async function holdForJob(job: { id: string; ownerId: string; kind: JobRecord['kind']; spend?: Spend }): Promise<{ reservation: ReservationState; reservedUsd: number }> {
  if (!limitsEnabled()) return { reservation: 'none', reservedUsd: 0 }
  if (job.kind === 'trailer' && !job.spend) throw new Error('a trailer job must be enqueued with the spend its plan will use (limits are on)')
  const spend = job.spend ?? jobSpend(job.kind)
  if (!spend) return { reservation: 'none', reservedUsd: 0 }
  if (!Number.isFinite(spend.usd) || spend.usd < 0 || Object.values(spend.units).some((n) => !Number.isFinite(n) || (n ?? 0) < 0)) {
    throw new Error(`a job's spend must be finite and not negative, got ${JSON.stringify(spend)}`)
  }
  await reserve({ id: job.id, userId: job.ownerId || LOCAL_OWNER, units: spend.units, usd: spend.usd })
  return { reservation: 'held', reservedUsd: spend.usd }
}

// Known, accepted gap: a process that dies between the reserve and the insert (one write wide: the reads come first) leaves a hold no record backs. It keeps a unit
// and an estimate until the day resets. Tracking it would only let the sweep settle it at its estimate — the same counters — so it is left untracked.

/** Give back a hold whose job record never came to be (the insert failed, or another request already held the key). Never throws: the hold is the only trace, and the sweep does not know it — so a failure is logged loudly. */
export async function releaseUnlinked(id: string): Promise<void> {
  try {
    await release(id)
  } catch (err) {
    console.error(`[limits] could not release the hold for ${id}; its quota stays used until the day resets:`, err instanceof Error ? err.message : err)
  }
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/** What the counters should say this ended job cost, and whether its quota comes back. */
export function settlementOf(job: JobRecord): { actualUsd: number | null; refund: boolean } {
  const carried = job.carriedUsd ?? 0
  const own = Math.max(0, round6(job.costUsd - carried))
  const done = job.outcome === 'done'
  // A trailer that billed anything keeps its seconds used, however it ended (slice 22): its runner keeps `costUsd` on the
  // job as it goes (what was billed and what is still with the providers), so an ending written by the worker's ceiling,
  // a dead lease let go or a cancel counts that money instead of giving the hold back at nothing.
  if (job.kind === 'trailer' && own > 0) return { actualUsd: own, refund: false }
  // A picture that came back with no cost reported, drawn by this job itself: it was paid for, so the estimate stands rather than a free one.
  if (done && job.costUsd <= 0 && carried <= 0) return { actualUsd: null, refund: false }
  return { actualUsd: own, refund: !done }
}

/** Settle or release an ended job's hold, once. Safe to call for any job and any number of times. */
export async function settleEnded(job: JobRecord): Promise<void> {
  if (reservationOf(job) !== 'held') return
  const { actualUsd, refund } = settlementOf(job)
  try {
    if (refund) await release(job.id, actualUsd ?? 0)
    else await settle(job.id, actualUsd)
    await store.jobs.updateJob(job.id, (j) => settled(j))
  } catch (err) {
    console.warn(`[limits] could not settle ${job.kind} job ${job.id} yet; the sweep will:`, err instanceof Error ? err.message : err)
  }
}

export type Swept = { settled: number; orphans: number }

/** Settle every ended job still `held`, and let go of holds nothing settled. Never throws. */
export async function sweepUnsettled(): Promise<Swept> {
  const swept: Swept = { settled: 0, orphans: 0 }
  try {
    const stuck = await store.jobs.listJobs({ reservation: 'held', status: ['done', 'failed'], limit: 500 })
    for (const job of stuck) {
      await settleEnded(job)
      swept.settled++
    }
    if (!limitsEnabled()) return swept
    const b = backend()
    for (const id of await b.orphans()) {
      // Nobody told us what it cost: the estimate stands, the quota stays used.
      await b.finish(id, { actualMicros: null, refundUnits: false })
      swept.orphans++
    }
  } catch (err) {
    console.warn('[limits] the sweep for unsettled holds could not finish:', err instanceof Error ? err.message : err)
  }
  if (swept.settled || swept.orphans) console.log(`[limits] settled ${swept.settled} ended job${swept.settled === 1 ? '' : 's'} and ${swept.orphans} unbacked hold${swept.orphans === 1 ? '' : 's'}`)
  return swept
}

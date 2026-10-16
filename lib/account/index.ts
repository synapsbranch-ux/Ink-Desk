// The two account jobs (v3, slice 21): an EXPORT of a person's data, and the
// DELETION of their account. Both run on the `account` queue, one at a time per
// worker (`lib/queue/jobs.ts > QUEUE_OF`), dispatched by `lib/queue/processors.ts`
// — which imports this module lazily, so a web bundle that only enqueues never
// carries it — and both are plain functions of the job record and its run: no
// queue code in here. See `devpost/spec.md > Settings, Usage, Terms and Privacy
// (v3)` and the order of steps in the slice 21 contract.
//
// THE SIGNATURES BELOW ARE THE CONTRACT with the processor and stay fixed. The
// work is split by what it does: `export.ts` (the zip) with `zip.ts`, and
// `deletion.ts` (the sweep) with `clerk.ts` and `counters.ts`; `keys.ts` names
// where an account's files live and `state.ts` is what the three routes tell the
// person. A `delete-account` job that ends `failed` keeps its record; only
// `done` deletes it.
//
//   runExport(job, run)         zip the owner's data into the outputs store at
//                               `exports/<ownerId>/<jobId>.zip`; keep only the
//                               latest. `job.ownerId` is whose data it is.
//   runDeleteAccount(job, run)  the idempotent sweep, in the contract's order,
//                               ending with the verification loop. May throw
//                               (BullMQ retries, the reconciler re-runs); every
//                               step must be safe to repeat.
//
// Both return an `Outcome` and never throw for something that is the job's own
// result (a size cap, a refusal); they throw only for a store that failed
// mid-way, which the queue retries.
import 'server-only'
import type { JobRecord } from '../queue/jobs'
import type { JobRun, Outcome } from '../queue/run'
import { deleteAccount, productionDeps } from './deletion'
import { makeExport } from './export'

export async function runExport(job: JobRecord, run: JobRun): Promise<Outcome> {
  void run // an export draws nothing, so there is no picture to checkpoint
  return makeExport(job)
}

export async function runDeleteAccount(job: JobRecord, run: JobRun): Promise<Outcome> {
  void run
  return deleteAccount(job, productionDeps())
}

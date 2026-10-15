// The one way a job's record is ended (v3, slice 20). Server only.
//
// A job holds a reservation from the moment it is enqueued (quota unit,
// estimated dollars). EVERY path that ends one — the processor, an enqueue
// back-out, a dead job the web lets go, a boot sweep, a worker whose retries ran
// out, the reconciler failing a poison job — goes through here, so the hold is
// settled to the real cost (done) or released (anything else) exactly when the
// ending is written. A path that is missed, or a crash between the ending and
// the settle, is repaired by `sweepUnsettled`; settling is idempotent per job
// id, so the two can never both count it.
import 'server-only'
import { settleEnded } from '../limits/jobs'
import { store } from '../store'
import { isActive, type JobRecord } from './jobs'

/** `store.jobs.updateJob`, and when that write ends the job, settle its hold. Never throws past the store's own errors. */
export async function endJob(id: string, fn: (job: JobRecord) => JobRecord | null): Promise<JobRecord | null> {
  const ended = await store.jobs.updateJob(id, fn)
  if (ended && !isActive(ended)) await settleEnded(ended)
  return ended
}

// Is a trailer's job still alive? (v3, slice 22.) Server only. The web's version
// of the stale-claim rule that panels have (`lib/queue/status.ts`): a trailer
// record says `queued` or `making` for as long as a worker is at it, and the
// record cannot tell by itself that the worker is gone. When the studio restarts
// mid-trailer (the inline queue lives in the web process; a worker can be killed)
// nothing would ever write the record again — it would read "making" forever and
// the one-trailer-at-a-time key would look taken.
//
// So every read that shows a trailer (`GET /api/videos/[id]`, the page's estimate,
// the dashboard) first asks `settleStaleVideo`: if the record is still open and no
// live `trailer` job names it, the record is ended `failed` with the restart
// sentence, and whatever was in flight is put where a person can act on it
// (`recoverShots`: a shot cut off mid-send is `orphaned`, one nobody will collect
// is `orphaned`, one that never started is `failed`) — so Try again is offered and
// the person is never left looking at a spinner that will not end.
//
// Two guards keep it from being wrong:
//   • A record is written BEFORE its job is enqueued (and `queueRetry` re-opens
//     one before the retry's job exists), so a record touched in the last moment
//     is given a few seconds' grace before a missing job counts against it.
//   • "Alive" is the queue's own definition (`isJobLive`): queued, or running with
//     a lease that has not lapsed (plus BullMQ's grace on the real queue).
import 'server-only'
import { store } from '../store'
import { isJobLive } from '../queue/status'
import type { JobRecord } from '../queue/jobs'
import type { VideoRecord } from '../share/types'
import { STUDIO_RESTARTED, markVideoFailed, recoverShots, viewOfVideo } from './record'
import type { VideoView } from './types'

/** A record younger than this (since its last write) is not yet judged by its job: the job is being written beside it. */
export const JOB_GRACE_MS = 15_000

const OPEN = ['queued', 'running'] as const

/** The live `trailer` job that is making this video, if there is one. */
export async function liveTrailerJob(record: Pick<VideoRecord, 'id' | 'ownerId'>, now = new Date()): Promise<JobRecord | null> {
  const jobs = await store.jobs.listJobs({ ownerId: record.ownerId, status: OPEN })
  return jobs.find((j) => j.payload.kind === 'trailer' && j.payload.videoId === record.id && isJobLive(j, now)) ?? null
}

/** Is a worker (or the inline queue) at this video right now? */
export async function isVideoRunning(record: VideoRecord, now = new Date()): Promise<boolean> {
  return (await liveTrailerJob(record, now)) !== null
}

/**
 * A `queued`/`making` record whose trailer job is gone is ended `failed` ("The
 * studio restarted before this finished. Try again."), with its in-flight shots
 * settled. Returns the fresh record — the same one when nothing was wrong. Never
 * touches a finished record, and never a young one (see `JOB_GRACE_MS`).
 */
export async function settleStaleVideo(record: VideoRecord, now = new Date()): Promise<VideoRecord> {
  if (record.status !== 'queued' && record.status !== 'making') return record
  if (now.getTime() - Date.parse(record.updatedAt) < JOB_GRACE_MS) return record
  if (await isVideoRunning(record, now)) return record

  console.warn(`[trailer ${record.id.slice(0, 8)}] its job is gone; ending it as failed so it can be tried again`)
  const settled = await store.videos.update(record.id, (v) => {
    if (v.status !== 'queued' && v.status !== 'making') return null
    return markVideoFailed(recoverShots(v, now, { jobGone: true }), STUDIO_RESTARTED, now)
  })
  return settled ?? (await store.videos.get(record.id)) ?? record
}

/** A trailer as a browser may see it: settled first, and with Try again offered only when nothing is running. For the routes. */
export async function videoViewOf(record: VideoRecord, now = new Date()): Promise<VideoView> {
  const fresh = await settleStaleVideo(record, now)
  const running = fresh.status === 'queued' || fresh.status === 'making' ? await isVideoRunning(fresh, now) : false
  return viewOfVideo(fresh, { running })
}

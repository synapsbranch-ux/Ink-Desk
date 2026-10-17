// Process-level state that has to be genuinely single. Next.js re-evaluates
// module scope on every hot reload, and each route handler gets its own
// bundle, so a plain module-level `let` would quietly become several copies —
// a second lock brings the lost-update bug straight back, a second queue runs
// four generations instead of two. `globalThis` survives both.
// See `devpost/spec.md > Components > Singletons and the Dev Server`.
import { randomUUID } from 'node:crypto'
import { ACCOUNT_CONCURRENCY, generationTimeoutMs, imageConcurrency, videoSettings } from './config'
import { ACCOUNT_CEILING_MS, TRAILER_RUN_MS } from './queue/jobs'
import { createQueue, type Queue } from './queue/memory'

type InkDeskGlobals = {
  /** Stamped once per real process; changes on restart, not on hot reload. */
  serverRunId: string
  /** The tail of each project's update chain, keyed by project id (v2: one
   *  lock per project, so two projects never wait on each other). Reassigned
   *  by the store's `updateProject()`. */
  locks: Map<string, Promise<unknown>>
  /** The inline queue (`INKDESK_QUEUE=inline`): this process runs the jobs, `QUEUE_CONCURRENCY_IMAGE` wide
   *  (else `PANEL_CONCURRENCY`). Under `bullmq` nothing is queued here; a worker service runs them. */
  queue: Queue
  /** The inline queue's `account` lane (slice 21): an export or a deletion runs here, one at a time, never in an image slot. */
  accountQueue: Queue
  /** The inline queue's `video` lane (slice 22): a trailer runs here, `QUEUE_CONCURRENCY_VIDEO` wide (default 1), never in an image slot — a trailer is up to twenty-five minutes. */
  videoQueue: Queue
}

/** What the inline queue cuts a trailer off at (and the worker's `video` lane, the same sum): the longest a trailer may run and a margin for its lease to lapse. */
const TRAILER_CEILING_MS = TRAILER_RUN_MS + 2 * 60_000

/** How many trailers the inline queue makes at once. A malformed setting is reported where the config is checked (boot, the worker); here it must not take down every route, so it falls back to one. */
function videoConcurrency(): number {
  try {
    return videoSettings().concurrency
  } catch {
    return 1
  }
}

const g = globalThis as typeof globalThis & { __inkdesk?: InkDeskGlobals }

export const singletons: InkDeskGlobals = (g.__inkdesk ??= {
  serverRunId: randomUUID(),
  locks: new Map(),
  // Validated in `lib/config.ts` (CR-15): a blank value is the default, not 0.
  // The ceiling (CR-6) is past a job's own retried image call, so it only
  // ever frees a slot that something stuck is holding.
  queue: createQueue(imageConcurrency(), 2 * generationTimeoutMs() + 60_000),
  accountQueue: createQueue(ACCOUNT_CONCURRENCY, ACCOUNT_CEILING_MS),
  videoQueue: createQueue(videoConcurrency(), TRAILER_CEILING_MS),
})

// A dev server that was already running when this lane was added still holds the older object on `globalThis`.
singletons.accountQueue ??= createQueue(ACCOUNT_CONCURRENCY, ACCOUNT_CEILING_MS)
singletons.videoQueue ??= createQueue(videoConcurrency(), TRAILER_CEILING_MS)

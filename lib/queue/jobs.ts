// The job record and its state machine (v3, slice 18). Mongo — or, on a local
// desk, `data/jobs/` — is the source of truth for every generation: a job is
// written `queued` BEFORE it goes on the queue, claimed `running` by whoever
// takes it, and ends `done` or `failed`. Redis (BullMQ) only decides who runs
// it next; losing Redis loses no history, and a reconciler puts back whatever
// Redis no longer holds. See `devpost/spec.md > Queue and Worker (v3)`,
// `> Data Model (v3)` and `> As built — slice 18`.
//
// Pure: every transition is a function from a record to the next record (or
// `null`, meaning "not allowed from here"), so the local store, the Mongo
// store and the checks all apply the same rules and the stores only have to
// make the swap atomic. No Node imports — the browser shares `JobView`.

// --- What a job is --------------------------------------------------------------

export type JobKind = 'sheet' | 'panel' | 'cover' | 'text' | 'shot' | 'speech' | 'music' | 'assemble' | 'export' | 'delete-account'

export const QUEUE_NAMES = ['image', 'video', 'audio'] as const
export type QueueName = (typeof QUEUE_NAMES)[number]

/** Which BullMQ queue runs a kind. Only the image kinds have processors in slice 18. */
export const QUEUE_OF: Record<JobKind, QueueName> = {
  sheet: 'image',
  panel: 'image',
  cover: 'image',
  text: 'image',
  shot: 'video',
  assemble: 'video',
  speech: 'audio',
  music: 'audio',
  export: 'audio',
  'delete-account': 'audio',
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

/** Why a finished job finished. `done` is the only success; the rest are `failed`. */
export type JobOutcome = 'done' | 'failed' | 'refused' | 'skipped' | 'abandoned' | 'cancelled'

/** What each kind needs to run, beside the project it belongs to. */
export type JobPayload =
  | { kind: 'panel'; chapterId: string; pageIndex: number; index: number }
  | { kind: 'cover'; chapterId: string }
  | { kind: 'sheet'; characterId: string; reuseDna: boolean }

export type JobRecord = {
  id: string
  /** What makes two requests the same work: while a job with this key is
   *  `queued` or `running`, asking again returns that job instead of a second. */
  key: string
  /** Whose work it is. `LOCAL_OWNER` until accounts arrive in slice 19. */
  ownerId: string
  projectId: string
  kind: JobKind
  queue: QueueName
  payload: JobPayload
  status: JobStatus
  outcome: JobOutcome | null
  /** How many times a worker has claimed it (a stalled job is claimed again). */
  attempts: number
  /** What the limits layer reserved for it (slice 20); 0 until then. */
  reservedUsd: number
  /** What the provider billed, as far as this job knows. */
  costUsd: number
  /** A sentence the browser may show; never internals. */
  error: string | null
  /** The checkpoint that makes a re-run free: once the picture is in the
   *  bucket its id is saved here, and a re-run attaches it instead of drawing
   *  again. */
  resultImageId: string | null
  /** For a paid provider job (video, slice 22); null for images. */
  providerJobId: string | null
  workerId: string | null
  /** A running job's claim holds until here; the worker renews it. */
  leaseUntil: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
}

/** The owner on a desk without accounts (`INKDESK_AUTH=off`). */
export const LOCAL_OWNER = 'local'

// --- Time -----------------------------------------------------------------------

/** A running job's claim lasts this long past each renewal. */
export const LEASE_MS = 120_000
/** The worker renews this often — well inside the lease, well outside a tick. */
export const LEASE_RENEW_MS = 20_000
/** On the real queue a lapsed lease is BullMQ's to recover (it re-delivers a
 *  stalled job); the web only calls a job dead after this much longer. */
export const ABANDON_GRACE_MS = 10 * 60_000
/** A `queued` record this old that Redis does not hold is put back on the queue. */
export const REQUEUE_AFTER_MS = 30_000
/** Finished records are kept this long, for the card that says what failed. */
export const KEEP_FINISHED_MS = 7 * 24 * 3600_000
/** A failed job's sentence stays on its card this long. */
export const SHOW_FAILED_MS = 10 * 60_000

// --- The sentences --------------------------------------------------------------

export const BUSY = 'The studio is busy — try again in a few minutes.'
export const PAUSED = 'The studio has paused generation for now. Try again in a little while.'
export const TOO_MANY = 'You already have a lot inking. Let some of it finish, then try again.'
export const RESTARTED = 'The studio restarted before this finished. Try again.'
export const ABANDONED = 'This one stopped before it finished. Try again.'
export const TOO_MANY_RESTARTS = 'This kept being interrupted. Try again in a little while.'

// --- Keys -----------------------------------------------------------------------

export const panelKey = (projectId: string, chapterId: string, pageIndex: number, index: number) =>
  `${projectId}:${chapterId}:${pageIndex}:${index}`
export const coverKey = (projectId: string, chapterId: string) => `${projectId}:${chapterId}:cover`
export const sheetKey = (projectId: string, characterId: string) => `${projectId}:sheet:${characterId}`

// --- Transitions ----------------------------------------------------------------

const iso = (d: Date) => d.toISOString()

export const isActive = (job: Pick<JobRecord, 'status'>): boolean => job.status === 'queued' || job.status === 'running'

export type NewJob = Pick<JobRecord, 'key' | 'ownerId' | 'projectId' | 'kind' | 'payload'> & Partial<Pick<JobRecord, 'reservedUsd'>>

/** A job as it is written, before it is put on any queue. */
export function newJob(input: NewJob, id: string, now = new Date()): JobRecord {
  return {
    id,
    key: input.key,
    ownerId: input.ownerId,
    projectId: input.projectId,
    kind: input.kind,
    queue: QUEUE_OF[input.kind],
    payload: input.payload,
    status: 'queued',
    outcome: null,
    attempts: 0,
    reservedUsd: input.reservedUsd ?? 0,
    costUsd: 0,
    error: null,
    resultImageId: null,
    providerJobId: null,
    workerId: null,
    leaseUntil: null,
    createdAt: iso(now),
    updatedAt: iso(now),
    startedAt: null,
    finishedAt: null,
  }
}

/** A worker takes a job: `queued` or `running` (a stalled job delivered again)
 *  becomes `running` under this worker with a fresh lease. A finished job is
 *  never taken again — the answer is `null`, and the worker leaves it alone. */
export function claim(job: JobRecord, workerId: string, now: Date, leaseMs = LEASE_MS): JobRecord | null {
  if (!isActive(job)) return null
  return {
    ...job,
    status: 'running',
    attempts: job.attempts + 1,
    workerId,
    leaseUntil: iso(new Date(now.getTime() + leaseMs)),
    startedAt: job.startedAt ?? iso(now),
    updatedAt: iso(now),
  }
}

/** The worker is still alive: only the worker that holds a running job renews it. */
export function renew(job: JobRecord, workerId: string, now: Date, leaseMs = LEASE_MS): JobRecord | null {
  if (job.status !== 'running' || job.workerId !== workerId) return null
  return { ...job, leaseUntil: iso(new Date(now.getTime() + leaseMs)), updatedAt: iso(now) }
}

export type Result = { outcome: JobOutcome; error?: string | null; costUsd?: number }

/** The job ends. `done` for a success, `failed` for everything else. A job that
 *  already ended keeps its first ending. */
export function finish(job: JobRecord, result: Result, now: Date): JobRecord | null {
  if (!isActive(job)) return null
  return {
    ...job,
    status: result.outcome === 'done' ? 'done' : 'failed',
    outcome: result.outcome,
    error: result.outcome === 'done' ? null : (result.error ?? null),
    costUsd: result.costUsd !== undefined ? result.costUsd : job.costUsd,
    leaseUntil: null,
    finishedAt: iso(now),
    updatedAt: iso(now),
  }
}

/** The reconciler found a running job whose worker is gone and whose queue entry
 *  is gone too: it goes back to waiting to be put on the queue again. */
export function requeue(job: JobRecord, now: Date): JobRecord | null {
  if (job.status !== 'running') return null
  return { ...job, status: 'queued', workerId: null, leaseUntil: null, updatedAt: iso(now) }
}

/** Dead for good — a restart on the inline queue, a lease nobody renewed. */
export function abandon(job: JobRecord, error: string, now: Date): JobRecord | null {
  return finish(job, { outcome: 'abandoned', error }, now)
}

/** Facts a worker saves as it goes (the picture's id, the cost so far) — only while it holds the job. */
export function checkpoint(
  job: JobRecord,
  workerId: string,
  patch: Partial<Pick<JobRecord, 'resultImageId' | 'costUsd' | 'providerJobId' | 'payload'>>,
  now: Date
): JobRecord | null {
  if (job.status !== 'running' || job.workerId !== workerId) return null
  return { ...job, ...patch, updatedAt: iso(now) }
}

export function leaseExpired(job: JobRecord, now: Date): boolean {
  return job.status === 'running' && (!job.leaseUntil || Date.parse(job.leaseUntil) <= now.getTime())
}

/**
 * Can this job's claim on a panel still be real? A waiting job will take its
 * claim when it runs; a running job holds it while its lease does. `graceMs`
 * is how long past the lease the web keeps believing in it: 0 on the inline
 * queue, where a lapsed lease means the only process there is has restarted;
 * `ABANDON_GRACE_MS` on the real queue, where BullMQ brings a stalled job back.
 */
export function isLive(job: JobRecord, now: Date, graceMs: number): boolean {
  if (job.status === 'queued') return true
  if (job.status !== 'running') return false
  return !job.leaseUntil || Date.parse(job.leaseUntil) + graceMs > now.getTime()
}

/** BullMQ serves lower numbers first: a person with few jobs in flight goes ahead of one with many. */
export function priorityFor(activeForOwner: number): number {
  return Math.min(Math.max(0, activeForOwner) + 1, 2_097_152)
}

// --- What the browser sees ------------------------------------------------------

/** A job as the studio polls it: no keys, no owner, no cost, no internals. */
export type JobView = {
  id: string
  kind: JobKind
  status: JobStatus
  outcome: JobOutcome | null
  /** The sentence for a failed one. */
  error: string | null
  target: { chapterId?: string; pageIndex?: number; index?: number; characterId?: string; reuseDna?: boolean }
  updatedAt: string
}

export function toView(job: JobRecord): JobView {
  const p = job.payload
  const target: JobView['target'] =
    p.kind === 'panel'
      ? { chapterId: p.chapterId, pageIndex: p.pageIndex, index: p.index }
      : p.kind === 'cover'
        ? { chapterId: p.chapterId }
        : { characterId: p.characterId, reuseDna: p.reuseDna }
  return { id: job.id, kind: job.kind, status: job.status, outcome: job.outcome, error: job.error, target, updatedAt: job.updatedAt }
}

/** What the studio shows about the queue itself. `no-worker`: Redis answers but nobody is drawing. */
export type QueueState = {
  mode: 'inline' | 'bullmq'
  state: 'ok' | 'busy' | 'no-worker'
  /** The sentence for the status line; null when all is well. */
  message: string | null
}

/** Added to a desk reply (never stored): what is being drawn, and whether the queue is up. */
export type Activity = { jobs: JobView[]; queue: QueueState }

/**
 * The jobs the browser needs: everything active, plus a failure still worth a
 * sentence — recent, with something to say, and not since replaced by a newer
 * job for the same thing (a redraw that worked clears the old failure). A job
 * cancelled at the door (the studio was busy) is not shown: the request that
 * was refused already said so. Pass it the active jobs and the recent ones.
 */
export function visibleJobs(jobs: readonly JobRecord[], now: Date): JobView[] {
  const newest = new Map<string, string>()
  for (const j of jobs) {
    const seen = newest.get(j.key)
    if (seen === undefined || j.createdAt > seen) newest.set(j.key, j.createdAt)
  }
  const unique = new Map<string, JobRecord>()
  for (const j of jobs) unique.set(j.id, j)
  return [...unique.values()]
    .filter(
      (j) =>
        isActive(j) ||
        (j.status === 'failed' &&
          j.error !== null &&
          j.outcome !== 'cancelled' &&
          j.outcome !== 'skipped' &&
          now.getTime() - Date.parse(j.finishedAt ?? j.updatedAt) < SHOW_FAILED_MS &&
          newest.get(j.key) === j.createdAt)
    )
    .map(toView)
}

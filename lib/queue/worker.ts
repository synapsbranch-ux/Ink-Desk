// The worker half of the queue (v3, slice 18): BullMQ workers over the image
// queue (and, since slice 21, the account queue beside it), a heartbeat the web
// service reads, the reconciler on a timer, and the graceful close. `worker/index.ts` runs this as a service; the checks run it
// in a process of their own with small timings and a stand-in for the
// processor. Server only.
//
// Stalled-job recovery is BullMQ's: a worker holds each job's lock and renews
// it; a worker that dies stops renewing, and after `stalledInterval` another
// takes the job — twice at most (`maxStalledCount`), then it fails and
// `onFailed` ends the record. That replaced the `serverRunId` demote rule
// (CR-1). What keeps the second run from paying again is in `processors.ts`.
//
// Two lanes, one process (slice 21): `Worker('image')` takes pictures, the same
// as before; `Worker('account')` takes an export or an account deletion, ONE at
// a time, so a person leaving (or taking their data) is never queued behind the
// studio's busiest hour, and a ten-minute export never holds a picture slot.
// They share everything that is about the PROCESS and nothing that is about the
// work: one heartbeat (no key, no worker), one reconciler, one close — but each
// lane has its own Redis connection, concurrency and run ceiling.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { UnrecoverableError, Worker, type Job } from 'bullmq'
import IORedis from 'ioredis'
import { queueSettings } from '../config'
import { endJob } from './ending'
import { ACCOUNT_CEILING_MS, TOO_MANY_RESTARTS, finish } from './jobs'
import { processJob } from './processors'
import { reconcileOnce } from './reconcile'
import { PREFIX, baseOptions, producerRedis } from './redis'
import { HEARTBEAT_KEY, HEARTBEAT_TTL_S, maxRunMs } from './status'

/** The queues a worker can take from: the ones with processors. */
export type Lane = 'image' | 'account'

export type WorkerOptions = {
  /** Image jobs at once (default: the queue settings'). */
  concurrency?: number
  /** Account jobs at once (default 1). */
  accountConcurrency?: number
  /** Which lanes to take from (default both); the checks start a worker on one to show the other is left alone. */
  lanes?: readonly Lane[]
  workerId?: string
  /** A stand-in for `processJob`, for the checks. */
  process?: (jobId: string, ctx: { workerId: string }) => Promise<unknown>
  lockDurationMs?: number
  stalledIntervalMs?: number
  maxStalledCount?: number
  heartbeatMs?: number
  reconcileMs?: number
  /** A job still running after this long is failed and its slot freed (default: the longest a job may take, plus two minutes; an account job's own longest). */
  jobCeilingMs?: number
  /** First reconcile after this long; the worker is up by then. */
  reconcileDelayMs?: number
}

export type WorkerHandle = {
  workerId: string
  /** Finish what is running (up to `graceMs`), then stop. */
  close(graceMs?: number): Promise<void>
}

export async function startWorker(opts: WorkerOptions = {}): Promise<WorkerHandle> {
  const settings = queueSettings(process.env, 'worker')
  if (settings.mode !== 'bullmq' || !settings.redisUrl) throw new Error('the worker needs INKDESK_QUEUE=bullmq and REDIS_URL')
  const workerId = opts.workerId ?? `worker-${randomUUID().slice(0, 8)}`
  const run = opts.process ?? ((jobId, ctx) => processJob(jobId, ctx))
  const lanes = opts.lanes ?? (['image', 'account'] as const)
  const concurrencyOf: Record<Lane, number> = { image: opts.concurrency ?? settings.imageConcurrency, account: opts.accountConcurrency ?? settings.accountConcurrency }
  const ceilingOf: Record<Lane, number> = { image: opts.jobCeilingMs ?? maxRunMs() + 120_000, account: opts.jobCeilingMs ?? ACCOUNT_CEILING_MS }

  // One lane: a BullMQ worker over its own connection (BullMQ requires `maxRetriesPerRequest: null` there).
  const connections: IORedis[] = []
  const startLane = (lane: Lane): Worker => {
    const connection = new IORedis(settings.redisUrl as string, { ...baseOptions(), maxRetriesPerRequest: null })
    connection.on('error', () => {})
    connections.push(connection)
    const ceilingMs = ceilingOf[lane]
    const worker = new Worker(
      lane,
      async (job: Job<{ jobId: string }>) => {
        // A per-job ceiling: a call that hangs past anything a job can take must not hold a slot for ever
        // (the lock would be renewed for as long as the promise is pending). The record is ended by the 'failed' handler below.
        let timer: ReturnType<typeof setTimeout> | undefined
        const hung = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new UnrecoverableError(`job ${job.id} ran past ${Math.round(ceilingMs / 1000)} s`)), ceilingMs)
        })
        try {
          await Promise.race([run(job.data.jobId, { workerId }), hung])
        } finally {
          clearTimeout(timer)
        }
      },
      {
        connection,
        prefix: PREFIX,
        concurrency: concurrencyOf[lane],
        lockDuration: opts.lockDurationMs ?? 30_000,
        stalledInterval: opts.stalledIntervalMs ?? 30_000,
        maxStalledCount: opts.maxStalledCount ?? 2,
      }
    )
    worker.on('error', (err) => console.error(`[${workerId}] ${lane} queue error:`, err.message))
    worker.on('stalled', (jobId) => console.warn(`[${workerId}] ${lane} job ${jobId} stalled; it is being recovered`))
    worker.on('failed', (job, err) => {
      if (!job) return
      // BullMQ retries a job whose processor threw until `attempts` run out; a job
      // that stalled too often fails at once. Only the end of the road ends the record.
      const exhausted = !job.opts.attempts || job.attemptsMade >= job.opts.attempts || err.name === 'UnrecoverableError' || /stalled/i.test(err.message)
      console.error(`[${workerId}] ${lane} job ${job.id} ${exhausted ? 'failed for good' : 'will be retried'}: ${err.message}`)
      if (!exhausted || !job.data?.jobId) return
      endJob(job.data.jobId, (j) => finish(j, { outcome: 'failed', error: TOO_MANY_RESTARTS }, new Date())).catch((e: unknown) =>
        console.error(`[${workerId}] could not end job ${job.id}:`, e)
      )
    })
    return worker
  }
  const workers = lanes.map(startLane)

  // The heartbeat the web service reads: no key, no worker.
  const beat = async () => {
    try {
      await producerRedis().set(HEARTBEAT_KEY, JSON.stringify({ workerId, at: new Date().toISOString(), concurrency: concurrencyOf.image, lanes: Object.fromEntries(lanes.map((lane) => [lane, concurrencyOf[lane]])) }), 'EX', HEARTBEAT_TTL_S)
    } catch (err) {
      console.warn(`[${workerId}] heartbeat failed:`, err instanceof Error ? err.message : err)
    }
  }
  await beat()
  const heart = setInterval(beat, opts.heartbeatMs ?? 15_000)

  const reconcile = async () => {
    try {
      await reconcileOnce(workerId)
    } catch (err) {
      console.warn(`[${workerId}] reconcile failed:`, err instanceof Error ? err.message : err)
    }
  }
  const first = setTimeout(reconcile, opts.reconcileDelayMs ?? 2_000)
  const again = setInterval(reconcile, opts.reconcileMs ?? 60_000)

  console.log(`[${workerId}] working: ${lanes.map((lane) => `${lane} × ${concurrencyOf[lane]}`).join(', ')}, queue ${settings.mode}`)

  return {
    workerId,
    async close(graceMs = settings.graceMs) {
      clearInterval(heart)
      clearInterval(again)
      clearTimeout(first)
      // Let what is running finish, but not for ever: past the grace the lock
      // is left to lapse and another worker takes the job (it stalls, by design).
      const within = (work: Promise<unknown>, ms: number) => Promise.race([work.catch(() => {}), new Promise<void>((resolve) => setTimeout(resolve, ms))])
      await within(Promise.all(workers.map((worker) => worker.close())), graceMs)
      // With Redis unreachable the close cannot finish; cut the connections rather than wait for them.
      for (const connection of connections) connection.disconnect()
      // The shared producer connection and queue handles belong to the process,
      // not to this worker: whoever ends the process closes them.
    },
  }
}

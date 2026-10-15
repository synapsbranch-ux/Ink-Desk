// The worker half of the queue (v3, slice 18): BullMQ workers over the image
// queue, a heartbeat the web service reads, the reconciler on a timer, and the
// graceful close. `worker/index.ts` runs this as a service; the checks run it
// in a process of their own with small timings and a stand-in for the
// processor. Server only.
//
// Stalled-job recovery is BullMQ's: a worker holds each job's lock and renews
// it; a worker that dies stops renewing, and after `stalledInterval` another
// takes the job — twice at most (`maxStalledCount`), then it fails and
// `onFailed` ends the record. That replaced the `serverRunId` demote rule
// (CR-1). What keeps the second run from paying again is in `processors.ts`.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { UnrecoverableError, Worker, type Job } from 'bullmq'
import IORedis from 'ioredis'
import { queueSettings } from '../config'
import { endJob } from './ending'
import { TOO_MANY_RESTARTS, finish } from './jobs'
import { processJob } from './processors'
import { reconcileOnce } from './reconcile'
import { PREFIX, baseOptions, producerRedis } from './redis'
import { HEARTBEAT_KEY, HEARTBEAT_TTL_S, maxRunMs } from './status'

export type WorkerOptions = {
  concurrency?: number
  workerId?: string
  /** A stand-in for `processJob`, for the checks. */
  process?: (jobId: string, ctx: { workerId: string }) => Promise<unknown>
  lockDurationMs?: number
  stalledIntervalMs?: number
  maxStalledCount?: number
  heartbeatMs?: number
  reconcileMs?: number
  /** A job still running after this long is failed and its slot freed (default: the longest a job may take, plus two minutes). */
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
  const ceilingMs = opts.jobCeilingMs ?? maxRunMs() + 120_000

  // BullMQ requires `maxRetriesPerRequest: null` on a worker's connection.
  const connection = new IORedis(settings.redisUrl, { ...baseOptions(), maxRetriesPerRequest: null })
  connection.on('error', () => {})

  const worker = new Worker(
    'image',
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
      concurrency: opts.concurrency ?? settings.imageConcurrency,
      lockDuration: opts.lockDurationMs ?? 30_000,
      stalledInterval: opts.stalledIntervalMs ?? 30_000,
      maxStalledCount: opts.maxStalledCount ?? 2,
    }
  )
  worker.on('error', (err) => console.error(`[${workerId}] queue error:`, err.message))
  worker.on('stalled', (jobId) => console.warn(`[${workerId}] job ${jobId} stalled; it is being recovered`))
  worker.on('failed', (job, err) => {
    if (!job) return
    // BullMQ retries a job whose processor threw until `attempts` run out; a job
    // that stalled too often fails at once. Only the end of the road ends the record.
    const exhausted = !job.opts.attempts || job.attemptsMade >= job.opts.attempts || err.name === 'UnrecoverableError' || /stalled/i.test(err.message)
    console.error(`[${workerId}] job ${job.id} ${exhausted ? 'failed for good' : 'will be retried'}: ${err.message}`)
    if (!exhausted || !job.data?.jobId) return
    endJob(job.data.jobId, (j) => finish(j, { outcome: 'failed', error: TOO_MANY_RESTARTS }, new Date())).catch((e: unknown) =>
      console.error(`[${workerId}] could not end job ${job.id}:`, e)
    )
  })

  // The heartbeat the web service reads: no key, no worker.
  const beat = async () => {
    try {
      await producerRedis().set(HEARTBEAT_KEY, JSON.stringify({ workerId, at: new Date().toISOString(), concurrency: worker.opts.concurrency }), 'EX', HEARTBEAT_TTL_S)
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

  console.log(`[${workerId}] drawing: image × ${worker.opts.concurrency}, storage ${settings.mode}`)

  return {
    workerId,
    async close(graceMs = settings.graceMs) {
      clearInterval(heart)
      clearInterval(again)
      clearTimeout(first)
      // Let what is running finish, but not for ever: past the grace the lock
      // is left to lapse and another worker takes the job (it stalls, by design).
      const within = (work: Promise<unknown>, ms: number) => Promise.race([work.catch(() => {}), new Promise<void>((resolve) => setTimeout(resolve, ms))])
      await within(worker.close(), graceMs)
      // With Redis unreachable the close cannot finish; cut the connection rather than wait for it.
      connection.disconnect()
      // The shared producer connection and queue handles belong to the process,
      // not to this worker: whoever ends the process closes them.
    },
  }
}

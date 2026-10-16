// The BullMQ queues (v3, slice 18). The web service only adds to them; the
// worker takes from them (`worker.ts`). A BullMQ job carries nothing but the
// id of its Mongo record — the record is the truth, so a job read back from a
// flushed or rebuilt Redis is never missing what it needs. Server only.
//
// `image` runs panels, sheets and covers. `account` (slice 21) runs a person's
// export and the deletion of their account. `video` and `audio` exist as names
// from the start (`lib/queue/jobs.ts > QUEUE_OF`) and get processors in
// slice 22.
import 'server-only'
import { Queue, type JobsOptions } from 'bullmq'
import { queueSettings } from '../config'
import { producerRedis, PREFIX } from './redis'
import type { JobRecord, QueueName } from './jobs'

/** What every job is added with. Only an infrastructure failure (the store was unreachable when the worker took the job) is retried by BullMQ; a provider failure is the job's own result, written to the project, and Try again is the person's click. */
export function jobOptions(): JobsOptions {
  return {
    attempts: 3,
    backoff: { type: 'exponential', delay: queueSettings().retryBackoffMs },
    removeOnComplete: { age: 3_600, count: 1_000 },
    removeOnFail: { age: 24 * 3_600, count: 1_000 },
  }
}

type Pinned = { __inkdeskQueues?: Partial<Record<QueueName, Queue>> }
const g = globalThis as typeof globalThis & Pinned

/** One queue by name, made on first use over the pinned producer connection. */
export function bullQueue(name: QueueName): Queue {
  const queues = (g.__inkdeskQueues ??= {})
  let queue = queues[name]
  if (!queue) {
    queue = new Queue(name, { connection: producerRedis(), prefix: PREFIX })
    // BullMQ emits 'error' for connection trouble; unhandled, it would end the process.
    queue.on('error', () => {})
    queues[name] = queue
  }
  return queue
}

/** The options for one record's BullMQ job: its id doubles as the BullMQ job id, so adding it twice is a no-op. */
export function bullOptions(job: Pick<JobRecord, 'id'>, priority: number): JobsOptions {
  return { ...jobOptions(), jobId: job.id, priority }
}

/** Add a record's job to its queue. Resolves when Redis has it. */
export async function addToQueue(job: JobRecord, priority: number): Promise<void> {
  await bullQueue(job.queue).add(job.kind, { jobId: job.id }, bullOptions(job, priority))
}

/** Close every queue made here — for scripts and tests that must exit. */
export async function closeQueues(): Promise<void> {
  const queues = g.__inkdeskQueues
  g.__inkdeskQueues = undefined
  if (queues) await Promise.all(Object.values(queues).map((q) => q?.close().catch(() => {})))
}

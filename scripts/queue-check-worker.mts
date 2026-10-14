// A worker in a process of its own, for `check:queue` to kill. It claims the
// first job it is given exactly as a real worker does, tells the parent which
// one, then hangs — the way a worker that is killed mid-job looks to Redis:
// its lock stops being renewed and nothing finishes the record. Not a script
// anyone runs by hand.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)

const { startWorker } = await import('../lib/queue/worker')
const { store } = await import('../lib/store')
const { claim } = await import('../lib/queue/jobs')

const workerId = process.env.CHECK_WORKER_ID ?? 'doomed'
await startWorker({
  workerId,
  concurrency: 1,
  lockDurationMs: 1_500,
  stalledIntervalMs: 1_000,
  heartbeatMs: 500,
  reconcileDelayMs: 600_000, // this worker never reconciles; the check does that itself
  process: async (jobId, ctx) => {
    await store.jobs.updateJob(jobId, (j) => claim(j, ctx.workerId, new Date()))
    process.stdout.write(`CLAIMED ${jobId}\n`)
    await new Promise(() => {}) // the work that never ends
  },
})
process.stdout.write('READY\n')

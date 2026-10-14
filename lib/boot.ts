// The Node half of `instrumentation.ts`, in its own module so the Edge build
// never sees `process.exit` (Next compiles the hook for both runtimes).
import 'server-only'
import { ConfigError, appConfig } from './config'

export function boot() {
  try {
    const config = appConfig()
    console.log(`[config] storage: ${config.storage} · queue: ${config.queue.mode} · generation: ${config.generationEnabled ? 'on' : 'off'}`)
    if (config.queue.mode === 'inline') void sweepInlineJobs()
    else if (config.queue.redisUrl) void warmRedis()
  } catch (err) {
    // Next keeps a server whose hook failed listening, answering 500 to
    // everything. In production that must be a stopped process instead, so
    // the host sees a failed deploy and keeps the last good one.
    if (err instanceof ConfigError && process.env.NODE_ENV === 'production') {
      console.error(`[config] ${err.message}`)
      process.exit(1)
    }
    throw err
  }
}

/**
 * The inline queue lives in this process, so a job still recorded as queued or
 * running when the server starts belongs to a process that is gone: it is
 * ended with a sentence, and the stale floor shows its panel as failed with
 * Try again. (On the real queue the web service never does this — jobs
 * outlive it.)
 */
async function sweepInlineJobs(): Promise<void> {
  try {
    const { store } = await import('./store')
    const { KEEP_FINISHED_MS, RESTARTED, abandon } = await import('./queue/jobs')
    const left = await store.jobs.listJobs({ status: ['queued', 'running'], limit: 2_000 })
    for (const job of left) await store.jobs.updateJob(job.id, (j) => abandon(j, RESTARTED, new Date()))
    // The inline queue has no worker to prune finished records, so the start of the server does.
    await store.jobs.pruneJobs(new Date(Date.now() - KEEP_FINISHED_MS).toISOString())
    if (left.length > 0) console.warn(`[queue] ${left.length} job${left.length === 1 ? '' : 's'} from before this start were let go (inline queue)`)
  } catch (err) {
    console.warn('[queue] could not sweep the jobs left by the last run:', err instanceof Error ? err.message : err)
  }
}

/** Open the queue's connection now, so the first click and the first health check find it ready. A Redis that is not there yet is not an error at boot (the status line says so). */
async function warmRedis(): Promise<void> {
  try {
    const { producerRedis } = await import('./queue/redis')
    await producerRedis().ping()
  } catch (err) {
    console.warn('[queue] Redis is not answering yet:', err instanceof Error ? err.message : err)
  }
}

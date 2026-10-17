// The Node half of `instrumentation.ts`, in its own module so the Edge build
// never sees `process.exit` (Next compiles the hook for both runtimes).
import 'server-only'
import { isProduction } from './auth/config'
import { ConfigError, appConfig, authSettings, videoSettings } from './config'

export function boot() {
  try {
    // Sign-in (slice 19) is checked beside the rest, so production refuses
    // INKDESK_AUTH=off or test, and Clerk without its keys, in the same one
    // sentence as every other problem.
    const problems: string[] = []
    const read = <T,>(fn: () => T): T | null => {
      try {
        return fn()
      } catch (err) {
        if (!(err instanceof ConfigError)) throw err
        problems.push(...err.problems)
        return null
      }
    }
    const config = read(appConfig)
    const auth = read(() => authSettings())
    // The trailer's models, resolution and motion method (slice 22) have their own rules beside the numbers `appConfig` checks.
    const video = read(() => videoSettings())
    if (!config || !auth || !video) throw new ConfigError(problems)
    console.log(`[config] storage: ${config.storage} · queue: ${config.queue.mode} · generation: ${config.generationEnabled ? 'on' : 'off'} · sign-in: ${auth.mode} · limits: ${config.limits.enabled ? 'on' : 'off'}`)
    if (config.queue.mode === 'inline') void sweepInlineJobs()
    else if (config.queue.redisUrl) void warmRedis()
  } catch (err) {
    // Next keeps a server whose hook failed listening, answering 500 to
    // everything. In production that must be a stopped process instead, so
    // the host sees a failed deploy and keeps the last good one — whatever
    // NODE_ENV it was started with, short of development (S19-SEC-1).
    if (err instanceof ConfigError && isProduction()) {
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
export async function sweepInlineJobs(): Promise<void> {
  try {
    const { store } = await import('./store')
    const { KEEP_FINISHED_MS, RESTARTED, abandon } = await import('./queue/jobs')
    const { endJob } = await import('./queue/ending')
    const { sweepUnsettled } = await import('./limits/jobs')
    const left = await store.jobs.listJobs({ status: ['queued', 'running'], limit: 2_000 })
    // Ended through `endJob`, so each one's hold (slice 20) is released with it.
    for (const job of left) await endJob(job.id, (j) => abandon(j, RESTARTED, new Date()))
    await sweepUnsettled()
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

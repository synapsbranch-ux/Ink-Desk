// The `worker` service (v3, slice 18): `npm run worker`. It takes the image
// jobs the web service writes and puts on the queue, draws them, and writes the
// results to the same Mongo and buckets — web only enqueues. Since slice 21 it
// also runs the `account` queue beside the image one — a person's export and the
// deletion of their account, one at a time — and, since slice 22, the `video`
// queue: a trailer (its shots, voices, music and ffmpeg assembly in one job),
// QUEUE_CONCURRENCY_VIDEO at a time (`lib/queue/worker.ts`). The worker is the
// service that needs `ffmpeg` and `ffprobe` on its PATH. One process; on
// Railway a second service in the same project from the same repository, with
// its own start command and the variables listed in `devpost/spec.md >
// Environment and Configuration (v3)`.
//
// Started with `scripts/server-only.mts` preloaded (see the `worker` script in
// package.json): the library modules import `server-only`, which refuses to
// load outside Next unless resolved the way Next's server does.
import { workerAuthProblems } from '../lib/auth/config'
import { ConfigError, isProduction, parseConfig, videoSettings } from '../lib/config'
import { mediaToolsMissing } from '../lib/queue/processors'
import { closeQueues } from '../lib/queue/queues'
import { closeProducerRedis } from '../lib/queue/redis'
import { startWorker } from '../lib/queue/worker'

async function main() {
  let config
  try {
    config = parseConfig(process.env, 'worker')
    // The trailer's models, resolution and motion method (slice 22): a worker that would film with a malformed one is refused here, not on the first trailer.
    videoSettings()
    // Deleting an account ends its sign-in, so a worker in better mode needs BETTER_AUTH_SECRET and the accounts' MongoDB: refused here, not on the first deletion.
    const auth = workerAuthProblems()
    // Outside production an unset INKDESK_AUTH reads as off — and a worker on the cloud desk the web service signs people
    // in to would then delete an account but not its sign-in (after-audit #2). On that desk it says which mode it is.
    if (config.storage === 'cloud' && !isProduction() && !process.env.INKDESK_AUTH?.trim()) auth.push('INKDESK_AUTH is not set (a worker on cloud storage uses the web service’s sign-in mode)')
    if (auth.length > 0) throw new ConfigError(auth)
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[worker] ${err.message}`)
      process.exit(1)
    }
    throw err
  }
  if (config.queue.mode !== 'bullmq') {
    console.error('[worker] INKDESK_QUEUE is inline, so the web process runs the jobs itself and there is nothing for a worker to do. Set INKDESK_QUEUE=bullmq and REDIS_URL.')
    process.exit(1)
  }
  // A trailer pays for its shots before the assembly needs ffmpeg: with video open, a worker without it does not start (after-audit #12).
  if (config.videoEnabled && (await mediaToolsMissing())) {
    console.error('[worker] VIDEO_ENABLED is true, but ffmpeg and ffprobe are not on this machine’s PATH. Install ffmpeg (it brings ffprobe) on the worker service, or set VIDEO_ENABLED=false, and restart.')
    process.exit(1)
  }

  const worker = await startWorker()
  console.log(`[worker] up — storage ${config.storage}, generation ${config.generationEnabled ? 'on' : 'off (jobs already queued still run)'}`)

  let closing = false
  const stop = (signal: string) => {
    if (closing) return
    closing = true
    console.log(`[worker] ${signal} — finishing what is running, then stopping`)
    worker.close().then(
      async () => {
        await closeQueues().catch(() => {})
        await closeProducerRedis().catch(() => {})
        process.exit(0)
      },
      (err) => {
        console.error('[worker] did not close cleanly:', err)
        process.exit(1)
      }
    )
  }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))
}

main().catch((err) => {
  console.error('[worker] could not start:', err instanceof Error ? err.message : err)
  process.exit(1)
})

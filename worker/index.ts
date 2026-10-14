// The `worker` service (v3, slice 18): `npm run worker`. It takes the image
// jobs the web service writes and puts on the queue, draws them, and writes the
// results to the same Mongo and buckets — web only enqueues. One process; on
// Railway a second service in the same project from the same repository, with
// its own start command and the variables listed in `devpost/spec.md >
// Environment and Configuration (v3)`.
//
// Started with `scripts/server-only.mts` preloaded (see the `worker` script in
// package.json): the library modules import `server-only`, which refuses to
// load outside Next unless resolved the way Next's server does.
import { ConfigError, parseConfig } from '../lib/config'
import { closeQueues } from '../lib/queue/queues'
import { closeProducerRedis } from '../lib/queue/redis'
import { startWorker } from '../lib/queue/worker'

async function main() {
  let config
  try {
    config = parseConfig(process.env, 'worker')
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

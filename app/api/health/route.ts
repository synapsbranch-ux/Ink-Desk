// The deploy's health check (v3, slice 16): Railway deploys on a 200 here and
// holds the old deploy on anything else. 200 when everything this storage
// mode needs answers within two seconds each, 503 with the same shape
// otherwise (the queue's own state rides along but never fails the check). No internals, no versions, no hostnames — a check that fails
// says only which one; the terminal has the cause. See `devpost/spec.md >
// Health, Status and Logs (v3)`.
import { appConfig, generationEnabled, queueSettings } from '@/lib/config'
import { queueHealth } from '@/lib/queue/status'
import { store, type StoreHealth } from '@/lib/store'
import { storageMode } from '@/lib/store/env'

export const runtime = 'nodejs'

/** Each outside system gets this long to answer. */
const CHECK_MS = 2_000

export async function GET() {
  let storage: 'local' | 'cloud' = 'local'
  let checks: StoreHealth
  let configured = true
  try {
    storage = storageMode()
    appConfig()
  } catch (err) {
    // The server should not have booted; say down, and why only in the terminal.
    configured = false
    console.error('[health] settings:', err instanceof Error ? err.message : err)
  }
  if (!configured) {
    checks = storage === 'cloud' ? { mongo: 'down', bucket: 'down' } : { mongo: 'n/a', bucket: 'n/a' }
  } else {
    checks = await store.health(CHECK_MS)
  }
  // The queue is reported, not required: with Redis or the worker down the studio
  // still reads every existing project, so the deploy check does not fail on them
  // (`spec.md > Failure Modes (v3)`). `n/a` where there is no queue to ask.
  const queue = configured
    ? { mode: queueSettings().mode, ...(await queueHealth(CHECK_MS)) }
    : { mode: 'inline' as const, redis: 'n/a' as const, worker: 'n/a' as const }
  const ok = configured && checks.mongo !== 'down' && checks.bucket !== 'down'
  return Response.json(
    { status: ok ? 'ok' : 'down', storage, checks, queue, generation: generationEnabled() ? 'on' : 'off' },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
  )
}

// The deploy's health check (v3, slice 16): Railway deploys on a 200 here and
// holds the old deploy on anything else. 200 when everything this storage
// mode needs answers within two seconds each, 503 with the same shape
// otherwise (the queue's own state rides along but never fails the check). No internals, no versions, no hostnames — a check that fails
// says only which one; the terminal has the cause. See `devpost/spec.md >
// Health, Status and Logs (v3)`.
//
// Slice 23 (after-audit #4, #10): the route is public and takes no window, so
// the probe of the outside systems (a Mongo ping and a HEAD per bucket in cloud
// mode, a Redis PING and GET) is shared — callers at the same moment wait on
// one probe, and its result is reused for `PROBE_FRESH_MS` — while the settings
// are read on every call. And production on the local desk is never healthy:
// the settings refuse it, so the answer is 503.
import { appConfig, generationEnabled, queueSettings } from '@/lib/config'
import { queueHealth } from '@/lib/queue/status'
import { store, type Check, type StoreHealth } from '@/lib/store'
import { storageMode } from '@/lib/store/env'

export const runtime = 'nodejs'

/** Each outside system gets this long to answer. */
const CHECK_MS = 2_000
/** How long one probe's answer is reused: a deploy check every few seconds still sees the truth, a loop of strangers does not reach Mongo, the buckets or Redis. */
const PROBE_FRESH_MS = 5_000

type Probe = { checks: StoreHealth; queue: { redis: Check; worker: Check } }

/** The last probe, keyed by the modes it asked about. A probe that throws is not kept. */
let last: { key: string; at: number; probe: Promise<Probe> } | null = null

function probeOf(key: string): Promise<Probe> {
  const now = Date.now()
  if (last && last.key === key && now - last.at < PROBE_FRESH_MS) return last.probe
  const probe = (async () => ({ checks: await store.health(CHECK_MS), queue: await queueHealth(CHECK_MS) }))()
  const mine = { key, at: now, probe }
  last = mine
  probe.catch(() => {
    if (last === mine) last = null
  })
  return probe
}

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
  // The queue is reported, not required: with Redis or the worker down the studio
  // still reads every existing project, so the deploy check does not fail on them
  // (`spec.md > Failure Modes (v3)`). `n/a` where there is no queue to ask.
  let queue: { mode: 'inline' | 'bullmq'; redis: Check; worker: Check }
  if (!configured) {
    checks = storage === 'cloud' ? { mongo: 'down', bucket: 'down' } : { mongo: 'n/a', bucket: 'n/a' }
    queue = { mode: 'inline', redis: 'n/a', worker: 'n/a' }
  } else {
    const mode = queueSettings().mode
    const probe = await probeOf(`${storage} ${mode}`)
    checks = probe.checks
    queue = { mode, ...probe.queue }
  }
  const ok = configured && checks.mongo !== 'down' && checks.bucket !== 'down'
  return Response.json(
    { status: ok ? 'ok' : 'down', storage, checks, queue, generation: generationEnabled() ? 'on' : 'off' },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
  )
}

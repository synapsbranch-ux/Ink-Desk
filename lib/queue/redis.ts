// The one Redis connection the web side uses (v3, slice 18), and the names of
// everything Ink Desk keeps there. Server only.
//
// Redis here is only the thing that hands a job to a worker, plus a few
// short-lived flags (the worker's heartbeat, the credit breaker). Nothing in
// it is the record of anything: the job records are in Mongo, so a Redis that
// is flushed, replaced or down loses no history — it only pauses the queue
// (`devpost/spec.md > Queue and Worker (v3)`).
//
// The producer connection fails fast: with Redis down a command waits for the
// connection no longer than `REDIS_TIMEOUT_MS` (and gives up after one failed
// reconnect), so a click on a generate button ends in "The studio is busy"
// within seconds rather than hanging. Commands may wait that long on purpose:
// the first command of a fresh process is sent before the socket is ready. The
// worker's own connection is the opposite (BullMQ requires
// `maxRetriesPerRequest: null` there) and is built by `worker.ts`.
//
// Every key — ours and BullMQ's — starts with `inkdesk:`, because a Redis may
// be shared with another app (the same care as the buckets' key prefix).
import 'server-only'
import IORedis, { type Redis, type RedisOptions } from 'ioredis'
import { queueSettings } from '../config'
import { BUSY } from './jobs'
import { Refused } from '../errors'

export const PREFIX = 'inkdesk'

/** `inkdesk:heartbeat:worker` — BullMQ's own keys live under the same prefix. */
export const redisKey = (...parts: string[]): string => [PREFIX, ...parts].join(':')

/** How long a Redis command, or the connection itself, may take before the studio calls itself busy. */
export const REDIS_TIMEOUT_MS = 3_000

/**
 * Options shared by every connection. `family: 0` lets the name resolve over
 * IPv4 or IPv6 — Railway's private network (`redis.railway.internal`) is
 * IPv6, and ioredis's default of IPv4 only would fail to find it.
 */
export function baseOptions(): RedisOptions {
  return {
    family: 0,
    connectTimeout: REDIS_TIMEOUT_MS,
    // Reconnect forever, calmly: a restart of Redis heals without a restart of the app.
    retryStrategy: (times) => Math.min(times * 250, 3_000),
  }
}

type Pinned = { __inkdeskRedis?: Redis }
const g = globalThis as typeof globalThis & Pinned

/** The web side's connection, made on first use and pinned across hot reloads. Throws a calm `Refused` when no Redis is configured. */
export function producerRedis(): Redis {
  if (g.__inkdeskRedis) return g.__inkdeskRedis
  const { redisUrl } = queueSettings()
  if (!redisUrl) throw new Refused(BUSY, 503)
  const redis = new IORedis(redisUrl, { ...baseOptions(), maxRetriesPerRequest: 1, commandTimeout: REDIS_TIMEOUT_MS })
  // An unhandled 'error' event would crash the process; the cause is logged once per outage.
  let lastLogged = 0
  redis.on('error', (err) => {
    if (Date.now() - lastLogged > 30_000) {
      lastLogged = Date.now()
      console.error('[redis] connection problem:', err instanceof Error ? err.message : err)
    }
  })
  g.__inkdeskRedis = redis
  return redis
}

/** Close the pinned connection — for scripts and tests that must exit. */
export async function closeProducerRedis(): Promise<void> {
  const redis = g.__inkdeskRedis
  g.__inkdeskRedis = undefined
  if (redis) await redis.quit().catch(() => redis.disconnect())
}

/** Rejects after `ms`, so a promise that never settles still ends in the studio's busy sentence. */
export function within<T>(work: Promise<T>, ms = REDIS_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer from Redis in ${ms} ms`)), ms)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

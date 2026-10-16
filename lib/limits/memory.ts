// The in-process backend (v3, slice 20) — the same rules as the Redis scripts,
// kept in one process's memory. Used on a bare dev desk and by the checks, never
// where strangers are (`backend.ts`). Node is single-threaded and nothing here
// awaits between a read and its write, so each method is atomic the way a Lua
// script is; and the rules themselves are `evaluate` and the key names of
// `rules.ts`, which the Lua follows line for line. `check:limits` runs one
// script against both and compares every answer.
import 'server-only'
import type { FinishInput, HitResult, LimitsBackend, ReserveInput, ReserveResult } from './backend'
import { nowMs } from './clock'
import {
  GLOBAL_TOTAL_KEY,
  HOLD_TTL_MS,
  ORPHAN_AFTER_MS,
  SPEND_KINDS,
  dayOf,
  dayTtlMs,
  evaluate,
  globalDayKey,
  monthOf,
  monthTtlMs,
  quotaKey,
  userDayKey,
  userMonthKey,
  rateKey,
  type Counters,
  type Hold,
} from './rules'

type Cell = { n: number; exp: number | null }

export function createMemoryBackend(): LimitsBackend {
  const cells = new Map<string, Cell>()
  const windows = new Map<string, { hits: number[]; exp: number }>()
  const holds = new Map<string, { hold: Hold; exp: number }>()
  /** Tracked holds by id → the time after which they are swept. */
  const index = new Map<string, number>()

  const cell = (key: string): Cell | null => {
    const found = cells.get(key)
    if (!found) return null
    if (found.exp !== null && found.exp <= nowMs()) {
      cells.delete(key)
      return null
    }
    return found
  }
  const read = (key: string): number => cell(key)?.n ?? 0
  const incr = (key: string, by: number, ttlMs: number | null) => {
    const found = cell(key) ?? { n: 0, exp: null }
    found.n += by
    if (ttlMs !== null) found.exp = nowMs() + ttlMs
    cells.set(key, found)
  }
  /** The settle's adjust: only a key that still exists, never below zero, never a changed expiry. */
  const adjust = (key: string, by: number) => {
    const found = cell(key)
    if (!found || by === 0) return
    found.n = Math.max(0, found.n + by)
  }
  const getHold = (id: string): Hold | null => {
    const found = holds.get(id)
    if (!found) return null
    if (found.exp <= nowMs()) {
      holds.delete(id)
      index.delete(id)
      return null
    }
    return found.hold
  }

  function counters(userId: string): Counters {
    const now = nowMs()
    const day = dayOf(now)
    const month = monthOf(now)
    return {
      quota: Object.fromEntries(SPEND_KINDS.map((k) => [k, read(quotaKey(userId, day, k))])) as Counters['quota'],
      userDayMicros: read(userDayKey(userId, day)),
      userMonthMicros: read(userMonthKey(userId, month)),
      globalDayMicros: read(globalDayKey(day)),
      globalTotalMicros: read(GLOBAL_TOTAL_KEY),
    }
  }

  return {
    kind: 'memory',

    async hit(bucket, id, limit, windowMs): Promise<HitResult> {
      const now = nowMs()
      const key = rateKey(bucket, id)
      let w = windows.get(key)
      if (w && w.exp <= now) w = undefined
      const hits = (w?.hits ?? []).filter((at) => at > now - windowMs)
      if (hits.length >= limit) {
        windows.set(key, { hits, exp: now + windowMs })
        const retry = hits.length > 0 ? hits[0] + windowMs - now : windowMs
        return { ok: false, retryAfterMs: Math.max(1, retry) }
      }
      hits.push(now)
      windows.set(key, { hits, exp: now + windowMs })
      return { ok: true }
    },

    /** Forget a person (account deletion): their quota cells, dollar ledgers and request windows — never `spend:global:*`. */
    async purgeUser(userId: string): Promise<number> {
      if (userId === 'global') return 0
      let removed = 0
      for (const key of [...cells.keys()]) {
        if (key.startsWith(`quota:${userId}:`) || key.startsWith(`spend:${userId}:`)) removed += cells.delete(key) ? 1 : 0
      }
      for (const key of [...windows.keys()]) {
        if (key.startsWith('rl:') && key.endsWith(`:${userId}`)) removed += windows.delete(key) ? 1 : 0
      }
      return removed
    },

    async reserve(input: ReserveInput): Promise<ReserveResult> {
      if (getHold(input.id)) return { ok: true, duplicate: true }
      const now = nowMs()
      const verdict = evaluate(counters(input.userId), input.caps, input.units, input.usdMicros)
      if (!verdict.ok) return verdict
      const day = dayOf(now)
      const month = monthOf(now)
      for (const kind of SPEND_KINDS) {
        const n = input.units[kind] ?? 0
        if (n > 0) incr(quotaKey(input.userId, day, kind), n, dayTtlMs(now))
      }
      if (input.usdMicros > 0) {
        incr(userDayKey(input.userId, day), input.usdMicros, dayTtlMs(now))
        incr(userMonthKey(input.userId, month), input.usdMicros, monthTtlMs(now))
        incr(globalDayKey(day), input.usdMicros, dayTtlMs(now))
        incr(GLOBAL_TOTAL_KEY, input.usdMicros, null)
      }
      const units = Object.fromEntries(SPEND_KINDS.filter((k) => (input.units[k] ?? 0) > 0).map((k) => [k, input.units[k]]))
      holds.set(input.id, {
        hold: { id: input.id, userId: input.userId, day, month, usd: input.usdMicros, units, tracked: input.tracked },
        exp: now + HOLD_TTL_MS,
      })
      if (input.tracked) index.set(input.id, now + ORPHAN_AFTER_MS)
      return { ok: true, duplicate: false }
    },

    async finish(id: string, how: FinishInput): Promise<'done' | 'gone'> {
      const hold = getHold(id)
      if (!hold) return 'gone'
      const actual = how.actualMicros === null ? hold.usd : how.actualMicros
      const delta = actual - hold.usd
      if (delta !== 0) {
        adjust(userDayKey(hold.userId, hold.day), delta)
        adjust(userMonthKey(hold.userId, hold.month), delta)
        adjust(globalDayKey(hold.day), delta)
        adjust(GLOBAL_TOTAL_KEY, delta)
      }
      if (how.refundUnits) {
        for (const kind of SPEND_KINDS) adjust(quotaKey(hold.userId, hold.day, kind), -(hold.units[kind] ?? 0))
      }
      holds.delete(id)
      index.delete(id)
      return 'done'
    },

    async counters(userId) {
      return counters(userId)
    },

    async orphans(limit = 50) {
      const now = nowMs()
      return [...index.entries()]
        .filter(([, due]) => due <= now)
        .sort((a, b) => a[1] - b[1])
        .slice(0, limit)
        .map(([id]) => id)
    },

    async hold(id) {
      return getHold(id)
    },

    async peek(key) {
      if (key.startsWith('resv:')) {
        const found = holds.get(key.slice('resv:'.length))
        return found && found.exp > nowMs() ? { value: 1, ttlMs: found.exp - nowMs() } : { value: null, ttlMs: null }
      }
      const found = cell(key)
      return found ? { value: found.n, ttlMs: found.exp === null ? null : found.exp - nowMs() } : { value: null, ttlMs: null }
    },
  }
}

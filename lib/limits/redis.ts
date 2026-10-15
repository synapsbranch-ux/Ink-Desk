// The Redis backend (v3, slice 20). Server only.
//
// Every operation that must not interleave is ONE Lua script, which Redis runs
// without letting another command in between — so two requests on two
// instances racing a nearly-full cap cannot both pass it (SEC-02):
//
//   HIT      a sliding window: drop the hits that slid out, count, and either
//            refuse (saying when the oldest slides out) or record this one.
//   RESERVE  check, in the order `evaluate` fixes, the studio's total and daily
//            caps, the person's quotas and their dollar cap — then raise ALL the
//            counters and write the hold marker, or change NOTHING.
//   FINISH   settle or release: read the hold marker, adjust exactly the
//            counters it raised (the day and month it was reserved on, even if
//            that is yesterday), and delete the marker — all or nothing, and a
//            second FINISH finds no marker and does nothing. That is the
//            idempotence per job id.
//
// Dollars are integers (micro-dollars). Daily keys expire at the next 00:00 UTC
// plus a margin (`rules.ts`); an adjust never creates a key and never changes
// an expiry, so a settle that arrives after a key expired cannot leave an
// immortal negative counter behind. Keys are declared to the script, not
// computed inside it (the script is portable to a Redis Cluster that keeps them
// in one slot); this build targets the single Redis Railway provides.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { producerRedis, redisKey, within } from '../queue/redis'
import type { FinishInput, HitResult, LimitsBackend, ReserveInput, ReserveResult } from './backend'
import { nowMs } from './clock'
import {
  GLOBAL_TOTAL_KEY,
  HOLD_INDEX_KEY,
  HOLD_TTL_MS,
  ORPHAN_AFTER_MS,
  SPEND_KINDS,
  dayOf,
  dayTtlMs,
  gateMicros,
  globalDayKey,
  holdKey,
  monthOf,
  monthTtlMs,
  quotaKey,
  rateKey,
  userDayKey,
  userMonthKey,
  type Counters,
  type Hold,
  type SpendKind,
} from './rules'

const HIT = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local n = redis.call('ZCARD', KEYS[1])
if n >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local retry = window
  if oldest[2] then retry = tonumber(oldest[2]) + window - now end
  if retry < 1 then retry = 1 end
  return {0, retry}
end
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], window)
return {1, 0}
`

// KEYS: 1 hold, 2 index, 3-6 quota (image, project, videoSeconds, audioChars),
//       7 user day, 8 user month, 9 global day, 10 global total.
// ARGV: 1 hold JSON, 2 hold ttl, 3-6 units, 7-10 quota limits, 11 usd, 12 user
//       cap, 13 daily cap, 14 total cap (-1 none), 15 day ttl, 16 month ttl,
//       17 sweep deadline (-1 none), 18 id, 19 gate (what the studio's caps judge).
//       (The gate is worked out by `gateMicros` in rules.ts, so the script and
//       `evaluate` cannot differ on it.)
const RESERVE = `
if redis.call('EXISTS', KEYS[1]) == 1 then return {1, 'dup'} end
local usd = tonumber(ARGV[11])
local gate = tonumber(ARGV[19])
local function num(k) return tonumber(redis.call('GET', k) or '0') end
if gate > 0 then
  local total = tonumber(ARGV[14])
  if total >= 0 and num(KEYS[10]) + gate > total then return {0, 'total-cap'} end
  if num(KEYS[9]) + gate > tonumber(ARGV[13]) then return {0, 'daily-cap'} end
end
local names = {'image', 'project', 'videoSeconds', 'audioChars'}
for i = 1, 4 do
  local n = tonumber(ARGV[2 + i])
  if n > 0 and num(KEYS[2 + i]) + n > tonumber(ARGV[6 + i]) then return {0, 'quota', names[i]} end
end
if usd > 0 and num(KEYS[7]) + usd > tonumber(ARGV[12]) then return {0, 'spend'} end
local dayTtl = tonumber(ARGV[15])
for i = 1, 4 do
  local n = tonumber(ARGV[2 + i])
  if n > 0 then
    redis.call('INCRBY', KEYS[2 + i], n)
    redis.call('PEXPIRE', KEYS[2 + i], dayTtl)
  end
end
if usd > 0 then
  redis.call('INCRBY', KEYS[7], usd)
  redis.call('PEXPIRE', KEYS[7], dayTtl)
  redis.call('INCRBY', KEYS[8], usd)
  redis.call('PEXPIRE', KEYS[8], tonumber(ARGV[16]))
  redis.call('INCRBY', KEYS[9], usd)
  redis.call('PEXPIRE', KEYS[9], dayTtl)
  redis.call('INCRBY', KEYS[10], usd)
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', tonumber(ARGV[2]))
if tonumber(ARGV[17]) >= 0 then redis.call('ZADD', KEYS[2], tonumber(ARGV[17]), ARGV[18]) end
return {1, 'ok'}
`

// KEYS as RESERVE. ARGV: 1 the hold JSON the caller read, 2 actual usd (-1 keeps
// the reserved figure), 3 refund the units (1/0), 4 id.
const FINISH = `
local raw = redis.call('GET', KEYS[1])
if not raw or raw ~= ARGV[1] then return 0 end
local hold = cjson.decode(raw)
local reserved = tonumber(hold.usd)
local actual = tonumber(ARGV[2])
if actual < 0 then actual = reserved end
local delta = actual - reserved
local function adjust(k, by)
  if by ~= 0 and redis.call('EXISTS', k) == 1 then
    local v = redis.call('INCRBY', k, by)
    if v < 0 then redis.call('SET', k, 0, 'KEEPTTL') end
  end
end
if delta ~= 0 then
  adjust(KEYS[7], delta)
  adjust(KEYS[8], delta)
  adjust(KEYS[9], delta)
  adjust(KEYS[10], delta)
end
if tonumber(ARGV[3]) == 1 then
  local names = {'image', 'project', 'videoSeconds', 'audioChars'}
  for i = 1, 4 do
    local n = tonumber(hold.units[names[i]] or 0)
    if n > 0 then adjust(KEYS[2 + i], -n) end
  end
end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[4])
return 1
`

const k = (relative: string) => redisKey(relative)

/** The ten keys RESERVE and FINISH are declared with, for a person's day and month. */
function ledgerKeys(id: string, userId: string, day: string, month: string): string[] {
  return [
    k(holdKey(id)),
    k(HOLD_INDEX_KEY),
    ...SPEND_KINDS.map((kind) => k(quotaKey(userId, day, kind))),
    k(userDayKey(userId, day)),
    k(userMonthKey(userId, month)),
    k(globalDayKey(day)),
    k(GLOBAL_TOTAL_KEY),
  ]
}

const num = (value: unknown): number => {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : 0
  return Number.isFinite(n) ? n : 0
}

/** A Redis that did not answer is not asked again for this long. */
export const OUTAGE_MEMORY_MS = 5_000

/**
 * Remember an outage. Every command waits out the Redis timeout before it gives up, and every API request takes a
 * window through here — so with Redis down, a reader's pictures, the desk's poll and every autosave would each wait
 * seconds for an answer that is not coming. After a command fails, the next ones fail at once for a few seconds (the
 * callers already know what a failure means: the spending windows refuse, reads and edits go on), and then one asks again.
 */
function rememberOutage(real: LimitsBackend): LimitsBackend {
  let downUntil = 0
  const guarded = <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      if (Date.now() < downUntil) throw new Error('Redis did not answer a moment ago; not asking again yet')
      try {
        return await call(...args)
      } catch (err) {
        downUntil = Date.now() + OUTAGE_MEMORY_MS
        throw err
      }
    }
  return {
    kind: real.kind,
    hit: guarded(real.hit),
    reserve: guarded(real.reserve),
    finish: guarded(real.finish),
    counters: guarded(real.counters),
    orphans: guarded(real.orphans),
    hold: guarded(real.hold),
    peek: guarded(real.peek),
  }
}

export function createRedisBackend(): LimitsBackend {
  return rememberOutage(redisBackend())
}

function redisBackend(): LimitsBackend {
  const redis = () => producerRedis()

  return {
    kind: 'redis',

    async hit(bucket, id, limit, windowMs): Promise<HitResult> {
      const now = nowMs()
      const reply = (await within(redis().eval(HIT, 1, k(rateKey(bucket, id)), now, windowMs, limit, `${now}-${randomUUID()}`))) as [number, number]
      return reply[0] === 1 ? { ok: true } : { ok: false, retryAfterMs: Math.max(1, num(reply[1])) }
    },

    async reserve(input: ReserveInput): Promise<ReserveResult> {
      const now = nowMs()
      const day = dayOf(now)
      const month = monthOf(now)
      const units = Object.fromEntries(SPEND_KINDS.filter((kind) => (input.units[kind] ?? 0) > 0).map((kind) => [kind, input.units[kind]]))
      const hold: Hold = { id: input.id, userId: input.userId, day, month, usd: input.usdMicros, units, tracked: input.tracked }
      const reply = (await within(
        redis().eval(
          RESERVE,
          10,
          ...ledgerKeys(input.id, input.userId, day, month),
          JSON.stringify(hold),
          HOLD_TTL_MS,
          ...SPEND_KINDS.map((kind) => input.units[kind] ?? 0),
          ...SPEND_KINDS.map((kind) => input.caps.quota[kind]),
          input.usdMicros,
          input.caps.userDailyMicros,
          input.caps.globalDailyMicros,
          input.caps.globalTotalMicros ?? -1,
          dayTtlMs(now),
          monthTtlMs(now),
          input.tracked ? now + ORPHAN_AFTER_MS : -1,
          input.id,
          gateMicros(input.units, input.usdMicros)
        )
      )) as [number, string, string?]
      if (reply[0] === 1) return { ok: true, duplicate: reply[1] === 'dup' }
      if (reply[1] === 'quota') return { ok: false, why: 'quota', kind: reply[2] as SpendKind }
      return { ok: false, why: reply[1] as 'total-cap' | 'daily-cap' | 'spend' }
    },

    async finish(id: string, how: FinishInput): Promise<'done' | 'gone'> {
      const raw = await within(redis().get(k(holdKey(id))))
      if (!raw) return 'gone'
      let hold: Hold
      try {
        hold = JSON.parse(raw) as Hold
      } catch {
        // A marker nothing here wrote: drop it rather than fail every settle behind it.
        await within(redis().del(k(holdKey(id))))
        return 'gone'
      }
      const done = await within(
        redis().eval(FINISH, 10, ...ledgerKeys(id, hold.userId, hold.day, hold.month), raw, how.actualMicros === null ? -1 : how.actualMicros, how.refundUnits ? 1 : 0, id)
      )
      return num(done) === 1 ? 'done' : 'gone'
    },

    async counters(userId: string): Promise<Counters> {
      const now = nowMs()
      const day = dayOf(now)
      const month = monthOf(now)
      const keys = [
        ...SPEND_KINDS.map((kind) => k(quotaKey(userId, day, kind))),
        k(userDayKey(userId, day)),
        k(userMonthKey(userId, month)),
        k(globalDayKey(day)),
        k(GLOBAL_TOTAL_KEY),
      ]
      const v = await within(redis().mget(...keys))
      return {
        quota: { image: num(v[0]), project: num(v[1]), videoSeconds: num(v[2]), audioChars: num(v[3]) },
        userDayMicros: num(v[4]),
        userMonthMicros: num(v[5]),
        globalDayMicros: num(v[6]),
        globalTotalMicros: num(v[7]),
      }
    },

    async orphans(limit = 50) {
      return within(redis().zrangebyscore(k(HOLD_INDEX_KEY), '-inf', nowMs(), 'LIMIT', 0, limit))
    },

    async hold(id) {
      const raw = await within(redis().get(k(holdKey(id))))
      if (!raw) return null
      try {
        return JSON.parse(raw) as Hold
      } catch {
        return null
      }
    },

    async peek(key) {
      const ttl = await within(redis().pttl(k(key)))
      if (ttl === -2) return { value: null, ttlMs: null }
      const ttlMs = ttl === -1 ? null : ttl
      if (key.startsWith('resv:')) return { value: 1, ttlMs }
      return { value: num(await within(redis().get(k(key)))), ttlMs }
    },
  }
}

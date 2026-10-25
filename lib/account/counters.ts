// A person's counters and windows, removed (v3, slice 21) — step 5 of the
// account deletion. The limits layer keeps, per person, in Redis (or in the
// memory backend of a bare dev desk):
//
//   quota:<user>:<day>:<kind>     today's quota units
//   spend:<user>:<day|month>      the dollar ledgers
//   rl:<bucket>:<user>            the request windows (signed-in callers are keyed by their id)
//
// They are found by SCAN (never KEYS: Redis is shared and this must not stall it)
// and removed with UNLINK in batches. What is NEVER touched: the studio-wide
// `spend:global:*` totals, which hold no names (they are the studio's own cost
// caps), the `resv:` hold markers (each belongs to a job, and the deletion
// has already ended every job through `endJob`, which settles them), and every
// key that belongs to another person: the patterns carry the id between two
// colons, so `user_a` never reaches `user_ab`.
//
// A Redis that does not answer THROWS: the deletion is retried, and every step
// before this one is safe to repeat. With no Redis configured there is nothing in
// Redis to remove; the in-process backend is asked to forget the person if it can.
import 'server-only'
import { redisUrl } from '../config'
import { backend } from '../limits/backend'
import { producerRedis, redisKey, within } from '../queue/redis'

/** Ids are letters, digits, `_` and `-` (Better Auth's ids, the test users' `user_…`); a pattern is never built from anything else. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/

/** A scan that cannot end is a bug somewhere else; this many calls is far more than any keyspace needs. */
const MAX_SCANS = 100_000

let warnedMemory = false

/** Remove the person's counters and windows; how many keys went. Safe to repeat. */
export async function purgeCounters(userId: string): Promise<number> {
  // 'global' is the studio's own spend counter, never a person's.
  if (!SAFE_ID.test(userId) || userId === 'global') return 0
  if (redisUrl()) return purgeRedis(userId)
  const memory = backend()
  if (typeof memory.purgeUser === 'function') return memory.purgeUser(userId)
  if (!warnedMemory) {
    warnedMemory = true
    console.warn('[account] the in-process limits backend cannot forget a person; its counters end with this process')
  }
  return 0
}

export async function purgeRedis(userId: string): Promise<number> {
  const redis = producerRedis()
  const patterns = [redisKey('quota', userId, '*'), redisKey('spend', userId, '*'), redisKey('rl', '*', userId)]
  let removed = 0
  let scans = 0
  for (const pattern of patterns) {
    let cursor = '0'
    do {
      const [next, keys] = await within(redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200))
      cursor = next
      // A pattern is matched on the whole key, so a key of another person (or the global counters) cannot be in `keys`;
      // checked anyway, because a bug here would delete someone else's data.
      const mine = keys.filter((key) => !key.startsWith(redisKey('spend', 'global', '')))
      if (mine.length > 0) removed += await within(redis.unlink(...mine))
      if (++scans > MAX_SCANS) throw new Error('the Redis scan for an account’s counters did not end')
    } while (cursor !== '0')
  }
  return removed
}

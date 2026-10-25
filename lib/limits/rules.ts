// The arithmetic of the limits (v3, slice 20) — pure, no Node imports, no
// secrets: the key names, the UTC day, the micro-dollar unit, and `evaluate`,
// the one function that says whether a spend fits. The memory backend runs it
// directly; the Redis backend runs the same rules as a Lua script so they hold
// atomically across instances; `usage.ts` runs it on the same counters to say
// what the meter shows. `check:limits` drives the same script through both
// backends and compares. See `devpost/spec.md > Limits, Quotas and the Kill
// Switch (v3)` and `devpost/prd.md > Limits and Usage (v3)`.
import type { PauseReason, PlanName, SpendKind } from './view'

export type { PlanName, SpendKind }

/** The four things a quota counts, in the order the screens list them. */
export const SPEND_KINDS = ['image', 'project', 'videoSeconds', 'audioChars'] as const satisfies readonly SpendKind[]

/** How many of each kind a request would use. */
export type Units = Partial<Record<SpendKind, number>>

/**
 * The five request windows (`spec.md`: paid text 10/min, paid image 6/min, uploads 20/hour, edits 120/min, reads 240/min),
 * plus the ones the studio adds: pictures served (`media`) and signed-out callers (`anon`) — and, in slice 21, the two
 * that belong to the public share routes, keyed by client address like `anon`: pictures of a shared manga (`anonMedia`,
 * 600 a minute) and the report form (`report`, 6 an hour; it fails CLOSED, see `requests.ts`). Since the Better Auth
 * revision (2026-10-24) the studio's own sign-in needs one more, per client address: attempts to sign in
 * (`signin`, 10 a minute); it fails CLOSED. There is no sign-up, so no window for it.
 */
export const RATE_BUCKETS = ['text', 'image', 'upload', 'edit', 'read', 'media', 'anon', 'anonMedia', 'report', 'signin'] as const
export type RateBucket = (typeof RATE_BUCKETS)[number]

// --- Money ----------------------------------------------------------------------
//
// Every dollar figure the counters hold is a whole number of micro-dollars
// (millionths), so a counter is an integer in Redis, adds exactly, and
// "the total after N racing reservations" can be asserted to the unit.

export const toMicros = (usd: number): number => (Number.isFinite(usd) && usd > 0 ? Math.round(usd * 1e6) : 0)
export const fromMicros = (micros: number): number => Math.round(micros) / 1e6

// --- Time -----------------------------------------------------------------------

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** `YYYYMMDD` of the UTC day `ms` falls in. */
export function dayOf(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

/** `YYYY-MM-DD`, as the usage view names the day. */
export function isoDayOf(ms: number): string {
  const d = dayOf(ms)
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`
}

/** `YYYYMM` of the UTC month `ms` falls in. */
export function monthOf(ms: number): string {
  return dayOf(ms).slice(0, 6)
}

/** The next 00:00 UTC after `ms` — when every daily counter starts again. */
export function nextResetMs(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}

/** The first instant of the next UTC month. */
function monthEndMs(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}

/** A daily key outlives its reset by this much, so a job that ends just after midnight still finds the day it was reserved on. */
export const DAY_MARGIN_MS = 3 * 3600_000
/** A monthly key outlives the month by this much (the figure is for this month; last month's is kept a while for a late settle). */
export const MONTH_MARGIN_MS = 45 * 24 * 3600_000
/** A reservation marker (the record of what one job or call holds) outlives the longest a job is kept. */
export const HOLD_TTL_MS = 8 * 24 * 3600_000
/** A hold that no job record backs (a text call, a new project) is let go after this long unsettled. */
export const ORPHAN_AFTER_MS = 30 * 60_000

/** How long from `ms` until a daily key should expire: the next reset plus the margin. */
export const dayTtlMs = (ms: number): number => nextResetMs(ms) + DAY_MARGIN_MS - ms
/** How long from `ms` until a monthly key should expire. */
export const monthTtlMs = (ms: number): number => monthEndMs(ms) + MONTH_MARGIN_MS - ms

// --- Keys -----------------------------------------------------------------------
//
// Relative names; the Redis backend puts the studio's `inkdesk:` prefix in
// front, the memory backend uses them as they are.

export const quotaKey = (userId: string, day: string, kind: SpendKind) => `quota:${userId}:${day}:${kind}`
export const userDayKey = (userId: string, day: string) => `spend:${userId}:${day}`
export const userMonthKey = (userId: string, month: string) => `spend:${userId}:${month}`
export const globalDayKey = (day: string) => `spend:global:${day}`
export const GLOBAL_TOTAL_KEY = 'spend:global:total'
export const holdKey = (id: string) => `resv:${id}`
export const HOLD_INDEX_KEY = 'resv:index'
export const rateKey = (bucket: string, id: string) => `rl:${bucket}:${id}`

/** What one hold records about itself — the marker the settle reads, so a settle after midnight (or after a restart) adjusts the very counters the reserve raised. Amounts are micro-dollars. */
export type Hold = {
  id: string
  userId: string
  day: string
  month: string
  usd: number
  units: Units
  /** True for a hold no job record backs: it is swept if never settled. */
  tracked: boolean
}

// --- The rules ------------------------------------------------------------------

/**
 * The least any spend is held for, in micro-dollars ($0.02: the cheapest
 * picture at `low`, and no estimate is below it). The studio counts itself
 * PAUSED when even this does not fit under a cap, and from then on EVERY
 * spending action — a picture, a text call, a new project — is refused with the
 * one pause message: `paused` in the usage view and a refused `reserve` are the
 * same fact.
 */
export const MIN_SPEND_MICROS = 20_000

/** What the studio's caps are judged against for a request: at least the floor for anything that spends, nothing for a request that spends nothing. */
export function gateMicros(units: Units, usdMicros: number): number {
  const spends = usdMicros > 0 || SPEND_KINDS.some((kind) => (units[kind] ?? 0) > 0)
  return spends ? Math.max(usdMicros, MIN_SPEND_MICROS) : 0
}

/** What a user's counters read right now (today's quotas and spend, this month, the studio's day and total). */
export type Counters = {
  quota: Record<SpendKind, number>
  userDayMicros: number
  userMonthMicros: number
  globalDayMicros: number
  globalTotalMicros: number
}

/** The ceilings a request is held against: the person's plan and the studio's caps. */
export type Caps = {
  quota: Record<SpendKind, number>
  userDailyMicros: number
  globalDailyMicros: number
  /** Null: no cumulative cap. */
  globalTotalMicros: number | null
}

export type Refusal =
  | { why: 'total-cap' }
  | { why: 'daily-cap' }
  | { why: 'quota'; kind: SpendKind }
  | { why: 'spend' }
export type Verdict = { ok: true } | ({ ok: false } & Refusal)

export const emptyCounters = (): Counters => ({
  quota: { image: 0, project: 0, videoSeconds: 0, audioChars: 0 },
  userDayMicros: 0,
  userMonthMicros: 0,
  globalDayMicros: 0,
  globalTotalMicros: 0,
})

/**
 * Does this spend fit? The order is the contract (the Lua script in
 * `redis.ts` follows it line for line): the studio's caps first — so a paused
 * studio says one thing to everyone — then the person's quotas in the order the
 * screens list them, then the person's own dollar cap. The studio's caps judge
 * the larger of the estimate and the floor (`gateMicros`), so a new project,
 * which costs nothing, is still refused while the studio is paused; the
 * person's dollar cap judges only real dollars.
 */
export function evaluate(c: Counters, caps: Caps, units: Units, usdMicros: number): Verdict {
  const gate = gateMicros(units, usdMicros)
  if (gate > 0) {
    if (caps.globalTotalMicros !== null && c.globalTotalMicros + gate > caps.globalTotalMicros) return { ok: false, why: 'total-cap' }
    if (c.globalDayMicros + gate > caps.globalDailyMicros) return { ok: false, why: 'daily-cap' }
  }
  for (const kind of SPEND_KINDS) {
    const n = units[kind] ?? 0
    if (n > 0 && c.quota[kind] + n > caps.quota[kind]) return { ok: false, why: 'quota', kind }
  }
  if (usdMicros > 0 && c.userDayMicros + usdMicros > caps.userDailyMicros) return { ok: false, why: 'spend' }
  return { ok: true }
}

/** The global reason a refusal belongs to, or null when it is this person's own limit. */
export function pauseReasonOf(refusal: Refusal): PauseReason | null {
  return refusal.why === 'daily-cap' ? 'daily-cap' : refusal.why === 'total-cap' ? 'total-cap' : null
}

// --- The sentences --------------------------------------------------------------
//
// One calm sentence, with the way forward (`devpost/prd.md > Look and Feel`).
// A reset is told on the UTC clock — the server cannot know the reader's — and
// the same instant travels as `resetsAt` for a screen to show in its own.

export const PAUSED_TODAY = 'The studio has paused generation for today to keep its costs in check.'
export const PAUSED_TOTAL = 'The studio has paused generation to keep its costs in check. Reading, the reader and exports still work.'
export const PAUSED_NOW = 'The studio has paused generation for now to keep its costs in check. Try again in a little while.'

/** "It resets at 00:00 UTC, in about 3 hours." — `ms` is the reset, `now` is now. */
export function resetPhrase(resetMs: number, now: number): string {
  const d = new Date(resetMs)
  const clock = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  const hours = Math.max(1, Math.round((resetMs - now) / 3_600_000))
  return `${clock}, in about ${hours} hour${hours === 1 ? '' : 's'}`
}

export function pausedSentence(reason: PauseReason, resetMs: number, now: number): string {
  if (reason === 'daily-cap') return `${PAUSED_TODAY} It will open again at ${resetPhrase(resetMs, now)}.`
  if (reason === 'total-cap') return PAUSED_TOTAL
  if (reason === 'credits') return PAUSED_NOW
  return 'Generation isn’t open on this studio yet.'
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** What a quota counts, as a phrase that follows "today's": "20 images". */
export function quotaNoun(kind: SpendKind, limit: number): string {
  switch (kind) {
    case 'image':
      return plural(limit, 'image', 'images')
    case 'project':
      return plural(limit, 'new project', 'new projects')
    case 'videoSeconds':
      return `${plural(limit, 'second', 'seconds')} of video`
    case 'audioChars':
      return `${plural(limit, 'character', 'characters')} of voice`
  }
}

export function quotaSentence(kind: SpendKind, limit: number, resetMs: number, now: number): string {
  if (limit <= 0) return `Your plan doesn’t include ${kind === 'image' ? 'images' : kind === 'project' ? 'new projects' : kind === 'videoSeconds' ? 'video' : 'voice'} yet.`
  return `You have used today’s ${quotaNoun(kind, limit)}. It resets at ${resetPhrase(resetMs, now)}.`
}

export function spendSentence(limitUsd: number, resetMs: number, now: number): string {
  return `You have reached today’s spending limit of $${limitUsd.toFixed(2)}. It resets at ${resetPhrase(resetMs, now)}.`
}

export function rateSentence(retryAfterSec: number): string {
  if (retryAfterSec <= 1) return 'You’re going a little fast — try again in a second.'
  if (retryAfterSec < 90) return `You’re going a little fast — try again in ${retryAfterSec} seconds.`
  return `You’re going a little fast — try again in ${Math.ceil(retryAfterSec / 60)} minutes.`
}

// --- A refusal, described ---------------------------------------------------------

/** What a refused spend says and means — the one translation `reserve`, the preflight and the usage view all use, so the sentence on a refused click is the sentence the meter shows. */
export type RefusalInfo = {
  message: string
  code: 'quota' | 'paused' | 'spend'
  /** The instant the refusal lifts, ISO; null when it does not lift by itself (the cumulative cap). */
  resetsAt: string | null
  /** The HTTP status a route answers with. */
  status: 429 | 503
  /** Which meter ran out; `all` when nothing that spends is possible. */
  kind: SpendKind | 'all'
}

export function describeRefusal(refusal: Refusal, caps: Caps, now: number): RefusalInfo {
  const resetMs = nextResetMs(now)
  const resetsAt = new Date(resetMs).toISOString()
  switch (refusal.why) {
    case 'total-cap':
      return { message: pausedSentence('total-cap', resetMs, now), code: 'paused', resetsAt: null, status: 503, kind: 'all' }
    case 'daily-cap':
      return { message: pausedSentence('daily-cap', resetMs, now), code: 'paused', resetsAt, status: 503, kind: 'all' }
    case 'quota':
      return { message: quotaSentence(refusal.kind, caps.quota[refusal.kind], resetMs, now), code: 'quota', resetsAt, status: 429, kind: refusal.kind }
    case 'spend':
      return { message: spendSentence(caps.userDailyMicros / 1e6, resetMs, now), code: 'spend', resetsAt, status: 429, kind: 'all' }
  }
}

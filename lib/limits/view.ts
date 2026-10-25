// What the quota meter, the Usage page and the disabled buttons are shown
// (v3, slice 20) — the CONTRACT between the enforcement core (`lib/limits/*`,
// server only) and the studio's screens. Pure types and two pure helpers, no
// Node imports, so the browser shares them.
//
// The one rule: what the meter shows is exactly what is enforced. The server
// builds a `UsageView` from the same counters `reserve` checks, in one place
// (`lib/limits/usage.ts`), and `GET /api/usage` returns it. The screens never
// recompute a limit.
// See `devpost/prd.md > Limits and Usage (v3)` and
// `devpost/spec.md > Limits, Quotas and the Kill Switch (v3)`.

export type PlanName = 'free' | 'allowlisted'

/** What a quota counts. `project` is a project started today. */
export type SpendKind = 'image' | 'project' | 'videoSeconds' | 'audioChars'

/** One counter against its limit, today. `limit` 0 means none are allowed on this plan. */
export type Meter = { used: number; limit: number }

/** Why generation is shut for everyone, not just for this person. */
export type PauseReason = 'daily-cap' | 'total-cap' | 'credits' | 'closed'

export type UsageView = {
  plan: PlanName
  /** False on a desk where limits are off (a local desk with sign-in off): the screens show no meter. */
  metering: boolean
  /** The UTC day the counters belong to (`YYYY-MM-DD`), and when they reset (the next 00:00 UTC, ISO). */
  day: string
  resetsAt: string
  images: Meter
  projects: Meter
  videoSeconds: Meter
  audioChars: Meter
  /** From the providers' real costs (`usage.cost`), settled when a job finishes. */
  spend: { todayUsd: number; monthUsd: number; todayLimitUsd: number }
  /** Generation shut for everyone (the global caps, the 402 breaker, the flag), or null. */
  paused: { reason: PauseReason; message: string; resetsAt: string | null } | null
  /** True when any meter has reached 80% of its limit. */
  warn: boolean
  /**
   * The first reason a spending action is refused for this person right now, or null. A `paused` studio is blocked for `all`.
   * `code` says what refuses it, so a screen need not guess from the kind: a `quota` (a daily limit), `spend` (the person's own
   * dollar limit — pictures stop while the image meter still has room), `paused` (a studio cap that does not yet pause everyone)
   * or `busy` (the counters did not answer, which clears when they do and not at the reset).
   */
  blocked: { kind: SpendKind | 'all'; message: string; resetsAt: string | null; code?: 'quota' | 'spend' | 'paused' | 'busy' } | null
}

/** The warning threshold, as a fraction of a limit. */
export const WARN_AT = 0.8

export function meterFraction(m: Meter): number {
  return m.limit <= 0 ? (m.used > 0 ? 1 : 0) : Math.min(1, m.used / m.limit)
}

export function meterWarns(m: Meter): boolean {
  return m.limit > 0 && m.used / m.limit >= WARN_AT
}

/**
 * The JSON body of a refused spend, beside `error` (the sentence): `code`
 * says which kind of refusal, `resetsAt` when the quota or the pause lifts,
 * `retryAfterSec` how long a rate limit asks the caller to wait (also sent as
 * `Retry-After`). The browser reads these; it never parses the sentence.
 */
export type RefusalBody = {
  error: string
  code?: 'quota' | 'rate' | 'paused' | 'spend'
  resetsAt?: string
  retryAfterSec?: number
}


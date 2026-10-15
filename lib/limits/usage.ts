// The meter, built from the counters enforcement checks (v3, slice 20) — in ONE
// function, so what the quota meter, the disabled buttons and the Usage page
// show is exactly what `reserve` enforces. It reads the same Redis keys the
// reserve script raises (the person's day and month ledgers, the quota
// counters, the studio's day and total), judges them with the same `evaluate`
// the reserve follows, and words a refusal with the same `describeRefusal`. The
// month figure is its own counter — it does not depend on job records, which
// are pruned after a week. `GET /api/usage` returns this. Server only.
import 'server-only'
import { generationEnabled, limitsSettings } from '../config'
import { BUSY } from '../queue/jobs'
import { creditsBreakerOpen } from '../queue/breaker'
import { backend, capsFor } from './backend'
import { nowMs } from './clock'
import { MIN_SPEND_USD, imageEstimateUsd } from './estimate'
import { planOf } from './plan'
import {
  describeRefusal,
  emptyCounters,
  evaluate,
  fromMicros,
  isoDayOf,
  nextResetMs,
  pauseReasonOf,
  pausedSentence,
  toMicros,
  type Caps,
  type Counters,
  type Units,
} from './rules'
import { meterWarns, type Meter, type PauseReason, type SpendKind, type UsageView } from './view'

type Blocked = NonNullable<UsageView['blocked']>

const meters = (c: Counters, caps: Caps) => ({
  images: { used: c.quota.image, limit: caps.quota.image } satisfies Meter,
  projects: { used: c.quota.project, limit: caps.quota.project } satisfies Meter,
  videoSeconds: { used: c.quota.videoSeconds, limit: caps.quota.videoSeconds } satisfies Meter,
  audioChars: { used: c.quota.audioChars, limit: caps.quota.audioChars } satisfies Meter,
})

/**
 * What would be refused for this person right now, probing with one of each
 * thing they can spend: a picture (its quota unit and its estimated dollars),
 * a new project, a second of video, a character of voice, and the least any
 * spend is held for.
 */
const PROBES: readonly { kind: SpendKind | 'all'; units: Units; usd: () => number }[] = [
  { kind: 'image', units: { image: 1 }, usd: () => imageEstimateUsd('panel') },
  { kind: 'project', units: { project: 1 }, usd: () => 0 },
  { kind: 'videoSeconds', units: { videoSeconds: 1 }, usd: () => 0 },
  { kind: 'audioChars', units: { audioChars: 1 }, usd: () => 0 },
  { kind: 'all', units: {}, usd: () => MIN_SPEND_USD },
]

export async function usageView(userId: string): Promise<UsageView> {
  const now = nowMs()
  const settings = limitsSettings()
  const plan = await planOf(userId)
  const caps = capsFor(plan)
  const resetMs = nextResetMs(now)
  const resetsAt = new Date(resetMs).toISOString()
  const base = { plan, metering: settings.enabled, day: isoDayOf(now), resetsAt }

  // Generation shut for everyone, whatever the counters say: closed by the flag, or the credit breaker is open.
  let paused: UsageView['paused'] = null
  if (!generationEnabled()) paused = { reason: 'closed', message: pausedSentence('closed', resetMs, now), resetsAt: null }
  else if (await creditsBreakerOpen()) paused = { reason: 'credits', message: pausedSentence('credits', resetMs, now), resetsAt: null }

  if (!settings.enabled) {
    // A local desk: nothing is counted, so nothing is metered.
    const c = emptyCounters()
    return {
      ...base,
      ...meters(c, caps),
      spend: { todayUsd: 0, monthUsd: 0, todayLimitUsd: settings.plans[plan].dailyUsd },
      paused,
      warn: false,
      blocked: paused ? { kind: 'all', message: paused.message, resetsAt: paused.resetsAt } : null,
    }
  }

  let c: Counters
  try {
    c = await backend().counters(userId)
  } catch (err) {
    // The counters did not answer: show the plan's limits, say the studio is busy, and let the person read on.
    console.warn('[limits] the usage view could not read the counters:', err instanceof Error ? err.message : err)
    return {
      ...base,
      ...meters(emptyCounters(), caps),
      spend: { todayUsd: 0, monthUsd: 0, todayLimitUsd: settings.plans[plan].dailyUsd },
      paused,
      warn: false,
      blocked: { kind: 'all', message: BUSY, resetsAt: null, code: 'busy' },
    }
  }

  // The studio's pause from the caps: even the least any spend is held for does not fit — and from then on every spending action is refused, a new project included.
  const floor = evaluate(c, caps, {}, toMicros(MIN_SPEND_USD))
  if (!floor.ok) {
    const reason = pauseReasonOf(floor)
    if (reason && (!paused || paused.reason === 'credits')) {
      paused = { reason, message: pausedSentence(reason, resetMs, now), resetsAt: reason === 'daily-cap' ? resetsAt : null }
    }
  }

  let blocked: Blocked | null = null
  if (paused) {
    blocked = { kind: 'all', message: paused.message, resetsAt: paused.resetsAt }
  } else {
    for (const probe of PROBES) {
      const verdict = evaluate(c, caps, probe.units, toMicros(probe.usd()))
      if (verdict.ok) continue
      const info = describeRefusal(verdict, caps, now)
      // A quota names its own meter; anything else is named by the probe that met it (the studio's pause is `paused`, handled above).
      const kind = verdict.why === 'quota' ? verdict.kind : probe.kind
      blocked = { kind, message: info.message, resetsAt: info.resetsAt, code: info.code }
      break
    }
  }

  const m = meters(c, caps)
  return {
    ...base,
    ...m,
    spend: { todayUsd: fromMicros(c.userDayMicros), monthUsd: fromMicros(c.userMonthMicros), todayLimitUsd: settings.plans[plan].dailyUsd },
    paused,
    warn: Object.values(m).some(meterWarns),
    blocked,
  }
}

export type { PauseReason }

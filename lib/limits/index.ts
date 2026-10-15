// The limits layer's public face (v3, slice 20) — what the rest of the server
// imports. Server only. The shape the screens read is `./view` (pure,
// client-safe); this is the enforcement behind it.
//
//   config       lib/config.ts > limitsSettings, limitsEnabled
//   plan         planOf(userId)
//   reserve      reserve / preflight / settle / release        (hold.ts)
//   jobs         holdForJob / settleEnded / sweepUnsettled      (jobs.ts)
//   text         spendText / spendProject                       (text.ts)
//   windows      limitRequest / limitByAddress / hit / classify (requests.ts)
//   meter        usageView(userId)                              (usage.ts)
//   backends     backend / createMemoryBackend / createRedisBackend
import 'server-only'

export { limitsEnabled, limitsSettings, type LimitsSettings } from '../config'
export { backend, capsFor, resetBackend, LimitsUnavailable, type LimitsBackend } from './backend'
export { nowMs, setClock } from './clock'
export { MIN_SPEND_USD, TEXT_ESTIMATE_USD, imageEstimateUsd, jobSpend, type TextKind } from './estimate'
export { preflight, release, reserve, settle, type ReserveRequest } from './hold'
export { holdForJob, releaseUnlinked, settleEnded, settlementOf, sweepUnsettled, type Swept } from './jobs'
export { createMemoryBackend } from './memory'
export { forgetPlans, planOf } from './plan'
export { createRedisBackend } from './redis'
export { classify, clientAddress, clientKey, hit, limitByAddress, limitRequest } from './requests'
export { evaluate, type Caps, type Counters, type Units, type Verdict } from './rules'
export { spendProject, spendText } from './text'
export { usageView } from './usage'
export * from './view'

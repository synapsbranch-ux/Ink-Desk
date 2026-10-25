// Which plan a person is on (v3, slice 20): `allowlisted` when their account's
// email is in ALLOWLIST_EMAILS (case-insensitive), `free` otherwise — and the
// local owner of a desk without accounts is always allowlisted. The email comes
// from `store.users`, which the sign-in fills with VERIFIED addresses only
// (`lib/auth/server.ts`, `devpost/spec.md > Data Model (v3)`); an account with
// no verified address, or whose record is not written yet, is `free`. A deleted account is free. Server only.
import 'server-only'
import { limitsSettings } from '../config'
import { LOCAL_OWNER } from '../queue/jobs'
import { store } from '../store'
import type { PlanName } from './view'

type Cached = { at: number; plan: PlanName; list: string }
type Pinned = { __inkdeskPlans?: Map<string, Cached> }
const g = globalThis as typeof globalThis & Pinned

/** A plan is looked up in the store at most this often per person. */
const PLAN_CACHE_MS = 15_000

export async function planOf(userId: string): Promise<PlanName> {
  if (userId === LOCAL_OWNER) return 'allowlisted'
  const list = limitsSettings().allowlist
  if (list.length === 0) return 'free'
  const key = list.join(',')
  const cache = (g.__inkdeskPlans ??= new Map())
  const hit = cache.get(userId)
  if (hit && hit.list === key && Date.now() - hit.at < PLAN_CACHE_MS) return hit.plan
  let plan: PlanName = 'free'
  try {
    const user = await store.users.get(userId)
    if (user && !user.deletedAt && list.includes(user.email.trim().toLowerCase())) plan = 'allowlisted'
  } catch (err) {
    // The store being unreachable never raises a limit: free until it answers (and not remembered).
    console.warn('[limits] could not read the account to choose a plan:', err instanceof Error ? err.message : err)
    return 'free'
  }
  cache.set(userId, { at: Date.now(), plan, list: key })
  return plan
}

/** Forget what was learned about plans — for the checks, which change the allowlist and the accounts under it. */
export function forgetPlans(): void {
  g.__inkdeskPlans = undefined
}

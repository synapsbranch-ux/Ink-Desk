'use client'

// The browser's one copy of today's usage (v3, slice 20): the quota meter in
// the headers, every button that spends and the Usage page all read it from
// here, so they cannot disagree — and all of them show what the server
// counted, not a recomputation (`lib/limits/view.ts`).
//
// One store for the whole page, shared through `useUsage()`:
//   • it reads `GET /api/usage` (a `UsageView`) when the first screen mounts;
//   • it polls lightly — every 30 s, only while a tab is visible, never two
//     reads at once — and reads again when the tab comes back;
//   • it reads again at once when anything announces a spend on `window` as
//     `inkdesk:usage-changed` (`apiFetch` does after every request that can
//     spend, refused or not; the studio does when a job ends, since a failed
//     job gives its image back);
//   • after a "too many requests" reply it holds buttons shut for the wait
//     the server asked for, then opens them.
// A failed read keeps the last good numbers and says nothing; with none yet,
// the screens show their quiet failure state. Limits off on this desk
// (`metering: false`) means no meter anywhere and no button ever blocked.
// See `devpost/prd.md > Limits and Usage (v3)`.
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { apiFetch } from '@/components/api-fetch'
import { spendBlock, USAGE_CHANGED_EVENT, type Need, type SpendBlock, type UsageChange } from './button'
import type { UsageView } from './view'

export type UsageStatus = 'loading' | 'ready' | 'error'

export type UsageState = {
  status: UsageStatus
  /** The last `UsageView` the server sent; null until the first read. */
  usage: UsageView | null
  /** Seconds the buttons are held shut after a rate-limit reply (0 = not held). */
  waitSec: number
}

/** How often a visible tab looks again. */
const POLL_MS = 30_000
/** A read this recent is not repeated when a tab comes back or a screen mounts. */
const FRESH_MS = 5_000
/** Spends that land together (Generate all is one request, but a redraw storm is many) make one read. */
const DEBOUNCE_MS = 250
const READ_TIMEOUT_MS = 8_000
/** A wait longer than this is not shown as a countdown the person must sit through. */
const MAX_WAIT_SEC = 120

const LOADING: UsageState = { status: 'loading', usage: null, waitSec: 0 }

let state: UsageState = LOADING
let fetchedAt = 0
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null
let again = false
let poller: ReturnType<typeof setInterval> | null = null
let debounce: ReturnType<typeof setTimeout> | null = null
let waitTimer: ReturnType<typeof setTimeout> | null = null

function set(next: Partial<UsageState>): void {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

/** The shape this screen relies on; anything else is treated as a failed read. */
function isUsageView(data: unknown): data is UsageView {
  if (!data || typeof data !== 'object') return false
  const d = data as Partial<UsageView>
  return (
    typeof d.metering === 'boolean' &&
    typeof d.images === 'object' &&
    d.images !== null &&
    typeof d.projects === 'object' &&
    d.projects !== null &&
    typeof d.resetsAt === 'string'
  )
}

async function load(): Promise<void> {
  try {
    const res = await apiFetch('/api/usage', { cache: 'no-store', signal: AbortSignal.timeout(READ_TIMEOUT_MS) })
    const data: unknown = res.ok ? await res.json() : null
    if (!isUsageView(data)) throw new Error('usage unreadable')
    fetchedAt = Date.now()
    set({ status: 'ready', usage: data })
  } catch {
    // Quiet: the last good numbers stay; with none the screens show their failure state.
    if (!state.usage) set({ status: 'error' })
  }
}

/** Read the usage now. Never two reads at once: a request that arrives mid-read earns exactly one more after it. */
export function refreshUsage(): Promise<void> {
  if (inflight) {
    again = true
    return inflight
  }
  inflight = load().finally(() => {
    inflight = null
    if (again) {
      again = false
      void refreshUsage()
    }
  })
  return inflight
}

/** Tell every screen that something spent (or gave something back): the usage is read again. */
export function announceUsageChanged(detail: UsageChange = {}): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<UsageChange>(USAGE_CHANGED_EVENT, { detail }))
}

function onChanged(e: Event): void {
  const refusal = (e as CustomEvent<UsageChange | undefined>).detail?.refusal
  if (refusal?.code === 'rate' && refusal.retryAfterSec) holdFor(refusal.retryAfterSec)
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    debounce = null
    void refreshUsage()
  }, DEBOUNCE_MS)
}

/** Hold the buttons shut for `sec` seconds, then open them. */
function holdFor(sec: number): void {
  const wait = Math.min(MAX_WAIT_SEC, Math.max(1, Math.ceil(sec)))
  if (waitTimer) clearTimeout(waitTimer)
  set({ waitSec: wait })
  waitTimer = setTimeout(() => {
    waitTimer = null
    set({ waitSec: 0 })
  }, wait * 1000)
}

function onVisible(): void {
  if (document.visibilityState === 'visible' && Date.now() - fetchedAt > FRESH_MS) void refreshUsage()
}

function start(): void {
  window.addEventListener(USAGE_CHANGED_EVENT, onChanged)
  document.addEventListener('visibilitychange', onVisible)
  poller = setInterval(() => {
    if (document.visibilityState === 'visible') void refreshUsage()
  }, POLL_MS)
  // A read already on the wire (a remount in development) is the one this mount wants.
  if (!inflight && Date.now() - fetchedAt > FRESH_MS) void refreshUsage()
}

function stop(): void {
  window.removeEventListener(USAGE_CHANGED_EVENT, onChanged)
  document.removeEventListener('visibilitychange', onVisible)
  if (poller) clearInterval(poller)
  if (debounce) clearTimeout(debounce)
  poller = debounce = null
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) start()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) stop()
  }
}

const snapshot = (): UsageState => state
const serverSnapshot = (): UsageState => LOADING

/** Today's usage, shared by every screen on the page. `refresh` reads it again now (the Usage page's "Try again"). */
export function useUsage(): UsageState & { refresh: () => Promise<void> } {
  const s = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  const refresh = useCallback(() => refreshUsage(), [])
  return useMemo(() => ({ ...s, refresh }), [s, refresh])
}

/**
 * May a button that takes `need` be pressed — `blocked`, the `reason` (a calm
 * sentence with the reset time), a `short` form for tight places, and
 * `settled`: whether the usage has been read (or failed to), for a screen
 * that should not act on arrival before it knows.
 */
export function useSpend(need: Need): SpendBlock & { settled: boolean } {
  const { usage, status, waitSec } = useUsage()
  const { images, project, videoSeconds, audioChars, text } = need
  const block = useMemo(
    () => spendBlock(usage, { images, project, videoSeconds, audioChars, text }, { waitSec }),
    [usage, waitSec, images, project, videoSeconds, audioChars, text]
  )
  return useMemo(() => ({ ...block, settled: status !== 'loading' }), [block, status])
}

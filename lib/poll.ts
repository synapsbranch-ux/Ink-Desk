// How the studio asks "has anything changed?" while something is being drawn
// (v3, slice 21 — closes CR-8, "Polling storm"). Pure and client-safe: the
// decisions live here, the Studio only supplies the reads and a clock, and
// `scripts/poll-check.mts` drives all of it with a fake one.
//
// THE SHAPE. Until slice 21 an open studio re-read the whole desk every 1.5 s
// for as long as anything was inking: a project parse, a demotion pass and a
// desk-sized reply, per tab, per second and a half. Now it asks the light
// `GET /api/projects/<id>/status` — `{ rev, activity }`, a stamp and the job
// list — and reads the full desk only when that says there is something to
// read: the project's `rev` is not the one the desk in hand carries, or a job
// that was live is gone, or nothing is live any more (the one extra read that
// picks the finished art up, and — because the full read is what demotes a
// panel no live job holds — the one that heals a desk that still says
// "inking").
//
// THE CLOCK. A recursive timeout, never an interval: the next look is
// scheduled only when the last has finished, so reads cannot overlap however
// slow the network is.
//   · 1.5 s while the answer changes;
//   · an answer identical to the last backs off gently (×1.5, up to 6 s) —
//     the picture lands in a burst, but a minute of nothing new should not cost
//     a minute of 1.5 s reads;
//   · a failed or refused read backs off hard (doubling, up to 30 s), and a
//     429 waits at least as long as the `Retry-After` it came with (never
//     more than two minutes: a header is not a reason to go silent for good);
//   · the first good answer starts it over at 1.5 s;
//   · a hidden tab asks nothing — the timer that fires while hidden just
//     lies down — and coming back to it reads once at once.
// While the queue alone is down (nothing drawing) the same machine runs on the
// slow 10 s cadence and never reads the desk unless its `rev` moves.
import type { Activity } from './queue/jobs'
import { isActive } from './queue/jobs'

/** What `GET /api/projects/<id>/status` answers: tiny by design. */
export type StatusReply = { rev: string; activity: Activity }

export type Cadence = {
  /** How soon the next look is while the answer is changing (and the first delay after a quiet start). */
  fastMs: number
  /** The longest an unchanged answer is allowed to stretch the wait to. */
  sameCapMs: number
  /** The longest a failure is allowed to stretch it to. */
  errorCapMs: number
}

/** While something is inking. */
export const LIVE_CADENCE: Cadence = { fastMs: 1_500, sameCapMs: 6_000, errorCapMs: 30_000 }
/** While only the queue is down: look again now and then so the line clears itself. */
export const RECHECK_CADENCE: Cadence = { fastMs: 10_000, sameCapMs: 10_000, errorCapMs: 30_000 }
/** The longest a `Retry-After` is believed. */
export const RETRY_AFTER_CAP_MS = 120_000
/** Coming back to a tab reads at once, unless a read has just started. */
export const RESUME_GAP_MS = 1_000
/** The extra read after the last job is tried this many times, then let go. */
const GIVE_UP_AFTER = 4

/** Which loop is wanted: inking, a queue to look in on, or nothing at all. */
export type PollMode = 'live' | 'recheck' | 'off'

// --- The pieces, pure --------------------------------------------------------------------------------

/** `Retry-After` as milliseconds: whole seconds, or an HTTP date. Null for anything else (and for 0 or less: no help). */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | null {
  if (!value) return null
  const trimmed = value.trim()
  let ms: number
  if (/^\d+$/.test(trimmed)) ms = Number(trimmed) * 1000
  else {
    const at = Date.parse(trimmed)
    if (Number.isNaN(at)) return null
    ms = at - now
  }
  return ms > 0 ? Math.min(ms, RETRY_AFTER_CAP_MS) : null
}

/** The ids of the jobs waiting or drawing, sorted. */
export function activeIds(activity: Activity | undefined): string[] {
  return (activity?.jobs.filter(isActive).map((j) => j.id) ?? []).sort()
}

/**
 * Has the answer changed? The project's `rev`, which jobs are live and how
 * each stands, and the queue's own state — not a job's `updatedAt`, which a
 * lease renewal moves without anything having happened.
 */
export function signature(reply: StatusReply): string {
  const jobs = reply.activity.jobs.map((j) => `${j.id}:${j.status}:${j.outcome ?? ''}:${j.error ?? ''}`).sort()
  return JSON.stringify([reply.rev, jobs, reply.activity.queue.state])
}

export type DeskReason = 'rev' | 'ended' | 'idle' | 'forced'

/**
 * Does the full desk need reading now, and why?
 *   forced  the caller says so (the extra read after the last job ended);
 *   rev     the project moved on from the desk in hand (or there is no desk yet);
 *   ended   a job that was live a moment ago is not any more;
 *   idle    in the live loop, nothing is live — read what became of it, and let the desk's own reader demote a panel nothing holds.
 */
export function deskReason(input: {
  rev: string
  deskRev: string | null
  before: readonly string[]
  now: readonly string[]
  idleRead: boolean
  forced: boolean
}): DeskReason | null {
  if (input.forced) return 'forced'
  if (input.deskRev !== input.rev) return 'rev'
  if (input.before.some((id) => !input.now.includes(id))) return 'ended'
  if (input.idleRead && input.now.length === 0) return 'idle'
  return null
}

export type PollState = {
  /** Reads in a row that failed. */
  failures: number
  /** Answers in a row identical to the one before. */
  same: number
  /** The last answer's signature. */
  sig: string | null
  /** The jobs that were live in it. */
  active: string[]
}

export const FRESH: PollState = { failures: 0, same: 0, sig: null, active: [] }

/** The wait after a good answer, and the state that goes with it. */
export function afterAnswer(state: PollState, sig: string, active: string[], cadence: Cadence): { state: PollState; delayMs: number } {
  if (sig !== state.sig) return { state: { failures: 0, same: 0, sig, active }, delayMs: cadence.fastMs }
  const same = state.same + 1
  return { state: { failures: 0, same, sig, active }, delayMs: Math.min(cadence.sameCapMs, Math.round(cadence.fastMs * 1.5 ** same)) }
}

/** The wait after a failed or refused read; a 429's `Retry-After` is a floor. */
export function afterFailure(state: PollState, cadence: Cadence, retryAfterMs: number | null = null): { state: PollState; delayMs: number } {
  const failures = state.failures + 1
  const backoff = Math.min(cadence.errorCapMs, cadence.fastMs * 2 ** failures)
  const delayMs = retryAfterMs === null ? backoff : Math.max(backoff, Math.min(retryAfterMs, RETRY_AFTER_CAP_MS))
  return { state: { ...state, failures }, delayMs }
}

// --- The scheduler -------------------------------------------------------------------------------------

export type StatusRead =
  | { kind: 'ok'; reply: StatusReply }
  /** 429: the server asked for a wait. */
  | { kind: 'limited'; retryAfterMs: number | null }
  | { kind: 'failed' }
  /** A newer reply landed while this was on the wire: its answer is the older one; drop it. */
  | { kind: 'stale' }

export type PollerDeps = {
  /** Ask the light route. Never throws. */
  readStatus(): Promise<StatusRead>
  /** Read the full desk and take it in. False when it could not be read. */
  readDesk(): Promise<boolean>
  /** The `updatedAt` of the desk the studio holds now, null before it has one. */
  deskRev(): string | null
  /** Take a status reply's activity in. */
  apply(reply: StatusReply): void
  /** Called just before a desk read the poller decided on (and how many jobs are live), so the studio can stop owing the extra read. */
  willReadDesk?(reason: DeskReason, activeNow: number): void
  visible(): boolean
  /** Run `fn` after `ms`; the return value cancels it. */
  after(ms: number, fn: () => void): () => void
  now(): number
}

export type Poller = {
  setMode(mode: PollMode): void
  /** The tab came back (or the page woke): read now, unless a read just began. */
  resume(): void
  /** The extra full read after the last job ended — alone, once, whatever the mode. */
  final(): void
  stop(): void
}

/**
 * The scheduler: one per open studio. `setMode('live')` starts the 1.5 s
 * loop, `'recheck'` the 10 s one, `'off'` stops looking. Never two reads at
 * once; a read asked for while one is out is remembered (`final`) or dropped
 * (`resume`) — the one in flight is the look.
 */
export function createPoller(deps: PollerDeps): Poller {
  let mode: PollMode = 'off'
  let state: PollState = FRESH
  let cancel: (() => void) | null = null
  let busy = false
  let paused = false
  /** The next look reads the full desk whatever the answer (the extra read after the last job, or one that failed and is being retried). */
  let owed = false
  /** `final` was asked for while a look was out: the very next look, no wait. */
  let rush = false
  let stopped = false
  let lastStart = Number.NEGATIVE_INFINITY

  const cadence = () => (mode === 'recheck' ? RECHECK_CADENCE : LIVE_CADENCE)

  function clear() {
    cancel?.()
    cancel = null
  }

  function schedule(delayMs: number) {
    clear()
    if (stopped || (mode === 'off' && !owed)) return
    cancel = deps.after(delayMs, () => {
      cancel = null
      // A tab nobody can see asks nothing; coming back (`resume`) starts the loop again.
      if (!deps.visible()) {
        paused = true
        return
      }
      void cycle()
    })
  }

  async function cycle(): Promise<void> {
    if (busy || stopped) return
    busy = true
    paused = false
    clear()
    lastStart = deps.now()
    const forced = owed
    owed = false
    let delayMs = cadence().fastMs
    try {
      const read = await deps.readStatus()
      if (stopped) return
      if (read.kind === 'stale') {
        // Not news (a newer reply landed while this was out). Look again soon; the extra read, if owed, still is.
        owed = forced
        return
      }
      if (read.kind !== 'ok') {
        const next = afterFailure(state, cadence(), read.kind === 'limited' ? read.retryAfterMs : null)
        state = next.state
        delayMs = next.delayMs
        owed = forced
        return
      }
      const { reply } = read
      const now = activeIds(reply.activity)
      const reason = deskReason({
        rev: reply.rev,
        deskRev: deps.deskRev(),
        before: state.active,
        now,
        idleRead: mode === 'live',
        forced,
      })
      deps.apply(reply)
      if (reason !== null) {
        deps.willReadDesk?.(reason, now.length)
        const got = await deps.readDesk().catch(() => false)
        if (!got) {
          const next = afterFailure(state, cadence())
          state = next.state
          delayMs = next.delayMs
          owed = forced
          return
        }
      }
      // After a desk read the studio holds this rev, so a repeat of the same answer is a quiet one.
      const next = afterAnswer(state, signature(reply), now, cadence())
      state = next.state
      delayMs = next.delayMs
    } finally {
      busy = false
      // An extra read that keeps failing is let go after a few tries; the next change of the desk would carry the picture anyway.
      if (owed && mode === 'off' && state.failures >= GIVE_UP_AFTER) owed = false
      if (stopped) {
        // nothing more
      } else if (rush) {
        // `final` was asked for while this look was out: the next one, now.
        rush = false
        owed = true
        void cycle()
      } else {
        schedule(delayMs)
      }
    }
  }

  return {
    setMode(next) {
      if (stopped || next === mode) return
      mode = next
      state = FRESH
      if (next === 'off') {
        paused = false
        // A look that is out finishes; an extra read still owed keeps its place.
        if (owed) schedule(LIVE_CADENCE.fastMs)
        else clear()
        return
      }
      // A running look finishes and then schedules on the new cadence.
      if (!busy) schedule(cadence().fastMs)
    },
    resume() {
      if (stopped || busy || !deps.visible()) return
      if (mode === 'off' && !owed) return
      if (!paused && cancel === null) return
      if (!paused && deps.now() - lastStart < RESUME_GAP_MS) return
      void cycle()
    },
    final() {
      if (stopped) return
      if (busy) {
        rush = true
        return
      }
      owed = true
      void cycle()
    },
    stop() {
      stopped = true
      clear()
    },
  }
}

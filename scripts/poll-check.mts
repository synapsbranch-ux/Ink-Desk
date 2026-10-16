// Slice 21's polling check — the light status route and the scheduler that uses
// it (`devpost/security-report.md` CR-8, "Polling storm"):
//
//   npm run check:poll   (or: npx tsx scripts/poll-check.mts)
//
// Part 1 is the scheduler, `lib/poll.ts`, driven with a fake clock and scripted
// reads: reads never overlap however slow one is; the wait is 1.5 s while the
// answer changes, grows gently for identical answers (6 s at most), doubles on
// failures up to 30 s and starts over at the first good answer; a 429's
// `Retry-After` is a floor (and is not believed past two minutes); a hidden tab
// asks nothing and one look is taken when it comes back; the full desk is read
// only when the project's `rev` is not the one in hand, a job that was live is
// gone, or nothing is live any more — and once, as the extra read, after the
// last job ends; a failed desk read is retried on the backoff, not at once.
//
// Part 2 is `GET /api/projects/<id>/status`, as a route handler on a scratch
// desk in test mode with `fetch` stubbed (nothing leaves this machine): the
// owner's 404 for anyone else (word for word the desk's), a 401 signed out, the
// read window and its `Retry-After`, `no-store`, a reply that is a small
// fraction of the desk's, `rev` that is exactly the desk's `updatedAt` and moves
// when the project is edited, the live job set equal to the desk's own
// `activity`, a lapsed lease let go like the desk lets it go — and not one
// byte of the project written (a panel still "inking" that no live job holds
// is left for the desk read to demote, and is).
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ok = (msg: string) => console.log(`  ok  ${msg}`)

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-poll-'))
const env = process.env as Record<string, string | undefined>
for (const name of Object.keys(env)) {
  if (/^(CLERK_|NEXT_PUBLIC_CLERK_|S3_|DB_|MONGODB_|REDIS_|RAILWAY_|ANTHROPIC_|OPENROUTER_|INKDESK_|IMAGE_|QUOTA_|RATE_|USER_DAILY_|GLOBAL_|ALLOWLIST_|TRUSTED_|QUEUE_|GENERATION_|LLM_)/.test(name)) delete env[name]
}
env.INKDESK_DATA_DIR = dir
env.INKDESK_STORAGE = 'local'
env.INKDESK_AUTH = 'test'
env.INKDESK_QUEUE = 'inline'
delete env.NODE_ENV

const outbound: string[] = []
globalThis.fetch = (async (input: RequestInfo | URL) => {
  outbound.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  throw new Error('the poll check never reaches a provider')
}) as typeof fetch

const P = await import('../lib/poll')
type Deps = import('../lib/poll').PollerDeps
type Read = import('../lib/poll').StatusRead
type Reply = import('../lib/poll').StatusReply
import type { Activity, JobView } from '../lib/queue/jobs'

// --- Part 1: the pieces ---------------------------------------------------------------------------

const okQueue = { mode: 'inline', state: 'ok', message: null } as const
let n = 0
const view = (status: JobView['status'], patch: Partial<JobView> = {}): JobView => ({
  id: `job-${++n}`,
  kind: 'panel',
  status,
  outcome: null,
  error: null,
  target: { chapterId: 'c', pageIndex: 0, index: 0 },
  updatedAt: new Date(Date.UTC(2026, 9, 16, 12, 0, n)).toISOString(),
  ...patch,
})
const activity = (...jobs: JobView[]): Activity => ({ jobs, queue: okQueue })
const reply = (rev: string, ...jobs: JobView[]): Reply => ({ rev, activity: activity(...jobs) })

// Retry-After: seconds or a date; nonsense is no help; two minutes is the most it is believed.
assert.equal(P.parseRetryAfter('7'), 7000)
assert.equal(P.parseRetryAfter(' 12 '), 12_000)
assert.equal(P.parseRetryAfter('0'), null)
assert.equal(P.parseRetryAfter(null), null)
assert.equal(P.parseRetryAfter(''), null)
assert.equal(P.parseRetryAfter('soon'), null)
assert.equal(P.parseRetryAfter('-5'), null)
assert.equal(P.parseRetryAfter('86400'), P.RETRY_AFTER_CAP_MS)
assert.equal(P.parseRetryAfter(new Date(10_000 + 30_000).toUTCString(), 10_000), 30_000, 'an HTTP date, a whole second at its precision')
assert.equal(P.parseRetryAfter(new Date(1_000).toUTCString(), 10_000), null, 'a date in the past is no help')
ok('Retry-After: seconds or a date, nonsense and the past are no help, never believed past two minutes')

// Signature: a lease renewal (updatedAt) is not news; a job moving, ending or failing is.
const running = view('running')
const same = P.signature(reply('r1', running))
assert.equal(P.signature(reply('r1', { ...running, updatedAt: '2030-01-01T00:00:00.000Z' })), same)
assert.notEqual(P.signature(reply('r2', running)), same, 'the rev moved')
assert.notEqual(P.signature(reply('r1', { ...running, status: 'queued' })), same)
assert.notEqual(P.signature(reply('r1')), same)
assert.notEqual(P.signature({ rev: 'r1', activity: { jobs: [running], queue: { mode: 'bullmq', state: 'busy', message: 'x' } } }), same, 'the queue going down is news')
assert.deepEqual(P.activeIds(activity(view('queued'), view('failed', { error: 'no' }), view('running'))).length, 2, 'only waiting or drawing jobs are active')
ok('signature ignores a lease renewal and sees a rev, a job and the queue move')

// deskReason.
const base = { rev: 'r1', deskRev: 'r1', before: [] as string[], now: ['a'], idleRead: true, forced: false }
assert.equal(P.deskReason(base), null, 'same rev, a job still drawing: nothing to read')
assert.equal(P.deskReason({ ...base, deskRev: 'r0' }), 'rev')
assert.equal(P.deskReason({ ...base, deskRev: null }), 'rev', 'no desk yet')
assert.equal(P.deskReason({ ...base, before: ['a', 'b'], now: ['a'] }), 'ended')
assert.equal(P.deskReason({ ...base, before: ['a'], now: ['a', 'c'] }), null, 'a job added is not a job ended')
assert.equal(P.deskReason({ ...base, now: [] }), 'idle')
assert.equal(P.deskReason({ ...base, now: [], idleRead: false }), null, 'the slow queue look does not read the desk for being idle')
assert.equal(P.deskReason({ ...base, forced: true }), 'forced')
ok('the desk is read for a moved rev, an ended job, an idle live loop, or when told to — and not otherwise')

// Waits.
{
  let s = P.FRESH
  const waits: number[] = []
  const a = P.afterAnswer(s, 'A', [], P.LIVE_CADENCE)
  s = a.state
  waits.push(a.delayMs)
  for (let i = 0; i < 6; i++) {
    const b = P.afterAnswer(s, 'A', [], P.LIVE_CADENCE)
    s = b.state
    waits.push(b.delayMs)
  }
  assert.deepEqual(waits, [1500, 2250, 3375, 5063, 6000, 6000, 6000], 'a changing answer 1.5 s, an unchanged one stretches to 6 s')
  const c = P.afterAnswer(s, 'B', [], P.LIVE_CADENCE)
  assert.equal(c.delayMs, 1500, 'a new answer starts over')
  const failures: number[] = []
  let f = P.FRESH
  for (let i = 0; i < 7; i++) {
    const x = P.afterFailure(f, P.LIVE_CADENCE)
    f = x.state
    failures.push(x.delayMs)
  }
  assert.deepEqual(failures, [3000, 6000, 12_000, 24_000, 30_000, 30_000, 30_000], 'failures double, up to 30 s')
  assert.equal(P.afterAnswer(f, 'A', [], P.LIVE_CADENCE).state.failures, 0, 'a good answer clears the failures')
  assert.equal(P.afterFailure(P.FRESH, P.LIVE_CADENCE, 20_000).delayMs, 20_000, 'Retry-After is a floor')
  assert.equal(P.afterFailure(P.FRESH, P.LIVE_CADENCE, 1_000).delayMs, 3000, 'and the backoff is not shortened by a small one')
  assert.equal(P.afterFailure(P.FRESH, P.LIVE_CADENCE, 9_999_999).delayMs, P.RETRY_AFTER_CAP_MS, 'a huge one is capped')
  assert.deepEqual([P.afterAnswer(P.FRESH, 'x', [], P.RECHECK_CADENCE).delayMs, P.afterAnswer(P.afterAnswer(P.FRESH, 'x', [], P.RECHECK_CADENCE).state, 'x', [], P.RECHECK_CADENCE).delayMs], [10_000, 10_000], 'the queue look stays slow')
  ok('waits: 1.5 s changing, 2.25 → 6 s unchanged, 3 → 30 s failing, Retry-After a floor capped at two minutes')
}

// --- Part 1b: the scheduler, on a fake clock ---------------------------------------------------------

const settle = () => new Promise<void>((r) => setImmediate(r))

type Script = { status: Array<Read | (() => Promise<Read>)>; desk: Array<boolean | (() => Promise<boolean>)> }

function world(init: { visible?: boolean; deskRev?: string | null } = {}) {
  let t = 0
  type Timer = { at: number; fn: () => void; dead: boolean }
  const timers: Timer[] = []
  const log = { status: 0, desk: 0, waits: [] as number[], applied: [] as Reply[], reasons: [] as string[], statusAt: [] as number[] }
  const script: Script = { status: [], desk: [] }
  let visible = init.visible ?? true
  let deskRev: string | null = init.deskRev ?? null
  let inflight = 0
  let maxInflight = 0
  const fallback: Read = { kind: 'failed' }
  const track = async <T,>(go: () => Promise<T>): Promise<T> => {
    inflight++
    maxInflight = Math.max(maxInflight, inflight)
    try {
      return await go()
    } finally {
      inflight--
    }
  }
  const deps: Deps = {
    readStatus: () =>
      track(async () => {
        log.status++
        log.statusAt.push(t)
        const next = script.status.shift()
        if (next === undefined) return fallback
        return typeof next === 'function' ? next() : next
      }),
    readDesk: () =>
      track(async () => {
        log.desk++
        const next = script.desk.shift()
        const done = next === undefined ? true : typeof next === 'function' ? await next() : next
        if (done) deskRev = lastRev
        return done
      }),
    deskRev: () => deskRev,
    apply: (r) => {
      log.applied.push(r)
      lastRev = r.rev
    },
    willReadDesk: (reason, active) => log.reasons.push(`${reason}/${active}`),
    visible: () => visible,
    after: (ms, fn) => {
      log.waits.push(ms)
      const timer: Timer = { at: t + ms, fn, dead: false }
      timers.push(timer)
      return () => {
        timer.dead = true
      }
    },
    now: () => t,
  }
  let lastRev = ''
  async function advance(ms: number) {
    const end = t + ms
    for (;;) {
      const due = timers.filter((x) => !x.dead && x.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      t = due.at
      due.dead = true
      due.fn()
      await settle()
    }
    t = end
    await settle()
  }
  return {
    deps,
    log,
    script,
    advance,
    setVisible: (v: boolean) => (visible = v),
    setDeskRev: (r: string | null) => (deskRev = r),
    get maxInflight() {
      return maxInflight
    },
    pending: () => timers.filter((x) => !x.dead).length,
  }
}

const good = (rev: string, ...jobs: JobView[]): Read => ({ kind: 'ok', reply: reply(rev, ...jobs) })

// No overlap: a read that takes a minute is the only one there is.
{
  const w = world({ deskRev: 'r1' })
  let release: (r: Read) => void = () => {}
  w.script.status.push(() => new Promise<Read>((res) => (release = res)))
  const job = view('running')
  const p = P.createPoller(w.deps)
  p.setMode('live')
  await w.advance(1500)
  assert.equal(w.log.status, 1)
  await w.advance(120_000)
  p.resume()
  p.resume()
  p.final()
  await w.advance(60_000)
  assert.equal(w.log.status, 1, 'a read out for three minutes, a tab coming back twice and an extra read asked for: still the one')
  assert.equal(w.pending(), 0, 'and nothing is scheduled behind it')
  release(good('r1', job))
  await settle()
  assert.equal(w.log.status, 2, 'when it ends, the owed extra read is next — at once, no wait')
  assert.equal(w.maxInflight, 1)
  p.stop()
  ok('reads never overlap: a hung one holds the whole loop, and a resume or an extra read asked for meanwhile does not start a second')
}

// Cadence: changing 1.5 s, unchanged stretches, new answer starts over, no desk read while the rev is the one in hand.
{
  const w = world({ deskRev: 'r1' })
  const job = view('running')
  const p = P.createPoller(w.deps)
  for (let i = 0; i < 6; i++) w.script.status.push(good('r1', job))
  w.script.status.push(good('r2', job)) // the project moved
  p.setMode('live')
  await w.advance(120_000)
  assert.deepEqual(w.log.waits.slice(0, 8), [1500, 1500, 2250, 3375, 5063, 6000, 6000, 1500], 'first look at 1.5 s; the repeats stretch; the moved rev starts it over')
  assert.equal(w.log.desk, 1, 'one desk read in six quiet looks and one that moved: the one that moved')
  assert.deepEqual(w.log.reasons, ['rev/1'])
  assert.equal(w.maxInflight, 1)
  p.stop()
  ok('cadence: 1.5 s while it changes, stretching to 6 s when it does not, and the desk is read only when the rev moved')
}

// Failures: 3, 6, 12, 24, 30, 30 — a 429 waits its Retry-After — first good answer resets.
{
  const w = world({ deskRev: 'r1' })
  const job = view('running')
  const p = P.createPoller(w.deps)
  w.script.status.push({ kind: 'failed' }, { kind: 'failed' }, { kind: 'failed' }, { kind: 'failed' }, { kind: 'failed' }, { kind: 'failed' })
  w.script.status.push({ kind: 'limited', retryAfterMs: 45_000 })
  w.script.status.push({ kind: 'limited', retryAfterMs: null })
  w.script.status.push(good('r1', job))
  p.setMode('live')
  await w.advance(600_000)
  assert.deepEqual(w.log.waits.slice(0, 10), [1500, 3000, 6000, 12_000, 24_000, 30_000, 30_000, 45_000, 30_000, 1500], 'failures double to 30 s; a 429 waits its Retry-After; a 429 with none just backs off; a good answer starts over')
  assert.equal(w.log.desk, 0)
  p.stop()
  ok('failures and 429s back off 3 → 30 s, honour Retry-After, and the first good answer resets to 1.5 s')
}

// A 429 whose Retry-After is longer than the backoff pushes the next look out by exactly that.
{
  const w = world({ deskRev: 'r1' })
  const p = P.createPoller(w.deps)
  w.script.status.push({ kind: 'limited', retryAfterMs: 20_000 })
  p.setMode('live')
  await w.advance(1500)
  assert.equal(w.log.status, 1)
  await w.advance(19_999)
  assert.equal(w.log.status, 1, 'nothing for 19.999 s')
  await w.advance(2)
  assert.equal(w.log.status, 2, 'and the next look at 20 s')
  p.stop()
  ok('a 429 with Retry-After: 20 is left alone for 20 seconds')
}

// A hidden tab: the timer that fires hides; coming back reads once.
{
  const w = world({ deskRev: 'r1' })
  const job = view('running')
  const p = P.createPoller(w.deps)
  for (let i = 0; i < 10; i++) w.script.status.push(good('r1', job))
  p.setMode('live')
  await w.advance(1500)
  assert.equal(w.log.status, 1)
  w.setVisible(false)
  await w.advance(600_000)
  assert.equal(w.log.status, 1, 'ten minutes hidden: not one read')
  assert.equal(w.pending(), 0, 'and no timer left ticking')
  w.setVisible(true)
  p.resume()
  p.resume()
  await w.advance(0)
  assert.equal(w.log.status, 2, 'back: one read, at once, however many times the browser says so')
  await w.advance(2_300)
  assert.equal(w.log.status, 3, 'and the loop goes on')
  p.stop()
  ok('a hidden tab asks nothing; coming back reads once at once and the loop resumes')
}

// Coming back while a read has only just begun does not read twice; a long-pending backoff is cut short by a return.
{
  const w = world({ deskRev: 'r1' })
  const p = P.createPoller(w.deps)
  for (let i = 0; i < 6; i++) w.script.status.push({ kind: 'failed' })
  p.setMode('live')
  await w.advance(1500 + 3000 + 6000 + 12_000 + 24_000) // 5 failures: the next wait is 30 s
  const before = w.log.status
  p.resume()
  await settle()
  assert.equal(w.log.status, before, 'a read has only just ended: a return right now is not a reason for another')
  await w.advance(P.RESUME_GAP_MS + 1)
  p.resume()
  await settle()
  assert.equal(w.log.status, before + 1, 'a return during a long backoff reads')
  p.stop()
  ok('a return during a long backoff reads once; one right behind a read does not')
}

// The desk: read when it moved, when a job ended, and once — the extra read — when nothing is live; never in between.
{
  const w = world({ deskRev: 'r1' })
  const a = view('running')
  const b = view('queued')
  const p = P.createPoller(w.deps)
  w.script.status.push(good('r1', a, b), good('r1', a, b), good('r1', a, b)) // nothing new
  w.script.status.push(good('r2', a, b)) // a panel landed: rev moved
  w.script.status.push(good('r2', b)) // a ended, b still live
  w.script.status.push(good('r2', b))
  w.script.status.push(good('r3')) // b ended too: nothing is live and the rev moved
  w.script.status.push(good('r3')) // an idle live loop reads once more (the desk it read still said inking)
  p.setMode('live')
  await w.advance(120_000)
  assert.deepEqual(w.log.reasons, ['rev/2', 'ended/1', 'rev/0', 'idle/0'], 'rev; a job ended; the last ended with the rev moved too (the rev is told first); then the idle read')
  assert.equal(w.log.desk, 4)
  p.stop()
  ok('the desk is read when the rev moves, when a job ends and when nothing is live — and not between')
}

// The extra read after the last job ends, whoever noticed: the loop does it itself, and `final` does it when the studio learns elsewhere.
{
  const w = world({ deskRev: 'r1' })
  const p = P.createPoller(w.deps)
  w.script.status.push(good('r1')) // nothing live, rev the same as the desk: the idle read
  p.setMode('live')
  await w.advance(1500)
  assert.deepEqual(w.log.reasons, ['idle/0'], 'nothing live in the live loop: the one read that heals a desk that still says inking')
  p.setMode('off')
  await w.advance(120_000)
  assert.equal(w.log.status, 1, 'off means off')
  assert.equal(w.pending(), 0)

  // The studio learned from a save's reply that the last job is over: mode off, and an extra read asked for.
  w.script.status.push(good('r1'))
  p.final()
  await settle()
  assert.equal(w.log.status, 2)
  assert.deepEqual(w.log.reasons, ['idle/0', 'forced/0'], 'the extra read: status, then the full desk whatever the rev')
  await w.advance(120_000)
  assert.equal(w.log.status, 2, 'and then nothing more')
  p.stop()
  ok('after the last job ends the desk is read once more — by the loop itself, or by `final` when the studio heard it elsewhere — and then the studio goes quiet')
}

// An extra read that fails is retried on the backoff, not at once, and given up after a few.
{
  const w = world({ deskRev: 'r1' })
  const p = P.createPoller(w.deps)
  for (let i = 0; i < 12; i++) w.script.status.push({ kind: 'failed' })
  p.final()
  await settle()
  assert.equal(w.log.status, 1)
  await w.advance(2_999)
  assert.equal(w.log.status, 1, 'not at once')
  await w.advance(2)
  assert.equal(w.log.status, 2, 'after the backoff')
  await w.advance(10 * 60_000)
  assert.ok(w.log.status <= 5, `given up after a few (${w.log.status} reads)`)
  p.stop()
  ok('an extra read that fails is retried on the backoff and let go after a few tries')
}

// A desk read that fails is a failure (backoff), and the same reason is tried again.
{
  const w = world({ deskRev: 'r1' })
  const job = view('running')
  const p = P.createPoller(w.deps)
  w.script.status.push(good('r2', job), good('r2', job), good('r2', job))
  w.script.desk.push(false, true)
  p.setMode('live')
  await w.advance(1500)
  assert.deepEqual([w.log.status, w.log.desk], [1, 1])
  await w.advance(2_999)
  assert.deepEqual([w.log.status, w.log.desk], [1, 1], 'a failed desk read waits 3 s')
  await w.advance(2)
  assert.deepEqual([w.log.status, w.log.desk], [2, 2], 'and then tries again, and this time it lands')
  await w.advance(1500)
  assert.equal(w.log.desk, 2, 'the desk in hand is the new one: no more reads')
  p.stop()
  ok('a failed desk read backs off and is tried again; once it lands the loop is quiet')
}

// A stale reply is dropped and looked at again soon.
{
  const w = world({ deskRev: 'r1' })
  const p = P.createPoller(w.deps)
  w.script.status.push({ kind: 'stale' }, good('r1', view('running')))
  p.setMode('live')
  await w.advance(1500)
  assert.equal(w.log.applied.length, 0, 'a stale answer is not taken in')
  assert.equal(w.log.desk, 0)
  await w.advance(1500)
  assert.equal(w.log.applied.length, 1)
  p.stop()
  ok('a reply that lands after a newer one is dropped, and nothing is read for it')
}

// The slow queue look: 10 s, never reads the desk for being idle, reads it when the rev moves; modes switch cleanly.
{
  const w = world({ deskRev: 'r1' })
  const p = P.createPoller(w.deps)
  const down: Activity = { jobs: [], queue: { mode: 'bullmq', state: 'busy', message: 'busy' } }
  for (let i = 0; i < 3; i++) w.script.status.push({ kind: 'ok', reply: { rev: 'r1', activity: down } })
  w.script.status.push({ kind: 'ok', reply: { rev: 'r2', activity: down } })
  p.setMode('recheck')
  await w.advance(35_000)
  assert.deepEqual(w.log.statusAt, [10_000, 20_000, 30_000], 'every ten seconds')
  assert.equal(w.log.desk, 0, 'an idle desk behind a queue that is down is not read')
  await w.advance(10_000)
  assert.deepEqual(w.log.reasons, ['rev/0'], 'until the project moves')
  // Jobs appear: the studio switches to live and the wait is 1.5 s.
  w.script.status.push(good('r2', view('running')))
  p.setMode('live')
  const at = w.log.statusAt.length
  await w.advance(1500)
  assert.equal(w.log.statusAt.length, at + 1)
  p.setMode('off')
  const total = w.log.status
  await w.advance(60_000)
  assert.equal(w.log.status, total)
  p.stop()
  ok('the queue-down look is every 10 s, reads the desk only when the rev moves, and the modes switch cleanly')
}

// A stopped poller does nothing, even with a read in flight.
{
  const w = world({ deskRev: 'r1' })
  const p = P.createPoller(w.deps)
  let release: (r: Read) => void = () => {}
  w.script.status.push(() => new Promise<Read>((res) => (release = res)))
  p.setMode('live')
  await w.advance(1500)
  p.stop()
  release(good('r2', view('running')))
  await w.advance(60_000)
  assert.deepEqual([w.log.desk, w.log.applied.length, w.log.status], [0, 0, 1], 'unmounted: the late answer is dropped and nothing is scheduled')
  p.setMode('live')
  p.final()
  await w.advance(60_000)
  assert.equal(w.log.status, 1)
  ok('a stopped (unmounted) poller drops the answer in flight and never starts again')
}

// --- Part 2: the route --------------------------------------------------------------------------------

const { store } = await import('../lib/store')
const J = await import('../lib/queue/jobs')
const { endJob } = await import('../lib/queue/ending')
const { emptyProject } = await import('../lib/types')
const { SIGN_IN_SENTENCE } = await import('../lib/auth/session')
const statusRoute = await import('../app/api/projects/[id]/status/route')
const deskRoute = await import('../app/api/projects/[id]/route')
const { NO_SUCH_PROJECT } = await import('../lib/auth/access')
import type { Character, Panel, Project } from '../lib/types'

const ALICE = 'user_alice'
const BOB = 'user_bob'

const call = (user: string | null, path: string) =>
  new Request(`http://localhost${path}`, { headers: user ? { 'x-inkdesk-test-user': user } : {} })
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const status = (user: string | null, id: string) => statusRoute.GET(call(user, `/api/projects/${id}/status`), params(id))
const desk = (user: string | null, id: string) => deskRoute.GET(call(user, `/api/projects/${id}`), params(id))

/** A desk with something on it: six pages of four panels, a cast with DNA, a synopsis, a scenario, a plan. */
async function makeProject(owner: string, title: string): Promise<string> {
  const id = crypto.randomUUID()
  const chapterId = crypto.randomUUID()
  await store.createProject({ ...emptyProject({ id, chapterId, title, stylePresetId: 'manga-bw', serverRunId: 'check' }), ownerId: owner })
  const at = new Date().toISOString()
  const words = (k: number) => Array.from({ length: k }, (_, i) => `word${i}`).join(' ')
  const characters: Character[] = ['Aki', 'Ren', 'Mio', 'Sato'].map((name, i) => ({
    id: `c${i}`,
    name,
    role: i === 0 ? 'lead' : 'counterpart',
    traits: ['quiet', 'stubborn', 'kind'],
    look: words(40),
    dna: words(90),
    sheetImageId: null,
    locked: false,
  }))
  const panel = (index: 0 | 1 | 2 | 3): Panel => ({
    index,
    characterId: 'c0',
    action: words(14),
    camera: 'medium shot',
    background: words(10),
    dialogue: words(9),
    bubble: { x: 10, y: 8, w: 40, h: 22, tailX: 30, tailY: 40 },
    versions: [],
    currentVersion: 0,
    status: 'empty',
    startedAt: null,
    startedByRun: null,
  })
  await store.updateProject(id, (p: Project) => ({
    ...p,
    story: {
      mode: 'pitch',
      pitch: { text: words(80), genre: 'drama', tone: 'warm' },
      synopsis: { title, body: words(160), accepted: true },
      scenario: null,
    },
    library: { characters, assets: [] },
    chapters: p.chapters.map((c) => ({
      ...c,
      plan: {
        pageCount: 6,
        coverBrief: words(30),
        source: 'synopsis' as const,
        summarized: false,
        writtenAt: at,
        pages: Array.from({ length: 6 }, () => ({
          panels: Array.from({ length: 4 }, () => ({ characterId: 'c0', action: words(14), camera: 'wide', background: words(10), dialogue: words(9) })),
        })),
      },
      pages: Array.from({ length: 6 }, (_, index) => ({ index, layoutId: 'four-shot' as const, panels: [panel(0), panel(1), panel(2), panel(3)] })),
    })),
  }))
  return id
}

const projectBytes = async (id: string) => JSON.stringify(await store.readProject(id))
const tree = async (root: string): Promise<string[]> => {
  const out: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) out.push(...(await tree(full)))
    else out.push(`${full}:${(await stat(full)).mtimeMs}:${(await stat(full)).size}`)
  }
  return out.sort()
}

try {
  const a = await makeProject(ALICE, 'A chapter with a lot of desk')
  const b = await makeProject(BOB, 'Bob’s')

  // Who may ask.
  {
    const res = await status(ALICE, a)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('Cache-Control'), 'no-store')
    const missing = await status(ALICE, crypto.randomUUID())
    const theirs = await status(BOB, a)
    const malformed = await status(ALICE, '../../etc/passwd')
    for (const r of [missing, theirs, malformed]) assert.equal(r.status, 404)
    const bodies = await Promise.all([missing, theirs, malformed].map((r) => r.clone().text()))
    assert.equal(new Set(bodies).size, 1, 'a project that is someone else’s, one that is missing and a garbage id: the same 404, word for word')
    assert.deepEqual(JSON.parse(bodies[0]), { error: NO_SUCH_PROJECT })
    const deskTheirs = await desk(BOB, a)
    assert.equal(await deskTheirs.text(), bodies[0], 'and word for word what the desk itself says')
    const nobody = await status(null, a)
    assert.equal(nobody.status, 401)
    assert.deepEqual(await nobody.json(), { error: SIGN_IN_SENTENCE })
    assert.equal((await status(BOB, b)).status, 200, 'bob’s own is bob’s')
    ok('owner-checked: bob gets alice’s project the missing project’s 404 (and the desk’s own word for word), a stranger 401, the owner 200 with no-store')
  }

  // The reply: tiny, equal to the desk's rev and activity, and moves with the project.
  {
    const key = (k: string) => `${a}:${k}`
    const claimed = crypto.randomUUID()
    const queuedId = crypto.randomUUID()
    const target = { kind: 'panel' as const, chapterId: (await store.readProject(a)).chapters[0].id }
    await store.jobs.insertJob(J.newJob({ key: key('0:0'), ownerId: ALICE, projectId: a, kind: 'panel', payload: { ...target, pageIndex: 0, index: 0 } }, claimed, new Date()))
    await endJob(claimed, (j) => J.claim(j, 'w1', new Date()))
    await store.jobs.insertJob(J.newJob({ key: key('0:1'), ownerId: ALICE, projectId: a, kind: 'panel', payload: { ...target, pageIndex: 0, index: 1 } }, queuedId, new Date()))

    const before = await projectBytes(a)
    const files = await tree(dir)
    const res = await status(ALICE, a)
    const text = await res.text()
    const body = JSON.parse(text) as { rev: string; activity: Activity }
    assert.deepEqual(Object.keys(body).sort(), ['activity', 'rev'])
    const activeBody = body.activity.jobs.filter((j) => j.status === 'queued' || j.status === 'running').map((j) => j.id).sort()
    const live = (await store.jobs.listJobs({ projectId: a, status: ['queued', 'running'] })).map((j) => j.id).sort()
    assert.deepEqual(activeBody, live, 'the active jobs it reports are exactly the project’s live job set')
    assert.deepEqual(activeBody, [claimed, queuedId].sort())
    assert.equal(body.activity.queue.state, 'ok')

    const deskRes = await desk(ALICE, a)
    const deskText = await deskRes.text()
    const full = JSON.parse(deskText) as { updatedAt: string; activity: Activity }
    assert.equal(body.rev, full.updatedAt, 'rev is exactly the desk’s updatedAt — what the studio compares it with')
    assert.deepEqual(
      full.activity.jobs.map((j) => [j.id, j.status]).sort(),
      body.activity.jobs.map((j) => [j.id, j.status]).sort(),
      'and the activity is the desk’s own'
    )
    const sizes = { status: Buffer.byteLength(text), desk: Buffer.byteLength(deskText) }
    assert.ok(sizes.status < sizes.desk / 5, `tiny: ${sizes.status} bytes against the desk’s ${sizes.desk}`)
    assert.ok(sizes.status < 1500, `${sizes.status} bytes`)
    console.log(`        status ${sizes.status} B, desk ${sizes.desk} B (${((100 * sizes.status) / sizes.desk).toFixed(1)}%), two live jobs`)

    // Nothing written: the project, and every file on the desk, as they were (the desk read on this project demotes nothing here).
    assert.equal(await projectBytes(a), before, 'the project is byte for byte what it was')
    assert.deepEqual(await tree(dir), files, 'and no file under the data dir was written, touched or made by the status read (the desk read after it wrote none either)')

    // The edit moves rev.
    await store.updateProject(a, (p: Project) => ({ ...p, title: 'Retitled' }))
    const after = (await (await status(ALICE, a)).json()) as { rev: string }
    assert.notEqual(after.rev, body.rev, 'rev moves when the project is edited')
    assert.equal(after.rev, ((await (await desk(ALICE, a)).json()) as { updatedAt: string }).updatedAt)
    ok('the reply is { rev, activity } and tiny; rev is the desk’s updatedAt and moves on an edit; the live job set is exact; nothing is written')

    // A lapsed lease is let go as the desk lets it go: both agree.
    await endJob(claimed, (j) => J.finish(j, { outcome: 'done' }, new Date()))
    const lapsed = crypto.randomUUID()
    await store.jobs.insertJob(J.newJob({ key: key('1:0'), ownerId: ALICE, projectId: a, kind: 'panel', payload: { ...target, pageIndex: 1, index: 0 } }, lapsed, new Date()))
    await endJob(lapsed, (j) => J.claim(j, 'w-gone', new Date(Date.now() - 3_600_000), 1_000))
    const s2 = (await (await status(ALICE, a)).json()) as { activity: Activity }
    const d2 = (await (await desk(ALICE, a)).json()) as { activity: Activity }
    const act = (x: { activity: Activity }) => x.activity.jobs.filter((j) => j.status === 'queued' || j.status === 'running').map((j) => j.id).sort()
    assert.deepEqual(act(s2), [queuedId], 'a job whose worker is gone is not live — not for the status, and the same for the desk')
    assert.deepEqual(act(s2), act(d2))
    const gone = s2.activity.jobs.find((j) => j.id === lapsed)
    assert.ok(!gone || gone.status === 'failed', 'it is let go (failed), not shown as drawing')
    ok('a job whose lease lapsed is let go and not reported live — the same answer the desk gives')
  }

  // A panel the desk says is inking, no live job holds it: status leaves the project alone; the desk read demotes it (and the rev moves).
  {
    const c = await makeProject(ALICE, 'Stuck')
    await store.updateProject(c, (p: Project) => ({
      ...p,
      chapters: p.chapters.map((ch) => ({
        ...ch,
        pages: ch.pages.map((pg, i) =>
          i === 0 ? { ...pg, panels: pg.panels.map((pn, k) => (k === 0 ? { ...pn, status: 'inking' as const, startedAt: new Date(Date.now() - 60_000).toISOString(), startedByRun: 'gone' } : pn)) } : pg
        ),
      })),
    }))
    const before = await projectBytes(c)
    const first = (await (await status(ALICE, c)).json()) as { rev: string; activity: Activity }
    const second = (await (await status(ALICE, c)).json()) as { rev: string }
    assert.equal(await projectBytes(c), before, 'the status read demoted nothing and wrote nothing')
    assert.equal(first.rev, second.rev)
    assert.equal(first.activity.jobs.filter((j) => j.status === 'queued' || j.status === 'running').length, 0, 'no live job holds it')
    const read = (await (await desk(ALICE, c)).json()) as { updatedAt: string; script: { status: string }[] | null }
    assert.equal(read.script?.[0].status, 'failed', 'the desk read is what heals it')
    assert.notEqual(read.updatedAt, first.rev, 'and it moves the rev — which is why a studio that sees nothing live takes the desk read')
    const third = (await (await status(ALICE, c)).json()) as { rev: string }
    assert.equal(third.rev, read.updatedAt, 'the status then carries the new rev')
    ok('a stuck "inking" panel with no live job is left alone by the status and healed by the desk read, which moves the rev')
  }

  // The read window is taken: past it a 429 with Retry-After and the calm sentence, and the owner check still came first.
  {
    env.RATE_READ_PER_MIN = '6'
    env.INKDESK_LIMITS = 'on'
    const carol = await makeProject('user_carol', 'Carol’s')
    const seen: number[] = []
    let limited: Response | null = null
    for (let i = 0; i < 12; i++) {
      const res = await status('user_carol', carol)
      seen.push(res.status)
      if (res.status === 429 && !limited) limited = res
    }
    assert.ok(limited, `the sixth-a-minute window closes: ${seen.join(' ')}`)
    assert.deepEqual(seen.slice(0, 7), [200, 200, 200, 200, 200, 200, 429], 'six reads a minute, the seventh refused')
    assert.ok(Number(limited.headers.get('Retry-After')) >= 1, 'with Retry-After')
    const refusal = (await limited.json()) as { error: string; code?: string; retryAfterSec?: number }
    assert.equal(refusal.code, 'rate')
    assert.match(refusal.error, /going a little fast/)
    assert.ok(P.parseRetryAfter(limited.headers.get('Retry-After')) !== null, 'and the studio reads that header')
    assert.equal((await status(BOB, b)).status, 200, 'bob has his own window')
    delete env.RATE_READ_PER_MIN
    delete env.INKDESK_LIMITS
    ok(`the read window applies (${seen.filter((s) => s === 200).length} reads, then 429 with Retry-After ${limited.headers.get('Retry-After')} and the calm sentence)`)
  }

  assert.deepEqual(outbound, [], 'nothing left this machine')
  ok('no outbound request was made')
  console.log('poll-check: all passed')
} finally {
  await rm(dir, { recursive: true, force: true })
}

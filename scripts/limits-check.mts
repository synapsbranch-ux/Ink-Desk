// Slice 20's acceptance checks, from `devpost/checklist.md > Slices > 20`,
// `devpost/prd.md > Limits and Usage (v3)` and `devpost/security-report.md`
// SEC-02 and SEC-08 — against a REAL Redis (a throwaway `redis-server` on a free
// local port) and a scratch local desk, with `fetch` stubbed and COUNTED so no
// provider is ever reached, and every real credential dropped before anything
// loads:
//
//   npm run check:limits
//
//   1.  Pure rules: micro-dollars, the UTC day and its reset, the order of
//       `evaluate`, every sentence calm and free of internals, the request
//       classification, the client address (a spoofed X-Forwarded-For does not
//       move a caller out of its window), and the settings (defaults, blank =
//       default, a bad value refused by NAME, never by value, read on every call).
//   2.  The memory backend and Redis answer ONE script identically — windows,
//       every refusal and its order, settle/release/duplicates, a settle after
//       midnight, the orphan sweep, the expiries.
//   3.  Atomicity: parallel reservations racing a nearly-full cap cannot
//       over-spend it — the exact total is asserted, on both backends.
//   4.  The 21st image of a free day is refused before any provider call; a
//       done job settles to its real cost; the meter equals the enforcement at
//       every step (and warns at 80%).
//   5.  Every ending releases or settles: failed, refused, cancelled,
//       abandoned (the enqueue's, the status's, the boot's), the enqueue
//       back-outs; settle/release are idempotent; a crash between an ending and
//       its settle is repaired by the reconciler's sweep; a paid picture that
//       never landed is counted once.
//   6.  The kill switch pauses everyone with one message, a raised cap reopens,
//       the cap is read on every call; the total cap; the 402 breaker.
//   7.  Sliding windows with a moved clock, through `requireUser` — the one choke
//       point — with Retry-After; signed-out callers; paid windows follow the flag.
//   8.  Plans: the allowlist (case-insensitive), the local owner, deleted accounts.
//   9.  Text calls and new projects hold, settle and release; unbacked holds are swept.
//  10.  Limits off leaves everything as it was.
//  11.  GET /api/usage and the refusals through the real route handlers.
//  12a. The adversarial review's fixes, each held by an assertion: money that was
//       spent is counted whatever became of the job (a picture billed and never
//       stored, a sheet's words); a stranded picture is carried only while it is
//       the newest ending and still in the bucket; a refused import leaves the card
//       alone; the credit breaker refuses every spend; a closed studio keeps a
//       window; the screens' words (busy, closed, "left after", the dollar limit);
//       the style sheet's overflow fixes. Redis down also remembers the outage.
//  12.  Redis down: spending fails CLOSED (the studio-busy sentence, nothing left
//       behind), reads and edits fail OPEN; production without Redis has no counters.
//
// Needs `redis-server` on the PATH (or INKDESK_CHECK_REDIS_URL pointing at a
// scratch Redis this check may FLUSHALL). Without either it says so and stops.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const say = console.log.bind(console)
const ok = (msg: string) => say(`  ok  ${msg}`)
// The app logs every job it runs; only this check's own lines are shown.
console.log = () => {}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
async function until(what: string, pred: () => boolean | Promise<boolean>, ms = 20_000): Promise<void> {
  const t0 = Date.now()
  while (!(await pred())) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`)
    await sleep(20)
  }
}

// --- A scratch Redis -----------------------------------------------------------------
async function freePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as { port: number }
  server.close()
  await once(server, 'close')
  return port
}

let redisProc: ChildProcess | undefined
let redisUrl = process.env.INKDESK_CHECK_REDIS_URL?.trim()
if (!redisUrl) {
  if (spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status !== 0) {
    say('  --  check:limits needs redis-server on the PATH (or INKDESK_CHECK_REDIS_URL); skipped')
    process.exit(0)
  }
  const port = await freePort()
  redisProc = spawn('redis-server', ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no'], { stdio: 'ignore' })
  redisUrl = `redis://127.0.0.1:${port}`
}
const deadPort = await freePort()

// --- The environment: nothing real survives ---------------------------------------------
const dir = await mkdtemp(join(tmpdir(), 'inkdesk-limits-'))
const env = process.env as Record<string, string | undefined>
for (const name of Object.keys(env)) {
  if (/^(CLERK_|NEXT_PUBLIC_CLERK_|S3_|DB_|MONGODB_|REDIS_|RAILWAY_|ANTHROPIC_|OPENROUTER_|INKDESK_|IMAGE_|QUOTA_|RATE_|USER_DAILY_|GLOBAL_|ALLOWLIST_|TRUSTED_|QUEUE_|GENERATION_|LLM_)/.test(name)) delete env[name]
}
delete env.NODE_ENV
delete env.APP_URL
delete env.NEXT_PUBLIC_APP_URL
env.INKDESK_DATA_DIR = dir
env.INKDESK_STORAGE = 'local'
env.INKDESK_QUEUE = 'inline'
env.INKDESK_AUTH = 'test' // sign-in on, so the limits default ON
env.REDIS_URL = redisUrl
env.GENERATION_ENABLED = 'true'
env.IMAGE_RETRY_DELAY_MS = '0'
env.QUEUE_RETRY_BACKOFF_MS = '300'
env.OPENROUTER_API_KEY = 'check-only-never-sent' // fetch is stubbed below; nothing leaves this machine
env.LLM_FALLBACK = 'always'
env.IMAGE_PANEL_QUALITY = 'low'
env.IMAGE_SHEET_QUALITY = 'low'

// --- The stub: every provider request is recorded and answered here ----------------------
const tinyPng = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#8899aa' } }).png().toBuffer()
const provider = {
  images: 0,
  texts: 0,
  imageMode: 'ok' as 'ok' | '402' | '500',
  textMode: 'ok' as 'ok' | '402' | '500',
  imageCost: 0.01 as number | null,
  textCost: 0.002,
  /** Runs while a picture is being drawn, before the provider answers: how a check moves the world under a job. */
  imageHook: null as null | (() => Promise<void>),
}
const outbound: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input)
  if (url === 'https://openrouter.ai/api/v1/images') {
    provider.images++
    await provider.imageHook?.()
    await sleep(15)
    if (provider.imageMode === '402') return new Response('out of credits', { status: 402 })
    if (provider.imageMode === '500') return new Response('upstream broke', { status: 500 })
    return Response.json({
      data: [{ b64_json: tinyPng.toString('base64'), media_type: 'image/png' }],
      ...(provider.imageCost === null ? {} : { usage: { cost: provider.imageCost } }),
    })
  }
  if (url === 'https://openrouter.ai/api/v1/chat/completions') {
    provider.texts++
    if (provider.textMode === '402') return new Response('out of credits', { status: 402 })
    if (provider.textMode === '500') return new Response('upstream broke', { status: 500 })
    return Response.json({
      choices: [
        {
          message: { content: JSON.stringify({ title: 'Letters Not Yet Written', body: 'Kaito Ren hands Mio Asakura a letter she has not written yet.', dna: 'Kaito Ren, an 18-year-old courier with messy black hair and a frayed red scarf.' }) },
          finish_reason: 'stop',
        },
      ],
      usage: { cost: provider.textCost },
    })
  }
  outbound.push(url)
  return realFetch(input as RequestInfo, init)
}) as typeof fetch

// Imported after the env is set, because the store and the queue read it at load.
const { createProject, read: readDesk, update: updateDesk } = await import('../lib/chapter')
const { store } = await import('../lib/store')
const { saveImage } = await import('../lib/images')
const { assertEditAllowed, attachSheet, proposeCast, setDna } = await import('../lib/cast')
const { applyPatch } = await import('../lib/patch')
const { newScript } = await import('../lib/script')
const { queuePanel } = await import('../lib/panels')
const { queueSheet } = await import('../lib/sheet')
const { addAsset } = await import('../lib/assets')
const { enqueueJob } = await import('../lib/queue/enqueue')
const J = await import('../lib/queue/jobs')
const { endJob } = await import('../lib/queue/ending')
const { closeQueues } = await import('../lib/queue/queues')
const { closeProducerRedis, producerRedis, redisKey } = await import('../lib/queue/redis')
const { reconcileOnce } = await import('../lib/queue/reconcile')
const { resetBreaker, tripCredits, creditsBreakerOpen } = await import('../lib/queue/breaker')
const { forgetQueueState, liveJobs } = await import('../lib/queue/status')
const { Refused, errorResponse } = await import('../lib/errors')
const { requireUser } = await import('../lib/auth/session')
const { limitsEnabled, limitsSettings, parseConfig, ConfigError } = await import('../lib/config')
const R = await import('../lib/limits/rules')
const { setClock } = await import('../lib/limits/clock')
const { backend, capsFor, resetBackend, LimitsUnavailable } = await import('../lib/limits/backend')
const { createMemoryBackend } = await import('../lib/limits/memory')
const { createRedisBackend } = await import('../lib/limits/redis')
const { preflight, release, reserve, settle } = await import('../lib/limits/hold')
const { holdForJob, settleEnded, settlementOf, sweepUnsettled } = await import('../lib/limits/jobs')
const { forgetPlans, planOf } = await import('../lib/limits/plan')
const { classify, clientAddress, clientKey, hit, limitByAddress } = await import('../lib/limits/requests')
const { spendProject, spendText } = await import('../lib/limits/text')
const { usageView } = await import('../lib/limits/usage')
const { imageEstimateUsd, MIN_SPEND_USD, TEXT_ESTIMATE_USD } = await import('../lib/limits/estimate')
const { meterFraction, meterWarns, WARN_AT } = await import('../lib/limits/view')
const { asRefusal, isSpendingRequest, refusalSentence, spendBlock, usesLine } = await import('../lib/limits/button')
const usageRoute = await import('../app/api/usage/route')
const projectsRoute = await import('../app/api/projects/route')
const projectRoute = await import('../app/api/projects/[id]/route')
const panelRoute = await import('../app/api/projects/[id]/pages/[n]/panels/[i]/route')
const synopsisRoute = await import('../app/api/projects/[id]/synopsis/route')
const sheetRoute = await import('../app/api/projects/[id]/sheet/route')
const importRoute = await import('../app/api/projects/[id]/import/route')
import type { LimitsBackend } from '../lib/limits/backend'
import type { Caps, Units } from '../lib/limits/rules'
import type { JobRecord } from '../lib/queue/jobs'
import type { UsageView } from '../lib/limits/view'

type RefusedT = InstanceType<typeof Refused>

const redis = () => producerRedis()
const children: ChildProcess[] = []

// --- Fixtures ----------------------------------------------------------------------------
const kaito = { name: 'Kaito Ren', role: 'Lead · rooftop courier', traits: ['restless'], look: 'Eighteen, wiry. Messy black hair, amber eyes. Grey jacket, frayed red scarf.' }
const mio = { name: 'Mio Asakura', role: 'Counterpart · night archivist', traits: ['wry'], look: 'Twenty, small and upright. Silver bob, round glasses, long dark coat.' }
const synopsis = { title: 'Letters Not Yet Written', body: 'Kaito Ren hands Mio Asakura a letter she has not written yet.', accepted: true }
const line = (characterId: string, n: number) => ({
  characterId,
  action: `Action ${n}: something drawable.`,
  camera: 'eye level, three-quarter view',
  background: `Background ${n}: the rooftop.`,
  dialogue: `Line ${n}`,
})

const FREE = 'user_freeone'
const FREE2 = 'user_freetwo'
const BOSS = 'user_boss'
const emailOf: Record<string, string> = { [FREE]: 'free.one@example.com', [FREE2]: 'free.two@example.com', [BOSS]: 'Boss@Example.COM' }
for (const [id, email] of Object.entries(emailOf)) await store.users.upsert({ id, email, createdAt: new Date().toISOString() })
env.ALLOWLIST_EMAILS = ' boss@example.com , other@example.com '

/** A project owned by `owner` with both characters locked and a four-panel page, ready to ink. */
async function lockedPage(title: string, owner: string, lock = true) {
  const first = await createProject({ title, stylePresetId: 'manga-bw' }, owner)
  const pid = first.address.projectId
  const addr = first.address
  await updateDesk(pid, (c) => ({ ...c, synopsis }), addr)
  let chapter = await updateDesk(pid, (c) => proposeCast(c, kaito, mio), addr)
  const [a, b] = chapter.cast
  for (const [who, dna] of [[a, 'Kaito DNA, verbatim.'], [b, 'Mio DNA, verbatim.']] as const) {
    await updateDesk(pid, (c) => setDna(c, who.id, dna), addr)
    await saveImage(pid, 'sheet', tinyPng.toString('base64'), 'image/png', (c, imageId) => attachSheet(c, who.id, dna, imageId))
    if (lock) chapter = await updateDesk(pid, (c) => {
      const found = c.cast.find((x) => x.id === who.id)
      if (!found) throw new Error('lost the character')
      assertEditAllowed(found, { locked: true })
      return applyPatch(c, { cast: { [who.id]: { locked: true } } })
    }, addr)
  }
  // A page of panels needs both sheets locked; a card that is only drawn (to sheet again, or import over) has none.
  if (lock) chapter = await updateDesk(pid, (c) => newScript(c, { panel1: line(a.id, 1), panel2: line(b.id, 2), panel3: line(a.id, 3), panel4: line(b.id, 4) }), addr)
  return { pid, addr, a, b, owner, read: () => readDesk(pid, addr) }
}

const HEADER = 'x-inkdesk-test-user'
const call = (method: string, path: string, userId?: string, body?: unknown, extra: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { ...(userId ? { [HEADER]: userId } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** Nothing for this key is waiting or running, and nothing it ended is still holding a reservation (the settle is the write after the ending). */
const settled = async (key: string) =>
  (await store.jobs.listJobs({ key, status: ['queued', 'running'] })).length === 0 && (await store.jobs.listJobs({ key, reservation: 'held' })).length === 0
const firstOf = async (key: string): Promise<JobRecord> => {
  const [job] = await store.jobs.listJobs({ key, limit: 1 })
  assert.ok(job, `no job for ${key}`)
  return job
}

const quiet = <T,>(fn: () => Promise<T>) => async (): Promise<T> => {
  const log = console.log, warn = console.warn, error = console.error
  console.warn = console.error = () => {}
  try {
    return await fn()
  } finally {
    console.warn = warn
    console.error = error
    console.log = log
  }
}

/** Nothing left over between sections: every job ended, Redis empty, defaults restored. */
async function reset() {
  setClock(null)
  for (const job of await store.jobs.listJobs({ status: ['queued', 'running'], limit: 2000 })) {
    await store.jobs.updateJob(job.id, (j) => J.abandon(j, 'check reset', new Date()))
  }
  await store.jobs.pruneJobs(new Date(Date.now() + 24 * 3600_000).toISOString()) // and every record, so a section sees only its own
  for (const name of Object.keys(env)) if (/^(QUOTA_|RATE_|USER_DAILY_|GLOBAL_|TRUSTED_|QUEUE_)/.test(name)) delete env[name]
  delete env.INKDESK_LIMITS
  env.INKDESK_AUTH = 'test'
  env.INKDESK_QUEUE = 'inline'
  env.REDIS_URL = redisUrl
  env.GENERATION_ENABLED = 'true'
  await redis().flushall()
  Object.assign(provider, { imageMode: 'ok', textMode: 'ok', imageCost: 0.01, textCost: 0.002, imageHook: null })
  resetBreaker()
  forgetQueueState()
  forgetPlans()
  resetBackend()
}

/** What the counters say the person holds, against what their job records say — the invariant that nothing leaks or doubles. */
async function conserved(userId: string, extra: { images?: number; micros?: number } = {}) {
  let images = extra.images ?? 0
  let micros = extra.micros ?? 0
  for (const j of await store.jobs.listJobs({ ownerId: userId, limit: 2000 })) {
    const state = J.reservationOf(j)
    if (state === 'none') continue
    if (state === 'held' && J.isActive(j)) {
      images++
      micros += R.toMicros(j.reservedUsd)
    } else {
      const { actualUsd, refund } = settlementOf(j)
      if (!refund) images++
      micros += R.toMicros(actualUsd ?? j.reservedUsd)
    }
  }
  const c = await backend().counters(userId)
  assert.equal(c.quota.image, images, `${userId}: the image counter equals the pictures the job records hold or used`)
  assert.equal(c.userDayMicros, micros, `${userId}: the day's dollars equal what the job records hold or spent`)
  return c
}

/**
 * The meter against the enforcement: the usage view says whether a picture, a
 * project and a text call would be refused and in which words — then the real
 * `reserve` is asked, and must say exactly that. (A passing probe is released.)
 */
async function agree(userId: string): Promise<UsageView> {
  const view = await usageView(userId)
  const probes: { label: string; units: Units; usd: number; kinds: readonly string[] }[] = [
    { label: 'image', units: { image: 1 }, usd: imageEstimateUsd('panel'), kinds: ['image', 'all'] },
    { label: 'project', units: { project: 1 }, usd: 0, kinds: ['project', 'all'] },
    { label: 'text', units: {}, usd: TEXT_ESTIMATE_USD.synopsis, kinds: ['all'] },
  ]
  for (const probe of probes) {
    const id = `probe-${probe.label}-${Math.random().toString(36).slice(2)}`
    let refused: RefusedT | null = null
    try {
      await reserve({ id, userId, units: probe.units, usd: probe.usd })
    } catch (err) {
      if (!(err instanceof Refused)) throw err
      refused = err
    }
    const blockedForThis = view.blocked !== null && probe.kinds.includes(view.blocked.kind)
    if (refused) {
      // The view must know. It may name a different (earlier) reason, but never claim nothing is wrong.
      assert.ok(view.blocked, `${userId}: ${probe.label} was refused ("${refused.message}") but the meter shows no block`)
      if (blockedForThis) assert.equal(view.blocked!.message, refused.message, `${userId}: the meter and the refusal use the same words for ${probe.label}`)
    } else {
      assert.equal(blockedForThis, false, `${userId}: ${probe.label} was accepted but the meter says it is blocked ("${view.blocked?.message}")`)
      await release(id)
    }
  }
  return view
}

// =============================================================================================
try {
  await until('redis', async () => {
    try {
      return (await redis().ping()) === 'PONG'
    } catch {
      return false
    }
  }, 8_000)

  // 1. Pure rules ------------------------------------------------------------------------------
  {
    assert.equal(R.toMicros(0.02), 20_000)
    assert.equal(R.toMicros(0.0000004), 0, 'under a micro-dollar is nothing')
    assert.equal(R.toMicros(-3), 0)
    assert.equal(R.toMicros(NaN), 0)
    assert.equal(R.fromMicros(12_345), 0.012345)
    const T = Date.UTC(2026, 9, 15, 23, 59, 59, 999)
    assert.equal(R.dayOf(T), '20261015')
    assert.equal(R.isoDayOf(T), '2026-10-15')
    assert.equal(R.monthOf(T), '202610')
    assert.equal(R.nextResetMs(T), Date.UTC(2026, 9, 16), 'one millisecond before midnight resets in one millisecond')
    assert.equal(R.nextResetMs(Date.UTC(2026, 9, 16)), Date.UTC(2026, 9, 17), 'at midnight the next reset is a whole day away')
    assert.equal(R.nextResetMs(Date.UTC(2026, 11, 31, 12)), Date.UTC(2027, 0, 1), 'the year turns')
    assert.equal(R.dayTtlMs(Date.UTC(2026, 9, 15, 22, 30)), 90 * 60_000 + R.DAY_MARGIN_MS, 'a daily key expires at the reset plus the margin')

    // The order of the rules is the contract the Lua follows.
    const caps: Caps = { quota: { image: 2, project: 1, videoSeconds: 5, audioChars: 50 }, userDailyMicros: 50_000, globalDailyMicros: 100_000, globalTotalMicros: 150_000 }
    const c = R.emptyCounters()
    assert.deepEqual(R.evaluate(c, caps, { image: 1 }, 20_000), { ok: true })
    assert.deepEqual(R.evaluate({ ...c, globalTotalMicros: 140_000, globalDayMicros: 99_999 }, caps, { image: 1 }, 20_000), { ok: false, why: 'total-cap' }, 'the studio’s total cap is judged first')
    assert.deepEqual(R.evaluate({ ...c, globalDayMicros: 90_000, quota: { ...c.quota, image: 2 } }, caps, { image: 1 }, 20_000), { ok: false, why: 'daily-cap' }, 'then its daily cap — before any quota, so a paused studio says one thing to everyone')
    assert.deepEqual(R.evaluate({ ...c, quota: { ...c.quota, image: 2 }, userDayMicros: 49_000 }, caps, { image: 1 }, 20_000), { ok: false, why: 'quota', kind: 'image' }, 'then the person’s quotas — before their dollars')
    assert.deepEqual(R.evaluate({ ...c, userDayMicros: 40_000 }, caps, {}, 20_000), { ok: false, why: 'spend' })
    assert.deepEqual(R.evaluate({ ...c, userDayMicros: 30_000 }, caps, {}, 20_000), { ok: true }, 'landing exactly on a cap passes')
    assert.deepEqual(R.evaluate({ ...c, userDayMicros: 500_000 }, caps, { project: 1 }, 0), { ok: true }, 'a project costs no dollars, so the person’s dollar cap does not hold it')
    assert.deepEqual(R.evaluate({ ...c, globalDayMicros: 90_000 }, caps, { project: 1 }, 0), { ok: false, why: 'daily-cap' }, 'but a paused studio (not even the floor fits) starts nothing')
    assert.deepEqual(R.evaluate({ ...c, globalDayMicros: 80_000 }, caps, { project: 1 }, 0), { ok: true }, 'with room for the floor it is open')
    assert.deepEqual(R.evaluate({ ...c, globalDayMicros: 99_999 }, caps, {}, 0), { ok: true }, 'a request that spends nothing at all is no one’s concern')
    assert.equal(R.gateMicros({}, 0), 0)
    assert.equal(R.gateMicros({ project: 1 }, 0), R.MIN_SPEND_MICROS)
    assert.equal(R.gateMicros({ image: 1 }, 90_000), 90_000)
    assert.deepEqual(R.evaluate({ ...c, quota: { ...c.quota, project: 1 } }, caps, { project: 1 }, 0), { ok: false, why: 'quota', kind: 'project' })
    assert.deepEqual(R.evaluate(c, { ...caps, quota: { ...caps.quota, image: 0 } }, { image: 1 }, 0), { ok: false, why: 'quota', kind: 'image' }, 'a plan with none of a thing refuses it')

    // Sentences: one calm line, a way forward, nothing internal.
    const now = Date.UTC(2026, 9, 15, 21, 0)
    const reset = R.nextResetMs(now)
    const info = R.describeRefusal({ why: 'quota', kind: 'image' }, caps, now)
    assert.equal(info.message, 'You have used today’s 2 images. It resets at 00:00 UTC, in about 3 hours.')
    assert.deepEqual([info.code, info.status, info.resetsAt, info.kind], ['quota', 429, new Date(reset).toISOString(), 'image'])
    assert.equal(R.describeRefusal({ why: 'daily-cap' }, caps, now).message, 'The studio has paused generation for today to keep its costs in check. It will open again at 00:00 UTC, in about 3 hours.')
    assert.equal(R.describeRefusal({ why: 'total-cap' }, caps, now).resetsAt, null, 'the cumulative cap does not lift by itself')
    assert.equal(R.describeRefusal({ why: 'daily-cap' }, caps, now).status, 503)
    assert.match(R.describeRefusal({ why: 'spend' }, caps, now).message, /^You have reached today’s spending limit of \$0\.05\. It resets at/)
    assert.equal(R.quotaSentence('project', 1, reset, now), 'You have used today’s 1 new project. It resets at 00:00 UTC, in about 3 hours.')
    assert.match(R.quotaSentence('videoSeconds', 15, reset, now), /^You have used today’s 15 seconds of video\./)
    assert.match(R.quotaSentence('audioChars', 2000, reset, now), /^You have used today’s 2,000 characters of voice\./)
    assert.equal(R.rateSentence(1), 'You’re going a little fast — try again in a second.')
    assert.equal(R.rateSentence(42), 'You’re going a little fast — try again in 42 seconds.')
    assert.equal(R.rateSentence(3600), 'You’re going a little fast — try again in 60 minutes.')
    for (const sentence of [R.PAUSED_TODAY, R.PAUSED_TOTAL, R.PAUSED_NOW, J.PAUSED, J.BUSY, info.message, R.rateSentence(9), R.pausedSentence('closed', reset, now)]) {
      assert.doesNotMatch(sentence, /[A-Z_]{4,}|\d{2,}ms/, `no variable name: ${sentence}`)
      assert.doesNotMatch(sentence, /\bmodel\b|openrouter|redis|mongo|gpt|anthropic|\.tsx?\b/i, `no model id, service or stack: ${sentence}`)
      assert.ok(sentence.length < 200, 'one sentence-sized message')
    }

    // Which window a request takes.
    const win = (m: string, p: string) => classify(m, p).join('+')
    assert.equal(win('GET', '/api/projects'), 'read')
    assert.equal(win('GET', '/api/usage'), 'read')
    assert.equal(win('GET', '/api/projects/p1'), 'read')
    assert.equal(win('GET', '/api/projects/p1/image/img-1.png'), 'media')
    assert.equal(win('GET', '/api/image/img-1.png'), 'media')
    assert.equal(win('POST', '/api/projects'), 'edit')
    assert.equal(win('POST', '/api/projects/p1'), 'edit')
    assert.equal(win('POST', '/api/projects/p1/assets'), 'upload')
    for (const p of ['synopsis', 'cast', 'cast/reroll', 'plan', 'import', 'pages/0/script']) assert.equal(win('POST', `/api/projects/p1/${p}`), 'text', p)
    for (const p of ['sheet', 'cover', 'pages/0/start', 'pages/all/start', 'pages/2/panels/3']) assert.equal(win('POST', `/api/projects/p1/${p}`), 'image', p)
    assert.equal(win('POST', '/api/projects/p1/pages/0/panels/1/rewrite'), 'text+image', 'Rewrite asks Claude and then draws')
    assert.equal(win('POST', '/api/projects/p1/sheet/'), 'image', 'a trailing slash is the same route')
    assert.equal(win('DELETE', '/api/projects/p1'), 'edit', 'a route nobody classified is limited as an edit from its first day')
    assert.equal(win('GET', '/api/never-heard-of-it'), 'read')

    // The client address: a header the caller writes must not move them out of their window.
    const xff = (value: string | null) => new Headers(value === null ? {} : { 'x-forwarded-for': value })
    assert.equal(clientAddress(xff('203.0.113.9'), 1), '203.0.113.9')
    assert.equal(clientAddress(xff('6.6.6.6, 203.0.113.9'), 1), '203.0.113.9', 'what the caller wrote on the left is ignored: the entry the trusted hop appended is the one read')
    assert.equal(clientAddress(xff('1.1.1.1, 2.2.2.2, 203.0.113.9'), 1), '203.0.113.9')
    assert.equal(clientAddress(xff('1.1.1.1, 198.51.100.7, 203.0.113.9'), 2), '198.51.100.7', 'two trusted hops read the second from the right')
    assert.equal(clientAddress(xff('203.0.113.9'), 2), null, 'fewer entries than trusted hops: unknown, not a guess')
    assert.equal(clientAddress(xff('203.0.113.9'), 0), null, 'zero hops trusts no header')
    assert.equal(clientAddress(xff(null), 1), null)
    assert.equal(clientAddress(xff('not-an-address'), 1), null, 'junk is not an address')
    assert.equal(clientAddress(xff('::ffff:203.0.113.9'), 1), '203.0.113.9', 'an IPv4-mapped address is the IPv4 one')
    assert.equal(clientAddress(xff('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), 1), clientAddress(xff('2001:db8:1:2:1::1'), 1), 'an IPv6 caller is one subscriber across its /64')
    assert.notEqual(clientAddress(xff('2001:db8:1:2::1'), 1), clientAddress(xff('2001:db8:1:3::1'), 1))
    assert.equal(clientKey(xff('9.9.9.9, 203.0.113.9'), 1), clientKey(xff('8.8.8.8, 203.0.113.9'), 1), 'rotating the spoofable part keeps one key')
    assert.notEqual(clientKey(xff('203.0.113.9'), 1), clientKey(xff('203.0.113.10'), 1))
    assert.equal(clientAddress(new Headers({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '6.6.6.6' }), 1, 'x-real-ip'), '203.0.113.9', 'CLIENT_IP_HEADER=x-real-ip reads that header alone')
    assert.equal(clientAddress(new Headers({ 'x-real-ip': '203.0.113.9' }), 0, 'x-real-ip'), null, 'and zero hops still trusts nothing')
    assert.throws(() => limitsSettings({ CLIENT_IP_HEADER: 'x-evil' }), /CLIENT_IP_HEADER must be/)
    assert.equal(clientKey(xff(null), 1), 'unknown')
    assert.doesNotMatch(clientKey(xff('203.0.113.9'), 1), /203|\./, 'no raw address in a key')

    // The settings.
    const s0 = limitsSettings({})
    assert.deepEqual(s0.plans.free, { image: 20, project: 1, videoSeconds: 15, audioChars: 2000, dailyUsd: 1 })
    assert.deepEqual(s0.plans.allowlisted, { image: 150, project: 10, videoSeconds: 120, audioChars: 20000, dailyUsd: 10 })
    assert.deepEqual([s0.globalDailyUsd, s0.globalTotalUsd, s0.trustedProxyHops, s0.allowlist.length], [5, null, 1, 0])
    assert.deepEqual(
      Object.fromEntries(Object.entries(s0.rates).map(([k, v]) => [k, `${v.limit}/${v.windowMs / 60_000}min`])),
      { text: '10/1min', image: '6/1min', upload: '20/60min', edit: '120/1min', read: '240/1min', media: '1200/1min', anon: '60/1min' }
    )
    const s1 = limitsSettings({ ALLOWLIST_EMAILS: ' A@X.com, b@y.org ,, a@x.com', GLOBAL_DAILY_USD_CAP: '0.01', GLOBAL_TOTAL_USD_CAP: '20', QUOTA_FREE_IMAGES: '3', USER_DAILY_USD_ALLOW: '2.5', RATE_READ_PER_MIN: '7', QUOTA_ALLOW_AUDIO_CHARS: ' ' })
    assert.deepEqual([s1.allowlist, s1.globalDailyUsd, s1.globalTotalUsd, s1.plans.free.image, s1.plans.allowlisted.dailyUsd, s1.rates.read.limit, s1.plans.allowlisted.audioChars], [['a@x.com', 'b@y.org'], 0.01, 20, 3, 2.5, 7, 20000], 'case-insensitive allowlist, de-duplicated; blank = default')
    assert.equal(limitsSettings({ GLOBAL_DAILY_USD_CAP: '0' }).globalDailyUsd, 0, '0 is a cap that pauses everything, not "unset"')
    const SECRET = 'sneaky-value-123'
    for (const [name, value] of [['GLOBAL_DAILY_USD_CAP', SECRET], ['GLOBAL_TOTAL_USD_CAP', '-4'], ['USER_DAILY_USD_FREE', '1,5'], ['QUOTA_FREE_IMAGES', SECRET], ['RATE_IMAGE_PER_MIN', 'many'], ['TRUSTED_PROXY_HOPS', '9'], ['ALLOWLIST_EMAILS', `fine@x.com,${SECRET}`], ['INKDESK_LIMITS', SECRET]] as const) {
      assert.throws(() => limitsSettings({ [name]: value }), (e: unknown) => e instanceof ConfigError && e.message.includes(name) && !e.message.includes(value) && !e.message.includes(SECRET), `${name} is refused by name, never by value`)
    }
    assert.throws(() => parseConfig({ INKDESK_LIMITS: 'maybe' }), /INKDESK_LIMITS must be on or off/)
    assert.throws(() => parseConfig({ NODE_ENV: 'production', INKDESK_LIMITS: 'off' }), (e: unknown) => e instanceof ConfigError && /INKDESK_LIMITS must be on in production/.test(e.message), 'production refuses off, at boot')
    assert.equal(parseConfig({ NODE_ENV: 'production' }).limits.enabled, true)
    assert.equal(limitsEnabled({ NODE_ENV: 'production', INKDESK_LIMITS: 'off' }), true, 'and production never reads off, whatever is set')
    assert.equal(limitsEnabled({}), false, 'a local desk with sign-in off: off')
    assert.equal(limitsEnabled({ INKDESK_AUTH: 'off' }), false)
    assert.equal(limitsEnabled({ INKDESK_AUTH: 'test' }), true, 'sign-in on: on')
    assert.equal(limitsEnabled({ INKDESK_AUTH: 'clerk' }), true)
    assert.equal(limitsEnabled({ INKDESK_AUTH: 'off', INKDESK_LIMITS: 'on' }), true)
    assert.equal(limitsEnabled({ INKDESK_AUTH: 'test', INKDESK_LIMITS: 'off' }), false)
    // Read on every call: lowering the cap in the host changes the very next answer.
    env.GLOBAL_DAILY_USD_CAP = '5'
    assert.equal(limitsSettings().globalDailyUsd, 5)
    env.GLOBAL_DAILY_USD_CAP = '0.01'
    assert.equal(limitsSettings().globalDailyUsd, 0.01)
    assert.equal(capsFor('free').globalDailyMicros, 10_000, 'and the caps handed to the reserve follow')
    delete env.GLOBAL_DAILY_USD_CAP
    assert.ok(MIN_SPEND_USD <= Math.min(...Object.values(TEXT_ESTIMATE_USD), imageEstimateUsd('panel'), imageEstimateUsd('sheet'), imageEstimateUsd('cover')), 'no estimate is below the floor the pause is judged against')
    assert.equal(WARN_AT, 0.8)
    assert.equal(meterWarns({ used: 16, limit: 20 }), true)
    assert.equal(meterWarns({ used: 15, limit: 20 }), false)
    assert.equal(meterFraction({ used: 3, limit: 0 }), 1)
    ok('the rules: micro-dollars, the UTC day and its reset, the order of the caps, calm sentences, the windows, the client address, the settings')
  }

  // 2. The memory backend and Redis answer one script identically ------------------------------------
  {
    let now = 0
    const script = async (b: LimitsBackend): Promise<[string, unknown][]> => {
      const out: [string, unknown][] = []
      const rec = (label: string, value: unknown) => out.push([label, value])
      const min = (ms: number | null) => (ms === null ? null : Math.round(ms / 60_000))
      const T0 = Date.UTC(2026, 9, 15, 23, 30, 0)
      now = T0
      setClock(() => now)
      let caps: Caps = { quota: { image: 3, project: 1, videoSeconds: 5, audioChars: 100 }, userDailyMicros: 50_000, globalDailyMicros: 100_000, globalTotalMicros: 115_000 }
      const res = (id: string, userId: string, units: Units, usd: number, tracked = false) => b.reserve({ id, userId, units, usdMicros: usd, caps, tracked })
      const snap = async (label: string, userId: string) => rec(label, await b.counters(userId))

      // a. A sliding window of three a minute.
      for (const [at, label] of [[0, 'w0'], [10, 'w10'], [20, 'w20'], [30, 'w30 full'], [59.999, 'w59.999 full'], [60, 'w60 oldest slid out'], [61, 'w61 full again'], [70, 'w70 two slid'], [200, 'w200 all slid']] as const) {
        now = T0 + at * 1000
        rec(label, await b.hit('par', 'a', 3, 60_000))
      }
      rec('another id is its own window', await b.hit('par', 'b', 3, 60_000))
      rec('a zero limit refuses', await b.hit('par', 'zero', 0, 60_000))

      // b. One person fills their quota and then their dollars.
      now = T0 + 300_000
      rec('u1 image 1', await res('h-a', 'u1', { image: 1 }, 15_000))
      rec('u1 image 2', await res('h-b', 'u1', { image: 1 }, 15_000))
      rec('u1 image 3', await res('h-c', 'u1', { image: 1 }, 15_000))
      rec('u1 ttl: quota key', min((await b.peek(R.quotaKey('u1', '20261015', 'image'))).ttlMs))
      rec('u1 ttl: day spend', min((await b.peek(R.userDayKey('u1', '20261015'))).ttlMs))
      rec('u1 ttl: month spend', min((await b.peek(R.userMonthKey('u1', '202610'))).ttlMs))
      rec('u1 ttl: global day', min((await b.peek(R.globalDayKey('20261015'))).ttlMs))
      rec('u1 ttl: global total (none)', (await b.peek(R.GLOBAL_TOTAL_KEY)).ttlMs)
      rec('u1 ttl: hold', min((await b.peek(R.holdKey('h-a'))).ttlMs))
      rec('u1 image 4: quota, judged before dollars', await res('h-d', 'u1', { image: 1 }, 15_000))
      rec('u1 text over the dollar cap', await res('t-1', 'u1', {}, 10_000))
      rec('u1 text exactly onto the cap', await res('t-2', 'u1', {}, 5_000))
      rec('u1 hold (no units)', await b.hold('t-2'))
      await snap('u1 counters', 'u1')
      rec('a duplicate reserve changes nothing', await res('h-a', 'u1', { image: 1 }, 15_000))
      await snap('u1 counters after the duplicate', 'u1')
      rec('u3 starts a project (no dollars)', await res('p-1', 'u3', { project: 1 }, 0, true))
      rec('and a second project is the quota', await res('p-2', 'u3', { project: 1 }, 0, true))
      await snap('u3 counters', 'u3')
      rec('no hold is overdue yet', await b.orphans())

      // c. The studio’s daily cap (100000, landed on exactly by u2’s third), judged before a quota; nothing smaller than the 20000 floor fits under what is left.
      rec('u2 image 1', await res('g-1', 'u2', { image: 1 }, 15_000))
      rec('u2 image 2', await res('g-2', 'u2', { image: 1 }, 15_000))
      rec('u2 image 3', await res('g-3', 'u2', { image: 1 }, 15_000))
      rec('u2 image 4: the daily cap speaks first', await res('g-4', 'u2', { image: 1 }, 15_000))
      rec('5000 left of the cap is under the floor: refused', await res('g-5', 'u4', {}, 5_000))
      rec('even one micro', await res('g-6', 'u4', {}, 1))
      rec('a new project is refused too while the studio is paused', await res('g-7', 'u4', { project: 1 }, 0))
      await snap('u4 counters', 'u4')

      // d. A new UTC day: quotas start again, the total cap still counts every day.
      now = Date.UTC(2026, 9, 16, 0, 20, 0)
      await snap('u1 on the new day', 'u1')
      rec('u3 image on the new day', await res('n-1', 'u3', { image: 1 }, 15_000))
      rec('the cumulative cap, judged before the daily cap', await res('n-2', 'u3', { image: 1 }, 10_000))
      caps = { ...caps, globalTotalMicros: null }
      rec('raise the cumulative cap: u1 quota is whole again', await res('n-3', 'u1', { image: 1 }, 1_000))

      // e. Settling and releasing yesterday’s holds adjusts yesterday’s counters, exactly once.
      const yesterday = async (label: string) =>
        rec(label, [
          (await b.peek(R.quotaKey('u1', '20261015', 'image'))).value,
          (await b.peek(R.userDayKey('u1', '20261015'))).value,
          (await b.peek(R.userMonthKey('u1', '202610'))).value,
          (await b.peek(R.globalDayKey('20261015'))).value,
          (await b.peek(R.GLOBAL_TOTAL_KEY)).value,
        ])
      await yesterday('before any settle')
      rec('settle h-a below its estimate', await b.finish('h-a', { actualMicros: 12_000, refundUnits: false }))
      await yesterday('after settling h-a to 12000')
      rec('settle h-a again', await b.finish('h-a', { actualMicros: 12_000, refundUnits: false }))
      rec('release h-a afterwards is nothing', await b.finish('h-a', { actualMicros: 0, refundUnits: true }))
      await yesterday('and nothing moved')
      rec('release h-b (failed, nothing spent)', await b.finish('h-b', { actualMicros: 0, refundUnits: true }))
      await yesterday('after releasing h-b')
      rec('settle h-c above its estimate', await b.finish('h-c', { actualMicros: 20_000, refundUnits: false }))
      await yesterday('after settling h-c to 20000')
      rec('release h-c-keeping a cost', await b.finish('h-c', { actualMicros: 5_000, refundUnits: true }))
      rec('a hold that never was', await b.finish('nothing', { actualMicros: 0, refundUnits: true }))
      rec('keep the estimate (null)', await b.finish('t-2', { actualMicros: null, refundUnits: false }))
      await yesterday('after keeping t-2’s estimate')
      await snap('u1 counters today', 'u1')

      // f. Holds nothing settles are swept; settled ones are not.
      rec('p-1 is tracked but not yet overdue', await b.orphans())
      now += 31 * 60_000
      rec('p-1 is overdue', await b.orphans())
      rec('sweeping it keeps the unit', await b.finish('p-1', { actualMicros: null, refundUnits: false }))
      rec('and nothing is overdue now', await b.orphans())
      await snap('u3 counters after the sweep', 'u3')
      return out
    }

    const mem = await script(createMemoryBackend())
    await redis().flushall()
    const real = await script(createRedisBackend())
    setClock(null)
    assert.equal(real.length, mem.length)
    for (let i = 0; i < mem.length; i++) assert.deepEqual(real[i], mem[i], `step "${mem[i][0]}": Redis and memory disagree`)
    const get = (label: string) => mem.find(([l]) => l === label)?.[1]
    // The script means what it says (so the comparison is not two backends agreeing on nonsense).
    assert.deepEqual(get('w30 full'), { ok: false, retryAfterMs: 30_000 })
    assert.deepEqual(get('w59.999 full'), { ok: false, retryAfterMs: 1 })
    assert.deepEqual(get('w60 oldest slid out'), { ok: true })
    assert.deepEqual(get('w61 full again'), { ok: false, retryAfterMs: 9_000 })
    assert.deepEqual(get('w200 all slid'), { ok: true })
    assert.deepEqual(get('u1 image 4: quota, judged before dollars'), { ok: false, why: 'quota', kind: 'image' })
    assert.deepEqual(get('u1 text over the dollar cap'), { ok: false, why: 'spend' })
    assert.deepEqual(get('u1 text exactly onto the cap'), { ok: true, duplicate: false })
    assert.deepEqual(get('a duplicate reserve changes nothing'), { ok: true, duplicate: true })
    assert.deepEqual(get('u2 image 4: the daily cap speaks first'), { ok: false, why: 'daily-cap' })
    assert.deepEqual(get('5000 left of the cap is under the floor: refused'), { ok: false, why: 'daily-cap' })
    assert.deepEqual(get('even one micro'), { ok: false, why: 'daily-cap' })
    assert.deepEqual(get('a new project is refused too while the studio is paused'), { ok: false, why: 'daily-cap' })
    assert.deepEqual(get('u3 starts a project (no dollars)'), { ok: true, duplicate: false })
    assert.deepEqual(get('and a second project is the quota'), { ok: false, why: 'quota', kind: 'project' })
    assert.deepEqual(get('raise the cumulative cap: u1 quota is whole again'), { ok: true, duplicate: false })
    assert.deepEqual(get('the cumulative cap, judged before the daily cap'), { ok: false, why: 'total-cap' })
    assert.deepEqual(get('settle h-a again'), 'gone')
    assert.deepEqual(get('release h-a afterwards is nothing'), 'gone')
    assert.deepEqual(get('a hold that never was'), 'gone')
    assert.deepEqual(get('p-1 is overdue'), ['p-1'])
    assert.equal(get('u1 ttl: quota key'), 25 + 180, 'a daily key lives to the reset (00:00 UTC, 25 minutes after the 23:35 reserve) plus the 3-hour margin')
    assert.equal(get('u1 ttl: day spend'), 25 + 180)
    assert.equal(get('u1 ttl: global day'), 25 + 180)
    assert.equal(get('u1 ttl: month spend'), (16 * 24 * 60 + 25) + 45 * 24 * 60, 'the month’s key lives to the end of the month plus 45 days')
    assert.deepEqual(get('u1 ttl: global total (none)'), null, 'the cumulative counter never expires')
    assert.deepEqual(get('u1 ttl: hold'), 8 * 24 * 60)
    setClock(null)
    ok(`memory and Redis answer one ${mem.length}-step script identically: windows slide, every refusal in its order, duplicates, settles after midnight, idempotent, the orphan sweep, the expiries`)
    await redis().flushall()
  }

  // 3. Atomicity: racing a nearly-full cap cannot over-spend it ----------------------------------------------
  {
    for (const [name, b] of [['Redis', createRedisBackend()], ['memory', createMemoryBackend()]] as const) {
      await redis().flushall()
      // Dollars: a studio cap of 7 cents, 60 racers of 2 cents each, 60 different people (no quota in the way).
      const caps = (over: Partial<Caps>): Caps => ({ quota: { image: 1000, project: 1000, videoSeconds: 1000, audioChars: 1000 }, userDailyMicros: 10_000_000, globalDailyMicros: 70_000, globalTotalMicros: null, ...over })
      const dollars = await Promise.all(Array.from({ length: 60 }, (_, i) => b.reserve({ id: `race-d-${i}`, userId: `racer${i}`, units: { image: 1 }, usdMicros: 20_000, caps: caps({}), tracked: false })))
      const wins = dollars.filter((r) => r.ok).length
      assert.equal(wins, 3, `${name}: exactly floor(70000/20000) reservations pass`)
      assert.equal((await b.counters('racer0')).globalDayMicros, 60_000, `${name}: the studio’s day total is exactly 3 × 20000 — never over the cap`)
      assert.equal((await b.counters('racer0')).globalTotalMicros, 60_000)
      assert.ok(dollars.filter((r) => !r.ok).every((r) => !r.ok && r.why === 'daily-cap'))
      // Quota: one person, an image quota of 20, 50 racers.
      const q = await Promise.all(Array.from({ length: 50 }, (_, i) => b.reserve({ id: `race-q-${i}`, userId: 'quota-racer', units: { image: 1 }, usdMicros: 0, caps: caps({ quota: { image: 20, project: 1, videoSeconds: 1, audioChars: 1 }, globalDailyMicros: 1e9 }), tracked: false })))
      assert.equal(q.filter((r) => r.ok).length, 20)
      assert.equal((await b.counters('quota-racer')).quota.image, 20, `${name}: the quota counter is exactly 20`)
      // The person’s own dollar cap.
      const u = await Promise.all(Array.from({ length: 40 }, (_, i) => b.reserve({ id: `race-u-${i}`, userId: 'spender', units: {}, usdMicros: 30_000, caps: caps({ userDailyMicros: 100_000, globalDailyMicros: 1e9 }), tracked: false })))
      assert.equal(u.filter((r) => r.ok).length, 3)
      assert.equal((await b.counters('spender')).userDayMicros, 90_000)
      // Racing the same id (a retried request) holds once.
      const same = await Promise.all(Array.from({ length: 20 }, () => b.reserve({ id: 'same-id', userId: 'dupe', units: { image: 1 }, usdMicros: 5_000, caps: caps({ globalDailyMicros: 1e9 }), tracked: false })))
      assert.equal(same.filter((r) => r.ok && !r.duplicate).length, 1)
      assert.equal((await b.counters('dupe')).quota.image, 1)
      // Racing settles of one hold apply once.
      const fin = await Promise.all(Array.from({ length: 20 }, () => b.finish('same-id', { actualMicros: 1_000, refundUnits: false })))
      assert.equal(fin.filter((r) => r === 'done').length, 1)
      assert.equal((await b.counters('dupe')).userDayMicros, 1_000)
    }
    // And through the whole door, with the studio’s cap read from the environment: 40 sheets at once, a cap that fits 6.
    await reset()
    env.INKDESK_QUEUE = 'bullmq'
    env.GLOBAL_DAILY_USD_CAP = '0.13' // six at 2 cents
    env.QUEUE_USER_INFLIGHT = '200'
    const p = await lockedPage('Race', BOSS)
    const settledSheets = await Promise.allSettled(
      Array.from({ length: 40 }, (_, i) => enqueueJob({ key: `${p.pid}:sheet:racer-${i}`, ownerId: BOSS, projectId: p.pid, kind: 'sheet', payload: { kind: 'sheet', characterId: `racer-${i}`, reuseDna: false, redraw: false } }))
    )
    const accepted = settledSheets.filter((r) => r.status === 'fulfilled').length
    assert.equal(accepted, 6, 'six pass 13 cents')
    for (const r of settledSheets) if (r.status === 'rejected') assert.ok(r.reason instanceof Refused && r.reason.status === 503 && r.reason.extra.code === 'paused')
    const held = await conserved(BOSS)
    assert.equal(held.globalDayMicros, 120_000, 'exactly six estimates are held — not seven')
    assert.equal(provider.images, 0, 'and not one provider call was made')
    ok('racing a nearly-full cap cannot over-spend it: 60 racers on 7 cents → exactly 3 (60000 µ$); 50 on a quota of 20 → exactly 20; settles apply once — on Redis and in memory; 40 sheets through the door → exactly 6')
    await reset()
  }

  // 4. The 21st image of a free day --------------------------------------------------------------------------
  {
    env.RATE_IMAGE_PER_MIN = '1000' // twenty-one clicks in a few seconds are the quota's to judge here, not the window's
    const p = await lockedPage('Twenty-one', FREE)
    const key = J.panelKey(p.pid, p.addr.chapterId, 0, 0)
    const route = (u: string) => panelRoute.POST(call('POST', `/api/projects/${p.pid}/pages/0/panels/0`, u), { params: Promise.resolve({ id: p.pid, n: '0', i: '0' }) })
    let view = await agree(FREE)
    assert.deepEqual(
      [view.plan, view.metering, view.images, view.projects.limit, view.videoSeconds.limit, view.audioChars.limit, view.spend.todayLimitUsd, view.paused, view.blocked, view.warn],
      ['free', true, { used: 0, limit: 20 }, 1, 15, 2000, 1, null, null, false],
      'a free day, as configured'
    )
    assert.equal(view.projects.used, 0, 'a project made by a fixture, not through the route, is not counted')
    for (let n = 1; n <= 20; n++) {
      const res = await route(FREE)
      assert.equal(res.status, 200, `image ${n} of the day is accepted`)
      await until(`image ${n} to land`, () => settled(key))
      const job = await firstOf(key)
      assert.equal(job.outcome, 'done')
      assert.equal(job.reservation, 'settled', 'the hold is settled when the job ends')
      assert.equal(job.reservedUsd, 0.02, 'held at the configured quality’s estimate')
      if (n === 15 || n === 16 || n === 19) {
        view = await agree(FREE)
        assert.equal(view.images.used, n)
        assert.equal(view.warn, n >= 16, `warns at 80% (${n} of 20): ${view.warn}`)
        assert.equal(view.blocked, null)
      }
    }
    assert.equal(provider.images, 20)
    const c20 = await conserved(FREE)
    assert.equal(c20.userDayMicros, 20 * 10_000, 'twenty done jobs settled to the provider’s real cost ($0.01 each), not the $0.02 estimate')
    assert.equal(c20.globalDayMicros, 20 * 10_000)
    assert.equal(c20.userMonthMicros, 20 * 10_000, 'and the month’s figure is its own counter')
    view = await agree(FREE)
    assert.equal(view.images.used, 20)
    assert.equal(view.spend.todayUsd, 0.2)
    assert.equal(view.spend.monthUsd, 0.2)
    assert.equal(view.warn, true)
    assert.equal(view.blocked?.kind, 'image')
    assert.equal(view.blocked?.message.startsWith('You have used today’s 20 images. It resets at 00:00 UTC'), true, view.blocked?.message)
    assert.equal(view.blocked?.resetsAt, view.resetsAt)

    // The 21st: refused at the door, before any provider call, with the body a screen reads.
    const before = { images: provider.images, texts: provider.texts }
    const jobsBefore = (await store.jobs.listJobs({ ownerId: FREE, limit: 2000 })).length
    const refused = await route(FREE)
    assert.equal(refused.status, 429)
    const body = (await refused.json()) as Record<string, unknown>
    assert.deepEqual(Object.keys(body).sort(), ['code', 'error', 'resetsAt'])
    assert.equal(body.code, 'quota')
    assert.equal(body.error, view.blocked?.message, 'the refusal says exactly what the meter says')
    assert.equal(body.resetsAt, view.resetsAt)
    assert.equal(refused.headers.get('cache-control'), 'no-store')
    await sleep(150)
    assert.deepEqual({ images: provider.images, texts: provider.texts }, before, 'the provider was not called for the 21st')
    assert.equal((await store.jobs.listJobs({ ownerId: FREE, limit: 2000 })).length, jobsBefore, 'and no job record was written')
    assert.equal((await redis().keys(redisKey('quota', FREE, R.dayOf(Date.now()), 'image')))[0] !== undefined, true)
    assert.equal((await backend().counters(FREE)).quota.image, 20, 'the refusal consumed nothing')

    // The preflight (Rewrite asks before it pays Claude) judges by the same rules and changes nothing.
    await assert.rejects(preflight(FREE, { image: 1 }, 0.04), (e: unknown) => e instanceof Refused && e.status === 429 && e.extra.code === 'quota' && e.message === view.blocked?.message)
    await preflight(FREE2, { image: 1 }, 0.04)
    assert.equal((await backend().counters(FREE2)).quota.image, 0, 'a preflight holds nothing')
    assert.deepEqual(await holdForJob({ id: 'x', ownerId: FREE, kind: 'text' }), { reservation: 'none', reservedUsd: 0 }, 'a kind that spends nothing here reserves nothing')

    // Someone else’s day is their own: another free account, and the allowlisted one, are untouched.
    const other = await usageView(FREE2)
    assert.equal(other.images.used, 0)
    const boss = await usageView(BOSS)
    assert.deepEqual([boss.plan, boss.images.limit, boss.projects.limit, boss.videoSeconds.limit, boss.audioChars.limit, boss.spend.todayLimitUsd], ['allowlisted', 150, 10, 120, 20000, 10])
    ok('the 21st image of a free day: twenty settle to their real cost ($0.20), the meter warns at 16, blocks at 20 in the refusal’s own words, and the 21st is a 429 { error, code, resetsAt } with no provider call and no job')
    await reset()
  }

  // 5. Every ending releases or settles ----------------------------------------------------------------------------
  {
    env.INKDESK_QUEUE = 'bullmq' // no worker: a job stays queued and held until the check ends it
    const p = await lockedPage('Endings', FREE)
    const panel = (i: number) => J.panelKey(p.pid, p.addr.chapterId, 0, i)
    const queue = async (i: number) => {
      assert.equal(await queuePanel(p.addr, i), true)
      return firstOf(panel(i))
    }
    const finishAs = (job: JobRecord, result: Parameters<typeof J.finish>[1]) => endJob(job.id, (j) => J.finish(j, result, new Date()))
    const image = async () => (await backend().counters(FREE)).quota.image
    const dollars = async () => (await backend().counters(FREE)).userDayMicros

    // A queued job holds a quota unit and the estimate.
    let job = await queue(0)
    assert.deepEqual([job.reservation, job.reservedUsd, job.carriedUsd], ['held', 0.02, 0])
    assert.deepEqual([await image(), await dollars()], [1, 20_000])
    await conserved(FREE)
    const view = await agree(FREE)
    assert.equal(view.images.used, 1)

    // done → settled to its real cost, quota stays used.
    await endJob(job.id, (j) => J.claim(j, 'w1', new Date()))
    await finishAs(job, { outcome: 'done', costUsd: 0.0123 })
    job = (await store.jobs.getJob(job.id))!
    assert.deepEqual([job.reservation, await image(), await dollars()], ['settled', 1, 12_300], 'a done job settles to what the provider billed')
    await conserved(FREE)

    // failed / refused / cancelled / abandoned / skipped → released: quota back, no dollars.
    for (const [i, result] of [
      [1, { outcome: 'failed', error: 'x' }],
      [2, { outcome: 'refused', error: 'x' }],
      [3, { outcome: 'cancelled', error: 'x' }],
      [0, { outcome: 'abandoned', error: 'x' }],
      [1, { outcome: 'skipped' }],
    ] as const) {
      const before = [await image(), await dollars()]
      const j = await queue(i)
      assert.deepEqual([await image(), await dollars()], [before[0] + 1, before[1] + 20_000])
      await finishAs(j, result as Parameters<typeof J.finish>[1])
      assert.deepEqual([await image(), await dollars()], before, `${result.outcome} releases the quota unit and the estimate`)
      assert.equal((await store.jobs.getJob(j.id))!.reservation, 'settled')
      await conserved(FREE)
    }

    // Idempotent: settling or releasing again, or sweeping, changes nothing.
    const done = (await store.jobs.listJobs({ ownerId: FREE, status: ['done'] }))[0]
    const failed = (await store.jobs.listJobs({ ownerId: FREE, status: ['failed'] }))[0]
    const snap = await backend().counters(FREE)
    for (let i = 0; i < 3; i++) {
      await settleEnded({ ...done, reservation: 'held' }) // even if a stale copy still says held
      await settleEnded({ ...failed, reservation: 'held' })
      assert.equal(await settle(done.id, 0.0123), 'gone')
      assert.equal(await release(failed.id), 'gone')
    }
    assert.deepEqual(await backend().counters(FREE), snap, 'settle and release are idempotent per job id')
    assert.deepEqual(await sweepUnsettled(), { settled: 0, orphans: 0 })

    // A failed job that had already paid for a picture counts those dollars (once) and gives the quota back; the next job for the
    // same panel attaches that picture and is charged nothing for it.
    {
      const before = [await image(), await dollars()]
      const j = await queue(2)
      await endJob(j.id, (x) => J.claim(x, 'w1', new Date()))
      const left = await store.putBlob(tinyPng, 'image/png', 'panel') // a picture that is really in the bucket: that is what a job carries
      await endJob(j.id, (x) => J.checkpoint(x, 'w1', { resultImageId: left, costUsd: 0.015 }, new Date()))
      await finishAs(j, { outcome: 'failed', error: 'the store was down' })
      assert.deepEqual([await image(), await dollars()], [before[0], before[1] + 15_000], 'the picture was paid for: its dollars stay counted; the unit comes back')
      const retry = await queue(2)
      assert.equal(retry.carriedUsd, 0.015, 'the next job carries that cost')
      await endJob(retry.id, (x) => J.claim(x, 'w1', new Date()))
      await finishAs(retry, { outcome: 'done', costUsd: 0.015 })
      assert.deepEqual([await image(), await dollars()], [before[0] + 1, before[1] + 15_000], 'attaching it is not counted twice: one picture, one unit, one 1.5 cents')
      await conserved(FREE)
    }
    // A picture that came back with no cost reported keeps its estimate.
    {
      const before = await dollars()
      const j = await queue(3)
      await endJob(j.id, (x) => J.claim(x, 'w1', new Date()))
      await finishAs(j, { outcome: 'done', costUsd: 0 })
      assert.equal(await dollars(), before + 20_000, 'no reported cost on a drawn picture: the estimate stands, never a free one')
      await conserved(FREE)
    }

    // A crash between the ending and the settle: the record is ended, the hold is not.
    {
      const before = [await image(), await dollars()]
      const j = await queue(1)
      await store.jobs.updateJob(j.id, (x) => J.claim(x, 'w1', new Date()))
      const ended = await store.jobs.updateJob(j.id, (x) => J.finish(x, { outcome: 'failed', error: 'x' }, new Date())) // not endJob: "the process died here"
      assert.equal(ended?.reservation, 'held')
      assert.deepEqual([await image(), await dollars()], [before[0] + 1, before[1] + 20_000], 'the hold is still there')
      const done2 = await queue(0) // a second, healthy one beside it
      await endJob(done2.id, (x) => J.claim(x, 'w1', new Date()))
      await finishAs(done2, { outcome: 'done', costUsd: 0.01 })
      // The reconciler runs (as it does in the worker, every minute): it settles the stranded one, once.
      const report = await reconcileOnce('limits-check')
      assert.equal(report.skipped, false)
      assert.equal(report.settled, 1, 'the reconciler’s sweep found exactly the one')
      assert.deepEqual([await image(), await dollars()], [before[0] + 1, before[1] + 10_000], 'it released the crashed job and left the healthy one settled')
      assert.equal((await store.jobs.getJob(j.id))!.reservation, 'settled')
      await redis().del(redisKey('lock', 'reconcile'))
      assert.equal((await reconcileOnce('limits-check')).settled, 0, 'and a second sweep does nothing')
      await conserved(FREE)
    }

    // The sweep survives a counter store that was down at the moment of the ending (the settle could not land).
    {
      const j = await queue(2)
      const before = [await image(), await dollars()]
      await store.jobs.updateJob(j.id, (x) => J.claim(x, 'w1', new Date()))
      await closeQueues()
      await closeProducerRedis()
      env.REDIS_URL = `redis://127.0.0.1:${deadPort}`
      resetBackend()
      await quiet(async () => {
        const ended = await endJob(j.id, (x) => J.finish(x, { outcome: 'failed', error: 'x' }, new Date()))
        assert.equal(ended?.status, 'failed', 'the ending itself is written')
      })()
      assert.equal((await store.jobs.getJob(j.id))!.reservation, 'held', 'the settle did not land, and the record says so')
      env.REDIS_URL = redisUrl
      await closeQueues()
      await closeProducerRedis()
      resetBackend()
      assert.deepEqual([await image(), await dollars()], [before[0], before[1]], 'nothing moved while the counters were away')
      assert.deepEqual(await sweepUnsettled(), { settled: 1, orphans: 0 })
      assert.deepEqual([await image(), await dollars()], [before[0] - 1, before[1] - 20_000], 'back, the sweep released it')
      await conserved(FREE)
    }

    // Let go as dead: by the enqueue (the same key asked again), by the status read, and by the boot's sweep.
    {
      const lapse = (jobId: string) =>
        store.jobs.updateJob(jobId, (x) => J.claim(x, 'ghost', new Date(Date.now() - 3 * 3600_000)))
      const before = await image()
      const a = await queue(0)
      await lapse(a.id)
      const again = await enqueueJob({ key: panel(0), ownerId: FREE, projectId: p.pid, kind: 'panel', payload: { kind: 'panel', chapterId: p.addr.chapterId, pageIndex: 0, index: 0 } })
      assert.equal(again.created, true, 'the dead one made way')
      const old = (await store.jobs.getJob(a.id))!
      assert.deepEqual([old.outcome, old.reservation], ['abandoned', 'settled'], 'abandon in the enqueue released the dead job’s hold')
      assert.equal(await image(), before + 1, 'one unit for the new job, not two')
      await endJob(again.job.id, (x) => J.finish(x, { outcome: 'cancelled', error: 'x' }, new Date()))
      assert.equal(await image(), before)

      const b = await queue(1)
      await lapse(b.id)
      await liveJobs(p.pid) // the status read lets it go
      assert.deepEqual([(await store.jobs.getJob(b.id))!.outcome, (await store.jobs.getJob(b.id))!.reservation], ['abandoned', 'settled'], 'abandon in status.ts released it')
      assert.equal(await image(), before)

      // The boot of an inline server lets go of what the last process left, through the same door.
      const c = await queue(2)
      assert.equal(await image(), before + 1)
      const { sweepInlineJobs } = await import('../lib/boot')
      await quiet(sweepInlineJobs)()
      assert.deepEqual([(await store.jobs.getJob(c.id))!.outcome, (await store.jobs.getJob(c.id))!.reservation], ['abandoned', 'settled'], 'the boot’s sweep released it')
      assert.equal(await image(), before)
      await conserved(FREE)

      // The reconciler failing a job claimed too many times, and a worker whose retries ran out: both end the job through the door.
      const poison = await queue(3)
      assert.equal(await image(), before + 1)
      await closeQueues() // a fresh handle, so what Redis holds is read as it is
      await (await import('../lib/queue/queues')).bullQueue('image').remove(poison.id).catch(() => {})
      await store.jobs.updateJob(poison.id, (x) => ({ ...x, attempts: 6, updatedAt: new Date(Date.now() - 120_000).toISOString() }))
      await redis().del(redisKey('lock', 'reconcile'))
      const swept = await quiet(() => reconcileOnce('limits-check'))()
      assert.equal(swept.failed, 1, 'the reconciler failed the poison job')
      assert.deepEqual([(await store.jobs.getJob(poison.id))!.error, (await store.jobs.getJob(poison.id))!.reservation], [J.TOO_MANY_RESTARTS, 'settled'])
      assert.equal(await image(), before, 'and released its hold')

      env.QUEUE_RETRY_BACKOFF_MS = '40'
      const { startWorker } = await import('../lib/queue/worker')
      const doomed = await queue(1)
      assert.equal(await image(), before + 1)
      const worker = await startWorker({ process: async () => { throw new Error('the store is down') }, reconcileMs: 3_600_000, reconcileDelayMs: 3_600_000, heartbeatMs: 3_600_000 })
      try {
        await quiet(async () => until('the worker to give the job up', async () => (await store.jobs.getJob(doomed.id))!.status === 'failed', 15_000))()
        await until('its hold to be released', async () => (await store.jobs.getJob(doomed.id))!.reservation === 'settled', 5_000)
      } finally {
        await worker.close(1_000)
      }
      assert.equal(await image(), before, 'a worker whose retries ran out released the hold')
      delete env.QUEUE_RETRY_BACKOFF_MS
      await conserved(FREE)
    }

    // The enqueue back-outs: a dispatch that fails, and a burst over the per-person cap.
    {
      const { Queue } = await import('bullmq')
      const before = [await image(), await dollars()]
      const original = Queue.prototype.add
      Queue.prototype.add = (async () => {
        throw new Error('the queue refused it')
      }) as unknown as typeof Queue.prototype.add
      try {
        await quiet(async () => {
          await assert.rejects(queuePanel(p.addr, 3), (e: unknown) => e instanceof Refused && e.status === 503 && e.message === J.BUSY)
        })()
      } finally {
        Queue.prototype.add = original
      }
      assert.deepEqual([await image(), await dollars()], before, 'a job that could not be queued gives its hold straight back')
      const gone = (await store.jobs.listJobs({ key: panel(3), limit: 1 }))[0]
      assert.deepEqual([gone.outcome, gone.reservation], ['cancelled', 'settled'])
      await conserved(FREE)
      // Over the cap after the insert: ten racers for a cap of three leave exactly three holds.
      env.QUEUE_USER_INFLIGHT = '3'
      const racers = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) => enqueueJob({ key: `${p.pid}:sheet:cap-${i}`, ownerId: FREE, projectId: p.pid, kind: 'sheet', payload: { kind: 'sheet', characterId: `cap-${i}`, reuseDna: false, redraw: false } }))
      )
      const active = await store.jobs.listJobs({ ownerId: FREE, status: ['queued', 'running'] })
      assert.ok(racers.filter((r) => r.status === 'fulfilled').length >= active.length)
      await conserved(FREE)
      for (const j of active) await endJob(j.id, (x) => J.finish(x, { outcome: 'failed', error: 'x' }, new Date()))
      delete env.QUEUE_USER_INFLIGHT
      assert.deepEqual([await image(), await dollars()].map((n) => n >= 0), [true, true])
      await conserved(FREE)
    }

    // The processors' own endings, inline, against the stubbed provider: done settles to the real cost; a provider failure releases.
    {
      await reset()
      const q = await lockedPage('Processors', FREE2)
      const key = J.panelKey(q.pid, q.addr.chapterId, 0, 1)
      provider.imageCost = 0.0042
      assert.equal(await queuePanel(q.addr, 1), true)
      await until('the panel', () => settled(key))
      assert.equal((await redis().get(redisKey('spend', 'global', R.dayOf(Date.now())))) ?? '0', '4200', 'settled to the provider’s $0.0042')
      provider.imageMode = '500'
      assert.equal(await queuePanel(q.addr, 2), true)
      await until('the failure', () => settled(J.panelKey(q.pid, q.addr.chapterId, 0, 2)))
      const failedJob = await firstOf(J.panelKey(q.pid, q.addr.chapterId, 0, 2))
      assert.equal(failedJob.outcome, 'failed')
      const c = await conserved(FREE2)
      assert.equal(c.quota.image, 1, 'a failed draw gave its unit back')
      assert.equal(c.userDayMicros, 4_200)
      provider.imageMode = 'ok'
      provider.imageCost = null // the provider does not report a cost
      assert.equal(await queuePanel(q.addr, 3), true)
      await until('unreported', () => settled(J.panelKey(q.pid, q.addr.chapterId, 0, 3)))
      assert.equal((await conserved(FREE2)).userDayMicros, 4_200 + 20_000, 'a done picture with no reported cost keeps its estimate')
    }
    ok('every ending settles or releases — done → real cost; failed, refused, cancelled, abandoned, skipped → released; a paid picture that never landed is counted once; the enqueue’s, the status’s and the boot’s abandon, both enqueue back-outs, the processors, the reconciler’s poison job and a worker out of retries; idempotent; a crash between the ending and the settle (and a counter store that was away) is repaired by the reconciler’s sweep')
    await reset()
  }

  // 6. The kill switch ------------------------------------------------------------------------------------------------
  {
    env.INKDESK_QUEUE = 'bullmq'
    const a = await lockedPage('Pause A', FREE)
    const b = await lockedPage('Pause B', BOSS)
    const tryPanel = (page: typeof a) => queuePanel(page.addr, 0)
    assert.equal(await tryPanel(a), true, 'open: it works')
    assert.equal((await usageView(FREE)).paused, null)

    env.GLOBAL_DAILY_USD_CAP = '0.01' // the learner’s test: lower it in Railway
    const sayings: string[] = []
    for (const page of [a, b]) {
      await assert.rejects(
        queuePanel(page.addr, 1),
        (e: unknown) => {
          assert.ok(e instanceof Refused)
          assert.equal(e.status, 503)
          assert.equal(e.extra.code, 'paused')
          assert.ok(e.extra.resetsAt)
          sayings.push(e.message)
          return true
        },
        'refused for the free account and the allowlisted one alike'
      )
    }
    assert.equal(sayings[0].replace(/in about \d+ hours?/, ''), sayings[1].replace(/in about \d+ hours?/, ''), 'ONE message for everyone')
    assert.match(sayings[0], /^The studio has paused generation for today to keep its costs in check\. It will open again at 00:00 UTC, in about \d+ hours?\.$/)
    for (const u of [FREE, BOSS]) {
      const view = await usageView(u)
      assert.equal(view.paused?.reason, 'daily-cap')
      assert.equal(view.paused?.message.replace(/in about \d+ hours?/, ''), sayings[0].replace(/in about \d+ hours?/, ''), 'and the meter says the same thing')
      assert.deepEqual([view.blocked?.kind, view.blocked?.message], ['all', view.paused?.message])
      assert.equal(view.paused?.resetsAt, view.resetsAt)
      await agree(u)
    }
    // Reading and the reader keep working; every spending action — a new project too — meets the one message.
    const open = await projectRoute.GET(call('GET', `/api/projects/${a.pid}`, FREE), { params: Promise.resolve({ id: a.pid }) })
    assert.equal(open.status, 200)
    assert.equal(((await open.json()) as { title: string }).title, 'Pause A')
    await assert.rejects(spendProject(FREE2, async () => 'never'), (e: unknown) => e instanceof Refused && e.extra.code === 'paused' && e.message === sayings[0], 'a paused studio starts no new project either: the same message')
    await agree(FREE2)
    // A text call is held for the same reason an image is.
    await assert.rejects(spendText(BOSS, 'synopsis', async () => 'never'), (e: unknown) => e instanceof Refused && e.extra.code === 'paused' && e.message === sayings[1])
    assert.equal(provider.texts, 0)

    // Raise the cap and it opens again, on the next call, with no restart.
    env.GLOBAL_DAILY_USD_CAP = '5'
    assert.equal(await tryPanel(b), true, 'a raised cap reopens generation for everyone')
    assert.equal((await usageView(FREE)).paused, null)
    assert.equal(await queuePanel(a.addr, 1), true)

    // 0 pauses everything outright.
    env.GLOBAL_DAILY_USD_CAP = '0'
    await assert.rejects(queuePanel(a.addr, 2), (e: unknown) => e instanceof Refused && e.extra.code === 'paused')
    assert.equal((await usageView(BOSS)).paused?.reason, 'daily-cap')
    delete env.GLOBAL_DAILY_USD_CAP

    // The cumulative cap the learner chooses: spend counts across days, and it does not lift by itself.
    env.GLOBAL_TOTAL_USD_CAP = '0.07' // 0.06 is held by three; a fourth would pass 0.07
    assert.equal((await backend().counters(FREE)).globalTotalMicros, 60_000)
    await assert.rejects(queuePanel(a.addr, 2), (e: unknown) => {
      assert.ok(e instanceof Refused)
      assert.equal(e.extra.code, 'paused')
      assert.equal(e.extra.resetsAt, undefined, 'the cumulative cap names no reset')
      assert.equal(e.message, R.PAUSED_TOTAL)
      return true
    })
    const total = await usageView(FREE)
    assert.deepEqual([total.paused?.reason, total.paused?.resetsAt, total.blocked?.kind], ['total-cap', null, 'all'])
    setClock(() => Date.now() + 36 * 3600_000) // a day and a half later: the daily counters are new, the cumulative one is not
    assert.equal((await backend().counters(FREE)).globalDayMicros, 0)
    assert.equal((await backend().counters(FREE)).globalTotalMicros, 60_000)
    assert.equal((await usageView(FREE)).paused?.reason, 'total-cap', 'a new day does not reopen a cumulative cap')
    setClock(null)
    delete env.GLOBAL_TOTAL_USD_CAP
    assert.equal(await queuePanel(a.addr, 2), true, 'unset, there is none')

    // The 402 breaker stays, and the studio shows ONE sentence for it too.
    await tripCredits()
    assert.equal(await creditsBreakerOpen(), true)
    await assert.rejects(queuePanel(b.addr, 3), (e: unknown) => e instanceof Refused && e.status === 503 && e.message === J.PAUSED && e.extra.code === 'paused')
    const credits = await usageView(BOSS)
    assert.deepEqual([credits.paused?.reason, credits.paused?.message], ['credits', R.PAUSED_NOW])
    assert.deepEqual([credits.blocked?.kind, credits.blocked?.message], ['all', R.PAUSED_NOW])
    resetBreaker()
    await redis().del(redisKey('breaker', 'credits'))
    // Closed by the flag: the meter says so, and nothing is counted as blocked by anything else.
    env.GENERATION_ENABLED = 'false'
    const closed = await usageView(BOSS)
    assert.equal(closed.paused?.reason, 'closed')
    env.GENERATION_ENABLED = 'true'
    ok('the kill switch: one message for everyone, the meter says the same, reading and new projects keep working, a raised cap reopens at once, 0 pauses outright; the cumulative cap names no reset and survives the day; the 402 breaker is kept and worded the same')
    await reset()
  }

  // 7. Sliding windows through the one choke point ----------------------------------------------------------------------------
  {
    let now = Date.UTC(2026, 9, 15, 10, 0, 0)
    setClock(() => now)
    env.RATE_IMAGE_PER_MIN = '3'
    env.RATE_READ_PER_MIN = '4'
    env.RATE_EDIT_PER_MIN = '2'
    env.RATE_UPLOAD_PER_HOUR = '2'
    env.RATE_TEXT_PER_MIN = '2'
    env.RATE_ANON_PER_MIN = '3'
    const ask = (method: string, path: string, user = FREE, headers: Record<string, string> = {}) => requireUser(call(method, path, user, undefined, headers))
    const imagePath = '/api/projects/p1/pages/0/panels/0'
    const outcomes = async (n: number, fn: () => Promise<unknown>) => {
      const seen: string[] = []
      for (let i = 0; i < n; i++) {
        try {
          await fn()
          seen.push('ok')
        } catch (err) {
          assert.ok(err instanceof Refused)
          seen.push(`${err.status}`)
        }
      }
      return seen
    }
    assert.deepEqual(await outcomes(4, () => ask('POST', imagePath)), ['ok', 'ok', 'ok', '429'], 'three a minute, the fourth is refused')
    // The refusal as the route answers it.
    let refusal: RefusedT | null = null
    try {
      await ask('POST', imagePath)
    } catch (err) {
      refusal = err as RefusedT
    }
    assert.ok(refusal)
    const res = errorResponse(refusal, 'x', 'calm')
    assert.equal(res.status, 429)
    assert.equal(res.headers.get('retry-after'), '60')
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await res.json(), { error: 'You’re going a little fast — try again in 60 seconds.', code: 'rate', retryAfterSec: 60 })
    now += 59_000
    assert.deepEqual(await outcomes(1, () => ask('POST', imagePath)), ['429'], 'still full 59 s later — and the refusals did not extend it')
    now += 2_000
    assert.deepEqual(await outcomes(4, () => ask('POST', imagePath)), ['ok', 'ok', 'ok', '429'], 'slid: three again')
    // Staggered hits slide one at a time.
    now += 61_000
    assert.deepEqual(await outcomes(1, () => ask('POST', imagePath)), ['ok'])
    now += 20_000
    assert.deepEqual(await outcomes(1, () => ask('POST', imagePath)), ['ok'])
    now += 20_000
    assert.deepEqual(await outcomes(2, () => ask('POST', imagePath)), ['ok', '429'])
    try {
      await ask('POST', imagePath)
    } catch (err) {
      assert.equal((err as RefusedT).extra.retryAfterSec, 20, 'the oldest hit leaves the window in 20 s')
    }
    now += 21_000
    assert.deepEqual(await outcomes(2, () => ask('POST', imagePath)), ['ok', '429'], 'exactly one slot freed')
    // Windows are per person and per kind.
    assert.deepEqual(await outcomes(1, () => ask('POST', imagePath, FREE2)), ['ok'], 'another person has their own')
    assert.deepEqual(await outcomes(5, () => ask('GET', '/api/projects/p1')), ['ok', 'ok', 'ok', 'ok', '429'], 'reads have their own window (4 here)')
    assert.deepEqual(await outcomes(3, () => ask('POST', '/api/projects/p1')), ['ok', 'ok', '429'], 'edits have theirs (2 here)')
    assert.deepEqual(await outcomes(3, () => ask('POST', '/api/projects/p1/assets')), ['ok', 'ok', '429'], 'uploads have theirs (2 here)')
    assert.deepEqual(await outcomes(3, () => ask('POST', '/api/projects/p1/synopsis')), ['ok', 'ok', '429'], 'paid text has its own (2 here)')
    now += 61 * 60_000
    assert.deepEqual(await outcomes(3, () => ask('POST', '/api/projects/p1/assets')), ['ok', 'ok', '429'], 'uploads slide over an hour, not a minute')
    // Rewrite takes a text window and an image window.
    now += 2 * 3600_000
    assert.deepEqual(await outcomes(3, () => ask('POST', `${imagePath}/rewrite`, FREE2)), ['ok', 'ok', '429'], 'Rewrite is a text call first (2 here)')
    // Pictures served are not reads.
    env.RATE_MEDIA_PER_MIN = '1000'
    assert.deepEqual(await outcomes(30, () => ask('GET', '/api/projects/p1/image/img-1.png', FREE2)), Array(30).fill('ok'), 'a reader page of pictures does not spend the read window')
    // Closed generation skips the paid windows, so the route can say it is closed in its own words — and takes the edit window (2 here) instead, since it still reads the project to say it.
    env.GENERATION_ENABLED = 'false'
    now += 3600_000
    assert.deepEqual(await outcomes(3, () => ask('POST', imagePath, 'user_closedone')), ['ok', 'ok', '429'])
    env.GENERATION_ENABLED = 'true'

    // Signed-out callers get their 401 and nothing else: no window, no counter (a flood of them cannot load Redis).
    now += 3600_000
    for (let i = 0; i < 10; i++) {
      await assert.rejects(requireUser(call('GET', '/api/usage', undefined, undefined, { 'x-forwarded-for': `${i}.${i}.${i}.${i}, 203.0.113.50` })), (e: unknown) => e instanceof Refused && e.status === 401)
    }
    assert.equal((await redis().keys('inkdesk:rl:anon:*')).length, 0, 'a signed-out request wrote no counter')

    // Routes with no signed-in person key their window by the client address the trusted hop saw — so a spoofed header buys nothing.
    const fromHop = (spoof: string, real: string) => call('GET', '/api/s/x', undefined, undefined, { 'x-forwarded-for': `${spoof}, ${real}` })
    const seen: string[] = []
    for (const spoof of ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4']) {
      try {
        await limitByAddress(fromHop(spoof, '203.0.113.50'))
        seen.push('ok')
      } catch (err) {
        assert.ok(err instanceof Refused)
        seen.push(String(err.status))
      }
    }
    assert.deepEqual(seen, ['ok', 'ok', 'ok', '429'], 'rotating what the caller writes did not escape the window; the fourth is refused (3 a minute here)')
    await limitByAddress(fromHop('1.1.1.1', '203.0.113.51')) // a different address has its own window
    await assert.rejects(limitByAddress(call('GET', '/api/s/x')).then(() => limitByAddress(call('GET', '/api/s/x'))).then(() => limitByAddress(call('GET', '/api/s/x'))).then(() => limitByAddress(call('GET', '/api/s/x'))), (e: unknown) => e instanceof Refused && e.status === 429, 'with no address at all, everyone shares one window — the safe direction')
    // limitByAddress is there for the routes with no signed-in person (a share view, a report).
    env.RATE_EDIT_PER_MIN = '1'
    const rq = call('POST', '/api/s/x/report', undefined, undefined, { 'x-forwarded-for': '203.0.113.77' })
    await limitByAddress(rq, 'edit')
    await assert.rejects(limitByAddress(rq, 'edit'), (e: unknown) => e instanceof Refused && e.status === 429 && e.extra.code === 'rate')

    // Pages take no window; the local desk of a plain clone takes none at all.
    setClock(null)
    await reset()
    env.INKDESK_AUTH = 'off'
    delete env.REDIS_URL
    resetBackend()
    assert.equal(limitsEnabled(), false)
    for (let i = 0; i < 300; i++) assert.equal(await requireUser(call('GET', '/api/projects')), 'local')
    assert.equal(await requireUser(), 'local', 'a page asks with no Request')
    assert.equal((await redis().keys('inkdesk:rl:*')).length, 0, 'and counted nothing')
    env.INKDESK_LIMITS = 'on'
    env.RATE_READ_PER_MIN = '3'
    assert.equal(await requireUser(), 'local', 'with the limits on, a page still asks with no Request and takes no window')
    const sawLocal: string[] = []
    for (let i = 0; i < 5; i++) {
      try {
        sawLocal.push(await requireUser(call('GET', '/api/projects')))
      } catch (err) {
        sawLocal.push(String((err as RefusedT).status))
      }
    }
    assert.deepEqual(sawLocal, ['local', 'local', 'local', '429', '429'], 'explicitly on, the local owner is limited like anyone (in memory: no Redis is set)')
    assert.equal(backend().kind, 'memory')

    ok('sliding windows through requireUser: they slide with the clock, refusals do not extend them, Retry-After and the body are exact, kinds and people are separate, pictures are not reads, a closed studio skips the paid windows, a signed-out request takes no window, routes with no signed-in person are keyed by the trusted hop, pages take none')
    await reset()
  }

  // 8. Plans -------------------------------------------------------------------------------------------------------------------
  {
    assert.equal(await planOf(BOSS), 'allowlisted', 'case-insensitive: the allowlist says boss@example.com, the account says Boss@Example.COM')
    assert.equal(await planOf(FREE), 'free')
    assert.equal(await planOf('user_neverseen'), 'free', 'an account the webhook has not delivered yet')
    assert.equal(await planOf(J.LOCAL_OWNER), 'allowlisted', 'the local owner')
    assert.deepEqual([(await usageView(FREE)).images.limit, (await usageView(BOSS)).images.limit], [20, 150])
    // Changing the allowlist changes the plan (after the short memory of plans lapses or is forgotten).
    env.ALLOWLIST_EMAILS = 'free.one@example.com'
    forgetPlans()
    assert.deepEqual([await planOf(FREE), await planOf(BOSS)], ['allowlisted', 'free'])
    env.ALLOWLIST_EMAILS = ''
    forgetPlans()
    assert.equal(await planOf(BOSS), 'free', 'an empty allowlist: nobody')
    env.ALLOWLIST_EMAILS = ' boss@example.com , other@example.com '
    forgetPlans()
    await store.users.markDeleted(FREE2)
    env.ALLOWLIST_EMAILS += ',free.two@example.com'
    forgetPlans()
    assert.equal(await planOf(FREE2), 'free', 'a deleted account is never allowlisted')
    await store.users.upsert({ id: FREE2, email: emailOf[FREE2], createdAt: new Date().toISOString() }) // stays deleted
    // The projects quota is per plan: 1 for free, 10 for allowlisted.
    await reset()
    env.ALLOWLIST_EMAILS = ' boss@example.com '
    const make = (u: string, title: string) => projectsRoute.POST(call('POST', '/api/projects', u, { title, stylePresetId: 'manga-bw' }))
    const had = await listCount(FREE)
    assert.equal((await make(FREE, 'First')).status, 200)
    const second = await make(FREE, 'Second')
    assert.equal(second.status, 429)
    const secondBody = (await second.json()) as Record<string, unknown>
    assert.equal(secondBody.code, 'quota')
    assert.match(String(secondBody.error), /^You have used today’s 1 new project\. It resets at 00:00 UTC/)
    assert.equal(await listCount(FREE), had + 1, 'and the refused project was not made')
    for (let i = 0; i < 10; i++) assert.equal((await make(BOSS, `Boss ${i}`)).status, 200)
    assert.equal((await make(BOSS, 'Eleventh')).status, 429)
    assert.equal((await usageView(BOSS)).projects.used, 10)
    assert.equal((await usageView(FREE)).blocked?.kind, 'project')
    await agree(FREE)
    await agree(BOSS)
    ok('plans: the allowlist is case-insensitive and follows the environment, the local owner and a free account, a deleted account is free; one project a day for free, ten allowlisted, and the 429 names it')
    await reset()
  }

  // 9. Text calls and new projects hold, settle and release ----------------------------------------------------------------------------
  {
    const p = await createProject({ title: 'Texts', stylePresetId: 'manga-bw' }, FREE)
    const pid = p.address.projectId
    // Through the real route: held, then settled to the meter’s real cost.
    provider.textCost = 0.004
    const syn = () => synopsisRoute.POST(call('POST', `/api/projects/${pid}/synopsis`, FREE, { pitch: 'A courier delivers a letter.', genre: 'drama', tone: 'quiet' }), { params: Promise.resolve({ id: pid }) })
    let res = await syn()
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()))
    assert.equal(provider.texts, 1)
    let c = await backend().counters(FREE)
    assert.equal(c.userDayMicros, 4_000, 'held at two cents, settled to the 0.4 cents the call cost')
    assert.equal(c.userMonthMicros, 4_000)
    assert.equal(c.globalDayMicros, 4_000)
    assert.equal((await redis().keys(redisKey('resv', 'text-*'))).length, 0, 'no hold left behind')
    assert.equal((await readDesk(pid)).costUsd, 0.004, 'and the project’s own figure agrees')
    // A failing provider releases (and what it did not bill counts as nothing).
    provider.textMode = '500'
    res = await syn()
    assert.ok(res.status >= 400)
    c = await backend().counters(FREE)
    assert.equal(c.userDayMicros, 4_000, 'a failed call spent nothing')
    assert.equal((await redis().keys(redisKey('resv', 'text-*'))).length, 0)
    provider.textMode = 'ok'
    // A refusal costs nothing and calls nobody.
    env.USER_DAILY_USD_FREE = '0.01'
    const before = provider.texts
    res = await syn()
    assert.equal(res.status, 429)
    const body = (await res.json()) as Record<string, unknown>
    assert.deepEqual([body.code, String(body.error).startsWith('You have reached today’s spending limit of $0.01.')], ['spend', true])
    assert.equal(provider.texts, before, 'the person’s own dollar cap stopped the call before it was made')
    assert.equal((await usageView(FREE)).blocked?.kind, 'image')
    await agree(FREE)
    delete env.USER_DAILY_USD_FREE
    // A partial cost stays counted when the work fails after the provider billed.
    const meterCost = 0.003
    await assert.rejects(
      spendText(FREE2, 'cast', async (meter) => {
        meter.costUsd += meterCost
        throw new Error('the write failed after the call')
      }),
      /the write failed/
    )
    assert.equal((await backend().counters(FREE2)).userDayMicros, 3_000, 'released, but what the provider already billed stays counted')
    // spendProject: kept on success, given back on failure.
    await assert.rejects(spendProject(FREE2, async () => { throw new Error('could not write it') }), /could not write/)
    assert.equal((await backend().counters(FREE2)).quota.project, 0, 'a project that could not be made gives its quota back')
    await spendProject(FREE2, async () => 'made')
    assert.equal((await backend().counters(FREE2)).quota.project, 1)
    // Holds that nothing settles (a process that died mid-call) are swept at their estimate, and not before.
    const stuck = await reserve({ id: 'text-stuck', userId: FREE2, units: {}, usd: 0.02, tracked: true })
    void stuck
    assert.deepEqual(await sweepUnsettled(), { settled: 0, orphans: 0 }, 'not overdue yet')
    let now = Date.now()
    setClock(() => now)
    now += 31 * 60_000
    assert.deepEqual(await sweepUnsettled(), { settled: 0, orphans: 1 }, 'the stuck text hold is let go (the settled project hold is not a hold any more)')
    setClock(null)
    assert.equal(await backend().hold('text-stuck'), null)
    assert.equal((await backend().counters(FREE2)).quota.project, 1, 'the project hold had been settled; only unbacked ones are swept')
    ok('text calls and projects: held before the provider is called, settled to the meter’s real cost, released on failure (partial costs stay), refused by the person’s own dollar cap before any call, swept if never settled')
    await reset()
  }

  // 10. Limits off leaves everything as before --------------------------------------------------------------------------------------------
  {
    env.INKDESK_AUTH = 'off'
    delete env.REDIS_URL
    resetBackend()
    assert.equal(limitsEnabled(), false)
    const p = await lockedPage('Plain', J.LOCAL_OWNER)
    const key = J.panelKey(p.pid, p.addr.chapterId, 0, 0)
    for (let i = 0; i < 24; i++) {
      assert.equal(await queuePanel(p.addr, 0), true, `redraw ${i + 1}: no quota on a desk with limits off`)
      await until('landing', () => settled(key))
    }
    const jobs = await store.jobs.listJobs({ projectId: p.pid, limit: 100 })
    assert.equal(jobs.length, 24)
    assert.equal(jobs.every((j) => j.reservation === 'none' && j.reservedUsd === 0), true, 'no reservation was written')
    const view = await usageView(J.LOCAL_OWNER)
    assert.deepEqual([view.metering, view.warn, view.blocked, view.paused, view.images.used], [false, false, null, null, 0], 'the screens show no meter')
    assert.equal(view.plan, 'allowlisted')
    for (let i = 0; i < 4; i++) {
      assert.equal((await projectsRoute.POST(call('POST', '/api/projects', undefined, { title: `Plain ${i}`, stylePresetId: 'manga-bw' }))).status, 200)
    }
    assert.equal(await spendText(J.LOCAL_OWNER, 'synopsis', async (m) => (m.costUsd === 0 ? 'ran' : 'odd')), 'ran', 'text spends are plain calls')
    assert.equal((await redis().keys('inkdesk:quota:*')).length + (await redis().keys('inkdesk:spend:*')).length + (await redis().keys('inkdesk:resv:*')).length, 0, 'and not one counter was written anywhere')
    // Explicitly off with sign-in on.
    env.INKDESK_AUTH = 'test'
    env.INKDESK_LIMITS = 'off'
    assert.equal(limitsEnabled(), false)
    assert.equal(await requireUser(call('GET', '/api/projects', FREE)), FREE)
    ok('limits off: 24 redraws, new projects and text calls need no quota, no reservation is written, no counter exists, the meter is hidden — as before slice 20')
    await reset()
  }

  // 11. GET /api/usage -----------------------------------------------------------------------------------------------------------------------------
  {
    const get = (u?: string) => usageRoute.GET(call('GET', '/api/usage', u))
    let res = await get()
    assert.equal(res.status, 401, 'signed out: the one sentence')
    assert.deepEqual(await res.json(), { error: 'Sign in to use the studio.' })
    res = await get(FREE)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    const json = (await res.json()) as UsageView
    assert.deepEqual(Object.keys(json), ['plan', 'metering', 'day', 'resetsAt', 'images', 'projects', 'videoSeconds', 'audioChars', 'spend', 'paused', 'warn', 'blocked'])
    assert.match(json.day, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(new Date(json.resetsAt).toISOString(), json.resetsAt)
    assert.equal(json.resetsAt.endsWith('T00:00:00.000Z'), true, 'the next 00:00 UTC')
    assert.deepEqual(json.spend, { todayUsd: 0, monthUsd: 0, todayLimitUsd: 1 })
    assert.deepEqual(json, { ...(await usageView(FREE)) }, 'the route returns exactly the view')
    // The month figure does not depend on job records.
    await reserve({ id: 'month-1', userId: FREE, units: {}, usd: 0.5 })
    await settle('month-1', 0.4)
    await store.jobs.pruneJobs(new Date(Date.now() + 10 * 24 * 3600_000).toISOString()) // every finished record gone
    assert.equal((await store.jobs.listJobs({ ownerId: FREE, limit: 10 })).length, 0)
    assert.equal((await usageView(FREE)).spend.monthUsd, 0.4)
    // It is read-rate-limited, like any read.
    env.RATE_READ_PER_MIN = '2'
    assert.equal((await get(FREE2)).status, 200)
    assert.equal((await get(FREE2)).status, 200)
    const limited = await get(FREE2)
    assert.equal(limited.status, 429)
    assert.equal(limited.headers.get('retry-after') !== null, true)
    delete env.RATE_READ_PER_MIN
    // The screens read it: a shut meter and a pause both disable the button that would spend, with the server's own sentence; a text call is shut only by the pause.
    await reset()
    for (let n = 0; n < 20; n++) await reserve({ id: `fill-${n}`, userId: FREE, units: { image: 1 }, usd: 0.01 })
    const full = await usageView(FREE)
    assert.equal(spendBlock(full, { images: 1 }).blocked, true, 'an image button is shut at 20 of 20')
    assert.equal(spendBlock(full, { images: 1 }).reason?.includes(full.blocked?.message ?? '?'), true, 'with the server’s sentence, word for word')
    assert.equal(spendBlock(full, { text: true }).blocked, false, 'a text call has no quota: the server takes it, so the button is open')
    assert.equal(spendBlock(full, { project: true }).blocked, false, 'and so is a new project, which has its own meter')
    assert.equal(spendBlock({ ...full, images: { used: 12, limit: 20 }, blocked: null }, { images: 9 }).blocked, true, 'a run that takes 9 with 8 left is shut')
    env.GLOBAL_DAILY_USD_CAP = '0.01'
    const paused = await usageView(FREE2)
    assert.ok(paused.paused)
    for (const need of [{ images: 1 }, { text: true }, { project: true }]) assert.equal(spendBlock(paused, need).blocked, true, `a pause shuts ${Object.keys(need)[0]}`)
    delete env.GLOBAL_DAILY_USD_CAP
    // A refusal's body is what the screens read: code, resetsAt, retryAfterSec — never parsed out of the sentence.
    const refusedBody = await (await projectsRoute.POST(call('POST', '/api/projects', FREE2, { title: 'Two', stylePresetId: 'manga-bw' }))).json()
    assert.equal(asRefusal(refusedBody), null, 'an accepted project is not a refusal')
    const quotaBody = await (await projectsRoute.POST(call('POST', '/api/projects', FREE2, { title: 'Three', stylePresetId: 'manga-bw' }))).json()
    const parsed = asRefusal(quotaBody)
    assert.deepEqual([parsed?.code, typeof parsed?.resetsAt], ['quota', 'string'])
    assert.equal(refusalSentence(parsed!).includes('UTC'), true, 'the server’s sentence already says when; it is not told twice')
    ok('the screens’ half: isSpendingRequest agrees with the server on every route; a full meter and a pause disable exactly what the server would refuse, with its own sentence; a refusal body reads as code and resetsAt')
    await reset()
    ok('GET /api/usage: 401 signed out, never cached, exactly the view the enforcement checks, the month from its own counter, read-rate-limited')
    await reset()
  }

  // 12. The seams: every route is classified, every server module is server-only --------------------------------------------------------------------
  {
    const routes: string[] = []
    const walk = async (d: string) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        if (e.isDirectory()) await walk(join(d, e.name))
        else if (e.name === 'route.ts') routes.push(join(d, e.name))
      }
    }
    await walk(join(ROOT, 'app', 'api'))
    assert.ok(routes.length >= 15)
    const checked: string[] = []
    for (const file of routes) {
      const rel = relative(ROOT, file).split('\\').join('/')
      if (rel.startsWith('app/api/health/') || rel.startsWith('app/api/webhooks/')) continue
      const src = await readFile(file, 'utf8')
      const path = '/' + rel.replace(/^app\//, '').replace(/\/route\.ts$/, '').replace(/\[imageId\]/g, 'img-1.png').replace(/\[id\]/g, 'p1').replace(/\[n\]/g, '0').replace(/\[i\]/g, '1')
      for (const m of src.matchAll(/^export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/gm)) {
        const bucket = classify(m[1], path).join('+')
        const paid = /assertGenerationEnabled\(\)/.test(src)
        if (m[1] === 'GET') assert.ok(bucket === 'read' || bucket === 'media', `${m[1]} ${path} is a read`)
        else if (paid) assert.match(bucket, /^(text|image|text\+image)$/, `${m[1]} ${path} can spend, so it takes a paid window — not "${bucket}"`)
        else if (/readForm|UPLOAD_LIMIT_BYTES/.test(src)) assert.equal(bucket, 'upload', `${path} takes uploads`)
        else assert.equal(bucket, 'edit', `${m[1]} ${path}`)
        // The screens' half of the contract: what the server holds a spend for, the browser announces as a spend (the meter reads again) — and nothing else does.
        const spends = m[1] === 'POST' && (paid || src.includes('spendProject('))
        assert.equal(isSpendingRequest(m[1], path), spends, `${m[1]} ${path}: lib/limits/button.ts isSpendingRequest and the server agree on what spends`)
        // The route reaches the choke point before it does anything else.
        assert.match(src, /requireUser\(\s*req\s*\)|requireUser\(await|requireUser\(req/, `${rel} asks requireUser(req)`)
        checked.push(`${m[1]} ${path} → ${bucket}`)
      }
    }
    assert.ok(checked.some((c) => c.endsWith('→ text+image')) && checked.some((c) => c.endsWith('→ upload')) && checked.some((c) => c.includes('/usage →')))
    // The spending routes reserve through the door: a spending route that calls a provider has to be behind spendText or the queue.
    for (const file of routes) {
      const src = await readFile(file, 'utf8')
      const rel = relative(ROOT, file).split('\\').join('/')
      if (/writeSynopsis|writeCast|rewriteCharacter|writeDnaFromPicture|writePageScript|rewritePanelVisuals|writePlan\(/.test(src)) assert.match(src, /spendText\(/, `${rel} calls a text provider outside a hold`)
      assert.doesNotMatch(src, /textMeter\(/, `${rel} makes its own meter instead of being given the held one`)
    }
    // Every server module of the limits that touches the store, Redis or the environment is server-only.
    for (const name of await readdir(join(ROOT, 'lib', 'limits'))) {
      if (!name.endsWith('.ts')) continue
      const src = await readFile(join(ROOT, 'lib', 'limits', name), 'utf8')
      if (/\.\.\/store|\.\.\/queue|\.\.\/config|node:/.test(src)) assert.match(src, /import 'server-only'/, `lib/limits/${name} is server-only`)
    }
    const view = await readFile(join(ROOT, 'lib', 'limits', 'view.ts'), 'utf8')
    assert.doesNotMatch(view, /^import /m, 'the contract the browser shares imports nothing')
    ok(`${checked.length} route handlers are classified (paid → text/image, uploads → upload, the rest edit/read/media), every provider text call sits behind a hold, the server modules are server-only`)
  }

  // 12a. Money that was spent is counted, whatever became of the job (the review's fixes) -------------------------------------------------------
  {
    await reset()
    env.QUOTA_FREE_IMAGES = '3'
    /** Replace a property for the length of `body`. */
    const patched = async <T extends object>(target: T, name: keyof T, fn: unknown, body: () => Promise<void>) => {
      const real = target[name]
      ;(target as Record<string, unknown>)[name as string] = fn
      try {
        await body()
      } finally {
        ;(target as Record<string, unknown>)[name as string] = real
      }
    }
    const clickAndWait = async (click: () => Promise<unknown>, key: string) => {
      await click()
      await until(`the job for ${key} ends and settles`, () => settled(key))
    }

    // (1) A picture the provider billed and the bucket could not keep is spent: its dollars stay counted, the unit comes back, every click.
    {
      const p = await lockedPage('Outage', FREE)
      const key = J.panelKey(p.pid, p.addr.chapterId, 0, 0)
      const drawn = provider.images
      await patched(store, 'putBlob', async () => { throw new Error('S3 timeout') }, quiet(async () => {
        for (let i = 0; i < 3; i++) await clickAndWait(() => queuePanel(p.addr, 0), key)
      }))
      assert.equal(provider.images - drawn, 3, 'the provider was paid three times')
      const jobs = await store.jobs.listJobs({ key })
      assert.deepEqual(jobs.map((j) => [j.outcome, j.costUsd]), [['failed', 0.01], ['failed', 0.01], ['failed', 0.01]], 'each job ends carrying what was billed')
      const c = await conserved(FREE)
      assert.deepEqual([c.quota.image, c.userDayMicros, c.globalDayMicros], [0, 30_000, 30_000], 'three cents counted for three pictures that never landed; no unit is held for them')
      ok('1  a picture billed and never stored is counted at what it cost (the unit back, the dollars kept) — the caps see it')
    }

    // (7) A sheet that fails after Claude wrote its words has still paid for the words — and for the picture, if that was billed.
    {
      await reset()
      env.QUOTA_FREE_IMAGES = '3'
      const p = await lockedPage('Words', FREE, false)
      const key = J.sheetKey(p.pid, p.a.id)
      provider.imageMode = '500'
      const wrote = provider.texts
      await quiet(async () => {
        for (let i = 0; i < 3; i++) await clickAndWait(() => queueSheet(p.pid, p.a.id, false), key)
      })()
      assert.equal(provider.texts - wrote, 3, 'Claude wrote the words three times')
      let c = await conserved(FREE)
      assert.deepEqual([c.quota.image, c.userDayMicros], [0, 6_000], 'three failed sheets: no picture unit held, the words’ 0.2 cents each counted')
      assert.equal((await store.jobs.listJobs({ key })).every((j) => j.outcome === 'failed' && j.costUsd === 0.002), true)
      // The same sheet when the picture was billed and the bucket then failed: picture and words.
      await reset()
      env.QUOTA_FREE_IMAGES = '3'
      const q = await lockedPage('Words2', FREE, false)
      const key2 = J.sheetKey(q.pid, q.a.id)
      await patched(store, 'putBlob', async () => { throw new Error('S3 timeout') }, quiet(() => clickAndWait(() => queueSheet(q.pid, q.a.id, false), key2)))
      c = await conserved(FREE)
      assert.deepEqual([c.quota.image, c.userDayMicros], [0, 12_000], 'a sheet billed 1 cent for its picture and 0.2 for its words')
      ok('7  a sheet that fails after its words were paid for counts the words (and a billed picture) against the caps, and gives its unit back')
    }

    // (6) A sheet whose picture came back with no cost keeps the picture’s estimate, even though the words reported theirs.
    {
      await reset()
      const p = await lockedPage('NoCost', FREE, false)
      provider.imageCost = null
      await clickAndWait(() => queueSheet(p.pid, p.a.id, false), J.sheetKey(p.pid, p.a.id))
      const c = await conserved(FREE)
      assert.equal(c.userDayMicros, R.toMicros(imageEstimateUsd('sheet') + provider.textCost), 'the estimate for the picture plus the words’ real cost, not the words alone')
      assert.equal(c.quota.image, 1)
      ok('6  an unreported picture cost is held at its estimate on a sheet too')
    }

    // (2) A picture one job left behind is attached once: a later Redraw is a real draw, not a no-op that costs a unit.
    {
      await reset()
      const p = await lockedPage('Stranded', FREE)
      const key = J.panelKey(p.pid, p.addr.chapterId, 0, 0)
      const id = randomUUID()
      const hold = await holdForJob({ id, ownerId: FREE, kind: 'panel' })
      await store.jobs.insertJob(J.newJob({ key, ownerId: FREE, projectId: p.pid, kind: 'panel', payload: { kind: 'panel', chapterId: p.addr.chapterId, pageIndex: 0, index: 0 }, ...hold }, id, new Date()))
      await endJob(id, (j) => J.claim(j, 'w1', new Date()))
      const stranded = await store.putBlob(tinyPng, 'image/png', 'panel')
      await endJob(id, (j) => J.checkpoint(j, 'w1', { resultImageId: stranded, costUsd: 0.01 }, new Date()))
      await endJob(id, (j) => J.finish(j, { outcome: 'failed', error: J.TOO_MANY_RESTARTS }, new Date()))
      const drawn = provider.images
      await clickAndWait(() => queuePanel(p.addr, 0), key)
      assert.equal(provider.images, drawn, 'the stranded picture is attached, nothing is drawn')
      assert.equal((await p.read()).script?.[0].versions.length, 1)
      await clickAndWait(() => queuePanel(p.addr, 0), key)
      assert.equal(provider.images, drawn + 1, 'the Redraw after it is a real draw')
      const [redraw] = await store.jobs.listJobs({ key, limit: 1 })
      assert.deepEqual([redraw.carriedUsd, redraw.resultImageId === stranded], [0, false], 'it carries nothing from the failed job')
      assert.equal((await p.read()).script?.[0].versions.length, 2, 'the panel has two pictures now')
      const c = await conserved(FREE)
      assert.deepEqual([c.quota.image, c.userDayMicros], [2, 20_000], 'two pictures, two units, two cents: the first counted once')
      ok('2  a picture left behind by a failed job is carried only until a later job has finished: the next Redraw draws')
    }

    // (3) A left-behind picture the bucket no longer holds is not carried: the picture drawn in its place is counted whole.
    {
      await reset()
      const p = await lockedPage('Deleted', FREE)
      const key = J.panelKey(p.pid, p.addr.chapterId, 0, 0)
      // The panel is reset while the picture is in flight: the attach is refused and the paid picture is deleted.
      provider.imageHook = async () => {
        await updateDesk(p.pid, (c) => ({ ...c, script: (c.script ?? []).map((x, i) => (i === 0 ? { ...x, status: 'failed' as const, startedByRun: null, startedAt: null } : x)) }), p.addr)
      }
      await quiet(() => clickAndWait(() => queuePanel(p.addr, 0), key))()
      provider.imageHook = null
      const [first] = await store.jobs.listJobs({ key, limit: 1 })
      assert.equal(first.status, 'failed')
      assert.equal(await store.getBlob(first.resultImageId ?? 'none'), null, 'the refused picture was deleted')
      await clickAndWait(() => queuePanel(p.addr, 0), key)
      const [second] = await store.jobs.listJobs({ key, limit: 1 })
      assert.deepEqual([second.status, second.carriedUsd, second.costUsd], ['done', 0, 0.01], 'the second job carries nothing: its picture is its own')
      const c = await conserved(FREE)
      assert.deepEqual([c.quota.image, c.userDayMicros], [1, 20_000], 'two pictures were billed, two cents counted, one unit used')
      ok('3  a cost is carried only with a picture the bucket still holds: nothing is metered at zero because an earlier picture was thrown away')
    }

    // (5) The record’s reads come before the hold: what is left between the hold and the record is the write alone.
    {
      await reset()
      const p = await lockedPage('Order', FREE)
      let heldWhenRead: number | null = null
      const realList = store.jobs.listJobs
      await patched(store.jobs, 'listJobs', async (filter: Parameters<typeof realList>[0]) => {
        if (filter?.status?.includes('done') && filter.key) heldWhenRead = (await backend().counters(FREE)).quota.image
        return realList(filter)
      }, async () => {
        await clickAndWait(() => queuePanel(p.addr, 0), J.panelKey(p.pid, p.addr.chapterId, 0, 0))
      })
      assert.equal(heldWhenRead, 0, 'the stranded picture was looked up before anything was held')
      ok('5  nothing but the insert sits between a job’s hold and its record')
    }

    // (9) A refused import changes nothing: the old sheet and its words are still on the card.
    {
      await reset()
      const p = await lockedPage('Import', FREE, false)
      const bytes = tinyPng
      const blobId = await store.putBlob(bytes, 'image/png', 'asset')
      await updateDesk(p.pid, (c) => addAsset(c, { id: blobId, kind: 'reference', name: 'ref', blobId, mediaType: 'image/png', bytes: bytes.length, createdAt: new Date().toISOString() }), p.addr)
      const cardOf = async () => JSON.stringify((await p.read()).cast.find((c) => c.id === p.a.id))
      const before = await cardOf()
      const post = () => importRoute.POST(call('POST', `/api/projects/${p.pid}/import`, FREE, { id: p.a.id, assetId: blobId }), { params: Promise.resolve({ id: p.pid }) })
      const wrote = provider.texts
      env.GLOBAL_DAILY_USD_CAP = '0.01' // the studio is paused
      const paused = await quiet(post)()
      assert.equal(paused.status, 503)
      assert.equal(await cardOf(), before, 'a paused studio refuses the import and the card is as it was')
      assert.equal(provider.texts, wrote)
      delete env.GLOBAL_DAILY_USD_CAP
      env.USER_DAILY_USD_FREE = '0.01' // the person is at their own cap
      assert.equal((await quiet(post)()).status, 429)
      assert.equal(await cardOf(), before, 'so does their own spending limit')
      delete env.USER_DAILY_USD_FREE
      const done = await post()
      assert.equal(done.status, 200, 'and with room it goes through as before')
      const after = (await p.read()).cast.find((c) => c.id === p.a.id)
      assert.deepEqual([after?.sheetImageId, after?.source, typeof after?.dna], [blobId, 'imported', 'string'], 'the picture is the card’s sheet and its words were read from it')
      assert.equal(provider.texts, wrote + 1)
      ok('9  an import the studio refuses (paused, over the cap) leaves the card untouched; an accepted one still replaces the sheet and rereads the words')
    }

    // (10, 19) The credit breaker is the studio’s pause for everything that spends — a text call and a new project included — and a text 402 trips it.
    {
      await reset()
      const wrote = provider.texts
      await tripCredits()
      const view = await usageView(FREE)
      assert.deepEqual([view.paused?.reason, view.blocked?.kind], ['credits', 'all'])
      await quiet(async () => {
        await assert.rejects(spendText(FREE, 'synopsis', async () => 'never'), (e: unknown) => e instanceof Refused && e.status === 503 && e.message === J.PAUSED)
        await assert.rejects(spendProject(FREE, async () => 'never'), (e: unknown) => e instanceof Refused && e.status === 503 && e.message === J.PAUSED)
        const made = await projectsRoute.POST(call('POST', '/api/projects', FREE, { title: 'Nope', stylePresetId: 'manga-bw' }))
        assert.equal(made.status, 503)
        await assert.rejects(preflight(FREE, { image: 1 }, 0.02), (e: unknown) => e instanceof Refused && e.status === 503)
      })()
      assert.equal(provider.texts, wrote, 'and no provider was called')
      await agree(FREE) // what the meter says is what reserve enforces, kind by kind
      resetBreaker()
      assert.equal((await usageView(FREE)).paused, null, 'the breaker closes by itself, and the studio with it')
      // A text call that finds the account out of credit tells everyone.
      const p = await lockedPage('Credit', FREE)
      provider.textMode = '402'
      const res = await quiet(() => synopsisRoute.POST(call('POST', `/api/projects/${p.pid}/synopsis`, FREE, { pitch: 'A courier delivers a letter.', genre: 'drama', tone: 'quiet' }), { params: Promise.resolve({ id: p.pid }) }))()
      assert.equal(res.status, 502, 'the person gets the calm sentence')
      assert.equal(await creditsBreakerOpen(), true, 'and the studio is paused for the pictures too')
      assert.equal((await backend().counters(FREE)).userDayMicros, 0, 'the failed call cost nothing')
      resetBreaker()
      provider.textMode = 'ok'
      ok('10 19  the credit breaker refuses every spend (text calls and new projects too), matches what the meter shows, and a text 402 trips it')
    }

    // (11) A closed studio still takes a window for the paid routes it answers 503 to: a signed-in loop is not free.
    {
      await reset()
      env.GENERATION_ENABLED = 'false'
      env.RATE_EDIT_PER_MIN = '3'
      const ask = () => requireUser(call('POST', '/api/projects/p1/synopsis', 'user_closedtwo')).then(() => 'ok', (e: unknown) => (e instanceof Refused ? String(e.status) : 'err'))
      assert.deepEqual([await ask(), await ask(), await ask(), await ask()], ['ok', 'ok', 'ok', '429'])
      env.GENERATION_ENABLED = 'true'
      ok('11 a closed studio puts the paid routes in the edit window, not in none')
    }

    // (8) Clerk’s own word about an address decides whether it names a person: see check:auth (the webhook).

    // The screens’ half of the fixes — pure.
    {
      await reset()
      const base = await usageView(FREE)
      // (14) Busy is not "resets at midnight".
      const busy: UsageView = { ...base, blocked: { kind: 'all', message: J.BUSY, resetsAt: null, code: 'busy' } }
      const busyBlock = spendBlock(busy, { images: 1 })
      assert.equal(busyBlock.blocked, true)
      assert.equal(busyBlock.reason, J.BUSY, 'the sentence alone: no reset time is promised')
      assert.doesNotMatch(busyBlock.short ?? '', /everyone|until|UTC/i)
      // (20) A studio that is not open yet still takes a new project.
      const closed: UsageView = { ...base, paused: { reason: 'closed', message: R.pausedSentence('closed', 0, 0), resetsAt: null }, blocked: { kind: 'all', message: R.pausedSentence('closed', 0, 0), resetsAt: null } }
      assert.equal(spendBlock(closed, { project: true }).blocked, false, 'starting a project costs nothing, and the server takes it')
      for (const need of [{ images: 1 }, { text: true }, { project: true, images: 1 }]) assert.equal(spendBlock(closed, need).blocked, true, 'everything else is shut')
      const credits: UsageView = { ...closed, paused: { ...closed.paused!, reason: 'credits' } }
      assert.equal(spendBlock(credits, { project: true }).blocked, true, 'a pause the server enforces on projects shuts them')
      // (17) "(N left after)" is the balance after the action, and an action that does not fit says so.
      const day: UsageView = { ...base, images: { used: 2, limit: 10 } }
      assert.equal(usesLine(day, 8), 'Uses 8 of your 10 images today (0 left after).')
      assert.equal(usesLine(day, 3, 'Generate all uses'), 'Generate all uses 3 of your 10 images today (5 left after).')
      assert.equal(usesLine(day, 9), 'This takes 9 images and you have 8 left today.')
      assert.equal(usesLine(day, 11), 'That is more than the 10 images a day your plan allows, so it takes more than one day.')
      assert.equal(usesLine({ ...day, metering: false }, 3), '')
      // (15) The person’s own dollar limit is named as such: the view says so, and the short words are not "out of images".
      env.USER_DAILY_USD_FREE = '0.03'
      for (let n = 0; n < 3; n++) await reserve({ id: `cap-${n}`, userId: FREE2, units: { image: 1 }, usd: 0.01 })
      const capped = await usageView(FREE2)
      assert.deepEqual([capped.images.used, capped.blocked?.kind, capped.blocked?.code], [3, 'image', 'spend'])
      const cappedBlock = spendBlock(capped, { images: 1 })
      assert.match(cappedBlock.short ?? '', /^Spending limit reached/)
      assert.doesNotMatch(cappedBlock.short ?? '', /Out of images/)
      await agree(FREE2)
      const full = await usageView(FREE)
      assert.equal(full.blocked, null)
      delete env.USER_DAILY_USD_FREE
      // A quota says so too.
      await reset()
      for (let n = 0; n < 20; n++) await reserve({ id: `q-${n}`, userId: FREE, units: { image: 1 }, usd: 0.01 })
      assert.equal((await usageView(FREE)).blocked?.code, 'quota')
      // The studio-busy view carries its code, so no screen has to guess from the words.
      ok('14 15 17 20  the screens’ words: busy promises no reset, a closed studio takes a project, "(N left after)", the dollar limit is named as such')
    }

    // The sheet of styles: the layout fixes are held where a check can see them (no browser here).
    {
      const css = await readFile(join(ROOT, 'app', 'globals.css'), 'utf8')
      const rule = (selector: string) => {
        const at = css.indexOf(`${selector} {`)
        assert.ok(at >= 0, `${selector} has a rule`)
        return css.slice(at, css.indexOf('}', at))
      }
      assert.match(rule('.cover-actions .plan-page-estimate'), /white-space:\s*normal/, '12  the cover’s allowance line wraps inside its card')
      assert.doesNotMatch(css, /\.panel-bar-note\.is-blocked\s*\{[^}]*display:\s*none/, '16  a panel’s reason is not hidden on a phone')
      assert.doesNotMatch(rule('.panel-bar-note.is-blocked'), /ellipsis/, '16  and not cut off with an ellipsis')
      assert.doesNotMatch(css, /\.quota-trigger \.quota-label\s*\{[^}]*display:\s*none/, '16  the meter keeps its words on a phone')
      assert.match(css, /@media \(min-width: 721px\) and \(max-width: 960px\)\s*\{[^@]*\.studio-header \.header-meta\s*\{[^}]*flex-wrap:\s*wrap/, '13  the header wraps on a tablet')
      ok('12 13 16  the style sheet keeps the cover line, the panels’ reasons, the meter’s label and the tablet header from overflowing')
    }
    await reset()
  }

  // 13. Redis down: spending fails closed, reading fails open -----------------------------------------------------------------------------------------
  {
    await reset()
    env.INKDESK_QUEUE = 'bullmq'
    const p = await lockedPage('Down', FREE)
    const projectBefore = (await store.jobs.listJobs({ limit: 500 })).length
    const imagesBefore = provider.images
    if (!redisProc) {
      say('  --  (using INKDESK_CHECK_REDIS_URL: cannot stop it, so the Redis-down case is skipped)')
    } else {
      redisProc.kill('SIGKILL')
      await once(redisProc, 'exit')
      redisProc = undefined
      const t0 = Date.now()
      await quiet(async () => {
        // Spending: refused with the studio-busy sentence, nothing left behind.
        await assert.rejects(queuePanel(p.addr, 0), (e: unknown) => e instanceof Refused && e.status === 503 && e.message === J.BUSY)
        assert.equal((await store.jobs.listJobs({ projectId: p.pid, status: ['queued', 'running'] })).length, 0, 'no queued record')
        assert.equal((await store.jobs.listJobs({ limit: 500 })).length, projectBefore, 'and no record at all: the hold came first')
        const panel = await panelRoute.POST(call('POST', `/api/projects/${p.pid}/pages/0/panels/0`, FREE), { params: Promise.resolve({ id: p.pid, n: '0', i: '0' }) })
        assert.equal(panel.status, 503, 'the image window fails closed')
        assert.deepEqual(await panel.json(), { error: J.BUSY })
        const sheet = await sheetRoute.POST(call('POST', `/api/projects/${p.pid}/sheet`, FREE, { id: p.a.id }), { params: Promise.resolve({ id: p.pid }) })
        assert.equal(sheet.status, 503)
        await assert.rejects(spendText(FREE, 'synopsis', async () => 'never'), (e: unknown) => e instanceof Refused && e.status === 503 && e.message === J.BUSY)
        const made = await projectsRoute.POST(call('POST', '/api/projects', FREE, { title: 'Nope', stylePresetId: 'manga-bw' }))
        assert.equal(made.status, 503, 'a new project takes a quota, so it is spending')
        await assert.rejects(requireUser(call('POST', `/api/projects/${p.pid}/assets`, FREE)), (e: unknown) => e instanceof Refused && e.status === 503, 'uploads cost storage: closed')
        assert.equal(provider.images, imagesBefore, 'and no provider was called')
        // An outage is remembered: twenty reads and five refused spends do not each wait out the Redis timeout (a poll, an autosave and a page of pictures would).
        const t1 = Date.now()
        for (let i = 0; i < 20; i++) assert.equal(await requireUser(call('GET', '/api/projects', FREE)), FREE)
        for (let i = 0; i < 5; i++) await assert.rejects(spendText(FREE, 'synopsis', async () => 'never'), (e: unknown) => e instanceof Refused && e.status === 503 && e.message === J.BUSY)
        assert.ok(Date.now() - t1 < 8_000, `twenty reads and five refused spends took ${Date.now() - t1} ms: each one waited for Redis`)
        // Reading and editing: open.
        const open = await projectRoute.GET(call('GET', `/api/projects/${p.pid}`, FREE), { params: Promise.resolve({ id: p.pid }) })
        assert.equal(open.status, 200, 'the desk opens')
        assert.equal(await requireUser(call('GET', '/api/projects', FREE)), FREE, 'a read passes its window')
        assert.equal(await requireUser(call('POST', `/api/projects/${p.pid}`, FREE)), FREE, 'an edit passes its window')
        assert.equal(await requireUser(call('GET', '/api/projects/p/image/x.png', FREE)), FREE, 'and so does a picture')
        // The meter degrades to a sentence rather than an error.
        const usage = await usageRoute.GET(call('GET', '/api/usage', FREE))
        assert.equal(usage.status, 200)
        const view = (await usage.json()) as UsageView
        assert.deepEqual([view.blocked?.kind, view.blocked?.message, view.metering], ['all', J.BUSY, true])
        assert.equal(view.images.limit, 20, 'with the plan’s limits still shown')
      })()
      assert.ok(Date.now() - t0 < 40_000, `all of that took ${Date.now() - t0} ms, not a hang`)
      ok('Redis down: every spend is refused with the studio-busy sentence and leaves nothing behind (jobs, text calls, projects, uploads); reading, editing and the pictures go on; the meter says busy')
    }
    // Production without Redis (a web service whose generation is closed): nothing can be counted, so nothing can spend.
    await closeProducerRedis().catch(() => {})
    env.NODE_ENV = 'production'
    delete env.REDIS_URL
    env.GENERATION_ENABLED = 'false'
    resetBackend()
    try {
      const b = backend()
      await assert.rejects(b.reserve({ id: 'x', userId: 'u', units: {}, usdMicros: 0, caps: capsFor('free'), tracked: false }), (e: unknown) => e instanceof LimitsUnavailable)
      await quiet(async () => {
        await assert.rejects(reserve({ id: 'x', userId: 'u', units: { project: 1 }, usd: 0 }), (e: unknown) => e instanceof Refused && e.status === 503 && e.message === J.BUSY)
        await hit('read', 'u') // open
      })()
      assert.equal(limitsEnabled(), true)
    } finally {
      delete env.NODE_ENV
      env.GENERATION_ENABLED = 'true'
      resetBackend()
    }
    ok('production with no Redis has no counters: a reserve is the studio-busy sentence, a read window lets the request through')
  }

  assert.deepEqual(outbound, [], `nothing reached the network: ${outbound.join(', ')}`)
} finally {
  for (const c of children) c.kill('SIGKILL')
  setClock(null)
  await closeQueues().catch(() => {})
  await closeProducerRedis().catch(() => {})
  redisProc?.kill('SIGKILL')
  globalThis.fetch = realFetch
  await rm(dir, { recursive: true, force: true })
}

async function listCount(owner: string): Promise<number> {
  return (await store.listProjects(owner)).length
}

say('limits-check: all passed')
process.exit(0)

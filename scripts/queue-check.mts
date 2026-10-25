// Slice 18's acceptance checks, from `devpost/checklist.md > Slices > 18` and
// `devpost/security-report.md` CR-1, CR-3, CR-7, CR-9, CR-10, CR-11, CR-13,
// CR-16, CR-18 — against a REAL Redis (a throwaway `redis-server` on a free
// local port) and a scratch local desk, with `fetch` stubbed so no provider is
// ever reached:
//
//   npm run check:queue
//
// A page inks through the queue — four panels, four job records, each picture
// attached once. A worker killed mid-job: BullMQ's stalled recovery hands the
// job to another worker and it finishes, claimed twice and paid for once. A
// store outage AFTER the picture was paid for is retried and attaches the
// stored picture without a second provider call. A flushed Redis loses
// nothing: the reconciler puts the records back. Two writers to one project
// both land. Redis down is a calm 503 "busy" while the desk still opens. Dedupe,
// per-person caps, fairness by priority, the studio-wide cap and the 402
// breaker hold. A panel is "inking" only while a live job holds it, whichever
// web instance answers the poll, and opening a project never needs a write to
// succeed. A refused attach still charges, and deletes, the orphan.
//
// Slice 21 adds the `account` queue (an export, a deletion): such a job runs on
// its own lane, one at a time, beside the image lane; it survives a killed
// worker like a picture; it is not stopped by the caps, the pause, the credit
// breaker or a closed studio; the reconciler puts it back; the inline queue runs
// it in a lane of its own; a deletion that ends done deletes its own record.
//
// Slice 22 adds the `video` queue (a trailer): ONE job per trailer on a lane of its
// own — the worker's `video` lane, the inline queue's `videoQueue` — so a trailer
// that runs twenty minutes never holds a picture slot and a page of pictures never
// waits behind it; the credit breaker does not stop it at the door (its runner asks
// before each paid call); the reconciler puts it back by the queue its record names.
//
// Needs `redis-server` on the PATH (or INKDESK_CHECK_REDIS_URL pointing at a
// scratch Redis this check may FLUSHALL). Without either it says so and stops.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

const ok = (msg: string) => console.log(`  ok  ${msg}`)
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
async function until(what: string, pred: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const t0 = Date.now()
  while (!(await pred())) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`)
    await sleep(25)
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
    console.log('  --  check:queue needs redis-server on the PATH (or INKDESK_CHECK_REDIS_URL); skipped')
    process.exit(0)
  }
  const port = await freePort()
  redisProc = spawn('redis-server', ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no'], { stdio: 'ignore' })
  redisUrl = `redis://127.0.0.1:${port}`
}

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-queue-'))
const env = process.env as Record<string, string | undefined>
for (const name of [
  'MONGODB_URI', 'DB_URL', 'MONGODB_DB', 'DB_DATABASE', 'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET',
  'S3_BUCKET_PROJECT_FILES', 'S3_BUCKET_COMPILE_OUTPUTS', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_FORCE_PATH_STYLE',
  'S3_KEY_PREFIX', 'ANTHROPIC_API_KEY', 'NODE_ENV',
]) delete env[name]
env.INKDESK_DATA_DIR = dir
env.INKDESK_STORAGE = 'local'
env.INKDESK_QUEUE = 'bullmq'
env.REDIS_URL = redisUrl
env.GENERATION_ENABLED = 'true'
env.QUEUE_RETRY_BACKOFF_MS = '300'
env.IMAGE_RETRY_DELAY_MS = '0'
env.OPENROUTER_API_KEY = 'check-only-never-sent' // fetch is stubbed below; nothing leaves this machine
env.LLM_FALLBACK = 'always'
env.IMAGE_PANEL_QUALITY = 'low'

// --- The stub: every provider request is recorded and answered here -------------------
const tinyPng = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#8899aa' } }).png().toBuffer()
const provider = {
  images: 0,
  texts: 0,
  /** 'ok' draws; '402' answers out-of-credit. */
  mode: 'ok' as 'ok' | '402',
  /** Called once after an image answer, before it is returned. */
  afterImage: null as null | (() => void),
}
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input)
  if (url === 'https://openrouter.ai/api/v1/images') {
    provider.images++
    await sleep(provider.mode === '402' ? 600 : 40) // a 402 takes long enough for the whole page to be queued behind it
    if (provider.mode === '402') return new Response('out of credits', { status: 402 })
    const res = Response.json({ data: [{ b64_json: tinyPng.toString('base64'), media_type: 'image/png' }], usage: { cost: 0.01 } })
    const hook = provider.afterImage
    provider.afterImage = null
    hook?.()
    return res
  }
  if (url === 'https://openrouter.ai/api/v1/chat/completions') {
    provider.texts++
    return Response.json({
      choices: [{ message: { content: JSON.stringify({ dna: 'Kaito Ren, an 18-year-old courier with messy black hair and a frayed red scarf.' }) }, finish_reason: 'stop' }],
      usage: { cost: 0.002 },
    })
  }
  return realFetch(input as RequestInfo, init)
}) as typeof fetch

// Imported after the env is set, because the store and the queue read it at load.
const { createProject, read: readDesk, update: updateDesk } = await import('../lib/chapter')
const { store } = await import('../lib/store')
const { singletons } = await import('../lib/singleton')
const { saveImage, landImage } = await import('../lib/images')
const { assertEditAllowed, attachSheet, proposeCast, setDna } = await import('../lib/cast')
const { applyPatch } = await import('../lib/patch')
const { attachPanelVersion, markFailed, newScript } = await import('../lib/script')
const { queuePanel, queueBlankPanels, isQueued } = await import('../lib/panels')
const { queueSheet } = await import('../lib/sheet')
const { enqueueJob, enqueueAccountJob } = await import('../lib/queue/enqueue')
const J = await import('../lib/queue/jobs')
const { bullQueue, closeQueues } = await import('../lib/queue/queues')
const { closeProducerRedis, producerRedis, redisKey } = await import('../lib/queue/redis')
const { startWorker } = await import('../lib/queue/worker')
const { reconcileOnce } = await import('../lib/queue/reconcile')
const { resetBreaker, creditsBreakerOpen } = await import('../lib/queue/breaker')
const { HEARTBEAT_KEY, forgetQueueState, maxRunMs, queueState, readWithActivity } = await import('../lib/queue/status')
const { takeSlot } = await import('../lib/inflight')
const { retryDelayMs } = await import('../lib/image-provider')
const { Refused } = await import('../lib/errors')
const projectRoute = await import('../app/api/projects/[id]/route')
const startRoute = await import('../app/api/projects/[id]/pages/[n]/start/route')
import type { Chapter } from '../lib/types'

const redis = () => producerRedis()
const handles: { close(g?: number): Promise<void> }[] = []
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

/** A project with both characters locked and a four-panel page, ready to ink. */
async function lockedPage(title: string) {
  const first = await createProject({ title, stylePresetId: 'manga-bw' }, 'local')
  const pid = first.address.projectId
  const addr = first.address
  await updateDesk(pid, (c) => ({ ...c, synopsis }), addr)
  let chapter = await updateDesk(pid, (c) => proposeCast(c, kaito, mio), addr)
  const [a, b] = chapter.cast
  for (const [who, dna] of [[a, 'Kaito DNA, verbatim.'], [b, 'Mio DNA, verbatim.']] as const) {
    await updateDesk(pid, (c) => setDna(c, who.id, dna), addr)
    await saveImage(pid, 'sheet', tinyPng.toString('base64'), 'image/png', (c, imageId) => attachSheet(c, who.id, dna, imageId))
    chapter = await updateDesk(pid, (c) => {
      const found = c.cast.find((x) => x.id === who.id)
      if (!found) throw new Error('lost the character')
      assertEditAllowed(found, { locked: true })
      return applyPatch(c, { cast: { [who.id]: { locked: true } } })
    }, addr)
  }
  chapter = await updateDesk(pid, (c) => newScript(c, { panel1: line(a.id, 1), panel2: line(b.id, 2), panel3: line(a.id, 3), panel4: line(b.id, 4) }), addr)
  return { pid, addr, a, b, read: () => readDesk(pid, addr), update: (fn: (c: Chapter) => Chapter) => updateDesk(pid, fn, addr) }
}

/** Nothing left over between sections: Redis empty, every active job ended. */
async function reset() {
  for (const job of await store.jobs.listJobs({ status: ['queued', 'running'] })) {
    await store.jobs.updateJob(job.id, (j) => J.abandon(j, 'check reset', new Date()))
  }
  await redis().flushall()
  provider.mode = 'ok'
  provider.afterImage = null
  resetBreaker()
}

const quiet = (fn: () => Promise<void>) => async () => {
  const log = console.log, warn = console.warn, error = console.error
  console.warn = console.error = () => {}
  try {
    await fn()
  } finally {
    console.warn = warn
    console.error = error
    console.log = log
  }
}

const imagesOnDisk = async () => (await readdir(join(dir, 'images'))).length

try {
  await until('redis', async () => {
    try {
      return (await redis().ping()) === 'PONG'
    } catch {
      return false
    }
  }, 8_000)

  // 1. The state machine: pure, and the same for every store.
  {
    const t0 = new Date('2026-10-14T10:00:00Z')
    const rec = J.newJob({ key: 'k', ownerId: 'o', projectId: 'p', kind: 'panel', payload: { kind: 'panel', chapterId: 'c', pageIndex: 0, index: 1 } }, 'id-1', t0)
    assert.equal(rec.status, 'queued')
    assert.equal(rec.queue, 'image')
    const running = J.claim(rec, 'w1', t0)!
    assert.equal(running.status, 'running')
    assert.equal(running.attempts, 1)
    assert.ok(Date.parse(running.leaseUntil!) > t0.getTime())
    assert.equal(J.claim(running, 'w2', t0)?.attempts, 2, 'a stalled job delivered again is claimed again')
    assert.equal(J.renew(running, 'w2', t0), null, 'only the holder renews')
    assert.ok(J.renew(running, 'w1', new Date(t0.getTime() + 60_000)))
    const done = J.finish(running, { outcome: 'done', costUsd: 0.01 }, t0)!
    assert.equal(done.status, 'done')
    assert.equal(J.claim(done, 'w1', t0), null, 'a finished job is never taken again')
    assert.equal(J.finish(done, { outcome: 'failed', error: 'x' }, t0), null, 'the first ending stands')
    assert.equal(J.finish(running, { outcome: 'refused', error: 'x' }, t0)?.status, 'failed')
    assert.equal(J.requeue(rec, t0), null, 'only a running job goes back to queued')
    assert.equal(J.requeue(running, t0)?.status, 'queued')
    assert.equal(J.checkpoint(running, 'w9', { resultImageId: 'x' }, t0), null, 'only the holder checkpoints')
    assert.equal(J.checkpoint(running, 'w1', { resultImageId: 'x' }, t0)?.resultImageId, 'x')
    const late = new Date(t0.getTime() + J.LEASE_MS + 1)
    assert.equal(J.leaseExpired(running, late), true)
    assert.equal(J.isLive(running, late, 0), false, 'inline: a lapsed lease is dead')
    assert.equal(J.isLive(running, late, J.ABANDON_GRACE_MS), true, 'bullmq: BullMQ gets the grace to recover it')
    assert.equal(J.isLive(rec, late, 0), true, 'a waiting job is alive')
    assert.equal(J.isLive(done, t0, 0), false)
    assert.deepEqual([J.priorityFor(0), J.priorityFor(1), J.priorityFor(24)], [1, 2, 25], 'fewer in flight, served first')
    // The browser sees a failure only while it is recent, has a sentence, and nothing newer replaced it.
    const failedAt = (id: string, createdAt: string, outcome: 'failed' | 'cancelled' = 'failed') =>
      ({ ...J.finish({ ...running, id, createdAt }, { outcome, error: 'a sentence' }, t0)!, createdAt })
    const oldFail = failedAt('old', '2026-10-14T09:00:00.000Z')
    const newDone = { ...J.finish({ ...running, id: 'new', createdAt: '2026-10-14T09:30:00.000Z' }, { outcome: 'done' }, t0)! }
    assert.deepEqual(J.visibleJobs([oldFail], t0).map((v) => v.id), ['old'], 'a recent failure is shown')
    assert.deepEqual(J.visibleJobs([oldFail, newDone], t0), [], 'until a newer job for the same thing replaces it')
    assert.deepEqual(J.visibleJobs([failedAt('c', '2026-10-14T09:00:00.000Z', 'cancelled')], t0), [], 'a job cancelled at the door is not shown again')
    assert.deepEqual(J.visibleJobs([oldFail], new Date(t0.getTime() + J.SHOW_FAILED_MS + 1)), [], 'and it fades')
    const view = J.toView(running)
    assert.ok(!('key' in view) && !('ownerId' in view) && !('costUsd' in view), 'the browser sees no keys, owners or costs')
    ok('the job state machine: claim, renew, finish, requeue, checkpoint, liveness and priority')
  }

  // 2. Dedupe, the caps and fairness — Redis holds what Mongo's records say.
  {
    const p = await lockedPage('Caps')
    assert.equal(await queuePanel(p.addr, 0), true)
    assert.equal(await queuePanel(p.addr, 0), false, 'a panel already waiting is not queued twice (CR-1)')
    assert.equal(await isQueued(p.addr, 0), true)
    const records = await store.jobs.listJobs({ projectId: p.pid })
    assert.equal(records.length, 1)
    assert.equal(records[0].status, 'queued')
    assert.equal((await bullQueue('image').getJob(records[0].id))?.opts.priority, 1, 'it is on the queue under its record’s id')
    assert.deepEqual(await queueBlankPanels(p.addr), [1, 2, 3], 'the rest of the page; panel 1 was already waiting')

    // Fairness: the first job of a newcomer goes ahead of the fourth of a regular.
    const prio = async (id: string) => (await bullQueue('image').getJob(id))?.opts.priority
    const mine = await store.jobs.listJobs({ projectId: p.pid })
    assert.deepEqual((await Promise.all(mine.map((j) => prio(j.id)))).sort(), [1, 2, 3, 4], 'one person’s jobs queue behind each other by how many they have in flight')
    const bob = await enqueueJob({ key: 'bob:1', ownerId: 'bob', projectId: p.pid, kind: 'panel', payload: { kind: 'panel', chapterId: p.addr.chapterId, pageIndex: 0, index: 0 } })
    assert.equal(await prio(bob.job.id), 1, 'a newcomer’s first job goes ahead of a regular’s fifth')

    // The caps.
    env.QUEUE_USER_INFLIGHT = '4'
    await assert.rejects(
      enqueueJob({ key: 'local:extra', ownerId: J.LOCAL_OWNER, projectId: p.pid, kind: 'panel', payload: { kind: 'panel', chapterId: p.addr.chapterId, pageIndex: 9, index: 0 } }),
      (e: unknown) => e instanceof Refused && e.status === 429 && e.message === J.TOO_MANY,
      'the fifth job of one person, with four in flight, is a calm 429'
    )
    delete env.QUEUE_USER_INFLIGHT
    env.QUEUE_MAX_WAITING = '5'
    await assert.rejects(
      enqueueJob({ key: 'carol:1', ownerId: 'carol', projectId: p.pid, kind: 'panel', payload: { kind: 'panel', chapterId: p.addr.chapterId, pageIndex: 8, index: 0 } }),
      (e: unknown) => e instanceof Refused && e.status === 503 && e.message === J.BUSY,
      'the studio-wide cap answers busy'
    )
    delete env.QUEUE_MAX_WAITING
    ok('dedupe by key; fairness by priority; the per-person and studio-wide caps answer in calm sentences (CR-10, SEC-08)')
    await reset()
  }

  // 3. A page inks through the queue; the worker is a separate Worker over the same Redis.
  const worker = await startWorker({ workerId: 'w-main', concurrency: 2, lockDurationMs: 5_000, stalledIntervalMs: 1_000, heartbeatMs: 300, reconcileMs: 600_000, reconcileDelayMs: 600_000 })
  handles.push(worker)
  {
    const p = await lockedPage('Inks')
    const before = await p.read()
    assert.deepEqual(await queueBlankPanels(p.addr), [0, 1, 2, 3])
    await until('four panels done', async () => (await p.read()).script!.every((x) => x.status === 'done'))
    const after = await p.read()
    assert.equal(after.imageCount, before.imageCount + 4, 'four pictures, each counted once')
    assert.ok(Math.abs(after.costUsd - (before.costUsd + 0.04)) < 1e-9, 'four times $0.01')
    for (const panel of after.script!) {
      assert.equal(panel.versions.length, 1, 'one picture each')
      assert.equal(panel.startedByRun, null, 'the claim is released')
    }
    await until('four records done', async () => (await store.jobs.listJobs({ projectId: p.pid, status: ['done'] })).length === 4)
    for (const job of await store.jobs.listJobs({ projectId: p.pid })) {
      assert.equal(job.outcome, 'done')
      assert.equal(job.attempts, 1)
      assert.ok(job.resultImageId, 'the checkpoint is on the record')
      assert.equal(job.leaseUntil, null)
      assert.ok(Math.abs(job.costUsd - 0.01) < 1e-9)
    }
    assert.equal(provider.images, 4)
    // The status line's inputs: a worker is beating, so the queue is ok.
    assert.equal((await queueState()).state, 'ok')
    assert.equal((await readWithActivity(p.pid)).activity?.queue.state, 'ok')
    ok('a page inks through BullMQ: four records done, each picture attached once, the claim released, cost counted once')

    // A sheet is a job too: the words are reused, the picture drawn by the worker.
    const s = await createProject({ title: 'Sheet', stylePresetId: 'manga-bw' }, 'local')
    await updateDesk(s.address.projectId, (c) => ({ ...c, synopsis }), s.address)
    const cast = await updateDesk(s.address.projectId, (c) => proposeCast(c, kaito, mio), s.address)
    const [who] = cast.cast
    await updateDesk(s.address.projectId, (c) => setDna(c, who.id, 'Kaito DNA, verbatim.'), s.address)
    const t0 = provider.images
    await queueSheet(s.address.projectId, who.id, true)
    await assert.rejects(queueSheet(s.address.projectId, who.id, true), /already being drawn/, 'the same sheet is not drawn twice at once')
    await until('the sheet to land', async () => (await readDesk(s.address.projectId, s.address)).cast[0].sheetImageId !== null)
    assert.equal(provider.images, t0 + 1)
    const drawn = await readDesk(s.address.projectId, s.address)
    assert.equal(drawn.cast[0].dna, 'Kaito DNA, verbatim.', 'Redraw sheet keeps the words')
    assert.equal(drawn.imageCount, 1)
    // …and with new words: Claude’s text call comes first and is saved before the picture.
    await updateDesk(s.address.projectId, (c) => ({ ...c, cast: c.cast.map((x) => (x.id === who.id ? { ...x, dna: null } : x)) }), s.address)
    const texts0 = provider.texts
    await until('the old sheet job to end', async () => !(await isActiveKey(`${s.address.projectId}:sheet:${who.id}`)))
    await queueSheet(s.address.projectId, who.id, false)
    await until('the second sheet', async () => (await readDesk(s.address.projectId, s.address)).imageCount === 2)
    assert.equal(provider.texts, texts0 + 1, 'the words were written first')
    const second = await readDesk(s.address.projectId, s.address)
    assert.match(second.cast[0].dna ?? '', /Kaito Ren, an 18-year-old courier/)
    assert.ok(second.costUsd > 0.02, 'the text and the picture are both counted')
    ok('Draw sheet is a job: the route answers at once, the worker writes the words, then the picture, and the pair lands together (CR-11)')
    await reset()
  }

  // 4. Never paid twice: the store goes away AFTER the picture was bought.
  {
    const p = await lockedPage('Outage')
    const calls0 = provider.images
    const real = store.updateProject.bind(store)
    let thrown = 0
    provider.afterImage = () => {
      // The next project write is the attach: make it fail once, as a store outage would.
      store.updateProject = async () => {
        store.updateProject = real
        thrown++
        throw new Error('the store went away')
      }
    }
    assert.equal(await queuePanel(p.addr, 0), true)
    await until('the panel to land after the retry', async () => (await p.read()).script![0].status === 'done', 20_000)
    store.updateProject = real
    assert.equal(thrown, 1, 'the outage happened once, right after the payment')
    assert.equal(provider.images, calls0 + 1, 'the provider was called ONCE: the retry attached the stored picture')
    const after = await p.read()
    assert.equal(after.script![0].versions.length, 1, 'one version, not two')
    assert.equal(after.imageCount, 2 + 1, 'two sheets and one panel: counted once')
    await until('its record to end', async () => (await store.jobs.listJobs({ projectId: p.pid }))[0]?.status === 'done')
    const [job] = await store.jobs.listJobs({ projectId: p.pid })
    assert.equal(job.attempts, 2, 'claimed twice')
    assert.equal(job.resultImageId, after.script![0].versions[0].imageId)
    ok('a store outage after the payment is retried and attaches the stored picture: one provider call, one version, counted once')
    await reset()
  }

  // 5. A worker killed mid-job: BullMQ’s stalled recovery, then another worker finishes it.
  {
    await worker.close(2_000)
    handles.pop()
    const p = await lockedPage('Killed')
    const doomed = spawn(process.execPath, ['--import', 'tsx', 'scripts/queue-check-worker.mts'], {
      env: { ...process.env, CHECK_WORKER_ID: 'doomed' },
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    children.push(doomed)
    let out = ''
    doomed.stdout!.on('data', (d: Buffer) => (out += d.toString()))
    await until('the doomed worker to be ready', () => out.includes('READY'), 30_000)
    const calls0 = provider.images
    assert.equal(await queuePanel(p.addr, 0), true)
    await until('the doomed worker to claim the job', () => out.includes('CLAIMED'), 15_000)
    const [claimed] = await store.jobs.listJobs({ projectId: p.pid })
    assert.equal(claimed.status, 'running')
    assert.equal(claimed.workerId, 'doomed')
    doomed.kill('SIGKILL') // no goodbye, no lock release
    await once(doomed, 'exit')

    const rescuer = await startWorker({ workerId: 'rescuer', concurrency: 1, lockDurationMs: 1_500, stalledIntervalMs: 1_000, heartbeatMs: 300, reconcileMs: 600_000, reconcileDelayMs: 600_000 })
    handles.push(rescuer)
    await until('the rescuer to finish the job', async () => (await store.jobs.getJob(claimed.id))?.status === 'done', 20_000)
    const job = (await store.jobs.getJob(claimed.id))!
    assert.equal(job.workerId, 'rescuer')
    assert.equal(job.attempts, 2, 'claimed by the doomed worker, then by the rescuer')
    assert.equal(provider.images, calls0 + 1, 'and paid for once')
    const panel = (await p.read()).script![0]
    assert.equal(panel.status, 'done')
    assert.equal(panel.versions.length, 1)
    ok('a job survives a killed worker: stalled recovery hands it to another worker, which finishes it (claimed twice, paid once)')
    await rescuer.close(2_000)
    handles.pop()
    await reset()
  }

  // 6. A flushed Redis loses nothing: the reconciler puts the records back.
  {
    const p = await lockedPage('Flushed')
    assert.deepEqual(await queueBlankPanels(p.addr), [0, 1, 2, 3])
    const waiting = await store.jobs.listJobs({ projectId: p.pid, status: ['queued'] })
    assert.equal(waiting.length, 4)
    await redis().flushall() // Redis loses everything it knew
    for (const job of waiting) assert.equal(await bullQueue('image').getJob(job.id), undefined, 'Redis no longer holds it')
    // Records written a moment ago are the web service’s to queue; these are old enough to be orphans.
    const old = new Date(Date.now() - J.REQUEUE_AFTER_MS - 5_000).toISOString()
    for (const job of waiting) await store.jobs.updateJob(job.id, (j) => ({ ...j, updatedAt: old }))
    const report = await reconcileOnce('check')
    assert.equal(report.requeued, 4, 'all four were put back')
    assert.equal((await reconcileOnce('check-again')).skipped, true, 'two reconcilers do not run at once')
    const w = await startWorker({ workerId: 'after-flush', concurrency: 2, lockDurationMs: 5_000, stalledIntervalMs: 1_000, heartbeatMs: 300, reconcileMs: 600_000, reconcileDelayMs: 600_000 })
    handles.push(w)
    await until('the page to ink', async () => (await p.read()).script!.every((x) => x.status === 'done'))
    await until('the four records to end', async () => (await store.jobs.listJobs({ projectId: p.pid, status: ['done'] })).length === 4)
    ok('a flushed Redis loses nothing: the reconciler re-enqueues the queued records and the page inks')

    // A running job whose worker and queue entry are both gone goes back to queued.
    await w.close(2_000)
    handles.pop()
    const q = await lockedPage('Orphan')
    assert.equal(await queuePanel(q.addr, 0), true)
    const [rec] = await store.jobs.listJobs({ projectId: q.pid })
    const gone = new Date(Date.now() - 5_000).toISOString()
    await store.jobs.updateJob(rec.id, (j) => ({ ...J.claim(j, 'dead-worker', new Date())!, leaseUntil: gone, updatedAt: gone }))
    await bullQueue('image').obliterate({ force: true })
    const nextMinute = () => redis().del(redisKey('lock', 'reconcile')) // the reconcile lock lasts a minute; let one pass
    await nextMinute()
    const r2 = await reconcileOnce('check-3')
    assert.equal(r2.requeued, 1)
    const back = (await store.jobs.getJob(rec.id))!
    assert.equal(back.status, 'queued')
    assert.ok(await bullQueue('image').getJob(rec.id))
    // …and one claimed too many times is failed, not put back for ever.
    await store.jobs.updateJob(rec.id, (j) => ({ ...j, attempts: 6, updatedAt: old }))
    await bullQueue('image').obliterate({ force: true })
    await nextMinute()
    const poisoned = await reconcileOnce('check-5')
    assert.equal(poisoned.failed, 1)
    assert.equal((await store.jobs.getJob(rec.id))!.error, J.TOO_MANY_RESTARTS)
    ok('the reconciler restores an orphaned running job and fails one claimed too many times with a sentence')
    await reset()
  }

  // 7. Two writers to one project both land — the user typing while a page inks.
  {
    const w = await startWorker({ workerId: 'w-writes', concurrency: 2, lockDurationMs: 5_000, stalledIntervalMs: 1_000, heartbeatMs: 300, reconcileMs: 600_000, reconcileDelayMs: 600_000 })
    handles.push(w)
    const p = await lockedPage('Writers')
    await queueBlankPanels(p.addr)
    const edits = Array.from({ length: 30 }, (_, i) => p.update((c) => ({ ...c, pitch: { ...c.pitch, text: `edit ${i}` } })))
    await Promise.all(edits)
    await until('the page to ink', async () => (await p.read()).script!.every((x) => x.status === 'done'))
    const after = await p.read()
    assert.equal(after.imageCount, 2 + 4, 'every picture counted exactly once beside 30 other writes')
    assert.match(after.pitch.text, /^edit \d+$/, 'the typed words landed too')
    assert.equal(after.script!.every((x) => x.versions.length === 1), true)
    ok('thirty edits and four panel attaches to one project all land — no lost update')
    await reset()
  }

  // 8. The 402 breaker: one out-of-credit stops the rest without calling anyone.
  {
    const p = await lockedPage('Credits')
    provider.mode = '402'
    const calls0 = provider.images
    await queueBlankPanels(p.addr)
    await until('every job ended', async () => (await store.jobs.listJobs({ projectId: p.pid, status: ['queued', 'running'] })).length === 0, 20_000)
    assert.deepEqual((await p.read()).script!.map((x) => x.status), ['failed', 'failed', 'empty', 'empty'], 'the two that were drawing failed; the two behind them were never started, so they are still blank (a Draw panel button, not a lie)')
    assert.ok(provider.images - calls0 <= 2, `a 402 reached the provider ${provider.images - calls0} times; the breaker stops the rest (concurrency 2)`)
    assert.equal(await creditsBreakerOpen(), true)
    assert.equal(await redis().exists(redisKey('breaker', 'credits')), 1, 'shared through Redis for every worker and the web')
    const jobs = await store.jobs.listJobs({ projectId: p.pid })
    assert.equal(jobs.every((j) => j.status === 'failed'), true)
    assert.ok(jobs.some((j) => j.error === J.PAUSED), 'the waiting ones failed at once with one calm sentence')
    await assert.rejects(queuePanel(p.addr, 0), (e: unknown) => e instanceof Refused && e.status === 503 && e.message === J.PAUSED, 'new work is refused while it is open')
    resetBreaker()
    await redis().del(redisKey('breaker', 'credits'))
    provider.mode = 'ok'
    assert.equal(await queuePanel(p.addr, 0), true, 'and works again once it resets')
    await until('the panel to ink', async () => (await p.read()).script![0].status === 'done')
    assert.equal(retryDelayMs('7', {}), 7000)
    assert.equal(retryDelayMs('999', {}), 20_000, 'Retry-After is honoured, capped')
    assert.ok(retryDelayMs(null, {}) >= 1000 && retryDelayMs(null, {}) < 3000, 'else a jittered second or two')
    assert.equal(retryDelayMs('7', { IMAGE_RETRY_DELAY_MS: '0' }), 0)
    ok('a 402 trips the breaker: waiting jobs fail without calling the provider, new work is refused, it resets (CR-10)')
    await reset()
  }

  // 9. The stale floor: inking only while a live job holds the claim; opening never needs a write.
  {
    const p = await lockedPage('Floor')
    const get = async () => {
      const res = await projectRoute.GET(new Request('http://x'), { params: Promise.resolve({ id: p.pid }) })
      assert.equal(res.status, 200)
      return (await res.json()) as Chapter
    }
    const settled = new Date(Date.now() - 60_000).toISOString()
    const claimBy = (index: number, runId: string) =>
      p.update((c) => ({ ...c, script: c.script!.map((x) => (x.index === index ? { ...x, status: 'inking' as const, startedAt: settled, startedByRun: runId } : x)) }))

    // (a) a claim no job holds — a web restart, a lost record — comes back failed.
    await claimBy(0, 'no-such-job')
    // (b) a claim a live running job holds stays inking, whichever instance answers (CR-1).
    // (Records written straight to the store: nothing is put on the queue for a worker to pick up.)
    const record = (key: string, index: number) =>
      store.jobs.insertJob(J.newJob({ key, ownerId: J.LOCAL_OWNER, projectId: p.pid, kind: 'panel', payload: { kind: 'panel', chapterId: p.addr.chapterId, pageIndex: 0, index } }, crypto.randomUUID(), new Date()))
    const live = await record('floor:live', 1)
    await store.jobs.updateJob(live.job.id, (j) => J.claim(j, 'elsewhere', new Date()))
    await claimBy(1, live.job.id)
    // (c) a claim whose lease lapsed: on BullMQ the web waits for BullMQ’s recovery…
    const lapsed = await record('floor:lapsed', 2)
    await store.jobs.updateJob(lapsed.job.id, (j) => ({ ...J.claim(j, 'gone', new Date())!, leaseUntil: new Date(Date.now() - 30_000).toISOString() }))
    await claimBy(2, lapsed.job.id)

    const bull = await get()
    assert.deepEqual(bull.script!.map((x) => x.status), ['failed', 'inking', 'inking', 'empty'], 'bullmq: no job → failed; live job → inking; lapsed lease → still inking, BullMQ is recovering it')
    assert.deepEqual(bull.activity?.jobs.filter((j) => j.status === 'running').length, 2)
    // …on the inline queue there is no one to recover it: dead, and its panel is failed.
    env.INKDESK_QUEUE = 'inline'
    const inline = await get()
    assert.deepEqual(inline.script!.map((x) => x.status), ['failed', 'inking', 'failed', 'empty'], 'inline: a lapsed lease is dead')
    assert.equal((await store.jobs.getJob(lapsed.job.id))!.outcome, 'abandoned')
    env.INKDESK_QUEUE = 'bullmq'

    // (d) a late result from a job that was let go does not overwrite a newer claim (CR-1).
    const desk = await p.read()
    const claimed = await claimBy(0, 'newer-job')
    assert.throws(() => attachPanelVersion(claimed, 0, 'panel-late.png', new Date(), 'older-job'), /was reset while it was inking/)
    assert.equal(markFailed(claimed, 0, 'failed', 'older-job'), claimed, 'a late failure from a job that was let go changes nothing')
    assert.equal(markFailed(claimed, 0, 'failed', 'newer-job').script![0].status, 'failed')
    void desk

    // (e) CR-7: the demotion write fails, and the project still opens.
    await claimBy(0, 'no-such-job-either')
    await claimBy(3, 'also-nobody')
    const real = store.updateProject.bind(store)
    store.updateProject = async () => {
      throw new Error('the disk is full')
    }
    const opened = await quiet(async () => {
      const res = await projectRoute.GET(new Request('http://x'), { params: Promise.resolve({ id: p.pid }) })
      assert.equal(res.status, 200, 'reading a project does not depend on writing it')
      const body = (await res.json()) as Chapter
      assert.equal(body.script![3].status, 'failed', 'and the demotion shows even though it could not be saved')
      assert.equal(body.script![0].status, 'failed')
    })
    await opened()
    store.updateProject = real
    ok('a panel is inking only while a live job holds it; a lapsed lease waits for BullMQ and is dead inline; opening needs no write (CR-1, CR-7, CR-9, CR-13)')
    await reset()
  }

  // 10. A refused attach is not free, and leaves nothing behind (CR-16); a fourth redraw deletes the version it drops.
  {
    const p = await lockedPage('Orphans')
    const before = await p.read()
    const imagesBefore = await imagesOnDisk()
    const blob = await store.putBlob(tinyPng, 'image/png', 'panel')
    await assert.rejects(
      landImage(p.pid, blob, () => {
        throw new Refused('the card was locked meanwhile')
      }, 0.05, p.addr),
      Refused
    )
    assert.equal(await store.getBlob(blob), null, 'the orphan is deleted')
    assert.equal(await imagesOnDisk(), imagesBefore, 'nothing left in the bucket')
    const after = await p.read()
    assert.ok(Math.abs(after.costUsd - (before.costUsd + 0.05)) < 1e-9, 'but the money spent is still on the project')
    assert.equal(after.imageCount, before.imageCount, 'and it is not counted as a picture')

    // Redraw until a fourth version pushes the first out.
    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      const { imageId } = await saveImage(p.pid, 'panel', tinyPng.toString('base64'), 'image/png', (c, id) => {
        const panel = c.script![0]
        const versions = [...panel.versions, { imageId: id, createdAt: new Date().toISOString() }].slice(-3)
        return { ...c, script: c.script!.map((x) => (x.index === 0 ? { ...x, versions, currentVersion: versions.length - 1, status: 'done' as const } : x)) }
      }, 0.01, p.addr)
      ids.push(imageId)
    }
    assert.equal(await store.getBlob(ids[0]), null, 'the dropped oldest version was deleted')
    for (const id of ids.slice(1)) assert.ok(await store.getBlob(id), 'the three kept versions are still there')
    ok('a refused attach still charges and deletes its orphan; a fourth version deletes the one it drops (CR-16)')
    await reset()
  }

  // 11. The inline queue: the same jobs, run in this process, for a bare dev desk and every other check.
  {
    env.INKDESK_QUEUE = 'inline'
    const p = await lockedPage('Inline')
    assert.equal(await queuePanel(p.addr, 0), true)
    assert.equal(await queuePanel(p.addr, 0), false)
    await until('the inline job to finish', async () => (await p.read()).script![0].status === 'done')
    await until('its record to end', async () => (await store.jobs.listJobs({ projectId: p.pid }))[0]?.status === 'done')
    await until('the inline runner to be free', () => singletons.queue.running().length === 0)
    assert.equal((await queueState()).mode, 'inline')
    env.INKDESK_QUEUE = 'bullmq'
    ok('INKDESK_QUEUE=inline runs the same job records in the web process')
    await reset()
  }

  // 12. The guard on in-request work (CR-18).
  {
    const a = takeSlot('plan', 'p1', 2, 'again')
    assert.throws(() => takeSlot('plan', 'p1', 2, 'again'), (e: unknown) => e instanceof Refused && e.status === 409 && e.message === 'again')
    const b = takeSlot('plan', 'p2', 2, 'again')
    assert.throws(() => takeSlot('plan', 'p3', 2, 'again'), (e: unknown) => e instanceof Refused && e.status === 503 && e.message === J.BUSY)
    a()
    a() // releasing twice is harmless
    const c = takeSlot('plan', 'p3', 2, 'again')
    b()
    c()
    ok('plans in flight are bounded: one per project, a few across the process (CR-18)')
  }

  // 13. What the adversarial review found, each one reproduced first and held here (slice 18 review).
  {
    const { processJob } = await import('../lib/queue/processors')
    const { tripCredits } = await import('../lib/queue/breaker')
    const { assertCanEnqueue, activeJob } = await import('../lib/queue/enqueue')
    const { demoteStale } = await import('../lib/chapter')
    const { jobSentence, ProviderError, UNAVAILABLE } = await import('../lib/errors')
    const { maxRunMs } = await import('../lib/queue/status')
    const panelPayload = (p: { addr: { chapterId: string } }, index: number) => ({ kind: 'panel' as const, chapterId: p.addr.chapterId, pageIndex: 0, index })
    const insertRunning = async (p: { pid: string; addr: { chapterId: string } }, index: number, extra: Partial<import('../lib/queue/jobs').JobRecord> = {}) => {
      const { job } = await store.jobs.insertJob({
        ...J.newJob({ key: `review:${crypto.randomUUID()}`, ownerId: J.LOCAL_OWNER, projectId: p.pid, kind: 'panel', payload: panelPayload(p, index) }, crypto.randomUUID(), new Date()),
        ...extra,
      })
      return job
    }

    // (a) A re-run whose picture already landed must not flip the finished panel back to "inking" (high).
    {
      const p = await lockedPage('Review a')
      await queuePanel(p.addr, 0)
      await until('the panel to land', async () => (await p.read()).script![0].status === 'done')
      await until('its record to end', async () => !(await isActiveKey(`${p.pid}:${p.addr.chapterId}:0:0`)))
      const landed = (await p.read()).script![0].versions[0].imageId
      const calls: number = provider.images
      const redelivered = await insertRunning(p, 0, { status: 'running', workerId: 'dead', leaseUntil: new Date(Date.now() - 1000).toISOString(), resultImageId: landed })
      assert.equal(await processJob(redelivered.id, { workerId: 'redelivery' }), 'done')
      const panel = (await p.read()).script![0]
      assert.equal(panel.status, 'done', 'still done')
      assert.equal(panel.startedByRun, null, 'no claim left behind')
      assert.equal(panel.versions.length, 1)
      assert.equal(provider.images, calls, 'and nothing was drawn')
      const project = await store.readProject(p.pid)
      assert.deepEqual(demoteStale(project, new Set(), 360_000, new Date(Date.now() + 120_000)).demoted, [], 'so the floor has nothing to demote')
    }

    // (b) A job that already paid attaches its picture even with the credit breaker open (the retry calls nobody).
    {
      const p = await lockedPage('Review b')
      const blob = await store.putBlob(tinyPng, 'image/png', 'panel')
      const job = await insertRunning(p, 0, { status: 'running', workerId: 'dead', leaseUntil: new Date(Date.now() - 1000).toISOString(), resultImageId: blob, costUsd: 0.01 })
      await p.update((c) => ({ ...c, script: c.script!.map((x) => (x.index === 0 ? { ...x, status: 'inking' as const, startedAt: new Date().toISOString(), startedByRun: job.id } : x)) }))
      await tripCredits()
      const calls = provider.images
      assert.equal(await processJob(job.id, { workerId: 'retry' }), 'done', 'not PAUSED')
      resetBreaker()
      await redis().del(redisKey('breaker', 'credits'))
      const panel = (await p.read()).script![0]
      assert.deepEqual([panel.status, panel.versions.map((v) => v.imageId)], ['done', [blob]])
      assert.equal(provider.images, calls)
    }

    // (c) A store that blips while the job saves the picture's id does not lose the picture or its cost.
    {
      const realUpdate = store.jobs.updateJob.bind(store.jobs)
      const blip = (times: number) => {
        let left = times
        store.jobs.updateJob = async (id, fn) => {
          const before = await store.jobs.getJob(id)
          const probe = before && fn(before)
          if (left > 0 && probe && probe.resultImageId && probe.resultImageId !== before.resultImageId) {
            left--
            throw new Error('the store blipped')
          }
          return realUpdate(id, fn)
        }
      }
      for (const failures of [1, 3]) {
        const p = await lockedPage(`Review c${failures}`)
        const before = await p.read()
        const job = await insertRunning(p, 0)
        blip(failures)
        const calls: number = provider.images
        await quiet(async () => {
          assert.equal(await processJob(job.id, { workerId: 'blippy' }), 'done')
        })()
        store.jobs.updateJob = realUpdate
        const after = await p.read()
        assert.equal(after.script![0].status, 'done', `${failures} failed checkpoint(s): the picture still lands`)
        assert.equal(provider.images, calls + 1, 'drawn once')
        assert.equal(after.imageCount, before.imageCount + 1)
        assert.ok(Math.abs(after.costUsd - (before.costUsd + 0.01)) < 1e-9, 'and its cost is counted')
      }
    }

    // (d) Delivered twice: the same process drops the second; another worker waits for the first.
    {
      const p = await lockedPage('Review d')
      const job = await insertRunning(p, 0)
      const calls = provider.images
      const [a, b] = await Promise.all([processJob(job.id, { workerId: 'one' }), processJob(job.id, { workerId: 'one' })])
      assert.deepEqual([a, b].sort(), ['done', 'skipped'])
      assert.equal(provider.images, calls + 1, 'one picture bought, not two')
      const q = await lockedPage('Review d2')
      const job2 = await insertRunning(q, 0)
      const calls2 = provider.images
      const first = processJob(job2.id, { workerId: 'holder' })
      await sleep(15)
      const second = processJob(job2.id, { workerId: 'intruder' }) // the holder's lease is live
      assert.deepEqual([await first, await second], ['done', 'skipped'], 'the other worker waited, then found it finished')
      assert.equal(provider.images, calls2 + 1)
      assert.equal((await store.jobs.getJob(job2.id))!.workerId, 'holder', 'the record names the worker that drew it')
    }

    // (e) A picture a failed job paid for and never landed is picked up by the next job for the key.
    {
      const p = await lockedPage('Review e')
      const blob = await store.putBlob(tinyPng, 'image/png', 'panel')
      const key = `${p.pid}:${p.addr.chapterId}:0:0`
      const old = await insertRunning(p, 0)
      await store.jobs.updateJob(old.id, (j) => ({ ...j, key, resultImageId: blob, costUsd: 0.01 }))
      await store.jobs.updateJob(old.id, (j) => J.finish(j, { outcome: 'failed', error: J.TOO_MANY_RESTARTS }, new Date()))
      const calls = provider.images
      assert.equal(await queuePanel(p.addr, 0), true)
      await until('the panel to land', async () => (await p.read()).script![0].status === 'done')
      assert.equal(provider.images, calls, 'attached, not drawn and paid for again')
      assert.equal((await p.read()).script![0].versions[0].imageId, blob)
    }

    // (f) Liveness is judged on the fresh record, so a worker that renewed in time is not let go.
    {
      const p = await lockedPage('Review f')
      const alive = await insertRunning(p, 0, { status: 'running', workerId: 'w', leaseUntil: new Date(Date.now() + 60_000).toISOString() })
      await store.jobs.updateJob(alive.id, (j) => ({ ...j, key: 'review:alive' }))
      assert.equal((await activeJob('review:alive'))?.id, alive.id)
      const lapsed = await insertRunning(p, 1, { status: 'running', workerId: 'w', leaseUntil: new Date(Date.now() - (J.ABANDON_GRACE_MS + 1000)).toISOString() })
      await store.jobs.updateJob(lapsed.id, (j) => ({ ...j, key: 'review:lapsed' }))
      assert.equal(await activeJob('review:lapsed'), null, 'a dead one is let go')
      assert.equal((await store.jobs.getJob(lapsed.id))!.outcome, 'abandoned')
    }

    // (g) The sentences a poller can read carry no internals; a sheet's label is what was asked for; a sheet gets a longer ceiling.
    {
      const was = env.NODE_ENV
      env.NODE_ENV = 'production'
      assert.equal(jobSentence(new ProviderError('Add OPENROUTER_API_KEY to .env and restart', 'config'), 'calm'), UNAVAILABLE, 'production says only that the studio is unavailable')
      if (was === undefined) delete env.NODE_ENV
      else env.NODE_ENV = was
      assert.equal(jobSentence(new ProviderError('x', 'provider', 'HTTP 500 secret detail'), 'calm'), 'calm')
      assert.equal(jobSentence(new ProviderError('Edit the look and draw again.', 'refused'), 'calm'), 'Edit the look and draw again.')
      const sheet = J.newJob({ key: 'k', ownerId: 'o', projectId: 'p', kind: 'sheet', payload: { kind: 'sheet', characterId: 'c', reuseDna: false, redraw: false } }, 'id', new Date())
      const midway = { ...sheet, payload: { ...sheet.payload, reuseDna: true } as import('../lib/queue/jobs').JobPayload }
      assert.equal(J.toView(midway).target.reuseDna, false, 'a Draw sheet stays "Drawing…" after its words are saved')
      assert.ok(maxRunMs('sheet') > maxRunMs('panel') + 300_000, 'a sheet may take longer than a panel')
    }

    // (h) The caps hold against requests that race each other, and a route can ask before it pays.
    {
      for (const h of handles.splice(0)) await h.close(1_000)
      await reset()
      const p = await lockedPage('Review h')
      env.QUEUE_USER_INFLIGHT = '3'
      const attempts = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) => enqueueJob({ key: `burst:${i}`, ownerId: 'burster', projectId: p.pid, kind: 'panel', payload: panelPayload(p, 0) }))
      )
      const active = (await store.jobs.listJobs({ ownerId: 'burster', status: ['queued', 'running'] })).length
      assert.ok(active >= 1 && active <= 3, `ten racing requests, cap 3: ${active} active`)
      for (const a of attempts) if (a.status === 'rejected') assert.ok(a.reason instanceof Refused && a.reason.status === 429)
      await assert.rejects(assertCanEnqueue('burster'), (e: unknown) => e instanceof Refused && e.status === 429, 'the Rewrite route asks before it pays Claude')
      await assertCanEnqueue('someone-else')
      delete env.QUEUE_USER_INFLIGHT
      await reset()
    }

    // (i) A job that hangs past the ceiling is failed and its slot freed; a stop does not wait for ever.
    {
      const p = await lockedPage('Review i')
      const hang = await startWorker({ workerId: 'hang', concurrency: 1, lockDurationMs: 5_000, stalledIntervalMs: 1_000, heartbeatMs: 300, reconcileMs: 600_000, reconcileDelayMs: 600_000, jobCeilingMs: 400, process: async () => new Promise(() => {}) })
      assert.equal(await queuePanel(p.addr, 0), true)
      await quiet(async () => {
        await until('the hung job to be failed', async () => (await store.jobs.listJobs({ projectId: p.pid }))[0]?.status === 'failed', 10_000)
      })()
      assert.equal((await store.jobs.listJobs({ projectId: p.pid }))[0].error, J.TOO_MANY_RESTARTS)
      const stuck = await startWorker({ workerId: 'stuck', concurrency: 1, lockDurationMs: 5_000, heartbeatMs: 300, reconcileMs: 600_000, reconcileDelayMs: 600_000, jobCeilingMs: 600_000, process: async () => new Promise(() => {}) })
      const q = await lockedPage('Review i2')
      await queuePanel(q.addr, 0)
      await sleep(600)
      const t0 = Date.now()
      await stuck.close(300)
      assert.ok(Date.now() - t0 < 4_000, `stopped after ${Date.now() - t0} ms, not after the job`)
      await hang.close(300)
      await reset()
    }
    ok('the review’s fixes: a finished panel stays done; a paid retry attaches even with the breaker open; a failed checkpoint loses nothing; a double delivery draws once; a stranded picture is picked up; caps hold under a burst; a hung job is freed; sentences carry no internals')
  }

  // 13b. The account queue (slice 21): an export and a deletion are about a person, not a project. --------------------
  {
    const { processJob, accountRunners } = await import('../lib/queue/processors')
    const { tripCredits } = await import('../lib/queue/breaker')
    const { endJob } = await import('../lib/queue/ending')
    const { Refused: RefusedErr } = await import('../lib/errors')
    await reset()
    const panelFor = (p: { addr: { chapterId: string } }, index = 0) => ({ kind: 'panel' as const, chapterId: p.addr.chapterId, pageIndex: 0, index })
    const finishDone = (jobId: string) => endJob(jobId, (j) => J.finish(j, { outcome: 'done' }, new Date()))
    const claimBy = (jobId: string, workerId: string) => store.jobs.updateJob(jobId, (j) => J.claim(j, workerId, new Date()))
    const small = { lockDurationMs: 5_000, stalledIntervalMs: 1_000, heartbeatMs: 300, reconcileMs: 600_000, reconcileDelayMs: 600_000 }
    const realRunners = { ...accountRunners }

    // (a) The pure side: the queue's name, the kinds, the keys, what the browser would see.
    {
      assert.deepEqual([...J.QUEUE_NAMES], ['image', 'video', 'account'])
      assert.deepEqual([J.QUEUE_OF.export, J.QUEUE_OF['delete-account'], J.QUEUE_OF.panel], ['account', 'account', 'image'])
      assert.ok(J.isAccountKind('export') && J.isAccountKind('delete-account') && !J.isAccountKind('panel') && !J.isAccountKind('sheet'))
      assert.deepEqual([J.exportKey('user_a'), J.deleteAccountKey('user_a')], ['export:user_a', 'delete-account:user_a'])
      const rec = J.newJob({ key: J.exportKey('user_a'), ownerId: 'user_a', projectId: '', kind: 'export', payload: { kind: 'export' } }, 'acct-1', new Date())
      assert.deepEqual([rec.queue, rec.projectId, rec.reservation, rec.reservedUsd, rec.status], ['account', '', 'none', 0, 'queued'])
      const view = J.toView(rec)
      assert.deepEqual(view.target, {})
      assert.ok(!('key' in view) && !('ownerId' in view), 'the browser sees neither keys nor owners of an account job')
      assert.equal(maxRunMs('export'), 10 * 60_000, 'an export may take ten minutes')
      assert.equal(maxRunMs('delete-account'), 15 * 60_000, 'a deletion fifteen')
      assert.ok(maxRunMs('panel') < maxRunMs('sheet') && J.ACCOUNT_CEILING_MS > maxRunMs('delete-account'), 'the lane’s ceiling is past its longest job')
    }

    // (b) enqueueAccountJob: on the account queue, once per person and kind, and none of the studio’s refusals apply.
    {
      const p = await lockedPage('Account caps')
      const pic = await enqueueJob({ key: 'acct:pic1', ownerId: 'user_dana', projectId: p.pid, kind: 'panel', payload: panelFor(p, 0) })
      env.QUEUE_USER_INFLIGHT = '1'
      env.QUEUE_MAX_WAITING = '1'
      await assert.rejects(enqueueJob({ key: 'acct:pic2', ownerId: 'user_dana', projectId: p.pid, kind: 'panel', payload: panelFor(p, 1) }), (e: unknown) => e instanceof RefusedErr && e.status === 429, 'a picture over her cap is refused…')
      await assert.rejects(enqueueJob({ key: 'acct:pic3', ownerId: 'user_eve', projectId: p.pid, kind: 'panel', payload: panelFor(p, 2) }), (e: unknown) => e instanceof RefusedErr && e.status === 503 && e.message === J.BUSY, '…and one over the studio’s')
      env.GENERATION_ENABLED = 'false'
      await tripCredits()
      assert.equal(await creditsBreakerOpen(), true)
      await assert.rejects(enqueueJob({ key: 'acct:pic4', ownerId: 'user_eve', projectId: p.pid, kind: 'panel', payload: panelFor(p, 3) }), (e: unknown) => e instanceof RefusedErr && e.message === J.PAUSED, '…and the breaker is open')

      // With every one of those standing — both caps full, generation closed, the breaker open — a person can still take their data and leave.
      const exp = await enqueueAccountJob({ ownerId: 'user_dana', kind: 'export' })
      const del = await enqueueAccountJob({ ownerId: 'user_eve', kind: 'delete-account' })
      for (const [made, kind, owner] of [[exp, 'export', 'user_dana'], [del, 'delete-account', 'user_eve']] as const) {
        assert.equal(made.created, true)
        const rec = (await store.jobs.getJob(made.job.id))!
        assert.deepEqual([rec.kind, rec.queue, rec.ownerId, rec.projectId, rec.key, rec.status], [kind, 'account', owner, '', kind === 'export' ? J.exportKey(owner) : J.deleteAccountKey(owner), 'queued'])
        assert.deepEqual([rec.reservation, rec.reservedUsd, rec.payload], ['none', 0, { kind }], 'no reservation: it draws nothing and spends nothing')
        const entry = await bullQueue('account').getJob(made.job.id)
        assert.equal(entry?.name, kind, 'it is on the account queue, under its record’s id')
        assert.equal(await bullQueue('image').getJob(made.job.id), undefined, 'and not on the image queue')
      }
      assert.equal((await bullQueue('account').getJob(exp.job.id))?.opts.priority, 1)
      // One in flight per person and kind: asking again hands back that job; the other kind is a job of its own.
      const again = await enqueueAccountJob({ ownerId: 'user_dana', kind: 'export' })
      assert.deepEqual([again.created, again.job.id], [false, exp.job.id])
      const other = await enqueueAccountJob({ ownerId: 'user_dana', kind: 'delete-account' })
      assert.deepEqual([other.created, other.job.id === exp.job.id], [true, false])
      assert.equal((await store.jobs.listJobs({ key: J.exportKey('user_dana') })).length, 1, 'one export record')
      // A desk with sign-in off has one owner, who is the whole desk: its deletion is refused at the door, its export is fine.
      await assert.rejects(enqueueAccountJob({ ownerId: J.LOCAL_OWNER, kind: 'delete-account' }), (e: unknown) => e instanceof RefusedErr && e.status === 409 && e.message === J.NO_ACCOUNT_TO_DELETE)
      assert.equal((await store.jobs.listJobs({ key: J.deleteAccountKey(J.LOCAL_OWNER) })).length, 0, 'and leaves no record')
      assert.equal((await enqueueAccountJob({ ownerId: J.LOCAL_OWNER, kind: 'export' })).created, true)
      await assert.rejects(enqueueAccountJob({ ownerId: '', kind: 'export' }), /needs an owner/)

      // They are not counted against anyone's caps either: end her picture job, and with her export and deletion still in flight a new picture is not "over her cap of one".
      resetBreaker()
      await redis().del(redisKey('breaker', 'credits'))
      await endJob(pic.job.id, (j) => J.finish(j, { outcome: 'cancelled', error: 'x' }, new Date()))
      const first = await enqueueJob({ key: 'acct:pic5', ownerId: 'user_dana', projectId: p.pid, kind: 'panel', payload: panelFor(p, 0) })
      assert.equal(first.created, true, 'her export and deletion in flight do not count against her one picture')
      await assert.rejects(enqueueJob({ key: 'acct:pic6', ownerId: 'user_dana', projectId: p.pid, kind: 'panel', payload: panelFor(p, 1) }), (e: unknown) => e instanceof RefusedErr && e.status === 429, 'but a second picture does')
      delete env.QUEUE_USER_INFLIGHT
      delete env.QUEUE_MAX_WAITING
      env.GENERATION_ENABLED = 'true'

      // Redis required and not configured: the studio-busy sentence, and no record is left to be queued later.
      await reset()
      const redisUrlWas = env.REDIS_URL
      delete env.REDIS_URL
      env.GENERATION_ENABLED = 'false' // (a web service that cannot generate may start without Redis)
      await quiet(async () => {
        await assert.rejects(enqueueAccountJob({ ownerId: 'user_fay', kind: 'export' }), (e: unknown) => e instanceof RefusedErr && e.status === 503 && e.message === J.BUSY)
      })()
      env.REDIS_URL = redisUrlWas
      env.GENERATION_ENABLED = 'true'
      assert.equal((await store.jobs.listJobs({ ownerId: 'user_fay' })).length, 0)
      ok('enqueueAccountJob: a record with no project and no reservation, on the account queue under its id; one per person and kind; refused only for the sign-in-off deletion and a Redis that is not there — never by the caps, a closed studio or the credit breaker, and never counted against anyone’s caps')
      await reset()
    }

    // (c) Two lanes in one worker: each takes only its own queue, the account lane one at a time, the heartbeat says so.
    {
      const p = await lockedPage('Lanes')
      const e1 = await enqueueAccountJob({ ownerId: 'user_gus', kind: 'export' })
      const pic = await enqueueJob({ key: 'lane:pic', ownerId: 'user_gus', projectId: p.pid, kind: 'panel', payload: panelFor(p) })
      const handled: string[] = []
      const standIn = async (jobId: string, ctx: { workerId: string }) => {
        handled.push(jobId)
        await claimBy(jobId, ctx.workerId)
        await sleep(50)
        await finishDone(jobId)
      }
      const imageOnly = await startWorker({ workerId: 'img-only', lanes: ['image'], concurrency: 2, process: standIn, ...small })
      handles.push(imageOnly)
      await until('the picture to be handled', async () => (await store.jobs.getJob(pic.job.id))!.status === 'done')
      await sleep(800)
      assert.equal((await store.jobs.getJob(e1.job.id))!.status, 'queued', 'a worker with no account lane leaves the account job where it is')
      assert.deepEqual(handled, [pic.job.id])
      const beat = JSON.parse((await redis().get(HEARTBEAT_KEY)) ?? 'null') as { workerId: string; lanes: Record<string, number>; concurrency: number }
      assert.deepEqual([beat.workerId, beat.lanes], ['img-only', { image: 2 }], 'the heartbeat says which lanes this worker takes')
      const accountOnly = await startWorker({ workerId: 'acct-only', lanes: ['account'], process: standIn, ...small })
      handles.push(accountOnly)
      await until('the export to be handled', async () => (await store.jobs.getJob(e1.job.id))!.status === 'done')
      assert.equal((await store.jobs.getJob(e1.job.id))!.workerId, 'acct-only')
      assert.equal((await store.jobs.getJob(pic.job.id))!.workerId, 'img-only')
      const pic2 = await enqueueJob({ key: 'lane:pic2', ownerId: 'user_gus', projectId: p.pid, kind: 'panel', payload: panelFor(p, 1) })
      await until('the second picture to be handled', async () => (await store.jobs.getJob(pic2.job.id))!.status === 'done')
      assert.equal((await store.jobs.getJob(pic2.job.id))!.workerId, 'img-only', 'and the account lane never takes a picture')
      for (const h of handles.splice(0)) await h.close(1_000)
      await reset()

      // One account job at a time per worker, while pictures run two wide beside them.
      const live = { account: 0, image: 0 }
      const peak = { account: 0, image: 0 }
      const slow = async (jobId: string, ctx: { workerId: string }) => {
        const queue = (await store.jobs.getJob(jobId))!.queue as 'account' | 'image'
        live[queue]++
        peak[queue] = Math.max(peak[queue], live[queue])
        await claimBy(jobId, ctx.workerId)
        await sleep(350)
        live[queue]--
        await finishDone(jobId)
      }
      const both = await startWorker({ workerId: 'both', concurrency: 2, process: slow, ...small })
      handles.push(both)
      const beat2 = JSON.parse((await redis().get(HEARTBEAT_KEY)) ?? 'null') as { lanes: Record<string, number> }
      assert.deepEqual(beat2.lanes, { image: 2, video: 1, account: 1 }, 'every lane by default, the video and account lanes one wide')
      const ids: string[] = []
      for (const owner of ['user_h1', 'user_h2', 'user_h3']) ids.push((await enqueueAccountJob({ ownerId: owner, kind: 'export' })).job.id)
      for (let i = 0; i < 4; i++) ids.push((await enqueueJob({ key: `lane:slow${i}`, ownerId: 'user_h4', projectId: p.pid, kind: 'panel', payload: panelFor(p, i) })).job.id)
      await until('all seven to finish', async () => (await Promise.all(ids.map((id) => store.jobs.getJob(id)))).every((j) => j?.status === 'done'), 20_000)
      assert.equal(peak.account, 1, 'three exports, never two at once')
      assert.ok(peak.image >= 2, `and the pictures still ran ${peak.image} wide beside them`)
      for (const h of handles.splice(0)) await h.close(1_000)
      await reset()
      ok('the worker takes its lanes: a worker without the account lane leaves an account job queued, the account lane never takes a picture, three exports run one at a time while pictures run two wide, and the heartbeat names the lanes')
    }

    // (d) A killed worker: BullMQ’s stalled recovery hands the account job to another worker, like a picture.
    {
      const doomed = spawn(process.execPath, ['--import', 'tsx', 'scripts/queue-check-worker.mts'], {
        env: { ...process.env, CHECK_WORKER_ID: 'doomed-account' },
        stdio: ['ignore', 'pipe', 'inherit'],
      })
      children.push(doomed)
      let out = ''
      doomed.stdout!.on('data', (d: Buffer) => (out += d.toString()))
      await until('the doomed worker to be ready', () => out.includes('READY'), 30_000)
      const exp = await enqueueAccountJob({ ownerId: 'user_ivy', kind: 'export' })
      await until('the doomed worker to claim the export', () => out.includes('CLAIMED'), 15_000)
      const claimed = (await store.jobs.getJob(exp.job.id))!
      assert.deepEqual([claimed.status, claimed.workerId, claimed.queue], ['running', 'doomed-account', 'account'])
      doomed.kill('SIGKILL')
      await once(doomed, 'exit')
      const ran: string[] = []
      const rescuer = await startWorker({
        workerId: 'rescuer-account',
        lanes: ['account'],
        process: async (jobId, ctx) => {
          ran.push(jobId)
          await claimBy(jobId, ctx.workerId)
          await finishDone(jobId)
        },
        ...small,
        lockDurationMs: 1_500,
      })
      handles.push(rescuer)
      await until('the rescuer to finish the export', async () => (await store.jobs.getJob(exp.job.id))?.status === 'done', 20_000)
      const done = (await store.jobs.getJob(exp.job.id))!
      assert.deepEqual([done.workerId, done.attempts, ran], ['rescuer-account', 2, [exp.job.id]], 'claimed by the doomed worker, then by the rescuer')
      await rescuer.close(2_000)
      handles.pop()
      await reset()
      ok('an account job survives a killed worker: stalled recovery hands it to another worker on the account lane, which finishes it (claimed twice)')
    }

    // (e) The reconciler puts account jobs back, by the queue their record names.
    {
      const orphan = await enqueueAccountJob({ ownerId: 'user_jon', kind: 'delete-account' })
      await redis().flushall() // Redis loses everything it knew
      assert.equal(await bullQueue('account').getJob(orphan.job.id), undefined)
      const old = new Date(Date.now() - J.REQUEUE_AFTER_MS - 5_000).toISOString()
      await store.jobs.updateJob(orphan.job.id, (j) => ({ ...j, updatedAt: old }))
      const report = await reconcileOnce('acct-1')
      assert.equal(report.requeued, 1)
      assert.ok(await bullQueue('account').getJob(orphan.job.id), 'it is back on the account queue')
      assert.equal(await bullQueue('image').getJob(orphan.job.id), undefined, 'and not on the image queue')
      // A running one whose worker and queue entry are both gone goes back to queued, and on the queue.
      const gone = new Date(Date.now() - 5_000).toISOString()
      await store.jobs.updateJob(orphan.job.id, (j) => ({ ...J.claim(j, 'dead-worker', new Date())!, leaseUntil: gone, updatedAt: gone }))
      await bullQueue('account').obliterate({ force: true })
      await redis().del(redisKey('lock', 'reconcile'))
      const r2 = await reconcileOnce('acct-2')
      assert.equal(r2.requeued, 1)
      assert.equal((await store.jobs.getJob(orphan.job.id))!.status, 'queued')
      assert.ok(await bullQueue('account').getJob(orphan.job.id))
      // One claimed too many times is failed with a sentence, not put back for ever — and, holding no reservation, leaves nothing to settle.
      await store.jobs.updateJob(orphan.job.id, (j) => ({ ...j, attempts: 6, updatedAt: old }))
      await bullQueue('account').obliterate({ force: true })
      await redis().del(redisKey('lock', 'reconcile'))
      const r3 = await reconcileOnce('acct-3')
      assert.equal(r3.failed, 1)
      const poisoned = (await store.jobs.getJob(orphan.job.id))!
      assert.deepEqual([poisoned.status, poisoned.error, poisoned.reservation], ['failed', J.TOO_MANY_RESTARTS, 'none'])
      ok('the reconciler re-enqueues an account job a flushed Redis forgot, and one whose worker died, on the account queue; a poison one is failed with a sentence')
      await reset()
    }

    // (f) The processor: the same four steps, no credit breaker, a deletion forgets its own record when it ends done.
    {
      const calls: string[] = []
      accountRunners.export = async (job, run) => {
        calls.push(`export ${job.ownerId} ${job.projectId === ''} ${run.jobId === job.id}`)
        return { outcome: 'done' }
      }
      accountRunners['delete-account'] = async (job) => {
        calls.push(`delete ${job.ownerId}`)
        return { outcome: 'done' }
      }
      try {
        env.GENERATION_ENABLED = 'false'
        await tripCredits()
        const x = await enqueueAccountJob({ ownerId: 'user_kay', kind: 'export' })
        assert.equal(await processJob(x.job.id, { workerId: 'direct' }), 'done', 'the open credit breaker does not stop an account job: it calls no provider')
        const ranX = (await store.jobs.getJob(x.job.id))!
        assert.deepEqual([ranX.status, ranX.outcome, ranX.attempts, ranX.error, ranX.workerId, ranX.leaseUntil], ['done', 'done', 1, null, 'direct', null])
        assert.deepEqual(calls, ['export user_kay true true'])
        resetBreaker()
        await redis().del(redisKey('breaker', 'credits'))
        env.GENERATION_ENABLED = 'true'

        const d = await enqueueAccountJob({ ownerId: 'user_lee', kind: 'delete-account' })
        assert.equal(await processJob(d.job.id, { workerId: 'direct' }), 'done')
        assert.equal(await store.jobs.getJob(d.job.id), null, 'a deletion that ended done has deleted its own record: nothing of the person stays')
        assert.deepEqual(await store.jobs.listJobs({ ownerId: 'user_lee' }), [])

        accountRunners['delete-account'] = async () => ({ outcome: 'failed', error: 'Something is still left. Try again.' })
        const d2 = await enqueueAccountJob({ ownerId: 'user_mia', kind: 'delete-account' })
        assert.equal(await processJob(d2.job.id, { workerId: 'direct' }), 'failed')
        const kept = (await store.jobs.getJob(d2.job.id))!
        assert.deepEqual([kept.status, kept.error], ['failed', 'Something is still left. Try again.'], 'a failed deletion keeps its record, and its sentence for the status route to tell')
        const asked = await enqueueAccountJob({ ownerId: 'user_mia', kind: 'delete-account' })
        assert.equal(asked.created, true, 'and asking again starts a new one: the failed record no longer holds the key')

        // A runner that throws (the store went away mid-sweep): the job stays claimed for BullMQ to retry; the retry finishes it.
        let thrown = 0
        accountRunners['delete-account'] = async () => {
          if (thrown++ === 0) throw new Error('the store went away')
          return { outcome: 'done' }
        }
        const d3 = await enqueueAccountJob({ ownerId: 'user_ned', kind: 'delete-account' })
        await assert.rejects(processJob(d3.job.id, { workerId: 'direct' }), /the store went away/)
        const stuck = (await store.jobs.getJob(d3.job.id))!
        assert.deepEqual([stuck.status, stuck.attempts], ['running', 1], 'it is still claimed, not ended and not deleted')
        assert.equal(await processJob(d3.job.id, { workerId: 'direct' }), 'done', 'the retry finishes it')
        assert.equal(await store.jobs.getJob(d3.job.id), null)

        // The processor’s own guard beside the door: a deletion record for the local owner (written around enqueueAccountJob) is refused, not run.
        const before = calls.length
        const sneaked = await store.jobs.insertJob(
          J.newJob({ key: J.deleteAccountKey(J.LOCAL_OWNER), ownerId: J.LOCAL_OWNER, projectId: '', kind: 'delete-account', payload: { kind: 'delete-account' } }, crypto.randomUUID(), new Date())
        )
        assert.equal(await processJob(sneaked.job.id, { workerId: 'direct' }), 'failed')
        const refusedRec = (await store.jobs.getJob(sneaked.job.id))!
        assert.deepEqual([refusedRec.outcome, refusedRec.error], ['refused', J.NO_ACCOUNT_TO_DELETE], 'the record stays, with its sentence')
        assert.equal(calls.length, before, 'and the runner was never called')
      } finally {
        Object.assign(accountRunners, realRunners)
        resetBreaker()
        env.GENERATION_ENABLED = 'true'
      }
      ok('the processor runs account jobs like any other — claim, heartbeat, finish — with no credit-breaker check; a deletion that ends done deletes its own record, a failed one keeps it with its sentence, a thrown error is retried, and the local owner’s deletion is refused')
      await reset()
    }

    // (g) The inline queue runs them in a lane of its own — not in an image slot — one at a time.
    {
      env.INKDESK_QUEUE = 'inline'
      let open!: () => void
      const gate = new Promise<void>((resolve) => (open = resolve))
      accountRunners.export = async () => {
        await gate
        return { outcome: 'done' }
      }
      try {
        const a = await enqueueAccountJob({ ownerId: 'user_oli', kind: 'export' })
        const b = await enqueueAccountJob({ ownerId: 'user_pam', kind: 'export' })
        await until('the first export to be running', () => singletons.accountQueue.running().length === 1)
        assert.deepEqual(singletons.accountQueue.running(), [a.job.id])
        assert.deepEqual(singletons.accountQueue.waiting(), [b.job.id], 'one at a time')
        assert.deepEqual(singletons.queue.running(), [], 'the image lane is not touched')
        assert.equal(await bullQueue('account').getJob(a.job.id), undefined, 'and nothing went to Redis')
        open()
        await until('both to finish', async () => (await Promise.all([a, b].map((x) => store.jobs.getJob(x.job.id)))).every((j) => j?.status === 'done'))
        await until('the lane to be free', () => singletons.accountQueue.running().length === 0)
        // A deletion run inline deletes its own record too.
        accountRunners['delete-account'] = async () => ({ outcome: 'done' })
        const d = await enqueueAccountJob({ ownerId: 'user_quin', kind: 'delete-account' })
        await until('the inline deletion to forget itself', async () => (await store.jobs.getJob(d.job.id)) === null)
      } finally {
        Object.assign(accountRunners, realRunners)
        env.INKDESK_QUEUE = 'bullmq'
      }
      ok('INKDESK_QUEUE=inline runs account jobs in the web process in their own lane, one at a time, never in an image slot, with nothing sent to Redis')
      await reset()
    }
  }

  // 13c. The video queue (slice 22): a trailer is ONE job, on a lane of its own. -----------------------------------------
  {
    const { processJob, videoRunners } = await import('../lib/queue/processors')
    const { tripCredits } = await import('../lib/queue/breaker')
    const { endJob } = await import('../lib/queue/ending')
    await reset()
    const panelFor = (p: { addr: { chapterId: string } }, index = 0) => ({ kind: 'panel' as const, chapterId: p.addr.chapterId, pageIndex: 0, index })
    const finishDone = (jobId: string) => endJob(jobId, (j) => J.finish(j, { outcome: 'done' }, new Date()))
    const claimBy = (jobId: string, workerId: string) => store.jobs.updateJob(jobId, (j) => J.claim(j, workerId, new Date()))
    const small = { lockDurationMs: 5_000, stalledIntervalMs: 1_000, heartbeatMs: 300, reconcileMs: 600_000, reconcileDelayMs: 600_000 }
    const realTrailer = videoRunners.trailer
    const trailer = (owner: string, over: { videoId?: string; only?: number[] } = {}) =>
      enqueueJob({ key: J.trailerKey(owner), ownerId: owner, projectId: 'a-project', kind: 'trailer', payload: { kind: 'trailer', videoId: over.videoId ?? crypto.randomUUID(), ...(over.only ? { only: over.only } : {}) } })

    // (a) The pure side and the door: the queue's name, the key, the ceiling, the record, one in flight per person.
    {
      assert.equal(J.QUEUE_OF.trailer, 'video')
      assert.equal(J.trailerKey('user_a'), 'trailer:user_a')
      assert.equal(maxRunMs('trailer'), J.TRAILER_RUN_MS, 'a trailer’s heartbeat runs for TRAILER_RUN_MS')
      assert.ok(maxRunMs('trailer') > maxRunMs('sheet') && maxRunMs('trailer') > J.ACCOUNT_RUN_MS['delete-account'], 'longer than a sheet or a deletion')
      const a = await trailer('user_t1')
      assert.equal(a.created, true)
      assert.deepEqual([a.job.queue, a.job.kind, a.job.status, a.job.reservation, a.job.projectId, a.job.key], ['video', 'trailer', 'queued', 'none', 'a-project', 'trailer:user_t1'])
      assert.ok(await bullQueue('video').getJob(a.job.id), 'it is on the video queue')
      assert.equal(await bullQueue('image').getJob(a.job.id), undefined, 'and not on the image queue')
      const again = await trailer('user_t1')
      assert.deepEqual([again.created, again.job.id], [false, a.job.id], 'one trailer in flight per person: asking again is the job that holds the key')
      const other = await trailer('user_t2')
      assert.equal(other.created, true, 'another person has their own')
      assert.deepEqual(J.toView(a.job).target, { videoId: (a.job.payload as { videoId: string }).videoId })
      await reset()
    }

    // (b) Lanes: a worker without the video lane leaves a trailer where it is, the video lane takes only trailers, the heartbeat names it.
    {
      const p = await lockedPage('VideoLanes')
      const t = await trailer('user_t3')
      const pic = await enqueueJob({ key: 'vlane:pic', ownerId: 'user_t3', projectId: p.pid, kind: 'panel', payload: panelFor(p) })
      const handled: string[] = []
      const standIn = async (jobId: string, ctx: { workerId: string }) => {
        handled.push(jobId)
        await claimBy(jobId, ctx.workerId)
        await sleep(40)
        await finishDone(jobId)
      }
      const imageOnly = await startWorker({ workerId: 'img-only-2', lanes: ['image'], process: standIn, ...small })
      handles.push(imageOnly)
      await until('the picture to be handled', async () => (await store.jobs.getJob(pic.job.id))!.status === 'done')
      await sleep(700)
      assert.equal((await store.jobs.getJob(t.job.id))!.status, 'queued', 'a worker with no video lane leaves the trailer queued')
      const videoOnly = await startWorker({ workerId: 'vid-only', lanes: ['video'], process: standIn, ...small })
      handles.push(videoOnly)
      await until('the trailer to be handled', async () => (await store.jobs.getJob(t.job.id))!.status === 'done')
      assert.deepEqual([(await store.jobs.getJob(t.job.id))!.workerId, (await store.jobs.getJob(pic.job.id))!.workerId], ['vid-only', 'img-only-2'])
      const beat = JSON.parse((await redis().get(HEARTBEAT_KEY)) ?? 'null') as { lanes: Record<string, number> }
      assert.deepEqual(beat.lanes, { video: 1 }, 'the heartbeat names the video lane, one wide')
      for (const h of handles.splice(0)) await h.close(1_000)
      await reset()

      // One trailer at a time per worker by default (QUEUE_CONCURRENCY_VIDEO), while pictures run two wide beside it;
      // `videoConcurrency` widens only the video lane.
      const peakOf = async (videoConcurrency: number | undefined) => {
        const live = { video: 0, image: 0 }
        const peak = { video: 0, image: 0 }
        const slow = async (jobId: string, ctx: { workerId: string }) => {
          const queue = (await store.jobs.getJob(jobId))!.queue as 'video' | 'image'
          live[queue]++
          peak[queue] = Math.max(peak[queue], live[queue])
          await claimBy(jobId, ctx.workerId)
          await sleep(350)
          live[queue]--
          await finishDone(jobId)
        }
        const worker = await startWorker({ workerId: `peak-${videoConcurrency ?? 'default'}`, concurrency: 2, ...(videoConcurrency ? { videoConcurrency } : {}), process: slow, ...small })
        handles.push(worker)
        const ids: string[] = []
        for (const owner of ['user_v1', 'user_v2', 'user_v3']) ids.push((await trailer(owner)).job.id)
        for (let i = 0; i < 4; i++) ids.push((await enqueueJob({ key: `vlane:slow${i}`, ownerId: 'user_v4', projectId: p.pid, kind: 'panel', payload: panelFor(p, i) })).job.id)
        await until('all seven to finish', async () => (await Promise.all(ids.map((id) => store.jobs.getJob(id)))).every((j) => j?.status === 'done'), 20_000)
        for (const h of handles.splice(0)) await h.close(1_000)
        await reset()
        return peak
      }
      const narrow = await peakOf(undefined)
      assert.equal(narrow.video, 1, 'three trailers, never two at once by default')
      assert.ok(narrow.image >= 2, `and the pictures still ran ${narrow.image} wide beside them`)
      const wide = await peakOf(2)
      assert.equal(wide.video, 2, 'videoConcurrency: 2 runs two trailers at once')
      assert.ok(wide.image >= 2)
      ok('the worker’s video lane: a worker without it leaves a trailer queued, the lane takes only trailers, three trailers run one at a time while pictures run two wide beside them (two wide with videoConcurrency 2), and the heartbeat names it')
    }

    // (c) The reconciler puts a trailer back on the video queue, by the queue its record names.
    {
      const orphan = await trailer('user_t4')
      await redis().flushall()
      assert.equal(await bullQueue('video').getJob(orphan.job.id), undefined)
      const old = new Date(Date.now() - J.REQUEUE_AFTER_MS - 5_000).toISOString()
      await store.jobs.updateJob(orphan.job.id, (j) => ({ ...j, updatedAt: old }))
      assert.equal((await reconcileOnce('vid-1')).requeued, 1)
      assert.ok(await bullQueue('video').getJob(orphan.job.id), 'it is back on the video queue')
      assert.equal(await bullQueue('image').getJob(orphan.job.id), undefined, 'and not on the image queue')
      const gone = new Date(Date.now() - 5_000).toISOString()
      await store.jobs.updateJob(orphan.job.id, (j) => ({ ...J.claim(j, 'dead-worker', new Date())!, leaseUntil: gone, updatedAt: gone }))
      await bullQueue('video').obliterate({ force: true })
      await redis().del(redisKey('lock', 'reconcile'))
      assert.equal((await reconcileOnce('vid-2')).requeued, 1)
      assert.equal((await store.jobs.getJob(orphan.job.id))!.status, 'queued')
      assert.ok(await bullQueue('video').getJob(orphan.job.id))
      await store.jobs.updateJob(orphan.job.id, (j) => ({ ...j, attempts: 6, updatedAt: old }))
      await bullQueue('video').obliterate({ force: true })
      await redis().del(redisKey('lock', 'reconcile'))
      assert.equal((await reconcileOnce('vid-3')).failed, 1)
      const poisoned = (await store.jobs.getJob(orphan.job.id))!
      assert.deepEqual([poisoned.status, poisoned.error], ['failed', J.TOO_MANY_RESTARTS])
      ok('the reconciler re-enqueues a trailer a flushed Redis forgot, and one whose worker died, on the video queue; a poison one is failed with a sentence')
      await reset()
    }

    // (d) The processor: the runner is looked up per job, the credit breaker does not stop a trailer at the door, the outcome is the job's.
    {
      const seen: string[] = []
      videoRunners.trailer = async (job, run) => {
        seen.push(`${job.kind} ${job.payload.kind === 'trailer' ? (job.payload.only ?? []).join(',') : '?'} ${run.jobId === job.id}`)
        await run.patchPayload({ baselineUsd: 0.25 })
        return { outcome: 'done', costUsd: 0.3 }
      }
      try {
        const t = await trailer('user_t5', { only: [2] })
        await tripCredits() // the credits ran out after it was queued
        assert.equal(await creditsBreakerOpen(), true)
        assert.equal(await processJob(t.job.id, { workerId: 'direct' }), 'done', 'the open credit breaker does not fail a trailer at the door: a retry or an assembly of parts already paid for must still run')
        const ran = (await store.jobs.getJob(t.job.id))!
        assert.deepEqual([ran.status, ran.outcome, ran.costUsd, ran.attempts, ran.workerId, ran.leaseUntil], ['done', 'done', 0.3, 1, 'direct', null])
        assert.deepEqual(ran.payload, { kind: 'trailer', videoId: (t.job.payload as { videoId: string }).videoId, only: [2], baselineUsd: 0.25 }, 'the runner saved its baseline on the job through patchPayload')
        assert.deepEqual(seen, ['trailer 2 true'])
        // A picture job under the same open breaker is still failed at the door (it would only call the provider).
        const p = await lockedPage('BreakerStill')
        const pic = await enqueueJob({ key: 'vlane:breaker', ownerId: 'local', projectId: p.pid, kind: 'panel', payload: panelFor(p) }).catch((e: unknown) => e)
        assert.ok(pic instanceof Refused && pic.extra.code === 'paused', 'and new work is still refused at the door while the breaker is open')
        resetBreaker()
        await redis().del(redisKey('breaker', 'credits'))

        videoRunners.trailer = async () => ({ outcome: 'failed', error: 'The trailer didn’t come together. Try again.' })
        const f = await trailer('user_t6')
        assert.equal(await processJob(f.job.id, { workerId: 'direct' }), 'failed')
        const failed = (await store.jobs.getJob(f.job.id))!
        assert.deepEqual([failed.status, failed.outcome, failed.error], ['failed', 'failed', 'The trailer didn’t come together. Try again.'])
        assert.equal((await trailer('user_t6')).created, true, 'and the key is free again')

        // A runner that throws (the store went away mid-trailer): the job stays claimed for BullMQ to retry; the retry finishes it.
        let thrown = 0
        videoRunners.trailer = async () => {
          if (thrown++ === 0) throw new Error('the store went away')
          return { outcome: 'done' }
        }
        const t7 = await trailer('user_t7')
        await assert.rejects(processJob(t7.job.id, { workerId: 'direct' }), /the store went away/)
        assert.deepEqual([(await store.jobs.getJob(t7.job.id))!.status, (await store.jobs.getJob(t7.job.id))!.attempts], ['running', 1])
        assert.equal(await processJob(t7.job.id, { workerId: 'direct' }), 'done')
        // A redelivery of a finished trailer is a no-op: nothing is run twice.
        const calls = thrown
        assert.equal(await processJob(t7.job.id, { workerId: 'direct' }), 'skipped')
        assert.equal(thrown, calls)
      } finally {
        videoRunners.trailer = realTrailer
        resetBreaker()
      }
      ok('the processor runs a trailer through the runner it looks up — claim, patchPayload, finish — with no credit-breaker check at the door; a failed outcome keeps its sentence and frees the key, a thrown error is retried, a redelivery of a finished one is skipped')
      await reset()
    }

    // (d2) No ffmpeg on this machine (after-audit #12): a trailer would pay for its shots and then fail at the assembly, so
    //      it is refused before the runner sends anything — the job and its video record fail with the sentence.
    {
      const { newVideoRecord } = await import('../lib/video/record')
      const { TRAILER_NEEDS_FFMPEG } = await import('../lib/queue/processors')
      let ran = 0
      videoRunners.trailer = async () => {
        ran++
        return { outcome: 'done' }
      }
      const path = env.PATH
      const quiet = console.error
      try {
        const videoId = crypto.randomUUID()
        await store.videos.put(newVideoRecord({ id: videoId, ownerId: 'user_t8', projectId: 'a-project', plan: { page: 0, runSeconds: 12, shots: [] } as unknown as import('../lib/video/types').TrailerPlan }))
        const t = await trailer('user_t8', { videoId })
        env.PATH = join(dir, 'no-ffmpeg-here')
        console.error = () => {}
        assert.equal(await processJob(t.job.id, { workerId: 'direct' }), 'failed')
        console.error = quiet
        assert.equal(ran, 0, 'the runner — and every paid call in it — never started')
        const job = (await store.jobs.getJob(t.job.id))!
        assert.deepEqual([job.status, job.error, job.costUsd], ['failed', TRAILER_NEEDS_FFMPEG, 0])
        const video = (await store.videos.get(videoId))!
        assert.deepEqual([video.status, video.error], ['failed', TRAILER_NEEDS_FFMPEG], 'the trailer says why, and can be tried again')
        // A redelivered trailer whose shots are already at the provider: they are ended as orphaned (counted at the
        // formula's price), so Try again can take them — never left `animating` on a failed trailer for good.
        const { markMaking, markSubmitting, markSubmitted, queueRetry } = await import('../lib/video/record')
        const shotPlan = { title: 't', page: 0, model: 'bytedance/seedance-2.0-fast', resolution: '480p', method: 'B', shots: [{ panel: 0, aspect: '16:9', seconds: 5, line: null }, { panel: 1, aspect: '16:9', seconds: 5, line: null }], shotSeconds: 10, introSeconds: 2, outroSeconds: 2, runSeconds: 14, speechChars: 0 } as unknown as import('../lib/video/types').TrailerPlan
        const sentId = crypto.randomUUID()
        const at = new Date()
        let sentRec = markMaking(newVideoRecord({ id: sentId, ownerId: 'user_t8', projectId: 'a-project', plan: shotPlan, now: at }), at)!
        for (const n of [0, 1]) sentRec = markSubmitted(markSubmitting(sentRec, n, at)!, n, `pj${n}`, at)!
        await store.videos.put(sentRec)
        const t2 = await trailer('user_t8', { videoId: sentId })
        console.error = () => {}
        assert.equal(await processJob(t2.job.id, { workerId: 'direct' }), 'failed')
        console.error = quiet
        const stuck = (await store.videos.get(sentId))!
        assert.deepEqual([stuck.status, stuck.shots.map((s) => s.state)], ['failed', ['orphaned', 'orphaned']], 'shots already sent are ended as orphaned, not left animating')
        assert.ok(stuck.costUsd > 0, 'the orphaned shots are counted at the formula’s price')
        assert.ok(queueRetry(stuck, 0, new Date()), 'and Try again can take them')
        assert.equal(ran, 0)
        env.PATH = path
        const again = await trailer('user_t8', { videoId })
        assert.equal(await processJob(again.job.id, { workerId: 'direct' }), 'done', 'with ffmpeg back on the PATH it runs')
        assert.equal(ran, 1)
      } finally {
        env.PATH = path
        console.error = quiet
        videoRunners.trailer = realTrailer
      }
      ok('without ffmpeg a trailer is refused before its runner sends anything: the job and its video record fail with the sentence, and it runs once ffmpeg is back')
      await reset()
    }

    // (e) The inline queue runs a trailer in a lane of its own — not in an image slot, not behind a picture.
    {
      env.INKDESK_QUEUE = 'inline'
      let open!: () => void
      const gate = new Promise<void>((resolve) => (open = resolve))
      videoRunners.trailer = async () => {
        await gate
        return { outcome: 'done' }
      }
      try {
        assert.equal(singletons.videoQueue.concurrency, 1, 'one trailer at a time by default')
        const p = await lockedPage('InlineVideo')
        const a = await trailer('user_oli2')
        const b = await trailer('user_pam2')
        await until('the first trailer to be running', () => singletons.videoQueue.running().length === 1)
        assert.deepEqual(singletons.videoQueue.running(), [a.job.id])
        assert.deepEqual(singletons.videoQueue.waiting(), [b.job.id], 'one at a time')
        assert.deepEqual(singletons.queue.running(), [], 'the image lane is not touched')
        assert.deepEqual(singletons.accountQueue.running(), [], 'nor the account lane')
        // A picture is drawn and lands while the trailer is still running: it does not wait for it, nor does it take its slot.
        assert.equal(await queuePanel(p.addr, 0), true)
        await until('the picture to land beside the running trailer', async () => (await p.read()).script![0].status === 'done')
        assert.deepEqual(singletons.videoQueue.running(), [a.job.id], 'the trailer is still running')
        assert.equal((await store.jobs.getJob(a.job.id))!.status, 'running')
        assert.equal(await bullQueue('video').getJob(a.job.id), undefined, 'and nothing went to Redis')
        open()
        await until('both trailers to finish', async () => (await Promise.all([a, b].map((x) => store.jobs.getJob(x.job.id)))).every((j) => j?.status === 'done'))
        await until('the lane to be free', () => singletons.videoQueue.running().length === 0)
      } finally {
        videoRunners.trailer = realTrailer
        env.INKDESK_QUEUE = 'bullmq'
      }
      ok('INKDESK_QUEUE=inline runs a trailer in the web process in its own lane, one at a time, while a picture lands beside it — never in an image slot, with nothing sent to Redis')
      await reset()
    }
  }

  // 14. Redis down: generate says busy at once, reading keeps working, the status line says why.
  {
    const p = await lockedPage('Down')
    await redis().flushall()
    redisProc?.kill('SIGKILL')
    if (redisProc) await once(redisProc, 'exit')
    else console.log('  --  (using INKDESK_CHECK_REDIS_URL: cannot stop it, so the Redis-down case is skipped)')
    if (redisProc) {
      const t0 = Date.now()
      await quiet(async () => {
        await assert.rejects(queuePanel(p.addr, 0), (e: unknown) => e instanceof Refused && e.status === 503 && e.message === J.BUSY)
      })()
      assert.ok(Date.now() - t0 < 8_000, `refused in ${Date.now() - t0} ms, not a hang`)
      // An account job needs Redis like any other when the queue is Redis: the same sentence, and nothing left to be queued later.
      await quiet(async () => {
        await assert.rejects(enqueueAccountJob({ ownerId: 'user_quinn', kind: 'export' }), (e: unknown) => e instanceof Refused && e.status === 503 && e.message === J.BUSY)
      })()
      assert.deepEqual((await store.jobs.listJobs({ ownerId: 'user_quinn' })).map((j) => [j.status, j.outcome]), [['failed', 'cancelled']], 'the record was ended, so the reconciler never queues it')
      assert.equal((await store.jobs.listJobs({ projectId: p.pid, status: ['queued', 'running'] })).length, 0, 'and it leaves no queued record behind')
      assert.equal((await store.jobs.listJobs({ projectId: p.pid }))[0].outcome, 'cancelled')
      // The route a person presses, and the desk that keeps opening.
      forgetQueueState()
      await quiet(async () => {
        const res = await startRoute.POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ id: p.pid, n: '0' }) })
        assert.equal(res.status, 503)
        assert.deepEqual(await res.json(), { error: J.BUSY })
        const open = await projectRoute.GET(new Request('http://x'), { params: Promise.resolve({ id: p.pid }) })
        assert.equal(open.status, 200, 'reading works with Redis down')
        const desk = (await open.json()) as Chapter
        assert.equal(desk.title, 'Down')
        assert.equal(desk.activity?.queue.state, 'busy')
        assert.equal(desk.activity?.queue.message, J.BUSY)
      })()
      ok('Redis down: generate answers "The studio is busy" at once, leaves nothing queued, and the desk still opens with the status line saying why')
    }
  }
} finally {
  for (const c of children) c.kill('SIGKILL')
  for (const h of handles) await h.close(1_000).catch(() => {})
  await closeQueues().catch(() => {})
  await closeProducerRedis().catch(() => {})
  redisProc?.kill('SIGKILL')
  globalThis.fetch = realFetch
  await rm(dir, { recursive: true, force: true })
}

async function isActiveKey(key: string): Promise<boolean> {
  return (await store.jobs.listJobs({ key, status: ['queued', 'running'] })).length > 0
}

console.log('queue-check: all passed')
process.exit(0)

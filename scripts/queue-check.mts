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
  'MONGODB_URI', 'DB_URL', 'MONGODB_DB', 'DB_DATABASE', 'S3_ENDPOINT', 'S3_PUBLIC_ENDPOINT', 'S3_REGION', 'S3_BUCKET',
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
const { enqueueJob } = await import('../lib/queue/enqueue')
const J = await import('../lib/queue/jobs')
const { bullQueue, closeQueues } = await import('../lib/queue/queues')
const { closeProducerRedis, producerRedis, redisKey } = await import('../lib/queue/redis')
const { startWorker } = await import('../lib/queue/worker')
const { reconcileOnce } = await import('../lib/queue/reconcile')
const { resetBreaker, creditsBreakerOpen } = await import('../lib/queue/breaker')
const { forgetQueueState, queueState, readWithActivity } = await import('../lib/queue/status')
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
  const first = await createProject({ title, stylePresetId: 'manga-bw' })
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
    const s = await createProject({ title: 'Sheet', stylePresetId: 'manga-bw' })
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

  // 13. Redis down: generate says busy at once, reading keeps working, the status line says why.
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

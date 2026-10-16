// Slice 19's ownership check, from `devpost/checklist.md > Slices > 19` and
// `devpost/security-report.md` SEC-01, SEC-06, SEC-11, SEC-12:
//
//   npm run check:ownership
//
// Sign-in in test mode (INKDESK_AUTH=test): two people, user_alice and
// user_bob, name themselves in the `x-inkdesk-test-user` header. On a scratch
// desk with `fetch` stubbed, alice makes a project and pictures are attached
// to it through the store. Then, for EVERY route under `app/api/` — found on
// disk, so a route added later cannot be missed — bob gets the 404 a missing
// project gets, before his body is read, before the generation flag, with no
// provider call and nothing of alice's changed; a caller with no name gets
// 401; alice gets past every one. Bob's listing does not hold alice's
// project; he cannot reach her pictures by her project's image route, by his
// own project's, or by the old `/api/image` route; her spend never reaches
// him; her job is hers. The account records, the v1 migration (off mode
// only) and `scripts/claim-projects.mts` are held here too.
//
// Slice 21 adds three more kinds of route to the walk: a share is its owner's
// (`ownedShare`; bob gets "There is no such share." for alice's, a revoked one
// and one that never was, word for word), the admin routes answer anyone who is
// not an admin with 404 "There is no such page." and never 403, and the public
// share routes (`app/api/s/**`) take no session at all — an unknown token and a
// revoked one answer the same, and an active one hands out nothing of its owner.
//
// The cloud half: with INKDESK_STORAGE=cloud and INKDESK_CHECK_CLOUD=yes the
// same check runs on MongoDB and an S3-compatible bucket — only ones on this
// machine (localhost), on a scratch database dropped at the end, because a
// shell here can carry another app's DB_URL.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = process.env as Record<string, string | undefined>
const CLOUD = env.INKDESK_STORAGE?.trim() === 'cloud'

const ok = (msg: string) => console.log(`  ok  ${msg}`)
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// --- The environment ---------------------------------------------------------------
const CLOUD_NAMES = [
  'MONGODB_URI',
  'DB_URL',
  'MONGODB_DB',
  'DB_DATABASE',
  'S3_ENDPOINT',
  'S3_PUBLIC_ENDPOINT',
  'S3_REGION',
  'S3_BUCKET',
  'S3_BUCKET_PROJECT_FILES',
  'S3_BUCKET_COMPILE_OUTPUTS',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_FORCE_PATH_STYLE',
  'S3_KEY_PREFIX',
]
const SECRET_NAMES = [
  'ANTHROPIC_API_KEY',
  'CLERK_SECRET_KEY',
  'CLERK_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_JWT_KEY',
  'CLERK_WEBHOOK_SIGNING_SECRET',
  'RAILWAY_TOKEN',
  'REDIS_URL',
  'GENERATION_ENABLED',
  'INKDESK_QUEUE',
]

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-ownership-'))
env.INKDESK_DATA_DIR = dir
for (const name of SECRET_NAMES) delete env[name]
let scratchDb: { url: string; name: string } | null = null
if (CLOUD) {
  if (env.INKDESK_CHECK_CLOUD !== 'yes') {
    console.log('  --  the cloud run needs INKDESK_CHECK_CLOUD=yes as well: it writes, and only to a MongoDB and a bucket on this machine')
    process.exit(1)
  }
  // Only stand-ins on this machine: this shell may carry another app's database and bucket.
  const { NAMES } = await import('../lib/config')
  const inEffect = (names: readonly string[]) => names.find((name) => env[name]?.trim())
  const urlVar = inEffect(NAMES.mongoUrl)
  const dbVar = inEffect(NAMES.mongoDb)
  const local = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)
  const mongoHost = (env[urlVar ?? ''] ?? '').replace(/^mongodb:\/\//, '').split(/[/?]/)[0].split('@').pop() ?? ''
  let s3Host = ''
  try {
    s3Host = new URL(env.S3_ENDPOINT ?? '').host
  } catch {}
  if (!urlVar || !dbVar || !local(mongoHost) || !local(s3Host)) {
    console.log('  --  the cloud run writes, so it runs only against a MongoDB and an S3 endpoint on localhost; set both, and the bucket settings, to local stand-ins')
    process.exit(1)
  }
  scratchDb = { url: env[urlVar] as string, name: `${env[dbVar]}-ownership-${crypto.randomUUID().slice(0, 8)}` }
  env[dbVar] = scratchDb.name
} else {
  for (const name of CLOUD_NAMES) delete env[name]
  env.INKDESK_STORAGE = 'local'
}
env.INKDESK_AUTH = 'test'
env.OPENROUTER_API_KEY = 'check-only-never-sent' // fetch is stubbed below; nothing leaves this machine
env.LLM_FALLBACK = 'always'
delete env.NODE_ENV

// --- The stub: every outbound request is recorded and refused -------------------------
const outbound: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  // The cloud run's bucket is on this machine and goes through the SDK's own client, not fetch; nothing else may leave.
  if (CLOUD && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) return realFetch(input, init)
  outbound.push(url)
  throw new Error('the ownership check never reaches a provider')
}) as typeof fetch

// Imported after the env is set, because the store reads it at load.
const { store } = await import('../lib/store')
const { Refused } = await import('../lib/errors')
const { GENERATION_CLOSED } = await import('../lib/generation')
const { ownedJob, ownedProject, ownedShare, assertImageInProject, projectImageIds, NO_SUCH_PROJECT, NO_SUCH_SHARE } = await import('../lib/auth/access')
const { forgetAdmins, NO_SUCH_PAGE } = await import('../lib/auth/admin')
const { imageUrl } = await import('../lib/image-url')
const { enqueueJob } = await import('../lib/queue/enqueue')
const { LOCAL_OWNER, isActive } = await import('../lib/queue/jobs')
const { emptyProject } = await import('../lib/types')
import type { Character, Panel, Project } from '../lib/types'

const ALICE = 'user_alice'
const BOB = 'user_bob'
const SIGN_IN = 'Sign in to use the studio.'
const ALICE_SPEND = 0.4321 // a number nothing else on the desk would print

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
type Reply = { status: number; text: string; json: { error?: string } | null; pulled: number }

/** A body that arrives in chunks with no Content-Length, counting what was pulled. */
function chunked(total = 256 * 1024) {
  const seen = { pulled: 0 }
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        if (seen.pulled >= total) return c.close()
        const chunk = new TextEncoder().encode(seen.pulled === 0 ? '{"a":"' : 'a'.repeat(8 * 1024))
        seen.pulled += chunk.byteLength
        c.enqueue(chunk)
      },
    },
    { highWaterMark: 0 }
  )
  return { stream, seen }
}

/** One call to a handler, as `who` (null: nobody signed in). A non-GET carries a chunked body whose reading is counted. */
async function call(handler: Handler, method: string, params: Record<string, string>, who: string | null, body?: unknown): Promise<Reply> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (who) headers['x-inkdesk-test-user'] = who
  let req: Request
  let seen = { pulled: 0 }
  if (method === 'GET') req = new Request('http://check/api', { method, headers })
  else if (body !== undefined) req = new Request('http://check/api', { method, headers, body: JSON.stringify(body) })
  else {
    const c = chunked()
    seen = c.seen
    req = new Request('http://check/api', { method, headers, body: c.stream, duplex: 'half' } as RequestInit)
  }
  const res = await handler(req, { params: Promise.resolve(params) })
  const text = res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('image/') ? `<${res.headers.get('content-length')} image bytes>` : await res.text()
  let json: Reply['json'] = null
  try {
    json = JSON.parse(text) as Reply['json']
  } catch {}
  return { status: res.status, text, json, pulled: seen.pulled }
}

// --- Every route, from disk ---------------------------------------------------------
type Route = { path: string; params: string[]; methods: Record<string, Handler> }
/** Callable without signing in: the deploy's health check and Clerk's signed webhooks. */
const PUBLIC = (path: string) => path === 'health' || path.startsWith('health/') || path.startsWith('webhooks/')
/** Public by design (slice 21): the share page's data. Held in its own section below — no session, an address window instead. */
const SESSIONLESS = (path: string) => path.startsWith('s/')
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

async function routeFiles(at: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(at, { withFileTypes: true })) {
    const full = join(at, entry.name)
    if (entry.isDirectory()) found.push(...(await routeFiles(full)))
    else if (entry.name === 'route.ts') found.push(full)
  }
  return found
}

const API = join(ROOT, 'app', 'api')
const routes: Route[] = []
const sessionless: Route[] = []
for (const file of (await routeFiles(API)).sort()) {
  const path = relative(API, dirname(file)).split(sep).join('/')
  if (PUBLIC(path)) continue
  const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>
  const methods = Object.fromEntries(METHODS.filter((m) => typeof mod[m] === 'function').map((m) => [m, mod[m] as Handler]))
  const route = { path, params: [...path.matchAll(/\[(\.\.\.)?([^\]]+)\]/g)].map((m) => m[2]), methods }
  if (SESSIONLESS(path)) sessionless.push(route)
  else routes.push(route)
}
assert.ok(routes.some((r) => r.path === 'projects/[id]/image/[imageId]'), 'the owner-checked image route is on disk')

/** A value for each dynamic segment. A segment this check does not know fails it, so a new kind of route is never skipped. */
function paramsFor(route: Route, values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    route.params.map((name) => {
      assert.ok(name in values, `${route.path}: the ownership check has no value for [${name}] — teach it one`)
      return [name, values[name]]
    })
  )
}

// --- A picture and a project with every kind of picture -------------------------------
const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#808080' } }).png().toBuffer()

async function makeOwned(ownerId: string | undefined, title: string): Promise<{ id: string; images: Record<'sheet' | 'panel' | 'cover' | 'asset', string> }> {
  const id = crypto.randomUUID()
  const base = emptyProject({ id, chapterId: crypto.randomUUID(), title, stylePresetId: 'manga-bw', serverRunId: 'check' })
  await store.createProject(ownerId === undefined ? base : { ...base, ownerId })
  const images = {
    sheet: await store.putBlob(png, 'image/png', 'sheet'),
    panel: await store.putBlob(png, 'image/png', 'panel'),
    cover: await store.putBlob(png, 'image/png', 'cover'),
    asset: await store.putBlob(png, 'image/png', 'asset'),
  }
  const at = new Date().toISOString()
  const character: Character = { id: 'c1', name: 'Aki', role: 'lead', traits: [], look: 'tall', dna: 'tall, scar', sheetImageId: images.sheet, locked: true }
  const panel = (index: 0 | 1 | 2 | 3): Panel => ({
    index,
    characterId: 'c1',
    action: 'stands',
    camera: 'wide',
    background: 'street',
    dialogue: '',
    versions: index === 0 ? [{ imageId: images.panel, createdAt: at }] : [],
    currentVersion: 0,
    status: index === 0 ? 'done' : 'empty',
    startedAt: null,
    startedByRun: null,
  })
  await store.updateProject(id, (p: Project) => ({
    ...p,
    ownerId: 'user_mallory', // an edit can never change the owner: the store keeps the one it read
    library: {
      characters: [character],
      assets: [{ id: images.asset, kind: 'reference', name: 'ref', blobId: images.asset, mediaType: 'image/png', bytes: png.length, createdAt: at }],
    },
    chapters: p.chapters.map((c) => ({
      ...c,
      cover: { brief: 'b', title: title, versions: [{ imageId: images.cover, createdAt: at }], currentVersion: 0, status: 'done', startedAt: null, startedByRun: null },
      pages: [{ index: 0, layoutId: 'four-shot', panels: [panel(0), panel(1), panel(2), panel(3)] }],
    })),
    usage: { images: 3, costUsd: ownerId === ALICE ? ALICE_SPEND : 0.01 },
  }))
  return { id, images }
}

/** What alice's project and its records look like — compared after bob has tried everything. */
async function snapshot(projectId: string): Promise<string> {
  const project = await store.readProject(projectId)
  const jobs = await store.jobs.listJobs({ projectId, limit: 1000 })
  const files = CLOUD ? [] : (await readdir(join(dir, 'images')).catch(() => [])).sort()
  return JSON.stringify({ project, jobs, files })
}

async function waitForJobs(projectId: string): Promise<void> {
  const t0 = Date.now()
  while ((await store.jobs.listJobs({ projectId, status: ['queued', 'running'] })).length > 0) {
    if (Date.now() - t0 > 30_000) throw new Error('timed out waiting for the inline queue')
    await sleep(50)
  }
}

let mongoToDrop: { url: string; name: string } | null = scratchDb
if (CLOUD) {
  // The stand-in bucket may be fresh (moto keeps nothing): make it, on localhost only (checked above).
  const { CreateBucketCommand, S3Client } = await import('@aws-sdk/client-s3')
  const { cloudSettings } = await import('../lib/config')
  const settings = cloudSettings()
  const s3 = new S3Client({ endpoint: settings.endpoint, region: settings.region, forcePathStyle: true, credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey } })
  for (const bucket of new Set([settings.projectFilesBucket, settings.outputsBucket])) {
    await s3.send(new CreateBucketCommand({ Bucket: bucket })).catch((e: unknown) => {
      if (!/BucketAlready/.test((e as Error).name)) throw e
    })
  }
  s3.destroy()
}
try {
  // --- 0. The data layer itself ------------------------------------------------------
  const alice = await makeOwned(ALICE, 'Alice’s chapter')
  const bobs = await makeOwned(BOB, 'Bob’s chapter')
  const legacy = await makeOwned(undefined, 'Before accounts')
  const aliceProject = await store.readProject(alice.id)
  assert.equal(aliceProject.ownerId, ALICE, 'an edit cannot change the owner (the store keeps the one it read)')
  assert.equal(aliceProject.usage.costUsd, ALICE_SPEND)
  assert.deepEqual([...projectImageIds(aliceProject)].sort(), Object.values(alice.images).sort(), 'sheets, panel versions, cover versions and uploads are all the project’s pictures')
  for (const id of Object.values(alice.images)) assertImageInProject(aliceProject, id)
  assert.throws(() => assertImageInProject(aliceProject, bobs.images.sheet), (e: unknown) => e instanceof Refused && e.status === 404)
  await ownedProject(ALICE, alice.id)
  for (const [who, id] of [[BOB, alice.id], [ALICE, bobs.id], [ALICE, legacy.id], [BOB, legacy.id], [LOCAL_OWNER, legacy.id], [ALICE, 'no-such-project']] as const) {
    await assert.rejects(ownedProject(who, id), (e: unknown) => e instanceof Refused && e.status === 404 && e.message === NO_SUCH_PROJECT, `${who} → ${id}`)
  }
  const aliceList = await store.listProjects(ALICE)
  assert.deepEqual(aliceList.map((p) => p.id), [alice.id], 'alice lists her project and nothing else')
  assert.equal(aliceList[0].costUsd, ALICE_SPEND, 'her own spend is hers to see')
  assert.deepEqual(aliceList[0].characters.map((c) => c.projectId), [alice.id], 'a library entry carries its project')
  assert.deepEqual((await store.listProjects(BOB)).map((p) => p.id), [bobs.id])
  assert.deepEqual((await store.listProjects(LOCAL_OWNER)).map((p) => p.id), [legacy.id], 'a project with no owner is local’s, nobody else’s')
  assert.deepEqual(await store.migrateLegacy(), { projectId: null, problem: null }, 'no v1 migration with accounts on')
  assert.equal(imageUrl(alice.id, alice.images.sheet), `/api/projects/${alice.id}/image/${alice.images.sheet}`)
  ok(`${CLOUD ? 'cloud' : 'local'} store: projects carry their owner and no edit changes it; listings are per owner; every kind of picture belongs to its project; ownedProject is the missing project’s 404`)

  // A job for alice: queued by an engine that only knows the project, owned by alice all the same.
  const queued = await enqueueJob({ key: `${alice.id}:sheet:nobody`, ownerId: LOCAL_OWNER, projectId: alice.id, kind: 'sheet', payload: { kind: 'sheet', characterId: 'nobody', reuseDna: false, redraw: false } })
  assert.equal(queued.job.ownerId, ALICE, 'a job is its project’s owner’s')
  await waitForJobs(alice.id) // the story is not settled, so it ends refused without a provider call
  const aliceJob = await store.jobs.getJob(queued.job.id)
  assert.ok(aliceJob && !isActive(aliceJob))
  assert.equal((await ownedJob(ALICE, aliceJob.id)).id, aliceJob.id)
  await assert.rejects(ownedJob(BOB, aliceJob.id), (e: unknown) => e instanceof Refused && e.status === 404)
  await assert.rejects(ownedJob(ALICE, 'no-such-job'), (e: unknown) => e instanceof Refused && e.status === 404)
  assert.deepEqual((await store.jobs.listJobs({ ownerId: BOB })).map((j) => j.id), [], 'bob’s jobs hold none of alice’s')
  assert.deepEqual((await store.jobs.listJobs({ ownerId: ALICE })).map((j) => j.id), [aliceJob.id])
  assert.equal(outbound.length, 0)
  ok('jobs carry their project’s owner; ownedJob refuses anyone else with a 404; listJobs filters by owner')

  // A share of alice's (slice 21): one active share per project, addressed by its token alone.
  const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const newToken = () => Array.from(randomBytes(22), (b) => BASE62[b % 62]).join('')
  const shareAt = new Date().toISOString()
  const shareOf = async (ownerId: string, projectId: string, token = newToken()) =>
    (
      await store.shares.create({
        token,
        ownerId,
        kind: 'manga',
        projectId,
        videoId: null,
        snapshot: { kind: 'manga', title: 'A shared chapter', reading: 'rtl', cover: null, pages: [], takenAt: shareAt },
        createdAt: shareAt,
        updatedAt: shareAt,
        revokedAt: null,
      })
    ).share
  let aliceShare = await shareOf(ALICE, alice.id)

  const values = (projectId: string, imageId: string) => ({ id: projectId, n: '0', i: '0', imageId, jobId: aliceJob.id, token: aliceShare.token })
  const before = await snapshot(alice.id)
  const toBob: Reply[] = []

  // --- 1. Nobody signed in: 401 on every route, before the body -----------------------
  let count = 0
  for (const route of routes) {
    for (const [method, handler] of Object.entries(route.methods)) {
      for (const who of [null, 'local', 'user_', 'alice', 'user_alice/../x']) {
        const r = await call(handler, method, paramsFor(route, values(alice.id, alice.images.sheet)), who)
        assert.equal(r.status, 401, `${method} /api/${route.path} as ${who ?? 'nobody'}: ${r.text.slice(0, 160)}`)
        assert.equal(r.json?.error, SIGN_IN, `${method} /api/${route.path}: the one sentence`)
        assert.equal(r.pulled, 0, `${method} /api/${route.path}: the body is not read before sign-in`)
      }
      count++
    }
  }
  assert.equal(outbound.length, 0)
  ok(`no one signed in (or a name that is not an account's) → 401 on all ${count} handlers under app/api/ outside the public allow-list, body unread`)

  // --- 2. Bob, on everything of alice's ------------------------------------------------
  // (The admin routes have an [id] too — a report’s — and their own section below.)
  const owned = routes.filter((r) => (r.params.includes('id') || r.params.includes('jobId')) && !r.path.startsWith('admin/'))
  let tried = 0
  for (const flag of ['false', undefined]) {
    if (flag) env.GENERATION_ENABLED = flag
    else delete env.GENERATION_ENABLED
    for (const route of owned) {
      for (const [method, handler] of Object.entries(route.methods)) {
        // Her project's address with her picture — and, for the image route, bob's own project's address with her picture.
        const attempts = [values(alice.id, alice.images.sheet), values(legacy.id, legacy.images.sheet)]
        if (route.params.includes('imageId')) attempts.push(...Object.values(alice.images).map((img) => values(bobs.id, img)))
        for (const v of attempts) {
          const r = await call(handler, method, paramsFor(route, v), BOB)
          toBob.push(r)
          const label = `${method} /api/${route.path} as bob on ${v.id === bobs.id ? 'his own project with alice’s picture' : v.id === legacy.id ? 'a project with no owner' : 'alice’s'} (GENERATION_ENABLED=${flag ?? 'unset'})`
          assert.equal(r.status, 404, `${label}: ${r.text.slice(0, 160)}`)
          if (r.json) assert.ok(/^There is no such (project|job|image)\.$/.test(r.json.error ?? ''), `${label}: ${r.json.error}`)
          if (route.path.startsWith('projects/[id]') && !route.params.includes('imageId')) assert.equal(r.json?.error, NO_SUCH_PROJECT, `${label}: word for word the missing project's sentence`)
          assert.equal(r.pulled, 0, `${label}: the body is not read`)
          tried++
        }
      }
    }
  }
  delete env.GENERATION_ENABLED
  assert.equal(outbound.length, 0, 'no provider call for bob')
  assert.equal(await snapshot(alice.id), before, 'nothing of alice’s changed: the project, its jobs, the pictures')
  ok(`bob → 404 "${NO_SUCH_PROJECT}" on all ${tried} attempts (every route with a project or job, generation open and closed: the owner is checked before the flag and the body), no provider call, alice’s project untouched`)

  // The old image route: no owner, so nobody gets it with accounts on.
  const oldImage = routes.find((r) => r.path === 'image/[id]')
  if (oldImage) {
    for (const who of [BOB, ALICE]) {
      const r = await call(oldImage.methods.GET, 'GET', { id: alice.images.sheet }, who)
      if (who === BOB) toBob.push(r)
      assert.equal(r.status, 404, `/api/image as ${who}`)
    }
    ok('the old /api/image/<id> answers 404 to everyone signed in, alice included, once accounts are on')
  }

  // Bob's own views: his listing and his project hold nothing of alice's.
  const list = (await import('../app/api/projects/route')) as unknown as Record<'GET' | 'POST', Handler>
  const bobList = await call(list.GET, 'GET', {}, BOB)
  toBob.push(bobList)
  assert.equal(bobList.status, 200)
  assert.deepEqual((JSON.parse(bobList.text) as { projects: { id: string }[] }).projects.map((p) => p.id), [bobs.id], 'bob’s listing is his project only')
  const made = await call(list.POST, 'POST', {}, BOB, { title: 'Bob’s second', stylePresetId: 'manga-bw' })
  toBob.push(made)
  assert.equal(made.status, 200)
  const madeId = (JSON.parse(made.text) as { address: { projectId: string } }).address.projectId
  assert.equal((await store.readProject(madeId)).ownerId, BOB, 'a new project is its creator’s')
  const deskRoute = routes.find((r) => r.path === 'projects/[id]') as Route
  const bobDesk = await call(deskRoute.methods.GET, 'GET', { id: bobs.id }, BOB)
  toBob.push(bobDesk)
  assert.equal(bobDesk.status, 200)
  for (const r of toBob) {
    assert.ok(!r.text.includes(String(ALICE_SPEND)), 'alice’s spend never reaches bob')
    assert.ok(!r.text.includes(alice.id), 'nor her project’s id')
    assert.ok(!Object.values(alice.images).some((img) => r.text.includes(img)), 'nor any of her pictures’ ids')
  }
  assert.ok(toBob.filter((r) => r.status !== 200).every((r) => !r.text.includes('costUsd')), 'no refusal to bob carries a spend at all')
  ok(`bob’s listing and desk are his alone; his new project is his; across ${toBob.length} replies to bob, alice’s spend, project id and picture ids never appear (SEC-11)`)

  // --- 3. Alice gets past every check --------------------------------------------------
  env.GENERATION_ENABLED = 'false' // past the owner check, the closed flag is what stops a paid route: proof of the order
  let passed = 0
  for (const route of owned) {
    for (const [method, handler] of Object.entries(route.methods)) {
      const r = await call(handler, method, paramsFor(route, values(alice.id, alice.images.sheet)), ALICE, method === 'GET' ? undefined : {})
      const label = `${method} /api/${route.path} as alice`
      assert.notEqual(r.status, 401, label)
      assert.ok(!(r.status === 404 && r.json?.error === NO_SUCH_PROJECT), `${label}: ${r.text.slice(0, 160)}`)
      if (r.status === 503) assert.equal(r.json?.error, GENERATION_CLOSED, label)
      passed++
    }
  }
  delete env.GENERATION_ENABLED
  const imageRoute = routes.find((r) => r.path === 'projects/[id]/image/[imageId]') as Route
  for (const [kind, img] of Object.entries(alice.images)) {
    const r = await call(imageRoute.methods.GET, 'GET', { id: alice.id, imageId: img }, ALICE)
    assert.equal(r.status, 200, `alice’s ${kind} picture`)
    assert.equal(r.text, `<${png.length} image bytes>`)
  }
  const aliceDesk = await call(deskRoute.methods.GET, 'GET', { id: alice.id }, ALICE)
  assert.equal(aliceDesk.status, 200)
  assert.equal((JSON.parse(aliceDesk.text) as { costUsd: number }).costUsd, ALICE_SPEND, 'the owner sees her spend')
  const synopsis = routes.find((r) => r.path === 'projects/[id]/synopsis') as Route
  const paid = await call(synopsis.methods.POST, 'POST', { id: alice.id }, ALICE, { pitch: 'A courier and a ghost.', genre: 'Mystery', tone: 'Eerie' })
  assert.ok(outbound.length > 0 && paid.status === 502, 'with generation open, alice’s request reaches the (stubbed) provider')
  const sent = outbound.length
  await waitForJobs(alice.id)
  ok(`alice gets past the sign-in and owner checks on all ${passed} handlers (a paid route then stops at the closed flag), sees every one of her four kinds of picture and her spend, and reaches the provider when generation is open`)

  // --- 3b. Shares, admins and the public routes (slice 21) --------------------------------
  {
    // Section 3 handed alice's own DELETE routes her real share token, which (rightly) unpublished it, and her
    // project-share POST may have made a new one: take whichever is active, or share the project again.
    aliceShare = (await store.shares.activeForProject(alice.id)) ?? (await shareOf(ALICE, alice.id))
    // ownedShare: the owner's active share; everything else is the unknown share’s 404, word for word.
    assert.equal(NO_SUCH_SHARE, 'There is no such share.')
    assert.equal((await ownedShare(ALICE, aliceShare.token)).token, aliceShare.token)
    const missingShare = (e: unknown) => e instanceof Refused && e.status === 404 && e.message === NO_SUCH_SHARE
    await assert.rejects(ownedShare(BOB, aliceShare.token), missingShare, 'bob → alice’s share')
    await assert.rejects(ownedShare(LOCAL_OWNER, aliceShare.token), missingShare, 'with accounts on, `local` owns nothing')
    for (const token of [newToken(), '', 'x', '../../etc/passwd', 'a'.repeat(200)]) await assert.rejects(ownedShare(ALICE, token), missingShare, `unknown or malformed token ${token.slice(0, 12)}`)
    const bobsShare = await shareOf(BOB, bobs.id)
    await assert.rejects(ownedShare(ALICE, bobsShare.token), missingShare, 'alice → bob’s share')
    // A revoked share is dead for its owner’s operations too — unless the caller asks for the revoked record to stay idempotent.
    const doomed = await shareOf(ALICE, (await makeOwned(ALICE, 'Alice’s second')).id)
    await store.shares.revoke(doomed.token, new Date().toISOString())
    await assert.rejects(ownedShare(ALICE, doomed.token), missingShare, 'a revoked share is “no such share” to its own owner')
    const again = await ownedShare(ALICE, doomed.token, { includeRevoked: true })
    assert.deepEqual([again.snapshot, again.revokedAt === null], [null, false], 'includeRevoked hands back the revoked record, snapshot dropped')
    await assert.rejects(ownedShare(BOB, doomed.token, { includeRevoked: true }), missingShare, 'and never to anyone else')
    assert.deepEqual((await store.shares.listActiveOf(ALICE)).map((x) => x.token), [aliceShare.token], 'only the active one lists')
    ok('ownedShare: the owner’s active share; bob’s, local’s, a malformed token’s and an unknown one’s are “There is no such share.”; a revoked share is dead to its owner unless includeRevoked asks for the revoked record (never for anyone else)')

    // The owner-managed routes: bob gets the unknown share’s 404 on alice’s — before his body is read — and alice’s is untouched.
    const shareRoutes = routes.filter((r) => r.path.startsWith('shares/[token]'))
    const shareBefore = JSON.stringify(await store.shares.get(aliceShare.token))
    let sharesTried = 0
    for (const route of shareRoutes) {
      for (const [method, handler] of Object.entries(route.methods)) {
        for (const token of [aliceShare.token, bobsShare.token === aliceShare.token ? '' : newToken(), doomed.token]) {
          const r = await call(handler, method, { token }, BOB, method === 'GET' ? undefined : undefined)
          assert.equal(r.status, 404, `${method} /api/${route.path} as bob on ${token === aliceShare.token ? 'alice’s share' : token === doomed.token ? 'a revoked one' : 'an unknown one'}: ${r.text.slice(0, 160)}`)
          assert.equal(r.json?.error, NO_SUCH_SHARE, `${method} /api/${route.path}: word for word the unknown share’s sentence`)
          assert.equal(r.pulled, 0, `${method} /api/${route.path}: the body is not read`)
          sharesTried++
        }
      }
    }
    assert.equal(JSON.stringify(await store.shares.get(aliceShare.token)), shareBefore, 'alice’s share did not change')
    // Alice gets past the checks on a share of her own, one per method (a DELETE ends it, so each gets its own project and share).
    for (const route of shareRoutes) {
      for (const [method, handler] of Object.entries(route.methods)) {
        const mine = await shareOf(ALICE, (await makeOwned(ALICE, `For ${method}`)).id)
        const r = await call(handler, method, { token: mine.token }, ALICE, method === 'GET' ? undefined : {})
        assert.notEqual(r.status, 401, `${method} /api/${route.path} as alice`)
        assert.ok(!(r.status === 404 && r.json?.error === NO_SUCH_SHARE), `${method} /api/${route.path} as alice: ${r.text.slice(0, 160)}`)
      }
    }
    if (shareRoutes.length === 0) console.log('  --  (no app/api/shares/[token] route on disk yet: the owner-managed share routes were not walked)')
    else ok(`ownedShare is the unknown share’s 404 for bob, for local, for a revoked share, for a malformed token; ${sharesTried} attempts by bob on ${shareRoutes.length} share route${shareRoutes.length === 1 ? '' : 's'} are “${NO_SUCH_SHARE}” with the body unread and nothing changed; alice gets past`)

    // The admin routes: anyone who is not an admin — alice and bob alike — is told there is no such page, never 403; an admin gets past.
    const adminRoutes = routes.filter((r) => r.path.startsWith('admin/'))
    const CAROL = 'user_carol'
    await store.users.upsert({ id: CAROL, email: 'Carol@Example.Invalid', createdAt: shareAt })
    let adminTried = 0
    for (const adminList of [undefined, 'carol@example.invalid']) {
      if (adminList === undefined) delete env.ADMIN_EMAILS
      else env.ADMIN_EMAILS = adminList
      forgetAdmins()
      for (const route of adminRoutes) {
        for (const [method, handler] of Object.entries(route.methods)) {
          const params = paramsFor(route, values(alice.id, alice.images.sheet))
          for (const who of [ALICE, BOB]) {
            const r = await call(handler, method, params, who)
            assert.equal(r.status, 404, `${method} /api/${route.path} as ${who}: ${r.text.slice(0, 160)}`)
            assert.equal(r.json?.error, NO_SUCH_PAGE, `${method} /api/${route.path}: the unknown page’s sentence`)
            assert.equal(r.pulled, 0, `${method} /api/${route.path}: the body is not read`)
            adminTried++
          }
          const carol = await call(handler, method, params, CAROL, method === 'GET' ? undefined : {})
          if (adminList === undefined) assert.deepEqual([carol.status, carol.json?.error], [404, NO_SUCH_PAGE], `${method} /api/${route.path}: with a blank list, carol is nobody`)
          else {
            assert.notEqual(carol.status, 401, `${method} /api/${route.path} as carol`)
            assert.notEqual(carol.json?.error, NO_SUCH_PAGE, `${method} /api/${route.path}: an admin gets past the guard (${carol.status} ${carol.text.slice(0, 120)})`)
          }
        }
      }
    }
    delete env.ADMIN_EMAILS
    forgetAdmins()
    if (adminRoutes.length === 0) console.log('  --  (no app/api/admin route on disk yet: the admin routes were not walked)')
    else ok(`${adminRoutes.length} admin route${adminRoutes.length === 1 ? '' : 's'}: ${adminTried} attempts by non-admins are 404 “${NO_SUCH_PAGE}” (never 403, body unread); with the list set, an admin gets past`)

    // The public routes: no session. An unknown token and a revoked one answer the same; an active share hands out nothing of its owner.
    const revoked = (await store.shares.revoke((await shareOf(ALICE, (await makeOwned(ALICE, 'To be revoked')).id)).token, new Date().toISOString())) as { token: string }
    let publicTried = 0
    const plain = async (handler: Handler, method: string, token: string, route: Route) => {
      const params = Object.fromEntries(route.params.map((name) => [name, name === 'token' ? token : 'img-1.png']))
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      const req = method === 'GET' ? new Request('http://check/api/s', { method, headers }) : new Request('http://check/api/s', { method, headers, body: JSON.stringify({ reason: 'other', note: 'x' }) })
      const res = await handler(req, { params: Promise.resolve(params) })
      return { status: res.status, text: await res.text(), cache: res.headers.get('cache-control') }
    }
    for (const route of sessionless) {
      for (const [method, handler] of Object.entries(route.methods)) {
        const unknown = await plain(handler, method, newToken(), route)
        const dead = await plain(handler, method, revoked.token, route)
        const live = await plain(handler, method, aliceShare.token, route)
        for (const r of [unknown, dead, live]) assert.ok(r.status !== 401 && r.status < 500, `${method} /api/${route.path} takes no session and does not fail: ${r.status} ${r.text.slice(0, 120)}`)
        assert.deepEqual([dead.status, dead.text], [unknown.status, unknown.text], `${method} /api/${route.path}: a revoked token answers exactly like an unknown one`)
        if (method === 'GET') assert.equal(unknown.status, 404, `${method} /api/${route.path}: an unknown token is a 404`)
        for (const text of [unknown.text, dead.text, live.text]) {
          assert.ok(!text.includes(ALICE) && !text.includes(alice.id), `${method} /api/${route.path}: nothing of the owner or the project’s id`)
        }
        publicTried++
      }
    }
    if (sessionless.length === 0) console.log('  --  (no app/api/s route on disk yet: the public share routes were not walked)')
    else ok(`${sessionless.length} public share route${sessionless.length === 1 ? '' : 's'}, ${publicTried} handlers: no session needed, a revoked token answers byte for byte like an unknown one, and neither the owner nor the project’s id is ever in an answer`)
  }

  // --- 4. The account records ----------------------------------------------------------
  const created = '2026-10-14T09:00:00.000Z'
  const first = await store.users.upsert({ id: ALICE, email: 'alice@example.invalid', createdAt: created })
  assert.equal(first.createdAt, created)
  assert.deepEqual(await store.users.upsert({ id: ALICE, email: 'alice@example.invalid', createdAt: '2027-01-01T00:00:00.000Z' }), first, 'a replay changes nothing')
  const moved = await store.users.upsert({ id: ALICE, email: 'alice@new.invalid', createdAt: created })
  assert.equal(moved.email, 'alice@new.invalid')
  assert.equal(moved.createdAt, created)
  assert.deepEqual(await store.users.get(ALICE), moved)
  const gone = await store.users.markDeleted(ALICE)
  assert.ok(gone.deletedAt && gone.email === '', 'a deleted account keeps no email')
  assert.deepEqual(await store.users.markDeleted(ALICE), gone, 'deleting twice keeps the first time')
  assert.deepEqual(await store.users.upsert({ id: ALICE, email: 'alice@again.invalid', createdAt: created }), gone, 'a late creation never revives it')
  const early = await store.users.markDeleted('user_neverseen')
  assert.ok(early.deletedAt)
  assert.ok((await store.users.upsert({ id: 'user_neverseen', email: 'x@example.invalid', createdAt: created })).deletedAt, 'a deletion that arrived first still wins')
  assert.equal(await store.users.get('user_nobody'), null)
  assert.equal(await store.users.get('../projects'), null)
  await assert.rejects(store.users.upsert({ id: '../x', email: '', createdAt: created }), (e: unknown) => e instanceof Refused && e.status === 400)
  await Promise.all(Array.from({ length: 8 }, () => store.users.upsert({ id: 'user_racer', email: 'r@example.invalid', createdAt: created })))
  assert.equal((await store.users.get('user_racer'))?.email, 'r@example.invalid', 'eight deliveries at once leave one account')
  if (!CLOUD) assert.ok((await stat(join(dir, 'users', `${ALICE}.json`))).isFile(), 'data/users/<id>.json')
  ok('users: upsert is idempotent, keeps createdAt, and never revives a deleted account; markDeleted drops the email and keeps its first time; ids are checked')

  // --- 5. scripts/claim-projects.mts -----------------------------------------------------
  const childEnv = (extra: Record<string, string>): NodeJS.ProcessEnv => {
    const e = {} as NodeJS.ProcessEnv
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !SECRET_NAMES.includes(k) && k !== 'INKDESK_AUTH') e[k] = v
    return { ...e, ...extra }
  }
  const claim = (args: string[], extra: Record<string, string> = {}) =>
    spawnSync(process.execPath, ['--import', 'tsx', join(ROOT, 'scripts', 'claim-projects.mts'), ...args], { cwd: ROOT, env: childEnv(extra), encoding: 'utf8', timeout: 120_000 })
  const where = CLOUD ? [] : ['--data-dir', dir]
  const cloudOk: Record<string, string> = CLOUD ? { INKDESK_CLAIM_CONFIRMED: 'yes' } : {}

  const bad = claim(['--owner', 'local', ...where], cloudOk)
  assert.equal(bad.status, 1, 'an owner that is not an account is refused')
  const refused = claim(['--owner', 'user_learner'], { INKDESK_STORAGE: 'cloud', MONGODB_URI: '', DB_URL: '', INKDESK_CLAIM_CONFIRMED: '' })
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /INKDESK_CLAIM_CONFIRMED=yes/, 'cloud is refused without the confirmation')
  const dry = claim(['--owner', 'user_learner', '--dry-run', ...where], cloudOk)
  assert.equal(dry.status, 0, dry.stderr)
  assert.match(dry.stdout, new RegExp(`would claim\\s+${legacy.id}`))
  assert.match(dry.stdout, new RegExp(`left as it is\\s+${alice.id}`))
  assert.equal((await store.readProject(legacy.id)).ownerId, undefined, 'a dry run writes nothing')
  const stolen = claim(['--owner', 'user_learner', '--project', alice.id, ...where], cloudOk)
  assert.equal(stolen.status, 1, 'a project with an owner is never taken')
  assert.equal((await store.readProject(alice.id)).ownerId, ALICE)
  const real = claim(['--owner', 'user_learner', ...where], cloudOk)
  assert.equal(real.status, 0, real.stderr)
  assert.equal((await store.readProject(legacy.id)).ownerId, 'user_learner', 'the project with no owner is the learner’s')
  assert.equal((await store.readProject(bobs.id)).ownerId, BOB)
  await ownedProject('user_learner', legacy.id)
  assert.deepEqual((await store.listProjects('user_learner')).map((p) => p.id), [legacy.id])
  assert.equal(claim(['--owner', 'user_learner', '--project', legacy.id, ...where], cloudOk).status, 0, 'claiming again is a no-op')
  assert.equal(outbound.length, sent, 'nothing else ever left: only alice’s one paid request (and the stub refused it)')
  ok('claim-projects: dry run lists and writes nothing; a project with no owner goes to the account; an owned one is never taken; cloud needs INKDESK_CLAIM_CONFIRMED=yes')

  // --- 6a. A project that can't be read is still nobody else's (S19-BYP-1) -------------------
  {
    const broken = await makeOwned(ALICE, 'Alice’s broken chapter')
    const missingId = crypto.randomUUID()
    assert.equal(await store.projectOwner(broken.id), ALICE)
    assert.equal(await store.projectOwner(missingId), null)
    // A version this build can't read: the project exists, its owner is still on record.
    if (CLOUD && scratchDb) {
      const { MongoClient } = await import('mongodb')
      const client = new MongoClient(scratchDb.url)
      try {
        await client.db(scratchDb.name).collection('projects').updateOne({ _id: broken.id } as object, { $set: { 'project.version': 1 } })
      } finally {
        await client.close()
      }
    } else {
      const file = join(dir, 'projects', broken.id, 'project.json')
      await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), version: 1 }))
      await rm(join(dir, 'projects', broken.id, 'project.json.bak'), { force: true })
    }
    const unreadable = (e: unknown) => e instanceof Refused && e.status === 500
    const missing = (e: unknown) => e instanceof Refused && e.status === 404 && e.message === NO_SUCH_PROJECT
    await assert.rejects(ownedProject(ALICE, broken.id), unreadable, 'its owner hears that it can’t be read')
    await assert.rejects(ownedProject(BOB, broken.id), missing, 'anyone else gets the missing project’s 404')
    const sameAsMissing = async () => {
      const byPath = (path: string) => routes.find((r) => r.path === path) as Route
      for (const [route, params] of [
        [byPath('projects/[id]'), (id: string) => ({ id })],
        [byPath('projects/[id]/image/[imageId]'), (id: string) => ({ id, imageId: broken.images.sheet })],
      ] as const) {
        const theirs = await call(route.methods.GET, 'GET', params(broken.id), BOB)
        const none = await call(route.methods.GET, 'GET', params(missingId), BOB)
        assert.equal(theirs.status, 404, `${route.path}: bob on alice’s unreadable project`)
        assert.deepEqual([theirs.status, theirs.text], [none.status, none.text], `${route.path}: word for word a missing project`)
      }
    }
    await sameAsMissing()
    if (!CLOUD) {
      // As the review found it: half a file and no backup. Nobody's name survives, so it is nobody's to open.
      const file = join(dir, 'projects', broken.id, 'project.json')
      const text = await readFile(file, 'utf8')
      await writeFile(file, text.slice(0, text.length >> 1))
      await assert.rejects(ownedProject(BOB, broken.id), missing)
      await sameAsMissing()
    }
    assert.equal(outbound.length, sent, 'and nothing left the machine')
    ok('a project that can’t be read: its owner hears so (500); to anyone else it is the missing project’s 404, word for word, on the project and image routes')
  }

  // --- 6. The owner index (cloud) ---------------------------------------------------------
  if (CLOUD && scratchDb) {
    const { MongoClient } = await import('mongodb')
    const { ownerFilter } = await import('../lib/store/cloud')
    const client = new MongoClient(scratchDb.url)
    try {
      const projects = client.db(scratchDb.name).collection('projects')
      const plan = (await projects.find(ownerFilter(ALICE) as object).sort({ 'project.updatedAt': -1 }).explain()) as { queryPlanner: unknown }
      assert.match(JSON.stringify((plan.queryPlanner as { winningPlan: unknown }).winningPlan), /owner_updatedAt/, 'the listing uses the owner index')
      const legacyPlan = (await projects.find(ownerFilter(LOCAL_OWNER) as object).sort({ 'project.updatedAt': -1 }).explain()) as { queryPlanner: unknown }
      assert.match(JSON.stringify((legacyPlan.queryPlanner as { winningPlan: unknown }).winningPlan), /owner_updatedAt/, 'so does local’s, missing owner included')
    } finally {
      await client.close()
    }
    ok('cloud: the dashboard’s listing is an indexed filter on project.ownerId (SEC-12)')
  }

  console.log(`\n  Ownership check passed (${CLOUD ? 'cloud' : 'local'} store).\n`)
} finally {
  if (CLOUD) {
    await (await import('../lib/store/cloud')).closeCloud()
    if (mongoToDrop) {
      const { MongoClient } = await import('mongodb')
      const client = new MongoClient(mongoToDrop.url)
      await client.db(mongoToDrop.name).dropDatabase().catch(() => {})
      await client.close()
      mongoToDrop = null
    }
  }
  await rm(dir, { recursive: true, force: true })
}
process.exit(0)

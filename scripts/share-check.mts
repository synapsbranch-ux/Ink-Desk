// Slice 21's acceptance check, from `devpost/checklist.md > Slices > 21` and
// `devpost/prd.md > Sharing (v3) / Report (v3) / Settings (v3) / Safety (v3)`:
//
//   npm run check:share
//
// On a scratch desk (INKDESK_DATA_DIR in a temp folder, every real credential
// unset, `fetch` stubbed so nothing can leave) the sections below hold the
// slice one at a time. The file is built in numbered sections so the next
// agent adds its own below the marker at the bottom without touching these:
//
//   STORE LAYER (this file's first half)
//   1  shares        create is atomic and idempotent per project, even across
//                    processes; get / activeForProject / listActiveOf and their
//                    order; refresh touches only active shares; revoke drops the
//                    snapshot, is idempotent, and a revoked token is never
//                    active; a project can be shared again after a revoke with a
//                    NEW token; video shares; deleteAllOf
//   2  reports       add / list / get / markHandled / deleteForTokens
//   3  settings      put / get / delete, ids checked
//   4  videos        put / get / listOf / deleteAllOf
//   5  outputs       put (bytes, a stream, a temp file) / open / list / delete /
//                    deletePrefix, and every hostile key refused
//   6  jobs          deleteJob / deleteJobsOf with its exception
//   7  projects      deleteProject, projectStamp, projectsOf (a damaged project
//                    included)
//
// The cloud half: with INKDESK_STORAGE=cloud and INKDESK_CHECK_CLOUD=yes the
// same sections run on MongoDB and an S3-compatible bucket — only ones on this
// machine (localhost), on a scratch database dropped at the end, because a
// shell here can carry another app's DB_URL. Assertions about files on disk run
// on the local store only.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = process.env as Record<string, string | undefined>
const CLOUD = env.INKDESK_STORAGE?.trim() === 'cloud'

const ok = (msg: string) => console.log(`  ok  ${msg}`)
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 128 random bits in base62, the way the app makes a share token. */
function newToken(): string {
  const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  const base = BigInt(62)
  const zero = BigInt(0)
  let n = BigInt(`0x${randomBytes(16).toString('hex')}`)
  let out = ''
  while (n > zero) {
    out = digits[Number(n % base)] + out
    n /= base
  }
  return out.padStart(22, '0')
}

// --- A child process that races the parent's creates (local store only) ---------------
// The parent starts three of these at once on one scratch folder; each creates
// shares for one project from its own tokens and says what it was told.
if (env.SHARE_CHECK_CHILD === 'create') {
  const { store } = await import('../lib/store')
  const projectId = env.SHARE_CHECK_PROJECT as string
  const told = await Promise.all(
    Array.from({ length: Number(env.SHARE_CHECK_N ?? 8) }, async () => {
      const at = new Date().toISOString()
      const { share, created } = await store.shares.create({ token: newToken(), ownerId: 'user_alice', kind: 'manga', projectId, videoId: null, snapshot: null, createdAt: at, updatedAt: at, revokedAt: null })
      return { token: share.token, created }
    })
  )
  console.log(JSON.stringify(told))
  process.exit(0)
}

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
  'OPENROUTER_API_KEY',
  'CLERK_SECRET_KEY',
  'CLERK_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_JWT_KEY',
  'CLERK_WEBHOOK_SIGNING_SECRET',
  'RAILWAY_TOKEN',
  'REDIS_URL',
  'GENERATION_ENABLED',
  'INKDESK_QUEUE',
  'ADMIN_EMAILS',
  'APP_URL',
]

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-share-'))
env.INKDESK_DATA_DIR = dir
for (const name of SECRET_NAMES) delete env[name]
let scratchDb: { url: string; name: string } | null = null
if (CLOUD) {
  if (env.INKDESK_CHECK_CLOUD !== 'yes') {
    console.log('  --  the cloud run needs INKDESK_CHECK_CLOUD=yes as well: it writes, and only to a MongoDB and a bucket on this machine')
    await rm(dir, { recursive: true, force: true })
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
    await rm(dir, { recursive: true, force: true })
    process.exit(1)
  }
  scratchDb = { url: env[urlVar] as string, name: `${env[dbVar]}-share-${crypto.randomUUID().slice(0, 8)}` }
  env[dbVar] = scratchDb.name
} else {
  for (const name of CLOUD_NAMES) delete env[name]
  env.INKDESK_STORAGE = 'local'
}
env.INKDESK_AUTH = 'test'
delete env.NODE_ENV

// --- The stub: every outbound request is recorded and refused -------------------------
const outbound: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  // The cloud run's bucket is on this machine and goes through the SDK's own client, not fetch; nothing else may leave.
  if (CLOUD && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) return realFetch(input, init)
  outbound.push(url)
  throw new Error('the share check never reaches a provider')
}) as typeof fetch

// Imported after the env is set, because the store reads it at load.
const { store } = await import('../lib/store')
const { emptyProject } = await import('../lib/types')
const { LOCAL_OWNER } = await import('../lib/queue/jobs')
import type { JobRecord } from '../lib/queue/jobs'
import type { MangaSnapshot, ReportRecord, ShareRecord, UserSettings, VideoRecord } from '../lib/share/types'

const ALICE = 'user_alice'
const BOB = 'user_bob'
const T0 = Date.parse('2026-10-16T09:00:00.000Z')
/** A clock the check controls: `at(0)` is the start, each step a second later. */
const at = (n: number) => new Date(T0 + n * 1000).toISOString()
const UNIQUE_TITLE = 'Zebra-Quartz Morning Edition'

function snapshotOf(title: string, pages = 1): MangaSnapshot {
  return {
    kind: 'manga',
    title,
    reading: 'rtl',
    cover: { imageId: 'cover-00000000-0000-0000-0000-000000000001.png', title },
    pages: Array.from({ length: pages }, (_, index) => ({
      index,
      panels: [0, 1, 2, 3].map((p) => ({
        imageId: `panel-00000000-0000-0000-0000-00000000000${p}.png`,
        dialogue: `Line ${p}`,
        bubble: p === 0 ? { x: 5, y: 5, w: 40, h: 20, tailX: 20, tailY: 40 } : null,
        speaker: p === 0 ? 'Aki' : null,
        shot: 'wide',
      })),
    })),
    takenAt: at(0),
  }
}

function shareOf(over: Partial<ShareRecord> & { projectId: string | null }): ShareRecord {
  return {
    token: newToken(),
    ownerId: ALICE,
    kind: over.projectId === null ? 'video' : 'manga',
    videoId: null,
    snapshot: over.projectId === null ? { kind: 'video', title: 'Trailer', posterImageId: null, seconds: 12, takenAt: at(0) } : snapshotOf(UNIQUE_TITLE),
    createdAt: at(0),
    updatedAt: at(0),
    revokedAt: null,
    ...over,
  }
}

const projectIdOf = () => `proj-${crypto.randomUUID().slice(0, 8)}`
const fileCount = async (sub: string) => (await readdir(join(dir, sub)).catch(() => [] as string[])).filter((n) => n.endsWith('.json')).length

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
const where = CLOUD ? 'cloud' : 'local'

try {
  // =====================================================================================
  // 1. Shares
  // =====================================================================================
  {
    // 1a. Twenty creates for one project, all at once: exactly one share, one token told to all.
    const project = projectIdOf()
    const callers = Array.from({ length: 20 }, () => shareOf({ projectId: project }))
    const results = await Promise.all(callers.map((record) => store.shares.create(record)))
    assert.equal(results.filter((r) => r.created).length, 1, 'exactly one of twenty creates wrote')
    assert.equal(new Set(results.map((r) => r.share.token)).size, 1, 'every caller was told the same token')
    const winner = results.find((r) => r.created)
    assert.ok(winner && callers.some((c) => c.token === winner.share.token), 'the token is one a caller offered')
    assert.equal((await store.shares.activeForProject(project))?.token, winner.share.token)
    assert.deepEqual((await store.shares.listActiveOf(ALICE)).filter((s) => s.projectId === project).map((s) => s.token), [winner.share.token], 'one active share in the listing')
    // Asking again is the same answer, still not a second share.
    const again = await store.shares.create(shareOf({ projectId: project }))
    assert.deepEqual([again.created, again.share.token], [false, winner.share.token])
    if (!CLOUD) {
      assert.equal(await fileCount('shares'), 1, 'one file on disk')
      assert.deepEqual((await readdir(join(dir, 'shares'))).filter((n) => !n.endsWith('.json') && !n.startsWith('.')), [], 'no stray temp file')
    }
    ok(`${where} shares: 20 parallel creates for one project → one share, one token for every caller; asking again changes nothing`)

    // 1a'. And across processes: three children at once, eight creates each, on one folder.
    if (!CLOUD) {
      const second = projectIdOf()
      const spawned = Array.from({ length: 3 }, () =>
        new Promise<{ token: string; created: boolean }[]>((resolve, reject) => {
          const child = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'scripts', 'share-check.mts')], {
            cwd: ROOT,
            env: { ...process.env, SHARE_CHECK_CHILD: 'create', SHARE_CHECK_PROJECT: second, SHARE_CHECK_N: '8' },
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          let out = ''
          let err = ''
          child.stdout.on('data', (d: Buffer) => (out += d))
          child.stderr.on('data', (d: Buffer) => (err += d))
          child.on('close', (code) => (code === 0 ? resolve(JSON.parse(out.trim().split('\n').pop() ?? '[]') as { token: string; created: boolean }[]) : reject(new Error(`child exited ${code}: ${err}`))))
        })
      )
      const told = (await Promise.all(spawned)).flat()
      assert.equal(told.length, 24)
      assert.equal(told.filter((t) => t.created).length, 1, 'exactly one of 24 creates, from three processes, wrote')
      assert.equal(new Set(told.map((t) => t.token)).size, 1, 'all three processes were told the same token')
      assert.equal((await store.shares.activeForProject(second))?.token, told[0].token)
      assert.equal(await fileCount('shares'), 2)
      ok('local shares: 24 creates from three processes at once → one share (the folder lock holds across processes)')
    }

    // 1b. get / activeForProject / listActiveOf, and their order.
    const [p1, p2, p3, p4] = [projectIdOf(), projectIdOf(), projectIdOf(), projectIdOf()]
    const s1 = shareOf({ projectId: p1, ownerId: BOB, createdAt: at(10), updatedAt: at(10) })
    const s2 = shareOf({ projectId: p2, ownerId: BOB, createdAt: at(30), updatedAt: at(30) })
    const s3 = shareOf({ projectId: p3, ownerId: BOB, createdAt: at(20), updatedAt: at(20) })
    const other = shareOf({ projectId: p4, ownerId: 'user_carol', createdAt: at(40), updatedAt: at(40) })
    for (const record of [s1, s2, s3, other]) assert.equal((await store.shares.create(record)).created, true)
    assert.deepEqual((await store.shares.listActiveOf(BOB)).map((s) => s.token), [s2.token, s3.token, s1.token], 'newest first')
    assert.deepEqual((await store.shares.listActiveOf('user_carol')).map((s) => s.token), [other.token], 'only the owner’s')
    assert.deepEqual(await store.shares.listActiveOf('user_nobody'), [])
    assert.deepEqual(await store.shares.get(s1.token), s1, 'what was written is what is read')
    assert.equal((await store.shares.activeForProject(p3))?.token, s3.token)
    assert.equal(await store.shares.activeForProject(projectIdOf()), null)
    assert.equal(await store.shares.get(newToken()), null, 'an unknown token')
    for (const hostile of ['', '..', '../etc/passwd', 'a/b', 'a b', 'x'.repeat(200), '{"$ne":""}', 'user_alice']) {
      assert.equal(await store.shares.get(hostile), null, `get(${JSON.stringify(hostile)}) names nothing`)
      assert.equal(await store.shares.revoke(hostile, at(1)), null)
      assert.equal(await store.shares.refresh(hostile, snapshotOf('x'), at(1)), null)
    }
    // Equal times: a stable order, not luck.
    const tieA = shareOf({ projectId: projectIdOf(), ownerId: 'user_dave', createdAt: at(50) })
    const tieB = shareOf({ projectId: projectIdOf(), ownerId: 'user_dave', createdAt: at(50) })
    await store.shares.create(tieA)
    await store.shares.create(tieB)
    assert.deepEqual((await store.shares.listActiveOf('user_dave')).map((s) => s.token), [tieA.token, tieB.token].sort().reverse(), 'a tie falls back to the token, newest-first')
    // A token already taken is an error, never an overwrite.
    await assert.rejects(store.shares.create({ ...shareOf({ projectId: projectIdOf() }), token: s1.token }), /already taken/)
    assert.deepEqual(await store.shares.get(s1.token), s1, 'the share that held the token is untouched')
    await assert.rejects(store.shares.create({ ...shareOf({ projectId: projectIdOf() }), token: '../escape' }), /Not a share token/)
    ok(`${where} shares: get / activeForProject / listActiveOf (newest first, per owner, ties stable); an unknown or hostile token names nothing; a taken token is refused`)

    // 1c. refresh touches only active shares.
    const fresher = snapshotOf(`${UNIQUE_TITLE} — updated`, 2)
    const refreshed = await store.shares.refresh(s1.token, fresher, at(100))
    assert.ok(refreshed)
    assert.deepEqual(refreshed.snapshot, fresher)
    assert.equal(refreshed.updatedAt, at(100))
    assert.equal(refreshed.createdAt, at(10), 'createdAt is the first publishing')
    assert.equal(refreshed.token, s1.token)
    assert.equal(refreshed.revokedAt, null)
    assert.deepEqual(await store.shares.get(s1.token), refreshed)
    assert.deepEqual((await store.shares.listActiveOf(BOB)).map((s) => s.token), [s2.token, s3.token, s1.token], 'a refresh does not reorder the listing (it orders by createdAt)')
    assert.equal(await store.shares.refresh(newToken(), fresher, at(101)), null, 'an unknown token')
    ok(`${where} shares: refresh replaces the snapshot and updatedAt of an active share and nothing else`)

    // 1d. revoke.
    const revoked = await store.shares.revoke(s1.token, at(200))
    assert.ok(revoked)
    assert.equal(revoked.snapshot, null, 'nothing of the work remains')
    assert.equal(revoked.revokedAt, at(200))
    assert.equal(revoked.updatedAt, at(200))
    assert.deepEqual([revoked.token, revoked.ownerId, revoked.projectId, revoked.createdAt], [s1.token, BOB, p1, at(10)])
    assert.deepEqual(await store.shares.get(s1.token), revoked, 'a revoked share is still there to be told no')
    assert.equal(await store.shares.activeForProject(p1), null, 'a revoked token is never active')
    assert.deepEqual((await store.shares.listActiveOf(BOB)).map((s) => s.token), [s2.token, s3.token], 'nor listed')
    const second = await store.shares.revoke(s1.token, at(300))
    assert.deepEqual(second, revoked, 'revoking twice: the first time stands')
    assert.equal(await store.shares.revoke(newToken(), at(300)), null, 'an unknown token')
    assert.equal(await store.shares.refresh(s1.token, snapshotOf('Back from the dead'), at(400)), null, 'a revoked share is never refreshed')
    const afterRefresh = await store.shares.get(s1.token)
    assert.deepEqual(afterRefresh, revoked, 'and stays exactly as revoked')
    if (!CLOUD) {
      const raw = await readFile(join(dir, 'shares', `${s1.token}.json`), 'utf8')
      assert.ok(!raw.includes(UNIQUE_TITLE) && !raw.includes('panel-0000') && !raw.includes('Line 1'), 'the file holds no title, picture or dialogue')
    }
    // Twenty revokes at once: still one revocation, one time.
    const racers = await Promise.all(Array.from({ length: 20 }, (_, i) => store.shares.revoke(s2.token, at(500 + i))))
    assert.equal(new Set(racers.map((r) => r?.revokedAt)).size, 1, 'twenty revokes at once leave one revocation time')
    ok(`${where} shares: revoke drops the snapshot, is idempotent (the first time stands), frees nothing else, and a revoked token is neither active, listed nor refreshable`)

    // 1e. The project can be shared again — under a NEW token; the old one stays dead.
    const reshared = await store.shares.create(shareOf({ projectId: p1, ownerId: BOB, createdAt: at(600), updatedAt: at(600) }))
    assert.equal(reshared.created, true, 'after a revoke the project is free to be shared')
    assert.notEqual(reshared.share.token, s1.token, 'under a new token')
    assert.equal((await store.shares.activeForProject(p1))?.token, reshared.share.token)
    assert.equal((await store.shares.get(s1.token))?.revokedAt, at(200), 'the old token is still revoked')
    assert.equal((await store.shares.get(s1.token))?.snapshot, null)
    // The project holds an active share, so a create is the idempotent answer, whatever token it offers…
    const offered = await store.shares.create({ ...shareOf({ projectId: p1, ownerId: BOB }), token: s1.token })
    assert.deepEqual([offered.created, offered.share.token], [false, reshared.share.token])
    // …and a dead token is refused for any project that is free: it is never handed out again.
    await assert.rejects(store.shares.create({ ...shareOf({ projectId: projectIdOf(), ownerId: BOB }), token: s1.token }), /already taken/, 'a revoked token is never handed out again')
    assert.equal((await store.shares.get(s1.token))?.revokedAt, at(200), 'the refused re-use changed nothing')
    assert.equal((await store.shares.activeForProject(p1))?.token, reshared.share.token)
    // Revoke the new one and share a third time: a third token.
    await store.shares.revoke(reshared.share.token, at(700))
    const third = await store.shares.create(shareOf({ projectId: p1, ownerId: BOB, createdAt: at(800) }))
    assert.equal(third.created, true)
    assert.equal(new Set([s1.token, reshared.share.token, third.share.token]).size, 3)
    ok(`${where} shares: after a revoke the project can be shared again with a new token (three shares → three tokens, two dead)`)

    // 1f. A video share (slice 22 makes them): no project to hold it, so two exist side by side; the store copes.
    const v1 = shareOf({ projectId: null, ownerId: 'user_erin', videoId: 'video-1', createdAt: at(1) })
    const v2 = shareOf({ projectId: null, ownerId: 'user_erin', videoId: 'video-2', createdAt: at(2) })
    assert.equal((await store.shares.create(v1)).created, true)
    assert.equal((await store.shares.create(v2)).created, true)
    assert.deepEqual((await store.shares.listActiveOf('user_erin')).map((s) => s.token), [v2.token, v1.token])
    assert.equal(await store.shares.activeForProject(''), null)
    assert.equal((await store.shares.revoke(v1.token, at(3)))?.snapshot, null)
    assert.deepEqual((await store.shares.listActiveOf('user_erin')).map((s) => s.token), [v2.token])
    ok(`${where} shares: video shares (no project) are created, listed and revoked like the rest`)

    // 1g. deleteAllOf: every share the owner has, active or revoked, and no one else's.
    const mine = await store.shares.listActiveOf(BOB)
    const gone = await store.shares.deleteAllOf(BOB)
    assert.deepEqual(gone, [s1.token, s2.token, s3.token, reshared.share.token, third.share.token].sort(), 'the revoked ones go too')
    assert.deepEqual(await store.shares.listActiveOf(BOB), [])
    for (const token of gone) assert.equal(await store.shares.get(token), null, 'gone is gone')
    assert.ok(mine.length > 0)
    assert.ok(await store.shares.get(other.token), 'carol’s share is untouched')
    assert.deepEqual(await store.shares.deleteAllOf(BOB), [], 'deleting again finds nothing')
    assert.deepEqual(await store.shares.deleteAllOf('user_nobody'), [])
    ok(`${where} shares: deleteAllOf removes the owner’s shares, revoked ones included, and no one else’s`)
  }

  // =====================================================================================
  // 2. Reports
  // =====================================================================================
  {
    const report = (n: number, over: Partial<ReportRecord> = {}): ReportRecord => ({
      id: crypto.randomUUID(),
      token: `tok${n % 2}`.padEnd(22, 'x'),
      reason: 'other',
      note: `note ${n}`,
      ipHash: `hash-${n}`,
      at: at(n),
      handledAt: null,
      ...over,
    })
    const [r1, r2, r3, r4] = [report(1), report(2, { reason: 'harmful' }), report(3, { handledAt: at(30) }), report(4)]
    await Promise.all([r1, r2, r3, r4].map((r) => store.reports.add(r)))
    assert.deepEqual((await store.reports.list()).map((r) => r.id), [r4.id, r3.id, r2.id, r1.id], 'newest first')
    assert.deepEqual((await store.reports.list({ unhandledOnly: true })).map((r) => r.id), [r4.id, r2.id, r1.id], 'unhandled only')
    assert.deepEqual((await store.reports.list({ limit: 2 })).map((r) => r.id), [r4.id, r3.id])
    assert.deepEqual((await store.reports.list({ limit: 2, unhandledOnly: true })).map((r) => r.id), [r4.id, r2.id])
    assert.equal((await store.reports.list({ limit: 0 })).length, 1, 'a limit is at least one')
    assert.equal((await store.reports.list({ limit: Number.NaN })).length, 4, 'a limit that is not a number is the default')
    assert.deepEqual(await store.reports.get(r2.id), r2)
    assert.equal(await store.reports.get(crypto.randomUUID()), null)
    assert.equal(await store.reports.get('../x'), null)
    await assert.rejects(store.reports.add(r1), /already taken/, 'a report id is never overwritten')
    await assert.rejects(store.reports.add({ ...r1, id: '../x' }), /Not a report id/)
    const handled = await store.reports.markHandled(r2.id, at(40))
    assert.equal(handled?.handledAt, at(40))
    assert.deepEqual({ ...handled, handledAt: null }, { ...r2, handledAt: null }, 'only handledAt changes')
    assert.equal((await store.reports.markHandled(r2.id, at(99)))?.handledAt, at(40), 'handling twice: the first time stands')
    assert.equal((await store.reports.markHandled(r3.id, at(99)))?.handledAt, at(30), 'an already-handled report keeps its time')
    assert.equal(await store.reports.markHandled(crypto.randomUUID(), at(1)), null)
    assert.equal(await store.reports.markHandled('../x', at(1)), null)
    assert.deepEqual((await store.reports.list({ unhandledOnly: true })).map((r) => r.id), [r4.id, r1.id])
    ok(`${where} reports: add / list (newest first, unhandled only, limit) / get / markHandled (the first time stands); an id is never overwritten`)

    // deleteForTokens: every report about those tokens, and only those.
    const t0 = `tok0`.padEnd(22, 'x')
    const t1 = `tok1`.padEnd(22, 'x')
    assert.equal(await store.reports.deleteForTokens([]), 0)
    assert.equal(await store.reports.deleteForTokens([newToken()]), 0)
    assert.equal(await store.reports.deleteForTokens([t0]), 2, 'tok0 had two')
    assert.deepEqual((await store.reports.list()).map((r) => r.token), [t1, t1])
    assert.equal(await store.reports.deleteForTokens([t0, t1, t1]), 2)
    assert.deepEqual(await store.reports.list(), [])
    if (!CLOUD) assert.equal(await fileCount('reports'), 0)
    ok(`${where} reports: deleteForTokens removes the reports about those shares, and says how many`)
  }

  // =====================================================================================
  // 3. Settings
  // =====================================================================================
  {
    const mine: UserSettings = { userId: ALICE, defaultStyle: 'manhwa-colour', readingDirection: 'ltr', voices: { lead: 'v-lead' }, updatedAt: at(1) }
    assert.equal(await store.settings.get(ALICE), null, 'none before the first save')
    await store.settings.put(mine)
    assert.deepEqual(await store.settings.get(ALICE), mine)
    const next: UserSettings = { userId: ALICE, defaultStyle: null, readingDirection: 'rtl', updatedAt: at(2) }
    await store.settings.put(next)
    assert.deepEqual(await store.settings.get(ALICE), next, 'the last put wins, whole')
    await store.settings.put({ userId: BOB, defaultStyle: 'manga-bw', readingDirection: 'rtl', updatedAt: at(3) })
    await store.settings.put({ userId: LOCAL_OWNER, defaultStyle: 'manga-bw', readingDirection: 'rtl', updatedAt: at(3) })
    assert.deepEqual(await store.settings.get(ALICE), next, 'bob’s save is not alice’s')
    assert.ok(await store.settings.get(LOCAL_OWNER), 'the desk without accounts has defaults too')
    await Promise.all(Array.from({ length: 10 }, (_, i) => store.settings.put({ userId: 'user_racer', defaultStyle: null, readingDirection: i % 2 ? 'ltr' : 'rtl', updatedAt: at(10 + i) })))
    const raced = await store.settings.get('user_racer')
    assert.ok(raced && ['ltr', 'rtl'].includes(raced.readingDirection), 'ten saves at once leave one whole record')
    await assert.rejects(store.settings.put({ ...next, userId: '../x' }), (e: unknown) => (e as { status?: number }).status === 400)
    assert.equal(await store.settings.get('../projects'), null)
    await store.settings.delete(ALICE)
    assert.equal(await store.settings.get(ALICE), null)
    await store.settings.delete(ALICE) // again: nothing to remove, nothing wrong
    await store.settings.delete('../x')
    assert.ok(await store.settings.get(BOB), 'deleting one person’s leaves the others')
    if (!CLOUD) assert.ok((await stat(join(dir, 'settings', `${BOB}.json`))).isFile(), 'data/settings/<userId>.json')
    ok(`${where} settings: put / get / delete are whole-record and per person; ids are checked; deleting twice is fine`)
  }

  // =====================================================================================
  // 4. Videos
  // =====================================================================================
  {
    const video = (n: number, ownerId = ALICE, over: Partial<VideoRecord> = {}): VideoRecord => ({
      id: crypto.randomUUID(),
      ownerId,
      projectId: 'proj-x',
      page: 0,
      status: 'queued',
      seconds: 12,
      costUsd: 0,
      posterKey: null,
      finalKey: null,
      error: null,
      createdAt: at(n),
      updatedAt: at(n),
      ...over,
    })
    const [a1, a2, a3, b1] = [video(1), video(3), video(2), video(4, BOB)]
    for (const v of [a1, a2, a3, b1]) await store.videos.put(v)
    assert.deepEqual(await store.videos.get(a1.id), a1)
    assert.equal(await store.videos.get(crypto.randomUUID()), null)
    assert.equal(await store.videos.get('../x'), null)
    assert.deepEqual((await store.videos.listOf(ALICE)).map((v) => v.id), [a2.id, a3.id, a1.id], 'newest first, her own only')
    assert.deepEqual((await store.videos.listOf(BOB)).map((v) => v.id), [b1.id])
    assert.deepEqual(await store.videos.listOf('user_nobody'), [])
    const done = { ...a1, status: 'done' as const, finalKey: `videos/${ALICE}/${a1.id}/final.mp4`, updatedAt: at(9) }
    await store.videos.put(done)
    assert.deepEqual(await store.videos.get(a1.id), done, 'put replaces the record whole')
    assert.equal((await store.videos.listOf(ALICE)).length, 3, 'and does not add one')
    await assert.rejects(store.videos.put({ ...a1, id: '../x' }), /Not a video id/)
    const taken = await store.videos.deleteAllOf(ALICE)
    assert.deepEqual(taken.map((v) => v.id).sort(), [a1.id, a2.id, a3.id].sort())
    assert.equal(taken.find((v) => v.id === a1.id)?.finalKey, done.finalKey, 'the records come back, so their files can be deleted')
    assert.deepEqual(await store.videos.listOf(ALICE), [])
    assert.deepEqual((await store.videos.listOf(BOB)).map((v) => v.id), [b1.id], 'bob’s is untouched')
    assert.deepEqual(await store.videos.deleteAllOf(ALICE), [])
    ok(`${where} videos: put / get / listOf (newest first, per owner) / deleteAllOf hands the records back`)
  }

  // =====================================================================================
  // 5. Outputs
  // =====================================================================================
  {
    const read = async (key: string): Promise<Buffer | null> => {
      const opened = await store.outputs.open(key)
      return opened ? Buffer.from(await new Response(opened.body).arrayBuffer()) : null
    }
    const key1 = `exports/${ALICE}/job-1.zip`

    // Bytes.
    const bytes = randomBytes(5000)
    assert.deepEqual(await store.outputs.put(key1, bytes, 'application/zip'), { bytes: 5000 })
    assert.deepEqual(await read(key1), bytes)
    const opened = await store.outputs.open(key1)
    assert.ok(opened)
    assert.equal(opened.bytes, 5000)
    assert.equal(opened.mediaType, 'application/zip')
    await opened.body.cancel()
    assert.equal(await store.outputs.open(`exports/${ALICE}/missing.zip`), null)
    assert.equal(await store.outputs.open('nothing/here.zip'), null)

    // A whole new object replaces the old one.
    assert.deepEqual(await store.outputs.put(key1, Buffer.from('second'), 'application/zip'), { bytes: 6 })
    assert.equal((await read(key1))?.toString(), 'second')

    // An async iterable (a stream the caller produces as it goes).
    async function* chunks(): AsyncGenerator<Uint8Array> {
      for (let i = 0; i < 40; i++) yield Buffer.alloc(1000, i)
    }
    const key2 = `videos/${ALICE}/clip-1/final.mp4`
    assert.deepEqual(await store.outputs.put(key2, chunks(), 'video/mp4'), { bytes: 40_000 })
    const streamed = await read(key2)
    assert.equal(streamed?.length, 40_000)
    assert.equal(streamed?.[0], 0)
    assert.equal(streamed?.[39_999], 39)
    assert.equal((await store.outputs.open(key2))?.mediaType, 'video/mp4')

    // The path of a temp file: copied, the caller keeps (and removes) its own.
    const tmpFile = join(dir, 'caller-temp.bin')
    const fromFile = randomBytes(70_000)
    await writeFile(tmpFile, fromFile)
    const key3 = `exports/${ALICE}/job-2.zip`
    assert.deepEqual(await store.outputs.put(key3, tmpFile, 'application/zip'), { bytes: 70_000 })
    assert.deepEqual(await read(key3), fromFile)
    assert.deepEqual(await readFile(tmpFile), fromFile, 'the caller’s file is still there')
    await assert.rejects(store.outputs.put(`exports/${ALICE}/nope.zip`, join(dir, 'no-such-temp-file'), 'application/zip'), 'a temp file that is not there fails the put')
    assert.equal(await store.outputs.open(`exports/${ALICE}/nope.zip`), null, 'and leaves no object')
    // An iterable that fails half-way leaves nothing — not the object, not a temp file.
    async function* failing(): AsyncGenerator<Uint8Array> {
      yield Buffer.alloc(100, 1)
      throw new Error('the source broke')
    }
    await assert.rejects(store.outputs.put(`exports/${ALICE}/torn.zip`, failing(), 'application/zip'), /the source broke/)
    assert.equal(await store.outputs.open(`exports/${ALICE}/torn.zip`), null, 'a write is whole or not at all')
    if (!CLOUD) assert.deepEqual(await readdir(join(dir, 'outputs', '.tmp')), [], 'no temp file left behind')

    // list
    const key4 = `exports/user_bob/job-9.zip`
    await store.outputs.put(key4, Buffer.from('bob'), 'application/zip')
    const listed = await store.outputs.list(`exports/${ALICE}/`)
    assert.deepEqual(listed.map((o) => o.key), [key1, key3], 'sorted by key, only under the folder')
    assert.deepEqual(listed.map((o) => o.bytes), [6, 70_000])
    assert.ok(listed.every((o) => !Number.isNaN(Date.parse(o.modifiedAt))), 'modifiedAt is a time')
    assert.deepEqual((await store.outputs.list(`exports/${ALICE}`)).map((o) => o.key), [key1, key3], 'a prefix with or without its slash is the same folder')
    assert.deepEqual((await store.outputs.list('exports/user_')).map((o) => o.key), [], 'a prefix is a folder, not the start of a name: user_ is not user_alice')
    assert.deepEqual((await store.outputs.list('')).map((o) => o.key), [key4, key1, key3, key2].sort(), 'an empty prefix lists everything')
    assert.deepEqual(await store.outputs.list('nothing/here'), [])
    // delete
    await store.outputs.delete(key3)
    assert.equal(await store.outputs.open(key3), null)
    await store.outputs.delete(key3) // already gone: not an error
    await store.outputs.delete(`never/was.zip`)
    assert.deepEqual((await store.outputs.list(`exports/${ALICE}/`)).map((o) => o.key), [key1])
    await store.outputs.delete(`exports/${ALICE}`) // a folder is not a key: nothing happens
    assert.ok(await read(key1), 'naming a folder as a key deletes nothing')

    // deletePrefix
    await store.outputs.put(`exports/${ALICE}/job-3.zip`, Buffer.from('3'), 'application/zip')
    await store.outputs.put(`exports/${ALICE}x/job-3.zip`, Buffer.from('neighbour'), 'application/zip')
    assert.equal(await store.outputs.deletePrefix(`exports/${ALICE}`), 2, 'two objects went')
    assert.deepEqual(await store.outputs.list(`exports/${ALICE}/`), [])
    assert.equal((await read(`exports/${ALICE}x/job-3.zip`))?.toString(), 'neighbour', 'a folder with a similar name is not touched')
    assert.ok(await read(key4), 'nor is bob’s')
    assert.equal(await store.outputs.deletePrefix(`exports/${ALICE}/`), 0, 'again: nothing left')
    assert.equal(await store.outputs.deletePrefix('never/was/'), 0)
    assert.equal(await store.outputs.deletePrefix(key2), 0, 'a key asked as a prefix names no folder')
    assert.ok(await read(key2), 'and the object under that name is still there')
    assert.equal(await store.outputs.deletePrefix(`videos/${ALICE}/`), 1)
    ok(`${where} outputs: put (bytes, a stream, a temp file; whole or not at all) / open / list / delete / deletePrefix; a prefix is a folder`)

    // Hostile keys: nothing outside the store can be named. A sentinel beside the store proves nothing is deleted or read.
    const sentinel = join(dir, 'sentinel.txt')
    await writeFile(sentinel, 'do not touch')
    await mkdir(join(dir, 'outputs'), { recursive: true })
    const hostile = [
      '',
      '.',
      '..',
      '../sentinel.txt',
      '../../sentinel.txt',
      'a/../../sentinel.txt',
      'a/../b',
      'a/./b',
      '/abs/path',
      '/etc/passwd',
      'a//b',
      'a/b/',
      'a\\b',
      '..\\sentinel.txt',
      'C:\\Windows\\x',
      'a/.hidden',
      '.tmp/x',
      '.tmp',
      'a/%2e%2e/b',
      'a b',
      'a\0b',
      'ünï/x',
      'x'.repeat(513),
      `${'seg/'.repeat(200)}x`,
      `${'y'.repeat(129)}/x`,
    ]
    for (const key of hostile) {
      const label = JSON.stringify(key).slice(0, 50)
      await assert.rejects(store.outputs.put(key, Buffer.from('evil'), 'text/plain'), /Not an output key/, `put(${label})`)
      assert.equal(await store.outputs.open(key), null, `open(${label})`)
      await store.outputs.delete(key) // names nothing, so there is nothing to remove, and nothing is thrown
    }
    for (const prefix of ['', '..', '../', '../x/', '/abs/', 'a/../b', '.tmp', 'a\\b']) {
      if (prefix === '') {
        await assert.rejects(store.outputs.deletePrefix(prefix), /empty prefix/, 'deletePrefix("") would delete everything')
        continue
      }
      await assert.rejects(store.outputs.deletePrefix(prefix), /Not an output prefix/, `deletePrefix(${JSON.stringify(prefix)})`)
      await assert.rejects(store.outputs.list(prefix), /Not an output prefix/, `list(${JSON.stringify(prefix)})`)
    }
    assert.equal(await readFile(sentinel, 'utf8'), 'do not touch', 'nothing outside the store was read, written or deleted')
    assert.ok(await read(key4), 'and nothing inside it was deleted by a refused call')
    assert.ok((await store.outputs.list('')).length >= 2)
    // A key that is fine but long and deep is fine.
    const deep = `exports/${ALICE}/${'d'.repeat(100)}/${'e'.repeat(100)}.zip`
    await store.outputs.put(deep, Buffer.from('deep'), 'application/zip')
    assert.equal((await read(deep))?.toString(), 'deep')
    await store.outputs.deletePrefix(`exports/${ALICE}`)
    await store.outputs.deletePrefix(`exports/${ALICE}x`)
    await store.outputs.deletePrefix('exports/user_bob')
    assert.deepEqual(await store.outputs.list(''), [], 'the store is empty again')
    if (!CLOUD) {
      // The files are where the spec says: data/outputs/<key>.
      await store.outputs.put('exports/probe/file.zip', Buffer.from('p'), 'application/zip')
      assert.equal((await stat(join(dir, 'outputs', 'exports', 'probe', 'file.zip'))).size, 1, 'data/outputs/<key>')
      await store.outputs.deletePrefix('exports/probe')
    }
    ok(`${where} outputs: ${hostile.length} hostile keys (.., absolute, backslash, empty or dotted segments, control characters, too long) are refused by put, name nothing for open and delete; an empty or unsafe prefix is refused`)
  }

  // =====================================================================================
  // 6. Jobs: deleteJob / deleteJobsOf
  // =====================================================================================
  {
    const job = (ownerId: string, over: Partial<JobRecord> = {}): JobRecord => ({
      id: crypto.randomUUID(),
      key: `delete-check:${crypto.randomUUID()}`,
      ownerId,
      projectId: '',
      kind: 'export',
      queue: 'account',
      payload: { kind: 'export' },
      status: 'queued',
      outcome: null,
      attempts: 0,
      reservedUsd: 0,
      reservation: 'none',
      costUsd: 0,
      carriedUsd: 0,
      error: null,
      resultImageId: null,
      providerJobId: null,
      workerId: null,
      leaseUntil: null,
      createdAt: at(1),
      updatedAt: at(1),
      startedAt: null,
      finishedAt: null,
      ...over,
    })
    const finished = { status: 'done' as const, outcome: 'done' as const, finishedAt: at(2) }
    const [a1, a2, a3, a4, b1] = [job(ALICE), job(ALICE, finished), job(ALICE, { status: 'running', startedAt: at(1) }), job(ALICE, finished), job(BOB)]
    for (const j of [a1, a2, a3, a4, b1]) assert.equal((await store.jobs.insertJob(j)).created, true)

    assert.equal(await store.jobs.deleteJob(a2.id), true)
    assert.equal(await store.jobs.getJob(a2.id), null)
    assert.equal(await store.jobs.deleteJob(a2.id), false, 'a job that is gone is already gone')
    assert.equal(await store.jobs.deleteJob('../x'), false)
    assert.equal(await store.jobs.deleteJob(crypto.randomUUID()), false)
    // An active job’s record goes too, and the key it held with it.
    assert.equal(await store.jobs.deleteJob(a1.id), true)
    assert.equal((await store.jobs.insertJob(job(ALICE, { key: a1.key }))).created, true, 'its dedupe key is free again')
    const live = job(ALICE, { key: a1.key })
    assert.equal((await store.jobs.insertJob(live)).created, false, 'the new holder keeps it')
    if (!CLOUD) assert.deepEqual((await readdir(join(dir, 'jobs'))).filter((n) => n.endsWith('.tmp')), [], 'no stray temp file')

    // deleteJobsOf: all of one owner's, except the one named.
    const keep = a3
    assert.equal(await store.jobs.deleteJobsOf(ALICE, keep.id), 2, 'alice had a3, a4 and the re-inserted job: all but a3 went')
    assert.deepEqual((await store.jobs.listJobs({ ownerId: ALICE })).map((j) => j.id), [keep.id], 'the deletion job itself stays')
    assert.ok(await store.jobs.getJob(b1.id), 'bob’s job is untouched')
    assert.equal(await store.jobs.deleteJobsOf(ALICE, keep.id), 0, 'again: nothing else to delete')
    assert.equal(await store.jobs.deleteJobsOf(ALICE), 1, 'with no exception, all of them')
    assert.deepEqual(await store.jobs.listJobs({ ownerId: ALICE }), [])
    assert.equal(await store.jobs.deleteJobsOf('user_nobody'), 0)
    assert.deepEqual((await store.jobs.listJobs({ ownerId: BOB })).map((j) => j.id), [b1.id])
    await store.jobs.deleteJobsOf(BOB)
    ok(`${where} jobs: deleteJob (any state, frees its key; false when gone) and deleteJobsOf (every record of one owner except the named one; never another owner’s)`)
  }

  // =====================================================================================
  // 7. Projects: deleteProject, projectStamp, projectsOf
  // =====================================================================================
  {
    const make = async (ownerId: string | undefined, title: string) => {
      const id = crypto.randomUUID()
      const base = emptyProject({ id, chapterId: crypto.randomUUID(), title, stylePresetId: 'manga-bw', serverRunId: 'check' })
      await store.createProject(ownerId === undefined ? base : { ...base, ownerId })
      return id
    }
    const a1 = await make(ALICE, 'Alice one')
    const a2 = await make(ALICE, 'Alice two')
    const b1 = await make(BOB, 'Bob one')
    const old = await make(undefined, 'Before accounts')

    // projectStamp
    const stamp = await store.projectStamp(a1)
    const read = await store.readProject(a1)
    assert.deepEqual(stamp, { ownerId: ALICE, updatedAt: read.updatedAt }, 'owner and last change, nothing else')
    assert.deepEqual(await store.projectStamp(old), { ownerId: LOCAL_OWNER, updatedAt: (await store.readProject(old)).updatedAt }, 'a project with no owner states local')
    await sleep(5)
    const edited = await store.updateProject(a1, (p) => ({ ...p, title: 'Alice one, renamed' }))
    const changed = await store.projectStamp(a1)
    assert.equal(changed?.updatedAt, edited.updatedAt)
    assert.notEqual(changed?.updatedAt, stamp?.updatedAt, 'the stamp moves when the project does')
    assert.equal(await store.projectStamp(crypto.randomUUID()), null)
    assert.equal(await store.projectStamp('../x'), null)
    assert.deepEqual(Object.keys(stamp ?? {}).sort(), ['ownerId', 'updatedAt'], 'two fields, not the desk')

    // projectsOf, with a damaged project among them.
    const damaged = await make(ALICE, 'Alice’s damaged chapter')
    const torn = await make(undefined, 'A torn chapter with no owner on record')
    if (CLOUD && scratchDb) {
      const { MongoClient } = await import('mongodb')
      const client = new MongoClient(scratchDb.url)
      try {
        // A version this build can't read: the document is there, its owner is still on record.
        await client.db(scratchDb.name).collection('projects').updateOne({ _id: damaged } as object, { $set: { 'project.version': 1 } })
        await client.db(scratchDb.name).collection('projects').updateOne({ _id: torn } as object, { $set: { project: 'garbage' } })
      } finally {
        await client.close()
      }
    } else {
      const file = join(dir, 'projects', damaged, 'project.json')
      await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), version: 1 }))
      await rm(join(dir, 'projects', damaged, 'project.json.bak'), { force: true })
      // Half a file and no backup: no owner survives, so it counts as local’s, as the dashboard counts it.
      const half = join(dir, 'projects', torn, 'project.json')
      const text = await readFile(half, 'utf8')
      await writeFile(half, text.slice(0, text.length >> 1))
      await rm(join(dir, 'projects', torn, 'project.json.bak'), { force: true })
    }
    await assert.rejects(store.readProject(damaged), (e: unknown) => (e as { status?: number }).status === 500, 'the damaged project cannot be opened')
    assert.deepEqual((await store.projectsOf(ALICE)).map((p) => p.id), [a1, a2, damaged].sort(), 'alice’s, the damaged one included, sorted by id')
    assert.deepEqual((await store.projectsOf(BOB)).map((p) => p.id), [b1])
    assert.deepEqual((await store.projectsOf(LOCAL_OWNER)).map((p) => p.id), [old, torn].sort(), 'local’s: no owner on record, even when the file is torn')
    assert.deepEqual(await store.projectsOf('user_nobody'), [])
    assert.ok(!(await store.listProjects(ALICE)).some((p) => p.id === torn), 'and listProjects agrees it is not alice’s')
    assert.equal((await store.listProjects(ALICE)).find((p) => p.id === damaged)?.unreadable, true, 'the dashboard shows the damaged one as a card; projectsOf lists it too')
    const damagedStamp = await store.projectStamp(damaged)
    assert.equal(damagedStamp?.ownerId, ALICE, 'a damaged project still names its owner')
    assert.ok(damagedStamp && !Number.isNaN(Date.parse(damagedStamp.updatedAt)), 'and has a date')
    assert.equal((await store.projectStamp(torn))?.ownerId, LOCAL_OWNER)
    ok(`${where} projects: projectStamp is {ownerId, updatedAt} and moves with an edit; projectsOf lists a project's id even when it can't be read`)

    // deleteProject
    await store.deleteProject(a2)
    await assert.rejects(store.readProject(a2), (e: unknown) => (e as { status?: number }).status === 404)
    assert.equal(await store.projectStamp(a2), null)
    assert.equal(await store.projectOwner(a2), null)
    assert.deepEqual((await store.projectsOf(ALICE)).map((p) => p.id), [a1, damaged].sort())
    await store.deleteProject(a2) // again: already gone
    await store.deleteProject('../x') // names nothing
    await store.deleteProject(crypto.randomUUID())
    await store.deleteProject(damaged) // a damaged project can be removed too
    await store.deleteProject(torn)
    assert.equal(await store.projectOwner(damaged), null)
    assert.deepEqual((await store.projectsOf(ALICE)).map((p) => p.id), [a1])
    assert.equal((await store.readProject(b1)).title, 'Bob one', 'another project is untouched')
    if (!CLOUD) {
      assert.ok(!(await stat(join(dir, 'projects', a2)).catch(() => null)), 'the folder is gone')
      assert.deepEqual((await readdir(join(dir, 'projects'))).filter((n) => n.includes('.lock') || n.endsWith('.tmp')), [], 'and no lock or temp file remains')
    }
    // The id is free: nothing resurrects it, but a project can be made with it again.
    await store.createProject({ ...(await store.readProject(a1)), id: a2, title: 'Reborn' })
    assert.equal((await store.readProject(a2)).title, 'Reborn')
    // Pictures are the caller's: deleting the project removes none.
    const png = Buffer.from('89504e470d0a1a0a', 'hex')
    const image = await store.putBlob(png, 'image/png', 'panel')
    await store.deleteProject(a2)
    assert.ok(await store.getBlob(image), 'deleteProject leaves the pictures to the caller')
    await store.deleteBlob(image)
    ok(`${where} projects: deleteProject removes the record only (a damaged project too), is idempotent, refuses to follow a path, and leaves the pictures to the caller`)
  }

  // =====================================================================================
  // LATER SECTIONS GO BELOW THIS LINE — the routes, the public pages, the reports
  // screen, the settings and the account deletion are held by the next agent, in
  // numbered sections of their own (8, 9, …). Keep the summary last.
  // =====================================================================================

  assert.equal(outbound.length, 0, 'nothing ever left this machine')
  console.log('\n  share-check: all passed\n')
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

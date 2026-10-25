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
//   ACCOUNT JOBS (sections 8 and 9, lib/account and app/api/settings/{export,delete})
//   8  account export  the routes (202 / state / download), one job per person, the zip read
//                    back by an independent reader and unzip -t, its contents (minimal
//                    account.json, no ownerId, the stored picture bytes, the missing one in
//                    the manifest), nothing of another person, only the latest kept, pictures
//                    streamed one at a time, the size cap, a store failing mid-way, an account
//                    deleted while it runs
//   9  account deletion  through the routes and the queue on a desk full of everything (a
//                    scratch Redis for the counters): zero records and objects left in every
//                    store and under the data dir, bob byte-identical, the hold of the running
//                    job released, the studio's totals and a look-alike id untouched; twice and
//                    at once; a crash after each of the 11 steps and the retry; ending the
//                    sign-in on a real Better Auth (memory database): already gone is success, a
//                    failure throws and carries no secret; an unreadable project; two presses at
//                    once are one job, a failure to queue is a 503; sign-in off; the phrase
//
//   THE CLOUD ADAPTER WITHOUT A SERVER (section 14, both modes: plain HTTP stand-ins and a fake collection)
//   14 cloud adapter  a big upload's timeout sized to its bytes, no wait on 100-continue, only transient
//                    failures retried; the outputs bucket probed at connect (write, read, list); a share
//                    create offered a taken token for a project that has an active share
//
//   OTHER SCRIPTS, run as child processes on their own scratch desks (local store only)
//   10 sharing   share-check-sharing.mts  the snapshot allow-list, owner API, public page / JSON / pictures / preview, revoke, windows, XSS
//   11 reports   share-check-reports.mts  the report route, what is stored, the window, admin gating and actions
//   12 settings  share-check-settings.mts the Defaults route
//   13 polling   poll-check.mts           the light status route and the poller (CR-8); also `npm run check:poll`
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
  'BETTER_AUTH_SECRET',
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
import type { TrailerPlan } from '../lib/video/types'

const ALICE = 'user_alice'
const BOB = 'user_bob'
const T0 = Date.parse('2026-10-16T09:00:00.000Z')
/** A clock the check controls: `at(0)` is the start, each step a second later. */
const at = (n: number) => new Date(T0 + n * 1000).toISOString()
const UNIQUE_TITLE = 'Zebra-Quartz Morning Edition'

/** A plan with no shots in it: the store keeps whatever shape it is given, and these checks are about the store. */
const PLAN: TrailerPlan = { title: 'Trailer', page: 0, model: 'bytedance/seedance-2.0-fast', resolution: '480p', method: 'B', shots: [], shotSeconds: 0, introSeconds: 3, outroSeconds: 2, runSeconds: 12, speechChars: 0 }

/** The fields a trailer record has had since slice 22 (the plan, the parts, `rev`), for a literal that is about something else. */
const videoParts = (): Pick<VideoRecord, 'rev' | 'plan' | 'shots' | 'speech' | 'music' | 'phase' | 'warnings' | 'captionsKey'> => ({
  rev: 0,
  plan: PLAN,
  shots: [],
  speech: [],
  music: { state: 'queued', blobKey: null, seconds: null, costUsd: 0, error: null },
  phase: null,
  warnings: [],
  captionsKey: null,
})

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
    snapshot: over.projectId === null ? { kind: 'video', title: 'Trailer', seconds: 12, hasCaptions: false, takenAt: at(0) } : snapshotOf(UNIQUE_TITLE),
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
      ...videoParts(),
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

    // update (slice 22): read → fn → write, `rev` the compare-and-set counter, bumped by every write.
    {
      const first = video(20, ALICE)
      await store.videos.put(first)
      // A record written before `rev` existed reads as 0, however it comes back — and its first update lands.
      const legacy = video(21, ALICE)
      const bare: Partial<VideoRecord> = { ...legacy }
      delete bare.rev
      if (!CLOUD) await writeFile(join(dir, 'videos', `${legacy.id}.json`), JSON.stringify(bare)) // the file as slice 21 would have left it: no rev at all
      else await store.videos.put(bare as VideoRecord)
      assert.equal((await store.videos.get(legacy.id))?.rev, 0, 'a record with no rev reads as rev 0')
      assert.deepEqual((await store.videos.listOf(ALICE)).map((v) => v.rev), [0, 0], 'and so does a listing')
      const lifted = await store.videos.update(legacy.id, (v) => ({ ...v, costUsd: 1 }))
      assert.deepEqual([lifted?.rev, lifted?.costUsd], [1, 1], 'the first update of such a record lands and makes it rev 1')
      assert.equal((await store.videos.get(legacy.id))?.rev, 1)

      // What fn is handed is the record as stored; the result is what is stored, with the id and rev under the store’s control.
      let handed: VideoRecord | null = null
      const next = await store.videos.update(first.id, (v) => ((handed = v), { ...v, status: 'making', phase: 'shots', id: crypto.randomUUID(), rev: 99 }))
      assert.deepEqual(handed, first, 'fn saw the stored record')
      assert.deepEqual([next?.id, next?.rev, next?.status, next?.phase], [first.id, 1, 'making', 'shots'], 'the id cannot change and rev counts writes, whatever fn put in them')
      assert.deepEqual(await store.videos.get(first.id), next, 'what update returns is what is stored')
      assert.equal((await store.videos.listOf(ALICE)).length, 2, 'and no record was added')

      // null from fn: left as it is, nothing written, rev unchanged; no such record: null and fn never runs.
      assert.equal(await store.videos.update(first.id, () => null), null)
      assert.equal((await store.videos.get(first.id))?.rev, 1, 'a null fn writes nothing')
      assert.equal(await store.videos.update(crypto.randomUUID(), () => assert.fail('no such video')), null)
      assert.equal(await store.videos.update('../x', () => assert.fail('not an id')), null, 'an id that is not an id names nothing')

      // Two writers at once (the worker’s shots, the web’s Try again): every update lands, none is lost.
      const seen: number[] = []
      const results = await Promise.all(Array.from({ length: 12 }, () => store.videos.update(first.id, (v) => (seen.push(v.costUsd), { ...v, costUsd: v.costUsd + 1 }))))
      const after = await store.videos.get(first.id)
      assert.deepEqual([after?.costUsd, after?.rev], [12, 13], 'twelve concurrent updates all landed: twelve increments, twelve revs')
      assert.deepEqual(results.map((r) => r?.rev).sort((a, b) => (a ?? 0) - (b ?? 0)), Array.from({ length: 12 }, (_, i) => i + 2), 'each saw its own, distinct rev')
      // fn runs on the FRESHEST record every time (here, under the lock; on Mongo a stale rev re-runs it): an increment never starts from a stale value.
      if (!CLOUD) assert.deepEqual([...seen].sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i), 'each fn call saw the previous call’s result')
      else assert.ok(new Set(seen).size === 12 || seen.length > 12, 'on Mongo a lost race re-runs fn on the fresher record')
      // put keeps working beside it: the record it writes carries the rev it was given.
      await store.videos.put({ ...after!, rev: 40, error: 'put' })
      assert.deepEqual([(await store.videos.get(first.id))?.rev, (await store.videos.get(first.id))?.error], [40, 'put'])
      assert.equal((await store.videos.update(first.id, (v) => v))?.rev, 41, 'and update goes on from there')
      await store.videos.deleteAllOf(ALICE)
      ok(`${where} videos.update: fn sees the stored record, rev counts writes (a record from before it reads as 0), a null fn or a missing record writes nothing, twelve concurrent updates all land`)
    }
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

    // A byte range (slice 22: a phone will not play a video it cannot seek in). `end` is inclusive, as in HTTP.
    {
      const { RangeNotSatisfiable } = await import('../lib/store')
      const rangeKey = `videos/${ALICE}/clip-range/final.mp4`
      await store.outputs.put(rangeKey, Buffer.from('abcdefghij'), 'video/mp4')
      const part = async (range?: { start: number; end?: number }) => {
        const o = await store.outputs.open(rangeKey, range)
        assert.ok(o, 'the object is there')
        return { text: Buffer.from(await new Response(o.body).arrayBuffer()).toString(), bytes: o.bytes, range: o.range, mediaType: o.mediaType }
      }
      assert.deepEqual(await part({ start: 0, end: 3 }), { text: 'abcd', bytes: 4, range: { start: 0, end: 3, total: 10 }, mediaType: 'video/mp4' }, 'the first bytes')
      assert.deepEqual(await part({ start: 4, end: 6 }), { text: 'efg', bytes: 3, range: { start: 4, end: 6, total: 10 }, mediaType: 'video/mp4' }, 'the middle')
      assert.deepEqual(await part({ start: 7 }), { text: 'hij', bytes: 3, range: { start: 7, end: 9, total: 10 }, mediaType: 'video/mp4' }, 'open-ended: to the last byte')
      assert.deepEqual(await part({ start: 8, end: 999 }), { text: 'ij', bytes: 2, range: { start: 8, end: 9, total: 10 }, mediaType: 'video/mp4' }, 'an end past the last byte is cut back to it')
      assert.deepEqual(await part({ start: 9, end: 9 }), { text: 'j', bytes: 1, range: { start: 9, end: 9, total: 10 }, mediaType: 'video/mp4' }, 'the last byte alone')
      assert.deepEqual(await part({ start: 0 }), { text: 'abcdefghij', bytes: 10, range: { start: 0, end: 9, total: 10 }, mediaType: 'video/mp4' }, 'the whole object, asked as a range, still says it is one')
      assert.deepEqual(await part(), { text: 'abcdefghij', bytes: 10, range: undefined, mediaType: 'video/mp4' }, 'no range: the whole object, and no range on the stream')
      // Past the end: reported with the size, so the route can answer 416 with Content-Range: bytes */10.
      for (const range of [{ start: 10 }, { start: 10, end: 12 }, { start: 5000 }]) {
        await assert.rejects(store.outputs.open(rangeKey, range), (e: unknown) => e instanceof RangeNotSatisfiable && e.total === 10 && e.status === 416, JSON.stringify(range))
      }
      // A range that is not a range names nothing the object has.
      for (const range of [{ start: -1 }, { start: 3, end: 2 }, { start: 1.5 }, { start: Number.NaN }, { start: 0, end: Number.POSITIVE_INFINITY }]) {
        await assert.rejects(store.outputs.open(rangeKey, range), (e: unknown) => e instanceof RangeNotSatisfiable, JSON.stringify(range))
      }
      assert.equal(await store.outputs.open(`videos/${ALICE}/clip-range/missing.mp4`, { start: 0, end: 3 }), null, 'a range on an object that is not there is null, not 416')
      assert.equal(await store.outputs.open('../etc/passwd', { start: 0 }), null, 'and an unsafe key still names nothing')
      // An empty object has no byte to start at.
      await store.outputs.put(`videos/${ALICE}/clip-range/empty.mp4`, Buffer.alloc(0), 'video/mp4')
      await assert.rejects(store.outputs.open(`videos/${ALICE}/clip-range/empty.mp4`, { start: 0 }), (e: unknown) => e instanceof RangeNotSatisfiable && e.total === 0)
      // A bigger object: the middle megabyte-ish of a stream, byte for byte.
      const big = randomBytes(300_000)
      await store.outputs.put(`videos/${ALICE}/clip-range/big.mp4`, big, 'video/mp4')
      const bigPart = await store.outputs.open(`videos/${ALICE}/clip-range/big.mp4`, { start: 123_456, end: 234_567 })
      assert.deepEqual(Buffer.from(await new Response(bigPart!.body).arrayBuffer()), big.subarray(123_456, 234_568), 'a long range is the same bytes as the file’s')
      await store.outputs.deletePrefix(`videos/${ALICE}/clip-range/`)
      ok(`${where} outputs.open(key, range): the first bytes, the middle, open-ended, an end past the last byte, the last byte, the whole; a start past the end (or an empty object, or a malformed range) is RangeNotSatisfiable with the size; a missing object is null`)
    }

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

  // =====================================================================================
  // 8. Account export — POST/GET /api/settings/export, the download, lib/account/export.ts
  // =====================================================================================
  const { createHash } = await import('node:crypto')
  const { spawnSync } = await import('node:child_process')
  const { inflateRawSync } = await import('node:zlib')
  const { accountRunners } = await import('../lib/queue/processors')
  const { enqueueAccountJob } = await import('../lib/queue/enqueue')
  const { newJob, claim, deleteAccountKey, NO_ACCOUNT_TO_DELETE } = await import('../lib/queue/jobs')
  const { projectImageIds } = await import('../lib/auth/access')
  const { makeExport, slugOf, imageFileName } = await import('../lib/account/export')
  const { EXPORT_TOO_BIG, exportKeyOf } = await import('../lib/account/keys')
  const exportRoute = await import('../app/api/settings/export/route')
  const downloadRoute = await import('../app/api/settings/export/download/route')
  const deleteRoute = await import('../app/api/settings/delete/route')
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
  const rq = (method: string, path: string, user: string | null, body?: unknown) =>
    new Request(`http://check${path}`, {
      method,
      headers: { ...(user ? { 'x-inkdesk-test-user': user } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
  const waitFor = async (what: string, pred: () => boolean | Promise<boolean>, ms = 20_000) => {
    const t0 = Date.now()
    while (!(await pred())) {
      if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`)
      await sleep(25)
    }
  }
  const mkJob = (ownerId: string, over: Partial<JobRecord> = {}): JobRecord => ({
    ...newJob({ key: `acct-check:${crypto.randomUUID()}`, ownerId, projectId: '', kind: 'export', payload: { kind: 'export' } }, crypto.randomUUID(), new Date(T0)),
    ...over,
  })

  /** Everything one person has, in every store, with sentinels planted in each place so a leftover can be found by content. */
  type Seed = {
    owner: string
    tag: string
    projects: string[]
    /** Pictures (id → bytes): the ones the projects hold, and the stranded one a job names. */
    images: Map<string, Buffer>
    /** Which project (index into `projects`) holds each picture the projects hold. */
    heldBy: Map<string, 0 | 1>
    /** Pictures only a job record names (paid for, never attached). */
    stranded: string[]
    /** A picture id a panel names that the bucket no longer has. */
    missing: string
    tokens: string[]
    reportIds: string[]
    videoKeys: string[]
    jobs: { running: string; queued: string; failed: string }
    outputKeys: string[]
  }
  const pngOf = (tag: string, n: number, bigBytes = 1200) => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(`MARK-${tag}-${n}`), randomBytes(bigBytes)])

  async function seedDesk(owner: string, tag: string, opts: { bigImage?: number; held?: boolean; stale?: boolean } = {}): Promise<Seed> {
    const images = new Map<string, Buffer>()
    const heldBy = new Map<string, 0 | 1>()
    const put = async (kind: 'sheet' | 'panel' | 'cover' | 'asset', type: 'image/png' | 'image/jpeg' | 'image/webp', n: number, size = 1200, project: 0 | 1 = 0) => {
      const bytes = pngOf(tag, n, size)
      const id = await store.putBlob(bytes, type, kind)
      images.set(id, bytes)
      heldBy.set(id, project)
      return id
    }
    await store.users.upsert({ id: owner, email: `${tag.toLowerCase()}@inkdesk.invalid`, createdAt: at(0) })
    const chapterId = crypto.randomUUID()
    const p1 = crypto.randomUUID()
    const p2 = crypto.randomUUID()
    for (const [id, title] of [[p1, `${tag} Café “Moon” / ../ Ünï`], [p2, `${tag} second`]] as const) {
      await store.createProject({ ...emptyProject({ id, chapterId: crypto.randomUUID(), title, stylePresetId: 'manga-bw', serverRunId: 'check' }), ownerId: owner })
    }
    const sheet = await put('sheet', 'image/png', 1)
    const asset = await put('asset', 'image/jpeg', 2)
    const cover = await put('cover', 'image/webp', 3)
    const panels1 = [await put('panel', 'image/png', 4, opts.bigImage), await put('panel', 'image/png', 5), await put('panel', 'image/jpeg', 6), await put('panel', 'image/png', 7)]
    const panel2 = await put('panel', 'image/webp', 8, 1200, 1)
    const missing = `panel-${crypto.randomUUID()}.png`
    const panelOf = (i: number, imageIds: string[]) => ({
      index: i as 0 | 1 | 2 | 3,
      characterId: 'c1',
      action: `${tag} action`,
      camera: 'wide',
      background: 'bg',
      dialogue: `${tag} line ${i}`,
      bubble: null,
      versions: imageIds.map((imageId) => ({ imageId, createdAt: at(0) })),
      currentVersion: 0,
      status: 'done' as const,
      startedAt: null,
      startedByRun: null,
    })
    await store.updateProject(p1, (p) => ({
      ...p,
      library: {
        characters: [{ id: 'c1', name: `Hero ${tag}`, role: 'lead', traits: [], look: `look ${tag}`, dna: `dna ${tag}`, sheetImageId: sheet, locked: true }],
        assets: [{ id: 'a1', kind: 'reference', name: 'ref', blobId: asset, mediaType: 'image/jpeg', bytes: images.get(asset)?.length ?? 0, createdAt: at(0) }],
      },
      chapters: [
        {
          ...p.chapters[0],
          cover: { brief: 'b', title: `${tag} cover`, versions: [{ imageId: cover, createdAt: at(0) }], currentVersion: 0, status: 'done', startedAt: null, startedByRun: null },
          pages: [{ index: 0, layoutId: 'four-shot', panels: panels1.map((id, i) => panelOf(i, [id])) }],
        },
      ],
    }))
    await store.updateProject(p2, (p) => ({
      ...p,
      chapters: [{ ...p.chapters[0], pages: [{ index: 0, layoutId: 'four-shot', panels: [panelOf(0, [panel2, missing])] }] }],
    }))

    // A picture only a job knows (paid for, never attached), and three jobs: one running, one waiting, one failed with it.
    const strandedBytes = pngOf(tag, 99)
    const strandedId = await store.putBlob(strandedBytes, 'image/png', 'panel')
    images.set(strandedId, strandedBytes)
    const running = mkJob(owner, { kind: 'panel', projectId: p1, payload: { kind: 'panel', chapterId, pageIndex: 0, index: 0 }, queue: 'image', status: 'running', attempts: 1, workerId: 'w-check', leaseUntil: new Date(Date.now() + 600_000).toISOString(), startedAt: at(1) })
    if (opts.held) {
      const { reserve } = await import('../lib/limits')
      await reserve({ id: running.id, userId: owner, units: { image: 1 }, usd: 0.05 })
      running.reservation = 'held'
      running.reservedUsd = 0.05
    }
    const queued = mkJob(owner, { kind: 'panel', projectId: p1, payload: { kind: 'panel', chapterId, pageIndex: 0, index: 1 }, queue: 'image' })
    const failed = mkJob(owner, { kind: 'panel', projectId: p1, payload: { kind: 'panel', chapterId, pageIndex: 0, index: 2 }, queue: 'image', status: 'failed', outcome: 'failed', error: 'x', resultImageId: strandedId, finishedAt: at(2) })
    for (const j of [running, queued, failed]) assert.equal((await store.jobs.insertJob(j)).created, true)

    // A live share, a dead one, and a report about each.
    const live = shareOf({ projectId: p1, ownerId: owner, snapshot: snapshotOf(`${tag} shared`) })
    const dead = shareOf({ projectId: p2, ownerId: owner, snapshot: snapshotOf(`${tag} retired`) })
    await store.shares.create(live)
    await store.shares.create(dead)
    await store.shares.revoke(dead.token, at(3))
    const reportIds: string[] = []
    for (const token of [live.token, dead.token]) {
      const id = crypto.randomUUID()
      reportIds.push(id)
      await store.reports.add({ id, token, reason: 'spam', note: `note ${tag}`, ipHash: 'h'.repeat(22), at: at(4), handledAt: null })
    }
    await store.settings.put({ userId: owner, defaultStyle: null, readingDirection: 'ltr', updatedAt: at(5) })

    // Videos and the outputs store: an old export, a poster and a final.
    // The third object is named by no videos record (a crash between the put and the record, a segment): only the prefix sweep can find it.
    const videoKeys = [`videos/${owner}/v1/poster.png`, `videos/${owner}/v1/final.mp4`, `videos/${owner}/orphan/segment.bin`]
    await store.outputs.put(videoKeys[0], pngOf(tag, 50), 'image/png')
    await store.outputs.put(videoKeys[1], Buffer.from(`MARK-${tag}-video`), 'video/mp4')
    await store.outputs.put(videoKeys[2], Buffer.from(`MARK-${tag}-orphan`), 'application/octet-stream')
    await store.videos.put({ id: crypto.randomUUID(), ownerId: owner, projectId: p1, page: 0, status: 'done', seconds: 9, costUsd: 0.5, posterKey: videoKeys[0], finalKey: videoKeys[1], error: null, createdAt: at(6), updatedAt: at(6), ...videoParts() })
    const outputKeys = opts.stale === false ? [] : [`exports/${owner}/stale-${tag.toLowerCase()}.zip`]
    for (const key of outputKeys) await store.outputs.put(key, Buffer.from(`PK-old-${tag}`), 'application/zip')

    return { owner, tag, projects: [p1, p2], images, heldBy, stranded: [strandedId], missing, tokens: [live.token, dead.token], reportIds, videoKeys, jobs: { running: running.id, queued: queued.id, failed: failed.id }, outputKeys }
  }

  /** What is in every store about one person, as plain data — two of these are equal exactly when nothing about them changed. */
  async function fingerprint(seed: Seed) {
    const { owner } = seed
    const ids = [...seed.images.keys()]
    return JSON.parse(
      JSON.stringify({
        user: await store.users.get(owner),
        projects: await Promise.all(seed.projects.map((id) => store.readProject(id))),
        blobs: await Promise.all(ids.map(async (id) => [id, sha((await store.getBlob(id))?.bytes ?? Buffer.alloc(0))])),
        jobs: (await store.jobs.listJobs({ ownerId: owner, limit: 100 })).sort((a, b) => (a.id < b.id ? -1 : 1)),
        shares: await Promise.all(seed.tokens.map((t) => store.shares.get(t))),
        reports: await Promise.all(seed.reportIds.map((id) => store.reports.get(id))),
        settings: await store.settings.get(owner),
        videos: await store.videos.listOf(owner),
        outputs: await Promise.all(
          [...seed.videoKeys, ...seed.outputKeys].map(async (key) => {
            const o = await store.outputs.open(key)
            return [key, o ? sha(Buffer.from(await new Response(o.body).arrayBuffer())) : null]
          })
        ),
      })
    )
  }

  /** What still names this person in the stores, by the store's own API; empty means gone. */
  async function leftovers(seed: Seed, except?: string): Promise<string[]> {
    const { owner } = seed
    const left: string[] = []
    if ((await store.projectsOf(owner)).length) left.push('projects')
    for (const id of seed.projects) if (await store.projectStamp(id)) left.push(`project ${id}`)
    for (const id of seed.images.keys()) if (await store.getBlob(id)) left.push(`picture ${id}`)
    if ((await store.jobs.listJobs({ ownerId: owner, limit: 10 })).some((j) => j.id !== except)) left.push('jobs')
    if ((await store.shares.listActiveOf(owner)).length) left.push('active shares')
    for (const token of seed.tokens) if (await store.shares.get(token)) left.push(`share ${token}`)
    for (const id of seed.reportIds) if (await store.reports.get(id)) left.push(`report ${id}`)
    if (await store.settings.get(owner)) left.push('settings')
    if ((await store.videos.listOf(owner)).length) left.push('videos')
    if ((await store.outputs.list(`exports/${owner}`)).length) left.push('exports')
    if ((await store.outputs.list(`videos/${owner}`)).length) left.push('video files')
    for (const key of [...seed.videoKeys, ...seed.outputKeys]) if (await store.outputs.open(key)) left.push(`output ${key}`)
    return left
  }

  /** Every file under the scratch data dir, by relative path, with its hash — and whether it names `markers`. Local store only. */
  async function dirSnapshot(markers: string[]): Promise<Map<string, { hash: string; names: boolean }>> {
    const found = new Map<string, { hash: string; names: boolean }>()
    const walk = async (folder: string) => {
      for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
        const path = join(folder, entry.name)
        if (entry.isDirectory()) await walk(path)
        else if (entry.isFile() && !/\.(lock|tmp)$/.test(entry.name)) {
          const bytes = await readFile(path)
          const rel = path.slice(dir.length + 1)
          found.set(rel, { hash: sha(bytes), names: markers.some((m) => rel.includes(m) || bytes.includes(m)) })
        }
      }
    }
    await walk(dir)
    return found
  }

  /** A zip read back with no help from the library that wrote it: the central directory, then each entry (stored or deflated). */
  function readZip(buf: Buffer): Map<string, Buffer> {
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    assert.ok(eocd >= 0, 'the zip has an end-of-directory record')
    const count = buf.readUInt16LE(eocd + 10)
    let p = buf.readUInt32LE(eocd + 16)
    const entries = new Map<string, Buffer>()
    for (let i = 0; i < count; i++) {
      assert.equal(buf.readUInt32LE(p), 0x02014b50, 'a central directory entry')
      const method = buf.readUInt16LE(p + 10)
      const compressed = buf.readUInt32LE(p + 20)
      const size = buf.readUInt32LE(p + 24)
      const nameLength = buf.readUInt16LE(p + 28)
      const extraLength = buf.readUInt16LE(p + 30)
      const commentLength = buf.readUInt16LE(p + 32)
      const local = buf.readUInt32LE(p + 42)
      const name = buf.toString('utf8', p + 46, p + 46 + nameLength)
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const raw = buf.subarray(start, start + compressed)
      const data = method === 8 ? inflateRawSync(raw) : raw
      assert.equal(data.length, size, `${name}: the size the directory states`)
      assert.ok(!entries.has(name), `${name} appears once`)
      entries.set(name, Buffer.from(data))
      p += 46 + nameLength + extraLength + commentLength
    }
    return entries
  }

  /** Remove a seeded desk by hand, store call by store call — the check's own broom, not the deletion under test. */
  async function wipeDesk(seed: Seed) {
    for (const id of seed.projects) {
      const p = await store.readProject(id).catch(() => null)
      if (p) for (const image of projectImageIds(p)) await store.deleteBlob(image)
      await store.deleteProject(id)
    }
    for (const id of seed.images.keys()) await store.deleteBlob(id)
    await store.jobs.deleteJobsOf(seed.owner)
    await store.shares.deleteAllOf(seed.owner)
    await store.reports.deleteForTokens(seed.tokens)
    await store.settings.delete(seed.owner)
    await store.videos.deleteAllOf(seed.owner)
    await store.outputs.deletePrefix(`videos/${seed.owner}`).catch(() => 0)
    await store.outputs.deletePrefix(`exports/${seed.owner}`).catch(() => 0)
  }

  const downloadOf = async (user: string) => {
    const res = await downloadRoute.GET(rq('GET', '/api/settings/export/download', user))
    return { res, bytes: Buffer.from(await res.arrayBuffer()) }
  }
  const exportStateOf = async (user: string) => (await (await exportRoute.GET(rq('GET', '/api/settings/export', user))).json()) as Record<string, unknown>

  {
    // The store sections above leave records behind for these two people: start from clean desks, so what is counted is what is seeded here.
    for (const owner of [ALICE, BOB]) {
      for (const { id } of await store.projectsOf(owner)) {
        const p = await store.readProject(id).catch(() => null)
        if (p) for (const image of projectImageIds(p)) await store.deleteBlob(image)
        await store.deleteProject(id)
      }
      await store.jobs.deleteJobsOf(owner)
      await store.reports.deleteForTokens(await store.shares.deleteAllOf(owner))
      await store.settings.delete(owner)
      await store.videos.deleteAllOf(owner)
      await store.outputs.deletePrefix(`exports/${owner}`)
      await store.outputs.deletePrefix(`videos/${owner}`)
    }
    const alice = await seedDesk(ALICE, 'Quillfeather', { bigImage: 3 * 1024 * 1024, stale: false })
    const bob = await seedDesk(BOB, 'Wombatcrest', { stale: false })
    const bobBefore = await fingerprint(bob)

    // 8a. Signed out, nothing asked for yet, a body that is not welcome.
    for (const [handler, path] of [[exportRoute.GET, '/api/settings/export'], [downloadRoute.GET, '/api/settings/export/download']] as const) {
      assert.equal((await handler(rq('GET', path, null))).status, 401, `${path} needs sign-in`)
    }
    assert.equal((await exportRoute.POST(rq('POST', '/api/settings/export', null))).status, 401)
    assert.deepEqual(await exportStateOf(ALICE), { state: 'none' })
    const none = await downloadOf(ALICE)
    assert.equal(none.res.status, 404)
    assert.match(((await new Response(none.bytes).json()) as { error: string }).error, /no export to download yet/i)
    assert.equal(none.res.headers.get('cache-control'), 'no-store')
    for (const body of ['{"scope":"all"}', 'nope', '[]']) {
      const res = await exportRoute.POST(rq('POST', '/api/settings/export', ALICE, body))
      assert.equal(res.status, 400, `a body that says anything is refused: ${body}`)
    }
    assert.equal((await exportRoute.POST(rq('POST', '/api/settings/export', ALICE, 'x'.repeat(5000)))).status, 413, 'a big body is refused unread')
    assert.deepEqual(await store.jobs.listJobs({ ownerId: ALICE, key: `export:${ALICE}` }), [], 'and none of those started a job')
    ok(`${where} export: signed-out is 401 on every route; before one is made the state is none and the download a calm 404; a body is refused and starts nothing`)

    // An older export is already in the store: the new one must replace it.
    await store.outputs.put(exportKeyOf(ALICE, 'older-job'), Buffer.from('PK older'), 'application/zip')

    // 8b. One in flight per person: two clicks (and a click while one runs) are one job. The runner is held to keep it running.
    const realExport = accountRunners.export
    let releaseGate: () => void = () => {}
    const gate = new Promise<void>((resolve) => (releaseGate = resolve))
    accountRunners.export = async (job, run) => {
      await gate
      return realExport(job, run)
    }
    let first: { job: { id: string; status: string } }
    try {
      const [a, b] = await Promise.all([exportRoute.POST(rq('POST', '/api/settings/export', ALICE)), exportRoute.POST(rq('POST', '/api/settings/export', ALICE, '{}'))])
      assert.deepEqual([a.status, b.status], [202, 202])
      first = (await a.json()) as typeof first
      assert.equal(((await b.json()) as typeof first).job.id, first.job.id, 'both clicks got the same job')
      assert.equal(a.headers.get('cache-control'), 'no-store')
      await waitFor('the export job to be claimed', async () => (await store.jobs.getJob(first.job.id))?.status === 'running')
      assert.deepEqual(await exportStateOf(ALICE), { state: 'working', jobId: first.job.id })
      assert.deepEqual(await exportStateOf(BOB), { state: 'none' }, 'bob does not see alice’s export')
      assert.equal(((await (await exportRoute.POST(rq('POST', '/api/settings/export', ALICE))).json()) as typeof first).job.id, first.job.id, 'a click while it works finds it')
    } finally {
      releaseGate()
      accountRunners.export = realExport
    }
    await waitFor('the export to be ready', async () => (await exportStateOf(ALICE)).state === 'ready')
    const ready = await exportStateOf(ALICE)
    assert.equal(ready.jobId, first.job.id)
    assert.equal(typeof ready.bytes, 'number')
    assert.ok(!Number.isNaN(Date.parse(String(ready.readyAt))))
    assert.deepEqual((await store.outputs.list(`exports/${ALICE}`)).map((o) => o.key), [exportKeyOf(ALICE, first.job.id)], 'the old export is gone, only this one stands')
    ok(`${where} export: POST is 202 {job}; two clicks and a click while it runs are one job; GET says working, then ready with its size and time; one export stands in the outputs store (the stale one was deleted)`)

    // 8c. The download: owner-only, an attachment, no-store, nosniff — and a zip that an independent reader and unzip accept.
    const got = await downloadOf(ALICE)
    assert.equal(got.res.status, 200)
    assert.equal(got.res.headers.get('content-type'), 'application/zip')
    assert.match(got.res.headers.get('content-disposition') ?? '', /^attachment; filename="ink-desk-export-\d{4}-\d{2}-\d{2}\.zip"$/)
    assert.equal(got.res.headers.get('cache-control'), 'no-store')
    assert.equal(got.res.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(Number(got.res.headers.get('content-length')), got.bytes.length)
    assert.equal(got.bytes.length, ready.bytes)
    const zipPath = join(dir, 'alice-export.zip')
    await writeFile(zipPath, got.bytes)
    const unzipped = spawnSync('unzip', ['-t', zipPath], { encoding: 'utf8' })
    if (unzipped.error) console.log('  --  unzip is not installed here; the zip was read with the check’s own reader only')
    else assert.equal(unzipped.status, 0, `unzip -t: ${unzipped.stdout}`)
    const files = readZip(got.bytes)
    const present = [...alice.heldBy.keys()]
    const names = [...files.keys()]
    const folderOf = (id: string, title: string) => `projects/${slugOf(title)}-${id}`
    const folder1 = folderOf(alice.projects[0], (await store.readProject(alice.projects[0])).title)
    const folder2 = folderOf(alice.projects[1], (await store.readProject(alice.projects[1])).title)
    assert.match(folder1, /^projects\/[a-z0-9-]+-[a-z0-9-]+$/, 'a title with slashes, dots and accents is a safe folder name')
    assert.deepEqual(
      names.sort(),
      [
        'account.json', 'manifest.json', 'settings.json', 'shares.json',
        `${folder1}/project.json`, `${folder2}/project.json`,
        ...present.map((id) => `${alice.heldBy.get(id) === 0 ? folder1 : folder2}/images/${id}`),
      ].sort(),
      'exactly the account files, each project’s document and every picture a project holds (not the stranded one a job names, not the missing one)'
    )
    ok(`${where} export: the download is an attachment named ink-desk-export-<date>.zip, no-store, nosniff, its length right; unzip -t and an independent reader accept it`)

    // 8d. What is in it: account.json is minimal, project.json has no owner, pictures are the stored bytes, the missing one is in the manifest.
    assert.deepEqual(Object.keys(JSON.parse(files.get('account.json')!.toString())).sort(), ['createdAt', 'email', 'id'])
    assert.deepEqual(JSON.parse(files.get('account.json')!.toString()), { id: ALICE, email: 'quillfeather@inkdesk.invalid', createdAt: at(0) })
    assert.equal(JSON.parse(files.get('settings.json')!.toString()).readingDirection, 'ltr')
    const sharesJson = JSON.parse(files.get('shares.json')!.toString()) as { shares: { token: string; path: string; title: string }[] }
    assert.deepEqual(sharesJson.shares.map((s) => [s.token, s.path, s.title]), [[alice.tokens[0], `/s/${alice.tokens[0]}`, 'Quillfeather shared']], 'only the ACTIVE share, with its token and title')
    for (const folder of [folder1, folder2]) {
      const project = JSON.parse(files.get(`${folder}/project.json`)!.toString()) as Record<string, unknown>
      assert.ok(!('ownerId' in project), 'ownerId is removed')
      assert.ok(!files.get(`${folder}/project.json`)!.toString().includes(ALICE), 'and nothing in the document names the account')
    }
    for (const id of present) {
      const entry = `${alice.heldBy.get(id) === 0 ? folder1 : folder2}/images/${id}`
      assert.ok(files.has(entry), `${id} is in the zip`)
      assert.equal(sha(files.get(entry)!), sha(alice.images.get(id)!), `${id}: the very bytes that were stored`)
      assert.match(entry, /\.(png|jpg|webp)$/, 'with its extension')
    }
    const manifest = JSON.parse(files.get('manifest.json')!.toString()) as { projects: number; images: number; missingImages: { project: string; imageId: string }[]; unreadableProjects: unknown[] }
    assert.equal(manifest.projects, 2)
    assert.equal(manifest.images, present.length)
    assert.deepEqual(manifest.missingImages.map((m) => [m.project, m.imageId]), [[alice.projects[1], alice.missing]], 'the missing picture is noted, not fatal')
    assert.equal(imageFileName('panel-abc.png', 'image/png'), 'panel-abc.png')
    assert.equal(imageFileName('panel-abc', 'image/jpeg'), 'panel-abc.jpg')
    assert.equal(slugOf('  ../ ÀÉÎ  Ünï — Café!! '), 'aei-uni-cafe')
    assert.equal(slugOf('日本語'), 'project')
    ok(`${where} export: account.json holds id, email and createdAt only; settings and the active share are in; project.json has no owner; every picture is the stored bytes with its extension; the missing picture is in the manifest, not a failure`)

    // 8e. Nothing of anyone else — not by content, not by name.
    const everything = Buffer.concat([...files.entries()].map(([name, data]) => Buffer.concat([Buffer.from(name), data])))
    for (const secret of [BOB, 'Wombatcrest', ...bob.projects, ...bob.tokens, ...[...bob.images.keys()]]) {
      assert.ok(!everything.includes(secret), `bob’s ${secret.slice(0, 20)} is not in alice’s zip`)
    }
    assert.ok(everything.includes('Quillfeather'), 'while hers is')
    const bobDownload = await downloadOf(BOB)
    assert.equal(bobDownload.res.status, 404, 'bob has made no export; he is not handed alice’s')
    assert.deepEqual(await fingerprint(bob), bobBefore, 'bob’s data is untouched by alice’s export')
    ok(`${where} export: no byte of bob’s desk is in alice’s zip, bob cannot fetch it, and bob’s records are unchanged`)

    // 8f. Only the latest is kept: a second export replaces the first, and the download follows.
    const second = (await (await exportRoute.POST(rq('POST', '/api/settings/export', ALICE))).json()) as typeof first
    assert.notEqual(second.job.id, first.job.id)
    await waitFor('the second export', async () => (await exportStateOf(ALICE)).jobId === second.job.id && (await exportStateOf(ALICE)).state === 'ready')
    assert.deepEqual((await store.outputs.list(`exports/${ALICE}`)).map((o) => o.key), [exportKeyOf(ALICE, second.job.id)], 'one export, the newer')
    assert.equal(Number((await downloadOf(ALICE)).res.headers.get('content-length')), (await exportStateOf(ALICE)).bytes)
    ok(`${where} export: a new export replaces the old one (one key under exports/<owner>/), and the download is the new one`)

    // 8g. Pictures are streamed one at a time, never all held; a temp file is made and always removed.
    const tmpScratch = join(dir, 'export-tmp')
    await mkdir(tmpScratch, { recursive: true })
    const realOpen = store.openBlob
    let open = 0
    let peak = 0
    let opened = 0
    store.openBlob = async (id) => {
      const blob = await realOpen.call(store, id)
      if (!blob) return blob
      open++
      opened++
      peak = Math.max(peak, open)
      let closed = false
      const close = () => {
        if (!closed) open--
        closed = true
      }
      return { ...blob, body: blob.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ flush: close })) }
    }
    try {
      const sentinel = mkJob(ALICE, { id: crypto.randomUUID() })
      const done = await makeExport(sentinel, { tmpDir: tmpScratch })
      assert.deepEqual(done, { outcome: 'done' })
      assert.equal(opened, present.length, 'every picture was opened once')
      assert.equal(peak, 1, 'and never more than one was open at a time')
      assert.deepEqual(await readdir(tmpScratch), [], 'the temp file is removed after a good export')
      assert.deepEqual((await store.outputs.list(`exports/${ALICE}`)).map((o) => o.key), [exportKeyOf(ALICE, sentinel.id)])
    } finally {
      store.openBlob = realOpen
    }
    ok(`${where} export: ${present.length} pictures (one of 3 MB) were streamed one at a time (peak 1 open), and the temp file in os.tmpdir() was removed`)

    // 8h. The cap: a calm sentence, nothing stored, the earlier export kept, the temp file gone.
    const before = (await store.outputs.list(`exports/${ALICE}`)).map((o) => o.key)
    const capped = await makeExport(mkJob(ALICE), { capBytes: 100_000, tmpDir: tmpScratch })
    assert.deepEqual(capped, { outcome: 'failed', error: EXPORT_TOO_BIG })
    assert.match(EXPORT_TOO_BIG, /larger than the studio can pack/)
    assert.deepEqual((await store.outputs.list(`exports/${ALICE}`)).map((o) => o.key), before, 'the earlier export stands')
    assert.deepEqual(await readdir(tmpScratch), [], 'no temp file is left behind a refused export')
    // A store that does not say how big a picture is (the size is counted as it streams): the same refusal, mid-picture.
    const sizeless = store.openBlob
    store.openBlob = async (id) => {
      const blob = await sizeless.call(store, id)
      return blob ? { ...blob, bytes: null } : blob
    }
    try {
      assert.deepEqual(await makeExport(mkJob(ALICE), { capBytes: 100_000, tmpDir: tmpScratch }), { outcome: 'failed', error: EXPORT_TOO_BIG })
    } finally {
      store.openBlob = sizeless
    }
    assert.deepEqual(await readdir(tmpScratch), [])
    ok(`${where} export: past the size cap the job ends failed with one calm sentence, stores nothing, keeps the earlier export and leaves no temp file`)

    // 8i. A store that fails mid-way throws (so the queue retries) and still cleans up.
    const realOpen2 = store.openBlob
    let calls = 0
    store.openBlob = async (id) => {
      if (++calls === 3) throw new Error('the bucket went away')
      return realOpen2.call(store, id)
    }
    try {
      await assert.rejects(makeExport(mkJob(ALICE), { tmpDir: tmpScratch }), /the bucket went away/)
    } finally {
      store.openBlob = realOpen2
    }
    assert.deepEqual(await readdir(tmpScratch), [], 'the temp file is removed when the build throws')
    // …and a picture whose stream breaks half way: the same, with nothing left open and no unhandled error.
    const realOpen3 = store.openBlob
    store.openBlob = async (id) => {
      const blob = await realOpen3.call(store, id)
      if (!blob) return blob
      let sent = false
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) {
            sent = true
            controller.enqueue(new Uint8Array(100))
          } else controller.error(new Error('the connection dropped'))
        },
      })
      return { ...blob, body }
    }
    try {
      await assert.rejects(makeExport(mkJob(ALICE), { tmpDir: tmpScratch }), /the connection dropped/)
    } finally {
      store.openBlob = realOpen3
    }
    assert.deepEqual(await readdir(tmpScratch), [], 'the temp file is removed when a picture’s stream breaks')
    assert.deepEqual((await store.outputs.list(`exports/${ALICE}`)).map((o) => o.key), before, 'and the earlier export stands, nothing half-written beside it')
    ok(`${where} export: a store that fails mid-way throws for the queue to retry, and still removes the temp file and stores nothing`)

    // 8i2. A temp file that cannot be written (a full disk): the picture being packed fails with the write's error at
    //      once — it never waits for ever on a zip that stopped reading, holding the one-wide account lane (after-audit #11).
    if (!CLOUD && process.platform === 'linux') {
      const { ZipBuilder } = await import('../lib/account/zip')
      const full = new ZipBuilder('/dev/full', 50 * 1024 * 1024, new Date())
      full.addBuffer('account.json', Buffer.from('{}'))
      let pulled = 0
      const picture = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulled >= 64) return controller.close()
          pulled++
          controller.enqueue(new Uint8Array(64 * 1024))
        },
      })
      const t0 = Date.now()
      const verdict = await Promise.race([
        full.addStream('projects/x/images/a.png', picture, 64 * 64 * 1024).then(
          () => 'resolved',
          (err: unknown) => `rejected: ${(err as { code?: string }).code ?? String(err)}`
        ),
        new Promise<string>((resolve) => setTimeout(() => resolve('still pending'), 5_000)),
      ])
      assert.equal(verdict, 'rejected: ENOSPC', `a picture packed onto a full disk fails with the write's error (${Date.now() - t0} ms)`)
      assert.throws(() => full.addBuffer('manifest.json', Buffer.from('{}')), /ENOSPC/, 'and so does anything added after it')
      await assert.rejects(full.finish(), /ENOSPC/)
      full.abort()
      ok('local export: a temp file that cannot be written (a full disk) fails the picture being packed with the write’s error at once — no hang on the account lane')
    }

    // 8j. An account deleted while its export is being made gets no export (checked before the put and after it).
    const ghost = 'user_ghost'
    await store.users.upsert({ id: ghost, email: 'ghost@inkdesk.invalid', createdAt: at(0) })
    await store.users.markDeleted(ghost)
    assert.equal((await makeExport(mkJob(ghost), { tmpDir: tmpScratch })).outcome, 'refused')
    const racer = 'user_racer'
    await store.users.upsert({ id: racer, email: 'racer@inkdesk.invalid', createdAt: at(0) })
    const realPut = store.outputs.put
    store.outputs.put = async (key, body, type) => {
      const result = await realPut.call(store.outputs, key, body, type)
      await store.users.markDeleted(racer) // the deletion lands while the zip is being stored
      return result
    }
    try {
      assert.equal((await makeExport(mkJob(racer), { tmpDir: tmpScratch })).outcome, 'refused')
    } finally {
      store.outputs.put = realPut
    }
    assert.deepEqual(await store.outputs.list('exports/user_ghost'), [])
    assert.deepEqual(await store.outputs.list('exports/user_racer'), [], 'a zip that landed after the deletion is removed again')
    ok(`${where} export: an account that was deleted before — or while — its export ran is left with nothing in the outputs store`)

    // 8k. A project too damaged to read is listed in the manifest and the rest still comes (local files can be torn).
    if (!CLOUD) {
      const damagedOwner = 'user_damaged'
      const keepId = crypto.randomUUID()
      const torn = crypto.randomUUID()
      for (const [id, title] of [[keepId, 'Whole'], [torn, 'Torn']] as const) {
        await store.createProject({ ...emptyProject({ id, chapterId: crypto.randomUUID(), title, stylePresetId: 'manga-bw', serverRunId: 'check' }), ownerId: damagedOwner })
      }
      // Damaged but still naming its owner (a version this studio does not know): it cannot be opened, and it is still hers.
      const file = join(dir, 'projects', torn, 'project.json')
      await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), version: 1 }))
      await rm(join(dir, 'projects', torn, 'project.json.bak'), { force: true })
      assert.equal((await makeExport(mkJob(damagedOwner), { tmpDir: tmpScratch })).outcome, 'done')
      const damagedJob = (await store.outputs.list(`exports/${damagedOwner}`))[0]
      const parsed = readZip(Buffer.from(await new Response((await store.outputs.open(damagedJob.key))!.body).arrayBuffer()))
      assert.ok([...parsed.keys()].includes(`projects/whole-${keepId}/project.json`), 'the readable project is in')
      const m = JSON.parse(parsed.get('manifest.json')!.toString()) as { unreadableProjects: { project: string }[] }
      assert.deepEqual(m.unreadableProjects.map((u) => u.project), [torn], 'the damaged one is named in the manifest')
      await store.deleteProject(keepId)
      await store.deleteProject(torn)
      await store.outputs.deletePrefix(`exports/${damagedOwner}`)
      ok('local export: a project whose stored copy cannot be read is named in the manifest and the rest of the desk is still exported')
    }

    // 8l. A desk without accounts can still export its own (the owner is `local`).
    const localProject = crypto.randomUUID()
    await store.createProject(emptyProject({ id: localProject, chapterId: crypto.randomUUID(), title: 'Before accounts', stylePresetId: 'manga-bw', serverRunId: 'check' }))
    assert.equal((await makeExport(mkJob(LOCAL_OWNER), { tmpDir: tmpScratch })).outcome, 'done')
    const localZip = readZip(Buffer.from(await new Response((await store.outputs.open((await store.outputs.list('exports/local'))[0].key))!.body).arrayBuffer()))
    assert.ok(localZip.has(`projects/before-accounts-${localProject}/project.json`))
    assert.deepEqual(JSON.parse(localZip.get('account.json')!.toString()), { id: 'local', email: null, createdAt: null })
    await store.outputs.deletePrefix('exports/local')
    await store.deleteProject(localProject)
    ok(`${where} export: the single local owner of a desk without accounts can export too`)

    // Tidy for the deletion section, which starts from clean desks.
    await rm(tmpScratch, { recursive: true, force: true })
    await rm(zipPath, { force: true })
    for (const seed of [alice, bob]) await wipeDesk(seed)
  }

  // =====================================================================================
  // 9. Account deletion — POST/GET /api/settings/delete, lib/account/deletion.ts
  // =====================================================================================
  const { deleteAccount, productionDeps, DELETION_STEPS, DELETION_INCOMPLETE, DELETION_NOT_SET_UP } = await import('../lib/account/deletion')
  const { purgeCounters } = await import('../lib/account/counters')
  const { backend, resetBackend } = await import('../lib/limits')
  const { dayOf } = await import('../lib/limits/rules')
  const { closeProducerRedis, producerRedis, redisKey } = await import('../lib/queue/redis')
  const { Refused } = await import('../lib/errors')
  const { once } = (await import('node:events')).default
  const { createServer } = await import('node:net')
  type ChildProc = ReturnType<typeof spawn>

  // A scratch Redis for the counters: the in-process backend cannot be asked to forget a person, so the counters
  // that must go are real Redis keys. Without redis-server on the PATH the Redis assertions are skipped, loudly.
  let redisProc: ChildProc | undefined
  let redisReady = false
  if (spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status === 0) {
    const probe = createServer()
    probe.listen(0, '127.0.0.1')
    await once(probe, 'listening')
    const { port } = probe.address() as { port: number }
    probe.close()
    await once(probe, 'close')
    redisProc = spawn('redis-server', ['--port', String(port), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no'], { stdio: 'ignore' })
    env.REDIS_URL = `redis://127.0.0.1:${port}`
    resetBackend()
    await waitFor('the scratch redis', async () => {
      try {
        return (await producerRedis().ping()) === 'PONG'
      } catch {
        return false
      }
    }, 10_000)
    redisReady = true
  } else {
    console.log('  --  redis-server is not on the PATH: the account deletion’s counter assertions are skipped')
  }
  const R = () => producerRedis()
  const today = dayOf(Date.now())
  const month = today.slice(0, 6)
  const counterKeys = (u: string) => [`quota:${u}:${today}:image`, `quota:${u}:${today}:project`, `spend:${u}:${today}`, `spend:${u}:${month}`]
  const windowKeys = (u: string) => [`rl:edit:${u}`, `rl:read:${u}`, `rl:text:${u}`, `rl:anon:${u}`]
  async function seedCounters(u: string) {
    if (!redisReady) return
    for (const k of counterKeys(u)) await R().set(redisKey(k), '3')
    for (const k of windowKeys(u)) await R().zadd(redisKey(k), Date.now(), `${Date.now()}-${u}`)
  }
  /** Every key under the studio prefix that is not BullMQ's, with its value — for comparing before and after. */
  async function redisDump(match: (key: string) => boolean = () => true): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {}
    if (!redisReady) return out
    let cursor = '0'
    do {
      const [next, keys] = await R().scan(cursor, 'MATCH', 'inkdesk:*', 'COUNT', 500)
      cursor = next
      for (const key of keys) {
        if (key.startsWith('inkdesk:bull:') || !match(key)) continue
        const type = await R().type(key)
        out[key] = type === 'string' ? await R().get(key) : type === 'zset' ? (await R().zrange(key, 0, -1, 'WITHSCORES')).filter((_, i) => i % 2 === 0) : type
      }
    } while (cursor !== '0')
    return out
  }
  const mentions = (u: string) => (key: string) => key.includes(`:${u}:`) || key.endsWith(`:${u}`)

  const fakeSignIn = () => {
    const calls: string[] = []
    return {
      calls,
      deleteUser: async (id: string): Promise<void> => {
        calls.push(id)
      },
    }
  }
  const depsOf = (signIn: ReturnType<typeof fakeSignIn> | null, afterStep?: (s: (typeof DELETION_STEPS)[number]) => void | Promise<void>) => ({
    signIn,
    purgeCounters,
    now: () => new Date(),
    ...(afterStep ? { afterStep } : {}),
  })
  /** A deletion job as the processor would hold it: written, claimed, running. */
  async function deletionJob(owner: string): Promise<JobRecord> {
    const record = claim(newJob({ key: deleteAccountKey(owner), ownerId: owner, projectId: '', kind: 'delete-account', payload: { kind: 'delete-account' } }, crypto.randomUUID(), new Date()), 'w-check', new Date())
    assert.ok(record)
    assert.equal((await store.jobs.insertJob(record)).created, true)
    return record
  }
  const stateOf = async (user: string) => (await (await deleteRoute.GET(rq('GET', '/api/settings/delete', user))).json()) as { state: string; error?: string }
  const deleteAs = (user: string | null, body?: unknown) => deleteRoute.POST(rq('POST', '/api/settings/delete', user, body === undefined ? { confirm: 'delete my account' } : body))

  try {
    // 9a. THE WHOLE THING, through the routes and the queue: alice has two projects, pictures of every kind, a share and a report
    // about it, a revoked share, jobs (one running and holding quota), settings, videos, outputs and Redis counters. Bob has the same.
    {
      const cousin = 'user_alicex' // an id that starts like alice's: nothing of theirs may go
      if (redisReady) {
        await R().set(redisKey(`spend:global:${today}`), '2000000')
        await R().set(redisKey('spend:global:total'), '5000000')
        await R().set(redisKey('spend:global:20250101'), '7')
        await seedCounters(cousin)
      }
      const globalsBefore = await redisDump((k) => k.startsWith('inkdesk:spend:global:'))
      const alice = await seedDesk(ALICE, 'Quillfeather', { held: true })
      const bob = await seedDesk(BOB, 'Wombatcrest')
      await seedCounters(ALICE)
      await seedCounters(BOB)
      const holdId = alice.jobs.running
      assert.ok(await backend().hold(holdId), 'alice’s running job holds quota')
      const bobBefore = await fingerprint(bob)
      const bobRedisBefore = await redisDump(mentions(BOB))
      const cousinBefore = await redisDump(mentions(cousin))
      const dirBefore = CLOUD ? new Map() : await dirSnapshot([ALICE, 'Quillfeather'])
      const aliceFilesBefore = [...dirBefore.entries()].filter(([, f]) => f.names).map(([p]) => p)
      if (!CLOUD) assert.ok(aliceFilesBefore.length > 15, `alice’s desk is spread over many files (${aliceFilesBefore.length})`)

      // The phrase: nothing else starts it (the dialog asks twice; the server asks again).
      for (const wrong of [{ confirm: 'delete my account please' }, { confirm: '' }, { confirm: 'delete' }, {}, { confirm: 'delete my account', also: 1 }, { confirm: 5 }, ['delete my account'], 'nope', 'x'.repeat(4000)]) {
        const res = await deleteAs(ALICE, wrong)
        assert.ok([400, 413].includes(res.status), `${JSON.stringify(wrong).slice(0, 40)} → ${res.status}`)
        const sentence = ((await res.json()) as { error: string }).error
        assert.ok(sentence.length > 0 && sentence.length < 200 && !/zod|ZodError|undefined/.test(sentence), sentence)
      }
      assert.match(((await (await deleteAs(ALICE, { confirm: 'nope' })).json()) as { error: string }).error, /type “delete my account” exactly/)
      assert.equal((await deleteAs(null)).status, 401)
      assert.deepEqual(await store.jobs.listJobs({ ownerId: ALICE, key: deleteAccountKey(ALICE) }), [], 'none of those started a deletion')
      assert.deepEqual(await stateOf(ALICE), { state: 'none' })
      assert.equal((await deleteRoute.GET(rq('GET', '/api/settings/delete', null))).status, 401)

      // Start it for real (the phrase in another case, with spaces), with the runner held so the states can be seen.
      const realRunner = accountRunners['delete-account']
      let release: () => void = () => {}
      const held = new Promise<void>((resolve) => (release = resolve))
      accountRunners['delete-account'] = async (job, run) => {
        await held
        return realRunner(job, run)
      }
      let jobId = ''
      try {
        const [a, b] = await Promise.all([deleteAs(ALICE, { confirm: '  Delete My ACCOUNT ' }), deleteAs(ALICE)])
        assert.deepEqual([a.status, b.status], [202, 202])
        const ja = ((await a.json()) as { job: { id: string; status: string } }).job
        const jb = ((await b.json()) as { job: { id: string } }).job
        assert.equal(ja.id, jb.id, 'two clicks are one deletion')
        assert.equal(a.headers.get('cache-control'), 'no-store')
        jobId = ja.id
        await waitFor('the deletion to be claimed', async () => (await store.jobs.getJob(jobId))?.status === 'running')
        assert.deepEqual(await stateOf(ALICE), { state: 'working' })
        assert.deepEqual(await stateOf(BOB), { state: 'none' }, 'bob’s page does not see alice’s deletion')
        assert.equal(((await (await deleteAs(ALICE)).json()) as { job: { id: string } }).job.id, jobId, 'and a click while it works finds it')
      } finally {
        release()
        accountRunners['delete-account'] = realRunner
      }
      await waitFor('the deletion job’s own record to be deleted', async () => (await store.jobs.getJob(jobId)) === null)
      // Read before alice asks anything else: her own page polling after the purge would take a fresh window (a signed-out person cannot).
      const aliceRedisAfter = await redisDump(mentions(ALICE))
      assert.deepEqual(await stateOf(ALICE), { state: 'done' }, 'the page that polls is told it is done')

      // ZERO of alice's, in every store.
      assert.deepEqual(await leftovers(alice), [], 'nothing of alice’s is left in any store')
      assert.equal((await store.projectsOf(ALICE)).length, 0)
      const tomb = await store.users.get(ALICE)
      assert.ok(tomb?.deletedAt, 'her account record is a tombstone')
      assert.equal(tomb?.email, '', 'with no email')
      await store.users.upsert({ id: ALICE, email: 'late@inkdesk.invalid', createdAt: at(9) })
      assert.ok((await store.users.get(ALICE))?.deletedAt, 'a late user.created cannot bring her back')
      assert.equal((await store.users.get(ALICE))?.email, '')
      // Her public links are dead and the reports about them are gone.
      for (const token of alice.tokens) assert.equal(await store.shares.get(token), null)
      for (const id of alice.reportIds) assert.equal(await store.reports.get(id), null)
      // The job that held quota was cancelled through endJob: its hold is gone (settled, not left to expire).
      assert.equal(await backend().hold(holdId), null, 'the running job’s hold was settled')
      {
        // How a cancelled picture settles (after-audit #8): one a worker held is settled at its estimate (its call may be
        // out, and the run's own ending will be refused); one still waiting, or one only attaching a picture already paid
        // for, gives its hold back.
        const { settlementOf } = await import('../lib/limits/jobs')
        const cancelled = (over: Partial<JobRecord>) => settlementOf(mkJob(ALICE, { kind: 'panel', status: 'failed', outcome: 'cancelled', ...over }))
        assert.deepEqual(cancelled({ workerId: 'w' }), { actualUsd: null, refund: false }, 'cancelled mid-draw: the estimate stands')
        assert.deepEqual(cancelled({ kind: 'sheet', workerId: 'w' }), { actualUsd: null, refund: false })
        assert.deepEqual(cancelled({ workerId: null }), { actualUsd: 0, refund: true }, 'cancelled while waiting: released')
        assert.deepEqual(cancelled({ workerId: 'w', costUsd: 0.04, carriedUsd: 0.04 }), { actualUsd: 0, refund: true }, 'attaching a picture already paid for: released')
        assert.deepEqual(cancelled({ workerId: 'w', costUsd: 0.03 }), { actualUsd: 0.03, refund: true }, 'a reported cost is what it cost')
      }
      ok(`${where} deletion: a confirmed request is 202, two clicks are one job, the states go none → working → done, and nothing of alice’s is left in the projects, pictures (${alice.images.size}), jobs, shares, reports, settings, videos or outputs; her account is a tombstone with no email`)

      // On disk (local store): not one file or byte names her — except the tombstone — and bob’s are untouched, byte for byte.
      if (!CLOUD) {
        const dirAfter = await dirSnapshot([ALICE, 'Quillfeather'])
        const stillNaming = [...dirAfter.entries()].filter(([, f]) => f.names).map(([p]) => p)
        assert.deepEqual(stillNaming, [join('users', `${ALICE}.json`)], 'the only file left that names alice is her tombstone')
        assert.ok(!(await readFile(join(dir, 'users', `${ALICE}.json`), 'utf8')).includes('quillfeather@'), 'which holds no email')
        let untouched = 0
        for (const [path, file] of dirBefore) {
          if (aliceFilesBefore.includes(path)) continue
          assert.equal(dirAfter.get(path)?.hash, file.hash, `${path} is byte-identical`)
          untouched++
        }
        for (const path of dirAfter.keys()) assert.ok(dirBefore.has(path), `${path} is not a new file`)
        for (const path of aliceFilesBefore) if (path !== join('users', `${ALICE}.json`)) assert.ok(!dirAfter.has(path), `${path} is gone`)
        ok(`local deletion: ${aliceFilesBefore.length - 1} of alice’s files are gone, no file or byte under the data dir names her but the tombstone, and ${untouched} other files are byte-identical`)
      }
      assert.deepEqual(await fingerprint(bob), bobBefore, 'bob’s records, pictures, jobs, shares, reports, settings, videos and outputs are unchanged')
      ok(`${where} deletion: bob’s desk (projects, ${bob.images.size} pictures, jobs, share, reports, settings, videos, outputs) is identical before and after`)

      // Redis: hers are gone, bob’s, her look-alike’s and the studio’s totals are not.
      if (redisReady) {
        assert.deepEqual(aliceRedisAfter, {}, 'no counter or window of alice’s remains')
        const bobRedisAfter = await redisDump(mentions(BOB))
        for (const [key, value] of Object.entries(bobRedisBefore)) {
          assert.ok(key in bobRedisAfter, `${key} still exists`)
          if (typeof value === 'string') assert.equal(bobRedisAfter[key], value, `${key} is unchanged`)
        }
        assert.ok(Object.keys(bobRedisBefore).length >= counterKeys(BOB).length + windowKeys(BOB).length)
        assert.deepEqual(await redisDump(mentions(cousin)), cousinBefore, 'so are those of user_alicex')
        assert.equal(Object.keys(cousinBefore).length, counterKeys(cousin).length + windowKeys(cousin).length)
        const globalsAfter = await redisDump((k) => k.startsWith('inkdesk:spend:global:'))
        assert.equal(globalsAfter['inkdesk:spend:global:20250101'], '7', 'the studio’s own totals are never touched')
        // Her running picture was cancelled mid-draw: the provider bills a call that is out whether or not it lands, so its
        // estimate ($0.05) stays on the studio's totals rather than coming off at $0 (after-audit #8).
        assert.equal(Number(globalsAfter[`inkdesk:spend:global:${today}`]), Number(globalsBefore[`inkdesk:spend:global:${today}`] ?? 0) + 50_000, 'her running picture’s estimate stays on the studio’s day')
        assert.equal(Number(globalsAfter['inkdesk:spend:global:total']), Number(globalsBefore['inkdesk:spend:global:total'] ?? 0) + 50_000, 'and on its total')
        ok('redis deletion: quota:, spend: and rl: keys of alice are gone (found by SCAN); bob’s, user_alicex’s and the studio-wide spend:global:* totals are untouched but for her running picture, settled at its estimate')
      }

      // The page of an account that is gone: nothing to export, nothing to download.
      assert.equal((await downloadOf(ALICE)).res.status, 404)
      await wipeDesk(bob)
    }

    // 9b. Again, and at the same time: a finished deletion run once more finds nothing and says so; two at once converge.
    {
      const twin = 'user_twin'
      const seed = await seedDesk(twin, 'Twinleaf', { held: true })
      await seedCounters(twin)
      const j1 = await deletionJob(twin)
      const outcomes = await Promise.all([deleteAccount(j1, depsOf(null)), deleteAccount({ ...j1, id: crypto.randomUUID() }, depsOf(null))])
      assert.deepEqual(outcomes.map((o) => o.outcome), ['done', 'done'], 'two runs at once both finish')
      await store.jobs.deleteJobsOf(twin)
      assert.deepEqual(await leftovers(seed), [])
      assert.deepEqual(await deleteAccount(j1, depsOf(null)), { outcome: 'done' }, 'and once more, on nothing')
      await store.jobs.deleteJobsOf(twin)
      assert.deepEqual(await leftovers(seed), [])
      if (redisReady) assert.deepEqual(await redisDump(mentions(twin)), {})
      ok(`${where} deletion: running it twice at once, and again after it finished, ends in the same empty place`)
    }

    // 9c. A crash after ANY step: the run is cut off (the injected hook throws), the part-way state is what the step says, and the next run — the retry —
    // finishes it. The hook is dependency injection: production passes none.
    {
      const bob = await seedDesk(BOB, 'Wombatcrest')
      const bobBefore = await fingerprint(bob)
      for (const [i, stepName] of DELETION_STEPS.entries()) {
        const owner = `user_crash${i}`
        const seed = await seedDesk(owner, `Crashdummy${i}x`, { held: true })
        await seedCounters(owner)
        const record = await deletionJob(owner)
        const signIn = fakeSignIn()
        await assert.rejects(
          deleteAccount(record, depsOf(signIn, (step) => { if (step === stepName) throw new Error(`crash after ${step}`) })),
          new RegExp(`crash after ${stepName}`)
        )
        // What a crash right after this step leaves behind.
        const left = await leftovers(seed, record.id)
        const has = (what: string) => left.some((l) => l.startsWith(what))
        const upTo = (s: (typeof DELETION_STEPS)[number]) => DELETION_STEPS.indexOf(stepName) >= DELETION_STEPS.indexOf(s)
        assert.ok((await store.users.get(owner))?.deletedAt, `after ${stepName}: the tombstone stands`)
        assert.ok(await store.jobs.getJob(record.id), `after ${stepName}: the deletion’s own record is never swept (the processor deletes it last)`)
        const running = await store.jobs.getJob(seed.jobs.running)
        if (!upTo('jobs') && upTo('cancelled')) {
          assert.deepEqual([running?.status, running?.outcome], ['failed', 'cancelled'], 'the running job was cancelled')
          assert.equal(await backend().hold(seed.jobs.running), null, 'and its hold released')
        }
        if (!upTo('cancelled')) assert.equal(running?.status, 'running', 'before the cancel the job still runs')
        assert.deepEqual(signIn.calls, upTo('signin') ? [owner] : [], `the sign-in was ended ${upTo('signin') ? 'once' : 'not yet'}`)
        const liveShare = await store.shares.get(seed.tokens[0])
        assert.ok(!liveShare || liveShare.revokedAt, `after ${stepName}: the public link is already dead, whatever else is left`)
        assert.equal(has('active shares') || has('share '), !upTo('shares'), 'shares and their reports go together')
        assert.equal(has('report '), !upTo('shares'))
        assert.equal(has('projects') || has('project '), !upTo('projects'), 'projects')
        assert.equal(has('picture '), !upTo('jobs'), 'pictures stay until the jobs that name the stranded one are swept')
        assert.equal(has('jobs'), !upTo('jobs'), 'jobs')
        assert.equal(has('videos'), !upTo('videos'))
        assert.equal(has('exports') || has('video files'), !upTo('outputs'))
        assert.equal(has('settings'), !upTo('settings'))
        if (redisReady) assert.equal(Object.keys(await redisDump(mentions(owner))).length > 0, !upTo('counters'), 'the counters go at step 5')
        if (upTo('verified')) assert.deepEqual(left, [], 'a crash after the data is verified gone has nothing left to sweep')
        if (!upTo('verified')) assert.deepEqual(signIn.calls, [], 'their sign-in ends only once the data is verified gone: a deletion cut off before that leaves them signed in, to see it and try again')
        // The retry.
        const finished = await deleteAccount(record, depsOf(signIn))
        assert.deepEqual(finished, { outcome: 'done' }, `resumed after ${stepName}`)
        await store.jobs.deleteJob(record.id)
        assert.deepEqual(await leftovers(seed), [], `after a crash at "${stepName}" and a retry, nothing is left`)
        if (redisReady) assert.deepEqual(await redisDump(mentions(owner)), {})
        assert.equal(signIn.calls.length, upTo('signin') ? 2 : 1, 'a retried run ends the sign-in again and is fine with "already gone"')
      }
      assert.deepEqual(await fingerprint(bob), bobBefore, 'bob’s desk is untouched by all of it')
      await wipeDesk(bob)
      ok(`${where} deletion: a crash after each of the ${DELETION_STEPS.length} steps (${DELETION_STEPS.join(', ')}) leaves the state that step says, and the retry converges on zero records; bob untouched`)
    }

    // 9d. Ending the sign-in (better mode), on a real Better Auth with a memory database: the user, its sessions and its
    // sign-ins go; "already gone" is success; a failure throws for the queue to retry and carries no secret.
    {
      const SECRET = `${'x'.repeat(32)}SECRETMARK`
      const { betterAuth } = await import('better-auth')
      const { memoryAdapter } = await import('better-auth/adapters/memory')
      const { authOptions, createAccount, deleteSignIn } = await import('../lib/auth/server')
      const memory = { user: [], session: [], account: [], verification: [] } as Record<string, Record<string, unknown>[]>
      const auth = betterAuth(authOptions({ secret: SECRET, baseURL: 'https://inkdesk.example', authorizedParties: ['https://inkdesk.example'] }, memoryAdapter(memory)))
      const made = await createAccount(auth, { email: 'leaver@inkdesk.invalid', password: 'a long password' })
      const id = made.id
      assert.equal((await auth.api.signInEmail({ body: { email: 'leaver@inkdesk.invalid', password: 'a long password' } })).user.id, id)
      assert.equal(memory.session.filter((x) => x.userId === id).length, 1)
      await deleteSignIn(id, auth)
      assert.deepEqual(
        [memory.user, memory.session, memory.account].map((rows) => rows.filter((x) => x.id === id || x.userId === id).length),
        [0, 0, 0],
        'the user, its sessions and its sign-ins are gone'
      )
      await deleteSignIn(id, auth) // already gone: success
      // A database that fails: the error is thrown (the queue retries), and says nothing secret.
      const logged: string[] = []
      const real = { log: console.log, warn: console.warn, error: console.error }
      for (const level of ['log', 'warn', 'error'] as const) console[level] = (...args: unknown[]) => void logged.push(args.map(String).join(' '))
      try {
        const broken = { $context: Promise.resolve({ internalAdapter: { deleteUserSessions: async () => { throw new Error(`connection refused ${SECRET}`) } } }) }
        await assert.rejects(deleteSignIn('user_c2', broken as never), /connection refused/)
        const { deleteSignInUser } = await import('../lib/account/signin')
        const err = await deleteSignInUser('user_c2').then(() => null, (e: unknown) => e as Error) // no sign-in settings here: it fails, calmly
        assert.ok(err instanceof Error, 'a sign-in that cannot be ended throws, so the queue retries')
        assert.match(err.message, /could not be ended/)
        assert.ok(!err.message.includes('SECRETMARK'), 'the error does not carry the secret')
      } finally {
        Object.assign(console, real)
      }
      assert.ok(!logged.join('\n').includes('SECRETMARK'), 'nothing logged carries the secret')

      // A failed end of the sign-in comes LAST, after the data is verified gone: the job throws for the queue to retry, and what is left to do is ending the sign-in.
      const owner = 'user_signinfail'
      const seed = await seedDesk(owner, 'Signinfail', { held: true })
      const record = await deletionJob(owner)
      const failing = { calls: [] as string[], deleteUser: async (): Promise<void> => { throw new Error('The sign-in could not be ended (Error); the deletion will be tried again') } }
      await assert.rejects(deleteAccount(record, depsOf(failing)), /could not be ended/)
      assert.ok((await store.users.get(owner))?.deletedAt, 'the tombstone is set')
      assert.deepEqual(await leftovers(seed, record.id), [], 'the data was already gone when the sign-in was ended')
      const link = await store.shares.get(seed.tokens[0])
      assert.equal(link, null, 'and so was the public link')
      assert.equal((await store.jobs.getJob(seed.jobs.running))?.outcome ?? null, null, 'their jobs were swept with the rest')
      assert.deepEqual(await deleteAccount(record, depsOf(fakeSignIn())), { outcome: 'done' })
      await store.jobs.deleteJob(record.id)
      assert.deepEqual(await leftovers(seed), [])
      ok(`${where} deletion: ending the sign-in removes the Better Auth user, its sessions and sign-ins, and "already gone" is success; a failure throws for the queue to retry (it comes last, after the data is verified gone, so the retry only has the sign-in left to end) and no error or log line carries the secret`)
    }

    // 9d2. A worker that cannot end the sign-in (no BETTER_AUTH_SECRET or no MongoDB) changes nothing and ends the job at once: it does not drop the email, stop
    // their work and then fail every retry.
    {
      const owner = 'user_nokey'
      const seed = await seedDesk(owner, 'Nokey', { held: true })
      const record = await deletionJob(owner)
      const blind = { ...fakeSignIn(), ready: () => 'BETTER_AUTH_SECRET is not set' }
      assert.deepEqual(await deleteAccount(record, depsOf(blind)), { outcome: 'failed', error: DELETION_NOT_SET_UP })
      assert.equal((await store.users.get(owner))?.deletedAt ?? null, null, 'the account is not marked')
      assert.equal((await store.projectsOf(owner)).length, 2, 'the data is all there')
      assert.equal((await store.jobs.getJob(seed.jobs.running))?.status, 'running', 'their work still runs')
      assert.ok(!(await store.shares.get(seed.tokens[0]))?.revokedAt, 'their link is untouched')
      assert.deepEqual(blind.calls, [], 'the sign-in was not touched')
      // What production wires in: better mode without the secret is not ready; with it and the database, ready; no better mode, no sign-in to end.
      const saved = { NODE_ENV: env.NODE_ENV, INKDESK_AUTH: env.INKDESK_AUTH, BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET, MONGODB_URI: env.MONGODB_URI, MONGODB_DB: env.MONGODB_DB }
      try {
        env.NODE_ENV = 'production'
        delete env.INKDESK_AUTH
        delete env.BETTER_AUTH_SECRET
        env.MONGODB_URI = 'mongodb://check.invalid:27017/'
        env.MONGODB_DB = 'check'
        assert.match(productionDeps().signIn?.ready?.() ?? '', /BETTER_AUTH_SECRET is not set/, 'a production worker without the secret is not ready')
        env.BETTER_AUTH_SECRET = 'x'.repeat(32)
        assert.equal(productionDeps().signIn?.ready?.(), null, 'and with it, ready')
        delete env.NODE_ENV
        assert.equal(productionDeps().signIn, null, 'outside production there is no sign-in to end')
      } finally {
        for (const [name, value] of Object.entries(saved)) {
          if (value === undefined) delete env[name]
          else env[name] = value
        }
      }
      assert.deepEqual(await deleteAccount(record, depsOf(fakeSignIn())), { outcome: 'done' }, 'once the key is there, the same job finishes')
      await store.jobs.deleteJob(record.id)
      assert.deepEqual(await leftovers(seed), [])
      ok(`${where} deletion: a worker with no sign-in secret ends the job at once with nothing changed (account, data, work and link untouched); production wires that check in`)
    }

    // 9e. A project too damaged to read is deleted anyway; the pictures that can be found are removed; the one picture only that project's lost copy named is the documented limit.
    if (!CLOUD) {
      const owner = 'user_torn'
      const seed = await seedDesk(owner, 'Tornpage')
      const file = join(dir, 'projects', seed.projects[1], 'project.json')
      await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), version: 1 }))
      await rm(join(dir, 'projects', seed.projects[1], 'project.json.bak'), { force: true })
      await assert.rejects(store.readProject(seed.projects[1]), (e: unknown) => (e as { status?: number }).status === 500)
      assert.deepEqual((await store.projectsOf(owner)).map((p) => p.id).sort(), [...seed.projects].sort(), 'the damaged project is listed')
      const record = await deletionJob(owner)
      assert.deepEqual(await deleteAccount(record, depsOf(null)), { outcome: 'done' })
      await store.jobs.deleteJob(record.id)
      const [damagedPicture] = [...seed.heldBy.entries()].filter(([, p]) => p === 1).map(([id]) => id)
      assert.deepEqual(await leftovers(seed), [`picture ${damagedPicture}`], 'everything goes but the one picture only the unreadable copy named')
      assert.ok(!(await stat(join(dir, 'projects', seed.projects[1])).catch(() => null)), 'the damaged project’s folder is gone')
      await store.deleteBlob(damagedPicture)
      ok('local deletion: an unreadable project is deleted anyway (its readable sibling’s pictures and every job’s stored picture go); only a picture that nothing readable names remains — the documented limit')
    }

    // 9f. Two presses at once (two tabs) find the one job; a job that cannot be queued is a 503 with no record, and the next press works.
    {
      const owner = 'user_twotabs'
      const seed = await seedDesk(owner, 'Twotabs')
      const realRunner = accountRunners['delete-account']
      let release: () => void = () => {}
      const held = new Promise<void>((resolve) => (release = resolve))
      accountRunners['delete-account'] = async (job, run) => {
        await held
        return realRunner(job, run)
      }
      try {
        const [first, second] = await Promise.all([deleteAs(owner), deleteAs(owner)])
        assert.deepEqual([first.status, second.status], [202, 202])
        const jobsFor = () => store.jobs.listJobs({ ownerId: owner, key: deleteAccountKey(owner) })
        const [only] = await jobsFor()
        assert.equal((await jobsFor()).length, 1, 'one deletion job')
        assert.equal(only.kind, 'delete-account')
        assert.equal(only.projectId, '')
        assert.equal(only.reservation, 'none')
        const viaApi = await enqueueAccountJob({ ownerId: owner, kind: 'delete-account' })
        assert.deepEqual([viaApi.created, viaApi.job.id], [false, only.id], 'a third ask finds it too')
      } finally {
        release()
        accountRunners['delete-account'] = realRunner
      }
      await waitFor('the job to finish', async () => (await store.jobs.listJobs({ ownerId: owner, key: deleteAccountKey(owner) })).length === 0)
      assert.deepEqual(await leftovers(seed), [], 'the one job removed everything')

      const owner2 = 'user_noqueue'
      const seed2 = await seedDesk(owner2, 'Noqueue')
      const savedRedis = env.REDIS_URL
      delete env.REDIS_URL
      env.INKDESK_QUEUE = 'bullmq' // a Redis queue with no Redis: the studio is busy, and nothing is recorded
      const quiet = console.error
      console.error = () => {}
      let refused: Response
      try {
        refused = await deleteAs(owner2)
      } finally {
        console.error = quiet
        delete env.INKDESK_QUEUE
        if (savedRedis) env.REDIS_URL = savedRedis
      }
      assert.equal(refused.status, 503, 'a queue that is down is a 503')
      assert.deepEqual(await store.jobs.listJobs({ ownerId: owner2 }).then((js) => js.filter((j) => j.kind === 'delete-account')), [], 'and no record of a job that was never queued')
      assert.equal((await deleteAs(owner2)).status, 202, 'the next press works')
      await waitFor('the retried job to finish', async () => (await store.jobs.listJobs({ ownerId: owner2, key: deleteAccountKey(owner2) })).length === 0)
      assert.deepEqual(await leftovers(seed2), [])
      ok(`${where} deletion: two presses at once are one job (a third ask finds it); a queue that is down answers 503 with no record, and the next press succeeds`)
    }

    // 9g. A desk with sign-in OFF: there is no account to delete, and deleting its one owner would wipe the desk.
    {
      const localProject = crypto.randomUUID()
      await store.createProject(emptyProject({ id: localProject, chapterId: crypto.randomUUID(), title: 'My only desk', stylePresetId: 'manga-bw', serverRunId: 'check' }))
      const savedAuth = env.INKDESK_AUTH
      env.INKDESK_AUTH = 'off'
      try {
        const res = await deleteAs(null)
        assert.equal(res.status, 409)
        assert.equal(((await res.json()) as { error: string }).error, NO_ACCOUNT_TO_DELETE, 'the one sentence')
        assert.equal(NO_ACCOUNT_TO_DELETE, 'Deleting an account isn’t available on a desk without accounts.')
        assert.equal((await deleteAs(null, { confirm: 'something else entirely' })).status, 409, 'refused before the phrase is even read')
        assert.deepEqual(await (await deleteRoute.GET(rq('GET', '/api/settings/delete', null))).json(), { state: 'none' })
        await assert.rejects(enqueueAccountJob({ ownerId: LOCAL_OWNER, kind: 'delete-account' }), (e: unknown) => e instanceof Refused && e.status === 409 && e.message === NO_ACCOUNT_TO_DELETE)
        assert.deepEqual(await deleteAccount(mkJob(LOCAL_OWNER, { kind: 'delete-account', payload: { kind: 'delete-account' } }), depsOf(null)), { outcome: 'refused', error: NO_ACCOUNT_TO_DELETE }, 'and the runner itself refuses')
        // An export is fine there (a person may take their own desk).
        assert.equal((await exportRoute.POST(rq('POST', '/api/settings/export', null))).status, 202)
        await waitFor('the local export', async () => (await exportStateOf('local')).state === 'ready')
        await store.outputs.deletePrefix('exports/local')
      } finally {
        env.INKDESK_AUTH = savedAuth
      }
      assert.deepEqual(await store.jobs.listJobs({ key: deleteAccountKey(LOCAL_OWNER) }), [], 'no deletion was ever recorded')
      assert.equal((await store.readProject(localProject)).title, 'My only desk', 'the desk is as it was')
      await store.deleteProject(localProject)
      ok(`${where} deletion: with sign-in off the route answers 409 with “${NO_ACCOUNT_TO_DELETE}” before reading the phrase, the door and the runner refuse too, nothing is recorded or removed — while export still works`)
    }

    // 9h. The counters purge never reaches a neighbour or the studio, and refuses ids it cannot trust.
    if (redisReady) {
      const before = await redisDump()
      assert.equal(await purgeCounters('*'), 0)
      assert.equal(await purgeCounters('user_*'), 0)
      assert.equal(await purgeCounters('global'), 0)
      assert.equal(await purgeCounters('a:b'), 0)
      assert.equal(await purgeCounters(''), 0)
      assert.deepEqual(await redisDump(), before, 'unsafe ids delete nothing')
      await seedCounters('user_zed')
      await seedCounters('user_zedd')
      assert.equal(await purgeCounters('user_zed'), counterKeys('user_zed').length + windowKeys('user_zed').length)
      assert.deepEqual(await redisDump(mentions('user_zed')), {})
      assert.equal(Object.keys(await redisDump(mentions('user_zedd'))).length, counterKeys('user_zedd').length + windowKeys('user_zedd').length, 'user_zedd is not user_zed')
      assert.equal(await purgeCounters('user_zed'), 0, 'again: nothing')
      await purgeCounters('user_zedd')
      ok('redis: the purge finds keys by SCAN, takes exactly one person’s, repeats harmlessly and refuses ids with glob characters, colons or the name "global"')
    }

    // 9i. A deletion that cannot finish says so with one calm sentence, and keeps its record (only `done` deletes it).
    {
      const owner = 'user_stuck'
      const seed = await seedDesk(owner, 'Stuckfast')
      const record = await deletionJob(owner)
      // A store that gives back what was just deleted: shares reappear after every sweep (a user making more while it runs).
      const realListActive = store.shares.listActiveOf
      const realDeleteAll = store.shares.deleteAllOf
      store.shares.deleteAllOf = async () => []
      store.shares.listActiveOf = async () => [{ ...shareOf({ projectId: seed.projects[0], ownerId: owner }) }]
      const warn = console.warn
      const err = console.error
      console.warn = () => {}
      console.error = () => {}
      let outcome
      const signIn = fakeSignIn()
      try {
        outcome = await deleteAccount(record, depsOf(signIn))
      } finally {
        store.shares.listActiveOf = realListActive
        store.shares.deleteAllOf = realDeleteAll
        console.warn = warn
        console.error = err
      }
      assert.deepEqual(outcome, { outcome: 'failed', error: DELETION_INCOMPLETE })
      assert.deepEqual(signIn.calls, [], 'a deletion that ends failed never ended their sign-in: they can still sign in, see the sentence and try again')
      assert.ok(await store.jobs.getJob(record.id), 'a failed deletion keeps its record, for the status route to tell the person')
      assert.match(DELETION_INCOMPLETE, /Nothing is lost by trying again/)
      assert.deepEqual(await deleteAccount(record, depsOf(signIn)), { outcome: 'done' }, 'and once the store behaves, the next run finishes')
      assert.deepEqual(signIn.calls, [owner], 'and ends the sign-in then')
      await store.jobs.deleteJob(record.id)
      assert.deepEqual(await leftovers(seed), [])
      ok(`${where} deletion: if the verification still finds something after its sweeps, the job ends failed with one calm sentence (the record stays, the page offers Try again), and the next run finishes`)
    }

    // 9j. Many records: every loop pages (200 at a time) and ends — 450 jobs, 250 of them still queued, half with a stored picture.
    {
      const owner = 'user_many'
      await store.users.upsert({ id: owner, email: 'many@inkdesk.invalid', createdAt: at(0) })
      const pictures: string[] = []
      for (let i = 0; i < 450; i++) {
        let resultImageId: string | null = null
        if (i % 2 === 0) {
          resultImageId = await store.putBlob(pngOf('Manyjobs', i, 16), 'image/png', 'panel')
          pictures.push(resultImageId)
        }
        const active = i < 250
        assert.equal(
          (await store.jobs.insertJob(mkJob(owner, { kind: 'panel', queue: 'image', projectId: crypto.randomUUID(), payload: { kind: 'panel', chapterId: 'c', pageIndex: 0, index: 0 }, status: active ? 'queued' : 'failed', outcome: active ? null : 'failed', resultImageId, createdAt: at(i), updatedAt: at(i) }))).created,
          true
        )
      }
      const record = await deletionJob(owner)
      assert.deepEqual(await deleteAccount(record, depsOf(null)), { outcome: 'done' })
      assert.deepEqual((await store.jobs.listJobs({ ownerId: owner, limit: 10 })).map((j) => j.id), [record.id], 'only the deletion’s own record is left')
      for (const id of pictures) assert.equal(await store.getBlob(id), null, 'every stored picture went with its job')
      await store.jobs.deleteJob(record.id)
      ok(`${where} deletion: 450 job records (250 of them active) and ${pictures.length} stored pictures are cancelled, deleted and swept in pages, ending with only the deletion’s own record`)
    }

    // 9k. A job that is drawing when its owner's project is deleted ends calmly: the panel engine answers a vanished project with "skipped" (nothing drawn, nothing thrown),
    // and a re-run of a job the deletion already cancelled is never claimed again. (No change to panels.ts was needed.)
    {
      const { inkPanel } = await import('../lib/panels')
      const { adhocRun } = await import('../lib/queue/run')
      const { processJob } = await import('../lib/queue/processors')
      const owner = 'user_vanish'
      const seed = await seedDesk(owner, 'Vanishing')
      const addr = { projectId: seed.projects[0], chapterId: (await store.readProject(seed.projects[0])).chapters[0].id, pageIndex: 0 }
      const record = await deletionJob(owner)
      await deleteAccount(record, depsOf(null))
      await store.jobs.deleteJob(record.id)
      const quiet = console.warn
      console.warn = () => {}
      try {
        assert.deepEqual(await inkPanel(addr, 0, adhocRun()), { outcome: 'skipped', error: 'There is no such project.' })
      } finally {
        console.warn = quiet
      }
      // The job record the deletion cancelled (or deleted) is not claimed when BullMQ delivers it again.
      assert.equal(await processJob(seed.jobs.running, { workerId: 'w-late' }), 'skipped')
      assert.equal(await processJob(seed.jobs.queued, { workerId: 'w-late' }), 'skipped')
      assert.deepEqual(await leftovers(seed), [])
      ok(`${where} deletion: a worker that draws into a project the deletion removed ends "skipped" with the studio’s sentence, and a job it cancelled is never claimed again`)
    }

    // 9l. A picture the person replaced is deleted with the replacement (a redraw, a reroll, an import over a drawn sheet), unless the shelf or
    // another card still shows it (an imported sheet IS the shelf's picture) — so the deletion never has a sheet to find that no record names.
    {
      const { landImage } = await import('../lib/images')
      const { attachSheet, importSheet, replaceCharacter } = await import('../lib/cast')
      const { update } = await import('../lib/chapter')
      const owner = 'user_sheets'
      const seed = await seedDesk(owner, 'Sheetswap')
      const pid = seed.projects[0]
      const before = await store.readProject(pid)
      const sheet0 = before.library.characters[0].sheetImageId!
      const shelf = before.library.assets[0]
      await store.updateProject(pid, (p) => ({ ...p, library: { ...p.library, characters: p.library.characters.map((c) => ({ ...c, locked: false })) } }))
      const exists = async (id: string) => (await store.getBlob(id)) !== null
      const draw = async (n: number) => {
        const id = await store.putBlob(pngOf('Sheetswap', n), 'image/png', 'sheet')
        await landImage(pid, id, (c, imageId) => attachSheet(c, 'c1', `dna ${n}`, imageId), 0)
        return id
      }
      const sheet1 = await draw(201)
      assert.equal(await exists(sheet0), false, 'a redrawn sheet’s old picture is deleted')
      assert.ok(await exists(sheet1), 'the new one is kept')
      await update(pid, (c) => importSheet(c, 'c1', shelf.id))
      assert.equal(await exists(sheet1), false, 'an import over a drawn sheet deletes the drawn one')
      assert.ok(await exists(shelf.blobId), 'but the imported picture is the shelf’s and stays')
      const sheet2 = await draw(202)
      assert.ok(await exists(shelf.blobId), 'drawing over an imported sheet leaves the shelf’s picture alone')
      assert.ok(await exists(sheet2))
      await update(pid, (c) => replaceCharacter(c, 'c1', { name: 'Fresh', role: 'rival', traits: ['calm'], look: 'a new look' }))
      assert.equal(await exists(sheet2), false, 'a reroll deletes the sheet that belonged to the old proposal')
      assert.ok(await exists(shelf.blobId))
      // A draw that lands the same picture again (a re-run) deletes nothing.
      const sheet3 = await draw(203)
      await landImage(pid, sheet3, (c, imageId) => attachSheet(c, 'c1', 'dna 203', imageId), 0, undefined, (c, id) => c.cast.some((x) => x.id === 'c1' && x.sheetImageId === id))
      assert.ok(await exists(sheet3))
      const record = await deletionJob(owner)
      assert.deepEqual(await deleteAccount(record, depsOf(null)), { outcome: 'done' })
      await store.jobs.deleteJob(record.id)
      for (const id of [sheet0, sheet1, sheet2, sheet3, shelf.blobId]) assert.equal(await exists(id), false, `${id} is gone after the deletion`)
      assert.deepEqual(await leftovers(seed), [])
      ok(`${where} deletion: a replaced sheet’s picture goes with the replacement (redraw, reroll, import over a drawn one), the shelf’s picture and a re-landed one stay, and nothing of the sheets is left after the account goes`)
    }

    // 9m. A picture that lands while the project is being deleted (a cancelled worker is not stopped) is found and deleted before the project goes.
    {
      const { landImage } = await import('../lib/images')
      const owner = 'user_late'
      const seed = await seedDesk(owner, 'Latepaint')
      const record = await deletionJob(owner)
      const late = await store.putBlob(pngOf('Latepaint', 300), 'image/png', 'panel')
      const realDelete = store.deleteBlob
      let fired = false
      store.deleteBlob = async (id: string) => {
        const index = seed.heldBy.get(id)
        if (!fired && index !== undefined) {
          fired = true
          await landImage(seed.projects[index], late, (c, imageId) => ({ ...c, script: c.script && c.script.map((p, i) => (i === 0 ? { ...p, versions: [...p.versions, { imageId, createdAt: at(0) }] } : p)) }), 0)
        }
        return realDelete.call(store, id)
      }
      try {
        assert.deepEqual(await deleteAccount(record, depsOf(null)), { outcome: 'done' })
      } finally {
        store.deleteBlob = realDelete
      }
      assert.ok(fired, 'the late picture landed while the sweep was deleting')
      await store.jobs.deleteJob(record.id)
      assert.equal(await store.getBlob(late), null, 'the picture that landed mid-sweep was deleted too')
      assert.deepEqual(await leftovers(seed), [])
      ok(`${where} deletion: a picture that lands from a worker still drawing, between the sweep’s read of a project and its delete, is found and deleted before the project goes`)
    }

    // 9n. A job made after the cancel (a second tab, a session not ended yet) still has its hold released when its record is swept, and so has an
    // ended job whose settle never ran: no record is deleted while it still holds quota or spend.
    {
      const { reserve } = await import('../lib/limits')
      const owner = 'user_latejob'
      const seed = await seedDesk(owner, 'Latejob')
      const record = await deletionJob(owner)
      const planted: string[] = []
      const plant = async (over: Partial<JobRecord>) => {
        const job = mkJob(owner, { kind: 'panel', projectId: seed.projects[0], payload: { kind: 'panel', chapterId: 'c', pageIndex: 0, index: 3 }, queue: 'image', reservation: 'held', reservedUsd: 0.05, ...over })
        await reserve({ id: job.id, userId: owner, units: { image: 1 }, usd: 0.05 })
        assert.equal((await store.jobs.insertJob(job)).created, true)
        planted.push(job.id)
      }
      await deleteAccount(record, depsOf(null, async (step) => {
        if (step !== 'cancelled') return
        await plant({ status: 'queued' })
        await plant({ status: 'running', workerId: 'w-late', attempts: 1, leaseUntil: new Date(Date.now() + 600_000).toISOString(), startedAt: at(1) })
        await plant({ status: 'failed', outcome: 'failed', error: 'x', finishedAt: at(2) }) // ended, settle never ran
      }))
      assert.equal(planted.length, 3)
      await store.jobs.deleteJob(record.id)
      for (const id of planted) {
        assert.equal(await store.jobs.getJob(id), null, 'the record is gone')
        assert.equal(await backend().hold(id), null, `and its hold was released (${id})`)
      }
      assert.deepEqual(await leftovers(seed), [])
      ok(`${where} deletion: jobs made after the cancel, and an ended job never settled, give their holds back before their records are deleted`)
    }

    // 9o. Whatever the person makes in the seconds their sign-in lasts (the sign-in is ended last) is swept after it, before the job says done.
    {
      const owner = 'user_lastminute'
      const seed = await seedDesk(owner, 'Lastminute')
      const record = await deletionJob(owner)
      const extra = crypto.randomUUID()
      const signIn = {
        calls: [] as string[],
        deleteUser: async (id: string): Promise<void> => {
          signIn.calls.push(id)
          await store.createProject({ ...emptyProject({ id: extra, chapterId: crypto.randomUUID(), title: 'Last minute', stylePresetId: 'manga-bw', serverRunId: 'check' }), ownerId: owner })
        },
      }
      assert.deepEqual(await deleteAccount(record, depsOf(signIn)), { outcome: 'done' })
      assert.equal(await store.projectStamp(extra), null, 'a project made while the sign-in was being ended is swept before done')
      await store.jobs.deleteJob(record.id)
      assert.deepEqual(await leftovers(seed), [])
      ok(`${where} deletion: a project made while the sign-in was being ended is swept before the job says done`)
    }

    // 9p. A picture only the live share was holding (a redraw dropped it from the panel; the link still lists it) is deleted with the account:
    // no record of the person's names it any more, so the deletion's sweep could not find it.
    {
      const owner = 'user_pinned'
      const seed = await seedDesk(owner, 'Pinned')
      const pinnedOnly = await store.putBlob(pngOf('Pinned', 400), 'image/png', 'panel')
      seed.images.set(pinnedOnly, pngOf('Pinned', 400))
      const kept = [...seed.images.keys()][4] // a panel the project still keeps, which the link also lists
      assert.ok(kept)
      const base = snapshotOf('Pinned link')
      const listing: MangaSnapshot = { ...base, pages: [{ index: 0, panels: base.pages[0].panels.map((panel, i) => ({ ...panel, imageId: i === 0 ? pinnedOnly : i === 1 ? kept : panel.imageId })) }] }
      assert.ok(await store.shares.refresh(seed.tokens[0], listing, at(3)), 'the live link lists both')
      const record = await deletionJob(owner)
      assert.deepEqual(await deleteAccount(record, depsOf(null)), { outcome: 'done' })
      await store.jobs.deleteJob(record.id)
      assert.equal(await store.getBlob(pinnedOnly), null, 'the picture only the link held is deleted with the account')
      assert.equal(await store.getBlob(kept), null)
      assert.deepEqual(await leftovers(seed), [])
      ok(`${where} deletion: a picture only the live link was holding goes with the account`)
    }

    // 9q. A deletion that failed leaves a live, signed-in person with a tombstone (the sign-in is ended last). Once its failed record is pruned the
    // state must not read `done` — that sends the Data page to /sign-in on every visit and hides the Delete card for good.
    {
      const { deleteState } = await import('../lib/account/state')
      const { KEEP_FINISHED_MS } = await import('../lib/queue/jobs')
      const owner = 'user_leftfailed'
      await store.users.markDeleted(owner)
      assert.deepEqual(await deleteState(owner), { state: 'done' }, 'a tombstone with no job, fresh, is a deletion that has just finished')
      assert.deepEqual(await deleteState(owner, Date.now() + KEEP_FINISHED_MS + 60_000), { state: 'none' }, 'a tombstone older than a failed record lasts, with no job, is nothing under way')
      ok(`${where} deletion: a tombstone with no job reads done only while it is younger than a failed record would have lasted; after that the person may start again`)
    }

    // 9r. A settle that could not land (the counters did not answer) must not let the record go: nothing could settle its hold afterwards.
    {
      const { reserve } = await import('../lib/limits')
      const owner = 'user_unsettled'
      const seed = await seedDesk(owner, 'Unsettled')
      const record = await deletionJob(owner)
      const job = mkJob(owner, { kind: 'panel', projectId: seed.projects[0], payload: { kind: 'panel', chapterId: 'c', pageIndex: 0, index: 3 }, queue: 'image', status: 'failed', outcome: 'failed', error: 'x', finishedAt: at(2), reservation: 'held', reservedUsd: 0.05 })
      await reserve({ id: job.id, userId: owner, units: { image: 1 }, usd: 0.05 })
      assert.equal((await store.jobs.insertJob(job)).created, true)
      const b = backend() as unknown as { finish: (...a: unknown[]) => Promise<unknown> }
      const realFinish = b.finish
      const warn = console.warn
      console.warn = () => {}
      b.finish = () => Promise.reject(new Error('redis is down'))
      try {
        await assert.rejects(deleteAccount(record, depsOf(null)), /could not settle the hold/, 'the deletion throws for the queue to retry')
      } finally {
        b.finish = realFinish
        console.warn = warn
      }
      assert.ok(await store.jobs.getJob(job.id), 'the record is still there to settle')
      assert.ok(await backend().hold(job.id), 'and so is its hold')
      assert.deepEqual(await deleteAccount(record, depsOf(null)), { outcome: 'done' }, 'the retry settles it and finishes')
      assert.equal(await store.jobs.getJob(job.id), null)
      assert.equal(await backend().hold(job.id), null, 'the hold was released before the record went')
      await store.jobs.deleteJob(record.id)
      assert.deepEqual(await leftovers(seed), [])
      ok(`${where} deletion: a job whose hold could not be settled keeps its record, and the deletion is retried, until the hold is given back`)
    }
  } finally {
    await closeProducerRedis().catch(() => {})
    if (redisProc) {
      redisProc.kill()
      delete env.REDIS_URL
      resetBackend()
    }
  }

  // =====================================================================================
  // 14. The cloud adapter without a server: big uploads, the outputs bucket, a duplicate share (lens "cloud")
  //     Stand-ins are plain HTTP servers and a fake collection on this machine, so it runs in both modes.
  // =====================================================================================
  {
    const cloudLib = await import('../lib/store/cloud')
    const { s3Client, uploadTimeoutMs, isTransientUpload, putFile, probeBuckets, createShareDoc, S3_TIMEOUTS } = cloudLib
    const http = await import('node:http')
    const { MongoServerError } = await import('mongodb')
    type Req = import('node:http').IncomingMessage
    type Res = import('node:http').ServerResponse
    const serve = async (handler: (req: Req, res: Res) => void, onContinue?: (req: Req, res: Res) => void) => {
      const server = http.createServer(handler)
      if (onContinue) server.on('checkContinue', onContinue)
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const port = (server.address() as import('node:net').AddressInfo).port
      return { port, endpoint: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))) }
    }
    const clientFor = (endpoint: string, timeouts: { connectionTimeout: number; requestTimeout: number; socketTimeout: number } = S3_TIMEOUTS) => s3Client({ endpoint, region: 'us-east-1', accessKeyId: 'check', secretAccessKey: 'check', forcePathStyle: true }, timeouts)
    const bigFile = join(dir, 'big-upload.bin')
    await writeFile(bigFile, randomBytes(1_500_000))

    // 14a. The sizing of the per-call timeout: never under the client's own, one second per MB/s of the floor rate above it.
    assert.equal(uploadTimeoutMs(1000), S3_TIMEOUTS.requestTimeout, 'a small body keeps the client’s timeout')
    assert.equal(uploadTimeoutMs(400 * 1024 * 1024), 400_000, 'a 400 MB export may take 400 s at the slowest link the studio waits for (1 MB/s)')
    assert.ok(uploadTimeoutMs(400 * 1024 * 1024) > uploadTimeoutMs(100 * 1024 * 1024), 'and grows with the size')

    // 14b. A body that is still arriving is not a timeout: 1.5 MB at ~0.5 MB/s takes ~3 s against a client that gives a whole request 0.4 s.
    let received = 0
    const throttled = await serve((req, res) => {
      req.on('data', (chunk: Buffer) => {
        received += chunk.length
        req.pause()
        setTimeout(() => req.resume(), (chunk.length / 500_000) * 1000)
      })
      req.on('end', () => res.writeHead(200).end())
    })
    const tight = { connectionTimeout: 1000, requestTimeout: 400, socketTimeout: 5000 }
    const slowClient = clientFor(throttled.endpoint, tight)
    const began = Date.now()
    await putFile(slowClient, { Bucket: 'b', Key: 'outputs/big.zip' }, bigFile, 1_500_000, { floorMs: 400, minBytesPerSec: 100_000 })
    assert.ok(received >= 1_500_000 && received < 1_501_000, `the whole file arrived (${received} bytes with the SDK’s framing)`)
    assert.ok(Date.now() - began > 1000, `slowly (${Date.now() - began} ms) — past the client’s own request timeout`)
    slowClient.destroy()
    await throttled.close()

    // 14c. An endpoint that never answers `Expect: 100-continue` is not waited on: the body is sent without asking.
    let sentExpect: string | undefined
    let expectBytes = 0
    const mute = await serve(
      (req, res) => {
        sentExpect = req.headers.expect
        req.on('data', (chunk: Buffer) => (expectBytes += chunk.length))
        req.on('end', () => res.writeHead(200).end())
      },
      () => {} // sees the Expect header and says nothing, ever
    )
    const patient = clientFor(mute.endpoint, { connectionTimeout: 1000, requestTimeout: 2000, socketTimeout: 5000 })
    await putFile(patient, { Bucket: 'b', Key: 'outputs/big.zip' }, bigFile, 1_500_000)
    assert.ok(expectBytes >= 1_500_000, 'the body went without waiting for a 100 Continue')
    assert.equal(sentExpect, undefined, 'and no Expect header was sent')
    patient.destroy()
    await mute.close()

    // 14d. Only a failure that can pass is tried again: a refused key is one request, a 503 and a reset are three.
    const hits: Record<string, number> = {}
    const flaky = await serve((req, res) => {
      const which = String(req.url).split('/')[1] ?? ''
      hits[which] = (hits[which] ?? 0) + 1
      req.resume()
      req.on('end', () => {
        if (which === 'denied') res.writeHead(403, { 'content-type': 'application/xml' }).end('<Error><Code>AccessDenied</Code><Message>no</Message></Error>')
        else if (which === 'busy') res.writeHead(503, { 'content-type': 'application/xml' }).end('<Error><Code>SlowDown</Code><Message>later</Message></Error>')
        else if (which === 'flaky' && hits[which] < 3) req.socket.destroy()
        else res.writeHead(200).end()
      })
    })
    const retrying = clientFor(flaky.endpoint)
    const tiny = join(dir, 'tiny-upload.bin')
    await writeFile(tiny, randomBytes(2000))
    await assert.rejects(putFile(retrying, { Bucket: 'denied', Key: 'k' }, tiny, 2000), /AccessDenied|Forbidden|denied/i)
    assert.equal(hits.denied, 1, 'AccessDenied: one request, not three')
    await assert.rejects(putFile(retrying, { Bucket: 'busy', Key: 'k' }, tiny, 2000))
    assert.equal(hits.busy, 3, 'a 503 is tried three times')
    await putFile(retrying, { Bucket: 'flaky', Key: 'k' }, tiny, 2000)
    assert.equal(hits.flaky, 3, 'a reset connection is tried again, and the third time works')
    assert.equal(isTransientUpload(Object.assign(new Error('x'), { name: 'TimeoutError' })), true)
    assert.equal(isTransientUpload(Object.assign(new Error('x'), { name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } })), false)
    assert.equal(isTransientUpload(new Error('boom')), false)
    retrying.destroy()
    await flaky.close()
    await rm(bigFile, { force: true })
    await rm(tiny, { force: true })
    ok('cloud adapter: a big upload gets a timeout sized to its bytes, never waits on 100-continue, and only a failure that can pass is tried again')

    // 14e. The outputs bucket is checked like the project-files bucket: written, read, and listed.
    const buckets: Record<string, { objects: Set<string>; list: boolean }> = {
      images: { objects: new Set(), list: true },
      exports: { objects: new Set(), list: true },
      nolist: { objects: new Set(), list: false },
    }
    const listCalls: string[] = []
    const s3Stand = await serve((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      const [, bucket, ...rest] = url.pathname.split('/')
      const key = rest.join('/')
      const found = buckets[bucket]
      const fail = (status: number, code: string) => res.writeHead(status, { 'content-type': 'application/xml' }).end(`<Error><Code>${code}</Code><Message>${code}</Message></Error>`)
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        if (!found) return fail(404, 'NoSuchBucket')
        if (req.method === 'PUT') return void (found.objects.add(key), res.writeHead(200).end())
        if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
          listCalls.push(bucket)
          return found.list ? void res.writeHead(200, { 'content-type': 'application/xml' }).end('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>') : fail(403, 'AccessDenied')
        }
        if (req.method === 'GET') return found.objects.has(key) ? void res.writeHead(200).end('probe') : fail(404, 'NoSuchKey')
        return fail(405, 'MethodNotAllowed')
      })
    })
    const probing = clientFor(s3Stand.endpoint)
    await probeBuckets(probing, { projectFiles: 'images', outputs: 'exports' }, 'inkdesk/')
    assert.ok(buckets.images.objects.has('inkdesk/inkdesk-bucket-check.txt') && buckets.exports.objects.has('inkdesk/inkdesk-bucket-check.txt'), 'both buckets got the probe object')
    assert.deepEqual(listCalls, ['exports'], 'and the outputs bucket was listed')
    listCalls.length = 0
    await probeBuckets(probing, { projectFiles: 'images', outputs: 'images' }, 'inkdesk/')
    assert.deepEqual(listCalls, ['images'], 'one bucket for both: still listed (the exports need it)')
    await assert.rejects(probeBuckets(probing, { projectFiles: 'images', outputs: 'typo' }, 'inkdesk/'), /NoSuchBucket|does not exist|specified bucket/i, 'a mistyped outputs bucket is found at connect')
    await assert.rejects(probeBuckets(probing, { projectFiles: 'images', outputs: 'nolist' }, 'inkdesk/'), /AccessDenied|Forbidden|denied/i, 'a key that can write but not list is found at connect')
    probing.destroy()
    await s3Stand.close()
    ok('cloud adapter: the outputs bucket is probed at connect (write, read, list), so a wrong bucket or a key that cannot list is found there, not in a deletion')

    // 14f. A share offered a taken token for a project that already has an active one: the idempotent answer, as the local store gives.
    const holder = { _id: 'holderTokenholderToken', activeProject: 'p-1', projectId: 'p-1', ownerId: ALICE, revokedAt: null }
    const dup = (keyPattern: Record<string, number>) => new MongoServerError({ message: 'E11000 duplicate key', code: 11000, keyPattern })
    const fake = (insertError: Error | null, found: unknown) => ({
      insertOne: async () => {
        if (insertError) throw insertError
        return {}
      },
      findOne: async () => found,
    })
    const run = (insertError: Error | null, found: unknown) => (op: (collection: never) => Promise<unknown>) => op(fake(insertError, found) as never)
    const offeredDoc = { _id: 'revokedTokenrevokedTo', activeProject: 'p-1', projectId: 'p-1', ownerId: ALICE, revokedAt: null }
    // MongoDB names the _id index first when both unique indexes are broken.
    const both = await createShareDoc(run(dup({ _id: 1 }), holder) as never, offeredDoc as never)
    assert.deepEqual([both.created, both.share.token], [false, 'holderTokenholderToken'], 'taken token + active project: the active share is returned')
    await assert.rejects(createShareDoc(run(dup({ _id: 1 }), null) as never, { ...offeredDoc, activeProject: undefined } as never), /already taken/, 'a taken token for a free project is refused')
    await assert.rejects(createShareDoc(run(dup({ _id: 1 }), null) as never, offeredDoc as never), /already taken/, 'and when nobody holds the project, the token is what is taken')
    const byProject = await createShareDoc(run(dup({ activeProject: 1 }), holder) as never, offeredDoc as never)
    assert.equal(byProject.created, false, 'only the project index broken: the active share')
    await assert.rejects(createShareDoc(run(new Error('network'), null) as never, offeredDoc as never), /network/, 'any other error is thrown')
    ok('cloud adapter: a share create offered a taken token, for a project that has an active share, answers with that share (created: false)')
  }

  // 10-13. The slice's other checks, each a script with its own scratch desk, run here so ONE command holds the slice.
  //   10 sharing   scripts/share-check-sharing.mts   snapshot allow-list, owner API, public page / JSON / pictures / preview, revoke, windows, XSS, a video share
  //   11 reports   scripts/share-check-reports.mts   the report route, what is stored, the window, admin gating, admin actions
  //   12 settings  scripts/share-check-settings.mts  the Defaults route: strict body, isolation, the reserved voices
  //   13 polling   scripts/poll-check.mts            the light status route and the poller's schedule (CR-8)
  // They use the local store and say so; the cloud run (INKDESK_STORAGE=cloud) holds the store sections above only.
  if (!CLOUD) {
    const childEnv = { ...process.env }
    delete childEnv.INKDESK_DATA_DIR // each one makes its own scratch desk
    for (const [n, name, script] of [
      [10, 'sharing', 'share-check-sharing'],
      [11, 'reports', 'share-check-reports'],
      [12, 'settings', 'share-check-settings'],
      [13, 'polling', 'poll-check'],
    ] as const) {
      const child = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'scripts', `${script}.mts`)], { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
      let said = ''
      child.stdout.on('data', (chunk: Buffer) => (said += chunk.toString()))
      child.stderr.on('data', (chunk: Buffer) => (said += chunk.toString()))
      const code = await new Promise<number | null>((resolve) => child.on('close', resolve))
      if (code !== 0) console.log(said)
      assert.equal(code, 0, `${script} exits 0`)
      assert.ok(/all passed/.test(said), `${script} says it passed`)
      ok(`${n} ${name}: scripts/${script}.mts passed (${said.split('\n').filter((l) => /^\s+ok\s/.test(l)).length} assertions listed)`)
    }
  }

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

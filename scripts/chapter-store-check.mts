// The store's acceptance check — v1's Chapter Store rules
// (`devpost/spec.md > Components > Chapter Store`) carried onto the v2 local
// store (`spec.md > Storage Adapter (v2)`), plus the one-time migration of a
// v1 desk (`spec.md > Data Model (v2)`). Run with:
//
//   npm run check:store
//
// Against a scratch folder: a hand-built version-1 `chapter.json` migrates into
// one project with every image id and bubble intact and the file byte-identical;
// a second listing does not migrate it twice; two projects update independently
// in the same tick; same-tick updates to one project both land; four concurrent
// increments read back as 4 (the lost-update canary); a failing update neither
// wedges the chain nor corrupts the file; no temp file is left behind.
//
// The cloud half (slice 13, `spec.md > Storage Adapter (v2)`): the mode switch
// and the missing-settings sentence — each setting named by both names it
// accepts (v3: `MONGODB_URI (or DB_URL)`) — and the optimistic `rev` update
// against a collection that loses races on purpose — always. So are the v3
// rules that need no server: an unreadable project is a calm 500 and a named
// warning (CR-14), images stream (CR-17), and an S3 call on a socket that never
// answers ends in time (CR-6).
//
// Slice 18, on the local desk always and on the cloud store in its half: the
// job records (`JobStore`) — round trip, one active job per key (a finished
// key can be used again), refused transitions answering null, a finished job
// giving up its key, listing filters and order, pruning — and `deleteBlob`.
// And the rule that makes web + worker safe (CR-3): TWO PROCESSES, each doing
// 150 increments on one project, lose none (300 land, the file parses, no temp
// file or lock is left); two processes racing `insertJob` for one key produce
// exactly one job; two processes creating one project id, or migrating one v1
// desk, produce exactly one. The children are this same file run with
// `--child <role>`.
//
// Then, only when a Mongo URL is set (MONGODB_URI or DB_URL, with the database
// and the `S3_*` variables) AND `INKDESK_CHECK_CLOUD=yes` — a shell can carry
// another app's DB_URL, and this check writes — the same rules against a real
// MongoDB and bucket: a scratch database named `<database>-check-<random>`,
// dropped at the end, and only the objects this check wrote, deleted at the
// end. The buckets must already exist. Whichever name is in effect for a
// setting is the one the check changes, so the learner's names are exercised
// as they are.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { JobStore } from '../lib/store'
import type { JobRecord } from '../lib/queue/jobs'

// A child of the cross-process tests (see the bottom of this file): it does its
// share against the shared data folder or database, prints one JSON line and
// exits — it never reaches the check below.
if (process.argv[2] === '--child') {
  await runChild(process.argv.slice(3))
  process.exit(0)
}

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-store-'))
process.env.INKDESK_DATA_DIR = dir
// The local half runs on the local store whatever the shell exports; the
// cloud half below talks to the cloud store directly.
process.env.INKDESK_STORAGE = 'local'

// Imported after the env is set, because the store reads it at load.
const { createProject, listProjects, migrateLegacy, read, update } = await import('../lib/chapter')
const { migrateV1 } = await import('../lib/migrate')
const { singletons } = await import('../lib/singleton')

import type { ChapterV1 } from '../lib/migrate'
import type { Panel } from '../lib/types'

const at = '2026-10-12T20:00:00.000Z'
const panel = (index: 0 | 1 | 2 | 3, characterId: string, over: Partial<Panel> = {}): Panel => ({
  index,
  characterId,
  action: `beat ${index + 1}`,
  camera: 'eye level',
  background: 'rooftop',
  dialogue: `line ${index + 1}`,
  versions: [{ imageId: `panel-${index}-v1.png`, createdAt: at }],
  currentVersion: 0,
  status: 'done',
  startedAt: null,
  startedByRun: null,
  ...over,
})
const placed = { x: 62, y: 5, w: 34, h: 30, tailX: 51.8, tailY: 26.1 }
const v1: ChapterV1 = {
  version: 1,
  serverRunId: 'an-old-run',
  station: 'reader',
  pitch: { text: 'a courier', genre: 'Shonen', tone: 'Fast-paced' },
  synopsis: { title: 'Return to Sender', body: 'Kaito meets Mio.', accepted: true },
  cast: [
    { id: 'kaito', name: 'Kaito', role: 'courier', traits: ['quick'], look: 'scarf', dna: 'kaito dna', sheetImageId: 'sheet-k.png', locked: true },
    { id: 'mio', name: 'Mio', role: 'rival', traits: ['wry'], look: 'glasses', dna: 'mio dna', sheetImageId: 'sheet-m.png', locked: true },
  ],
  script: [
    panel(0, 'kaito', { bubble: placed }),
    panel(1, 'mio'),
    panel(2, 'kaito', { versions: [{ imageId: 'panel-2-v1.png', createdAt: at }, { imageId: 'panel-2-v2.png', createdAt: at }], currentVersion: 1 }),
    panel(3, 'mio', { bubble: null }),
  ],
  imageCount: 6,
  updatedAt: at,
}

try {
  // 1. The v1 desk migrates once, whole, and the v1 file is never touched.
  const v1Bytes = JSON.stringify(v1, null, 2)
  await writeFile(join(dir, 'chapter.json'), v1Bytes)
  const listed = await listProjects()
  assert.equal(listed.length, 1, 'one project after the migration')
  const migrated = await read(listed[0].id)
  assert.equal(migrated.title, 'Return to Sender', 'the synopsis title names the project')
  assert.equal(migrated.stylePresetId, 'manga-bw', 'v1 drew in the manga rules')
  assert.deepEqual(migrated.cast, v1.cast, 'every character, DNA and sheet id, verbatim')
  assert.deepEqual(migrated.script, v1.script, 'every panel, version, bubble and image id, verbatim')
  assert.deepEqual(migrated.pitch, v1.pitch)
  assert.deepEqual(migrated.synopsis, v1.synopsis)
  assert.equal(migrated.imageCount, 6)
  assert.equal(migrated.costUsd, 0, 'v1 never stored cost; the readout starts at zero')
  assert.equal(migrated.station, 'reader')
  assert.equal(migrated.pageCount, 1)
  assert.equal(listed[0].thumbnailImageId, 'panel-0-v1.png', 'the first inked panel is the card’s thumbnail')
  assert.equal(listed[0].pagesInked, 1)
  assert.equal(await readFile(join(dir, 'chapter.json'), 'utf8'), v1Bytes, 'the v1 file is byte-identical')
  assert.deepEqual((await readdir(dir)).sort(), ['chapter.json', 'projects'])
  assert.ok((await readdir(join(dir, 'projects'))).includes('v1-migrated.json'), 'the marker exists')
  assert.equal((await listProjects()).length, 1, 'a second listing does not migrate it twice')
  // The pure mapping, directly: ids and run stamp are the caller's.
  const pure = migrateV1(v1, { projectId: 'p', chapterId: 'c' }, 'run', at)
  assert.equal(pure.chapters[0].pages[0].panels.length, 4)
  assert.equal(pure.migratedFrom, 'chapter.json')
  console.log('  ok  the v1 desk migrated into one project, whole, once; chapter.json untouched')

  // 2. Two projects, two locks: same-tick updates land in their own files.
  const a = (await createProject({ title: 'A', stylePresetId: 'manga-bw' })).address.projectId
  const b = (await createProject({ title: 'B', stylePresetId: 'manhwa-colour' })).address.projectId
  assert.notEqual(a, b)
  await Promise.all([
    update(a, (c) => ({ ...c, pitch: { ...c.pitch, text: 'for A' } })),
    update(b, (c) => ({ ...c, pitch: { ...c.pitch, text: 'for B' } })),
  ])
  assert.equal((await read(a)).pitch.text, 'for A')
  assert.equal((await read(b)).pitch.text, 'for B')
  assert.equal((await read(b)).stylePresetId, 'manhwa-colour')
  assert.equal((await listProjects()).length, 3)
  await assert.rejects(read('nope'), /no such project/)
  await assert.rejects(read('../etc'), /no such project/, 'a path is never a project id')
  console.log('  ok  two projects update independently; an unknown or unsafe id is a 404')

  // 3. Two updates in the same tick, touching different fields: both land.
  const [u1, u2] = await Promise.all([
    update(a, (c) => ({ ...c, pitch: { ...c.pitch, text: 'first writer' } })),
    update(a, (c) => ({ ...c, pitch: { ...c.pitch, genre: 'Shonen' } })),
  ])
  assert.equal(u1.pitch.text, 'first writer')
  assert.equal(u2.pitch.text, 'first writer', 'second update must see the first one’s write')
  assert.equal(u2.pitch.genre, 'Shonen')
  const onDisk = JSON.parse(await readFile(join(dir, 'projects', a, 'project.json'), 'utf8'))
  assert.equal(onDisk.story.pitch.text, 'first writer', 'first write was erased on disk')
  assert.equal(onDisk.story.pitch.genre, 'Shonen', 'second write was erased on disk')
  assert.equal(onDisk.version, 2)
  console.log('  ok  two same-tick updates both survived in project.json')

  // 4. The counter canary: four concurrent increments read back as 4.
  await Promise.all([0, 1, 2, 3].map(() => update(a, (c) => ({ ...c, imageCount: c.imageCount + 1 }))))
  assert.equal((await read(a)).imageCount, 4, 'a lost update shows up as imageCount < 4')
  console.log('  ok  imageCount after four concurrent increments is 4')

  // 5. A failing update rejects on its own and leaves the file untouched...
  await assert.rejects(
    update(a, () => {
      throw new Error('boom')
    }),
    /boom/
  )
  // ...and the next update still goes through.
  const after = await update(a, (c) => ({ ...c, station: 'cast' }))
  assert.equal(after.station, 'cast')
  assert.equal(after.imageCount, 4)
  console.log('  ok  a failed update neither wedges the chain nor corrupts the file')

  // 6. No torn file: the temp file never outlives a write, and each update
  //    keeps the version before it as project.json.bak (CR-14).
  for (const id of [a, b]) {
    const files = (await readdir(join(dir, 'projects', id))).sort()
    assert.deepEqual(files, ['project.json', 'project.json.bak'], `unexpected files left behind in ${id}: ${files.join(', ')}`)
  }
  const backup = JSON.parse(await readFile(join(dir, 'projects', a, 'project.json.bak'), 'utf8'))
  assert.equal(backup.station, 'story', 'the backup is the version before the last update')
  assert.equal((await read(a)).station, 'cast')
  console.log('  ok  only project.json and its backup in each project folder — no stray temp file')

  // 7. Nothing unreadable takes the desk down: a torn project.json opens
  //    from its backup; a broken project with no good backup is listed as a
  //    "can't be read" card with a warning, never hidden; a broken v1 file is
  //    left alone and named in a sentence; and a garbage id is a 404 that
  //    never becomes a lock entry.
  const quiet = console.warn
  const warned: string[] = []
  console.warn = (...args: unknown[]) => void warned.push(args.map(String).join(' '))
  try {
    // A torn write (CR-14): project.json cut short, the backup intact.
    const whole = await readFile(join(dir, 'projects', a, 'project.json'), 'utf8')
    await writeFile(join(dir, 'projects', a, 'project.json'), whole.slice(0, 200))
    const recovered = await read(a)
    assert.equal(recovered.station, 'story', 'a torn project.json opens from its backup')
    assert.ok(warned.some((line) => line.includes(a) && line.includes('project.json.bak')), 'and the terminal says so')
    assert.equal((await listProjects()).find((p) => p.id === a)?.unreadable, undefined, 'it lists as itself, not as unreadable')
    const healed = await update(a, (c) => ({ ...c, station: 'cast' }))
    assert.equal(healed.station, 'cast')
    assert.equal(JSON.parse(await readFile(join(dir, 'projects', a, 'project.json'), 'utf8')).station, 'cast', 'the next save writes project.json whole again')
    assert.equal(JSON.parse(await readFile(join(dir, 'projects', a, 'project.json.bak'), 'utf8')).station, 'story', 'over the good backup, not the torn file')

    await mkdir(join(dir, 'projects', 'zzz-broken'), { recursive: true })
    await writeFile(join(dir, 'projects', 'zzz-broken', 'project.json'), '{ not json')
    const withBroken = await listProjects()
    assert.equal(withBroken.length, 4, 'a broken project.json is listed, and the others still list')
    const card = withBroken.find((p) => p.id === 'zzz-broken')
    assert.equal(card?.unreadable, true, 'as a “can’t be read” card, never hidden')
    assert.ok(card && !Number.isNaN(Date.parse(card.updatedAt)), 'dated by its folder')
    assert.equal(withBroken.filter((p) => !p.unreadable).length, 3)
    assert.ok(warned.some((line) => line.includes('zzz-broken')), 'the broken project is named in the terminal')
    // Opening it (CR-14): one calm sentence with a way back, a 500 — never a crash, never the parser's words.
    const { Refused: RefusedError } = await import('../lib/errors')
    const { UNREADABLE_PROJECT } = await import('../lib/store/local')
    const opened = await read('zzz-broken').then(
      () => assert.fail('a broken project must not open'),
      (err: unknown) => err
    )
    assert.ok(opened instanceof RefusedError && opened.status === 500, 'a broken project is a calm 500')
    assert.equal(opened.message, UNREADABLE_PROJECT)
    assert.match(UNREADABLE_PROJECT, /back to the desk/, 'with a way out')
    await assert.rejects(update('zzz-broken', (c) => c), (err: unknown) => err instanceof RefusedError && err.status === 500, 'an update of it is the same 500')
    assert.equal(await readFile(join(dir, 'projects', 'zzz-broken', 'project.json'), 'utf8'), '{ not json', 'and the file is left as it was')
    await mkdir(join(dir, 'projects', 'zzz-shapeless'), { recursive: true })
    await writeFile(join(dir, 'projects', 'zzz-shapeless', 'project.json'), JSON.stringify({ version: 2 }))
    assert.equal((await listProjects()).filter((p) => p.unreadable).length, 2, 'valid JSON without a project’s shape is listed as unreadable too, not a crash')
    await writeFile(join(dir, 'projects', 'zzz-shapeless', 'project.json.bak'), '{ also not json')
    await assert.rejects(read('zzz-shapeless'), (err: unknown) => err instanceof RefusedError && err.status === 500, 'a broken backup is no way in either')
    assert.ok(warned.some((line) => line.includes('zzz-shapeless')), 'and named')
    await assert.rejects(read('zzz-shapeless'), (err: unknown) => err instanceof RefusedError && err.status === 500, 'and opening it is the same calm 500')
    await rm(join(dir, 'projects', 'zzz-shapeless'), { recursive: true })
    await rm(join(dir, 'projects', 'v1-migrated.json'))
    await writeFile(join(dir, 'chapter.json'), '{ "version": 1, truncated')
    const outcome = await migrateLegacy()
    assert.equal(outcome.projectId, null)
    assert.match(outcome.problem ?? '', /chapter\.json/, 'the sentence names the file')
    assert.equal((await listProjects()).length, 4, 'nothing was migrated from a broken v1 file')
    assert.equal(await readFile(join(dir, 'chapter.json'), 'utf8'), '{ "version": 1, truncated', 'and it was left exactly as it was')
    await assert.rejects(update('../../etc', (c) => c), /no such project/)
    assert.equal(singletons.locks.has('../../etc'), false, 'a refused id never becomes a lock entry')
  } finally {
    console.warn = quiet
  }
  console.log('  ok  a torn project opens from its backup; a broken one is a named “can’t be read” card, opening it a calm 500 with a way back; a broken v1 file is named and left alone; a garbage id is a 404')

  // 8. The switch: unset is local, a typo is refused by name, and cloud mode
  //    without its settings names exactly what is missing.
  const { CLOUD_ENV, missingCloudEnv, missingCloudSentence, storageMode } = await import('../lib/store/env')
  const { CLOUD_VARIABLES } = await import('../lib/config')
  assert.equal(storageMode({}), 'local', 'unset means the local desk')
  assert.equal(storageMode({ INKDESK_STORAGE: ' cloud ' }), 'cloud')
  assert.throws(() => storageMode({ INKDESK_STORAGE: 'mongo' }), /"mongo".*"local".*"cloud"/)
  const full = Object.fromEntries(CLOUD_VARIABLES.map((name) => [name, 'x']))
  assert.deepEqual(missingCloudEnv(full), [])
  assert.deepEqual(
    missingCloudEnv({ ...full, MONGODB_DB: '', DB_DATABASE: undefined, S3_BUCKET_PROJECT_FILES: '  ', S3_BUCKET: '' }),
    ['MONGODB_DB (or DB_DATABASE)', 'S3_BUCKET_PROJECT_FILES (or S3_BUCKET)'],
    'blank counts as missing, under both names'
  )
  assert.deepEqual(missingCloudEnv({ ...full, MONGODB_URI: '', MONGODB_DB: ' ', S3_BUCKET_PROJECT_FILES: '' }), [], 'the learner’s names stand in: DB_URL, DB_DATABASE, S3_BUCKET')
  assert.equal(CLOUD_ENV.length, 7, 'seven settings, as before')
  assert.match(missingCloudSentence(['MONGODB_URI (or DB_URL)']), /MONGODB_URI \(or DB_URL\) is not set\. Add it to \.env, or set INKDESK_STORAGE=local/)
  assert.match(missingCloudSentence(['S3_REGION', 'S3_BUCKET_PROJECT_FILES (or S3_BUCKET)']), /S3_REGION, S3_BUCKET_PROJECT_FILES \(or S3_BUCKET\) are not set/)
  console.log('  ok  INKDESK_STORAGE: unset is local, a typo is refused, missing cloud settings are named by both their names')

  // 9. The rev contract, deterministically: a collection where another writer
  //    wins the first two races. `fn` runs again on what that writer left,
  //    the write lands on the third try, and nothing the other writer did is
  //    lost; a writer that never wins gets the calm sentence after the bound.
  const { MAX_UPDATE_ATTEMPTS, revUpdate } = await import('../lib/store/cloud')
  const { ProviderError } = await import('../lib/errors')
  type Doc = { _id: string; rev: number; project: ReturnType<typeof migrateV1> }
  const racing = (doc: Doc, losses: number) => {
    let toLose = losses
    return {
      doc,
      async findOne() {
        return structuredClone(doc)
      },
      async findOneAndUpdate(filter: { rev: number }, change: { $set: { project: Doc['project'] } }) {
        if (toLose > 0) {
          toLose--
          // The other process writes between our read and our write.
          doc.project = { ...doc.project, usage: { ...doc.project.usage, images: doc.project.usage.images + 1 } }
          doc.rev++
        }
        if (filter.rev !== doc.rev) return null
        doc.project = change.$set.project
        doc.rev++
        return { _id: doc._id }
      },
    }
  }
  const base = migrateV1(v1, { projectId: 'race', chapterId: 'c' }, 'run', at)
  const raced = racing({ _id: 'race', rev: 0, project: base }, 2)
  let runs = 0
  const won = await revUpdate(
    raced,
    'race',
    (p) => {
      runs++
      return { ...p, usage: { ...p.usage, costUsd: p.usage.costUsd + 1 } }
    },
    async () => {}
  )
  assert.equal(runs, 3, 'fn ran once per attempt: two lost races, one win')
  assert.equal(won.usage.images, 8, 'the other writer’s two increments survived')
  assert.equal(won.usage.costUsd, 1, 'and ours landed once, not three times')
  assert.equal(raced.doc.rev, 3)
  assert.deepEqual(raced.doc.project, won, 'the stored project is the one returned')
  const starved = racing({ _id: 'race', rev: 0, project: base }, Infinity)
  let starvedRuns = 0
  await assert.rejects(
    revUpdate(starved, 'race', (p) => (starvedRuns++, p), async () => {}),
    (err: unknown) => err instanceof ProviderError && err.kind === 'provider' && /busy/.test(err.message)
  )
  assert.equal(starvedRuns, MAX_UPDATE_ATTEMPTS, 'bounded: it gives up after MAX_UPDATE_ATTEMPTS')
  const kept = racing({ _id: 'race', rev: 0, project: base }, 0)
  await assert.rejects(
    revUpdate(kept, 'race', () => {
      throw new Error('boom')
    }),
    /boom/
  )
  assert.equal(kept.doc.rev, 0, 'a throwing fn writes nothing')
  console.log(`  ok  rev: a lost race re-reads and re-runs fn, nothing is lost, and it gives up calmly after ${MAX_UPDATE_ATTEMPTS}`)

  // 10. v3 without a server: images stream from disk (CR-17), a local desk's
  //     health needs nothing, and S3 calls are bounded in time (CR-6) — an
  //     endpoint that accepts the connection and never answers ends in an
  //     error, not a hang. S3_FORCE_PATH_STYLE reaches the client.
  const { localStore } = await import('../lib/store/local')
  const { mongoOptions, s3Client, S3_TIMEOUTS, MONGO_TIMEOUTS } = await import('../lib/store/cloud')
  const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
  const streamedId = await localStore.putBlob(pngBytes, 'image/png', 'panel')
  const streamed = await localStore.openBlob(streamedId)
  assert.ok(streamed, 'a stored image opens as a stream')
  assert.equal(streamed.bytes, pngBytes.length, 'with its size')
  assert.equal(streamed.mediaType, 'image/png')
  assert.ok(Buffer.from(await new Response(streamed.body).arrayBuffer()).equals(pngBytes), 'and the same bytes')
  assert.equal(await localStore.openBlob(`panel-${crypto.randomUUID()}.png`), null, 'a missing image is null')
  assert.equal(await localStore.openBlob('../chapter.json'), null, 'an unsafe id is null')
  assert.deepEqual(await localStore.health(2000), { mongo: 'n/a', bucket: 'n/a' })
  assert.deepEqual(mongoOptions('mongodb://h/'), { ignoreUndefined: true, ...MONGO_TIMEOUTS }, 'every Mongo timeout set')
  assert.equal(mongoOptions('mongodb://h/?socketTimeoutMS=500').socketTimeoutMS, undefined, 'a URI’s own timeout wins')
  assert.ok(S3_TIMEOUTS.requestTimeout > 0 && S3_TIMEOUTS.connectionTimeout > 0 && S3_TIMEOUTS.socketTimeout > 0)
  const net = await import('node:net')
  const held = new Set<import('node:net').Socket>()
  const silent = net.createServer((sock) => void held.add(sock.on('error', () => {}))) // accepts, never answers
  await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))
  const silentPort = (silent.address() as import('node:net').AddressInfo).port
  const { GetObjectCommand: Get } = await import('@aws-sdk/client-s3')
  const stuck = s3Client(
    { endpoint: `http://127.0.0.1:${silentPort}`, region: 'us-east-1', accessKeyId: 'check', secretAccessKey: 'check', forcePathStyle: true },
    { connectionTimeout: 300, requestTimeout: 300, socketTimeout: 300 }
  )
  const began = Date.now()
  await assert.rejects(stuck.send(new Get({ Bucket: 'b', Key: 'panel-x.png' })), 'a silent S3 endpoint is an error')
  assert.ok(Date.now() - began < 5_000, `and it ends in time (${Date.now() - began} ms)`)
  stuck.destroy()
  for (const sock of held) sock.destroy()
  await new Promise<void>((resolve) => silent.close(() => resolve()))
  // A bucket that sends its headers and a few bytes, then stalls: the SDK's
  // timers have stopped by then, so the body read is bounded on its own, and
  // giving up lets the socket go.
  const { idleLimited } = await import('../lib/store/cloud')
  const http = await import('node:http')
  let socketClosed = false
  const stalling = http.createServer((_req, res) => {
    res.socket?.on('close', () => void (socketClosed = true))
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': '1000' })
    res.write(Buffer.alloc(10)) // and never the rest
  })
  await new Promise<void>((resolve) => stalling.listen(0, '127.0.0.1', resolve))
  const stallingPort = (stalling.address() as import('node:net').AddressInfo).port
  const slow = s3Client({ endpoint: `http://127.0.0.1:${stallingPort}`, region: 'us-east-1', accessKeyId: 'check', secretAccessKey: 'check', forcePathStyle: true })
  const half = await slow.send(new Get({ Bucket: 'b', Key: 'panel-x.png' }))
  const stallBegan = Date.now()
  await assert.rejects(
    new Response(idleLimited(half.Body!.transformToWebStream() as ReadableStream<Uint8Array>, 300)).arrayBuffer(),
    (err: Error) => err.name === 'TimeoutError',
    'a body that stalls after its headers is an error'
  )
  assert.ok(Date.now() - stallBegan < 5_000, `and it ends in time (${Date.now() - stallBegan} ms)`)
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.ok(socketClosed, 'and the stalled socket is let go')
  slow.destroy()
  stalling.closeAllConnections()
  await new Promise<void>((resolve) => stalling.close(() => resolve()))
  // A slow reader is not a stalled bucket: the clock runs only while waiting on the source.
  const steady = new ReadableStream<Uint8Array>({ start: (c) => (c.enqueue(new Uint8Array([1])), c.enqueue(new Uint8Array([2])), c.close()) })
  const steadyReader = idleLimited(steady, 50).getReader()
  assert.deepEqual((await steadyReader.read()).value, new Uint8Array([1]))
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.deepEqual((await steadyReader.read()).value, new Uint8Array([2]), 'a pause on the reading side is not a stall')
  const credentials = { region: 'auto', accessKeyId: 'check', secretAccessKey: 'check', endpoint: 'http://127.0.0.1:9' }
  assert.equal(s3Client({ ...credentials, forcePathStyle: false }).config.forcePathStyle, false, 'S3_FORCE_PATH_STYLE=false reaches the client')
  assert.equal(s3Client({ ...credentials, forcePathStyle: true }).config.forcePathStyle, true)
  console.log('  ok  images stream with their size; a silent S3 endpoint, or a body that stalls after its headers, ends in an error in time; path style is honoured')

  // 11. The image route (CR-17, SEC-05): streamed with an ETag and nosniff,
  //     a 304 for a browser that already has it, a Content-Type only from the
  //     allow-list, and a 404 for anything that isn't a stored image.
  const imageRoute = await import('../app/api/image/[id]/route')
  const get = (id: string, headers: Record<string, string> = {}) =>
    imageRoute.GET(new Request(`http://desk.test/api/image/${encodeURIComponent(id)}`, { headers }), { params: Promise.resolve({ id }) })
  const served = await get(streamedId)
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-type'), 'image/png')
  assert.equal(served.headers.get('content-length'), String(pngBytes.length))
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff')
  assert.match(served.headers.get('cache-control') ?? '', /^private\b/)
  const etag = served.headers.get('etag')
  assert.ok(etag, 'an ETag')
  assert.ok(Buffer.from(await served.arrayBuffer()).equals(pngBytes), 'the stored bytes')
  const again = await get(streamedId, { 'if-none-match': etag })
  assert.equal(again.status, 304, 'If-None-Match: a 304, no body')
  assert.equal(await again.text(), '')
  assert.equal((await get(streamedId, { 'if-none-match': `W/${etag}, "other"` })).status, 304, 'a weak or listed tag matches too')
  assert.equal((await get(streamedId, { 'if-none-match': '"something-else"' })).status, 200)
  for (const bad of ['../chapter.json', 'panel-x.gif', 'panel-x.svg', 'panel-x.html', `panel-${crypto.randomUUID()}.png`]) {
    const res = await get(bad)
    assert.equal(res.status, 404, `${bad} is a 404`)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(res.headers.get('cache-control'), 'no-store', `${bad}: a 404 is never cached, so the image shows once it exists`)
  }
  assert.match(again.headers.get('cache-control') ?? '', /immutable/, 'the 304 keeps the long cache')
  console.log('  ok  the image route streams with an ETag, answers If-None-Match with 304, serves png/jpeg/webp only, nosniff, private; a 404 is no-store')


  // 12. Slice 18, the job records on the local desk: the shared rules (round
  //     trip, one active job per key, refused transitions, finish gives up the
  //     key, filters, order, prune) and what only files can get wrong — a
  //     damaged record, a path trick, a leftover lock.
  const { newJob } = await import('../lib/queue/jobs')
  const jobsDir = join(dir, 'jobs')
  await jobStoreChecks(localStore.jobs, `l${process.pid}`)
  const left = await readdir(jobsDir)
  assert.ok(left.length > 0 && left.every((name) => /^[0-9a-f-]{36}\.json$/.test(name)), `only <id>.json files remain in jobs/ — no temp file, no lock: ${left.join(', ')}`)
  {
    const quietJobs = console.warn
    const jobWarnings: string[] = []
    console.warn = (...args: unknown[]) => void jobWarnings.push(args.map(String).join(' '))
    try {
      const known = (await localStore.jobs.listJobs()).length
      await writeFile(join(jobsDir, 'zzz-torn.json'), '{ not json')
      await writeFile(join(jobsDir, 'zzz-shapeless.json'), JSON.stringify({ hello: 1 }))
      await writeFile(join(jobsDir, '.stray.tmp'), 'x')
      assert.equal((await localStore.jobs.listJobs()).length, known, 'a damaged job file is skipped, never thrown from listJobs')
      assert.ok(['zzz-torn', 'zzz-shapeless'].every((id) => jobWarnings.some((line) => line.includes(id))), 'and each is named in the terminal')
      assert.equal(await localStore.jobs.getJob('zzz-torn'), null)
      assert.equal(await localStore.jobs.updateJob('zzz-torn', (j) => j), null, 'a record that can’t be read can’t be updated either')
      await rm(join(jobsDir, 'zzz-torn.json'))
      await rm(join(jobsDir, 'zzz-shapeless.json'))
      await rm(join(jobsDir, '.stray.tmp'))
    } finally {
      console.warn = quietJobs
    }
  }
  const payload = { kind: 'panel', chapterId: 'c', pageIndex: 0, index: 0 } as const
  const escapee = { ...newJob({ key: 'k', ownerId: 'o', projectId: 'p', kind: 'panel', payload }, '../escape'), id: '../escape' }
  await assert.rejects(localStore.jobs.insertJob(escapee), /Not a job id/, 'a job id is a filename: a path is refused')
  let called = 0
  assert.equal(await localStore.jobs.updateJob('../escape', (j) => (called++, j)), null)
  assert.equal(await localStore.jobs.getJob('../escape'), null)
  assert.equal(called, 0, 'fn is never run for an unsafe id')
  assert.ok(!(await readdir(dir)).includes('escape.json'), 'nothing was written outside jobs/')
  {
    const racers = Array.from({ length: 12 }, () => newJob({ key: 'l:race', ownerId: 'o', projectId: 'race', kind: 'panel', payload }, crypto.randomUUID()))
    const outcomes = await Promise.all(racers.map((job) => localStore.jobs.insertJob(job)))
    assert.equal(outcomes.filter((o) => o.created).length, 1, 'twelve inserts for one key in one tick: one is created')
    assert.equal(new Set(outcomes.map((o) => o.job.id)).size, 1, 'and all twelve are told the same holder')
  }
  // The lock itself (`lock.ts`): mutual exclusion, a calm failure when held, a
  // stale lock — untouched too long, or left by a process that is gone — is
  // taken over, and it is released when the work throws.
  {
    const { withFileLock } = await import('../lib/store/lock')
    const lockPath = join(dir, 'locks-check', 'a.lock')
    const holdLock = async (pid: number, ageMs = 0) => {
      await mkdir(lockPath, { recursive: true })
      await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ pid, host: hostname(), token: 'someone-else', at: new Date().toISOString() }))
      if (ageMs) await utimes(lockPath, new Date(Date.now() - ageMs), new Date(Date.now() - ageMs))
    }
    let inside = 0
    let overlapped = false
    await Promise.all(
      Array.from({ length: 6 }, () =>
        withFileLock(lockPath, async () => {
          overlapped ||= ++inside > 1
          await new Promise((resolve) => setTimeout(resolve, 5))
          inside--
        })
      )
    )
    assert.equal(overlapped, false, 'two holders are never inside at once')
    await holdLock(process.pid) // a live holder, fresh
    const waited = Date.now()
    await assert.rejects(withFileLock(lockPath, async () => 'never', { waitMs: 300, busy: 'busy sentence' }), (err: unknown) => err instanceof Error && err.message === 'busy sentence')
    assert.ok(Date.now() - waited >= 280 && Date.now() - waited < 3000, 'it waited its time and then gave up calmly')
    await rm(lockPath, { recursive: true, force: true })
    const gone = spawnSync(process.execPath, ['-e', '']).pid // a process that has exited
    const quietLock = console.warn
    const lockWarnings: string[] = []
    console.warn = (...args: unknown[]) => void lockWarnings.push(args.map(String).join(' '))
    try {
      await holdLock(gone)
      assert.equal(await withFileLock(lockPath, async () => 'took over'), 'took over', 'a lock whose owner is gone is taken over at once')
      await holdLock(process.pid, 60_000)
      assert.equal(await withFileLock(lockPath, async () => 'took over'), 'took over', 'a lock nobody has touched for 30 s is taken over')
    } finally {
      console.warn = quietLock
    }
    assert.equal(lockWarnings.filter((line) => line.includes('stale lock')).length, 2, 'and each takeover is said')
    await assert.rejects(withFileLock(lockPath, async () => Promise.reject(new Error('boom'))), /boom/)
    assert.equal(await withFileLock(lockPath, async () => 'free again', { waitMs: 200 }), 'free again', 'released when the work throws')
    assert.deepEqual(await readdir(join(dir, 'locks-check')), [], 'and nothing is left behind')
  }
  // deleteBlob: the image goes, a missing one is not an error, an unsafe id names nothing.
  const doomed = await localStore.putBlob(pngBytes, 'image/png', 'panel')
  const neighbour = await localStore.putBlob(pngBytes, 'image/png', 'panel')
  await localStore.deleteBlob(doomed)
  assert.equal(await localStore.getBlob(doomed), null, 'a deleted image is gone')
  assert.ok(await localStore.getBlob(neighbour), 'and its neighbour is not')
  await localStore.deleteBlob(doomed)
  await localStore.deleteBlob(`panel-${crypto.randomUUID()}.png`)
  await localStore.deleteBlob('../chapter.json')
  assert.equal(await readFile(join(dir, 'chapter.json'), 'utf8'), '{ "version": 1, truncated', 'an unsafe id deletes nothing')
  console.log('  ok  jobs (local): one file each; one active job per key, a finished key is free again; refused transitions are null; filters, order, prune; damaged files skipped; path tricks refused; locks hold, time out, are taken over when stale; deleteBlob')

  // 13. jobUpdate without a server: a collection that loses races on purpose.
  //     fn runs again on what the other writer left, the key leaves with the
  //     ending write, a null fn writes nothing, and the loop is bounded.
  const { jobUpdate } = await import('../lib/store/cloud')
  const { claim: claimJob, finish: finishJob } = await import('../lib/queue/jobs')
  const baseJob = newJob({ key: 'stub:key', ownerId: 'o', projectId: 'p', kind: 'panel', payload }, 'stub-job', new Date(at))
  type StubDoc = { _id: string; rev: number; activeKey?: string } & Omit<JobRecord, 'id'>
  const stubbed = (losses: number) => {
    const { id, ...fields } = baseJob
    const state = { doc: { _id: id, rev: 0, activeKey: baseJob.key, ...fields } as StubDoc, toLose: losses }
    return {
      state,
      async findOne() {
        return structuredClone(state.doc)
      },
      async findOneAndUpdate(filter: { rev: number }, update: { $set: Record<string, unknown>; $unset?: { activeKey: '' }; $inc: { rev: 1 } }) {
        if (state.toLose > 0) {
          state.toLose--
          state.doc.costUsd += 1 // the other process writes between our read and our write
          state.doc.rev++
        }
        if (filter.rev !== state.doc.rev) return null
        Object.assign(state.doc, update.$set)
        if (update.$unset) delete state.doc.activeKey
        state.doc.rev += update.$inc.rev
        return { _id: state.doc._id }
      },
    }
  }
  const lossy = stubbed(2)
  let jobRuns = 0
  const claimed = await jobUpdate(lossy, 'stub-job', (j) => (jobRuns++, claimJob(j, 'w1', new Date(at))), async () => {})
  assert.equal(jobRuns, 3, 'fn ran once per attempt: two lost races, one win')
  assert.equal(claimed?.status, 'running')
  assert.equal(lossy.state.doc.costUsd, 2, 'the other writer’s two changes survived')
  assert.equal(lossy.state.doc.activeKey, baseJob.key, 'a running job still holds its key')
  assert.equal(lossy.state.doc.rev, 3)
  const ended = await jobUpdate(lossy, 'stub-job', (j) => finishJob(j, { outcome: 'done' }, new Date(at)), async () => {})
  assert.equal(ended?.status, 'done')
  assert.equal('activeKey' in lossy.state.doc, false, 'the write that ends a job takes its key out in the same operation')
  const revNow = lossy.state.doc.rev
  assert.equal(await jobUpdate(lossy, 'stub-job', () => null, async () => {}), null, 'a null fn leaves the record')
  assert.equal(await jobUpdate({ ...lossy, findOne: async () => null }, 'nope', () => assert.fail('no such job'), async () => {}), null, 'a missing job is null, fn never runs')
  assert.equal(lossy.state.doc.rev, revNow, 'nothing was written')
  const starvedJob = stubbed(Infinity)
  let starvedJobRuns = 0
  await assert.rejects(
    jobUpdate(starvedJob, 'stub-job', (j) => (starvedJobRuns++, j), async () => {}),
    (err: unknown) => err instanceof ProviderError && err.kind === 'provider' && /busy/i.test(err.message)
  )
  assert.equal(starvedJobRuns, MAX_UPDATE_ATTEMPTS, 'bounded: it gives up after MAX_UPDATE_ATTEMPTS')
  assert.ok(MAX_UPDATE_ATTEMPTS >= 8, 'room for two writers and a polling GET')
  console.log('  ok  jobUpdate: a lost race re-reads and re-runs fn, the ending write frees the key, a null fn or a missing job writes nothing, bounded')

  // 14. Two processes, one local desk (CR-3). Each child does its share after a
  //     common start time, so they really overlap: 150 increments each on one
  //     project (300 must land), 25 inserts each for the same 25 keys (one
  //     creator per key), a create of one project id (one wins) — and, on a
  //     fresh desk with a v1 file, a migration (it runs once).
  const { emptyProject } = await import('../lib/types')
  const { CLOUD_VARIABLES: CLOUD_NAMES } = await import('../lib/config')
  const localEnv = { ...process.env, INKDESK_DATA_DIR: dir, INKDESK_STORAGE: 'local' } as Record<string, string | undefined>
  for (const name of [...CLOUD_NAMES, 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY']) delete localEnv[name] // a local child never needs a secret
  await localStore.createProject(emptyProject({ id: 'xproc', chapterId: 'c', title: 'two processes', stylePresetId: 'manga-bw', serverRunId: 'run' }))
  const freshDir = await mkdtemp(join(tmpdir(), 'inkdesk-store-migrate-'))
  try {
    await writeFile(join(freshDir, 'chapter.json'), JSON.stringify(v1, null, 2))
    const startAt = Date.now() + 7_000
    const job = (role: string, ...args: (string | number)[]) => child([role, 'local', ...args.map(String), String(startAt)], localEnv)
    const [inc1, inc2, ins1, ins2, mk1, mk2, mig1, mig2] = await Promise.all([
      job('increments', 'xproc', 150, 3),
      job('increments', 'xproc', 150, 3),
      job('insert', 'x:key-', 25),
      job('insert', 'x:key-', 25),
      job('create', 'xproc-new'),
      job('create', 'xproc-new'),
      child(['migrate', 'local', String(startAt)], { ...localEnv, INKDESK_DATA_DIR: freshDir }),
      child(['migrate', 'local', String(startAt)], { ...localEnv, INKDESK_DATA_DIR: freshDir }),
    ])
    for (const r of [inc1, inc2]) assert.deepEqual(r, { done: 150, errors: [] }, 'every increment of both processes succeeded — none failed to rename, none threw')
    const xproc = await localStore.readProject('xproc')
    assert.equal(xproc.usage.images, 300, `300 increments from two processes: ${xproc.usage.images} landed`)
    const xdir = join(dir, 'projects', 'xproc')
    assert.equal(JSON.parse(await readFile(join(xdir, 'project.json'), 'utf8')).usage.images, 300, 'project.json parses and holds all 300')
    assert.equal(JSON.parse(await readFile(join(xdir, 'project.json.bak'), 'utf8')).version, 2, 'and so does the backup')
    assert.deepEqual((await readdir(xdir)).sort(), ['project.json', 'project.json.bak'], 'no temp file left behind')
    const around = await readdir(join(dir, 'projects'))
    assert.deepEqual(around.filter((name) => name.startsWith('.')), [], 'no lock left behind')
    console.log('  ok  two processes, 150 increments each on one local project: all 300 land, no error, the file parses, no temp file or lock left')

    const byKey = new Map<string, { creators: number; ids: Set<string> }>()
    for (const r of [...(ins1.results ?? []), ...(ins2.results ?? [])]) {
      const entry = byKey.get(r.key) ?? { creators: 0, ids: new Set<string>() }
      entry.creators += r.created ? 1 : 0
      entry.ids.add(r.id)
      byKey.set(r.key, entry)
    }
    assert.equal(byKey.size, 25)
    for (const [key, entry] of byKey) {
      assert.equal(entry.creators, 1, `${key}: exactly one process created it`)
      assert.equal(entry.ids.size, 1, `${key}: both processes were told the same job`)
    }
    assert.equal((await localStore.jobs.listJobs({ ownerId: 'x-child', limit: 100 })).length, 25, 'and 25 job files exist, not 50')
    console.log('  ok  two processes racing insertJob on 25 keys: exactly one job per key, both told the same one')

    assert.deepEqual([mk1.outcome, mk2.outcome].sort(), ['created', 'exists'], 'two processes creating one project id: one wins, one is refused')
    const migrated = [mig1.projectId, mig2.projectId].filter((id): id is string => typeof id === 'string')
    assert.equal(migrated.length, 1, 'two processes migrating one v1 desk: one migrates')
    const folders = (await readdir(join(freshDir, 'projects'))).filter((name) => !name.startsWith('.'))
    assert.deepEqual(folders.sort(), [migrated[0], 'v1-migrated.json'].sort(), 'one project and the marker — not two projects')
    console.log('  ok  two processes creating one id, or migrating one v1 desk: exactly one does')
  } finally {
    await rm(freshDir, { recursive: true, force: true })
  }

  const mongoUrlSet = Boolean(process.env.MONGODB_URI?.trim() || process.env.DB_URL?.trim())
  if (!mongoUrlSet) {
    console.log('  --  the cloud half against a real MongoDB and bucket was skipped: neither MONGODB_URI nor DB_URL is set')
  } else if (process.env.INKDESK_CHECK_CLOUD !== 'yes') {
    console.log('  --  the cloud half was skipped: a Mongo URL is set, but this check writes, so it runs only with INKDESK_CHECK_CLOUD=yes')
  } else {
    await cloudHalf()
  }

  console.log('\n  Store acceptance check passed.\n')
} finally {
  await rm(dir, { recursive: true, force: true })
}

/**
 * The same store rules against a real MongoDB and S3-compatible bucket, on a
 * scratch database. Only reached when a Mongo URL is set and
 * `INKDESK_CHECK_CLOUD=yes`. Each setting is changed under whichever name is
 * in effect — `DB_URL` when `MONGODB_URI` is blank — so the mapping is what
 * the store reads, start to finish.
 */
async function cloudHalf(): Promise<void> {
  const missing = (await import('../lib/store/env')).missingCloudEnv()
  assert.deepEqual(missing, [], `the cloud half needs every cloud setting; missing: ${missing.join(', ')}`)
  const { NAMES, cloudSettings } = await import('../lib/config')
  const inEffect = (names: readonly string[]) => names.find((name) => process.env[name]?.trim()) as string
  const URL_VAR = inEffect(NAMES.mongoUrl)
  const DB_VAR = inEffect(NAMES.mongoDb)
  const BUCKET_VAR = inEffect(NAMES.projectFilesBucket)
  const settings = cloudSettings()
  const realDb = process.env[DB_VAR] as string
  const scratchDb = `${settings.mongoDb}-check-${crypto.randomUUID().slice(0, 8)}`
  const movedDb = `${scratchDb}-moved`
  process.env[DB_VAR] = scratchDb // read when the store connects, below
  const { BUCKET_PROBE_KEY, SUMMARY_PROJECTION, cloudBuckets, cloudStore: cs, closeCloud, isMissingObject, isRefusal, mongoHost, s3Client } = await import('../lib/store/cloud')
  // Said before the first write, because the shell's variables win over .env.
  console.log(
    `  ..  cloud half (${URL_VAR}, ${DB_VAR}, ${BUCKET_VAR}): scratch database “${scratchDb}” on ${mongoHost(settings.mongoUrl)}; bucket “${settings.projectFilesBucket}”, outputs “${settings.outputsBucket}” at ${settings.endpoint}`
  )
  const { Refused, ProviderError } = await import('../lib/errors')
  const { singletons } = await import('../lib/singleton')
  const { MongoClient, MongoServerError } = await import('mongodb')
  const net = await import('node:net')
  const { GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3')
  const { migrateV1 } = await import('../lib/migrate')
  const { summarize, UNREADABLE_PROJECT } = await import('../lib/store/local')
  const mongo = new MongoClient(settings.mongoUrl)
  const s3 = s3Client(settings)
  const bucket = settings.projectFilesBucket
  const written: string[] = []
  try {
    const db = mongo.db(scratchDb)
    const rawOf = (id: string) => db.collection<{ _id: string; rev: number; project: { usage: { images: number } } }>('projects').findOne({ _id: id })

    // c1. A project round-trips whole: bubbles (null and absent), versions, ids.
    const at = '2026-10-12T20:00:00.000Z'
    const project = migrateV1(v1, { projectId: 'cloud-a', chapterId: 'c' }, 'an-old-run', at)
    await cs.createProject(project)
    const back = await cs.readProject('cloud-a')
    assert.deepEqual({ ...back, serverRunId: 'x' }, { ...JSON.parse(JSON.stringify(project)), serverRunId: 'x' }, 'the project read back is the project written')
    assert.equal(back.serverRunId, singletons.serverRunId, 'stamped with this run, as on disk')
    const panels = back.chapters[0].pages[0].panels
    assert.equal(panels[3].bubble, null, 'a null bubble stays null')
    assert.equal('bubble' in panels[1], false, 'an absent bubble stays absent')
    assert.equal((await rawOf('cloud-a'))?.rev, 0)
    await assert.rejects(cs.createProject(project), (err: unknown) => err instanceof Refused && /already exists/.test(err.message))
    await assert.rejects(cs.readProject('nope'), (err: unknown) => err instanceof Refused && err.status === 404)
    await assert.rejects(cs.readProject('../etc'), (err: unknown) => err instanceof Refused && err.status === 404)
    await assert.rejects(cs.updateProject('../../etc', (p) => p), /no such project/)
    assert.equal(singletons.locks.has('../../etc'), false, 'a refused id never becomes a lock entry')
    console.log('  ok  cloud: a project round-trips whole; duplicate, unknown and unsafe ids are refused')

    // c2. Two projects, and same-tick updates to one: everything lands.
    await cs.createProject(migrateV1(v1, { projectId: 'cloud-b', chapterId: 'c' }, 'r', at))
    await Promise.all([
      cs.updateProject('cloud-a', (p) => ({ ...p, title: 'for A' })),
      cs.updateProject('cloud-b', (p) => ({ ...p, title: 'for B' })),
      cs.updateProject('cloud-a', (p) => ({ ...p, station: 'cast' })),
    ])
    const a = await cs.readProject('cloud-a')
    assert.equal(a.title, 'for A')
    assert.equal(a.station, 'cast', 'the second same-tick update saw the first')
    assert.equal((await cs.readProject('cloud-b')).title, 'for B')
    await Promise.all([0, 1, 2, 3].map(() => cs.updateProject('cloud-a', (p) => ({ ...p, usage: { ...p.usage, images: p.usage.images + 1 } }))))
    assert.equal((await cs.readProject('cloud-a')).usage.images, 10, 'four concurrent increments on top of 6')
    console.log('  ok  cloud: two projects update independently; same-tick updates and four increments all land')

    // c3. Two processes on one database: no shared lock, only rev. Clearing
    //     the in-process chain before each call makes four writers race for
    //     real; every increment must still land.
    const before = (await rawOf('cloud-b'))?.project.usage.images ?? 0
    await Promise.all(
      [0, 1, 2, 3].map(() => {
        singletons.locks.delete('cloud-b')
        return cs.updateProject('cloud-b', (p) => ({ ...p, usage: { ...p.usage, images: p.usage.images + 1 } }))
      })
    )
    assert.equal((await rawOf('cloud-b'))?.project.usage.images, before + 4, 'a lost update across processes shows up here')
    console.log('  ok  cloud: four writers with no shared lock — rev alone keeps every increment')

    // c4. A failing update writes nothing and wedges nothing.
    const revBefore = (await rawOf('cloud-a'))?.rev
    await assert.rejects(
      cs.updateProject('cloud-a', () => {
        throw new Error('boom')
      }),
      /boom/
    )
    assert.equal((await rawOf('cloud-a'))?.rev, revBefore, 'rev unmoved')
    assert.equal((await cs.updateProject('cloud-a', (p) => ({ ...p, station: 'reader' }))).station, 'reader')
    console.log('  ok  cloud: a failed update neither wedges the chain nor writes')

    // c5. The listing: summaries newest first; an unreadable document is a
    //     "can't be read" card, not fatal, never hidden, and named; opening it
    //     is the calm 500 (CR-14); the v1 file is never migrated into the cloud.
    await db.collection<{ _id: string; rev: number; project: unknown }>('projects').insertOne({ _id: 'zzz-broken', rev: 0, project: { version: 1 } })
    await db.collection<{ _id: string; rev: number; project: unknown }>('projects').insertOne({ _id: 'zzz-shapeless', rev: 0, project: { version: 2, updatedAt: '2000-01-01' } })
    const quiet = console.warn
    const warned: string[] = []
    console.warn = (...args: unknown[]) => void warned.push(args.map(String).join(' '))
    let listed
    try {
      listed = await cs.listProjects()
      for (const id of ['zzz-broken', 'zzz-shapeless']) {
        await assert.rejects(cs.readProject(id), (err: unknown) => err instanceof Refused && err.status === 500 && err.message === UNREADABLE_PROJECT, `${id} opens as the calm 500`)
      }
    } finally {
      console.warn = quiet
    }
    assert.deepEqual(listed.map((p) => p.id), ['cloud-a', 'cloud-b', 'zzz-shapeless', 'zzz-broken'])
    assert.deepEqual(listed.map((p) => p.unreadable ?? false), [false, false, true, true], 'the broken documents are “can’t be read” cards')
    assert.equal(listed[2].updatedAt, '2000-01-01', 'dated by the document where it can be')
    assert.ok(['zzz-broken', 'zzz-shapeless'].every((id) => warned.some((line) => line.includes(id))), 'each broken document is named in the terminal')
    assert.equal(listed[0].thumbnailImageId, 'panel-0-v1.png')
    assert.deepEqual(await cs.migrateLegacy(), { projectId: null, problem: null })
    console.log('  ok  cloud: listing newest first, a broken document a named “can’t be read” card, opening it a calm 500; no v1 migration into the cloud')

    // c5b. The listing reads summaries by projection (CR-12, SEC-12): what it
    //      returns is exactly what the whole document summarizes to, and what
    //      it pulls from MongoDB carries no story, plan or dialogue.
    assert.deepEqual(listed[0], summarize(await cs.readProject('cloud-a')), 'the projected summary is the full summary')
    assert.deepEqual(listed[1], summarize(await cs.readProject('cloud-b')))
    const projected = await db.collection('projects').findOne({ _id: 'cloud-a' as never }, { projection: SUMMARY_PROJECTION })
    const kept = Object.keys(projected?.project ?? {}).sort()
    assert.deepEqual(kept, ['chapters', 'createdAt', 'id', 'library', 'station', 'stylePresetId', 'title', 'updatedAt', 'usage', 'version'], 'only the summary’s fields')
    const projectedPanel = projected?.project.chapters[0].pages[0].panels[0]
    assert.deepEqual(Object.keys(projectedPanel).sort(), ['currentVersion', 'versions'], 'no dialogue, action or bubble')
    assert.deepEqual(Object.keys(projected?.project.library).sort(), ['characters'], 'no assets')
    console.log('  ok  cloud: the dashboard reads summaries by projection — same summary, no story, plan or dialogue pulled')

    // c6. Blobs: the bytes and the media type come back exactly; unknown and
    //     unsafe ids are null; an unknown format is refused before upload.
    //     They land in the project-files bucket, never in the outputs bucket.
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    const id = await cs.putBlob(png, 'image/png', 'panel')
    written.push(id)
    assert.match(id, /^panel-[0-9a-f-]{36}\.png$/)
    const blob = await cs.getBlob(id)
    assert.ok(blob && blob.bytes.equals(png), 'identical bytes')
    assert.equal(blob?.mediaType, 'image/png')
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: settings.keyPrefix + id }))
    await object.Body?.transformToByteArray()
    assert.equal(object.ContentType, 'image/png', 'the bucket knows the media type too')
    // Under the key prefix (SEC-13), never at the root of a bucket that may be shared.
    const atRoot = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: id })).then(() => 'found', (err: { name?: string }) => err.name)
    assert.equal(atRoot, 'NotFound', `the image is under ${settings.keyPrefix}, not at the bucket’s root`)
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: settings.keyPrefix + BUCKET_PROBE_KEY }))
    const jpg = await cs.putBlob(Buffer.from('ffd8ffe0', 'hex'), 'image/jpeg', 'asset')
    written.push(jpg)
    assert.equal((await cs.getBlob(jpg))?.mediaType, 'image/jpeg')
    assert.equal(await cs.getBlob(`panel-${crypto.randomUUID()}.png`), null, 'a missing object is null')
    assert.equal(await cs.getBlob('../chapter.json'), null, 'an unsafe id never reaches the bucket')
    await assert.rejects(cs.putBlob(png, 'image/gif', 'panel'), (err: unknown) => err instanceof ProviderError)
    const stream = await cs.openBlob(id)
    assert.ok(stream, 'an image opens as a stream from the bucket (CR-17)')
    assert.equal(stream.bytes, png.length)
    assert.equal(stream.mediaType, 'image/png')
    assert.ok(Buffer.from(await new Response(stream.body).arrayBuffer()).equals(png), 'streamed bytes are the stored bytes')
    assert.equal(await cs.openBlob(`panel-${crypto.randomUUID()}.png`), null, 'a missing object streams as null')
    assert.deepEqual(
      await cloudBuckets(),
      { projectFiles: settings.projectFilesBucket, outputs: settings.outputsBucket, prefix: settings.keyPrefix },
      'both buckets and the prefix, as mapped'
    )
    if (settings.outputsBucket !== settings.projectFilesBucket) {
      const head = await s3.send(new HeadObjectCommand({ Bucket: settings.outputsBucket, Key: settings.keyPrefix + id })).then(() => 'found', (err: { name?: string }) => err.name)
      assert.equal(head, 'NotFound', 'nothing is written to the outputs bucket yet')
    }
    assert.deepEqual(await cs.health(2000), { mongo: 'ok', bucket: 'ok' }, 'healthy, each check inside two seconds')
    console.log('  ok  cloud: blobs round-trip and stream from the project-files bucket; the outputs bucket is untouched; health is ok')

    // c7. Bad settings are the one config sentence each, before anything is
    //     paid for: an unreachable or malformed MongoDB URI, a bucket that
    //     doesn't exist. The URI never appears in the sentence. And a bucket
    //     error on read is an error, never "no such image".
    const isConfig = (pattern: RegExp) => (err: unknown) =>
      err instanceof ProviderError && err.kind === 'config' && pattern.test(err.message) && !err.message.includes('mongodb://')
    const good = { uri: process.env[URL_VAR], bucket: process.env[BUCKET_VAR] }
    try {
      process.env[URL_VAR] = 'mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=500&connectTimeoutMS=500'
      await assert.rejects(cs.listProjects(), isConfig(/MONGODB_URI \(or DB_URL\)/), 'unreachable')
      assert.deepEqual(await cs.health(2000), { mongo: 'down', bucket: 'down' }, 'health says down, and why only in the terminal')
      process.env[URL_VAR] = 'mongodb://user:p@ss@host/'
      await assert.rejects(cs.readProject('cloud-a'), isConfig(/MONGODB_URI/), 'malformed — the constructor throws')
      process.env[URL_VAR] = 'postgres://somewhere/'
      await assert.rejects(cs.readProject('cloud-a'), isConfig(/MONGODB_URI \(or DB_URL\) must be a MongoDB connection string/), 'not a MongoDB address at all — refused by name before connecting')
      process.env[URL_VAR] = good.uri
      process.env[BUCKET_VAR] = `inkdesk-no-such-bucket-${crypto.randomUUID().slice(0, 8)}`
      await assert.rejects(cs.listProjects(), isConfig(/S3_BUCKET/), 'a missing bucket is refused at connect, not after a paid image')
      assert.deepEqual(await cs.health(2000), { mongo: 'ok', bucket: 'down' }, 'health tells the bucket from the database')
    } finally {
      process.env[URL_VAR] = good.uri
      process.env[BUCKET_VAR] = good.bucket
    }
    assert.equal((await cs.readProject('cloud-a')).title, 'for A', 'good settings again: the store reconnects')
    const elsewhere = s3Client(settings)
    // The classifier getBlob uses, held to real errors from this bucket: a
    // missing key is "no such image", a missing bucket is not.
    const errorOf = (p: Promise<unknown>) => p.then(() => assert.fail('expected the bucket to refuse'), (err: unknown) => err)
    assert.equal(isMissingObject(await errorOf(elsewhere.send(new GetObjectCommand({ Bucket: bucket, Key: `panel-${crypto.randomUUID()}.png` })))), true, 'a missing key')
    assert.equal(
      isMissingObject(await errorOf(elsewhere.send(new GetObjectCommand({ Bucket: `inkdesk-no-such-bucket-${crypto.randomUUID().slice(0, 8)}`, Key: id })))),
      false,
      'a missing bucket is not a missing image'
    )
    elsewhere.destroy()
    // And the MongoDB refusal classifier: a role problem, not an outage.
    assert.equal(isRefusal(new MongoServerError({ code: 13, errmsg: 'not authorized on inkdesk to execute command' })), true)
    assert.equal(isRefusal(new MongoServerError({ code: 8000, errmsg: 'user is not allowed to do action [find]' })), true)
    assert.equal(isRefusal(new MongoServerError({ code: 11000, errmsg: 'duplicate key' })), false)
    assert.equal(mongoHost('mongodb+srv://alice:pa/ss@cluster0.x.mongodb.net/?retryWrites=true'), 'cluster0.x.mongodb.net', 'no part of a password is printed')
    assert.equal(await cs.getBlob(BUCKET_PROBE_KEY), null, 'the connect probe is never an image')
    console.log('  ok  cloud: unreachable, malformed or non-Mongo URLs and a missing bucket are calm config sentences naming both names, before any spend')

    // c8. Settings edited under a running server (.env reloaded): the next
    //     call goes to the new database, never on to the old one.
    process.env[DB_VAR] = movedDb
    try {
      await assert.rejects(cs.readProject('cloud-a'), (err: unknown) => err instanceof Refused && err.status === 404, 'the moved database has no projects')
    } finally {
      process.env[DB_VAR] = scratchDb
    }
    assert.equal((await cs.readProject('cloud-a')).title, 'for A')
    console.log('  ok  cloud: changed settings reconnect instead of writing on to the old database')

    // c9. A connection lost after a good start — Atlas down, this machine
    //     dropped from the allowlist — is the same calm sentence, on a read
    //     and on an update. A proxy in front of MongoDB, cut after one read.
    //     Then a connection that stays open and goes silent (CR-6): the
    //     socket timeout ends the call in the same sentence, never a hang.
    const target = new URL(settings.mongoUrl.replace(/^mongodb(\+srv)?:/, 'http:'))
    const sockets = new Set<import('node:net').Socket>()
    let silent = false
    const proxy = net.createServer((client) => {
      const upstream = net.connect(Number(target.port || 27017), target.hostname)
      for (const sock of [client, upstream]) {
        sockets.add(sock)
        sock.on('error', () => {})
        sock.on('close', () => sockets.delete(sock))
      }
      client.on('data', (chunk) => void (silent || upstream.write(chunk)))
      upstream.on('data', (chunk) => void (silent || client.write(chunk)))
    })
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
    const port = (proxy.address() as import('node:net').AddressInfo).port
    const viaProxy = !target.username && !settings.mongoUrl.startsWith('mongodb+srv:')
    if (!viaProxy) {
      proxy.close()
      console.log('  --  cloud: the lost-connection cases were skipped — they need a plain mongodb:// URL without credentials')
    } else {
      try {
        process.env[URL_VAR] = `mongodb://127.0.0.1:${port}/?directConnection=true&serverSelectionTimeoutMS=500&connectTimeoutMS=500&socketTimeoutMS=500`
        assert.equal((await cs.readProject('cloud-a')).title, 'for A', 'through the proxy')
        silent = true
        const began = Date.now()
        await assert.rejects(cs.readProject('cloud-a'), isConfig(/MONGODB_URI/), 'a read on a silent connection')
        await assert.rejects(cs.updateProject('cloud-a', (p) => p), isConfig(/MONGODB_URI/), 'an update on a silent connection')
        assert.ok(Date.now() - began < 10_000, `both ended in time (${Date.now() - began} ms)`)
        silent = false
        process.env[URL_VAR] = `mongodb://127.0.0.1:${port}/?directConnection=true&serverSelectionTimeoutMS=500&connectTimeoutMS=500`
        assert.equal((await cs.readProject('cloud-a')).title, 'for A', 'through the proxy again')
        await new Promise<void>((resolve) => {
          proxy.close(() => resolve())
          for (const sock of sockets) sock.destroy()
        })
        await assert.rejects(cs.readProject('cloud-a'), isConfig(/MONGODB_URI/), 'a read after the connection is lost')
        await assert.rejects(cs.updateProject('cloud-a', (p) => p), isConfig(/MONGODB_URI/), 'an update after the connection is lost')
      } finally {
        process.env[URL_VAR] = good.uri
        proxy.close()
        for (const sock of sockets) sock.destroy()
      }
      assert.equal((await cs.readProject('cloud-a')).title, 'for A', 'back on the real address')
      console.log('  ok  cloud: a connection lost, or gone silent, after a good start is the calm sentence on reads and updates — in time')
    }

    // c10. The job records (slice 18): the shared rules, and what only Mongo
    //      can show — `activeKey` is there while the job is queued or running
    //      and absent once it ends, the unique sparse index is what refuses a
    //      second active job for a key, and racing inserts have one winner.
    const rawJobs = db.collection<{ _id: string; rev: number; activeKey?: string; key: string }>('jobs')
    await jobStoreChecks(cs.jobs, `c${process.pid}`, async (jobId) => (await rawJobs.findOne({ _id: jobId })) as Record<string, unknown> | null)
    const indexes = await rawJobs.indexes()
    const activeIndex = indexes.find((index) => 'activeKey' in index.key)
    assert.ok(activeIndex?.unique && activeIndex.sparse, 'a unique, sparse index on activeKey')
    for (const wanted of [{ ownerId: 1, status: 1 }, { projectId: 1, status: 1 }, { status: 1, updatedAt: 1 }]) {
      assert.ok(indexes.some((index) => JSON.stringify(index.key) === JSON.stringify(wanted)), `an index on ${Object.keys(wanted).join(' + ')}`)
    }
    const { newJob } = await import('../lib/queue/jobs')
    const payload = { kind: 'panel', chapterId: 'c', pageIndex: 0, index: 0 } as const
    const held = newJob({ key: 'c:raw', ownerId: 'o', projectId: 'raw', kind: 'panel', payload }, crypto.randomUUID())
    assert.equal((await cs.jobs.insertJob(held)).created, true)
    await assert.rejects(
      rawJobs.insertOne({ _id: crypto.randomUUID(), rev: 0, activeKey: 'c:raw', key: 'c:raw' }),
      (err: unknown) => err instanceof MongoServerError && err.code === 11000,
      'the database itself refuses a second active job for one key'
    )
    await assert.rejects(cs.jobs.insertJob({ ...held, key: 'c:other' }), /already exists/, 'an id that exists is not silently replaced')
    {
      const racers = Array.from({ length: 12 }, () => newJob({ key: 'c:race', ownerId: 'o', projectId: 'race', kind: 'panel', payload }, crypto.randomUUID()))
      const outcomes = await Promise.all(racers.map((job) => cs.jobs.insertJob(job)))
      assert.equal(outcomes.filter((o) => o.created).length, 1, 'twelve inserts for one key at once: the index lets one in')
      assert.equal(new Set(outcomes.map((o) => o.job.id)).size, 1, 'and all twelve are told the same holder')
    }
    {
      // Several updates to one job from "other processes" (the chain is cleared
      // each time): rev alone keeps every one.
      const counted = newJob({ key: 'c:count', ownerId: 'o', projectId: 'count', kind: 'panel', payload }, crypto.randomUUID())
      await cs.jobs.insertJob(counted)
      await Promise.all(
        Array.from({ length: 4 }, () => {
          singletons.locks.delete(`job:${counted.id}`)
          return cs.jobs.updateJob(counted.id, (j) => ({ ...j, costUsd: j.costUsd + 1 }))
        })
      )
      assert.equal((await cs.jobs.getJob(counted.id))?.costUsd, 4, 'four writers with no shared chain — every increment kept')
      assert.equal(singletons.locks.has(`job:${counted.id}`), false, 'and a settled job leaves no chain entry behind')
    }
    // deleteBlob: gone from the bucket, a missing one is not an error, an unsafe id names nothing, the prefix holds.
    const doomed = await cs.putBlob(png, 'image/png', 'panel')
    const neighbour = await cs.putBlob(png, 'image/png', 'panel')
    written.push(doomed, neighbour)
    await cs.deleteBlob(doomed)
    assert.equal(await cs.getBlob(doomed), null, 'a deleted image is gone from the bucket')
    assert.equal(await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: settings.keyPrefix + doomed })).then(() => 'found', (err: { name?: string }) => err.name), 'NotFound')
    assert.ok(await cs.getBlob(neighbour), 'its neighbour is not')
    await cs.deleteBlob(doomed)
    await cs.deleteBlob(`panel-${crypto.randomUUID()}.png`)
    await cs.deleteBlob('../chapter.json')
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: settings.keyPrefix + BUCKET_PROBE_KEY }))
    console.log('  ok  cloud: jobs — one active job per key by index, activeKey leaves with the ending write, racing inserts have one winner, rev keeps every update; deleteBlob')

    // c11. Two processes, one database: each child connects for itself. 150
    //      increments each on one project must all land, and racing inserts and
    //      creates have exactly one winner — rev and the indexes are the only guard.
    await cs.createProject(migrateV1(v1, { projectId: 'cloud-x', chapterId: 'c' }, 'r', at))
    const startAt = Date.now() + 9_000
    const job = (role: string, ...args: (string | number)[]) => child([role, 'cloud', ...args.map(String), String(startAt)], process.env)
    const [inc1, inc2, ins1, ins2, mk1, mk2] = await Promise.all([
      job('increments', 'cloud-x', 150, 3),
      job('increments', 'cloud-x', 150, 3),
      job('insert', 'cx:key-', 25),
      job('insert', 'cx:key-', 25),
      job('create', 'cloud-new'),
      job('create', 'cloud-new'),
    ])
    for (const r of [inc1, inc2]) assert.deepEqual(r, { done: 150, errors: [] }, 'every increment of both processes succeeded')
    assert.equal((await cs.readProject('cloud-x')).usage.images, 6 + 300, 'two processes, 150 increments each on top of 6: all 300 land')
    console.log('  ok  cloud: two processes, 150 increments each on one project: all 300 land, no error')
    const byKey = new Map<string, { creators: number; ids: Set<string> }>()
    for (const r of [...(ins1.results ?? []), ...(ins2.results ?? [])]) {
      const entry = byKey.get(r.key) ?? { creators: 0, ids: new Set<string>() }
      entry.creators += r.created ? 1 : 0
      entry.ids.add(r.id)
      byKey.set(r.key, entry)
    }
    assert.equal(byKey.size, 25)
    for (const [key, entry] of byKey) {
      assert.equal(entry.creators, 1, `${key}: exactly one process created it`)
      assert.equal(entry.ids.size, 1, `${key}: both processes were told the same job`)
    }
    assert.equal((await cs.jobs.listJobs({ ownerId: 'x-child', limit: 100 })).length, 25, 'and 25 jobs exist, not 50')
    assert.deepEqual([mk1.outcome, mk2.outcome].sort(), ['created', 'exists'], 'two processes creating one project id: one wins')
    console.log('  ok  cloud: two processes racing insertJob on 25 keys: exactly one job per key; creating one id: exactly one wins')
  } finally {
    await closeCloud()
    const left: string[] = []
    for (const name of [scratchDb, movedDb]) await mongo.db(name).dropDatabase().catch(() => left.push(`database ${name}`))
    await mongo.close()
    for (const key of written.map((id) => settings.keyPrefix + id)) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => left.push(`object ${key}`))
    s3.destroy()
    // Never silent: what couldn't be cleaned up is named, to delete by hand.
    if (left.length > 0) console.warn(`  !!  cloud half left behind (delete by hand): ${left.join(', ')}`)
    process.env[DB_VAR] = realDb
  }
}

// --- Jobs: the rules every JobStore keeps -----------------------------------------

/**
 * The job-store rules, against whichever store is handed in. `tag` keeps one
 * run's keys and projects apart from any other's. `peek`, where the store has a
 * raw document to show (Mongo), also holds it to `activeKey`: present while the
 * job is queued or running, absent once it ends.
 */
async function jobStoreChecks(js: JobStore, tag: string, peek?: (id: string) => Promise<Record<string, unknown> | null>): Promise<void> {
  const { checkpoint, claim, finish, newJob, renew } = await import('../lib/queue/jobs')
  const t0 = Date.parse('2026-10-14T10:00:00.000Z')
  const when = (minute: number) => new Date(t0 + minute * 60_000)
  const project = `proj-${tag}`
  const owner = `owner-${tag}`
  const payload = { kind: 'panel', chapterId: 'c', pageIndex: 0, index: 0 } as const
  const make = (name: string, minute: number, over: { ownerId?: string; projectId?: string; key?: string } = {}) =>
    newJob({ key: over.key ?? `${tag}:${name}`, ownerId: over.ownerId ?? owner, projectId: over.projectId ?? project, kind: 'panel', payload }, crypto.randomUUID(), when(minute))
  const ids = (jobs: JobRecord[]) => jobs.map((j) => j.id)
  const activeKeyOf = async (id: string) => (peek ? (await peek(id))?.activeKey : undefined)

  // Round trip.
  const a = make('a', 0)
  const first = await js.insertJob(a)
  assert.equal(first.created, true)
  assert.deepEqual(first.job, a)
  assert.deepEqual(await js.getJob(a.id), a, 'a job reads back exactly as written')
  assert.equal(await js.getJob(crypto.randomUUID()), null, 'an unknown id is null')
  assert.equal(await js.getJob('../nope'), null, 'and so is an unsafe one')
  if (peek) assert.equal(await activeKeyOf(a.id), a.key, 'a queued job holds its key')

  // One active job per key.
  const again = make('a-again', 1, { key: a.key })
  const duplicate = await js.insertJob(again)
  assert.equal(duplicate.created, false, 'the key is taken')
  assert.deepEqual(duplicate.job, a, 'and the holder is returned')
  assert.equal(await js.getJob(again.id), null, 'the refused job was not written')
  const b = make('b', 0)
  assert.equal((await js.insertJob(b)).created, true, 'another key is free')

  // A worker takes it: running still holds the key.
  const running = await js.updateJob(a.id, (j) => claim(j, 'w1', when(2)))
  assert.equal(running?.status, 'running')
  assert.equal(running?.attempts, 1)
  assert.equal((await js.insertJob(make('a-while-running', 2, { key: a.key }))).job.status, 'running', 'a running job holds its key too')

  // Refused transitions and missing jobs are null, and nothing changes.
  let ran = 0
  assert.equal(await js.updateJob(a.id, (j) => renew(j, 'w2', when(3))), null, 'only the holder renews')
  assert.equal(await js.updateJob(a.id, () => null), null, 'a null fn leaves it')
  assert.equal(await js.updateJob(crypto.randomUUID(), (j) => (ran++, j)), null, 'a missing id is null')
  assert.equal(ran, 0, 'and fn never runs for it')
  assert.deepEqual(await js.getJob(a.id), running, 'the refusals changed nothing')
  await assert.rejects(
    js.updateJob(a.id, () => {
      throw new Error('boom')
    }),
    /boom/
  )
  assert.deepEqual(await js.getJob(a.id), running, 'a throwing fn writes nothing')

  // The holder saves facts as it goes; concurrent updates are all kept.
  await js.updateJob(a.id, (j) => checkpoint(j, 'w1', { resultImageId: 'panel-x.png', costUsd: 1 }, when(3)))
  await Promise.all(Array.from({ length: 20 }, () => js.updateJob(a.id, (j) => ({ ...j, costUsd: j.costUsd + 1 }))))
  const counted = await js.getJob(a.id)
  assert.equal(counted?.costUsd, 21, 'twenty concurrent updates and a checkpoint: none lost')
  assert.equal(counted?.resultImageId, 'panel-x.png')

  // The ending gives up the key, in the same write.
  const done = await js.updateJob(a.id, (j) => finish(j, { outcome: 'done', costUsd: 5 }, when(4)))
  assert.equal(done?.status, 'done')
  assert.equal(done?.outcome, 'done')
  assert.equal(done?.finishedAt, when(4).toISOString())
  if (peek) assert.equal('activeKey' in ((await peek(a.id)) ?? {}), false, 'a finished job holds no key')
  assert.equal(await js.updateJob(a.id, (j) => finish(j, { outcome: 'failed', error: 'late' }, when(5))), null, 'a job that ended keeps its first ending')
  assert.equal((await js.getJob(a.id))?.costUsd, 5)
  const d = make('a-again', 6, { key: a.key })
  const reused = await js.insertJob(d)
  assert.equal(reused.created, true, 'a finished key can be inserted again')
  assert.deepEqual(reused.job, d)
  assert.deepEqual(ids(await js.listJobs({ key: a.key })), [d.id, a.id], 'both are on record, the new one first')
  assert.deepEqual(ids(await js.listJobs({ key: a.key, status: ['queued', 'running'] })), [d.id], 'one of them active')
  if (peek) assert.equal(await activeKeyOf(d.id), a.key, 'and it holds the key now')

  // A failed one, and another person's.
  const e = make('e', 5)
  await js.insertJob(e)
  await js.updateJob(e.id, (j) => claim(j, 'w1', when(7)))
  const failed = await js.updateJob(e.id, (j) => finish(j, { outcome: 'failed', error: 'It didn’t take.' }, when(8)))
  assert.equal(failed?.status, 'failed')
  assert.equal(failed?.error, 'It didn’t take.')
  const f = make('f', 9, { ownerId: `other-${tag}`, projectId: `other-${tag}` })
  await js.insertJob(f)

  // Listing: filters, order, limit.
  assert.deepEqual(ids(await js.listJobs({ projectId: project })), [e.id, d.id, a.id, b.id], 'newest change first')
  assert.deepEqual(ids(await js.listJobs({ projectId: project, status: ['queued'] })), [d.id, b.id])
  assert.deepEqual(ids(await js.listJobs({ projectId: project, status: ['done', 'failed'] })), [e.id, a.id])
  assert.deepEqual(await js.listJobs({ projectId: project, status: [] }), [], 'no status wanted is no job')
  assert.deepEqual(ids(await js.listJobs({ ownerId: `other-${tag}` })), [f.id])
  assert.deepEqual(ids(await js.listJobs({ projectId: project, ownerId: `other-${tag}` })), [], 'every filter must match')
  assert.deepEqual(ids(await js.listJobs({ key: a.key })), [d.id, a.id])
  assert.deepEqual(ids(await js.listJobs({ projectId: project, updatedSince: d.updatedAt })), [e.id, d.id], 'updatedSince is inclusive')
  assert.deepEqual(ids(await js.listJobs({ projectId: project, limit: 2 })), [e.id, d.id], 'limit takes the newest')
  const everything = await js.listJobs()
  assert.ok([a, b, d, e, f].every((job) => ids(everything).includes(job.id)), 'no filter: all of them')
  assert.ok(everything.every((job, i) => i === 0 || everything[i - 1].updatedAt >= job.updatedAt), 'in order, newest first')

  // Pruning: finished before the cutoff go; active ones never do.
  assert.equal(await js.pruneJobs(when(5).toISOString()), 1, 'only the job finished before the cutoff')
  assert.equal(await js.getJob(a.id), null)
  assert.ok(await js.getJob(e.id), 'one finished after it stays')
  assert.ok((await js.getJob(b.id)) && (await js.getJob(d.id)), 'and queued ones stay however old')
  assert.equal(await js.pruneJobs(when(5).toISOString()), 0)
  assert.equal(await js.pruneJobs(when(60).toISOString()), 1, 'the next cutoff takes the failed one')
  assert.deepEqual(ids(await js.listJobs({ projectId: project })), [d.id, b.id], 'the queued two remain')
}

// --- Children of the cross-process tests -------------------------------------------

type ChildOut = {
  done?: number
  errors?: string[]
  results?: { key: string; id: string; created: boolean }[]
  outcome?: string
  projectId?: string | null
}

/** This file again, as a process of its own: `node --import tsx check.mts --child <role> …`. */
function child(args: string[], env: Record<string, string | undefined>): Promise<ChildOut> {
  const self = fileURLToPath(import.meta.url)
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--import', 'tsx', self, '--child', ...args], {
      cwd: dirname(dirname(self)),
      env: env as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    proc.stdout.on('data', (chunk) => void (out += chunk))
    proc.stderr.on('data', (chunk) => void (err += chunk))
    const timer = setTimeout(() => proc.kill('SIGKILL'), 120_000)
    proc.on('error', reject)
    proc.on('close', (code) => {
      clearTimeout(timer)
      const last = out.trim().split('\n').pop() ?? ''
      if (code !== 0) return reject(new Error(`child ${args[0]} exited ${code}: ${err.trim().slice(-800) || out.trim().slice(-800)}`))
      try {
        resolve(JSON.parse(last) as ChildOut)
      } catch {
        reject(new Error(`child ${args[0]} printed no result: ${out.trim().slice(-400)} ${err.trim().slice(-400)}`))
      }
    })
  })
}

/**
 * One child's share of a cross-process test: `<role> <local|cloud> <args…>
 * <startAt>`. It loads its store first, then waits for the common start time so
 * both processes really overlap, does its work, and prints one JSON line.
 */
async function runChild([role, mode, ...rest]: string[]): Promise<void> {
  const startAt = Number(rest.pop())
  const cloudMode = mode === 'cloud'
  const cloudModule = cloudMode ? await import('../lib/store/cloud') : null
  const store = cloudModule ? cloudModule.cloudStore : (await import('../lib/store/local')).localStore
  const { newJob } = await import('../lib/queue/jobs')
  const { emptyProject } = await import('../lib/types')
  const { Refused } = await import('../lib/errors')
  const wait = startAt - Date.now()
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
  let result: ChildOut
  if (role === 'increments') {
    const [id, total, lanes] = [rest[0], Number(rest[1]), Number(rest[2])]
    const errors: string[] = []
    let done = 0
    const lane = async (count: number) => {
      for (let i = 0; i < count; i++) {
        try {
          await store.updateProject(id, (p) => ({ ...p, usage: { ...p.usage, images: p.usage.images + 1 } }))
          done++
        } catch (err) {
          errors.push(message(err))
        }
      }
    }
    await Promise.all(Array.from({ length: lanes }, () => lane(total / lanes)))
    result = { done, errors }
  } else if (role === 'insert') {
    const results: NonNullable<ChildOut['results']> = []
    for (let i = 0; i < Number(rest[1]); i++) {
      const key = `${rest[0]}${i}`
      const job = newJob({ key, ownerId: 'x-child', projectId: 'xproc', kind: 'panel', payload: { kind: 'panel', chapterId: 'c', pageIndex: 0, index: i } }, crypto.randomUUID())
      const outcome = await store.jobs.insertJob(job)
      results.push({ key, id: outcome.job.id, created: outcome.created })
    }
    result = { results }
  } else if (role === 'create') {
    try {
      await store.createProject(emptyProject({ id: rest[0], chapterId: 'c', title: 'racing', stylePresetId: 'manga-bw', serverRunId: 'run' }))
      result = { outcome: 'created' }
    } catch (err) {
      result = { outcome: err instanceof Refused ? 'exists' : message(err) }
    }
  } else if (role === 'migrate') {
    result = { projectId: (await store.migrateLegacy()).projectId }
  } else {
    throw new Error(`unknown child role ${role}`)
  }
  await cloudModule?.closeCloud()
  await new Promise<void>((resolve) => process.stdout.write(`${JSON.stringify(result)}\n`, () => resolve()))
}

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
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

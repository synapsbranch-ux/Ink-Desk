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
// and the missing-settings sentence, and the optimistic `rev` update against a
// collection that loses races on purpose — always. Then, only when
// `MONGODB_URI` is set (with `MONGODB_DB` and the `S3_*` variables), the same
// rules against a real MongoDB and bucket: a scratch database named
// `<MONGODB_DB>-check-<random>`, dropped at the end, and only the objects this
// check wrote, deleted at the end. The bucket must already exist.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-store-'))
process.env.INKDESK_DATA_DIR = dir

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

  // 6. No torn file: the temp file never outlives a write.
  for (const id of [a, b]) {
    const files = await readdir(join(dir, 'projects', id))
    assert.deepEqual(files, ['project.json'], `unexpected files left behind in ${id}: ${files.join(', ')}`)
  }
  console.log('  ok  only project.json in each project folder — no stray temp file')

  // 7. Nothing unreadable takes the desk down: a broken project is skipped
  //    with a warning, a broken v1 file is left alone and named in a sentence,
  //    and a garbage id is a 404 that never becomes a lock entry.
  const quiet = console.warn
  console.warn = () => {}
  try {
    await mkdir(join(dir, 'projects', 'zzz-broken'), { recursive: true })
    await writeFile(join(dir, 'projects', 'zzz-broken', 'project.json'), '{ not json')
    assert.equal((await listProjects()).length, 3, 'a broken project.json is skipped, the others still list')
    await rm(join(dir, 'projects', 'v1-migrated.json'))
    await writeFile(join(dir, 'chapter.json'), '{ "version": 1, truncated')
    const outcome = await migrateLegacy()
    assert.equal(outcome.projectId, null)
    assert.match(outcome.problem ?? '', /chapter\.json/, 'the sentence names the file')
    assert.equal((await listProjects()).length, 3, 'nothing was migrated from a broken v1 file')
    assert.equal(await readFile(join(dir, 'chapter.json'), 'utf8'), '{ "version": 1, truncated', 'and it was left exactly as it was')
    await assert.rejects(update('../../etc', (c) => c), /no such project/)
    assert.equal(singletons.locks.has('../../etc'), false, 'a refused id never becomes a lock entry')
  } finally {
    console.warn = quiet
  }
  console.log('  ok  a broken project is skipped, a broken v1 file is named and left alone, a garbage id is a 404')

  // 8. The switch: unset is local, a typo is refused by name, and cloud mode
  //    without its settings names exactly what is missing.
  const { CLOUD_ENV, missingCloudEnv, missingCloudSentence, storageMode } = await import('../lib/store/env')
  assert.equal(storageMode({}), 'local', 'unset means the local desk')
  assert.equal(storageMode({ INKDESK_STORAGE: ' cloud ' }), 'cloud')
  assert.throws(() => storageMode({ INKDESK_STORAGE: 'mongo' }), /"mongo".*"local".*"cloud"/)
  const full = Object.fromEntries(CLOUD_ENV.map((name) => [name, 'x']))
  assert.deepEqual(missingCloudEnv(full), [])
  assert.deepEqual(missingCloudEnv({ ...full, MONGODB_DB: '', S3_BUCKET: '  ' }), ['MONGODB_DB', 'S3_BUCKET'], 'blank counts as missing')
  assert.match(missingCloudSentence(['MONGODB_URI']), /MONGODB_URI is not set\. Add it to \.env, or set INKDESK_STORAGE=local/)
  assert.match(missingCloudSentence(['S3_REGION', 'S3_BUCKET']), /S3_REGION, S3_BUCKET are not set/)
  console.log('  ok  INKDESK_STORAGE: unset is local, a typo is refused, missing cloud settings are named')

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

  if (!process.env.MONGODB_URI) {
    console.log('  --  the cloud half against a real MongoDB and bucket was skipped: MONGODB_URI is not set')
  } else {
    await cloudHalf()
  }

  console.log('\n  Store acceptance check passed.\n')
} finally {
  await rm(dir, { recursive: true, force: true })
}

/**
 * The same store rules against a real MongoDB and S3-compatible bucket, on a
 * scratch database. Only reached when `MONGODB_URI` is set.
 */
async function cloudHalf(): Promise<void> {
  const missing = (await import('../lib/store/env')).missingCloudEnv()
  assert.deepEqual(missing, [], `the cloud half needs every cloud variable; missing: ${missing.join(', ')}`)
  const realDb = process.env.MONGODB_DB as string
  const scratchDb = `${realDb}-check-${crypto.randomUUID().slice(0, 8)}`
  process.env.MONGODB_DB = scratchDb // read when the store connects, below
  const { cloudStore: cs, closeCloud } = await import('../lib/store/cloud')
  const { Refused, ProviderError } = await import('../lib/errors')
  const { singletons } = await import('../lib/singleton')
  const { MongoClient } = await import('mongodb')
  const { S3Client, GetObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3')
  const { migrateV1 } = await import('../lib/migrate')
  const mongo = new MongoClient(process.env.MONGODB_URI as string)
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID as string, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY as string },
  })
  const bucket = process.env.S3_BUCKET as string
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

    // c5. The listing: summaries newest first; an unreadable document is
    //     skipped, not fatal; the v1 file is never migrated into the cloud.
    await db.collection<{ _id: string; rev: number; project: unknown }>('projects').insertOne({ _id: 'zzz-broken', rev: 0, project: { version: 1 } })
    const quiet = console.warn
    console.warn = () => {}
    let listed
    try {
      listed = await cs.listProjects()
    } finally {
      console.warn = quiet
    }
    assert.deepEqual(listed.map((p) => p.id), ['cloud-a', 'cloud-b'])
    assert.equal(listed[0].thumbnailImageId, 'panel-0-v1.png')
    assert.deepEqual(await cs.migrateLegacy(), { projectId: null, problem: null })
    console.log('  ok  cloud: listing newest first, a broken document skipped, no v1 migration into the cloud')

    // c6. Blobs: the bytes and the media type come back exactly; unknown and
    //     unsafe ids are null; an unknown format is refused before upload.
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    const id = await cs.putBlob(png, 'image/png', 'panel')
    written.push(id)
    assert.match(id, /^panel-[0-9a-f-]{36}\.png$/)
    const blob = await cs.getBlob(id)
    assert.ok(blob && blob.bytes.equals(png), 'identical bytes')
    assert.equal(blob?.mediaType, 'image/png')
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: id }))
    assert.equal(object.ContentType, 'image/png', 'the bucket knows the media type too')
    const jpg = await cs.putBlob(Buffer.from('ffd8ffe0', 'hex'), 'image/jpeg', 'asset')
    written.push(jpg)
    assert.equal((await cs.getBlob(jpg))?.mediaType, 'image/jpeg')
    assert.equal(await cs.getBlob(`panel-${crypto.randomUUID()}.png`), null, 'a missing object is null')
    assert.equal(await cs.getBlob('../chapter.json'), null, 'an unsafe id never reaches the bucket')
    await assert.rejects(cs.putBlob(png, 'image/gif', 'panel'), (err: unknown) => err instanceof ProviderError)
    console.log('  ok  cloud: blobs round-trip with their media type; missing and unsafe ids are null')

    // c7. A MongoDB that can't be reached is the one config sentence.
    await closeCloud()
    const goodUri = process.env.MONGODB_URI
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=500&connectTimeoutMS=500'
    try {
      await assert.rejects(cs.listProjects(), (err: unknown) => err instanceof ProviderError && err.kind === 'config' && /MONGODB_URI/.test(err.message))
    } finally {
      process.env.MONGODB_URI = goodUri
    }
    console.log('  ok  cloud: an unreachable MongoDB is the calm config sentence naming MONGODB_URI')
  } finally {
    await closeCloud()
    await mongo.db(scratchDb).dropDatabase().catch(() => {})
    await mongo.close()
    for (const key of written) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {})
    s3.destroy()
    process.env.MONGODB_DB = realDb
  }
}

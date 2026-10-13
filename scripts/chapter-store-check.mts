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
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-store-'))
process.env.INKDESK_DATA_DIR = dir

// Imported after the env is set, because the store reads it at load.
const { createProject, listProjects, read, update } = await import('../lib/chapter')
const { migrateV1 } = await import('../lib/migrate')

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

  console.log('\n  Store acceptance check passed.\n')
} finally {
  await rm(dir, { recursive: true, force: true })
}

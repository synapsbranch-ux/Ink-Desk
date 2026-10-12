// The Chapter Store acceptance check from
// `devpost/spec.md > Components > Chapter Store`. Run with:
//
//   npm run check:store
//
// It points the store at a scratch folder, fires concurrent `update()` calls
// in the same tick, and asserts that none of them erased another — the
// lost-update bug that PANEL_CONCURRENCY=2 would otherwise hit when two
// panels finish together. Also checks the `imageCount` canary, that no temp
// file is left behind, and that a failing update doesn't wedge the chain.
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-store-'))
process.env.INKDESK_DATA_DIR = dir

// Imported after the env is set, because the store reads it at load.
const { update, read } = await import('../lib/chapter')

try {
  // 1. Two updates in the same tick, touching different fields: both land.
  const [a, b] = await Promise.all([
    update((c) => ({ ...c, pitch: { ...c.pitch, text: 'first writer' } })),
    update((c) => ({ ...c, pitch: { ...c.pitch, genre: 'Shonen' } })),
  ])
  assert.equal(a.pitch.text, 'first writer')
  assert.equal(b.pitch.text, 'first writer', 'second update must see the first one’s write')
  assert.equal(b.pitch.genre, 'Shonen')

  const onDisk = JSON.parse(await readFile(join(dir, 'chapter.json'), 'utf8'))
  assert.equal(onDisk.pitch.text, 'first writer', 'first write was erased on disk')
  assert.equal(onDisk.pitch.genre, 'Shonen', 'second write was erased on disk')
  console.log('  ok  two same-tick updates both survived in chapter.json')

  // 2. The counter canary: four concurrent increments read back as 4.
  await Promise.all([0, 1, 2, 3].map(() => update((c) => ({ ...c, imageCount: c.imageCount + 1 }))))
  assert.equal((await read()).imageCount, 4, 'a lost update shows up as imageCount < 4')
  console.log('  ok  imageCount after four concurrent increments is 4')

  // 3. A failing update rejects on its own and leaves the file untouched...
  await assert.rejects(
    update(() => {
      throw new Error('boom')
    }),
    /boom/
  )
  // ...and the next update still goes through.
  const after = await update((c) => ({ ...c, station: 'cast' }))
  assert.equal(after.station, 'cast')
  assert.equal(after.imageCount, 4)
  console.log('  ok  a failed update neither wedges the chain nor corrupts the file')

  // 4. No torn file: the temp file never outlives a write.
  const files = await readdir(dir)
  assert.deepEqual(files, ['chapter.json'], `unexpected files left behind: ${files.join(', ')}`)
  console.log('  ok  only chapter.json on disk — no stray temp file')

  console.log('\n  Chapter Store acceptance check passed.\n')
} finally {
  await rm(dir, { recursive: true, force: true })
}

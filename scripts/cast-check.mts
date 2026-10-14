// The Cast station's server-side rules from
// `devpost/checklist.md > Slices > 4`, run against a scratch folder and a
// real PNG with no provider in the loop:
//
//   npm run check:cast
//
// Exactly two characters; Reroll leaves the other byte-identical; a sheet
// lands as a real file with its extension from media_type and bumps
// imageCount by exactly one; Lock needs a sheet; a locked character refuses
// every edit on the server, not only in the UI; a changed look retires the
// DNA. The two Claude calls and the OpenRouter call are exercised live
// through the routes — this covers what sits between them.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-cast-'))
process.env.INKDESK_DATA_DIR = dir

// Imported after the env is set, because the store reads it at load.
const { createProject, read: readDesk, update: updateDesk } = await import('../lib/chapter')
const { isImageId, mediaTypeOf, readImage, saveImage } = await import('../lib/images')
const { assertEditAllowed, attachSheet, editCharacter, proposeCast, replaceCharacter, setDna } =
  await import('../lib/cast')
const { applyPatch, mergePatch } = await import('../lib/patch')
const { Refused } = await import('../lib/errors')

import type { Chapter } from '../lib/types'

// One project on the scratch desk (v2); every call below is addressed to it.
const pid = (await createProject({ title: 'Cast check', stylePresetId: 'manga-bw' })).address.projectId
const read = () => readDesk(pid)
const update = (fn: (c: Chapter) => Chapter) => updateDesk(pid, fn)

const kaito = {
  name: 'Kaito Ren',
  role: 'Lead · rooftop courier',
  traits: ['restless', 'loyal', 'quick'],
  look: 'Eighteen, wiry. Messy black hair, amber eyes. Grey courier jacket, frayed red scarf, scar through the right eyebrow.',
}
const mio = {
  name: 'Mio Asakura',
  role: 'Counterpart · night archivist',
  traits: ['wry', 'patient', 'stubborn'],
  look: 'Twenty, small and upright. Silver bob, round glasses, long dark coat with brass buttons.',
}
const { dna: KAITO_DNA } = JSON.parse(await readFile('data/kernel-test/manifest.json', 'utf8')) as { dna: string }

try {
  // 1. No cast before an accepted synopsis.
  await assert.rejects(update((c) => proposeCast(c, kaito, mio)), Refused)
  await update((c) => ({
    ...c,
    synopsis: { title: 'Letters Not Yet Written', body: 'Kaito Ren meets Mio Asakura on a rooftop.', accepted: true },
  }))
  console.log('  ok  a cast cannot be proposed before a synopsis is accepted')

  // 2. Exactly two characters, with ids, nothing drawn.
  let chapter = await update((c) => proposeCast(c, kaito, mio))
  assert.equal(chapter.cast.length, 2)
  const [a, b] = chapter.cast
  assert.notEqual(a.id, b.id)
  for (const c of chapter.cast) {
    assert.equal(c.dna, null)
    assert.equal(c.sheetImageId, null)
    assert.equal(c.locked, false)
  }
  assert.equal(a.name, 'Kaito Ren')
  assert.equal(b.name, 'Mio Asakura')
  await assert.rejects(update((c) => proposeCast(c, kaito, mio)), /already proposed/)
  console.log('  ok  exactly two characters, proposed once')

  // 3. Reroll replaces one and leaves the other byte-identical.
  const before = JSON.stringify(a)
  chapter = await update((c) =>
    replaceCharacter(c, b.id, {
      name: 'Mio Asakura',
      role: 'Counterpart · the archive’s last clerk',
      traits: ['dry', 'exact', 'kind'],
      look: 'Twenty, tall. Cropped white hair, an inked key on the back of one hand, a grey work apron.',
    })
  )
  assert.equal(JSON.stringify(chapter.cast[0]), before, 'the untouched character changed')
  assert.equal(chapter.cast[1].id, b.id, 'the rerolled card keeps its place')
  assert.equal(chapter.cast[1].role, 'Counterpart · the archive’s last clerk')
  assert.deepEqual(chapter.cast[1].traits, ['dry', 'exact', 'kind'])
  console.log('  ok  reroll replaces one character and leaves the other byte-identical')

  // 4. Lock needs a drawn sheet.
  assert.throws(() => assertEditAllowed(chapter.cast[0], { locked: true }), /Draw Kaito Ren’s sheet/)
  console.log('  ok  lock is refused before a sheet exists')

  // 5. DNA, then a real PNG: extension from media_type, counted exactly once.
  chapter = await update((c) => setDna(c, a.id, KAITO_DNA))
  assert.equal(chapter.cast[0].dna, KAITO_DNA)
  const png = await readFile('data/kernel-test/0-sheet.png')
  const countBefore = chapter.imageCount
  const { chapter: after, imageId } = await saveImage(pid, 'sheet', png.toString('base64'), 'image/png', (c, id) =>
    attachSheet(c, a.id, KAITO_DNA, id)
  )
  assert.ok(isImageId(imageId), `bad image id ${imageId}`)
  assert.ok(imageId.startsWith('sheet-') && imageId.endsWith('.png'))
  assert.equal(mediaTypeOf(imageId), 'image/png')
  const written = await readFile(join(dir, 'images', imageId))
  assert.ok(written.equals(png), 'the written file is not the image that was returned')
  assert.ok((await readImage(imageId))?.equals(png))
  assert.equal(after.imageCount, countBefore + 1, 'imageCount must move by exactly one')
  assert.equal(after.cast[0].sheetImageId, imageId)
  assert.equal(after.cast[0].dna, KAITO_DNA)
  assert.equal(JSON.stringify(after.cast[1]), JSON.stringify(chapter.cast[1]), 'the other card changed')
  console.log(`  ok  a sheet lands as ${imageId} (${written.length} bytes) and imageCount is ${after.imageCount}`)

  // An unknown media type is a hard failure, not a guessed extension.
  await assert.rejects(saveImage(pid, 'sheet', 'AAAA', 'image/gif', (c) => c), /format/)
  assert.equal((await read()).imageCount, after.imageCount, 'a refused write must not count')
  // Unsafe ids never reach the disk.
  for (const bad of ['../chapter.json', 'sheet-x.svg', 'SHEET-X.PNG', 'a/b.png', '.png', 'x.png.exe']) {
    assert.equal(isImageId(bad), false, `accepted unsafe id ${bad}`)
    assert.equal(await readImage(bad), null)
  }
  console.log('  ok  unknown media types and unsafe ids are refused')

  // 6. Lock — then the character is read-only on the server.
  chapter = await update((c) => {
    assertEditAllowed(c.cast[0], { locked: true })
    return applyPatch(c, { cast: { [a.id]: { locked: true } } })
  })
  assert.equal(chapter.cast[0].locked, true)
  for (const edit of [{ name: 'X' }, { role: 'Y' }, { traits: [] }, { look: 'Z' }, { locked: true as const }]) {
    assert.throws(() => assertEditAllowed(chapter.cast[0], edit), /locked/)
  }
  await assert.rejects(update((c) => replaceCharacter(c, a.id, kaito)), /locked/)
  await assert.rejects(update((c) => setDna(c, a.id, 'other words')), /locked/)
  await assert.rejects(update((c) => attachSheet(c, a.id, 'other words', 'sheet-x.png')), /locked/)
  const onDisk = JSON.parse(await readFile(join(dir, 'projects', pid, 'project.json'), 'utf8'))
  assert.equal(onDisk.library.characters[0].dna, KAITO_DNA, 'a refused edit must leave the frozen DNA alone')
  assert.equal(onDisk.library.characters[0].sheetImageId, imageId)
  console.log('  ok  a locked character refuses reroll, redraw, text edits and a second lock')

  // 7. A changed look retires the DNA; name, role and traits leave it alone.
  const withDna = { ...chapter.cast[1], dna: 'some dna', sheetImageId: 'sheet-y.png' }
  assert.equal(editCharacter(withDna, { name: 'Mio' }).dna, 'some dna')
  assert.equal(editCharacter(withDna, { role: 'Lead' }).dna, 'some dna')
  assert.equal(editCharacter(withDna, { traits: ['a'] }).dna, 'some dna')
  assert.equal(editCharacter(withDna, { look: withDna.look }).dna, 'some dna', 'an unchanged look keeps the DNA')
  const edited = editCharacter(withDna, { look: 'a different look' })
  assert.equal(edited.dna, null)
  assert.equal(edited.sheetImageId, 'sheet-y.png', 'the stale sheet stays visible until redrawn')
  // ...and the same through the shared patch path, keystrokes merged.
  const merged = mergePatch({ cast: { [b.id]: { name: 'Mio' } } }, { cast: { [b.id]: { look: 'typed' } } })
  assert.deepEqual(merged.cast, { [b.id]: { name: 'Mio', look: 'typed' } })
  const patched = applyPatch(chapter, merged)
  assert.equal(patched.cast[1].name, 'Mio')
  assert.equal(patched.cast[1].look, 'typed')
  assert.equal(patched.cast[1].dna, null)
  assert.equal(JSON.stringify(patched.cast[0]), JSON.stringify(chapter.cast[0]), 'a patch for one card touched the other')
  console.log('  ok  editing the look retires the DNA; other edits keep it')

  // 8. Nothing left behind but the projects and the images folder (v2 layout).
  const files = (await readdir(dir)).sort()
  assert.deepEqual(files, ['images', 'projects'], `unexpected files left behind: ${files.join(', ')}`)
  assert.deepEqual((await readdir(join(dir, 'projects', pid))).sort(), ['project.json', 'project.json.bak'], 'the project and its backup, no stray temp file')
  console.log('  ok  only projects/ and images/ on disk, no temp file')

  console.log('\n  Cast station acceptance check passed.\n')
} finally {
  await rm(dir, { recursive: true, force: true })
}

// Slice 10's rules — the reference shelf and Import reference — against a
// scratch desk with both providers stubbed:
//
//   npm run check:assets
//
// An upload is kept only if its own bytes say PNG, JPEG or WebP and it is
// under the limit; it lands as a stored image and a shelf record in one write
// and never counts as a generated image. Importing makes the picture the
// card's sheet and retires the DNA; Lock is refused until the DNA is written
// back, from the picture, by the text model — which receives that picture's
// exact bytes. A locked imported card refuses everything. And the kernel
// holds for an imported character: their panel's single reference is the
// uploaded bytes. Nothing leaves this machine.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-assets-'))
process.env.INKDESK_DATA_DIR = dir
process.env.PANEL_CONCURRENCY = '2'
process.env.IMAGE_PANEL_QUALITY = 'low'
process.env.OPENROUTER_API_KEY = 'check-only-never-sent' // fetch is stubbed below
process.env.LLM_FALLBACK = 'always' // the text call goes through fetch, so it can be inspected

// Imported after the env is set, because the store reads it at load.
const { createProject, listProjects, read: readDesk, update: updateDesk } = await import('../lib/chapter')
const { addAsset, assetName, checkUpload, findAsset, MAX_ASSETS, sniffImage, UPLOAD_LIMIT_BYTES } = await import('../lib/assets')
const { readImage, saveAsset, saveImage } = await import('../lib/images')
const { assertEditAllowed, attachSheet, importSheet, proposeCast, setDna } = await import('../lib/cast')
const { applyPatch } = await import('../lib/patch')
const { writeDnaFromPicture } = await import('../lib/claude')
const { newScript, lockedPair } = await import('../lib/script')
const { inkPanel } = await import('../lib/panels')
const { Refused } = await import('../lib/errors')

import type { Chapter } from '../lib/types'

const first = await createProject({ title: 'Assets check', stylePresetId: 'manhwa-colour' })
const pid = first.address.projectId
const addr = first.address
const read = () => readDesk(pid, addr)
const update = (fn: (c: Chapter) => Chapter) => updateDesk(pid, fn, addr)

// --- The stub providers ------------------------------------------------------
type Sent = { url: string; body: Record<string, unknown> }
const sent: Sent[] = []
const PICTURE_DNA =
  'Aya Kuroda, a woman in her early twenties. Shoulder-length black hair with a blunt fringe, brown eyes, oval face, light skin, slim build. Wears a mustard raincoat over a grey hoodie, dark jeans and white sneakers. Distinguishing marks: a yellow raincoat and a small silver hoop in her left ear.'
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>
  sent.push({ url, body })
  if (url === 'https://openrouter.ai/api/v1/chat/completions') {
    return Response.json({
      choices: [{ message: { role: 'assistant', content: JSON.stringify({ dna: PICTURE_DNA }) }, finish_reason: 'stop' }],
      usage: { cost: 0.0011 },
    })
  }
  if (url === 'https://openrouter.ai/api/v1/images') {
    return Response.json({ data: [{ b64_json: Buffer.from('panel-art').toString('base64'), media_type: 'image/png' }], usage: { cost: 0.019 } })
  }
  throw new Error(`unexpected fetch ${url}`)
}) as typeof fetch

const png = await readFile('data/kernel-test/1-close.png') // a real PNG, 2.2 MB
const otherPng = await readFile('data/kernel-test/0-sheet.png')

try {
  // 1. What the shelf keeps, judged by the bytes.
  assert.equal(sniffImage(png), 'image/png')
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'image/jpeg')
  assert.equal(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])), 'image/webp')
  assert.equal(sniffImage(new TextEncoder().encode('GIF89a......')), null, 'a GIF is not kept')
  assert.equal(sniffImage(new TextEncoder().encode('MZ\u0090\u0000 not an image')), null, 'a renamed executable is not kept')
  assert.throws(() => checkUpload(new Uint8Array(), 0), /empty/)
  assert.throws(() => checkUpload(new TextEncoder().encode('GIF89a......'), 0), Refused)
  const huge = Buffer.alloc(UPLOAD_LIMIT_BYTES + 1)
  png.copy(huge, 0, 0, 16)
  assert.throws(() => checkUpload(huge, 0), /over 3\.75 MB/)
  assert.throws(() => checkUpload(png, MAX_ASSETS), /holds 24/)
  assert.equal(checkUpload(png, 0), 'image/png')
  assert.equal(assetName('C:\\drawings\\Aya — final.v2.png'), 'Aya — final.v2')
  assert.equal(assetName('.png'), 'Reference')
  console.log('  ok  the shelf keeps PNG, JPEG and WebP by their bytes, under 3.75 MB, 24 at most')

  // 2. An upload lands as a stored image and a shelf record, and is not a generation.
  await update((c) => proposeCast({ ...c, synopsis: { title: 'Rain Check', body: 'Aya meets Ren under an awning.', accepted: true } }, {
    name: 'Aya Kuroda', role: 'Lead', traits: ['wry'], look: 'A young woman in a raincoat.',
  }, {
    name: 'Ren Mori', role: 'Counterpart', traits: ['calm'], look: 'A tall young man with an umbrella.',
  }))
  const before = await read()
  const { chapter: shelved, asset } = await saveAsset(pid, png, 'image/png', 'Aya — my drawing')
  assert.equal(shelved.assets.length, 1)
  assert.ok(asset.id.startsWith('asset-') && asset.id.endsWith('.png'), asset.id)
  assert.equal(asset.blobId, asset.id)
  assert.equal(asset.bytes, png.length)
  assert.ok((await readImage(asset.blobId))?.equals(png), 'the stored bytes are the uploaded bytes')
  assert.equal(shelved.imageCount, before.imageCount, 'an upload never counts as a generated image')
  assert.equal(shelved.costUsd, before.costUsd, 'and never costs anything')
  assert.deepEqual(findAsset(shelved, asset.id), asset)
  assert.throws(() => findAsset(shelved, 'asset-nope.png'), /isn’t on this project’s shelf/)
  assert.equal(addAsset(shelved, asset).assets.length, 1, 'the same asset is never shelved twice')
  const onDisk = JSON.parse(await readFile(join(dir, 'projects', pid, 'project.json'), 'utf8'))
  assert.equal(onDisk.library.assets.length, 1, 'the shelf is persisted on the project')
  console.log('  ok  an upload is a stored image and a shelf record, written together; it never counts or costs')

  // 3. Import: the picture becomes the sheet, the DNA is retired, Lock waits for words.
  const [aya, ren] = (await read()).cast
  let desk = await update((c) => setDna(c, aya.id, 'words written from the look, before the import'))
  desk = await update((c) => importSheet(c, aya.id, asset.id))
  let card = desk.cast.find((c) => c.id === aya.id)!
  assert.equal(card.sheetImageId, asset.blobId)
  assert.equal(card.dna, null, 'the old words never describe the new picture')
  assert.equal(card.source, 'imported')
  assert.throws(() => assertEditAllowed(card, { locked: true }), /before locking/, 'Lock waits for the DNA')
  await assert.rejects(update((c) => importSheet(c, aya.id, 'asset-missing.png')), /shelf/)
  assert.equal(JSON.stringify(desk.cast.find((c) => c.id === ren.id)), JSON.stringify(ren), 'the other card is untouched')
  console.log('  ok  importing makes the picture the sheet and retires the DNA; Lock waits for words')

  // 4. The DNA is written FROM the picture: the text model receives its exact bytes.
  const dna = await writeDnaFromPicture(card, desk.synopsis!, { bytes: png, mediaType: 'image/png' })
  assert.equal(dna, PICTURE_DNA)
  const call = sent.find((s) => s.url.endsWith('/chat/completions'))!
  const content = (call.body.messages as { content: { type: string; image_url?: { url: string }; text?: string }[] }[])[0].content
  assert.equal(content[0].type, 'image_url')
  assert.equal(content[0].image_url?.url, `data:image/png;base64,${png.toString('base64')}`, 'the picture’s own bytes')
  assert.equal(content[1].type, 'text')
  assert.match(content[1].text ?? '', /the picture wins/)
  assert.match(content[1].text ?? '', /Aya Kuroda/)
  assert.match(content[1].text ?? '', /Never say who a real person/)
  desk = await update((c) => setDna(c, aya.id, dna))
  card = desk.cast.find((c) => c.id === aya.id)!
  assertEditAllowed(card, { locked: true })
  desk = await update((c) => applyPatch(c, { cast: { [aya.id]: { locked: true } } }))
  card = desk.cast.find((c) => c.id === aya.id)!
  assert.equal(card.locked, true)
  await assert.rejects(update((c) => importSheet(c, aya.id, asset.id)), /locked/, 'a locked imported card refuses a new picture')
  console.log('  ok  the DNA is written from the picture’s own bytes; then Lock works, and a locked card refuses imports')

  // 5. A drawn sheet replaces an import cleanly: the card is drawn again.
  const drawn = attachSheet({ ...desk, cast: desk.cast.map((c) => (c.id === aya.id ? { ...c, locked: false } : c)) }, aya.id, 'drawn dna', 'sheet-x.png')
  assert.equal(drawn.cast.find((c) => c.id === aya.id)!.source, undefined)
  console.log('  ok  drawing a sheet over an imported one makes the card drawn again')

  // 6. The kernel, for an imported character: her panel's single reference is the uploaded bytes.
  await update((c) => setDna(c, ren.id, 'Ren Mori, a tall young man with a black umbrella.'))
  await saveImage(pid, 'sheet', otherPng.toString('base64'), 'image/png', (c, id) => attachSheet(c, ren.id, 'Ren Mori, a tall young man with a black umbrella.', id))
  await update((c) => applyPatch(c, { cast: { [ren.id]: { locked: true } } }))
  const pair = lockedPair(await read())
  assert.equal(pair[0].id, aya.id, 'the imported character is the lead')
  const line = (who: string, n: number) => ({ characterId: who, action: `beat ${n}`, camera: 'eye level', background: 'a rainy street', dialogue: `line ${n}` })
  await update((c) => newScript(c, { panel1: line(aya.id, 1), panel2: line(ren.id, 2), panel3: line(aya.id, 3), panel4: line(ren.id, 4) }))
  await inkPanel(addr, 0)
  const imageCall = sent.filter((s) => s.url.endsWith('/images')).at(-1)!
  const refs = imageCall.body.input_references as { image_url: { url: string } }[]
  assert.equal(refs.length, 1, 'exactly one reference')
  assert.equal(refs[0].image_url.url, `data:image/png;base64,${png.toString('base64')}`, 'the uploaded picture is the reference')
  assert.ok(String(imageCall.body.prompt).includes(PICTURE_DNA), 'with the DNA written from it, verbatim')
  assert.match(String(imageCall.body.prompt), /Full-colour manhwa/, 'in the project’s locked style')
  assert.equal((await read()).script![0].status, 'done')
  console.log('  ok  an imported character’s panel carries the uploaded bytes as its one reference, and her DNA verbatim')

  // 7. The desk's library lists locked characters, imported or drawn.
  const summary = (await listProjects()).find((p) => p.id === pid)!
  assert.deepEqual(
    summary.characters.map((c) => [c.name, c.imported]),
    [['Aya Kuroda', true], ['Ren Mori', false]]
  )
  console.log('  ok  the desk’s library lists both locked characters, imported and drawn')

  console.log('\n  Reference shelf and import check passed.\n')
} finally {
  globalThis.fetch = realFetch
  await rm(dir, { recursive: true, force: true })
}

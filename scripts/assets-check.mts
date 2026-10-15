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
//
// Since v3 (slice 16, SEC-05) what is stored is the picture drawn again, not
// the bytes as sent: GPS and every other tag are gone, a payload appended
// after the image is gone, and a file that only claims to be a picture is
// refused. SEC-11 and SEC-09 are checked here too: what the browser is told
// when something fails, and the headers every response carries.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp, { type Sharp } from 'sharp'

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-assets-'))
process.env.INKDESK_DATA_DIR = dir
process.env.PANEL_CONCURRENCY = '2'
process.env.IMAGE_PANEL_QUALITY = 'low'
process.env.OPENROUTER_API_KEY = 'check-only-never-sent' // fetch is stubbed below
process.env.LLM_FALLBACK = 'always' // the text call goes through fetch, so it can be inspected

// Imported after the env is set, because the store reads it at load.
const { createProject, listProjects, read: readDesk, update: updateDesk } = await import('../lib/chapter')
const { addAsset, assetName, checkUpload, findAsset, MAX_ASSETS, MAX_UPLOAD_SIDE, NOT_A_PICTURE, sniffImage, TOO_MANY_PIXELS, UPLOAD_LIMIT_BYTES } =
  await import('../lib/assets')
const { cleanUpload, readImage, saveAsset, saveImage } = await import('../lib/images')
const { assertEditAllowed, attachSheet, importSheet, proposeCast, setDna } = await import('../lib/cast')
const { applyPatch } = await import('../lib/patch')
const { writeDnaFromPicture } = await import('../lib/claude')
const { newScript, lockedPair } = await import('../lib/script')
const { inkPanel } = await import('../lib/panels')
const { configSentence, errorResponse, ProviderError, Refused, UNAVAILABLE } = await import('../lib/errors')
const { POST: uploadRoute } = await import('../app/api/projects/[id]/assets/route')
const nextConfig = (await import('../next.config')).default

import type { Chapter } from '../lib/types'

const first = await createProject({ title: 'Assets check', stylePresetId: 'manhwa-colour' }, 'local')
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
  const stored = (await readImage(asset.blobId))!
  assert.ok(stored, 'the upload is stored')
  assert.equal(asset.bytes, stored.length, 'the shelf records the stored size')
  assert.equal(sniffImage(stored), 'image/png', 'a PNG is kept as a PNG')
  const [inMeta, outMeta] = await Promise.all([sharp(png).metadata(), sharp(stored).metadata()])
  assert.deepEqual([outMeta.width, outMeta.height], [inMeta.width, inMeta.height], 'the same picture, drawn again')
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
  const dna = await writeDnaFromPicture(card, desk.synopsis!, { bytes: stored, mediaType: 'image/png' })
  assert.equal(dna, PICTURE_DNA)
  const call = sent.find((s) => s.url.endsWith('/chat/completions'))!
  const content = (call.body.messages as { content: { type: string; image_url?: { url: string }; text?: string }[] }[])[0].content
  assert.equal(content[0].type, 'image_url')
  assert.equal(content[0].image_url?.url, `data:image/png;base64,${stored.toString('base64')}`, 'the stored picture’s bytes')
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
  assert.equal(refs[0].image_url.url, `data:image/png;base64,${stored.toString('base64')}`, 'the uploaded picture, as stored, is the reference')
  assert.ok(String(imageCall.body.prompt).includes(PICTURE_DNA), 'with the DNA written from it, verbatim')
  assert.match(String(imageCall.body.prompt), /Full-colour manhwa/, 'in the project’s locked style')
  assert.equal((await read()).script![0].status, 'done')
  console.log('  ok  an imported character’s panel carries the uploaded bytes as its one reference, and her DNA verbatim')

  // 7. The desk's library lists locked characters, imported or drawn.
  const summary = (await listProjects('local')).find((p) => p.id === pid)!
  assert.deepEqual(
    summary.characters.map((c) => [c.name, c.imported]),
    [['Aya Kuroda', true], ['Ren Mori', false]]
  )
  console.log('  ok  the desk’s library lists both locked characters, imported and drawn')

  // 8. SEC-05: only pixels are kept. A photo's GPS and camera tags are gone,
  //    and its orientation is baked in rather than lost with the tag.
  const MARKER = 'INKDESK-GPS-MARKER'
  const tagged = (img: Sharp) =>
    img.withExif({ IFD0: { Make: 'CheckCam' }, IFD3: { GPSMapDatum: MARKER, GPSLatitudeRef: 'N', GPSLatitude: '35/1 41/1 0/1' } })
  const photo = await tagged(sharp({ create: { width: 60, height: 30, channels: 3, background: '#b33' } }))
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer()
  assert.ok(photo.includes(MARKER) && (await sharp(photo).metadata()).exif, 'the test photo carries GPS')
  const shelf2 = await createProject({ title: 'Uploads check', stylePresetId: 'manga-bw' }, 'local')
  const pid2 = shelf2.address.projectId
  const { asset: photoAsset } = await saveAsset(pid2, photo, checkUpload(photo, 0), 'Holiday photo')
  const cleanPhoto = (await readImage(photoAsset.blobId))!
  const cleanMeta = await sharp(cleanPhoto).metadata()
  assert.equal(cleanMeta.format, 'jpeg', 'a JPEG is kept as a JPEG')
  assert.ok(!cleanPhoto.includes(MARKER) && !cleanPhoto.includes('CheckCam'), 'no GPS, no camera')
  assert.equal(cleanMeta.exif, undefined, 'no EXIF at all')
  assert.equal(cleanMeta.xmp, undefined, 'no XMP')
  assert.equal(cleanMeta.icc, undefined, 'no ICC profile')
  assert.equal(cleanMeta.orientation, undefined, 'no orientation tag…')
  assert.deepEqual([cleanMeta.width, cleanMeta.height], [30, 60], '…because the turn is in the pixels')
  const webp = await tagged(sharp({ create: { width: 20, height: 20, channels: 3, background: '#3b3' } })).webp().toBuffer()
  assert.ok(webp.includes(MARKER))
  const cleanWebp = await cleanUpload(webp, 'image/webp')
  assert.ok(!cleanWebp.includes(MARKER) && sniffImage(cleanWebp) === 'image/webp', 'a WebP keeps its format and loses its tags')
  console.log('  ok  an upload’s EXIF — GPS, camera, orientation — is gone; the picture is turned the way it was shot')

  // 9. A payload after the image's end is never stored.
  const small = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#0000' } }).png().toBuffer()
  const payload = Buffer.from('PK\u0003\u0004<html><script>alert(1)</script></html>INKDESK-PAYLOAD')
  const smuggled = Buffer.concat([small, payload])
  assert.equal(checkUpload(smuggled, 0), 'image/png', 'the first bytes alone would have kept it')
  const { asset: smuggledAsset } = await saveAsset(pid2, smuggled, 'image/png', 'Innocent.png')
  const cleanSmuggled = (await readImage(smuggledAsset.blobId))!
  assert.ok(!cleanSmuggled.includes('INKDESK-PAYLOAD') && !cleanSmuggled.includes('<script>'), 'the payload is gone')
  assert.ok(cleanSmuggled.subarray(-8).equals(small.subarray(-8)), 'the stored file ends at its IEND')
  console.log('  ok  bytes appended after a PNG’s IEND are not stored')

  // 10. Something that only says it is a picture is refused, with the shelf's sentence.
  const upload = async (bytes: Uint8Array, name: string) => {
    const form = new FormData()
    form.set('file', new File([new Uint8Array(bytes)], name, { type: 'image/png' }))
    const res = await uploadRoute(new Request('http://check/api', { method: 'POST', body: form }), { params: Promise.resolve({ id: pid2 }) })
    return { status: res.status, body: (await res.json()) as { error?: string; assets?: unknown[] } }
  }
  const html = new TextEncoder().encode('<!doctype html><html><script>alert(document.cookie)</script></html>')
  assert.deepEqual(await upload(html, 'cute-cat.png'), { status: 415, body: { error: NOT_A_PICTURE } }, 'HTML named .png is refused')
  const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('<html><script>alert(1)</script></html>')])
  assert.deepEqual(await upload(fakeJpeg, 'photo.jpg'), { status: 415, body: { error: NOT_A_PICTURE } }, 'a JPEG header on HTML is refused')
  const wide = await sharp({ create: { width: MAX_UPLOAD_SIDE + 1, height: 8, channels: 3, background: '#fff' } }).png().toBuffer()
  assert.deepEqual(await upload(wide, 'banner.png'), { status: 413, body: { error: TOO_MANY_PIXELS } }, 'a side over the limit is refused')
  // A small file that inflates into a huge bitmap is refused before it is decoded.
  const bomb = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#fff' } }).png({ compressionLevel: 9 }).toBuffer()
  assert.ok(bomb.length < 200_000, `the bomb is small on disk (${bomb.length} bytes)`)
  await assert.rejects(cleanUpload(bomb, 'image/png'), (e: unknown) => e instanceof Refused && e.message === TOO_MANY_PIXELS)
  const ok = await upload(smuggled, 'again.png')
  assert.equal(ok.status, 200, 'and a real picture still goes through the route')
  assert.equal((await readDesk(pid2)).assets.length, 3, 'nothing refused reached the shelf')
  console.log('  ok  HTML named .png, a JPEG header on HTML, an oversized side and a pixel bomb are each refused calmly')

  // 11. SEC-11: the browser gets a sentence, never the cause.
  const quiet = console.error
  const logged: string[] = []
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(' '))
  try {
    const leak = new ProviderError('busy', 'provider', 'HTTP 500 {"error":"openai/gpt-image-2.5-sunburst on openrouter.ai: /srv/app/lib/x.ts:12"}')
    const res = errorResponse(leak, 'check', 'The sheet didn’t come back.')
    assert.deepEqual(await res.json(), { error: 'The sheet didn’t come back.' })
    const ref = res.headers.get('X-Error-Ref')
    assert.match(ref ?? '', /^[0-9a-f]{8}$/, 'the response carries a reference…')
    assert.ok(logged.some((l) => l.includes(`ref ${ref}`) && l.includes('gpt-image')), '…and the terminal has the cause under it')
    const crash = errorResponse(new Error('ENOENT: /home/user/Ink-Desk/data/x.json'), 'check', 'Calm.')
    assert.deepEqual(await crash.json(), { error: 'Calm.' })
    assert.equal(crash.status, 500)
    const config = new ProviderError('Add OPENROUTER_API_KEY to .env and restart the dev server.', 'config')
    assert.match(configSentence(config), /OPENROUTER_API_KEY/, 'a development desk names the fix')
    const env = process.env as Record<string, string | undefined>
    const nodeEnv = env.NODE_ENV
    env.NODE_ENV = 'production'
    try {
      assert.equal(configSentence(config), UNAVAILABLE)
      const body = JSON.stringify(await errorResponse(config, 'check', 'Calm.').json())
      assert.ok(!body.includes('OPENROUTER') && body.includes(UNAVAILABLE), 'production names no variable')
    } finally {
      if (nodeEnv === undefined) delete env.NODE_ENV
      else env.NODE_ENV = nodeEnv
    }
  } finally {
    console.error = quiet
  }
  console.log('  ok  errors reach the browser as sentences with a reference; config sentences stay in the terminal in production')

  // 12. SEC-09: the headers on every response, and no X-Powered-By.
  assert.equal(nextConfig.poweredByHeader, false)
  const rules = await nextConfig.headers!()
  const all = rules.find((r) => r.source === '/:path*')
  assert.ok(all, 'one rule covers every path, pages and API alike')
  const h = Object.fromEntries(all.headers.map((x) => [x.key, x.value]))
  const csp = Object.fromEntries(h['Content-Security-Policy'].split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1).join(' ')]))
  assert.equal(csp['default-src'], "'self'")
  assert.ok(csp['script-src'].startsWith("'self' 'unsafe-inline'"), 'scripts from this origin only')
  assert.ok(!/https?:|\*/.test(csp['script-src']), 'no other host may serve a script')
  assert.equal(csp['frame-ancestors'], "'none'")
  assert.equal(csp['object-src'], "'none'")
  assert.equal(csp['base-uri'], "'self'")
  assert.equal(csp['form-action'], "'self'")
  assert.equal(csp['connect-src'], "'self'")
  assert.equal(h['X-Content-Type-Options'], 'nosniff')
  assert.equal(h['Referrer-Policy'], 'strict-origin-when-cross-origin')
  assert.equal(h['X-Frame-Options'], 'DENY')
  assert.equal(h['Permissions-Policy'], 'camera=(), microphone=(), geolocation=()')
  assert.equal(h['Strict-Transport-Security'], undefined, 'no HSTS outside production (it would pin localhost)')
  console.log('  ok  every response carries the CSP, nosniff, frame denial, referrer and permissions policies; no X-Powered-By')

  console.log('\n  Reference shelf and import check passed.\n')
} finally {
  globalThis.fetch = realFetch
  await rm(dir, { recursive: true, force: true })
}

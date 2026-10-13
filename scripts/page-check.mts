// The Storyboard's server-side rules from `devpost/checklist.md > Slices > 5`,
// run against a scratch folder with no provider in the loop:
//
//   npm run check:page
//
// The queue runs two at a time and never doubles a key. The page script
// schema admits one locked character per panel, alternating, and nothing
// else. Every panel request carries exactly one reference — that panel's
// character's locked sheet — plus the DNA verbatim, the framing line and the
// no-text rule, at the slot's ratio, and never the dialogue. Panels land out
// of order without a lost update, `imageCount` reads 6 after two sheets and
// four panels, never more than two panels are inking at once, and the reader
// opens only when all four have art. OpenRouter is replaced by a stub `fetch`
// that holds each request until this check releases it, so the order the
// panels finish in is the check's to choose.
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-page-'))
process.env.INKDESK_DATA_DIR = dir
process.env.PANEL_CONCURRENCY = '2'
process.env.IMAGE_PANEL_QUALITY = 'low'
process.env.OPENROUTER_API_KEY = 'check-only-never-sent' // fetch is stubbed below; nothing leaves this machine

// Imported after the env is set, because the store and the queue read it at load.
const { createProject, read: readDesk, update: updateDesk } = await import('../lib/chapter')
const { singletons } = await import('../lib/singleton')
const { createQueue } = await import('../lib/queue')
const { saveImage } = await import('../lib/images')
const { assertEditAllowed, attachSheet, proposeCast, setDna } = await import('../lib/cast')
const { applyPatch } = await import('../lib/patch')
const { gates } = await import('../lib/gates')
const { pageScriptSchema } = await import('../lib/schemas')
const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod')
const { PANEL_LAYOUT, STYLE_RULES, pageScriptPrompt, panelPrompt } = await import('../lib/prompts')
const { bubbleCorner, currentImageId, lockedPair, markInking, newScript, panelLabel } = await import('../lib/script')
const { inkPanel, queueBlankPanels } = await import('../lib/panels')
const { Refused } = await import('../lib/errors')

import type { Chapter, Project } from '../lib/types'

// One project on the scratch desk (v2); every call below is addressed to its one page.
const first = await createProject({ title: 'Page check', stylePresetId: 'manga-bw' })
const pid = first.address.projectId
const addr = first.address
const read = () => readDesk(pid, addr)
const update = (fn: (c: Chapter) => Chapter) => updateDesk(pid, fn, addr)

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function until(what: string, pred: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const t0 = Date.now()
  while (!(await pred())) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

const synopsis = {
  title: 'Letters Not Yet Written',
  body: 'Kaito Ren meets Mio Asakura on a rooftop above Osaka and hands over a letter she has not written yet.',
  accepted: true,
}
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
const MIO_DNA =
  'Mio Asakura, a 20-year-old woman. Chin-length silver bob with a straight fringe, dark grey eyes behind round wire glasses, small upright build, pale skin. Wears a long charcoal wool coat with brass buttons over a white blouse, grey pleated skirt, black tights and flat shoes. Distinguishing marks: the round wire glasses, and a brass key on a cord around her neck.'

// Two different real PNGs, so "the reference is that character's sheet" is a real assertion.
const kaitoSheet = await readFile('data/kernel-test/0-sheet.png')
const mioSheet = await readFile('data/kernel-test/1-close.png')

const realFetch = globalThis.fetch

try {
  // 1. The queue on its own: two at a time, keys deduped, finishing order free.
  {
    const q = createQueue(2)
    const holds = [0, 1, 2, 3].map(() => deferred<void>())
    const finished: number[] = []
    for (const i of [0, 1, 2, 3]) {
      assert.equal(
        q.enqueue(`p${i}`, async () => {
          await holds[i].promise
          finished.push(i)
        }),
        true
      )
    }
    assert.equal(q.enqueue('p1', async () => {}), false, 'a key already queued must not be added twice')
    await tick()
    assert.deepEqual(q.running(), ['p0', 'p1'])
    assert.deepEqual(q.waiting(), ['p2', 'p3'])
    holds[1].resolve()
    await until('p2 to start', () => q.running().includes('p2'))
    assert.deepEqual(q.running(), ['p0', 'p2'], 'finishing one slot starts exactly one more')
    holds[2].resolve()
    await until('p3 to start', () => q.running().includes('p3'))
    assert.deepEqual(q.running(), ['p0', 'p3'])
    holds[3].resolve()
    holds[0].resolve()
    await until('the queue to drain', () => q.running().length === 0)
    assert.deepEqual(finished, [1, 2, 3, 0], 'jobs finish in whatever order they land, not page order')
    assert.equal(q.has('p0'), false)
    assert.equal(q.enqueue('p0', async () => {}), true, 'a finished key can be queued again')
    // A job that throws past its own handler is logged, and the pump goes on.
    const quiet = console.error
    console.error = () => {}
    q.enqueue('boom', async () => {
      throw new Error('boom')
    })
    q.enqueue('after', async () => {
      finished.push(9)
    })
    await until('the pump to survive a throw', () => finished.includes(9))
    console.error = quiet
    assert.throws(() => createQueue(0), /PANEL_CONCURRENCY/)
    assert.equal(singletons.queue.concurrency, 2, 'the process queue reads PANEL_CONCURRENCY')
    console.log('  ok  the queue runs two at a time, dedupes keys, and finishes out of order')
  }

  // 2. The desk: an accepted synopsis, two characters, two locked sheets. Two images.
  await update((c) => ({ ...c, synopsis }))
  let chapter = await update((c) => proposeCast(c, kaito, mio))
  const [a, b] = chapter.cast
  assert.throws(() => lockedPair(chapter), /Lock both model sheets first/)

  const lockWith = async (id: string, dna: string, png: Buffer) => {
    await update((c) => setDna(c, id, dna))
    await saveImage(pid, 'sheet', png.toString('base64'), 'image/png', (c, imageId) => attachSheet(c, id, dna, imageId))
    return update((c) => {
      const who = c.cast.find((x) => x.id === id)
      if (!who) throw new Error('lost the character')
      assertEditAllowed(who, { locked: true })
      return applyPatch(c, { cast: { [id]: { locked: true } } })
    })
  }
  chapter = await lockWith(a.id, KAITO_DNA, kaitoSheet)
  assert.throws(() => lockedPair(chapter), /Lock Mio Asakura’s sheet first/)
  chapter = await lockWith(b.id, MIO_DNA, mioSheet)
  const pair = lockedPair(chapter)
  assert.deepEqual(
    pair.map((c) => c.name),
    ['Kaito Ren', 'Mio Asakura'],
    'lead first, counterpart second'
  )
  assert.equal(chapter.imageCount, 2)
  assert.throws(() => newScript({ ...chapter, cast: [] }, {} as never), Refused)
  console.log('  ok  both characters locked with sheets; imageCount is 2')

  // 3. The schema: one locked character per panel, alternating, and nothing else.
  const schema = pageScriptSchema([a.id, b.id])
  const line = (characterId: string, n: number) => ({
    characterId,
    action: `Action ${n}: something drawable.`,
    camera: n % 2 ? 'slight low angle, looking up' : 'eye level, three-quarter view',
    background: `Background ${n}: the rooftop, from this angle.`,
    dialogue: `Line ${n} of dialogue`,
  })
  const good = { panel1: line(a.id, 1), panel2: line(b.id, 2), panel3: line(a.id, 3), panel4: line(b.id, 4) }
  assert.ok(schema.safeParse(good).success, 'the alternating page must parse')
  assert.equal(schema.safeParse({ ...good, panel2: line(a.id, 2) }).success, false, 'the lead in the counterpart’s slot')
  assert.equal(schema.safeParse({ ...good, panel1: line(b.id, 1) }).success, false, 'the counterpart in the lead’s slot')
  assert.equal(schema.safeParse({ ...good, panel3: line('someone-else', 3) }).success, false, 'an unlocked id')
  // What actually reaches the API. The SDK keeps only the strict subset —
  // type, properties, required, description, a few string formats — and
  // lowers everything else, `enum` included, into the description. So the
  // model reads the allowed id as text, and it is the SDK's own `parse`,
  // run before `parsed_output` exists, that refuses a wrong one.
  const format = zodOutputFormat(schema)
  const wire = JSON.stringify(format)
  const lowered = (id: string) => wire.split(`{enum: [\\"${id}\\"]}`).length - 1
  assert.equal(lowered(a.id), 2, 'the lead’s id is in two descriptions')
  assert.equal(lowered(b.id), 2, 'the counterpart’s id is in two descriptions')
  assert.ok(!/"enum"|"const"|minLength|maxLength|"minimum"|"maximum"/.test(wire), 'nothing outside the API’s subset is sent')
  const parse = (format as { parse: (text: string) => unknown }).parse
  assert.deepEqual(parse(JSON.stringify(good)), good)
  assert.throws(() => parse(JSON.stringify({ ...good, panel2: line(a.id, 2) })), /panel2\.characterId/, 'the SDK refuses it')
  assert.throws(() => parse(JSON.stringify({ ...good, panel4: line('nobody', 4) })), /panel4\.characterId/)
  console.log('  ok  the page script schema admits lead / counterpart / lead / counterpart and nothing else')

  // 4. The script lands as four blank panels in page order; the prompt carries both DNAs.
  chapter = await update((c) => newScript(c, good))
  assert.equal(chapter.script?.length, 4)
  assert.deepEqual(
    chapter.script?.map((p) => p.characterId),
    [a.id, b.id, a.id, b.id],
    'alternating'
  )
  assert.deepEqual(
    chapter.script?.map((p) => p.index),
    [0, 1, 2, 3]
  )
  for (const p of chapter.script ?? []) {
    assert.equal(p.status, 'empty')
    assert.deepEqual(p.versions, [])
    assert.equal(p.dialogue, `Line ${p.index + 1} of dialogue`)
  }
  await assert.rejects(update((c) => newScript(c, good)), /already written/)
  assert.throws(
    () => newScript({ ...chapter, script: null }, { ...good, panel2: line(a.id, 2) }),
    /the layout puts/,
    'a slot/character disagreement never reaches the desk'
  )
  const prompt = pageScriptPrompt(synopsis, [
    { ...pair[0], dna: KAITO_DNA },
    { ...pair[1], dna: MIO_DNA },
  ])
  assert.ok(prompt.includes(KAITO_DNA) && prompt.includes(MIO_DNA), 'both locked DNAs, verbatim')
  assert.ok(prompt.includes(`(id ${a.id})`) && prompt.includes(`(id ${b.id})`))
  for (const slot of PANEL_LAYOUT) assert.ok(prompt.includes(slot.framing), `framing for panel ${slot.index + 1}`)
  assert.ok(/Panel 1: Kaito Ren.*\n.*Panel 2: Mio Asakura.*\n.*Panel 3: Kaito Ren.*\n.*Panel 4: Mio Asakura/.test(prompt))
  assert.ok(/exactly one character in each/.test(prompt))
  console.log('  ok  the script lands as four blank panels, lead / counterpart / lead / counterpart')

  // 5. The kernel, offline: OpenRouter is a stub that holds each request until released.
  type Held = { body: Record<string, unknown>; release: (status?: number, text?: string) => void }
  const held: Held[] = []
  const ok = (png: Buffer) =>
    Response.json({ data: [{ b64_json: png.toString('base64'), media_type: 'image/png' }], usage: { cost: 0.0042 } })
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), 'https://openrouter.ai/api/v1/images')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    const { promise, resolve } = deferred<Response>()
    held.push({
      body,
      release: (status = 200, text = 'nope') => resolve(status === 200 ? ok(kaitoSheet) : new Response(text, { status })),
    })
    return promise
  }) as typeof fetch

  let maxInking = 0
  const desk = async (): Promise<Chapter> => {
    const c = await read()
    maxInking = Math.max(maxInking, c.script?.filter((p) => p.status === 'inking').length ?? 0)
    return c
  }
  const status = async () => (await desk()).script?.map((p) => p.status) ?? []

  assert.deepEqual(await queueBlankPanels(addr), [0, 1, 2, 3])
  assert.deepEqual(await queueBlankPanels(addr), [], 'panels already queued are not queued twice')
  await until('two requests in flight', () => held.length === 2)
  await until('two panels inking', async () => (await status()).filter((s) => s === 'inking').length === 2)
  assert.deepEqual(await status(), ['inking', 'inking', 'empty', 'empty'])
  chapter = await desk()
  for (const p of chapter.script?.slice(0, 2) ?? []) {
    assert.equal(p.startedByRun, singletons.serverRunId, 'stamped with the server run, for the restart fallback')
    assert.ok(p.startedAt, 'stamped with a start time, for the timeout fallback')
  }

  // Which held request belongs to which panel is identified by the panel's
  // own action line in the prompt — never by arrival order, which races: the
  // two jobs read different-sized sheet files before calling the provider,
  // so either request can reach the stub first.
  const actions = chapter.script?.map((p) => p.action) ?? []
  const heldFor = async (index: number): Promise<Held> => {
    await until(`panel ${index + 1}’s request`, () =>
      held.some((h) => String(h.body.prompt).includes(actions[index]))
    )
    return held.find((h) => String(h.body.prompt).includes(actions[index]))!
  }
  for (const [i, sheet] of [
    [0, kaitoSheet],
    [1, mioSheet],
  ] as const) {
    const body = (await heldFor(i)).body
    const slot = PANEL_LAYOUT[i]
    const panel = chapter.script?.[i]
    const who = chapter.cast.find((c) => c.id === panel?.characterId)
    assert.ok(panel && who)
    const refs = body.input_references as { type: string; image_url: { url: string } }[]
    assert.equal(refs.length, 1, `panel ${i + 1} carries exactly one reference`)
    assert.equal(refs[0].type, 'image_url')
    assert.equal(refs[0].image_url.url, `data:image/png;base64,${sheet.toString('base64')}`, 'that character’s locked sheet')
    assert.equal(body.aspect_ratio, slot.shape === 'wide' ? '3:2' : '1:1', `panel ${i + 1} at its slot’s ratio`)
    assert.equal(body.quality, 'low')
    assert.equal(body.n, 1)
    assert.equal(body.model, 'openai/gpt-image-2.5-sunburst')
    assert.equal(body.size, undefined, 'never size — it would be dropped silently')
    const text = String(body.prompt)
    assert.ok(text.includes(who.dna ?? '\0'), 'the DNA, verbatim')
    assert.ok(text.includes(slot.framing), 'the slot’s framing line')
    assert.ok(text.includes(STYLE_RULES) && /NO TEXT/.test(text), 'the frozen style rules and the no-text rule')
    assert.ok(text.includes(panel.action) && text.includes(panel.camera) && text.includes(panel.background))
    assert.ok(!text.includes(panel.dialogue), 'dialogue is lettered by the app, never sent to the image model')
    assert.equal(text, panelPrompt(who.dna ?? '', panel, slot), 'the prompt is panelPrompt(), nothing else')
    assert.ok(/exactly one person/.test(text))
  }
  console.log('  ok  each request: one reference (that character’s sheet), the DNA verbatim, the framing, no text, its own ratio')

  // Land them out of page order: 2, then 1, then 4, then 3.
  const landed: number[] = []
  const land = async (i: number) => {
    ;(await heldFor(i)).release()
    await until(`panel ${i + 1} to land`, async () => (await status())[i] === 'done')
    landed.push(i)
  }
  await land(1)
  await until('panel 3 to start', () => held.length === 3)
  assert.deepEqual(await status(), ['inking', 'done', 'inking', 'empty'], 'panel 2 landed while 1 is still inking; 3 took its slot')
  await land(0)
  await until('panel 4 to start', () => held.length === 4)
  chapter = await desk()
  assert.deepEqual(await status(), ['done', 'done', 'inking', 'inking'])
  assert.equal(gates(chapter).reader.open, false)
  await land(3)
  chapter = await desk()
  assert.equal(gates(chapter).reader.open, false, 'three of four is not a page')
  assert.equal(gates(chapter).reader.hint, 'Finish panel 3 first.')
  await land(2)
  assert.deepEqual(landed, [1, 0, 3, 2], 'landed out of order')
  assert.equal(maxInking, 2, 'never more than two inking at once')

  chapter = await desk()
  assert.deepEqual(await status(), ['done', 'done', 'done', 'done'])
  assert.equal(chapter.imageCount, 6, 'two sheets and four panels — the lost-update canary')
  const ids = chapter.script?.map((p) => currentImageId(p)) ?? []
  assert.equal(new Set(ids).size, 4, 'four distinct panel images')
  for (const p of chapter.script ?? []) {
    assert.equal(p.versions.length, 1)
    assert.equal(p.currentVersion, 0)
    assert.ok(p.versions[0].imageId.startsWith('panel-') && p.versions[0].imageId.endsWith('.png'))
    assert.equal(p.startedAt, null)
    assert.equal(p.startedByRun, null)
    assert.ok((await readFile(join(dir, 'images', p.versions[0].imageId))).equals(kaitoSheet))
  }
  const onDisk = JSON.parse(await readFile(join(dir, 'projects', pid, 'project.json'), 'utf8')) as Project
  assert.equal(onDisk.usage.images, 6)
  assert.equal(onDisk.chapters[0].pages[0].panels.filter((p) => p.status === 'done').length, 4, 'all four survive on disk')
  assert.equal(gates(chapter).reader.open, true, 'four panels with art open the reader')
  assert.deepEqual(await queueBlankPanels(addr), [], 'nothing blank is left to queue')
  console.log('  ok  panels landed 2, 1, 4, 3 — no lost update, imageCount is 6, the reader opened on the fourth')

  // 6. Honest failures in the data (the repairs are slice 6): a 500 lands as
  //    `failed`, a moderation 400 as `refused`, neither counts an image.
  const quiet = console.error
  console.error = () => {}
  chapter = await update((c) => newScript({ ...c, script: null }, good))
  let job = inkPanel(addr, 0)
  await until('a fifth request', () => held.length === 5)
  held[4].release(500, 'upstream exploded')
  await job
  job = inkPanel(addr, 1)
  await until('a sixth request', () => held.length === 6)
  held[5].release(400, '{"error":{"message":"rejected by the moderation system"}}')
  await job
  console.error = quiet
  chapter = await desk()
  assert.equal(chapter.script?.[0].status, 'failed')
  assert.equal(chapter.script?.[1].status, 'refused')
  assert.deepEqual(chapter.script?.[0].versions, [])
  assert.equal(chapter.imageCount, 6, 'a failure never counts an image')
  assert.throws(() => markInking(markInking(chapter, 2, 'run'), 2, 'run'), /already inking/)
  assert.throws(
    () => markInking({ ...chapter, cast: chapter.cast.map((c) => ({ ...c, locked: false })) }, 2, 'run'),
    /isn’t locked/
  )
  console.log('  ok  a 500 lands as failed, a moderation 400 as refused; an inking panel cannot be claimed twice')

  // 7. Derived, never stored: labels and bubble corners.
  assert.equal(panelLabel({ index: 1, status: 'empty' }), 'Pencilling panel 2…')
  assert.equal(panelLabel({ index: 1, status: 'inking' }), 'Inking panel 2…')
  assert.equal(panelLabel({ index: 2, status: 'failed' }), 'Panel 3 didn’t come back, the studio is busy.')
  assert.equal(panelLabel({ index: 3, status: 'done' }), '')
  const eye = 'eye level, three-quarter view'
  assert.equal(bubbleCorner({ index: 0, camera: eye }), 'top-right', 'the figure is in the left third')
  assert.equal(bubbleCorner({ index: 1, camera: eye }), 'top-left')
  assert.equal(bubbleCorner({ index: 2, camera: eye }), 'top-right')
  assert.equal(bubbleCorner({ index: 3, camera: eye }), 'top-left', 'the figure is in the right third')
  assert.equal(bubbleCorner({ index: 0, camera: 'High angle, looking down from the water tower' }), 'bottom-right')
  console.log('  ok  placeholder labels and bubble corners derive from the panel')

  // 8. Nothing left behind but the projects and the images folder (v2 layout).
  const files = (await readdir(dir)).sort()
  assert.deepEqual(files, ['images', 'projects'], `unexpected files left behind: ${files.join(', ')}`)
  assert.deepEqual(await readdir(join(dir, 'projects', pid)), ['project.json'], 'no stray temp file in the project')
  console.log('  ok  only projects/ and images/ on disk, no temp file')

  console.log('\n  Storyboard acceptance check passed.\n')
} finally {
  globalThis.fetch = realFetch
  await rm(dir, { recursive: true, force: true })
}

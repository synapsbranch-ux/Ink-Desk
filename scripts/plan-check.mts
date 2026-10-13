// Slice 11's rules from `devpost/checklist.md > Slices > 11`, run against a
// scratch folder with every provider stubbed — neither Claude, nor the text
// fallback, nor the image model is ever called:
//
//   npm run check:plan
//
// The chapter plan's schema refuses a page count under 3 or over 6 and a wrong
// character in a slot, and survives both providers' strict grammars. The
// estimate is pages × 4 × the per-panel figure + the cover, at `low` and
// `high`. A scenario saved opens the Library; both locks open the Director; a
// plan opens the Page station. The Director's call carries the story, the
// locked cast, the style and the ticked references; a long scenario is
// summarized first and the plan says so; what the text cost lands in the
// spend. Plan edits refuse what would orphan a written page. Generate page
// writes one page from the plan; Generate all is all-or-nothing, idempotent,
// keeps PANEL_CONCURRENCY across pages, and queue keys carry project, chapter
// and page. A page's failure never touches another. The cover carries the
// lead's sheet as its one reference, at 2:3, and never its title.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-plan-'))
process.env.INKDESK_DATA_DIR = dir
process.env.PANEL_CONCURRENCY = '2'
process.env.IMAGE_PANEL_QUALITY = 'low'
process.env.OPENROUTER_API_KEY = 'check-only-never-sent' // fetch is stubbed below; nothing leaves this machine
process.env.LLM_FALLBACK = 'always' // every text call goes to the stubbed chat endpoint
delete process.env.ANTHROPIC_API_KEY
delete process.env.IMAGE_COVER_ASPECT
delete process.env.SIMULATE_PANEL_FAILURE

// Imported after the env is set, because the store and the queue read it at load.
const { createProject, read: readDesk, update: updateDesk, demoteStale } = await import('../lib/chapter')
const { store } = await import('../lib/store')
const { singletons } = await import('../lib/singleton')
const { saveAsset, saveImage } = await import('../lib/images')
const { attachSheet, proposeCast, setDna } = await import('../lib/cast')
const { applyPatch, assertStoryEditable } = await import('../lib/patch')
const { gates } = await import('../lib/gates')
const schemas = await import('../lib/schemas')
const { strictJsonSchema } = await import('../lib/llm')
const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod')
const { estimateChapterUsd, estimatePageUsd, chapterImages, perImage } = await import('../lib/cost')
const plan = await import('../lib/plan')
const { writePlan, startPage, startAll, queueCover, isCoverQueued } = await import('../lib/director')
const { isQueued } = await import('../lib/panels')
const { SCENARIO_WHOLE_CHARS, SAMPLE_SCENARIO, storyBrief, storyReady } = await import('../lib/story')
const { STYLE_PRESETS } = await import('../lib/styles')
const { Refused } = await import('../lib/errors')

import type { Desk, Project } from '../lib/types'

const ok = (msg: string) => console.log(`  ok  ${msg}`)
const tick = () => new Promise<void>((r) => setTimeout(r, 0))
async function until(what: string, pred: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const t0 = Date.now()
  while (!(await pred())) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// --- The stub: text answers by schema name, image requests held until released --
type ChatBody = {
  model: string
  messages: { content: string | { type: string; text?: string; image_url?: { url: string } }[] }[]
  response_format: { json_schema: { name: string; schema: unknown } }
}
type ImageBody = { prompt: string; aspect_ratio: string; quality: string; input_references?: { image_url: { url: string } }[] }

const chats: ChatBody[] = []
const chatAnswers = new Map<string, unknown[]>()
const images: { body: ImageBody; release: (outcome: 'ok' | number) => void }[] = []
const tinyPng = (await readFile('data/kernel-test/2-wide.png')).toString('base64')

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input)
  const body = JSON.parse(String(init?.body ?? '{}'))
  if (url === 'https://openrouter.ai/api/v1/chat/completions') {
    const b = body as ChatBody
    chats.push(b)
    const name = b.response_format.json_schema.name
    const answer = chatAnswers.get(name)?.shift()
    if (answer === undefined) throw new Error(`unscripted text call: ${name}`)
    return Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(answer) }, finish_reason: 'stop' }], usage: { cost: 0.01 } })
  }
  if (url === 'https://openrouter.ai/api/v1/images') {
    const held = deferred<'ok' | number>()
    images.push({ body: body as ImageBody, release: held.resolve })
    const outcome = await held.promise
    if (outcome !== 'ok') return new Response('stubbed failure', { status: outcome })
    return Response.json({ data: [{ b64_json: tinyPng, media_type: 'image/png' }], usage: { cost: 0.02 } })
  }
  throw new Error(`unexpected fetch to ${url}`)
}) as typeof fetch
const answer = (name: string, value: unknown) => chatAnswers.set(name, [...(chatAnswers.get(name) ?? []), value])
const promptOf = (b: ChatBody) => {
  const c = b.messages[0].content
  return typeof c === 'string' ? c : (c.find((p) => p.type === 'text')?.text ?? '')
}
const picturesIn = (b: ChatBody) => {
  const c = b.messages[0].content
  return typeof c === 'string' ? [] : c.filter((p) => p.type === 'image_url').map((p) => p.image_url?.url ?? '')
}

// The terminal, quietened; failures still print.
const realLog = console.log
const quiet = (...args: unknown[]) => void args
console.warn = quiet
console.error = quiet
const say = realLog
console.log = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('  ok')) say(...args)
}

const kaito = {
  name: 'Kaito Ren',
  role: 'Lead · rooftop courier',
  traits: ['restless', 'loyal', 'quick'],
  look: 'Eighteen, wiry. Messy black hair, amber eyes. Grey courier jacket, frayed red scarf.',
}
const mio = {
  name: 'Mio Asakura',
  role: 'Counterpart · night archivist',
  traits: ['wry', 'patient', 'stubborn'],
  look: 'Twenty, small and upright. Silver bob, round glasses, long dark coat with brass buttons.',
}
const KAITO_DNA = 'Kaito Ren, an 18-year-old man. Messy black hair, amber eyes, grey courier jacket, frayed red scarf.'
const MIO_DNA = 'Mio Asakura, a 20-year-old woman. Silver bob, round wire glasses, long charcoal coat with brass buttons.'
const kaitoSheet = await readFile('data/kernel-test/0-sheet.png')
const mioSheet = await readFile('data/kernel-test/1-close.png')
const COVER_TITLE = 'THE LAST DELIVERY — a title only the app letters'

const line = (characterId: string, p: number, n: number) => ({
  characterId,
  action: `Page ${p} action ${n}: something drawable.`,
  camera: 'eye level, three-quarter view',
  background: `Page ${p} background ${n}: the archive, from this angle.`,
  dialogue: `Page ${p}, line ${n}`,
})
const pageOut = (a: string, b: string, p: number) => ({ panel1: line(a, p, 1), panel2: line(b, p, 2), panel3: line(a, p, 3), panel4: line(b, p, 4) })
const planOut = (a: string, b: string, count: number) => {
  const out: Record<string, unknown> = { coverBrief: 'Kaito alone on the post tower at dawn, the city behind him.' }
  for (let p = 1; p <= count; p++) out[`page${p}`] = pageOut(a, b, p)
  return out
}

/** A project with a saved scenario, two characters locked with real sheets. */
async function lockedProject(title: string, scenarioText = SAMPLE_SCENARIO): Promise<{ pid: string; ids: [string, string] }> {
  const first = await createProject({ title, stylePresetId: 'manhwa-colour' })
  const pid = first.address.projectId
  const up = (fn: (d: Desk) => Desk) => updateDesk(pid, fn)
  await up((d) => applyPatch(d, { storyMode: 'scenario', scenario: { text: scenarioText, notes: 'Quiet, a little magical.' } }))
  await up((d) => applyPatch(d, { scenario: { saved: true } }))
  const cast = (await up((d) => proposeCast(d, kaito, mio))).cast
  for (const [c, dna, png] of [[cast[0], KAITO_DNA, kaitoSheet], [cast[1], MIO_DNA, mioSheet]] as const) {
    await up((d) => setDna(d, c.id, dna))
    await saveImage(pid, 'sheet', png.toString('base64'), 'image/png', (d, imageId) => attachSheet(d, c.id, dna, imageId))
    await up((d) => applyPatch(d, { cast: { [c.id]: { locked: true } } }))
  }
  return { pid, ids: [cast[0].id, cast[1].id] }
}

try {
  // 1. The schema: 3–6 pages, one locked character per slot, alternating. -----------------
  {
    const ids = ['char-a', 'char-b'] as const
    assert.throws(() => schemas.chapterPlanSchema(ids, 2), Refused, 'two pages is under the range')
    assert.throws(() => schemas.chapterPlanSchema(ids, 7), Refused, 'seven pages is over the range')
    assert.throws(() => schemas.chapterPlanSchema(ids, 3.5), Refused)
    const three = schemas.chapterPlanSchema(ids, 3)
    const good = planOut('char-a', 'char-b', 3)
    assert.ok(three.safeParse(good).success, 'an alternating three-page plan parses')
    const swapped = { ...good, page2: { ...pageOut('char-a', 'char-b', 2), panel2: line('char-a', 2, 2) } }
    assert.equal(three.safeParse(swapped).success, false, 'the lead in the counterpart’s slot on page 2')
    const stranger = { ...good, page3: { ...pageOut('char-a', 'char-b', 3), panel1: line('someone-else', 3, 1) } }
    assert.equal(three.safeParse(stranger).success, false, 'an unlocked id on page 3')
    const { page3: _dropped, ...short } = good
    void _dropped
    assert.equal(three.safeParse(short).success, false, 'a plan one page short')
    assert.equal(three.safeParse({ ...good, coverBrief: undefined }).success, false, 'a plan without a cover brief')
    // Both providers' grammars: Claude's SDK format, and the fallback's strict schema.
    for (const count of [3, 6]) {
      const schema = schemas.chapterPlanSchema(ids, count)
      const wire = JSON.stringify(zodOutputFormat(schema))
      assert.ok(!/"\$ref"|"\$defs"/.test(wire), `${count} pages: no shared $ref on the Claude wire`)
      const strict = strictJsonSchema(schema).schema as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean }
      assert.equal(strict.additionalProperties, false)
      assert.deepEqual(strict.required.sort(), ['coverBrief', ...Array.from({ length: count }, (_, i) => `page${i + 1}`)].sort())
      assert.ok(!JSON.stringify(strict).includes('"$ref"'), `${count} pages: no $ref in the strict schema`)
    }
    assert.ok(strictJsonSchema(schemas.ScenarioSummarySchema).schema, 'the summary schema survives strict mode')
    ok('the plan schema takes 3 to 6 pages, refuses a wrong slot or a short plan, and survives both strict grammars')
  }

  // 2. Cost before spending. ------------------------------------------------------------
  {
    const lowPanel = perImage('low').usd
    const highPanel = perImage('high').usd
    assert.equal(lowPanel, 0.02)
    for (const pages of [3, 4, 6]) {
      assert.equal(chapterImages(pages), pages * 4 + 1)
      assert.equal(estimateChapterUsd(pages, 'low'), Math.round((pages * 4 * lowPanel + lowPanel) * 1e6) / 1e6)
      assert.equal(estimateChapterUsd(pages, 'high'), Math.round((pages * 4 * highPanel + highPanel) * 1e6) / 1e6)
    }
    assert.equal(estimateChapterUsd(3, 'low'), 0.26, 'three pages and the cover at low: 13 images')
    assert.equal(estimateChapterUsd(3, 'high'), 1.17, 'and at high')
    assert.equal(estimatePageUsd('low'), 0.08)
    assert.equal(perImage('low').measured, true)
    assert.equal(perImage('high').measured, false, 'high is an estimate, labelled so')
    assert.equal(perImage('ultra').usd, highPanel, 'an unknown quality is priced as high, never as free')
    ok('the estimate is pages × 4 × the per-panel figure + the cover, at low and at high')
  }

  // 3. Scenario mode, the gates, the frozen words. -----------------------------------------
  {
    const fresh = await createProject({ title: 'Gates', stylePresetId: 'manga-bw' })
    let d: Desk = fresh
    assert.equal(gates(d).cast.open, false)
    d = applyPatch(d, { storyMode: 'scenario', scenario: { text: '  ' } })
    assert.equal(storyReady(d), false)
    assert.throws(() => assertStoryEditable(d, { scenario: { saved: true } }), /Write or paste a scenario/)
    d = applyPatch(d, { scenario: { text: 'Two people, one letter.', notes: 'quiet' } })
    assert.equal(gates(d).cast.open, false, 'an unsaved scenario keeps the Library shut')
    assert.equal(gates(d).cast.hint, 'Save the scenario first.')
    d = applyPatch(d, { scenario: { saved: true } })
    assert.equal(gates(d).cast.open, true, 'a saved scenario opens the Library exactly as an accepted synopsis does')
    assert.deepEqual(storyBrief(d), { title: 'Gates', body: 'Two people, one letter.\n\nThe storyteller’s notes: quiet' })
    assert.throws(() => assertStoryEditable(d, { scenario: { text: 'other' } }), /saved/)
    assert.equal(applyPatch(d, { scenario: { text: 'other' } }).scenario?.text, 'Two people, one letter.', 'saved words never move in the browser either')
    assert.throws(() => assertStoryEditable(d, { storyMode: 'pitch' }), /settled/)
    const long = 'x'.repeat(SCENARIO_WHOLE_CHARS + 50)
    const clipped = storyBrief({ ...d, scenario: { ...d.scenario!, text: long, notes: '' } })
    assert.ok(clipped && clipped.body.length < long.length, 'the cast prompt reads a clipped scenario')
    assert.equal(gates(d).director.open, false)
    assert.equal(gates(d).storyboard.open, false)
    ok('a saved scenario opens the Library; its words freeze at the save; the mode freezes with the story')
  }

  const { pid, ids } = await lockedProject('The Last Delivery')
  const [lead, counterpart] = ids
  const read = () => readDesk(pid)
  let desk = await read()
  assert.equal(gates(desk).director.open, true, 'both locks open the Director')
  assert.equal(gates(desk).storyboard.open, false, 'the Page station waits for a plan')
  assert.equal(gates(desk).storyboard.hint, 'Write the chapter plan in the Director first.')
  assert.equal(desk.imageCount, 2)

  // A reference on the shelf, ticked for the Director.
  const ref = await saveAsset(pid, mioSheet, 'image/png', 'Archive interior')
  await updateDesk(pid, (d) => {
    assertStoryEditable(d, { scenario: { referenceAssetIds: [ref.asset.id] } })
    return applyPatch(d, { scenario: { referenceAssetIds: [ref.asset.id] } })
  })
  assert.throws(() => assertStoryEditable(desk, { scenario: { referenceAssetIds: ['asset-nope.png'] } }), /isn’t on this project’s shelf/)

  // 4. The Director's call. ---------------------------------------------------------------
  {
    const costBefore = (await read()).costUsd
    answer('plan', planOut(lead, counterpart, 3))
    desk = await writePlan(pid, 3, false)
    const call = chats.splice(0)
    assert.equal(call.length, 1, 'one text call, no summary for a scenario this short')
    const prompt = promptOf(call[0])
    assert.match(prompt, /exactly 3 pages from the storyteller’s scenario/)
    assert.ok(prompt.includes('THE LAST DELIVERY BEFORE DAWN'), 'the scenario is sent whole')
    assert.ok(prompt.includes(KAITO_DNA) && prompt.includes(MIO_DNA), 'both locked DNAs')
    assert.ok(prompt.includes(`id ${lead}`) && prompt.includes(`id ${counterpart}`))
    assert.ok(prompt.includes(STYLE_PRESETS['manhwa-colour'].label), 'the project’s style')
    assert.ok(prompt.includes('“Archive interior”'), 'the ticked reference is named')
    assert.equal(picturesIn(call[0]).length, 1, 'and travels as a picture')
    assert.ok(picturesIn(call[0])[0].endsWith(mioSheet.toString('base64')), 'the reference’s own bytes')
    assert.equal(call[0].response_format.json_schema.name, 'plan')

    assert.ok(desk.plan, 'the plan is on the desk')
    assert.equal(desk.plan.pageCount, 3)
    assert.equal(desk.plan.pages.length, 3)
    assert.equal(desk.plan.source, 'scenario')
    assert.equal(desk.plan.summarized, false)
    assert.equal(desk.pageCount, 3, 'the chapter has three pages now')
    assert.deepEqual(desk.pages.map((p) => p.written), [false, false, false])
    assert.ok(desk.cover && desk.cover.status === 'empty' && desk.cover.versions.length === 0)
    assert.equal(desk.cover.title, 'The Last Delivery', 'the cover title starts as the project’s')
    assert.equal(desk.cover.brief, desk.plan.coverBrief)
    assert.equal(desk.imageCount, 2, 'no image was generated')
    assert.ok(Math.abs(desk.costUsd - costBefore - 0.01) < 1e-9, 'the plan’s text cost is in the spend')
    assert.equal(gates(desk).storyboard.open, true, 'a plan opens the Page station')
    await assert.rejects(writePlan(pid, 3, false), /already written/, 'written once')
    assert.throws(() => assertStoryEditable(desk, { scenario: { referenceAssetIds: [] } }), /plan is written/)
    ok('the Director plans from the scenario, the locked cast, the style and the ticked reference — no image spent')
  }

  // 5. Editing the plan, before any page is written. ---------------------------------------
  {
    const edit = { pages: { '0': { '0': { action: 'Kaito lands on the gravel, envelope raised.' } } }, coverBrief: 'Kaito on the tower, dawn behind.' }
    plan.assertPlanEdit(desk, edit)
    desk = await updateDesk(pid, (d) => applyPatch(d, { plan: edit }))
    assert.equal(desk.plan?.pages[0].panels[0].action, 'Kaito lands on the gravel, envelope raised.')
    assert.equal(desk.plan?.pages[0].panels[0].characterId, lead, 'the slot’s character is not editable')
    assert.equal(desk.cover?.brief, 'Kaito on the tower, dawn behind.', 'the cover brief follows the plan’s')
    desk = await updateDesk(pid, (d) => applyPatch(d, { plan: { pageCount: 5 } }))
    assert.equal(desk.pageCount, 5)
    assert.deepEqual(desk.plan?.pages[4].panels.map((l) => l.characterId), [lead, counterpart, lead, counterpart], 'an added page keeps the alternation')
    assert.equal(desk.plan?.pages[4].panels[0].action, '', 'an added page is blank for the storyteller')
    assert.match(plan.assertPageDrawable(desk.plan!.pages[4], 4) ?? '', /Page 5, panel 1 needs an action/)
    assert.throws(() => plan.assertPlanEdit(desk, { pageCount: 2 }), /3 to 6/)
    assert.throws(() => plan.assertPlanEdit(desk, { pages: { '5': { '0': { action: 'x' } } } }), /no page 6/)
    desk = await updateDesk(pid, (d) => applyPatch(d, { plan: { pageCount: 3 } }))
    assert.equal(desk.pageCount, 3)
    const project = await store.readProject(pid)
    assert.equal(project.chapters[0].pages.length, 3, 'the stored chapter follows the plan’s length')
    ok('plan lines and the cover brief edit in place; the page count adds blank pages and drops unwritten ones')
  }

  // 6. Generate page: page 2 from the plan, its panels queued; keys carry project, chapter and page.
  const chapterId = desk.address.chapterId
  const at = (n: number) => ({ projectId: pid, chapterId, pageIndex: n })
  {
    const queued = await startPage(at(1))
    assert.deepEqual(queued, [0, 1, 2, 3])
    await tick()
    assert.deepEqual(
      singletons.queue.running().sort(),
      [`${pid}:${chapterId}:1:0`, `${pid}:${chapterId}:1:1`].sort(),
      'two at a time, keyed project : chapter : page : panel'
    )
    const page2 = await readDesk(pid, { chapterId, pageIndex: 1 })
    assert.deepEqual(
      page2.script?.map((p) => [p.characterId, p.action]),
      desk.plan!.pages[1].panels.map((l) => [l.characterId, l.action]),
      'the page’s panels are the plan’s lines'
    )
    assert.deepEqual(await startPage(at(1)), [], 'Generate page again queues nothing')
    const lines = (d: Desk) => d.script?.map((p) => [p.characterId, p.action, p.camera, p.background, p.dialogue])
    assert.deepEqual(lines(await readDesk(pid, { chapterId, pageIndex: 1 })), lines(page2), 'and rewrites nothing')
    desk = await read()
    assert.deepEqual(desk.pages.map((p) => p.written), [false, true, false])
    assert.throws(() => plan.assertPlanEdit(desk, { pages: { '1': { '0': { action: 'x' } } } }), /already on the board/)
    assert.equal(
      applyPatch(desk, { plan: { pages: { '1': { '0': { action: 'x' } } } } }).plan?.pages[1].panels[0].action,
      desk.plan?.pages[1].panels[0].action,
      'the browser ignores a written page’s line edit rather than throwing'
    )
    await assert.rejects(writePlan(pid, 3, true), /already being inked/, 'no replan once a page is written')
    // Page 1's panel 1 and page 2's panel 1 never dedupe against each other.
    assert.equal(isQueued(at(1), 0), true)
    assert.equal(isQueued(at(0), 0), false)
    ok('Generate page writes one page from the plan and queues it; again is a no-op; keys carry the page')
  }

  // 7. Generate all: all or nothing, idempotent, two at a time across pages. -------------------
  {
    // A blank line refuses the whole thing before page 1 or 3 is touched.
    await updateDesk(pid, (d) => applyPatch(d, { plan: { pages: { '2': { '3': { dialogue: '   ' } } } } }))
    await assert.rejects(startAll(pid), /Page 3, panel 4 needs a line of dialogue/)
    assert.deepEqual((await read()).pages.map((p) => p.written), [false, true, false], 'nothing was written')
    await updateDesk(pid, (d) => applyPatch(d, { plan: { pages: { '2': { '3': { dialogue: 'See you Thursday.' } } } } }))

    const { written, queued } = await startAll(pid)
    assert.deepEqual(written, [0, 2], 'the two unwritten pages, in order')
    assert.deepEqual(queued, ['p1·1', 'p1·2', 'p1·3', 'p1·4', 'p3·1', 'p3·2', 'p3·3', 'p3·4'], 'page 2’s panels were already queued')
    const again = await startAll(pid)
    assert.deepEqual(again, { written: [], queued: [] }, 'Generate all is idempotent')
    assert.deepEqual(
      singletons.queue.waiting().slice(-8),
      [0, 2].flatMap((p) => [0, 1, 2, 3].map((i) => `${pid}:${chapterId}:${p}:${i}`)),
      'waiting in page order behind page 2'
    )

    // Release in a mixed order; never more than two inking anywhere; one panel on page 1 fails.
    let maxInking = 0
    const inkingNow = async () => {
      const p = await store.readProject(pid)
      return p.chapters[0].pages.flatMap((pg) => pg.panels).filter((x) => x.status === 'inking').length
    }
    let released = 0
    while (released < 12) {
      await until('an image request', () => images.length > 0)
      maxInking = Math.max(maxInking, await inkingNow(), singletons.queue.running().length)
      const next = images.shift()!
      // The fifth request is page 1's first panel: it fails with a 500.
      next.release(released === 4 ? 500 : 'ok')
      released++
      await tick()
    }
    await until('the queue to drain', () => singletons.queue.running().length === 0 && singletons.queue.waiting().length === 0)
    assert.ok(maxInking <= 2, `never more than PANEL_CONCURRENCY inking (saw ${maxInking})`)

    desk = await read()
    const p = await store.readProject(pid)
    const statuses = p.chapters[0].pages.map((pg) => pg.panels.map((x) => x.status))
    assert.deepEqual(statuses[1], ['done', 'done', 'done', 'done'], 'page 2 inked whole')
    assert.equal(statuses[0].filter((s) => s === 'failed').length, 1, 'one panel on page 1 failed')
    assert.equal(statuses[0].filter((s) => s === 'done').length, 3)
    assert.deepEqual(statuses[2], ['done', 'done', 'done', 'done'], 'page 1’s failure never touched page 3')
    assert.equal(p.usage.images, 2 + 11, 'eleven panels landed, each counted once')
    assert.deepEqual(desk.pages.map((x) => [x.written, x.inked, x.failed]), [[true, 3, 1], [true, 4, 0], [true, 4, 0]])
    assert.equal(plan.pagesComplete(desk), 2, 'two of three pages complete')
    ok('Generate all writes every page in one go, queues in page order, keeps two at a time, isolates a failure')
  }

  // 8. The cover: the lead's sheet, 2:3, the brief — never the title. ---------------------------
  {
    desk = await updateDesk(pid, (d) => applyPatch(d, { cover: { title: COVER_TITLE } }))
    assert.equal(desk.cover?.title, COVER_TITLE)
    assert.equal(queueCover(pid, chapterId), true)
    assert.equal(queueCover(pid, chapterId), false, 'the cover is never queued twice')
    assert.equal(isCoverQueued(pid, chapterId), true)
    assert.ok(singletons.queue.has(`${pid}:${chapterId}:cover`), 'keyed project : chapter : cover')
    await until('the cover request', () => images.length > 0)
    const req = images[0].body
    assert.equal((await read()).cover?.status, 'inking')
    assert.equal(req.aspect_ratio, '2:3', 'a portrait cover')
    assert.equal(req.quality, 'low', 'at the panel quality')
    assert.equal(req.input_references?.length, 1, 'exactly one reference')
    assert.ok(req.input_references?.[0].image_url.url.endsWith(kaitoSheet.toString('base64')), 'the lead’s locked sheet')
    assert.ok(req.prompt.includes(KAITO_DNA), 'the lead’s DNA verbatim')
    assert.ok(!req.prompt.includes(MIO_DNA), 'the counterpart is not on the cover')
    assert.ok(req.prompt.includes('Kaito on the tower, dawn behind.'), 'the brief')
    assert.ok(req.prompt.includes(STYLE_PRESETS['manhwa-colour'].rules), 'the project’s frozen rules')
    assert.ok(!req.prompt.includes(COVER_TITLE) && !req.prompt.includes('The Last Delivery'), 'the title never reaches the image prompt')
    images.shift()!.release('ok')
    await until('the cover to land', async () => (await read()).cover?.status === 'done')
    desk = await read()
    assert.equal(desk.cover?.versions.length, 1)
    assert.equal(plan.currentCoverImageId(desk.cover), desk.cover?.versions[0].imageId)
    assert.ok(desk.cover?.versions[0].imageId.startsWith('cover-'))
    const summary = (await store.listProjects()).find((s) => s.id === pid)
    assert.equal(summary?.thumbnailImageId, desk.cover?.versions[0].imageId, 'the dashboard card shows the cover')

    // Redraw that fails: recorded as failed, the art and the title kept.
    queueCover(pid, chapterId)
    await until('the redraw request', () => images.length > 0)
    images.shift()!.release(400)
    await until('the redraw to fail', async () => (await read()).cover?.status === 'failed')
    desk = await read()
    assert.equal(desk.cover?.versions.length, 1, 'a failed redraw keeps the art')
    assert.equal(desk.cover?.title, COVER_TITLE, 'and the title')
    ok('the cover draws the lead against their sheet at 2:3 from the brief; the title stays the app’s')
  }

  // 9. The floor, chapter-wide: stale inking on any page, and on the cover, is demoted. ------------
  {
    const p: Project = await store.readProject(pid)
    const stale: Project = {
      ...p,
      chapters: p.chapters.map((c) => ({
        ...c,
        pages: c.pages.map((pg) =>
          pg.index === 2 ? { ...pg, panels: pg.panels.map((x) => (x.index === 1 ? { ...x, status: 'inking' as const, startedAt: new Date().toISOString(), startedByRun: 'a-dead-run' } : x)) } : pg
        ),
        cover: c.cover && { ...c.cover, status: 'inking' as const, startedAt: new Date().toISOString(), startedByRun: 'a-dead-run' },
      })),
    }
    const { project: fixed, demoted } = demoteStale(stale, singletons.serverRunId, 360000)
    assert.deepEqual(demoted, ['p3 panel 2', 'cover'])
    assert.equal(fixed.chapters[0].pages[2].panels[1].status, 'failed')
    assert.equal(fixed.chapters[0].cover?.status, 'failed')
    assert.equal(demoteStale(p, singletons.serverRunId, 360000).demoted.length, 0, 'live work is left alone')
    ok('stale inking anywhere in the chapter — any page, or the cover — is demoted to failed')
  }

  // 10. The summarize-first path, and a migrated page that predates the Director. --------------------
  {
    const longText = `${SAMPLE_SCENARIO}\n\n${'The rooftops go on and on. '.repeat(500)}`
    assert.ok(longText.length > SCENARIO_WHOLE_CHARS)
    const second = await lockedProject('A Long One', longText)
    answer('summary', { summary: '1. Kaito finds the letter. 2. Mio reads the seal. 3. The dawn.' })
    answer('plan', planOut(second.ids[0], second.ids[1], 4))
    const planned = await writePlan(second.pid, 4, false)
    const [sum, planCall] = chats.splice(0)
    assert.equal(sum.response_format.json_schema.name, 'summary', 'the summary first')
    assert.ok(promptOf(sum).includes('The rooftops go on and on.'), 'it reads the whole scenario')
    assert.match(promptOf(planCall), /a summary of the storyteller’s scenario/, 'the plan prompt says it plans from a summary')
    assert.ok(promptOf(planCall).includes('1. Kaito finds the letter.'))
    assert.ok(!promptOf(planCall).includes('The rooftops go on and on. The rooftops go on and on. The rooftops go on and on.'))
    assert.equal(planned.plan?.summarized, true, 'and the plan records it, for the plain sentence on screen')
    assert.equal(planned.plan?.pageCount, 4)
    assert.ok(Math.abs(planned.costUsd - 0.02) < 1e-9, 'both text calls are in the spend')

    // A page written before the Director (a migrated v1 desk): no plan over it.
    const legacy = await lockedProject('Legacy')
    await updateDesk(legacy.pid, (d) => ({
      ...d,
      script: [0, 1, 2, 3].map((i) => ({
        index: i as 0 | 1 | 2 | 3,
        characterId: legacy.ids[i % 2],
        action: 'a',
        camera: 'c',
        background: 'b',
        dialogue: 'd',
        versions: [],
        currentVersion: 0,
        status: 'empty' as const,
        startedAt: null,
        startedByRun: null,
      })),
    }))
    await assert.rejects(writePlan(legacy.pid, 3, false), /scripted before the Director/)
    assert.equal(gates(await readDesk(legacy.pid)).storyboard.open, true, 'its page stays open without a plan')
    assert.equal(chats.length, 0, 'a refused plan costs nothing')
    ok('a long scenario is summarized first and the plan says so; a page that predates the Director keeps its own path')
  }

  say('\n  Director acceptance check passed.\n')
} finally {
  globalThis.fetch = realFetch
  await rm(dir, { recursive: true, force: true })
}

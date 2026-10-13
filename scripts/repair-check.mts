// Slice 6's rules from `devpost/checklist.md > Slices > 6`, run against a
// scratch folder with the provider stubbed:
//
//   npm run check:repair
//
// A redraw grows the version history, newest last, capped at three with the
// oldest dropped. The bubble and dialogue live on the panel, not the version:
// no redraw, version step, failure or rewrite ever touches them. One silent
// retry on a 429 or a timeout — exactly one — and never on a 402. A failed
// redraw keeps the previous version on screen and the reader open. A panel
// still `inking` after a server restart or past the generation timeout is
// stale and demoted to failed. Nothing leaves this machine: `fetch` is a
// scripted stub.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-repair-'))
process.env.INKDESK_DATA_DIR = dir
process.env.PANEL_CONCURRENCY = '2'
process.env.IMAGE_PANEL_QUALITY = 'low'
process.env.GENERATION_TIMEOUT_MS = '360000'
process.env.OPENROUTER_API_KEY = 'check-only-never-sent' // fetch is stubbed below

// Imported after the env is set, because the store reads it at load.
const { update, read } = await import('../lib/chapter')
const { saveImage } = await import('../lib/images')
const { proposeCast, setDna, attachSheet } = await import('../lib/cast')
const { applyPatch } = await import('../lib/patch')
const { gates } = await import('../lib/gates')
const { ChapterPatchSchema, PanelRewriteSchema } = await import('../lib/schemas')
const { PANEL_LAYOUT, rewritePanelPrompt } = await import('../lib/prompts')
const {
  applyRewrite,
  currentImageId,
  lockedPair,
  markInking,
  MAX_PANEL_VERSIONS,
  newScript,
  staleInkingIndices,
} = await import('../lib/script')
const { inkPanel } = await import('../lib/panels')
const { Refused } = await import('../lib/errors')

import type { Chapter, Panel } from '../lib/types'

// --- The stub provider: a script of responses, consumed one per fetch -----
type Scripted = { status: number; body?: string } | { timeout: true }
const scripted: Scripted[] = []
let fetches = 0
globalThis.fetch = (async () => {
  fetches++
  const next = scripted.shift()
  if (!next) throw new Error(`unscripted fetch #${fetches}`)
  if ('timeout' in next) {
    const err = new Error('The operation was aborted due to timeout')
    err.name = 'TimeoutError'
    throw err
  }
  if (next.status === 200) {
    return Response.json({
      data: [{ b64_json: Buffer.from(`art-${fetches}`).toString('base64'), media_type: 'image/png' }],
      usage: { cost: 0.001 },
    })
  }
  return new Response(next.body ?? 'nope', { status: next.status })
}) as typeof fetch
const fetchesUsed = (() => {
  let last = 0
  return () => {
    const used = fetches - last
    last = fetches
    return used
  }
})()

const panel0 = async (): Promise<Panel> => (await read()).script![0]

try {
  // --- Seed: synopsis, two locked characters with sheets, the script -------
  const synopsis = { title: 'Letters', body: 'Kaito meets Mio on a rooftop.', accepted: true }
  const kaito = { name: 'Kaito Ren', role: 'Lead', traits: ['restless'], look: 'Wiry, scarf.' }
  const mio = { name: 'Mio Asakura', role: 'Counterpart', traits: ['wry'], look: 'Silver bob, glasses.' }
  await update((c) => proposeCast({ ...c, synopsis }, kaito, mio))
  for (const id of (await read()).cast.map((c) => c.id)) {
    await update((c) => setDna(c, id, `dna for ${id}`))
    await saveImage('sheet', Buffer.from(`sheet-${id}`).toString('base64'), 'image/png', (c, imageId) =>
      attachSheet(c, id, `dna for ${id}`, imageId)
    )
  }
  await update((c) => ({ ...c, cast: c.cast.map((x) => ({ ...x, locked: true })) }))
  const pair = lockedPair(await read())
  const line = (i: number, who: string) => ({
    characterId: who,
    action: `Beat ${i + 1} of the page`,
    camera: 'eye level',
    background: 'the rooftop',
    dialogue: `Line ${i + 1}`,
  })
  await update((c) =>
    newScript(c, {
      panel1: line(0, pair[0].id),
      panel2: line(1, pair[1].id),
      panel3: line(2, pair[0].id),
      panel4: line(3, pair[1].id),
    })
  )

  // Ink all four, then the reader is open and every panel has one version.
  for (const i of [0, 1, 2, 3]) {
    scripted.push({ status: 200 })
    await inkPanel(i)
  }
  assert.equal(fetchesUsed(), 4)
  let chapter = await read()
  assert.ok(gates(chapter).reader.open, 'all four inked — the reader is open')

  // The user letters panel 1: their line, their bubble.
  const placed = { x: 8, y: 60, w: 30, h: 22, tailX: 45, tailY: 40 }
  await update((c) => applyPatch(c, ChapterPatchSchema.parse({ panels: { '0': { dialogue: 'MINE NOW.', bubble: placed } } })))
  console.log('  ok  seeded: four inked panels, a lettered bubble on panel 1')

  // --- Redraw: versions grow, capped at three; lettering never moves -------
  const v1 = currentImageId(await panel0())!
  scripted.push({ status: 200 })
  await inkPanel(0)
  assert.equal(fetchesUsed(), 1, 'a redraw is one request')
  let p = await panel0()
  assert.equal(p.versions.length, 2, 'a redraw adds a version')
  assert.equal(p.currentVersion, 1, 'the newest is the one on the page')
  assert.equal(p.versions[0].imageId, v1, 'the first version is still there')
  assert.equal(p.dialogue, 'MINE NOW.', 'redraw never touches the dialogue')
  assert.deepEqual(p.bubble, placed, 'redraw never touches the bubble')

  scripted.push({ status: 200 })
  await inkPanel(0)
  scripted.push({ status: 200 })
  await inkPanel(0)
  assert.equal(fetchesUsed(), 2, 'two more redraws, two more requests')
  p = await panel0()
  assert.equal(p.versions.length, MAX_PANEL_VERSIONS, 'a fourth redraw holds the count at three')
  assert.ok(!p.versions.some((v) => v.imageId === v1), 'the oldest was dropped')
  assert.equal(p.currentVersion, 2, 'still pointing at the newest')
  assert.deepEqual(p.bubble, placed, 'four versions later, the bubble has not moved')

  // The stepper: a version patch moves the displayed version, clamped.
  await update((c) => applyPatch(c, ChapterPatchSchema.parse({ panels: { '0': { version: 0 } } })))
  p = await panel0()
  assert.equal(p.currentVersion, 0, 'stepping back displays the older version')
  const shown = currentImageId(p)
  await update((c) => applyPatch(c, { panels: { '0': { version: 99 } } }))
  assert.equal((await panel0()).currentVersion, 2, 'an out-of-range step clamps to the newest')
  assert.ok(shown, 'the stepped-to version has art')
  console.log('  ok  versions cap at three, oldest dropped; the stepper clamps; lettering untouched')

  // --- A failed redraw keeps the previous version on screen ----------------
  await update((c) => applyPatch(c, { panels: { '0': { version: 2 } } }))
  const before = currentImageId(await panel0())!
  scripted.push({ status: 500, body: 'upstream exploded' })
  await inkPanel(0)
  p = await panel0()
  assert.equal(fetchesUsed(), 1, 'a 5xx does not retry')
  assert.equal(p.status, 'failed', 'recorded honestly')
  assert.equal(p.versions.length, 3, 'no version was lost')
  assert.equal(currentImageId(p), before, 'the previous art is still the one displayed')
  assert.ok(gates(await read()).reader.open, 'the reader stays open through a failed redraw')
  assert.deepEqual(p.bubble, placed, 'the failure never touches the bubble')

  // Try again is the same request again; it lands as a new version.
  scripted.push({ status: 200 })
  await inkPanel(0)
  assert.equal(fetchesUsed(), 1, 'Try again is one request')
  p = await panel0()
  assert.equal(p.status, 'done')
  assert.equal(p.versions.length, 3, 'the new version replaced the oldest, count still three')
  console.log('  ok  a failed redraw keeps the previous version and the reader open; Try again lands')

  // --- The silent retry: once, on exactly 429 or timeout -------------------
  scripted.push({ status: 429, body: 'slow down' }, { status: 200 })
  await inkPanel(0)
  assert.equal(fetchesUsed(), 2, 'a 429 retries exactly once')
  assert.equal((await panel0()).status, 'done', 'and the retry landed')

  scripted.push({ timeout: true }, { status: 200 })
  await inkPanel(0)
  assert.equal(fetchesUsed(), 2, 'a timeout retries exactly once')
  assert.equal((await panel0()).status, 'done')

  scripted.push({ status: 429, body: 'still busy' }, { status: 429, body: 'still busy' })
  await inkPanel(0)
  assert.equal(fetchesUsed(), 2, 'two 429s: one retry, then it stops')
  assert.equal((await panel0()).status, 'failed', 'and fails honestly')

  scripted.push({ status: 402, body: 'insufficient credits' })
  await inkPanel(0)
  assert.equal(fetchesUsed(), 1, 'a 402 never retries — it will not pass on its own')
  assert.equal((await panel0()).status, 'failed')

  scripted.push({ status: 400, body: 'rejected by the moderation system' })
  await inkPanel(0)
  assert.equal(fetchesUsed(), 1, 'a refusal never retries — it is a wording problem')
  assert.equal((await panel0()).status, 'refused')
  assert.deepEqual((await panel0()).bubble, placed, 'five failures later, the bubble still has not moved')
  console.log('  ok  one silent retry on 429/timeout; never on 402 or a refusal')

  // --- Rewrite: only the visuals change -----------------------------------
  p = await panel0()
  const rewritten = applyRewrite(await read(), 0, {
    action: ' A calmer beat. ',
    camera: 'eye level, steady',
    background: 'the same rooftop at dusk',
  }).script![0]
  assert.equal(rewritten.action, 'A calmer beat.', 'action replaced and trimmed')
  assert.equal(rewritten.dialogue, p.dialogue, 'rewrite never touches the dialogue')
  assert.deepEqual(rewritten.bubble, p.bubble, 'rewrite never touches the bubble')
  assert.deepEqual(rewritten.versions, p.versions, 'rewrite never touches the art history')
  assert.equal(rewritten.status, p.status, 'rewrite alone does not change the status — the redraw does')
  // The schema has no dialogue to return, and the prompt pins the rest.
  const parsed = PanelRewriteSchema.parse({ action: 'a', camera: 'b', background: 'c', dialogue: 'smuggled' })
  assert.deepEqual(Object.keys(parsed).sort(), ['action', 'background', 'camera'], 'no dialogue by shape')
  const prompt = rewritePanelPrompt(p, PANEL_LAYOUT[0], { name: 'Kaito Ren', role: 'Lead' })
  assert.ok(prompt.includes(p.dialogue), 'the fixed line is context')
  assert.ok(prompt.includes(PANEL_LAYOUT[0].shot), 'the shot size is pinned')
  console.log('  ok  rewrite replaces action/camera/background and nothing else')

  // --- The floor: stale inking is demoted on read --------------------------
  chapter = await read()
  const asInking = (c: Chapter, startedAt: string, run: string): Chapter => ({
    ...c,
    script: c.script!.map((x, i) => (i === 0 ? { ...x, status: 'inking' as const, startedAt, startedByRun: run } : x)),
  })
  const timeout = 360000
  const fresh = asInking(chapter, new Date().toISOString(), 'this-run')
  assert.deepEqual(staleInkingIndices(fresh, 'this-run', timeout), [], 'a live generation is left alone')
  const orphaned = asInking(chapter, new Date().toISOString(), 'a-previous-run')
  assert.deepEqual(staleInkingIndices(orphaned, 'this-run', timeout), [0], 'a restart orphan is stale')
  const late = asInking(chapter, new Date(Date.now() - timeout - 1000).toISOString(), 'this-run')
  assert.deepEqual(staleInkingIndices(late, 'this-run', timeout), [0], 'past the timeout is stale')
  console.log('  ok  stale inking — restart orphan or past the timeout — is demoted; live work is not')

  // A panel already inking refuses a second start.
  assert.throws(() => markInking(fresh, 0, 'this-run'), Refused)

  console.log('\n  Repair acceptance check passed.')
} finally {
  await rm(dir, { recursive: true, force: true })
}

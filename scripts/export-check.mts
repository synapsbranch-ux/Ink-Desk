// Slice 7's rules from `devpost/checklist.md > Slices > 7`, with no browser
// and no provider in the loop:
//
//   npm run check:export
//
// The export: `drawPage` runs against a recording context, so the check
// asserts what the PNG will contain — a page of the right size, four panels
// of art contained in their slots (each the *displayed* version), and four
// bubbles with their tails and Comic Neue lettering at exactly the stored or
// derived percentages the screen shows. RTL swaps where the middle squares
// sit and nothing else. And the slice's server rules: the reader's gate, the
// story frozen on the patch path too, and the confirmed clear — both the
// blank desk and the desk that wakes with a new story accepted.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'inkdesk-export-'))
process.env.INKDESK_DATA_DIR = dir

// Imported after the env is set, because the store reads it at load.
const { bubbleLayout, defaultBubble, tailPath } = await import('../lib/bubble')
const { createProject, read: readDesk, update: updateDesk } = await import('../lib/chapter')
const { Refused } = await import('../lib/errors')
const { EXPORT_WIDTH, INK, drawPage, exportFilename, pageGeometry, stretchPath, wrapDialogue } = await import(
  '../lib/export'
)
const { gates } = await import('../lib/gates')
const { assertStoryEditable } = await import('../lib/patch')
const { currentImageId } = await import('../lib/script')
const { emptyChapter } = await import('../lib/types')
const { singletons } = await import('../lib/singleton')

import type { DrawContext, ExportPanel, PageGeometry, Rect } from '../lib/export'
import type { Chapter, Panel } from '../lib/types'

// One project on the scratch desk (v2); the "new project" checks make more.
const pid = (await createProject({ title: 'Export check', stylePresetId: 'manga-bw' })).address.projectId
const read = () => readDesk(pid)
const update = (fn: (c: Chapter) => Chapter) => updateDesk(pid, fn)

let failed = false
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(
      () => console.log(`ok   ${name}`),
      (err: unknown) => {
        failed = true
        console.error(`FAIL ${name}`)
        console.error(err instanceof Error ? `     ${err.message}` : err)
      }
    )
}

const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps
const inside = (r: Rect, outer: Rect, slack = 0) =>
  r.x >= outer.x - slack && r.y >= outer.y - slack && r.x + r.w <= outer.x + outer.w + slack && r.y + r.h <= outer.y + outer.h + slack

// --- The page geometry ------------------------------------------------------

await check('geometry: a 3:2 / 1:1 / 1:1 / 3:2 page of the right size', () => {
  const g = pageGeometry(EXPORT_WIDTH, false)
  assert.equal(g.width, EXPORT_WIDTH)
  const [p1, p2, p3, p4] = g.panels
  // The slots keep the generated ratios — nothing is ever cropped through a face.
  assert.ok(near(p1.w / p1.h, 1.5), `wide top is 3:2, got ${p1.w / p1.h}`)
  assert.ok(near(p4.w / p4.h, 1.5), 'wide bottom is 3:2')
  assert.ok(near(p2.w / p2.h, 1) && near(p3.w / p3.h, 1), 'middle panels are square')
  assert.ok(near(p2.w, p3.w) && near(p2.y, p3.y), 'the squares match and share a row')
  // Equal gutters all round, and the page closes exactly below the last panel.
  assert.ok(near(p1.x, g.padding) && near(p1.y, g.padding))
  assert.ok(near(p2.y, p1.y + p1.h + g.gap), 'gutter between rows 1 and 2')
  assert.ok(near(p4.y, p2.y + p2.h + g.gap), 'gutter between rows 2 and 3')
  assert.ok(near(p3.x, p2.x + p2.w + g.gap), 'gutter between the squares')
  assert.ok(near(g.height, p4.y + p4.h + g.padding), 'height closes the page')
  const page = { x: 0, y: 0, w: g.width, h: g.height }
  for (const p of g.panels) assert.ok(inside(p, page), 'every panel inside the page')
})

await check('geometry: RTL swaps where the squares sit, story order untouched', () => {
  const ltr = pageGeometry(EXPORT_WIDTH, false)
  const rtl = pageGeometry(EXPORT_WIDTH, true)
  assert.deepEqual(rtl.panels[0], ltr.panels[0])
  assert.deepEqual(rtl.panels[3], ltr.panels[3])
  assert.deepEqual(rtl.panels[1], ltr.panels[2], 'panel 2 reads first from the right')
  assert.deepEqual(rtl.panels[2], ltr.panels[1])
  assert.equal(rtl.height, ltr.height)
})

// --- The compositing, against a recording context ---------------------------

type Op =
  | { op: 'fillRect'; x: number; y: number; w: number; h: number; style: string }
  | { op: 'strokeRect'; x: number; y: number; w: number; h: number; width: number; style: string }
  | { op: 'drawImage'; source: unknown; x: number; y: number; w: number; h: number }
  | { op: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { op: 'fillPath' | 'strokePath'; d: string }
  | { op: 'fillText'; text: string; x: number; y: number; font: string }

function recordingContext() {
  const ops: Op[] = []
  const fontSize = () => Number(/(\d+)px/.exec(state.font)?.[1] ?? 16)
  const state = { fillStyle: '', strokeStyle: '', lineWidth: 0, lineJoin: 'miter', font: '', textAlign: '', textBaseline: '' }
  const ctx = {
    ...state,
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    fillRect(x: number, y: number, w: number, h: number) {
      ops.push({ op: 'fillRect', x, y, w, h, style: String(this.fillStyle) })
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      ops.push({ op: 'strokeRect', x, y, w, h, width: this.lineWidth, style: String(this.strokeStyle) })
    },
    drawImage(source: unknown, x: number, y: number, w: number, h: number) {
      ops.push({ op: 'drawImage', source, x, y, w, h })
    },
    ellipse(cx: number, cy: number, rx: number, ry: number) {
      ops.push({ op: 'ellipse', cx, cy, rx, ry })
    },
    fill(path?: { d?: string }) {
      if (path?.d) ops.push({ op: 'fillPath', d: path.d })
    },
    stroke(path?: { d?: string }) {
      if (path?.d) ops.push({ op: 'strokePath', d: path.d })
    },
    fillText(text: string, x: number, y: number) {
      ops.push({ op: 'fillText', text, x, y, font: this.font })
    },
    // Deterministic width: half an em per character, like a chunky letter face.
    measureText(text: string) {
      return { width: text.length * fontSize() * 0.5 } as TextMetrics
    },
  }
  return { ctx: ctx as unknown as DrawContext, ops }
}

/** A finished panel, hand-built — the shapes `check:repair` proved. */
function panelFor(index: 0 | 1 | 2 | 3, over?: Partial<Panel>): Panel {
  return {
    index,
    characterId: index % 2 === 0 ? 'kaito' : 'mio',
    action: 'stands',
    camera: 'eye level',
    background: 'rooftop',
    dialogue: `Panel ${index + 1} says something worth lettering.`,
    versions: [{ imageId: `img-${index}-v1.png`, createdAt: '2026-10-12T00:00:00.000Z' }],
    currentVersion: 0,
    status: 'done',
    startedAt: null,
    startedByRun: null,
    ...over,
  }
}

const geom: PageGeometry = pageGeometry(EXPORT_WIDTH, false)
const placed = { x: 62, y: 5, w: 34, h: 30, tailX: 51.8, tailY: 26.1 }
const sources = [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }] as unknown as CanvasImageSource[]
const panels: Panel[] = [
  panelFor(0, { bubble: placed }),
  panelFor(1),
  panelFor(2, {
    versions: [
      { imageId: 'img-2-v1.png', createdAt: '2026-10-12T00:00:00.000Z' },
      { imageId: 'img-2-v2.png', createdAt: '2026-10-12T01:00:00.000Z' },
    ],
    currentVersion: 0, // stepped back: the display, and so the export, shows v1
    status: 'failed', // a failed redraw never hides the art that exists
  }),
  panelFor(3),
]
const inputs: ExportPanel[] = panels.map((panel, i) => ({
  panel,
  image: { width: panel.index === 1 ? 1024 : 1536, height: 1024, source: sources[i] },
}))
const { ctx, ops } = recordingContext()
drawPage(ctx, geom, inputs, { makePath: (d) => ({ d }) as unknown as Path2D, fontFamily: '__Comic_Neue_check' })

await check('export: the paper and its ink frame cover the whole canvas', () => {
  const first = ops[0]
  assert.ok(first.op === 'fillRect' && first.x === 0 && first.y === 0 && first.w === geom.width && first.h === geom.height)
  assert.equal(first.style, '#ffffff')
  const frame = ops.find((o) => o.op === 'strokeRect' && near(o.width, geom.frame))
  assert.ok(frame && frame.op === 'strokeRect' && frame.style === INK, 'the page frame is stroked in ink')
})

await check('export: four panels of art, contained in their slots, displayed version only', () => {
  const draws = ops.filter((o) => o.op === 'drawImage')
  assert.equal(draws.length, 4)
  draws.forEach((d, i) => {
    assert.equal(d.source, sources[i], `panel ${i + 1} draws its own displayed version`)
    const slot = geom.panels[i]
    assert.ok(inside(d, slot, 0.01), `panel ${i + 1} art inside its slot`)
    const img = inputs[i].image
    assert.ok(near(d.w / d.h, img.width / img.height, 0.001), `panel ${i + 1} keeps the image ratio — never cropped`)
    assert.ok(near(d.w, slot.w) || near(d.h, slot.h), `panel ${i + 1} fills its slot in one dimension`)
    assert.ok(near(d.x - slot.x, slot.x + slot.w - (d.x + d.w)) && near(d.y - slot.y, slot.y + slot.h - (d.y + d.h)), 'centred')
  })
  // The displayed version is versions[currentVersion], not the newest.
  assert.equal(currentImageId(panels[2]), 'img-2-v1.png')
})

await check('export: every bubble at its stored or derived percentages, tail and all', () => {
  const ellipses = ops.filter((o) => o.op === 'ellipse')
  assert.equal(ellipses.length, 4)
  panels.forEach((panel, i) => {
    const slot = geom.panels[panel.index]
    const l = bubbleLayout(panel)
    const e = ellipses[i]
    assert.ok(near(e.cx, slot.x + ((l.x + l.w / 2) / 100) * slot.w), `panel ${i + 1} bubble centre x`)
    assert.ok(near(e.cy, slot.y + ((l.y + l.h / 2) / 100) * slot.h), `panel ${i + 1} bubble centre y`)
    assert.ok(near(e.rx, ((l.w / 2) / 100) * slot.w) && near(e.ry, ((l.h / 2) / 100) * slot.h), 'bubble radii')
    const d = stretchPath(tailPath(l), slot)
    assert.ok(ops.some((o) => o.op === 'fillPath' && o.d === d), `panel ${i + 1} tail filled`)
    assert.ok(ops.some((o) => o.op === 'strokePath' && o.d === d), `panel ${i + 1} tail stroked`)
    assert.match(d, /^M [\d.-]+ [\d.-]+ Q [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ Q/)
  })
  // Panel 1's bubble is the learner's placed layout, verbatim after the clamp.
  const first = ellipses[0]
  const slot = geom.panels[0]
  assert.ok(near(first.cx, slot.x + ((placed.x + placed.w / 2) / 100) * slot.w), 'placed bubble honoured')
  // Panel 2's is the derived default the screen also shows.
  assert.deepEqual(bubbleLayout(panels[1]), defaultBubble(panels[1]))
})

await check('export: the lettering is the dialogue, uppercased, in Comic Neue 700', () => {
  const texts = ops.filter((o) => o.op === 'fillText')
  assert.ok(texts.length >= 4, 'every bubble lettered')
  for (const t of texts) {
    assert.match(t.font, /^700 \d+px __Comic_Neue_check$/)
    assert.equal(t.text, t.text.toUpperCase())
  }
  for (const panel of panels) {
    const joined = texts.map((t) => t.text).join(' ')
    assert.ok(joined.includes('WORTH LETTERING'), 'the dialogue’s words survive the wrap')
    void panel
  }
  // The wrap itself: words in order, nothing dropped, no line over the box.
  const lines = wrapDialogue((s) => s.length * 10, 'one two three four five six', 120)
  assert.deepEqual(lines, ['ONE TWO', 'THREE FOUR', 'FIVE SIX'])
})

await check('export: a filename from the title, safe and never empty', () => {
  assert.equal(exportFilename('The Offer Beyond the Bus Stop'), 'the-offer-beyond-the-bus-stop.png')
  assert.equal(exportFilename('  ¡¿…?!  '), 'ink-desk-page.png')
})

// --- The reader's gate ------------------------------------------------------

await check('gate: the reader is unreachable until all four panels have art', () => {
  const base = emptyChapter('check')
  const drawn = { ...base, script: [panelFor(0), panelFor(1), panelFor(2), panelFor(3)] }
  assert.equal(gates(drawn).reader.open, true)
  const blank = panelFor(1, { versions: [], status: 'empty' })
  const holed = { ...base, script: [panelFor(0), blank, panelFor(2), panelFor(3)] }
  assert.equal(gates(holed).reader.open, false)
  assert.match(gates(holed).reader.hint ?? '', /panel 2/i)
})

// --- The story freeze, on the patch path too --------------------------------

const lockedCast = (c: Chapter): Chapter => ({
  ...c,
  pitch: { text: 'a courier', genre: 'Shonen', tone: 'Fast-paced' },
  synopsis: { title: 'Old story', body: 'The one the cast was built from.', accepted: true },
  cast: [
    { id: 'kaito', name: 'Kaito', role: 'courier', traits: [], look: 'scarf', dna: 'dna', sheetImageId: 'x.png', locked: true },
    { id: 'mio', name: 'Mio', role: 'rival', traits: [], look: 'glasses', dna: 'dna', sheetImageId: 'y.png', locked: true },
  ],
})

await check('freeze: with a cast on the desk, pitch and synopsis patches are refused', () => {
  const chapter = lockedCast(emptyChapter('check'))
  assert.throws(() => assertStoryEditable(chapter, { pitch: { text: 'stale tab typing' } }), Refused)
  assert.throws(() => assertStoryEditable(chapter, { synopsis: { title: 'a swap' } }), Refused)
  // Everything that is not the story still flows.
  assertStoryEditable(chapter, { station: 'storyboard' })
  assertStoryEditable(chapter, { panels: { 0: { dialogue: 'new line' } } })
  // And before the cast exists, the story is the learner's to type.
  assertStoryEditable(emptyChapter('check'), { pitch: { text: 'fresh desk' }, synopsis: { accepted: true } })
})

// --- New projects (v2: nothing is ever cleared; a new story is a new project) ----

await check('new project: a fresh project opens at first use, in its locked style', async () => {
  const fresh = await createProject({ title: 'Blank', stylePresetId: 'manhwa-colour' })
  const base = emptyChapter('check')
  assert.deepEqual(
    { ...fresh, address: base.address, title: '', stylePresetId: base.stylePresetId, serverRunId: 'x', updatedAt: 'x' },
    { ...base, serverRunId: 'x', updatedAt: 'x' }
  )
  assert.equal(fresh.title, 'Blank')
  assert.equal(fresh.stylePresetId, 'manhwa-colour', 'the style is locked at creation')
  assert.equal(fresh.serverRunId, singletons.serverRunId)
  assert.ok(fresh.address.projectId && fresh.address.chapterId, 'a real address')
  assert.deepEqual(await readDesk(fresh.address.projectId), fresh)
})

await check('new project: accepting a new synopsis wakes a NEW project with it, whole — the old one untouched', async () => {
  const old = await update((c) => ({ ...lockedCast(c), imageCount: 8, station: 'story' }))
  const story = {
    pitch: { text: 'a new courier', genre: 'Romance', tone: 'Hopeful' },
    synopsis: { title: 'Postmarked Tomorrow', body: 'Letters that haven’t been written yet.' },
  }
  const fresh = await createProject({ title: story.synopsis.title, stylePresetId: old.stylePresetId, story })
  assert.notEqual(fresh.address.projectId, old.address.projectId, 'a different project')
  assert.equal(fresh.synopsis?.accepted, true)
  assert.equal(fresh.synopsis?.title, story.synopsis.title)
  assert.deepEqual(fresh.pitch, story.pitch)
  assert.equal(fresh.cast.length, 0)
  assert.equal(fresh.script, null)
  assert.equal(fresh.imageCount, 0)
  assert.equal(fresh.station, 'story')
  assert.equal(fresh.stylePresetId, old.stylePresetId, 'same style as the project it was pitched from')
  const onDisk = await readDesk(fresh.address.projectId)
  assert.deepEqual(onDisk, fresh)
  assert.equal(gates(fresh).cast.open, true, 'the accepted story opens Cast at once')
  assert.equal(gates(fresh).reader.open, false)
  // The project the story was pitched from is exactly as it was.
  const untouched = await read()
  assert.equal(untouched.cast.length, 2)
  assert.equal(untouched.imageCount, 8)
  assert.equal(untouched.synopsis?.title, 'Old story')
})

await rm(dir, { recursive: true, force: true })
if (failed) {
  console.error('\ncheck:export FAILED')
  process.exit(1)
}
console.log('\ncheck:export passed — the PNG’s size, art, bubbles and lettering; the gate; the freeze; the clears.')

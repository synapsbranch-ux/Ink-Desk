// Slice 7's rules from `devpost/checklist.md > Slices > 7`, and slice 12's
// chapter on top of them, with no browser and no provider in the loop:
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
//
// Slice 12 (v2): the vertical page is its own geometry, distinct from both
// paged ones and complete; the cover composites its art the way
// `object-fit: cover` does and letters the title over it; a real PDF is
// built from real PNG bytes and read back — cover + N pages, each at its own
// page size, right-to-left when the chapter reads that way; the reading
// sequence puts the cover first and incomplete pages in as placeholders; and
// the reader's gate opens on the first complete page, whichever page is open.
import './server-only.mts' // first: lets server modules load outside Next (SEC-15)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = await mkdtemp(join(tmpdir(), 'inkdesk-export-'))
process.env.INKDESK_DATA_DIR = dir

// Imported after the env is set, because the store reads it at load.
const { bubbleLayout, defaultBubble, tailPath } = await import('../lib/bubble')
const { createProject, read: readDesk, update: updateDesk } = await import('../lib/chapter')
const { Refused } = await import('../lib/errors')
const {
  COVER_TITLE_EM,
  EXPORT_WIDTH,
  INK,
  PDF_PAGE_WIDTH_PT,
  balanceTitle,
  buildPdf,
  VERTICAL_NOMINAL,
  wrapWords,
  coverGeometry,
  drawCover,
  drawPage,
  ExportError,
  exportFilename,
  pageGeometry,
  stretchPath,
  wrapDialogue,
} = await import('../lib/export')
const { chapterPages, completePageIndices, firstReadable, publishable, readerSequence, readingMode } = await import(
  '../lib/reader'
)
const { store } = await import('../lib/store')
const { PDFDocument, PDFName } = await import('pdf-lib')
const { gates } = await import('../lib/gates')
const { assertStoryEditable } = await import('../lib/patch')
const { currentImageId } = await import('../lib/script')
const { emptyDesk } = await import('../lib/types')

import type { DrawContext, ExportPanel, PageGeometry, Rect } from '../lib/export'
import type { Chapter, Panel } from '../lib/types'

// One project on the scratch desk (v2); the "new project" checks make more.
const pid = (await createProject({ title: 'Export check', stylePresetId: 'manga-bw' }, 'local')).address.projectId
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
  const g = pageGeometry(EXPORT_WIDTH, 'ltr')
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
  const ltr = pageGeometry(EXPORT_WIDTH, 'ltr')
  const rtl = pageGeometry(EXPORT_WIDTH, 'rtl')
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
  | { op: 'fillText'; text: string; x: number; y: number; font: string; style: string }
  | { op: 'strokeText'; text: string; x: number; y: number; font: string; width: number; style: string }
  | { op: 'clip'; x: number; y: number; w: number; h: number }

function recordingContext() {
  const ops: Op[] = []
  // The size in the font the context holds now (`this.font`, not the spread-in start state).
  const fontSize = (font: string) => Number(/(\d+)px/.exec(font)?.[1] ?? 16)
  const state = { fillStyle: '', strokeStyle: '', lineWidth: 0, lineJoin: 'miter', font: '', textAlign: '', textBaseline: '' }
  let lastRect = { x: 0, y: 0, w: 0, h: 0 }
  const ctx = {
    ...state,
    save() {},
    restore() {},
    beginPath() {},
    rect(x: number, y: number, w: number, h: number) {
      lastRect = { x, y, w, h }
    },
    clip() {
      ops.push({ op: 'clip', ...lastRect })
    },
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
      ops.push({ op: 'fillText', text, x, y, font: this.font, style: String(this.fillStyle) })
    },
    strokeText(text: string, x: number, y: number) {
      ops.push({ op: 'strokeText', text, x, y, font: this.font, width: this.lineWidth, style: String(this.strokeStyle) })
    },
    // Deterministic width: half an em per character, like a chunky letter face.
    measureText(text: string) {
      return { width: text.length * fontSize(this.font) * 0.5 } as TextMetrics
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

const geom: PageGeometry = pageGeometry(EXPORT_WIDTH, 'ltr')
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

// Slice 23: the screen steps a long line down until it fits its bubble
// (`components/bubble-fit.ts`); the export does too, so the PNG never cuts
// what the screen shows whole. The filming desk's page 3, panel 2 — a long
// line in a square panel's default bubble — wrapped at the page's 17px size
// ran five lines down a box three lines tall.
await check('export v3: a long line steps down until it fits its bubble, never clipped (page 3, panel 2)', () => {
  const desk = JSON.parse(readFileSync(join(ROOT, 'data/filming-2026-10-14/projects/17638779-4ed3-4af0-9e78-23f812b563e8/project.json'), 'utf8'))
  const filmed: Panel = desk.chapters[0].pages[2].panels[1]
  assert.equal(filmed.dialogue, 'The courier becomes the author.')
  const floor = 6 * geom.scale // bubble-fit's FLOOR, scaled
  const lettered = (panel: Panel, g: PageGeometry = geom) => {
    const rec = recordingContext()
    drawPage(rec.ctx, g, [{ panel, image: { width: 1024, height: 1024, source: sources[1] } }], { makePath: (d) => ({ d }) as unknown as Path2D, fontFamily: '__Comic_Neue_check' })
    const slot = g.panels[panel.index]
    const l = bubbleLayout(panel)
    const b = { x: slot.x + (l.x / 100) * slot.w, y: slot.y + (l.y / 100) * slot.h, w: (l.w / 100) * slot.w, h: (l.h / 100) * slot.h }
    const box = { x: b.x + b.w * 0.14, y: b.y + b.h * 0.11, w: b.w * 0.72, h: b.h * 0.78 }
    const texts = rec.ops.filter((o) => o.op === 'fillText')
    const size = Number(/(\d+)px/.exec(texts[0]?.font ?? '')?.[1])
    const boxClip = rec.ops.some((o) => o.op === 'clip' && near(o.x, box.x) && near(o.w, box.w))
    return { texts, size, box, boxClip }
  }
  const { texts, size, box, boxClip } = lettered(filmed)
  assert.equal(texts.map((t) => t.text).join(' '), filmed.dialogue.toUpperCase(), 'every word, in order')
  assert.ok(size < Math.round(geom.fontSize), `stepped down from ${Math.round(geom.fontSize)}px, got ${size}px`)
  assert.ok(size >= floor, `never under the floor (${floor}px), got ${size}px`)
  for (const t of texts) assert.ok(t.text.length * size * 0.5 <= box.w + 0.5, `"${t.text}" is wider than its box`)
  assert.ok(texts.length * size * 1.15 <= box.h + 0.5, `${texts.length} lines at ${size}px are taller than the box (${box.h.toFixed(0)}px)`)
  const top = texts[0].y - (size * 1.15) / 2
  const bottom = texts[texts.length - 1].y + (size * 1.15) / 2
  assert.ok(top >= box.y - 0.5 && bottom <= box.y + box.h + 0.5, 'the lines sit inside the box')
  assert.ok(boxClip, 'a line that fits is clipped to its box, like overflow: hidden')
  // A line that already fits keeps the page's size.
  const short = lettered({ ...filmed, dialogue: 'Go.' })
  assert.equal(short.size, Math.round(geom.fontSize), 'a short line keeps the page’s size')
  // One word wider than the box steps down too, and is never broken.
  const wide = lettered({ ...filmed, dialogue: 'Unbelievably!' })
  assert.equal(wide.texts.length, 1)
  assert.ok(wide.texts[0].text.length * wide.size * 0.5 <= wide.box.w + 0.5, 'the long word fits its box')
  // Even the floor can't fit: the words stay whole, let out of the box, as on screen.
  const over = lettered({ ...filmed, dialogue: Array.from({ length: 60 }, () => 'word').join(' ') })
  assert.ok(over.size >= floor && over.size < floor + 1, `at the floor, got ${over.size}px`)
  assert.equal(over.texts.length > 0 && over.texts.map((t) => t.text).join(' ').split(' ').length, 60, 'every word drawn')
  assert.ok(!over.boxClip, 'an overfull bubble is not clipped to its box')
})

await check('export: a filename from the title, safe and never empty', () => {
  assert.equal(exportFilename('The Offer Beyond the Bus Stop'), 'the-offer-beyond-the-bus-stop.png')
  assert.equal(exportFilename('  ¡¿…?!  '), 'ink-desk-page.png')
})

// --- The reader's gate ------------------------------------------------------

await check('gate: the reader is unreachable until all four panels have art', () => {
  const base = emptyDesk()
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
  const chapter = lockedCast(emptyDesk())
  assert.throws(() => assertStoryEditable(chapter, { pitch: { text: 'stale tab typing' } }), Refused)
  assert.throws(() => assertStoryEditable(chapter, { synopsis: { title: 'a swap' } }), Refused)
  // Everything that is not the story still flows.
  assertStoryEditable(chapter, { station: 'storyboard' })
  assertStoryEditable(chapter, { panels: { 0: { dialogue: 'new line' } } })
  // And before the cast exists, the story is the learner's to type.
  assertStoryEditable(emptyDesk(), { pitch: { text: 'fresh desk' }, synopsis: { accepted: true } })
})

// --- New projects (v2: nothing is ever cleared; a new story is a new project) ----

await check('new project: a fresh project opens at first use, in its locked style', async () => {
  const fresh = await createProject({ title: 'Blank', stylePresetId: 'manhwa-colour' }, 'local')
  const base = emptyDesk()
  assert.deepEqual(
    { ...fresh, address: base.address, title: '', stylePresetId: base.stylePresetId, updatedAt: 'x' },
    { ...base, updatedAt: 'x' }
  )
  assert.equal(fresh.title, 'Blank')
  assert.equal(fresh.stylePresetId, 'manhwa-colour', 'the style is locked at creation')
  assert.ok(!('serverRunId' in fresh), 'the run id stays on the server (SEC-11)')
  assert.ok(fresh.address.projectId && fresh.address.chapterId, 'a real address')
  assert.deepEqual(await readDesk(fresh.address.projectId), fresh)
})

await check('new project: accepting a new synopsis wakes a NEW project with it, whole — the old one untouched', async () => {
  const old = await update((c) => ({ ...lockedCast(c), imageCount: 8, station: 'story' }))
  const story = {
    pitch: { text: 'a new courier', genre: 'Romance', tone: 'Hopeful' },
    synopsis: { title: 'Postmarked Tomorrow', body: 'Letters that haven’t been written yet.' },
  }
  const fresh = await createProject({ title: story.synopsis.title, stylePresetId: old.stylePresetId, story }, 'local')
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

// --- Slice 12: the chapter -------------------------------------------------

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

await check('geometry v2: the vertical page — one column, story order top to bottom, complete', () => {
  const v = pageGeometry(EXPORT_WIDTH, 'vertical')
  const ltr = pageGeometry(EXPORT_WIDTH, 'ltr')
  const rtl = pageGeometry(EXPORT_WIDTH, 'rtl')
  const inner = v.width - 2 * v.padding
  const [p1, p2, p3, p4] = v.panels
  // One full-width column, each panel at its generated ratio — nothing cropped.
  for (const p of v.panels) assert.ok(near(p.x, v.padding) && near(p.w, inner), 'full inner width, one column')
  assert.ok(near(p1.w / p1.h, 1.5) && near(p4.w / p4.h, 1.5), 'the wide panels stay 3:2')
  assert.ok(near(p2.w / p2.h, 1) && near(p3.w / p3.h, 1), 'the squares stay 1:1')
  // Story order is reading order, with the gutter between every pair.
  assert.ok(near(p1.y, v.padding), 'panel 1 at the top')
  assert.ok(near(p2.y, p1.y + p1.h + v.gap) && near(p3.y, p2.y + p2.h + v.gap) && near(p4.y, p3.y + p3.h + v.gap))
  assert.ok(near(v.height, p4.y + p4.h + v.padding), 'height closes the page')
  const page = { x: 0, y: 0, w: v.width, h: v.height }
  v.panels.forEach((p, i) => {
    assert.ok(inside(p, page), `panel ${i + 1} inside the page`)
    v.panels.forEach((q, j) => assert.ok(i === j || !overlaps(p, q), `panels ${i + 1} and ${j + 1} do not overlap`))
  })
  // Distinct from both paged layouts, and those two from each other.
  assert.notDeepEqual(v.panels, ltr.panels)
  assert.notDeepEqual(v.panels, rtl.panels)
  assert.notDeepEqual(ltr.panels, rtl.panels)
  assert.ok(v.height > ltr.height, 'a vertical page is a taller strip')
  // The paged pages are complete too: four panels, none overlapping, inside the page.
  for (const g of [ltr, rtl]) {
    const pg = { x: 0, y: 0, w: g.width, h: g.height }
    g.panels.forEach((p, i) => {
      assert.ok(inside(p, pg))
      g.panels.forEach((q, j) => assert.ok(i === j || !overlaps(p, q)))
    })
  }
  // The vertical page is scaled from the scroll's own width, so the lettering
  // sits in its full-width panel at the proportion the screen shows: 17px
  // across a panel of 600 − 2·14 − 2·2 − 2·2 px.
  assert.ok(near(v.fontSize, 17 * (EXPORT_WIDTH / VERTICAL_NOMINAL)))
  const screenRatio = 17 / (VERTICAL_NOMINAL - 28 - 4 - 4)
  assert.ok(Math.abs(v.fontSize / v.panels[1].w - screenRatio) / screenRatio < 0.02, 'lettering to panel width matches the scroll')
})

await check('export v2: a vertical page composites every panel into its column slot', () => {
  const v = pageGeometry(EXPORT_WIDTH, 'vertical')
  const rec = recordingContext()
  drawPage(rec.ctx, v, inputs, { makePath: (d) => ({ d }) as unknown as Path2D, fontFamily: '__Comic_Neue_check' })
  const draws = rec.ops.filter((o) => o.op === 'drawImage')
  assert.equal(draws.length, 4)
  draws.forEach((d, i) => assert.ok(inside(d, v.panels[i], 0.01), `panel ${i + 1} art inside its vertical slot`))
  assert.equal(rec.ops.filter((o) => o.op === 'ellipse').length, 4, 'four bubbles')
  const first = rec.ops[0]
  assert.ok(first.op === 'fillRect' && near(first.h, v.height), 'paper covers the whole strip')
})

await check('cover: the art fills the 2:3 frame like object-fit: cover, the title lettered over it', () => {
  const g = coverGeometry(EXPORT_WIDTH)
  assert.ok(near(g.height / g.width, 1.5), 'the cover is 2:3')
  assert.ok(near(g.title.fontSize, EXPORT_WIDTH * COVER_TITLE_EM), 'the title is sized from the cover width, as cqw on screen')
  const source = { id: 'cover' } as unknown as CanvasImageSource
  const rec = recordingContext()
  // A slightly wide image: it must cover the frame and overflow sideways, centred.
  drawCover(rec.ctx, g, { width: 1100, height: 1536, source }, 'The Last Delivery Before Dawn', '__Cormorant_check')
  const art = rec.ops.find((o) => o.op === 'drawImage')
  assert.ok(art && art.op === 'drawImage' && art.source === source)
  assert.ok(art.op === 'drawImage' && art.x <= 0.01 && art.y <= 0.01 && art.x + art.w >= g.width - 0.01 && art.y + art.h >= g.height - 0.01, 'covers the frame')
  assert.ok(art.op === 'drawImage' && near(art.w / art.h, 1100 / 1536, 0.001), 'never stretched')
  assert.ok(art.op === 'drawImage' && near(art.x, (g.width - art.w) / 2), 'centred')
  const fills = rec.ops.filter((o) => o.op === 'fillText')
  const strokes = rec.ops.filter((o) => o.op === 'strokeText')
  assert.ok(fills.length >= 1 && fills.length === strokes.length, 'every line outlined and filled')
  assert.equal(fills.map((t) => t.text).join(' '), 'The Last Delivery Before Dawn', 'the title verbatim — not uppercased, nothing dropped')
  for (const t of fills) {
    assert.match(t.font, /^600 \d+px __Cormorant_check$/)
    assert.equal(t.style, '#ffffff', 'white letters over the art')
    assert.ok(near(t.x, g.width / 2), 'centred')
    assert.ok(t.y >= g.title.top, 'from 5% down')
  }
  for (const t of strokes) assert.ok(t.style === INK && near(t.width, g.title.stroke), 'the ink outline under the fill')
  // Paint order: each line's outline before its fill.
  const order = rec.ops.filter((o) => o.op === 'fillText' || o.op === 'strokeText').map((o) => o.op)
  assert.deepEqual(order, fills.flatMap(() => ['strokeText', 'fillText']))
  // With no art, the title is ink on paper and nothing is drawn behind it.
  const bare = recordingContext()
  drawCover(bare.ctx, g, null, 'Return to Sender', '__Cormorant_check')
  assert.equal(bare.ops.filter((o) => o.op === 'drawImage').length, 0)
  assert.equal(bare.ops.filter((o) => o.op === 'strokeText').length, 0)
  assert.ok(bare.ops.filter((o) => o.op === 'fillText').every((t) => t.op === 'fillText' && t.style === INK))
})

await check('cover: a balanced title — the greedy line count, evened out', () => {
  const measure = (s: string) => s.length * 10
  // Greedy fills the first line and leaves a widow; balanced keeps two lines, evened.
  const title = 'A Very Long Night In The Port'
  assert.deepEqual(wrapWords(measure, title.split(' '), 230), ['A Very Long Night In', 'The Port'], 'the greedy wrap is uneven')
  const lines = balanceTitle(measure, title, 230)
  assert.deepEqual(lines, ['A Very Long Night', 'In The Port'])
  assert.deepEqual(balanceTitle(measure, 'Short', 200), ['Short'])
  assert.deepEqual(balanceTitle(measure, '   ', 200), [])
})

/** A real 16 × 24 JPEG, ink-grey (made once with Pillow; 635 bytes). */
const TINY_JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAYABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5+ooopDCiiigD/9k='

/** A real PNG of the given size — one ink-grey colour, encoded with zlib. */
function solidPng(width: number, height: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  const row = Buffer.alloc(1 + width * 3, 0x20)
  row[0] = 0 // filter: none
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return new Uint8Array(Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

await check('pdf: cover + N pages, each at its own page size, in reading order, right-to-left when it reads so', async () => {
  const cg = coverGeometry(EXPORT_WIDTH)
  const pg = pageGeometry(EXPORT_WIDTH, 'rtl')
  const sized = (w: number, h: number) => ({ bytes: solidPng(Math.round(w), Math.round(h)), type: 'png' as const, width: Math.round(w), height: Math.round(h) })
  const cover = sized(cg.width, cg.height)
  const page = sized(pg.width, pg.height)
  const bytes = await buildPdf([cover, page, page, page], { title: 'Return to Sender', rtl: true })
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString('latin1'), '%PDF-', 'a real PDF')
  const doc = await PDFDocument.load(bytes)
  assert.equal(doc.getPageCount(), 4, 'the cover and three pages')
  assert.equal(doc.getTitle(), 'Return to Sender')
  const [c, ...rest] = doc.getPages()
  assert.ok(near(c.getWidth(), PDF_PAGE_WIDTH_PT) && near(c.getHeight(), PDF_PAGE_WIDTH_PT * 1.5), 'the cover is 6 × 9 in')
  for (const p of rest) {
    assert.ok(near(p.getWidth(), PDF_PAGE_WIDTH_PT), 'every page six inches wide')
    assert.ok(near(p.getHeight() / p.getWidth(), page.height / page.width, 0.001), 'each page at its own proportions')
  }
  const prefs = doc.catalog.lookup(PDFName.of('ViewerPreferences'))
  assert.ok(prefs && String(prefs).includes('/Direction /R2L'), 'a manga chapter tells the viewer it reads right to left')

  // A vertical chapter: tall strips, and no right-to-left flag.
  const vg = pageGeometry(EXPORT_WIDTH, 'vertical')
  const strip = sized(vg.width, vg.height)
  const vdoc = await PDFDocument.load(await buildPdf([cover, strip, strip], { title: 'Manhwa', rtl: false }))
  assert.equal(vdoc.getPageCount(), 3)
  assert.ok(near(vdoc.getPage(1).getHeight() / vdoc.getPage(1).getWidth(), strip.height / strip.width, 0.001), 'the strip keeps its length')
  assert.equal(vdoc.catalog.lookup(PDFName.of('ViewerPreferences')), undefined)

  // The browser embeds JPEG pages (a PNG page is ~9 MB): a real JPEG lands at
  // the size it is declared at, whatever its own pixel count.
  const jpeg = { bytes: new Uint8Array(Buffer.from(TINY_JPEG, 'base64')), type: 'jpeg' as const, width: page.width, height: page.height }
  const jdoc = await PDFDocument.load(await buildPdf([cover, jpeg], { title: 'JPEG', rtl: false }))
  assert.equal(jdoc.getPageCount(), 2)
  assert.ok(near(jdoc.getPage(1).getHeight() / jdoc.getPage(1).getWidth(), page.height / page.width, 0.001))

  // Nothing finished: refused with a sentence, never an empty file.
  await assert.rejects(buildPdf([], { title: 'x', rtl: false }), ExportError)
})

await check('names v2: page PNGs and the chapter PDF', () => {
  assert.equal(exportFilename('Return to Sender', 'page-2'), 'return-to-sender-page-2.png')
  assert.equal(exportFilename('Return to Sender', 'cover'), 'return-to-sender-cover.png')
  assert.equal(exportFilename('Return to Sender', undefined, 'pdf'), 'return-to-sender.pdf')
  assert.equal(exportFilename('  ¡¿…?!  ', undefined, 'pdf'), 'ink-desk-chapter.pdf')
  assert.equal(exportFilename('Pokémon Café', undefined, 'pdf'), 'pokemon-cafe.pdf', 'accents fold, never split a word')
  const long = exportFilename(`${'a'.repeat(59)} bcd`, 'page-2')
  assert.ok(!long.includes('--'), `no dangling hyphen before the part, got ${long}`)
})

await check('reading order: manga presets page right to left, manhwa scrolls', () => {
  assert.equal(readingMode('manga-bw'), 'paged-rtl')
  assert.equal(readingMode('manhwa-colour'), 'vertical')
})

// A three-page chapter on the real store: page 1 inked, page 2 half inked,
// page 3 written but blank, and a cover — the reader's view from every page.
const v2 = (await createProject({ title: 'Chapter check', stylePresetId: 'manga-bw' }, 'local')).address
const inkedPage = (tag: string) => [0, 1, 2, 3].map((i) => panelFor(i as 0 | 1 | 2 | 3, { versions: [{ imageId: `${tag}-${i}.png`, createdAt: 'x' }] }))
const blankPanel = (i: 0 | 1 | 2 | 3) => panelFor(i, { versions: [], status: 'empty' })
await store.updateProject(v2.projectId, (p) => ({
  ...p,
  chapters: p.chapters.map((c) => ({
    ...c,
    cover: { brief: 'b', title: 'Chapter check', versions: [], currentVersion: 0, status: 'empty', startedAt: null, startedByRun: null },
    pages: [
      { index: 0, layoutId: 'four-shot' as const, panels: inkedPage('p1') },
      { index: 1, layoutId: 'four-shot' as const, panels: [inkedPage('p2')[0], blankPanel(1), inkedPage('p2')[2], blankPanel(3)] },
      { index: 2, layoutId: 'four-shot' as const, panels: [blankPanel(0), blankPanel(1), blankPanel(2), blankPanel(3)] },
    ],
  })),
}))

await check('sequence: the cover first, every page in order, incomplete pages as placeholders', async () => {
  const desk = await readDesk(v2.projectId)
  assert.equal(desk.chapterPanels.length, 3, 'the desk view carries every page')
  const seq = readerSequence(desk)
  assert.deepEqual(
    seq.map((e) => (e.kind === 'cover' ? 'cover' : `p${e.index + 1}:${e.complete ? 'done' : `pencil(${e.inked})`}`)),
    ['cover', 'p1:done', 'p2:pencil(2)', 'p3:pencil(0)']
  )
  // An undrawn cover still leads, but the reader opens on the first readable page.
  assert.equal(firstReadable(seq), 1)
  assert.deepEqual(publishable(seq).map((e) => e.kind), ['page'], 'the PDF holds only finished pages — no pencil cover')
  // Draw the cover: it opens the reader and leads the PDF.
  await store.updateProject(v2.projectId, (p) => ({
    ...p,
    chapters: p.chapters.map((c) => ({ ...c, cover: c.cover && { ...c.cover, versions: [{ imageId: 'cover-1.png', createdAt: 'x' }], status: 'done' } })),
  }))
  const drawn = readerSequence(await readDesk(v2.projectId))
  assert.equal(firstReadable(drawn), 0)
  assert.deepEqual(publishable(drawn).map((e) => (e.kind === 'cover' ? 'cover' : e.index)), ['cover', 0])
  // The migrated v1 desk has no Director and no cover: it opens on page 1.
  const noCover = readerSequence({ ...desk, cover: null })
  assert.equal(noCover[0].kind, 'page')
})

await check('gate v2: the reader opens on the first complete page — from whichever page is open', async () => {
  for (const n of [0, 1, 2]) {
    const desk = await readDesk(v2.projectId, { chapterId: v2.chapterId, pageIndex: n })
    assert.equal(desk.address.pageIndex, n)
    assert.deepEqual(completePageIndices(desk), [0], `page ${n + 1} open: page 1 is the complete one`)
    assert.equal(gates(desk).reader.open, true, `open with page ${n + 1} on the desk`)
  }
  // Page 1 not complete, page 2 complete: still open — the first complete page need not be page 1.
  await store.updateProject(v2.projectId, (p) => ({
    ...p,
    chapters: p.chapters.map((c) => ({
      ...c,
      pages: [
        { ...c.pages[0], panels: [blankPanel(0), ...c.pages[0].panels.slice(1)] },
        { ...c.pages[1], panels: inkedPage('p2') },
        c.pages[2],
      ],
    })),
  }))
  const d = await readDesk(v2.projectId, { chapterId: v2.chapterId, pageIndex: 0 })
  assert.deepEqual(completePageIndices(d), [1])
  assert.equal(gates(d).reader.open, true)
  // Nothing complete anywhere: shut, and the hint names the open page's first blank panel.
  await store.updateProject(v2.projectId, (p) => ({
    ...p,
    chapters: p.chapters.map((c) => ({
      ...c,
      pages: c.pages.map((pg) => ({ ...pg, panels: [blankPanel(0), ...pg.panels.slice(1)] })),
    })),
  }))
  const shut = await readDesk(v2.projectId, { chapterId: v2.chapterId, pageIndex: 1 })
  assert.equal(gates(shut).reader.open, false)
  assert.equal(gates(shut).reader.hint, 'Finish panel 1 of page 2 first.')
  // The browser's copy of the open page wins over the server's list: inking it there opens the gate.
  const local = { ...shut, script: inkedPage('local') }
  assert.deepEqual(chapterPages(local)[1].map((p) => p.versions[0]?.imageId), ['local-0.png', 'local-1.png', 'local-2.png', 'local-3.png'])
  assert.equal(gates(local).reader.open, true)
})

await rm(dir, { recursive: true, force: true })
if (failed) {
  console.error('\ncheck:export FAILED')
  process.exit(1)
}
console.log('\ncheck:export passed — the PNG’s size, art, bubbles and lettering; the vertical page; the cover; the PDF; the chapter’s sequence and gate; the freeze; the clears.')

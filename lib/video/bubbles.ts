// The trailer's speech bubbles (v3, slice 22): each spoken line is lettered by
// the app over its shot, never by the video model — the same rule as the reader
// (`devpost/scope.md > Lettering`). A bubble is drawn here as a transparent PNG
// the size of the canvas, and `assemble.ts` lays it over the shot between the
// line's `lineWindow` times.
//
// The look is the reader's: a white ellipse with an ink outline and the same
// two-curved tail (`lib/bubble.ts > tailPath`, the geometry the studio and the
// PNG export share), the words in Comic Neue Bold, upper-case, centred in the
// ellipse's text box. The shape is an SVG drawn by sharp/librsvg; the words are
// Pango text through sharp with the brand's own font file (`video/public/fonts`,
// never a system face, so the worker's machine does not matter), word-wrapped
// and shrunk until they fit the ellipse — a line is never clipped; if the stored
// bubble is too small for it at a readable size the bubble grows about its centre.
//
// Where the bubble sits comes from `bubbleOnShot`: the layout is stored as a
// percentage of the PANEL (3:2 or 1:1), and the shot is a different frame. A 1:1
// panel is sent to Seedance as it is, so its layout carries over unchanged; a 3:2
// panel is centre-cropped to 16:9 (`lib/video/frames.ts`), so the rows the crop
// removed are gone and a bubble that stood partly in them is pulled back inside.
//
// Server only: it reads the font files and runs sharp.
import 'server-only'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import sharp, { type OverlayOptions } from 'sharp'
import { clampBubble, tailPath } from '../bubble'
import type { BubbleLayout } from '../types'
import { TRAILER_HEIGHT, TRAILER_WIDTH, type ShotAspect, type TrailerLine } from './types'

/** The brand's ink (`app/globals.css --ink`, `video/src/theme.ts`). */
export const INK = '#201f1d'

// --- Where the brand's files are ---------------------------------------------------------

let fontDir: string | null = null

/**
 * Full path of a file in `video/public/fonts` (or any sibling folder under
 * `video/public`, e.g. `brand`). The folder is found by walking up from the
 * working directory, so it resolves the same under Next's server, tsx and the
 * worker, wherever the process was started inside the repository.
 */
export function brandFile(folder: 'fonts' | 'brand', file: string): string {
  if (fontDir === null) {
    let dir = process.cwd()
    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, 'video', 'public')
      if (existsSync(join(candidate, 'fonts', 'ComicNeue-Bold.ttf'))) {
        fontDir = candidate
        break
      }
      const up = dirname(dir)
      if (up === dir) break
      dir = up
    }
    if (fontDir === null) throw new Error('The brand fonts were not found (expected video/public/fonts from the working directory upward)')
  }
  return join(fontDir, folder, file)
}

// --- Panel % -> shot-frame % ---------------------------------------------------------------

/** A wide panel is 3:2; it is centre-cropped to 16:9 before it is animated. */
const WIDE_PANEL_RATIO = 3 / 2
const WIDE_SHOT_RATIO = 16 / 9
/** The share of the panel's rows that survive the 3:2 -> 16:9 crop, and the top share that is cut. */
const KEPT_ROWS = WIDE_PANEL_RATIO / WIDE_SHOT_RATIO
const CUT_TOP_PCT = ((1 - KEPT_ROWS) / 2) * 100

/**
 * A bubble's layout on the PANEL (% of the panel) mapped onto the SHOT's frame
 * (% of the frame). Pure.
 *
 * 1:1 is the identity: the square panel is animated as it is. 16:9: the crop
 * keeps every column and the middle `KEPT_ROWS` of the rows, so x and the width
 * carry over, y and the heights are re-based on the kept rows (a bubble the same
 * size on screen is taller in % of the shorter frame), and the result goes through
 * `clampBubble` — a bubble that stood partly in the cut rows is moved inside the
 * frame, and a tail tip in the cut sits on the nearest edge.
 */
export function bubbleOnShot(bubble: BubbleLayout, aspect: ShotAspect): BubbleLayout {
  if (aspect === '1:1') return { ...bubble }
  const y = (v: number) => (v - CUT_TOP_PCT) / KEPT_ROWS
  return clampBubble({
    x: bubble.x,
    y: y(bubble.y),
    w: bubble.w,
    h: bubble.h / KEPT_ROWS,
    tailX: bubble.tailX,
    tailY: y(bubble.tailY),
  })
}

// --- The overlay ------------------------------------------------------------------------------

type Box = { x: number; y: number; w: number; h: number }

/** Where the shot sits inside the canvas: 16:9 fills it, 1:1 is a centred square the canvas's height. */
export function shotRect(aspect: ShotAspect, width: number, height: number): Box {
  if (aspect === '1:1') {
    const side = Math.min(width, height)
    return { x: Math.round((width - side) / 2), y: Math.round((height - side) / 2), w: side, h: side }
  }
  const w = Math.min(width, Math.round(height * WIDE_SHOT_RATIO))
  const h = Math.round(w / WIDE_SHOT_RATIO)
  return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), w, h }
}

/** The text box inside the ellipse: the largest centred rectangle that stays inside it (the reader's wrap is 72 x 78% and relies on `overflow: hidden`; the trailer never clips, so it uses the inscribed box). */
const TEXT_BOX = 0.7
/** Start lettering at the reader's size relative to its panel (17 px on a ~700 px wide panel, a square panel is half as wide on screen). */
const START_SIZE_PER_WIDTH = { '16:9': 0.024, '1:1': 0.05 } as const
/** Never shrink below this share of the start size before the bubble itself grows. */
const MIN_SIZE_SHARE = 0.62
const HARD_MIN_SIZE = 9
const MAX_GROWTHS = 4
const GROWTH = 1.15

const escapeMarkup = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type Lettering = { png: Buffer; width: number; height: number; size: number }

async function letterText(text: string, fontFile: string, size: number, maxWidth: number, color: string): Promise<Lettering> {
  const png = await sharp({
    text: {
      text: `<span foreground="${color}">${escapeMarkup(text)}</span>`,
      font: `Comic Neue Bold ${size}`,
      fontfile: fontFile,
      width: Math.max(1, Math.floor(maxWidth)),
      align: 'centre',
      rgba: true,
      wrap: 'word-char',
      spacing: Math.round(size * 0.1),
    },
  })
    .png()
    .toBuffer()
  const meta = await sharp(png).metadata()
  return { png, width: meta.width ?? 0, height: meta.height ?? 0, size }
}

/** The biggest size from `start` down to `floor` at which the words fit the box, or null. */
async function fitText(text: string, fontFile: string, box: { w: number; h: number }, start: number, floor: number): Promise<Lettering | null> {
  let size = Math.max(floor, Math.round(start))
  for (;;) {
    const lettering = await letterText(text, fontFile, size, box.w, INK)
    if (lettering.height <= box.h && lettering.width <= box.w) return lettering
    if (size <= floor) return null
    size = Math.max(floor, Math.min(size - 1, Math.floor(size * 0.93)))
  }
}

/** The tail's path (% of the bubble's frame) in canvas pixels: the two Q curves, every x and y scaled. */
function pathInPixels(d: string, rect: Box): string {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
  if (numbers.length < 10) throw new Error('the bubble tail has an unexpected shape')
  const point = (i: number) => `${round(rect.x + (numbers[i] / 100) * rect.w)} ${round(rect.y + (numbers[i + 1] / 100) * rect.h)}`
  return `M ${point(0)} Q ${point(2)} ${point(4)} Q ${point(6)} ${point(8)}`
}

const round = (n: number) => Math.round(n * 100) / 100

/** A bubble grown about its centre, kept inside the frame by the shared clamp. */
function grown(l: BubbleLayout): BubbleLayout {
  const w = l.w * GROWTH
  const h = l.h * GROWTH
  return clampBubble({ ...l, x: l.x + (l.w - w) / 2, y: l.y + (l.h - h) / 2, w, h })
}

/** A margin the outline never crosses: the clamp lets a bubble touch the frame's edge, where half its stroke would be cut off on screen. */
const EDGE_MARGIN_SHARE = 0.012
function inset(l: BubbleLayout, rect: Box): BubbleLayout {
  const mx = ((rect.w * EDGE_MARGIN_SHARE) / rect.w) * 100
  const my = ((rect.w * EDGE_MARGIN_SHARE) / rect.h) * 100
  const between = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  return {
    ...l,
    x: between(l.x, mx, 100 - mx - l.w),
    y: between(l.y, my, 100 - my - l.h),
    tailX: between(l.tailX, mx, 100 - mx),
    tailY: between(l.tailY, my, 100 - my),
  }
}

/**
 * The bubble for one line as a transparent PNG the size of the canvas
 * (1280 x 720 unless asked otherwise): the ellipse and tail inside the shot's
 * rectangle, the words centred in it. The shot is 16:9 (fills the canvas) or 1:1
 * (a centred square) — `assemble.ts` places the clip the same way.
 */
export async function renderBubbleOverlay(input: { line: TrailerLine; aspect: ShotAspect; width?: number; height?: number }): Promise<Buffer> {
  const width = input.width ?? TRAILER_WIDTH
  const height = input.height ?? TRAILER_HEIGHT
  const rect = shotRect(input.aspect, width, height)
  const text = input.line.text.replace(/\s+/g, ' ').trim().toUpperCase()
  const fontFile = brandFile('fonts', 'ComicNeue-Bold.ttf')
  const start = rect.w * START_SIZE_PER_WIDTH[input.aspect]

  // Find the size (and, if the stored bubble is too small for the words, the size
  // of the bubble) at which everything fits the ellipse.
  let layout = inset(bubbleOnShot(input.line.bubble, input.aspect), rect)
  let lettering: Lettering | null = null
  let box: Box = { x: 0, y: 0, w: 0, h: 0 }
  for (let growth = 0; ; growth++) {
    const bubble: Box = {
      x: rect.x + (layout.x / 100) * rect.w,
      y: rect.y + (layout.y / 100) * rect.h,
      w: (layout.w / 100) * rect.w,
      h: (layout.h / 100) * rect.h,
    }
    box = { x: bubble.x + (bubble.w * (1 - TEXT_BOX)) / 2, y: bubble.y + (bubble.h * (1 - TEXT_BOX)) / 2, w: bubble.w * TEXT_BOX, h: bubble.h * TEXT_BOX }
    const last = growth >= MAX_GROWTHS
    lettering = text === '' ? null : await fitText(text, fontFile, box, start, last ? HARD_MIN_SIZE : start * MIN_SIZE_SHARE)
    if (text === '' || lettering || last) break
    layout = inset(grown(layout), rect)
  }
  // A line that fits at no size at all (a pathological stored layout) is still lettered, at the smallest size.
  if (text !== '' && !lettering) lettering = await letterText(text, fontFile, HARD_MIN_SIZE, box.w, INK)

  const stroke = Math.max(3, round(rect.w / 360))
  const cx = rect.x + ((layout.x + layout.w / 2) / 100) * rect.w
  const cy = rect.y + ((layout.y + layout.h / 2) / 100) * rect.h
  const rx = (layout.w / 200) * rect.w
  const ry = (layout.h / 200) * rect.h
  const tail = pathInPixels(tailPath(layout), rect)
  // Paint order is the reader's: the ellipse (fill, then outline), then the tail, whose fill covers the rim where it joins.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<g fill="#ffffff" stroke="${INK}" stroke-width="${stroke}" stroke-linejoin="round">` +
    `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(rx)}" ry="${round(ry)}"/>` +
    `<path d="${tail}"/></g></svg>`

  const layers: OverlayOptions[] = [{ input: Buffer.from(svg), left: 0, top: 0 }]
  if (lettering) {
    layers.push({
      input: lettering.png,
      left: Math.round(box.x + (box.w - lettering.width) / 2),
      top: Math.round(box.y + (box.h - lettering.height) / 2),
    })
  }
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .png()
    .toBuffer()
}

// The reader's exports: the same page the screen shows — each panel's
// *displayed* version, the bubbles exactly as placed, Comic Neue lettering —
// composited onto an off-screen canvas and saved with `toBlob()`. No server
// round trip. Since slice 12 the same canvases also make the chapter's PDF:
// the cover with its title lettered by the app, then every complete page,
// each embedded on a PDF page of its own proportions (`pdf-lib`, loaded only
// when a PDF is asked for). Inside the PDF the pages are JPEG at
// `PDF_JPEG_QUALITY`, not PNG: a composited page is ~9 MB as a PNG, so a
// six-page chapter would be a 50–75 MB file nobody can send. The PNG export
// stays lossless.
//
// Split on purpose: the geometry, `drawPage`, `drawCover` and `buildPdf` are
// pure and take the canvas (or the PNG bytes) as arguments, so
// `npm run check:export` runs the real compositing code in Node against a
// recording context and assert what the PNG and the PDF will contain. Only
// the functions under "Browser-only" touch the DOM (fetching bytes, loading
// the fonts, the canvas itself).
// See `devpost/spec.md > Components > Reader Station`, `> The Page Layout`
// and `> Reader and Exports (v2)`.
import { apiFetch } from '../components/api-fetch'
import { bubbleLayout, tailPath } from './bubble'
import { imageUrl } from './image-url'
import type { PageDirection, ReaderEntry } from './reader'
import { currentImageId } from './script'
import type { BubbleLayout, Panel } from './types'

/** The page's ink and paper, from `app/globals.css` — the export can't read
 *  CSS variables, so the two tokens it needs are repeated here. */
export const INK = '#201f1d'
const WHITE = '#ffffff'

/** A failure whose message is written for the screen — anything else that
 *  escapes the export is shown as one generic calm sentence instead. */
export class ExportError extends Error {}

export const EXPORT_WIDTH = 1600
/** The page's rough on-screen width. On screen the gutters are a fixed 14px
 *  and the strokes 2px at about this size; the export scales them with its
 *  own width so the proportions — and therefore the layout — match. */
const NOMINAL = 720
/** The vertical page's on-screen width: `.reader-sheet.is-vertical`'s
 *  `max-width` in `app/globals.css`. Its gutters, strokes and 17px lettering
 *  are scaled from this, so a manhwa export letters its bubbles at the size
 *  the scroll shows them. */
export const VERTICAL_NOMINAL = 600

export type Rect = { x: number; y: number; w: number; h: number }

export type PageGeometry = {
  width: number
  height: number
  /** width / NOMINAL — strokes and lettering scale by this. */
  scale: number
  padding: number
  gap: number
  /** The page's heavy ink frame. */
  frame: number
  /** Each panel's ink border, and the bubbles' outline. */
  stroke: number
  /** Lettering size, the screen's 17px cap scaled to the export. */
  fontSize: number
  /** By story index 0–3. RTL swaps where panels 2 and 3 *sit* — the story
   *  order never changes, the reading direction does. */
  panels: Rect[]
}

/** The slice 7 page frame, scaled from `The Page Layout`: a 3:2 wide panel,
 *  two 1:1 squares, a 3:2 wide panel, with equal gutters all round. `rtl`
 *  swaps where the squares sit; `vertical` (slice 12, the manhwa presets)
 *  stacks the four panels in one full-width column, story order top to
 *  bottom — the page as one stretch of a vertical scroll. */
export function pageGeometry(width = EXPORT_WIDTH, direction: PageDirection = 'ltr'): PageGeometry {
  const scale = width / (direction === 'vertical' ? VERTICAL_NOMINAL : NOMINAL)
  const padding = 14 * scale
  const gap = 14 * scale
  const inner = width - 2 * padding
  const wideH = inner / (3 / 2)
  const common = { width, scale, padding, gap, frame: 2 * scale, stroke: 2 * scale, fontSize: 17 * scale }

  if (direction === 'vertical') {
    const y2 = padding + wideH + gap
    const y3 = y2 + inner + gap
    const y4 = y3 + inner + gap
    return {
      ...common,
      height: y4 + wideH + padding,
      panels: [
        { x: padding, y: padding, w: inner, h: wideH },
        { x: padding, y: y2, w: inner, h: inner },
        { x: padding, y: y3, w: inner, h: inner },
        { x: padding, y: y4, w: inner, h: wideH },
      ],
    }
  }

  const rtl = direction === 'rtl'
  const square = (inner - gap) / 2
  const midY = padding + wideH + gap
  const leftX = padding
  const rightX = padding + square + gap
  return {
    ...common,
    height: midY + square + gap + wideH + padding,
    panels: [
      { x: padding, y: padding, w: inner, h: wideH },
      { x: rtl ? rightX : leftX, y: midY, w: square, h: square },
      { x: rtl ? leftX : rightX, y: midY, w: square, h: square },
      { x: padding, y: midY + square + gap, w: inner, h: wideH },
    ],
  }
}

export type CoverGeometry = {
  width: number
  height: number
  /** The cover's ink frame, as `.cover-frame`'s border. */
  frame: number
  /** The title's box: centred text from `top`, inset `padX` each side. */
  title: { top: number; padX: number; fontSize: number; lineHeight: number; stroke: number }
}

/** The cover page: 2:3 like `.cover-frame`, the title lettered from 5% down
 *  with 7% side insets, its size and outline proportional to the width —
 *  the same `cqw` units the screen letters it in, so the two match. */
export function coverGeometry(width = EXPORT_WIDTH): CoverGeometry {
  const fontSize = width * COVER_TITLE_EM
  return {
    width,
    height: width * 1.5,
    frame: 2 * (width / NOMINAL),
    title: { top: width * 1.5 * 0.05, padX: width * 0.07, fontSize, lineHeight: fontSize * 1.02, stroke: width * COVER_TITLE_STROKE },
  }
}

/** The cover title's size and outline as fractions of the cover's width —
 *  `10cqw` and `1.6cqw` in `app/globals.css > .cover-title`. */
export const COVER_TITLE_EM = 0.1
export const COVER_TITLE_STROKE = 0.016

/** `object-fit: contain` for the canvas: the image centred in its panel at
 *  its own ratio. The generated ratios match their slots, so in practice
 *  this fills the panel — but a resolution oddity letterboxes rather than
 *  cropping through a face. */
export function containRect(img: { width: number; height: number }, slot: Rect): Rect {
  const k = Math.min(slot.w / img.width, slot.h / img.height)
  const w = img.width * k
  const h = img.height * k
  return { x: slot.x + (slot.w - w) / 2, y: slot.y + (slot.h - h) / 2, w, h }
}

/** `object-fit: cover`: the image filling the frame at its own ratio, the
 *  overflow clipped — how the cover sits in `.cover-frame`. */
export function coverRect(img: { width: number; height: number }, frame: Rect): Rect {
  const k = Math.max(frame.w / img.width, frame.h / img.height)
  const w = img.width * k
  const h = img.height * k
  return { x: frame.x + (frame.w - w) / 2, y: frame.y + (frame.h - h) / 2, w, h }
}

/**
 * The screen draws the tail in a 0–100 viewBox stretched to the panel
 * (`preserveAspectRatio="none"`) with a non-scaling stroke; a canvas has
 * neither, so the same stretch is baked into the coordinates and the stroke
 * stays uniform. The grammar is fixed — `M x y Q x y x y Q x y x y`, straight
 * from `tailPath()`.
 */
export function stretchPath(d: string, rect: Rect): string {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  const p: string[] = []
  for (let i = 0; i + 1 < n.length; i += 2) {
    const r = (v: number) => Math.round(v * 100) / 100
    p.push(`${r(rect.x + (n[i] / 100) * rect.w)} ${r(rect.y + (n[i + 1] / 100) * rect.h)}`)
  }
  return `M ${p[0]} Q ${p[1]} ${p[2]} Q ${p[3]} ${p[4]}`
}

/** A bubble layout mapped from % of the panel to canvas pixels. */
export function bubbleRect(l: BubbleLayout, slot: Rect): Rect {
  return { x: slot.x + (l.x / 100) * slot.w, y: slot.y + (l.y / 100) * slot.h, w: (l.w / 100) * slot.w, h: (l.h / 100) * slot.h }
}

/** Greedy word wrap with the context's own measurements. */
export function wrapWords(measure: (text: string) => number, words: string[], maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const tentative = line ? `${line} ${word}` : word
    if (line && measure(tentative) > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = tentative
    }
  }
  if (line) lines.push(line)
  return lines
}

/** The bubble's lines — the same lines the bubble shows, uppercased the way
 *  the CSS `text-transform` does. */
export function wrapDialogue(measure: (text: string) => number, dialogue: string, maxWidth: number): string[] {
  return wrapWords(measure, dialogue.trim().toUpperCase().split(/\s+/).filter(Boolean), maxWidth)
}

/** The cover title's lines, as `text-wrap: balance` sets them: no more lines
 *  than the greedy wrap needs, at the narrowest width that still fits them —
 *  so a two-line title is two even lines, not a long one and a widow. */
export function balanceTitle(measure: (text: string) => number, title: string, maxWidth: number): string[] {
  const words = title.trim().split(/\s+/).filter(Boolean)
  const greedy = wrapWords(measure, words, maxWidth)
  if (greedy.length < 2) return greedy
  let lo = 0
  let hi = maxWidth
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (wrapWords(measure, words, mid).length <= greedy.length) hi = mid
    else lo = mid
  }
  return wrapWords(measure, words, hi)
}

/** What `drawPage` needs per panel: the displayed version's decoded image
 *  and the panel fields the bubble is derived from. */
export type ExportPanel = {
  panel: Pick<Panel, 'index' | 'camera' | 'bubble' | 'dialogue'>
  image: { width: number; height: number; source: CanvasImageSource }
}

/** The drawing surface — satisfied by a real 2D context, and by the
 *  recording stub in `scripts/export-check.mts`. */
export type DrawContext = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'beginPath'
  | 'rect'
  | 'clip'
  | 'fillRect'
  | 'strokeRect'
  | 'drawImage'
  | 'ellipse'
  | 'fill'
  | 'stroke'
  | 'fillText'
  | 'strokeText'
  | 'measureText'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'lineJoin'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
>

export type DrawDeps = {
  /** `new Path2D(d)` in the browser; a recorder in the check. */
  makePath: (d: string) => Path2D
  /** The resolved Comic Neue family list for the canvas font string. */
  fontFamily: string
}

/** The cover's art (its displayed version, decoded), or null for no art. */
export type CoverImage = { width: number; height: number; source: CanvasImageSource } | null

/** Composite the page: paper, ink frame, each panel's art behind its border,
 *  then each bubble — ellipse, tail, lettering — exactly as the screen lays
 *  them out, clipped to the panel the way `overflow: hidden` clips it. */
export function drawPage(ctx: DrawContext, geom: PageGeometry, panels: ExportPanel[], deps: DrawDeps): void {
  ctx.fillStyle = WHITE
  ctx.fillRect(0, 0, geom.width, geom.height)
  ctx.strokeStyle = INK
  ctx.lineWidth = geom.frame
  ctx.strokeRect(geom.frame / 2, geom.frame / 2, geom.width - geom.frame, geom.height - geom.frame)

  for (const { panel, image } of panels) {
    const slot = geom.panels[panel.index]

    ctx.save()
    ctx.beginPath()
    ctx.rect(slot.x, slot.y, slot.w, slot.h)
    ctx.clip()

    ctx.fillStyle = WHITE
    ctx.fillRect(slot.x, slot.y, slot.w, slot.h)
    const fit = containRect(image, slot)
    ctx.drawImage(image.source, fit.x, fit.y, fit.w, fit.h)

    // The bubble: white fill, ink line, the tail's fill covering the rim
    // where it joins — the same paint order as the SVG.
    const l = bubbleLayout(panel)
    const b = bubbleRect(l, slot)
    ctx.fillStyle = WHITE
    ctx.strokeStyle = INK
    ctx.lineWidth = geom.stroke
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    const tail = deps.makePath(stretchPath(tailPath(l), slot))
    ctx.fill(tail)
    ctx.stroke(tail)

    // Lettering inside the bubble's text box (the wrap's 11% / 14% insets),
    // centred, clipped the way the screen's `overflow: hidden` clips it.
    const box = { x: b.x + b.w * 0.14, y: b.y + b.h * 0.11, w: b.w * 0.72, h: b.h * 0.78 }
    ctx.save()
    ctx.beginPath()
    ctx.rect(box.x, box.y, box.w, box.h)
    ctx.clip()
    ctx.fillStyle = INK
    ctx.font = `700 ${Math.round(geom.fontSize)}px ${deps.fontFamily}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const lines = wrapDialogue((t) => ctx.measureText(t).width, panel.dialogue, box.w)
    const lineHeight = geom.fontSize * 1.15
    const firstY = box.y + box.h / 2 - ((lines.length - 1) * lineHeight) / 2
    lines.forEach((line, i) => ctx.fillText(line, box.x + box.w / 2, firstY + i * lineHeight))
    ctx.restore()

    ctx.restore()

    // The panel's own ink border sits over the art, like the CSS border.
    ctx.strokeStyle = INK
    ctx.lineWidth = geom.stroke
    ctx.strokeRect(slot.x + geom.stroke / 2, slot.y + geom.stroke / 2, slot.w - geom.stroke, slot.h - geom.stroke)
  }
}

/**
 * Composite the cover: paper, the art filling the 2:3 frame the way
 * `object-fit: cover` does, then the title the app letters over it — white
 * Cormorant Garamond with a heavy ink outline painted *under* the fill
 * (`paint-order: stroke fill`), balanced across its lines, centred from 5%
 * down. The title is never in the art: the model never saw it.
 */
export function drawCover(ctx: DrawContext, geom: CoverGeometry, image: CoverImage, title: string, headingFamily: string): void {
  const frame = { x: 0, y: 0, w: geom.width, h: geom.height }
  ctx.fillStyle = WHITE
  ctx.fillRect(0, 0, geom.width, geom.height)
  if (image) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(frame.x, frame.y, frame.w, frame.h)
    ctx.clip()
    const fit = coverRect(image, frame)
    ctx.drawImage(image.source, fit.x, fit.y, fit.w, fit.h)
    ctx.restore()
  }

  const t = geom.title
  const text = title.trim()
  if (text) {
    ctx.font = `600 ${Math.round(t.fontSize)}px ${headingFamily}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    const lines = balanceTitle((s) => ctx.measureText(s).width, text, geom.width - 2 * t.padX)
    lines.forEach((line, i) => {
      const y = t.top + (i + 0.5) * t.lineHeight
      // With art, white letters on an ink outline; on bare paper, ink letters.
      if (image) {
        ctx.strokeStyle = INK
        ctx.lineWidth = t.stroke
        ctx.strokeText(line, geom.width / 2, y)
        ctx.fillStyle = WHITE
      } else {
        ctx.fillStyle = INK
      }
      ctx.fillText(line, geom.width / 2, y)
    })
  }

  ctx.strokeStyle = INK
  ctx.lineWidth = geom.frame
  ctx.strokeRect(geom.frame / 2, geom.frame / 2, geom.width - geom.frame, geom.height - geom.frame)
}

/** A filename from the chapter title: `the-offer….png`, `…-page-2.png`,
 *  `….pdf`. Safe on every OS and never empty. */
export function exportFilename(title: string, part?: string, ext: 'png' | 'pdf' = 'png'): string {
  // NFKD splits an accent off its letter; the mark is dropped, not hyphenated
  // ("Café" → "cafe"), and the edges are trimmed after the cut so a part
  // never follows a dangling hyphen.
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '')
  const base = slug || (ext === 'pdf' ? 'ink-desk-chapter' : 'ink-desk-page')
  return `${base}${part ? `-${part}` : ''}.${ext}`
}

/** A PDF page's width in points: six inches, so the 2:3 cover is a 6 × 9 in
 *  trade-paperback cover and every page keeps its own proportions under it. */
export const PDF_PAGE_WIDTH_PT = 432

/** The JPEG quality of a page inside the PDF — high enough that the
 *  lettering's edges stay clean at print size. */
export const PDF_JPEG_QUALITY = 0.92

/** One composited page, ready for the PDF: its encoded bytes and pixel size. */
export type PdfPage = { bytes: Uint8Array; type: 'jpeg' | 'png'; width: number; height: number }

/**
 * The chapter's PDF from its composited pages, in reading order — one PDF
 * page per image, `PDF_PAGE_WIDTH_PT` wide, as tall as the image's own
 * proportions. A right-to-left chapter says so in the viewer preferences, so
 * a reader that honours them pages it the manga way. Pure: the check runs it
 * in Node and reads the file back.
 */
export async function buildPdf(pages: PdfPage[], opts: { title: string; rtl: boolean }): Promise<Uint8Array> {
  if (pages.length === 0) throw new ExportError('There’s no finished page to put in the PDF yet.')
  const { PDFDocument, ReadingDirection } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.setTitle(opts.title)
  doc.setCreator('Ink Desk')
  doc.setProducer('Ink Desk')
  if (opts.rtl) doc.catalog.getOrCreateViewerPreferences().setReadingDirection(ReadingDirection.R2L)
  for (const p of pages) {
    const image = p.type === 'jpeg' ? await doc.embedJpg(p.bytes) : await doc.embedPng(p.bytes)
    const w = PDF_PAGE_WIDTH_PT
    const h = (w * p.height) / p.width
    doc.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h })
  }
  return await doc.save()
}

// --- Browser-only from here down -------------------------------------------

/** A `next/font` family list, resolved from the CSS variable it sets on
 *  `<html>` — the canvas font string needs real family names. */
function fontVar(name: '--font-letter' | '--font-heading', fallback: string): string {
  const family = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return family || fallback
}

/**
 * The face must be in before anything is drawn — a canvas falls back
 * silently, the one way the export could not match the screen. Each family in
 * the stack loads separately with its failure tolerated: next/font's
 * synthesized fallback points at local faces the OS may not have, and that
 * rejection must not kill the export (it did, as "A network error occurred",
 * on Linux — the face itself was already on screen the whole time).
 */
async function loadFont(weight: number, px: number, family: string): Promise<void> {
  const spec = (f: string) => `${weight} ${Math.round(px)}px ${f}`
  await Promise.allSettled(family.split(',').map((f) => document.fonts.load(spec(f.trim()), 'AaBb')))
  await document.fonts.ready
}

/** One stored image, decoded. `what` names it in the sentence if it can't be read.
 *  Asked for under its project's address (slice 19), same-origin, so the
 *  session cookie rides along; a lapsed session goes to sign-in. */
async function decode(projectId: string, imageId: string, what: string): Promise<ImageBitmap> {
  const res = await apiFetch(imageUrl(projectId, imageId))
  if (!res.ok) throw new ExportError(`${what} couldn’t be read from the desk.`)
  return await createImageBitmap(await res.blob())
}

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width)
  canvas.height = Math.round(height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ExportError('The page couldn’t be composited — this browser gave no canvas.')
  return { canvas, ctx }
}

function encode(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg' = 'image/png', quality?: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ExportError('The page couldn’t be encoded.'))),
      type,
      quality
    )
  })
}

/**
 * One page composited onto a canvas: fetch each displayed version's bytes,
 * load Comic Neue, draw. `page` names it in a sentence ("Page 2, panel 3…")
 * when the chapter has more than one.
 */
async function renderPage(projectId: string, panels: Panel[], direction: PageDirection, page?: number): Promise<HTMLCanvasElement> {
  const geom = pageGeometry(EXPORT_WIDTH, direction)
  const where = (i: number) => (page === undefined ? `Panel ${i + 1}` : `Page ${page + 1}, panel ${i + 1}`)

  const images = await Promise.all(
    panels.map(async (panel) => {
      // The displayed version — the one on the page — never blindly the newest.
      const id = currentImageId(panel)
      if (!id) throw new ExportError(`${where(panel.index)} has no art to export yet.`)
      const bitmap = await decode(projectId, id, `${where(panel.index)}’s art`)
      return { panel, image: { width: bitmap.width, height: bitmap.height, source: bitmap } }
    })
  )

  const fontFamily = fontVar('--font-letter', "'Comic Neue', cursive")
  await loadFont(700, geom.fontSize, fontFamily)

  const { canvas, ctx } = canvasOf(geom.width, geom.height)
  drawPage(ctx, geom, images, { makePath: (d) => new Path2D(d), fontFamily })
  for (const { image } of images) image.source.close()
  return canvas
}

/** The cover composited onto a canvas, its title lettered in Cormorant Garamond. */
async function renderCover(projectId: string, imageId: string | null, title: string): Promise<HTMLCanvasElement> {
  const geom = coverGeometry(EXPORT_WIDTH)
  const bitmap = imageId ? await decode(projectId, imageId, 'The cover’s art') : null
  const headingFamily = fontVar('--font-heading', "'Cormorant Garamond', Georgia, serif")
  await loadFont(600, geom.title.fontSize, headingFamily)
  const { canvas, ctx } = canvasOf(geom.width, geom.height)
  drawCover(ctx, geom, bitmap ? { width: bitmap.width, height: bitmap.height, source: bitmap } : null, title, headingFamily)
  bitmap?.close()
  return canvas
}

/** Build one page's PNG in the browser. */
export async function exportPng(projectId: string, panels: Panel[], direction: PageDirection, page?: number): Promise<Blob> {
  return await encode(await renderPage(projectId, panels, direction, page))
}

/** Build the cover's PNG in the browser. */
export async function exportCoverPng(projectId: string, imageId: string, title: string): Promise<Blob> {
  return await encode(await renderCover(projectId, imageId, title))
}

/**
 * The chapter's PDF, in the browser: the drawn cover, then every complete
 * page in reading order, each composited exactly as its PNG would be (art,
 * bubbles, lettering; current versions) and embedded at its own proportions.
 * One page at a time, each canvas released before the next, so a six-page
 * chapter never holds six full-size canvases at once.
 */
export async function exportPdf(projectId: string, entries: readonly ReaderEntry[], direction: PageDirection, title: string): Promise<Blob> {
  const pages: PdfPage[] = []
  for (const entry of entries) {
    const canvas =
      entry.kind === 'cover'
        ? entry.imageId
          ? await renderCover(projectId, entry.imageId, entry.title)
          : null
        : entry.complete
          ? await renderPage(projectId, entry.panels, direction, entry.index)
          : null
    if (!canvas) continue
    const bytes = new Uint8Array(await (await encode(canvas, 'image/jpeg', PDF_JPEG_QUALITY)).arrayBuffer())
    pages.push({ bytes, type: 'jpeg', width: canvas.width, height: canvas.height })
    canvas.width = 0
    canvas.height = 0
  }
  const bytes = await buildPdf(pages, { title, rtl: direction === 'rtl' })
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}

/** Hand the blob to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // Revoked on the next turn: a large PDF's download may not have started yet.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

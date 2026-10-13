// The reader's PNG export: the same page the screen shows — each panel's
// *displayed* version, the bubbles exactly as placed, Comic Neue lettering —
// composited onto an off-screen canvas and saved with `toBlob()`. No server
// round trip, no extra dependency.
//
// Split on purpose: `pageGeometry` and `drawPage` are pure and take the
// canvas as an argument, so `npm run check:export` can run the real
// compositing code in Node against a recording context and assert what the
// PNG will contain. Only `exportPng` touches the DOM (fetching bytes,
// loading the font, the canvas itself).
// See `devpost/spec.md > Components > Reader Station` and `> The Page Layout`.
import { bubbleLayout, tailPath } from './bubble'
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
 *  two 1:1 squares, a 3:2 wide panel, with equal gutters all round. */
export function pageGeometry(width = EXPORT_WIDTH, rtl = false): PageGeometry {
  const scale = width / NOMINAL
  const padding = 14 * scale
  const gap = 14 * scale
  const inner = width - 2 * padding
  const wideH = inner / (3 / 2)
  const square = (inner - gap) / 2
  const midY = padding + wideH + gap
  const leftX = padding
  const rightX = padding + square + gap
  return {
    width,
    height: midY + square + gap + wideH + padding,
    scale,
    padding,
    gap,
    frame: 2 * scale,
    stroke: 2 * scale,
    fontSize: 17 * scale,
    panels: [
      { x: padding, y: padding, w: inner, h: wideH },
      { x: rtl ? rightX : leftX, y: midY, w: square, h: square },
      { x: rtl ? leftX : rightX, y: midY, w: square, h: square },
      { x: padding, y: midY + square + gap, w: inner, h: wideH },
    ],
  }
}

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

/** Greedy word wrap with the context's own measurements — the same lines the
 *  bubble shows, uppercased the way the CSS `text-transform` does. */
export function wrapDialogue(measure: (text: string) => number, dialogue: string, maxWidth: number): string[] {
  const words = dialogue.trim().toUpperCase().split(/\s+/).filter(Boolean)
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

/** A filename from the chapter title: `ink-desk — the-offer….png`. */
export function exportFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || 'ink-desk-page'}.png`
}

// --- Browser-only from here down -------------------------------------------

/** The generated Comic Neue family, resolved from the CSS variable
 *  `next/font` sets — the canvas font string needs real family names. */
function letteringFamily(): string {
  const family = getComputedStyle(document.body).getPropertyValue('--font-letter').trim()
  return family || "'Comic Neue', cursive"
}

/**
 * Build the page PNG in the browser: fetch each displayed version's bytes,
 * make sure Comic Neue is loaded *before* anything is drawn (a canvas falls
 * back silently — the one way the export could not match the screen), then
 * composite and encode.
 */
export async function exportPng(panels: Panel[], rtl: boolean): Promise<Blob> {
  const geom = pageGeometry(EXPORT_WIDTH, rtl)

  const images = await Promise.all(
    panels.map(async (panel) => {
      // The displayed version — the one on the page — never blindly the newest.
      const id = currentImageId(panel)
      if (!id) throw new ExportError(`Panel ${panel.index + 1} has no art to export yet.`)
      const res = await fetch(`/api/image/${id}`)
      if (!res.ok) throw new ExportError(`Panel ${panel.index + 1}’s art couldn’t be read from the desk.`)
      const bitmap = await createImageBitmap(await res.blob())
      return { panel, image: { width: bitmap.width, height: bitmap.height, source: bitmap } }
    })
  )

  // Comic Neue must be in before anything is drawn — a canvas falls back
  // silently. Each family in the stack loads separately with its failure
  // tolerated: next/font's synthesized fallback points at local faces the OS
  // may not have, and that rejection must not kill the export (it did, as
  // "A network error occurred", on Linux — the lettering face itself was
  // already on screen the whole time).
  const fontFamily = letteringFamily()
  const spec = (family: string) => `700 ${Math.round(geom.fontSize)}px ${family}`
  await Promise.allSettled(fontFamily.split(',').map((f) => document.fonts.load(spec(f.trim()), 'AaBb')))
  await document.fonts.ready

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(geom.width)
  canvas.height = Math.round(geom.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ExportError('The page couldn’t be composited — this browser gave no canvas.')
  drawPage(ctx, geom, images, { makePath: (d) => new Path2D(d), fontFamily })

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ExportError('The PNG couldn’t be encoded.'))), 'image/png')
  })
}

/** Hand the blob to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// The trailer's opening card (v3, slice 22): the project's title and the page's
// number on the studio's paper, lettered in the brand's own faces — Cormorant
// Garamond for the title, Lora for the page, the hanko red only for the small
// seal and rule, as everywhere else in the app (`video/src/theme.ts`, the same
// values as `app/globals.css`). One still 1280 x 720 PNG; `assemble.ts` holds it
// for `introSeconds` and the whole picture fades in from paper over its first
// quarter second.
//
// The fonts are the OFL files in `video/public/fonts`, passed to Pango by path, so
// the card looks the same on every machine and never depends on a system face.
//
// Server only (sharp, the font files).
import 'server-only'
import { existsSync } from 'node:fs'
import sharp, { type OverlayOptions } from 'sharp'
import { brandFile, INK } from './bubbles'
import { TRAILER_HEIGHT, TRAILER_WIDTH } from './types'

export const PAPER = '#f3f2f2'
export const HANKO = '#b5382e'

const TITLE_MAX_WIDTH = 1000
const TITLE_MAX_HEIGHT = 250
const TITLE_START_SIZE = 104
const TITLE_MIN_SIZE = 44
const MARK = 60

const escapeMarkup = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function text(markup: string, font: string, fontFile: string, width: number, spacing = 0): Promise<{ png: Buffer; width: number; height: number }> {
  const png = await sharp({ text: { text: markup, font, fontfile: fontFile, width, align: 'centre', rgba: true, wrap: 'word-char', spacing } }).png().toBuffer()
  const meta = await sharp(png).metadata()
  return { png, width: meta.width ?? 0, height: meta.height ?? 0 }
}

/** The title at the biggest size (down to a floor) at which it sits in at most three even lines inside its box. */
async function letterTitle(title: string) {
  const file = brandFile('fonts', 'CormorantGaramond.ttf')
  let size = TITLE_START_SIZE
  for (;;) {
    const lettered = await text(`<span foreground="${INK}">${escapeMarkup(title)}</span>`, `Cormorant Garamond SemiBold ${size}`, file, TITLE_MAX_WIDTH, -Math.round(size * 0.08))
    if (lettered.height <= TITLE_MAX_HEIGHT || size <= TITLE_MIN_SIZE) return lettered
    size = Math.max(TITLE_MIN_SIZE, size - 6)
  }
}

/**
 * The card: [seal] / title / short hanko rule / "PAGE N", centred on paper.
 * `page` is the zero-based page index, as `TrailerPlan.page` and `Desk.openPage`
 * have it; the card letters it as a person counts (page 0 reads "Page 1").
 */
export async function renderTitleCard(input: { title: string; page: number }): Promise<Buffer> {
  const title = input.title.replace(/\s+/g, ' ').trim() || 'Untitled'
  const lettered = await letterTitle(title)
  const pageLabel = `PAGE ${Math.max(0, Math.floor(input.page)) + 1}`
  const page = await text(
    `<span foreground="${INK}" letter_spacing="4096">${escapeMarkup(pageLabel)}</span>`,
    'Lora Medium 30',
    brandFile('fonts', 'Lora.ttf'),
    600,
  )

  // The brand's seal (the hanko-red mark), when its file is there; a missing seal never stops a trailer.
  let mark: Buffer | null = null
  const markFile = brandFile('brand', 'inkdesk-mark.svg')
  if (existsSync(markFile)) mark = await sharp(markFile, { density: 192 }).resize(MARK, MARK).png().toBuffer()

  const GAP_MARK = 44
  const GAP_RULE = 34
  const GAP_PAGE = 30
  const RULE_W = 84
  const RULE_H = 4
  const markBlock = mark ? MARK + GAP_MARK : 0
  const total = markBlock + lettered.height + GAP_RULE + RULE_H + GAP_PAGE + page.height
  // Optical centre: a touch above the middle.
  let y = Math.round((TRAILER_HEIGHT - total) / 2) - 14
  const cx = TRAILER_WIDTH / 2
  const layers: OverlayOptions[] = []
  if (mark) {
    layers.push({ input: mark, left: Math.round(cx - MARK / 2), top: y })
    y += markBlock
  }
  layers.push({ input: lettered.png, left: Math.round(cx - lettered.width / 2), top: y })
  y += lettered.height + GAP_RULE
  const rule = await sharp({ create: { width: RULE_W, height: RULE_H, channels: 3, background: HANKO } }).png().toBuffer()
  layers.push({ input: rule, left: Math.round(cx - RULE_W / 2), top: y })
  y += RULE_H + GAP_PAGE
  layers.push({ input: page.png, left: Math.round(cx - page.width / 2), top: y })

  return sharp({ create: { width: TRAILER_WIDTH, height: TRAILER_HEIGHT, channels: 3, background: PAPER } })
    .composite(layers)
    .png()
    .toBuffer()
}

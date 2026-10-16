// The chapter as the reader reads it (v2, slice 12): the cover first, then
// every page in order — a complete page with its art, an incomplete one as a
// pencil placeholder with its number. Pure and shared with the browser: the
// reader station, the rail's gate and the PDF export all walk the same
// sequence, so what you read is what you export.
// See `devpost/spec.md > Reader and Exports (v2)` and
// `devpost/prd.md > Reader (v2) — The Chapter`.
import { currentCoverImageId } from './plan'
import { stylePreset } from './styles'
import type { Desk, Panel } from './types'

/** How a page is laid out: the four-shot page either way round, or one column. */
export type PageDirection = 'ltr' | 'rtl' | 'vertical'

export type ReaderEntry =
  | { kind: 'cover'; title: string; imageId: string | null }
  | { kind: 'page'; index: number; panels: Panel[]; complete: boolean; inked: number }

/** A page reads once all four panels have art. A redraw in flight keeps its
 *  current art on screen, so it never takes a page back out of the reader. */
export function isPageComplete(panels: readonly Panel[]): boolean {
  return panels.length === 4 && panels.every((p) => p.versions.length > 0)
}

/**
 * Every page's panels, in page order. The open page comes from `script`, the
 * copy the browser edits — fresher than the server's derived list between a
 * keystroke and its save, and the only one a hand-built desk has.
 */
export function chapterPages(d: Pick<Desk, 'chapterPanels' | 'script' | 'address'>): Panel[][] {
  const pages = d.chapterPanels.length > 0 ? [...d.chapterPanels] : [[]]
  const open = d.address.pageIndex
  if (open >= 0 && open < pages.length) pages[open] = d.script ?? []
  return pages
}

/** The indices of the pages that read, in order. */
export function completePageIndices(d: Pick<Desk, 'chapterPanels' | 'script' | 'address'>): number[] {
  return chapterPages(d).flatMap((panels, i) => (isPageComplete(panels) ? [i] : []))
}

/** The title the chapter is published under: the lettered cover title first. */
export function chapterTitle(d: Pick<Desk, 'cover' | 'synopsis' | 'title'>): string {
  return d.cover?.title.trim() || d.synopsis?.title.trim() || d.title.trim() || 'Untitled chapter'
}

/**
 * The reading sequence. The cover leads whenever the chapter has one — drawn,
 * or still a pencil with its title waiting; a project with no Director (the
 * migrated v1 desk) has none and opens on page 1.
 */
export function readerSequence(d: Pick<Desk, 'chapterPanels' | 'script' | 'address' | 'cover' | 'synopsis' | 'title'>): ReaderEntry[] {
  const entries: ReaderEntry[] = []
  if (d.cover) entries.push({ kind: 'cover', title: d.cover.title.trim(), imageId: currentCoverImageId(d.cover) })
  chapterPages(d).forEach((panels, index) => {
    entries.push({
      kind: 'page',
      index,
      panels,
      complete: isPageComplete(panels),
      inked: panels.filter((p) => p.versions.length > 0).length,
    })
  })
  return entries
}

/** An entry with something to read and export: a drawn cover, a complete page. */
export function isReadable(e: ReaderEntry): boolean {
  return e.kind === 'cover' ? e.imageId !== null : e.complete
}

/** Where the reader opens: the cover if it is drawn, else the first complete page. */
export function firstReadable(entries: readonly ReaderEntry[]): number {
  return Math.max(0, entries.findIndex(isReadable))
}

/** What goes into the PDF, in order: the drawn cover, then every complete page. */
export function publishable(entries: readonly ReaderEntry[]): ReaderEntry[] {
  return entries.filter(isReadable)
}

/** The project's reading order, from its locked style. */
export function readingMode(stylePresetId: string): 'paged-rtl' | 'vertical' {
  return stylePreset(stylePresetId).reading
}

/** Where a key press is not a page turn: typing in a field, or anything inside a modal dialog (Share, Report), which owns the keyboard while it is open. */
export const TURN_KEYS_IGNORED_IN = 'input, textarea, [contenteditable="true"], [role="dialog"], [aria-modal="true"]'

/**
 * The page an arrow key turns to, or null when it turns nothing. In manga order "next" is the left-hand side. A shortcut
 * (Alt, Ctrl, Meta, Shift), a key pressed in a field or a modal dialog, and any key while a modal is open (`modalOpen`) are left alone. The index stays within the pages.
 */
export function turnKeyIndex(
  e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; target: { closest(selector: string): unknown } | null; modalOpen?: boolean },
  rtl: boolean,
  at: number,
  count: number
): number | null {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null
  if (e.target?.closest(TURN_KEYS_IGNORED_IN)) return null
  // A click on a dialog's plain text drops focus to the body, outside the dialog: the open modal still owns the keys.
  if (e.modalOpen) return null
  const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
  const back = rtl ? 'ArrowRight' : 'ArrowLeft'
  if (e.key === forward) return Math.min(Math.max(0, at + 1), count - 1)
  if (e.key === back) return Math.min(Math.max(0, at - 1), count - 1)
  return null
}

'use client'

// Station 5 — Ink & Publish: the chapter, read (v2, slice 12). The cover
// first, its title lettered by the app, then every page in order — a complete
// page with its art and bubbles, an unfinished one as a pencil placeholder
// with its number. How it reads comes from the project's locked style:
//
//   • Manga presets read as pages, right to left by default (the v1 toggle
//     flips it): one page at a time, turned with the buttons, the page strip
//     or the arrow keys — the "next" side is the left in manga order — and
//     each page replays the ink-in as you turn to it.
//   • Manhwa presets read as one vertical scroll: every page stacked in a
//     single column, each inking in as it scrolls into view.
//
// Export PNG composites one page (or the cover); Export PDF the whole
// chapter — the drawn cover and every complete page, current versions, the
// bubbles and the title composited — through `lib/export.ts`. The bubbles
// here are read-only, exactly as placed on the Page station.
// Implements `devpost/prd.md > Reader (v2) — The Chapter` and
// `> Export (v2) — PNG and PDF`; see `devpost/spec.md > Reader and Exports (v2)`.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { PencilPlaceholder } from '@/components/PencilPlaceholder'
import { bubbleLayout, tailPath } from '@/lib/bubble'
import { downloadBlob, ExportError, exportCoverPng, exportFilename, exportPdf, exportPng } from '@/lib/export'
import { PANEL_LAYOUT } from '@/lib/prompts'
import {
  chapterTitle,
  firstReadable,
  isReadable,
  publishable,
  readerSequence,
  readingMode,
  type PageDirection,
  type ReaderEntry,
} from '@/lib/reader'
import { currentImageId } from '@/lib/script'
import type { Chapter, Character, Panel } from '@/lib/types'

/** The reveal's clock, tuned to read well on camera: a beat before the first
 *  panel, each panel starting as the previous wipe lands, the bubble arriving
 *  as its panel's ink dries. */
const REVEAL_FIRST_S = 0.45
const REVEAL_STEP_S = 1.15
const BUBBLE_LAG_S = 1.0

type Props = {
  chapter: Chapter
  onGoStoryboard: () => void
  /** The door to the desk (v2): a new project starts there; this one is never cleared. */
  onNewProject: () => void
}

/** What an export is doing right now: the PDF, or one entry's PNG. */
type Exporting = 'pdf' | `png:${number}` | null

export function ReaderStation({ chapter, onGoStoryboard, onNewProject }: Props) {
  const mode = readingMode(chapter.stylePresetId)
  const vertical = mode === 'vertical'
  // Manga reads right to left; the toggle is v1's, kept for a left-to-right read.
  const [rtl, setRtl] = useState(true)
  const direction: PageDirection = vertical ? 'vertical' : rtl ? 'rtl' : 'ltr'

  const entries = readerSequence(chapter)
  const [pos, setPos] = useState(() => firstReadable(readerSequence(chapter)))
  const at = Math.min(pos, entries.length - 1)
  // Remounting a page restarts every reveal animation on it.
  const [playKey, setPlayKey] = useState(0)
  // Vertical scroll: the furthest entry that has come into view. Everything
  // above it has been passed, so it inks in too — a jump (End, a link) never
  // leaves a page above you waiting.
  const [reached, setReached] = useState(-1)
  const [exporting, setExporting] = useState<Exporting>(null)
  /** The last failed export's sentence, and which export it was — in the
   *  vertical scroll it shows under the button that was pressed. */
  const [notice, setNotice] = useState<{ text: string; for: Exporting } | null>(null)

  const title = chapterTitle(chapter)
  const toPublish = publishable(entries)
  const pages = entries.filter((e) => e.kind === 'page')
  const complete = pages.filter((e) => e.kind === 'page' && e.complete).length
  const cover = entries.find((e) => e.kind === 'cover') ?? null

  const run = async (what: Exporting, make: () => Promise<{ blob: Blob; filename: string }>) => {
    setExporting(what)
    setNotice(null)
    try {
      const { blob, filename } = await make()
      downloadBlob(blob, filename)
    } catch (err) {
      // Only our own sentences reach the screen — never a raw browser error.
      console.warn('[export]', err)
      setNotice({
        text: err instanceof ExportError ? err.message : 'The chapter couldn’t be exported just now. Try again in a moment.',
        for: what,
      })
    } finally {
      setExporting(null)
    }
  }

  const exportEntry = (i: number) => {
    const e = entries[i]
    if (!e || !isReadable(e)) return
    void run(`png:${i}`, async () =>
      e.kind === 'cover'
        ? { blob: await exportCoverPng(e.imageId as string, e.title), filename: exportFilename(title, 'cover') }
        : {
            blob: await exportPng(e.panels, direction, pages.length > 1 ? e.index : undefined),
            filename: exportFilename(title, pages.length > 1 || cover ? `page-${e.index + 1}` : undefined),
          }
    )
  }

  const exportChapter = () =>
    void run('pdf', async () => ({
      blob: await exportPdf(entries, direction, title),
      filename: exportFilename(title, undefined, 'pdf'),
    }))

  // Turning pages: in manga order "next" is the left-hand side.
  const count = entries.length
  useEffect(() => {
    if (vertical) return
    const go = (i: number) => setPos(Math.min(Math.max(0, i), count - 1))
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
      const back = rtl ? 'ArrowRight' : 'ArrowLeft'
      if (e.key === forward) go(at + 1)
      else if (e.key === back) go(at - 1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vertical, rtl, at, count])
  const go = (i: number) => setPos(Math.min(Math.max(0, i), count - 1))

  const current = entries[at]
  const busy = exporting !== null

  return (
    <main className="station">
      <div className="station-inner is-wide reader">
        <div className="station-head">
          <div className="eyebrow">Station 5 · The reader</div>
          <h1 className="station-title">{title}</h1>
          <p className="station-lede">
            {vertical
              ? 'The chapter as one vertical scroll, cover first — each page inks in as it scrolls into view. Export a page as a PNG, or the whole chapter as one PDF.'
              : 'The chapter page by page, cover first — each page inks in as you turn to it. It reads right to left like a manga; flip it if you like. Export a page as a PNG, or the whole chapter as one PDF.'}
          </p>
        </div>

        <div className="reader-controls">
          {vertical ? (
            <div className="chip-row" aria-label="Reading order">
              <span className="chip is-selected" title="Manhwa reads as one vertical scroll, top to bottom.">
                ↓ Vertical scroll
              </span>
            </div>
          ) : (
            <div className="chip-row" role="radiogroup" aria-label="Reading order">
              <button
                type="button"
                role="radio"
                aria-checked={rtl}
                className={`chip${rtl ? ' is-selected' : ''}`}
                title="Manga reading order — pages turn to the left, the middle panels read from the right."
                onClick={() => setRtl(true)}
              >
                ← Right to left
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={!rtl}
                className={`chip${!rtl ? ' is-selected' : ''}`}
                onClick={() => setRtl(false)}
              >
                Left to right →
              </button>
            </div>
          )}
          <div className="reader-actions">
            <button
              type="button"
              className="btn btn-secondary"
              title={vertical ? 'Watch the chapter ink in again as you scroll.' : 'Watch this page ink in again, panel by panel.'}
              onClick={() => {
                setReached(-1)
                setPlayKey((k) => k + 1)
              }}
            >
              Replay the ink-in
            </button>
            {!vertical && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy || !current || !isReadable(current)}
                title={
                  current && isReadable(current)
                    ? `One PNG of ${current.kind === 'cover' ? 'the cover, its title lettered' : `page ${current.index + 1}: every panel’s displayed version with your bubbles`}.`
                    : 'Only a finished page — or a drawn cover — exports.'
                }
                onClick={() => exportEntry(at)}
              >
                {exporting === `png:${at}` ? 'Compositing…' : 'Export PNG'}
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || toPublish.length === 0}
              title={pdfHint(toPublish, entries)}
              onClick={exportChapter}
            >
              {exporting === 'pdf' ? 'Binding the PDF…' : 'Export PDF'}
            </button>
          </div>
        </div>

        {vertical ? (
          <div className="reader-sheet is-vertical">
            <div className="read-arrow" aria-hidden="true">
              read top to bottom ↓
            </div>
            {entries.map((e, i) => (
              <ScrollEntry
                key={`${i}-${playKey}`}
                label={entryLabel(e)}
                reached={reached >= i}
                onReach={() => setReached((r) => Math.max(r, i))}
              >
                {(playing) => (
                  <>
                    <div className="reader-page-head">
                      <span className="reader-page-label">{entryLabel(e)}</span>
                      {isReadable(e) && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => exportEntry(i)}
                        >
                          {exporting === `png:${i}` ? 'Compositing…' : 'Export PNG'}
                        </button>
                      )}
                    </div>
                    {notice?.for === `png:${i}` && (
                      <div className="notice" role="alert">
                        {notice.text}
                      </div>
                    )}
                    <EntryView entry={e} cast={chapter.cast} direction={direction} playing={playing} />
                  </>
                )}
              </ScrollEntry>
            ))}
          </div>
        ) : (
          <div className="reader-sheet">
            <nav className={`reader-nav${rtl ? ' is-rtl' : ''}`} aria-label="Pages">
              <button
                type="button"
                className="btn btn-secondary btn-sm reader-turn"
                disabled={at === 0}
                onClick={() => go(at - 1)}
              >
                {rtl ? 'Previous →' : '← Previous'}
              </button>
              <ol className="reader-strip">
                {entries.map((e, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className={`reader-tab${i === at ? ' is-active' : ''}${isReadable(e) ? '' : ' is-pencil'}`}
                      aria-current={i === at ? 'page' : undefined}
                      title={isReadable(e) ? entryLabel(e) : `${entryLabel(e)} — not inked yet`}
                      onClick={() => go(i)}
                    >
                      {e.kind === 'cover' ? 'Cover' : e.index + 1}
                    </button>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                className="btn btn-secondary btn-sm reader-turn"
                disabled={at >= entries.length - 1}
                onClick={() => go(at + 1)}
              >
                {rtl ? '← Next' : 'Next →'}
              </button>
            </nav>
            {current?.kind === 'page' && current.complete && (
              <div className="read-arrow" aria-hidden="true">
                {rtl ? '⟵ read right to left' : 'read left to right ⟶'}
              </div>
            )}
            {current && (
              <EntryView key={`${at}-${playKey}`} entry={current} cast={chapter.cast} direction={direction} playing />
            )}
          </div>
        )}

        {notice && !(vertical && notice.for !== 'pdf') && (
          <div className="notice" role="alert">
            {notice.text}
          </div>
        )}

        <div className="station-footer">
          <div className="station-footer-status">
            <span className="footer-progress">
              {complete} of {pages.length} {pages.length === 1 ? 'page' : 'pages'} inked
              {cover ? (cover.kind === 'cover' && cover.imageId ? ' · cover drawn' : ' · no cover yet') : ''}
            </span>
            <span className="helper">
              Exports land in your downloads. The PDF holds the drawn cover and every finished page — unfinished
              pages stay out until they are inked.
            </span>
          </div>
          <div className="reader-actions">
            <button type="button" className="btn btn-secondary" onClick={onGoStoryboard}>
              ← Back to the pages
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              title="Back to the desk to start another project — nothing here is cleared."
              onClick={onNewProject}
            >
              New project…
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}

function entryLabel(e: ReaderEntry): string {
  return e.kind === 'cover' ? 'The cover' : `Page ${e.index + 1}`
}

/** What the PDF button says it will bind — and what stays out. */
function pdfHint(toPublish: readonly ReaderEntry[], entries: readonly ReaderEntry[]): string {
  if (toPublish.length === 0) return 'Ink a page first.'
  const pages = toPublish.filter((e) => e.kind === 'page').length
  const cover = toPublish.some((e) => e.kind === 'cover')
  const pencil = entries.flatMap((e) => (e.kind === 'page' && !e.complete ? [e.index + 1] : []))
  const noCover = entries.some((e) => e.kind === 'cover' && !e.imageId)
  const out = [
    ...(noCover ? ['the cover isn’t drawn yet'] : []),
    ...(pencil.length ? [`page${pencil.length > 1 ? 's' : ''} ${pencil.join(', ')} stay${pencil.length > 1 ? '' : 's'} out until inked`] : []),
  ]
  return `One PDF: ${cover ? 'the cover and ' : ''}${pages} finished ${pages === 1 ? 'page' : 'pages'}, bubbles and lettering composited${out.length ? ` — ${out.join('; ')}` : ''}.`
}

/**
 * One entry of the vertical scroll: it waits, art hidden, until it scrolls
 * into view — or a later entry does — then plays its ink-in once. No
 * IntersectionObserver (an old browser) → it plays at once.
 */
function ScrollEntry({
  label,
  reached,
  onReach,
  children,
}: {
  label: string
  reached: boolean
  onReach: () => void
  children: (playing: boolean) => ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  const reach = useRef(onReach)
  useEffect(() => {
    reach.current = onReach
  })
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (records) => {
        if (records.some((r) => r.isIntersecting)) {
          setSeen(true)
          reach.current()
          io.disconnect()
        }
      },
      // Any part of the entry inside the top 80% of the viewport — not a
      // share of its area: a page can be many screens tall on a phone.
      { threshold: 0, rootMargin: '0px 0px -20% 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} className="reader-scroll-entry" aria-label={label} role="group">
      {children(seen || reached)}
    </div>
  )
}

function EntryView({
  entry,
  cast,
  direction,
  playing,
}: {
  entry: ReaderEntry
  cast: Character[]
  direction: PageDirection
  playing: boolean
}) {
  if (entry.kind === 'cover') return <ReaderCover title={entry.title} imageId={entry.imageId} playing={playing} />
  if (!entry.complete) return <PencilPage index={entry.index} inked={entry.inked} direction={direction} />
  return <ReaderPage index={entry.index} panels={entry.panels} cast={cast} direction={direction} playing={playing} />
}

const directionClass = (d: PageDirection) => (d === 'rtl' ? ' is-rtl' : d === 'vertical' ? ' is-vertical' : '')

/** The cover as the reader shows it: the art, the title lettered over it. */
function ReaderCover({ title, imageId, playing }: { title: string; imageId: string | null; playing: boolean }) {
  return (
    <figure
      className={`cover-frame reader-cover${imageId ? ' is-inked' : ''}${playing ? '' : ' is-waiting'}`}
      data-entry="cover"
    >
      {imageId ? (
        // eslint-disable-next-line @next/next/no-img-element -- served by our own route as final bytes; the cover being read
        <img className="cover-art" src={`/api/image/${imageId}`} alt="The chapter’s cover" />
      ) : (
        <div className="cover-pencil sketch is-still">
          <span className="pencil-label">No cover yet — the Director draws it.</span>
        </div>
      )}
      {title && <h2 className="cover-title">{title}</h2>}
    </figure>
  )
}

/** A complete page, its ink-in replaying panel by panel. */
function ReaderPage({
  index,
  panels,
  cast,
  direction,
  playing,
}: {
  index: number
  panels: Panel[]
  cast: Character[]
  direction: PageDirection
  playing: boolean
}) {
  return (
    <section
      className={`page reader-page${directionClass(direction)}${playing ? '' : ' is-waiting'}`}
      aria-label={`Page ${index + 1}`}
      data-entry={`page-${index + 1}`}
    >
      {PANEL_LAYOUT.map((slot) => {
        const panel = panels[slot.index]
        const imageId = currentImageId(panel)
        const character = cast.find((c) => c.id === panel.characterId) ?? null
        const delay = REVEAL_FIRST_S + slot.index * REVEAL_STEP_S
        return (
          <figure
            key={slot.index}
            className={`panel panel-${slot.shape} reader-panel`}
            data-panel={slot.index}
            style={{ '--reveal-delay': `${delay}s`, '--bubble-delay': `${delay + BUBBLE_LAG_S}s` } as CSSProperties}
          >
            <PencilPlaceholder slot={slot} label="" still />
            {imageId && (
              // eslint-disable-next-line @next/next/no-img-element -- served by our own route as final bytes; the page being read
              <img
                className="panel-art reader-reveal"
                src={`/api/image/${imageId}`}
                alt={character ? `${character.name}, ${slot.shot}` : `Panel ${slot.index + 1}`}
              />
            )}
            <ReaderBubble panel={panel} />
            <span className="panel-num" aria-hidden="true">
              {slot.index + 1}
            </span>
            <figcaption className="sr-only">
              Panel {slot.index + 1}
              {character ? `, ${character.name}` : ''}, {slot.shot}. “{panel.dialogue}”
            </figcaption>
          </figure>
        )
      })}
    </section>
  )
}

/** An unfinished page: the four pencils, and its number. */
function PencilPage({ index, inked, direction }: { index: number; inked: number; direction: PageDirection }) {
  return (
    <section
      className={`page reader-page is-pencil${directionClass(direction)}`}
      aria-label={`Page ${index + 1}, not inked yet`}
      data-entry={`page-${index + 1}`}
    >
      {PANEL_LAYOUT.map((slot) => (
        <figure key={slot.index} className={`panel panel-${slot.shape}`}>
          <PencilPlaceholder slot={slot} label="" still />
        </figure>
      ))}
      <div className="reader-pencil-note">
        <span className="reader-pencil-num">Page {index + 1}</span>
        <span>
          {inked === 0 ? 'Not inked yet' : `${inked} of 4 panels inked`} — finish it on the Page station.
        </span>
      </div>
    </section>
  )
}

/** The bubble as the reader sees it: the same stored (or derived) layout and
 *  the same SVG shapes as the Storyboard, with the editing stripped away. */
function ReaderBubble({ panel }: { panel: Pick<Panel, 'index' | 'camera' | 'bubble' | 'dialogue'> }) {
  const l = bubbleLayout(panel)
  return (
    <div className="bubble-layer reader-bubble">
      <svg className="bubble-shape" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <ellipse cx={l.x + l.w / 2} cy={l.y + l.h / 2} rx={l.w / 2} ry={l.h / 2} />
        <path d={tailPath(l)} />
      </svg>
      <div
        className="bubble-static"
        style={{ left: `${l.x}%`, top: `${l.y}%`, width: `${l.w}%`, height: `${l.h}%` }}
      >
        <div className="bubble-text-wrap">
          <span className="bubble-text is-static">{panel.dialogue}</span>
        </div>
      </div>
    </div>
  )
}

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
import { useState } from 'react'
import { PencilPlaceholder } from '@/components/PencilPlaceholder'
import { useImageUrl } from '@/components/project-image'
import {
  directionClass,
  ReaderCover,
  ReaderNav,
  ReaderPage,
  ScrollEntry,
  useTurnKeys,
  type PanelView,
} from '@/components/ReaderParts'
import { ShareDialog } from '@/components/ShareDialog'
import { bubbleLayout } from '@/lib/bubble'
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

type Props = {
  chapter: Chapter
  onGoStoryboard: () => void
  /** The door to the desk (v2): a new project starts there; this one is never cleared. */
  onNewProject: () => void
  /** Settings › Defaults (v3): which way a manga opens. Absent means right to left, as it always did. */
  defaultReading?: 'rtl' | 'ltr'
}

/** What an export is doing right now: the PDF, or one entry's PNG. */
type Exporting = 'pdf' | `png:${number}` | null

export function ReaderStation({ chapter, onGoStoryboard, onNewProject, defaultReading = 'rtl' }: Props) {
  const mode = readingMode(chapter.stylePresetId)
  const projectId = chapter.address.projectId
  const vertical = mode === 'vertical'
  // Manga reads right to left unless the person's defaults say otherwise; the toggle is v1's, kept for a left-to-right read.
  const [rtl, setRtl] = useState(defaultReading === 'rtl')
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
  /** The Share dialog (v3, slice 21) is open. */
  const [sharing, setSharing] = useState(false)

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
        ? { blob: await exportCoverPng(projectId, e.imageId as string, e.title), filename: exportFilename(title, 'cover') }
        : {
            blob: await exportPng(projectId, e.panels, direction, pages.length > 1 ? e.index : undefined),
            filename: exportFilename(title, pages.length > 1 || cover ? `page-${e.index + 1}` : undefined),
          }
    )
  }

  const exportChapter = () =>
    void run('pdf', async () => ({
      blob: await exportPdf(projectId, entries, direction, title),
      filename: exportFilename(title, undefined, 'pdf'),
    }))

  // Turning pages: in manga order "next" is the left-hand side.
  const count = entries.length
  const go = (i: number) => setPos(Math.min(Math.max(0, i), count - 1))
  useTurnKeys({ enabled: !vertical && !sharing, rtl, at, count, go: setPos })

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
            <button
              type="button"
              className="btn btn-secondary btn-share"
              aria-haspopup="dialog"
              title="A public link to the cover and the finished pages, for anyone you give it to."
              onClick={() => setSharing(true)}
            >
              Share publicly…
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
            <ReaderNav
              rtl={rtl}
              at={at}
              go={go}
              tabs={entries.map((e) => ({
                label: e.kind === 'cover' ? 'Cover' : String(e.index + 1),
                title: isReadable(e) ? entryLabel(e) : `${entryLabel(e)} — not inked yet`,
                pencil: !isReadable(e),
              }))}
            />
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
      {sharing && <ShareDialog projectId={projectId} readable={toPublish.length > 0} onClose={() => setSharing(false)} />}
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
  const imageSrc = useImageUrl()
  if (entry.kind === 'cover') return <ReaderCover title={entry.title} imageId={entry.imageId} playing={playing} imageSrc={imageSrc} />
  if (!entry.complete) return <PencilPage index={entry.index} inked={entry.inked} direction={direction} />
  return <ReaderPage index={entry.index} panels={panelViews(entry.panels, cast)} direction={direction} playing={playing} imageSrc={imageSrc} />
}

/** A page's panels as the shared reader pieces read them: the current picture, the layout, and the words a screen reader gets. */
function panelViews(panels: readonly Panel[], cast: readonly Character[]): PanelView[] {
  return PANEL_LAYOUT.map((slot) => {
    const panel = panels[slot.index]
    const character = cast.find((c) => c.id === panel.characterId) ?? null
    return {
      imageId: currentImageId(panel),
      dialogue: panel.dialogue,
      layout: bubbleLayout(panel),
      alt: character ? `${character.name}, ${slot.shot}` : `Panel ${slot.index + 1}`,
      caption: `Panel ${slot.index + 1}${character ? `, ${character.name}` : ''}, ${slot.shot}. “${panel.dialogue}”`,
    }
  })
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

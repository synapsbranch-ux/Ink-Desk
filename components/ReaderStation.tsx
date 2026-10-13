'use client'

// Station 4 — Ink & Publish: the finished page, read full-size. Entering
// replays the ink-in reveal panel by panel in reading order (the shot that
// gets filmed), the right-to-left toggle swaps where the middle squares sit
// so the page reads in manga order, and Export PNG composites the displayed
// versions and the placed bubbles through `lib/export.ts`. The bubbles here
// are read-only — exactly as placed in the Storyboard; editing lives there.
// New chapter clears the desk behind a confirmation.
// Implements `devpost/prd.md > Ink & Publish — The Reader`; see
// `devpost/spec.md > Components > Reader Station`.
import { useState, type CSSProperties } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PencilPlaceholder } from '@/components/PencilPlaceholder'
import { bubbleLayout, tailPath } from '@/lib/bubble'
import { downloadBlob, ExportError, exportFilename, exportPng } from '@/lib/export'
import { PANEL_LAYOUT } from '@/lib/prompts'
import { currentImageId } from '@/lib/script'
import type { Chapter, Panel } from '@/lib/types'

/** The reveal's clock, tuned to read well on camera: a beat before the first
 *  panel, each panel starting as the previous wipe lands, the bubble arriving
 *  as its panel's ink dries. */
const REVEAL_FIRST_S = 0.45
const REVEAL_STEP_S = 1.15
const BUBBLE_LAG_S = 1.0

type Props = {
  chapter: Chapter
  onGoStoryboard: () => void
  /** The plain New-chapter clear — `DELETE /api/chapter` — after the dialog. */
  onNewChapter: () => Promise<void>
}

export function ReaderStation({ chapter, onGoStoryboard, onNewChapter }: Props) {
  const [rtl, setRtl] = useState(false)
  // Remounting the page section restarts every reveal animation.
  const [playKey, setPlayKey] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const script = chapter.script
  if (!script) return null
  const title = chapter.synopsis?.title.trim() || 'Untitled chapter'

  const exportPage = async () => {
    setExporting(true)
    setNotice(null)
    try {
      downloadBlob(await exportPng(script, rtl), exportFilename(title))
    } catch (err) {
      // Only our own sentences reach the screen — never a raw browser error.
      console.warn('[export]', err)
      setNotice(err instanceof ExportError ? err.message : 'The page couldn’t be exported just now. Try again in a moment.')
    } finally {
      setExporting(false)
    }
  }

  const clearDesk = async () => {
    setClearing(true)
    setNotice(null)
    try {
      await onNewChapter()
      // On success the station flips to Story and this unmounts.
    } catch {
      setNotice('The desk couldn’t be cleared. Is the dev server running?')
      setClearing(false)
      setConfirming(false)
    }
  }

  return (
    <main className="station">
      <div className="station-inner is-wide reader">
        <div className="station-head">
          <div className="eyebrow">Station 4 · The reader</div>
          <h1 className="station-title">{title}</h1>
          <p className="station-lede">
            The finished page, panel by panel. Flip the reading order, export the page as a PNG, or go back to the
            Storyboard and redraw — the reader picks up whichever version each panel is showing.
          </p>
        </div>

        <div className="reader-controls">
          <div className="chip-row" role="radiogroup" aria-label="Reading order">
            <button
              type="button"
              role="radio"
              aria-checked={!rtl}
              className={`chip${!rtl ? ' is-selected' : ''}`}
              onClick={() => setRtl(false)}
            >
              Left to right →
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={rtl}
              className={`chip${rtl ? ' is-selected' : ''}`}
              title="Manga reading order — the middle panels trade places."
              onClick={() => setRtl(true)}
            >
              ← Right to left
            </button>
          </div>
          <div className="reader-actions">
            <button
              type="button"
              className="btn btn-secondary"
              title="Watch the page ink in again, panel by panel."
              onClick={() => setPlayKey((k) => k + 1)}
            >
              Replay the ink-in
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={exporting}
              title="One PNG: every panel’s displayed version with your bubbles, laid out like this page."
              onClick={() => void exportPage()}
            >
              {exporting ? 'Compositing…' : 'Export PNG'}
            </button>
          </div>
        </div>

        <div className="reader-sheet">
          <div className="read-arrow" aria-hidden="true">
            {rtl ? '⟵ read right to left' : 'read left to right ⟶'}
          </div>
          <section key={playKey} className={`page reader-page${rtl ? ' is-rtl' : ''}`} aria-label="The finished page">
            {PANEL_LAYOUT.map((slot) => {
              const panel = script[slot.index]
              const imageId = currentImageId(panel)
              const character = chapter.cast.find((c) => c.id === panel.characterId) ?? null
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
        </div>

        {notice && (
          <div className="notice" role="alert">
            {notice}
          </div>
        )}

        <div className="station-footer">
          <div className="station-footer-status">
            <span className="footer-progress">4 panels · the page is inked</span>
            <span className="helper">
              Exports land in your downloads. A new chapter clears this one from the desk — after a confirmation.
            </span>
          </div>
          <div className="reader-actions">
            <button type="button" className="btn btn-secondary" onClick={onGoStoryboard}>
              ← Back to Storyboard
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              title="Clear the desk and start from a blank page — it asks first."
              onClick={() => setConfirming(true)}
            >
              New chapter…
            </button>
          </div>
        </div>

        {confirming && (
          <ConfirmDialog
            title="Start a new chapter?"
            body="This clears the whole desk — the synopsis, the cast and their locked sheets, the page script, and all four panels. The studio returns to a blank first page. PNGs you already exported stay in your downloads."
            confirmLabel="Clear the desk"
            busy={clearing}
            onConfirm={() => void clearDesk()}
            onCancel={() => setConfirming(false)}
          />
        )}
      </div>
    </main>
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

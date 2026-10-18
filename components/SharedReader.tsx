'use client'

// The shared manga, read (v3, slice 21): what a stranger holding the link sees.
// The same reader as the studio's — the cover, then page after page, each inking
// in as you turn to it; right to left with the flip toggle for a manga, one
// vertical scroll for a manhwa; arrow keys; Replay the ink-in — made from the
// same pieces (`ReaderParts`), over a SNAPSHOT instead of a desk. There are no
// export buttons and no way into anything of the owner's: this component is
// given only the snapshot's own fields (title, reading, cover, complete pages),
// because everything it is given is serialized into the page's HTML. All text —
// the title, the lines in the bubbles, the speakers' names — is rendered as
// text; nothing here sets inner HTML.
//
// Pictures come from `/api/s/<token>/image/<id>`, which streams only what the
// snapshot lists. The footer says "Made with Ink Desk", links to the studio and
// carries the Report button. Implements `devpost/prd.md > Sharing (v3)` and
// `> Report (v3)`.
import Link from 'next/link'
import { useState } from 'react'
import {
  ReaderCover,
  ReaderNav,
  ReaderPage,
  ScrollEntry,
  useSwipeTurn,
  useTurnKeys,
  type PanelView,
} from '@/components/ReaderParts'
import { ReportDialog } from '@/components/ReportDialog'
import { bubbleLayout } from '@/lib/bubble'
import { PANEL_LAYOUT } from '@/lib/prompts'
import type { PageDirection } from '@/lib/reader'
import type { ShareReading, SnapshotPage } from '@/lib/share/types'
import { shareImageUrl } from '@/lib/share/url'
import '../app/s/share.css'

type Props = {
  token: string
  title: string
  reading: ShareReading
  cover: { imageId: string; title: string } | null
  pages: SnapshotPage[]
}

type Entry = { kind: 'cover'; title: string; imageId: string } | { kind: 'page'; index: number; panels: PanelView[] }

const labelOf = (e: Entry) => (e.kind === 'cover' ? 'The cover' : `Page ${e.index + 1}`)

/** A snapshot page's panels as the shared reader pieces read them. */
function panelViews(page: SnapshotPage): PanelView[] {
  return PANEL_LAYOUT.map((slot) => {
    const panel = page.panels[slot.index]
    return {
      imageId: panel.imageId,
      dialogue: panel.dialogue,
      layout: bubbleLayout({ index: slot.index, camera: '', bubble: panel.bubble }),
      alt: panel.speaker ? `${panel.speaker}, ${panel.shot}` : `Panel ${slot.index + 1}`,
      caption: `Panel ${slot.index + 1}${panel.speaker ? `, ${panel.speaker}` : ''}, ${panel.shot}. “${panel.dialogue}”`,
    }
  })
}

export function SharedReader({ token, title, reading, cover, pages }: Props) {
  const vertical = reading === 'vertical'
  // A manga opens right to left; the visitor may flip it, as in the studio.
  const [rtl, setRtl] = useState(reading !== 'ltr')
  const direction: PageDirection = vertical ? 'vertical' : rtl ? 'rtl' : 'ltr'
  const imageSrc = (imageId: string) => shareImageUrl(token, imageId)

  const entries: Entry[] = [
    ...(cover ? [{ kind: 'cover' as const, title: cover.title, imageId: cover.imageId }] : []),
    ...pages.map((p) => ({ kind: 'page' as const, index: p.index, panels: panelViews(p) })),
  ]
  const count = entries.length
  const [pos, setPos] = useState(0)
  const at = Math.min(pos, Math.max(0, count - 1))
  // Remounting a page restarts every reveal animation on it.
  const [playKey, setPlayKey] = useState(0)
  // Vertical scroll: the furthest entry that has come into view; everything above it has been passed too.
  const [reached, setReached] = useState(-1)
  const go = (i: number) => setPos(Math.min(Math.max(0, i), count - 1))
  useTurnKeys({ enabled: !vertical, rtl, at, count, go: setPos })
  // On a phone a sideways swipe turns the page, in the reading order.
  const swipe = useSwipeTurn({ enabled: !vertical, rtl, at, count, go: setPos })

  const current = entries[at]
  const pageWord = pages.length === 1 ? 'page' : 'pages'

  return (
    <div className="share-page">
      <main className="station">
        <div className="station-inner is-wide reader">
          <div className="station-head share-head">
            <div className="eyebrow">Shared on Ink Desk</div>
            <h1 className="station-title share-title">{title}</h1>
            <p className="share-meta">
              {pages.length} {pageWord}
              {cover ? ' and a cover' : ''} · {vertical ? 'one vertical scroll, top to bottom' : 'a manga: it reads right to left unless you flip it'}
            </p>
          </div>

          {count === 0 ? (
            <p className="notice" role="status">
              There’s nothing to read here yet.
            </p>
          ) : (
            <>
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
                    <button type="button" role="radio" aria-checked={!rtl} className={`chip${!rtl ? ' is-selected' : ''}`} onClick={() => setRtl(false)}>
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
                </div>
              </div>

              {vertical ? (
                <div className="reader-sheet is-vertical">
                  {/* Without scripts nothing can tell a page it has scrolled into view, so none is left waiting, art hidden. */}
                  <noscript>
                    <style>{'.reader-page.is-waiting .reader-reveal,.reader-cover.is-waiting .cover-art{animation:none;clip-path:none}.reader-page.is-waiting .reader-bubble{animation:none;opacity:1}'}</style>
                  </noscript>
                  <div className="read-arrow" aria-hidden="true">
                    read top to bottom ↓
                  </div>
                  {entries.map((e, i) => (
                    <ScrollEntry key={`${i}-${playKey}`} label={labelOf(e)} reached={reached >= i} onReach={() => setReached((r) => Math.max(r, i))}>
                      {(playing) => (
                        <>
                          <div className="reader-page-head">
                            <span className="reader-page-label">{labelOf(e)}</span>
                          </div>
                          <EntryView entry={e} direction={direction} playing={playing} imageSrc={imageSrc} />
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
                    tabs={entries.map((e) => ({ label: e.kind === 'cover' ? 'Cover' : String(e.index + 1), title: labelOf(e), pencil: false }))}
                  />
                  {current?.kind === 'page' && (
                    <div className="read-arrow" aria-hidden="true">
                      {rtl ? '⟵ read right to left' : 'read left to right ⟶'}
                      <span className="reader-swipe-hint"> · swipe to turn</span>
                    </div>
                  )}
                  {current && (
                    <div {...swipe}>
                      <EntryView key={`${at}-${playKey}`} entry={current} direction={direction} playing imageSrc={imageSrc} />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <footer className="share-footer">
        <p className="share-made">
          <span className="share-brand">Made with Ink Desk</span>
          <Link className="share-studio-link" href="/">
            Open the studio →
          </Link>
        </p>
        <ReportDialog token={token} />
      </footer>
    </div>
  )
}

function EntryView({ entry, direction, playing, imageSrc }: { entry: Entry; direction: PageDirection; playing: boolean; imageSrc: (imageId: string) => string }) {
  if (entry.kind === 'cover') return <ReaderCover title={entry.title} imageId={entry.imageId} playing={playing} imageSrc={imageSrc} />
  return <ReaderPage index={entry.index} panels={entry.panels} direction={direction} playing={playing} imageSrc={imageSrc} />
}

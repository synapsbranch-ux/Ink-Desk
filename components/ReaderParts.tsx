'use client'

// The reader's pages, shared (v3, slice 21). The studio's reader station
// (`ReaderStation`) and the public shared reader (`SharedReader`) show the same
// thing — the cover, then pages whose panels ink in one after another, bubbles
// lettered over them — so the pieces live here once and both walk them. What
// differs is where the pictures come from and what a panel is made of: every
// piece takes an `imageSrc` function (the studio's `/api/projects/<id>/image/…`,
// a share's `/api/s/<token>/image/…`) and a `PanelView`, the few plain fields a
// page needs, which each reader derives from its own data. Nothing here knows
// about projects, casts or tokens, so nothing of an owner's can come through it.
//
// Moved out of `ReaderStation` unchanged: the markup, the class names, the
// reveal clock and the keyboard rules are the station's own. See
// `devpost/prd.md > Reader (v2) — The Chapter`.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { PencilPlaceholder } from '@/components/PencilPlaceholder'
import { tailPath } from '@/lib/bubble'
import { PANEL_LAYOUT } from '@/lib/prompts'
import { turnKeyIndex, type PageDirection } from '@/lib/reader'
import type { BubbleLayout } from '@/lib/types'

/** The reveal's clock, tuned to read well on camera: a beat before the first
 *  panel, each panel starting as the previous wipe lands, the bubble arriving
 *  as its panel's ink dries. */
export const REVEAL_FIRST_S = 0.45
export const REVEAL_STEP_S = 1.15
export const BUBBLE_LAG_S = 1.0

/** What one panel needs to be read: its picture (if any), the line, where the bubble sits, and the words a screen reader gets. */
export type PanelView = {
  imageId: string | null
  dialogue: string
  layout: BubbleLayout
  /** The picture's alt text. */
  alt: string
  /** The panel's screen-reader caption, panel number and line included. */
  caption: string
}

export type ImageSrc = (imageId: string) => string

export const directionClass = (d: PageDirection) => (d === 'rtl' ? ' is-rtl' : d === 'vertical' ? ' is-vertical' : '')

/**
 * One entry of the vertical scroll: it waits, art hidden, until it scrolls
 * into view — or a later entry does — then plays its ink-in once. No
 * IntersectionObserver (an old browser) → it plays at once, as soon as it has
 * mounted. It starts waiting on the server and in the browser alike, so a page
 * the server renders (the shared reader) hydrates without a mismatch.
 */
export function ScrollEntry({
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
  const [seen, setSeen] = useState(false)
  const reach = useRef(onReach)
  useEffect(() => {
    reach.current = onReach
  })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      // An old browser: nothing will tell us when it scrolls into view, so it plays now.
      const timer = setTimeout(() => setSeen(true), 0)
      return () => clearTimeout(timer)
    }
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

/**
 * Left and right arrows turn the page, in manga order "next" being the
 * left-hand side. Off in the vertical scroll, and never while the reader is
 * typing in a field or has a dialog (Share, Report) open: the dialog has the keyboard.
 */
export function useTurnKeys({ enabled, rtl, at, count, go }: { enabled: boolean; rtl: boolean; at: number; count: number; go: (index: number) => void }) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const to = turnKeyIndex({ key: e.key, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, target: e.target instanceof Element ? e.target : null, modalOpen: document.querySelector('[aria-modal="true"]') !== null }, rtl, at, count)
      if (to === null) return
      go(to)
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, rtl, at, count, go])
}

/** One tab of the page strip. */
export type NavTab = { label: string; title: string; pencil: boolean }

/** The page strip and the two turn buttons; in manga order they run right to left, so "next" is on the left. */
export function ReaderNav({ rtl, at, tabs, go }: { rtl: boolean; at: number; tabs: readonly NavTab[]; go: (index: number) => void }) {
  return (
    <nav className={`reader-nav${rtl ? ' is-rtl' : ''}`} aria-label="Pages">
      <button type="button" className="btn btn-secondary btn-sm reader-turn" disabled={at === 0} onClick={() => go(at - 1)}>
        {rtl ? 'Previous →' : '← Previous'}
      </button>
      <ol className="reader-strip">
        {tabs.map((tab, i) => (
          <li key={i}>
            <button
              type="button"
              className={`reader-tab${i === at ? ' is-active' : ''}${tab.pencil ? ' is-pencil' : ''}`}
              aria-current={i === at ? 'page' : undefined}
              title={tab.title}
              onClick={() => go(i)}
            >
              {tab.label}
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-secondary btn-sm reader-turn" disabled={at >= tabs.length - 1} onClick={() => go(at + 1)}>
        {rtl ? '← Next' : 'Next →'}
      </button>
    </nav>
  )
}

/** The cover as the reader shows it: the art, the title lettered over it. */
export function ReaderCover({ title, imageId, playing, imageSrc }: { title: string; imageId: string | null; playing: boolean; imageSrc: ImageSrc }) {
  return (
    <figure className={`cover-frame reader-cover${imageId ? ' is-inked' : ''}${playing ? '' : ' is-waiting'}`} data-entry="cover">
      {imageId ? (
        // eslint-disable-next-line @next/next/no-img-element -- served by our own route as final bytes; the cover being read
        <img className="cover-art" src={imageSrc(imageId)} alt="The chapter’s cover" />
      ) : (
        <div className="cover-pencil sketch is-still">
          <span className="pencil-label">No cover yet — the Director draws it.</span>
        </div>
      )}
      {title && <h2 className="cover-title">{title}</h2>}
    </figure>
  )
}

/** A complete page, its ink-in replaying panel by panel. `panels` is the four, in slot order. */
export function ReaderPage({
  index,
  panels,
  direction,
  playing,
  imageSrc,
}: {
  index: number
  panels: readonly PanelView[]
  direction: PageDirection
  playing: boolean
  imageSrc: ImageSrc
}) {
  return (
    <section
      className={`page reader-page${directionClass(direction)}${playing ? '' : ' is-waiting'}`}
      aria-label={`Page ${index + 1}`}
      data-entry={`page-${index + 1}`}
    >
      {PANEL_LAYOUT.map((slot) => {
        const panel = panels[slot.index]
        const delay = REVEAL_FIRST_S + slot.index * REVEAL_STEP_S
        return (
          <figure
            key={slot.index}
            className={`panel panel-${slot.shape} reader-panel`}
            data-panel={slot.index}
            style={{ '--reveal-delay': `${delay}s`, '--bubble-delay': `${delay + BUBBLE_LAG_S}s` } as CSSProperties}
          >
            <PencilPlaceholder slot={slot} label="" still />
            {panel.imageId && (
              // eslint-disable-next-line @next/next/no-img-element -- served by our own route as final bytes; the page being read
              <img className="panel-art reader-reveal" src={imageSrc(panel.imageId)} alt={panel.alt} />
            )}
            <ReaderBubble layout={panel.layout} dialogue={panel.dialogue} />
            <span className="panel-num" aria-hidden="true">
              {slot.index + 1}
            </span>
            <figcaption className="sr-only">{panel.caption}</figcaption>
          </figure>
        )
      })}
    </section>
  )
}

/** The bubble as the reader sees it: the same stored (or derived) layout and
 *  the same SVG shapes as the Storyboard, with the editing stripped away. */
export function ReaderBubble({ layout: l, dialogue }: { layout: BubbleLayout; dialogue: string }) {
  return (
    <div className="bubble-layer reader-bubble">
      <svg className="bubble-shape" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <ellipse cx={l.x + l.w / 2} cy={l.y + l.h / 2} rx={l.w / 2} ry={l.h / 2} />
        <path d={tailPath(l)} />
      </svg>
      <div className="bubble-static" style={{ left: `${l.x}%`, top: `${l.y}%`, width: `${l.w}%`, height: `${l.h}%` }}>
        <div className="bubble-text-wrap">
          <span className="bubble-text is-static">{dialogue}</span>
        </div>
      </div>
    </div>
  )
}

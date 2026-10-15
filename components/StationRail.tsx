'use client'

// The persistent header and station rail: progress indicator and navigation
// in one. Gates come in already derived — see `lib/gates.ts`. Since slice 11
// the rail has five stations (Story, Library, Director, Page, Ink & Publish)
// and the header carries the page-level progress: which page is open, its
// panels inked, and the chapter's pages complete.
// Since slice 20 the quota meter sits first in the header's right-hand group.
// Implements `devpost/prd.md > Screens and Layout (v2)`.
import Image from 'next/image'
import Link from 'next/link'
import { QuotaMeter } from '@/components/QuotaMeter'
import { usd } from '@/lib/cost'
import type { Gates } from '@/lib/gates'
import { pagesComplete } from '@/lib/plan'
import { stylePreset } from '@/lib/styles'
import type { Chapter, Station } from '@/lib/types'

export type SaveState = 'saved' | 'saving' | 'error'

const STATION_META: readonly { id: Station; name: string; sub: string }[] = [
  { id: 'story', name: 'Story', sub: 'Pitch or scenario' },
  { id: 'cast', name: 'Library', sub: 'Cast and references' },
  { id: 'director', name: 'Director', sub: 'The chapter plan' },
  { id: 'storyboard', name: 'Page', sub: 'One page at a time' },
  { id: 'reader', name: 'Ink & Publish', sub: 'The reader' },
]

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Saved to desk',
  saving: 'Saving…',
  error: 'Couldn’t save to desk',
}

type Props = {
  chapter: Chapter
  gates: Gates
  saveState: SaveState
  onGo: (station: Station) => void
  /** The account menu, from the page; nothing on a desk without accounts. */
  account?: React.ReactNode
}

export function StationRail({ chapter, gates, saveState, onGo, account = null }: Props) {
  const title = chapter.title.trim() || chapter.synopsis?.title.trim() || 'Untitled project'
  const page = chapter.address.pageIndex + 1
  // The open page's panels, once it is written; the chapter's pages, once there is a plan.
  const inked = chapter.script ? chapter.script.filter((p) => p.versions.length > 0).length : null
  const progress = [
    inked !== null && `${inked} of 4 panels inked`,
    chapter.plan && `${pagesComplete(chapter)} of ${chapter.pages.length} pages complete`,
  ].filter(Boolean)

  return (
    <>
      <header className="studio-header">
        <Link className="brand" href="/" title="Back to the desk — every project">
          <Image className="brand-mark" src="/brand/inkdesk-mark.svg" alt="" width={30} height={30} priority />
          <span className="brand-name">Ink Desk</span>
        </Link>
        <div className="header-divider" />
        <div className="chapter-title">
          <span className="eyebrow eyebrow-sm chapter-eyebrow">
            Page {page} of {chapter.pageCount} · {stylePreset(chapter.stylePresetId).label}
            {progress.map((line) => (
              <span key={String(line)} className="chapter-progress">
                {' '}
                · {line}
              </span>
            ))}
          </span>
          <span className="chapter-title-text">{title}</span>
        </div>
        <div className="header-spacer" />
        <div className="header-meta">
          <QuotaMeter />
          <span className="image-counter" title="Images generated in this project, and what the providers reported for every image and text call so far">
            Images this project: {chapter.imageCount} · ≈ {usd(chapter.costUsd)}
          </span>
          <span className={`save-label is-${saveState}`} aria-live="polite">
            {SAVE_LABEL[saveState]}
          </span>
          {account}
        </div>
      </header>

      <nav className="rail" aria-label="Stations">
        {STATION_META.map((s, i) => {
          const gate = gates[s.id]
          const active = chapter.station === s.id
          const locked = !gate.open
          const className = ['rail-station', active && 'is-active', locked && 'is-locked'].filter(Boolean).join(' ')
          return (
            <button
              key={s.id}
              type="button"
              className={className}
              data-station={s.id}
              aria-disabled={locked || undefined}
              aria-current={active ? 'step' : undefined}
              title={locked ? (gate.hint ?? undefined) : undefined}
              onClick={() => {
                if (!locked && !active) onGo(s.id)
              }}
            >
              <span className="rail-mark">{i + 1}</span>
              <span className="rail-text">
                <span className="rail-name">{s.name}</span>
                <span className="rail-sub">{s.sub}</span>
              </span>
              <span className="rail-line" />
              {locked && gate.hint && (
                <span className="rail-hint" role="tooltip">
                  {gate.hint}
                </span>
              )}
            </button>
          )
        })}
      </nav>
    </>
  )
}

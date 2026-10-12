'use client'

// The persistent header and station rail: progress indicator and navigation
// in one. Gates come in already derived — see `lib/gates.ts`.
// Implements `devpost/prd.md > Screens and Layout`.
import Image from 'next/image'
import type { Gates } from '@/lib/gates'
import type { Chapter, Station } from '@/lib/types'

export type SaveState = 'saved' | 'saving' | 'error'

const STATION_META: readonly { id: Station; name: string; sub: string }[] = [
  { id: 'story', name: 'Story', sub: 'The pitch desk' },
  { id: 'cast', name: 'Cast', sub: 'Model sheets' },
  { id: 'storyboard', name: 'Storyboard', sub: 'The main studio' },
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
}

export function StationRail({ chapter, gates, saveState, onGo }: Props) {
  const title = chapter.synopsis?.title.trim() || 'Untitled chapter'

  return (
    <>
      <header className="studio-header">
        <div className="brand">
          <Image className="brand-mark" src="/brand/inkdesk-mark.svg" alt="" width={30} height={30} priority />
          <span className="brand-name">Ink Desk</span>
        </div>
        <div className="header-divider" />
        <div className="chapter-title">
          <span className="eyebrow eyebrow-sm">Chapter 1</span>
          <span className="chapter-title-text">{title}</span>
        </div>
        <div className="header-spacer" />
        <div className="header-meta">
          <span className="image-counter">Images this chapter: {chapter.imageCount}</span>
          <span className={`save-label is-${saveState}`} aria-live="polite">
            {SAVE_LABEL[saveState]}
          </span>
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

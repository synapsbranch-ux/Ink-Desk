'use client'

// Station 2 — model sheets. Two cards from Claude's proposal; the kernel is
// built here, one lock at a time. Implements `devpost/prd.md > Cast — Model
// Sheets`; see `devpost/spec.md > Components > Cast Station and Character
// Card`.
import { useEffect, useRef } from 'react'
import { CharacterCard, IDLE_CARD, type CardState } from '@/components/CharacterCard'
import type { Gates } from '@/lib/gates'
import type { CharacterEdit } from '@/lib/patch'
import type { Chapter } from '@/lib/types'

type Props = {
  chapter: Chapter
  gates: Gates
  proposing: boolean
  proposeNotice: string | null
  cards: Record<string, CardState>
  onPropose: () => void
  onEdit: (id: string, edit: CharacterEdit) => void
  onCommit: (id: string, edit: CharacterEdit) => void
  onReroll: (id: string) => void
  onDraw: (id: string, reuseDna: boolean) => void
  onLock: (id: string) => void
  onGoStoryboard: () => void
}

export function CastStation({
  chapter,
  gates,
  proposing,
  proposeNotice,
  cards,
  onPropose,
  onEdit,
  onCommit,
  onReroll,
  onDraw,
  onLock,
  onGoStoryboard,
}: Props) {
  const empty = chapter.cast.length === 0

  // Cast opens with nothing proposed exactly once per chapter: ask Claude on
  // arrival. A failure shows a sentence and a button rather than asking
  // again on its own, so a missing key can't loop.
  const asked = useRef(false)
  useEffect(() => {
    if (empty && !proposing && !proposeNotice && !asked.current) {
      asked.current = true
      onPropose()
    }
  }, [empty, proposing, proposeNotice, onPropose])

  const storyboard = gates.storyboard

  return (
    <main className="station">
      <div className="station-inner is-wide">
        <div className="station-head station-head-row">
          <div className="station-head-text">
            <div className="eyebrow">Station 2 · Model sheets</div>
            <h1 className="station-title">The cast</h1>
            <p className="station-lede">
              Every panel is drawn from these sheets. Read the DNA beside the art, fix the words or redraw the
              picture until they agree, then lock. Both locks open the storyboard.
            </p>
          </div>
          <div className="station-next">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={onGoStoryboard}
              disabled={!storyboard.open}
              title={storyboard.open ? undefined : (storyboard.hint ?? undefined)}
            >
              Next: storyboard →
            </button>
            {!storyboard.open && <span className="helper">{storyboard.hint}</span>}
          </div>
        </div>

        {proposing ? (
          <div className="sketch cast-loading" aria-busy="true">
            <span className="sketch-label">Claude is reading the synopsis…</span>
          </div>
        ) : empty ? (
          <div className="notice cast-notice" role="alert">
            <span>{proposeNotice ?? 'No cast yet.'}</span>
            <button type="button" className="btn btn-secondary" onClick={onPropose}>
              Try again
            </button>
          </div>
        ) : (
          <div className="cast-grid">
            {chapter.cast.map((c, i) => (
              <CharacterCard
                key={c.id}
                index={i + 1}
                character={c}
                state={cards[c.id] ?? IDLE_CARD}
                onEdit={onEdit}
                onCommit={onCommit}
                onReroll={onReroll}
                onDraw={onDraw}
                onLock={onLock}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

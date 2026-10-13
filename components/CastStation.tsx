'use client'

// Station 2 — the library (v2): the reference shelf and two cards from
// Claude's proposal; the kernel is built here, one lock at a time, and both
// locks open the Director (slice 11). Implements `devpost/prd.md > Cast —
// Model Sheets` and `> Library — Characters, Imported or Generated`; see
// `devpost/spec.md > Components > Cast Station and Character Card`.
import { useEffect, useRef } from 'react'
import { AssetShelf } from '@/components/AssetShelf'
import { CharacterCard, IDLE_CARD, type CardState } from '@/components/CharacterCard'
import { GenerationStatus } from '@/components/GenerationStatus'
import { StationFooter } from '@/components/StationFooter'
import type { Gates } from '@/lib/gates'
import { textStages } from '@/lib/stages'
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
  onImport: (id: string, assetId: string) => void
  uploading: boolean
  uploadNotice: string | null
  onUpload: (file: File) => void
  onUploadNotice: (sentence: string) => void
  onGoDirector: () => void
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
  onImport,
  uploading,
  uploadNotice,
  onUpload,
  onUploadNotice,
  onGoDirector,
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

  const lockedCount = chapter.cast.filter((c) => c.locked).length

  return (
    <main className="station">
      <div className="station-inner is-wide">
        <div className="station-head">
          <div className="eyebrow">Station 2 · Cast and references</div>
          <h1 className="station-title">The library</h1>
          <p className="station-lede">
            Every panel is drawn from these sheets. Draw a sheet, or import one of your own drawings from the
            shelf. Read the DNA beside the art, fix the words or redraw the picture until they agree, then lock. Both locks open the Director.
          </p>
        </div>

        <AssetShelf
          assets={chapter.assets}
          uploading={uploading}
          notice={uploadNotice}
          onUpload={onUpload}
          onNotice={onUploadNotice}
        />

        {proposing ? (
          <div className="sketch cast-loading" aria-busy="true">
            <GenerationStatus stages={textStages(chapter.storyMode === 'scenario' ? 'Claude is reading the scenario…' : 'Claude is reading the synopsis…')} />
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
                assets={chapter.assets}
                onImport={onImport}
              />
            ))}
          </div>
        )}

        <StationFooter
          gate={gates.director}
          label="Next: Director"
          ready="Both sheets are locked — the Director is open."
          progress={chapter.cast.length === 2 ? `${lockedCount} of 2 sheets locked` : undefined}
          onGo={onGoDirector}
        />
      </div>
    </main>
  )
}

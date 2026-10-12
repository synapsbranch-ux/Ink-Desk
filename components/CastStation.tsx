'use client'

// Station 2 — the cast. Two characters, two locked sheets.
// Implements `devpost/prd.md > Cast — Model Sheets`.
import { CharacterCard } from '@/components/CharacterCard'
import type { CharacterPatch } from '@/lib/patch'
import type { Chapter } from '@/lib/types'

export type CastBusy = { characterId: string; what: 'sheet' | 'reroll' } | null

type Props = {
  chapter: Chapter
  /** The whole station is waiting on the first cast proposal. */
  casting: boolean
  busy: CastBusy
  notice: string | null
  onCast: () => void
  onEditCharacter: (patch: CharacterPatch) => void
  onCommitCharacter: (patch: CharacterPatch) => void
  onReroll: (characterId: string) => void
  onDrawSheet: (characterId: string, reuseDna: boolean) => void
  onGoStoryboard: () => void
}

export function CastStation({
  chapter,
  casting,
  busy,
  notice,
  onCast,
  onEditCharacter,
  onCommitCharacter,
  onReroll,
  onDrawSheet,
  onGoStoryboard,
}: Props) {
  const { cast } = chapter
  const lockedCount = cast.filter((c) => c.locked).length
  const bothLocked = cast.length === 2 && lockedCount === 2
  const anyBusy = casting || busy !== null

  return (
    <main className="station">
      <div className="station-inner">
        <div className="station-head">
          <div className="eyebrow">Station 2 · Model sheets</div>
          <h1 className="station-title">The cast</h1>
          <p className="station-lede">
            Claude proposes, you edit, then you lock. A locked sheet is the reference every panel is drawn
            against — so nothing is final until the words <em>and</em> the picture are right.
          </p>
        </div>

        {notice && (
          <div className="notice" role="alert">
            {notice}
          </div>
        )}

        {cast.length === 0 ? (
          <div className="cast-empty">
            {casting ? (
              <div className="sketch synopsis-loading" aria-busy="true">
                <span className="sketch-label">Claude is reading your synopsis…</span>
              </div>
            ) : (
              <>
                <p className="helper">Two characters, drawn from the synopsis you accepted.</p>
                <button type="button" className="btn btn-primary btn-lg" onClick={onCast}>
                  Cast this chapter
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="cast-grid">
              {cast.map((character, i) => (
                <CharacterCard
                  key={character.id}
                  character={character}
                  index={i}
                  busy={busy?.characterId === character.id ? busy.what : false}
                  anyBusy={anyBusy}
                  onEdit={onEditCharacter}
                  onCommit={onCommitCharacter}
                  onReroll={() => onReroll(character.id)}
                  onDrawSheet={(reuseDna) => onDrawSheet(character.id, reuseDna)}
                />
              ))}
            </div>

            <div className="action-row cast-footer">
              {bothLocked ? (
                <>
                  <button type="button" className="btn btn-primary btn-lg" onClick={onGoStoryboard}>
                    Next: ink the page →
                  </button>
                  <span className="helper">Both sheets are locked. The page script comes next.</span>
                </>
              ) : (
                <span className="helper">
                  {lockedCount === 1
                    ? 'One locked. Lock the other to open the storyboard.'
                    : 'Draw a sheet for each character, then lock both to open the storyboard.'}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  )
}

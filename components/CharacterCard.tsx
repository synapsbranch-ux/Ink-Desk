'use client'

// One character card: the words (name, role, traits, look — all editable
// until locked), Reroll, Draw / Redraw sheet, the DNA text beside the sheet
// art, and Lock. A locked card is read-only and wears the stamp.
// Implements `devpost/prd.md > Cast — Model Sheets`; see
// `devpost/spec.md > Components > Cast Station and Character Card`.
import { useState } from 'react'
import type { CharacterEdit } from '@/lib/patch'
import type { Character } from '@/lib/types'

export type CardState = { busy: 'rerolling' | 'drawing' | null; notice: string | null }
export const IDLE_CARD: CardState = { busy: null, notice: null }

type Props = {
  index: number
  character: Character
  state: CardState
  /** Typing: applied locally now, saved after a pause. */
  onEdit: (id: string, edit: CharacterEdit) => void
  /** Blur and clicks: saved immediately. */
  onCommit: (id: string, edit: CharacterEdit) => void
  onReroll: (id: string) => void
  onDraw: (id: string, reuseDna: boolean) => void
  onLock: (id: string) => void
}

export function CharacterCard({ index, character: c, state, onEdit, onCommit, onReroll, onDraw, onLock }: Props) {
  const { busy, notice } = state
  const working = busy !== null
  const hasPair = Boolean(c.dna && c.sheetImageId)
  const drawLabel =
    busy === 'drawing' ? 'Drawing…' : hasPair ? 'Redraw sheet' : c.dna ? 'Try again' : 'Draw sheet'

  return (
    <article
      className={`card cast-card${c.locked ? ' is-locked' : ''}`}
      data-character={c.id}
      aria-busy={working || undefined}
    >
      <header className="cast-card-head">
        <div className="cast-card-id">
          <span className="eyebrow eyebrow-sm">Model sheet · {index}</span>
          {c.locked ? (
            <>
              <h2 className="cast-name">{c.name}</h2>
              <span className="cast-role">{c.role}</span>
            </>
          ) : (
            <>
              <input
                className="cast-name"
                value={c.name}
                onChange={(e) => onEdit(c.id, { name: e.target.value })}
                aria-label="Name"
                disabled={working}
              />
              <input
                className="cast-role"
                value={c.role}
                onChange={(e) => onEdit(c.id, { role: e.target.value })}
                aria-label="Role"
                placeholder="Their part in the story"
                disabled={working}
              />
            </>
          )}
        </div>
        {c.locked && <span className="stamp">Locked</span>}
      </header>

      <div className="sheet-grid">
        <figure className="sheet-figure">
          {busy === 'drawing' ? (
            <div className="sketch sheet-art">
              <span className="sketch-label">{c.dna ? 'Drawing the sheet…' : 'Writing the DNA, then drawing…'}</span>
            </div>
          ) : c.sheetImageId ? (
            <div className="sheet-art">
              {/* eslint-disable-next-line @next/next/no-img-element -- served by our own route as final bytes; next/image would re-encode the art every panel is compared against */}
              <img src={`/api/image/${c.sheetImageId}`} alt={`${c.name}’s model sheet`} />
            </div>
          ) : (
            <div className="sheet-art sheet-empty">
              <span>No sheet yet</span>
            </div>
          )}
          <figcaption className="eyebrow eyebrow-sm">Sheet · front, three-quarter, expressions</figcaption>
        </figure>

        <div className="dna">
          <span className="eyebrow eyebrow-sm">Visual DNA</span>
          {c.dna ? (
            <p className="dna-text">{c.dna}</p>
          ) : (
            <p className="dna-empty">
              {busy === 'drawing'
                ? 'Claude is writing it from the look below.'
                : c.sheetImageId
                  ? 'The look changed, so this DNA was retired. Draw the sheet again and Claude writes it fresh from the new words.'
                  : 'Written by Claude from the look below when you draw the sheet, then pasted word for word into every panel this character appears in. Read it against the art before you lock.'}
            </p>
          )}
        </div>
      </div>

      <div className="cast-field">
        <span className="eyebrow eyebrow-sm">Traits</span>
        {c.locked ? (
          <div className="traits-row">
            {c.traits.map((t) => (
              <span key={t} className="tag tag-neutral">
                {t}
              </span>
            ))}
          </div>
        ) : (
          <TraitsField
            key={c.traits.join('\u0000')}
            initial={c.traits}
            disabled={working}
            onCommit={(traits) => onCommit(c.id, { traits })}
          />
        )}
      </div>

      <div className="cast-field">
        <span className="eyebrow eyebrow-sm">Look</span>
        {c.locked ? (
          <p className="cast-look-text">{c.look}</p>
        ) : (
          <textarea
            className="input cast-look"
            rows={3}
            value={c.look}
            onChange={(e) => onEdit(c.id, { look: e.target.value })}
            aria-label="Look"
            disabled={working}
          />
        )}
      </div>

      {notice && (
        <div className="notice" role="alert">
          {notice}
        </div>
      )}

      <footer className="cast-card-foot">
        {c.locked ? (
          <span className="helper">DNA and sheet frozen. Every panel {c.name} appears in is drawn from them.</span>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => onReroll(c.id)} disabled={working}>
              {busy === 'rerolling' ? 'Rerolling…' : 'Reroll'}
            </button>
            <span className="helper foot-helper">
              {hasPair ? 'When the words and the picture agree, lock.' : 'Draw the sheet, then read the DNA against it.'}
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onDraw(c.id, Boolean(c.dna))}
              disabled={working}
            >
              {drawLabel}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onLock(c.id)}
              disabled={working || !hasPair}
              title={hasPair ? undefined : 'Draw the sheet first.'}
            >
              Lock
            </button>
          </>
        )}
      </footer>
    </article>
  )
}

/**
 * Traits as one comma-separated line, committed on blur or Enter rather than
 * per keystroke, so typing a comma doesn't save a half-written list. The
 * parent re-keys it when the traits change underneath (a reroll).
 */
function TraitsField({
  initial,
  disabled,
  onCommit,
}: {
  initial: string[]
  disabled: boolean
  onCommit: (traits: string[]) => void
}) {
  const [draft, setDraft] = useState(initial.join(', '))
  const commit = () => {
    const traits = draft
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    if (traits.join('\u0000') !== initial.join('\u0000')) onCommit(traits)
  }
  return (
    <input
      className="input traits-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      placeholder="three short traits, separated by commas"
      aria-label="Traits"
      disabled={disabled}
    />
  )
}

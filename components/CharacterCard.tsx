'use client'

// One character: editable text, the DNA beside the sheet art, and the hanko
// stamp when locked. Implements `devpost/prd.md > Cast — Model Sheets`.
//
// The DNA-beside-art layout is the point of this card. It is the human check
// before locking: the words are what every panel will be drawn from, so you
// read them against the picture and only then freeze the pair.
import Image from 'next/image'
import type { CharacterPatch } from '@/lib/patch'
import type { Character } from '@/lib/types'

type Props = {
  character: Character
  index: number
  /** This card has a request in flight. */
  busy: false | 'sheet' | 'reroll'
  /** Any card has a request in flight — others go quiet rather than queue up. */
  anyBusy: boolean
  onEdit: (patch: CharacterPatch) => void
  onCommit: (patch: CharacterPatch) => void
  onReroll: () => void
  onDrawSheet: (reuseDna: boolean) => void
}

export function CharacterCard({ character, index, busy, anyBusy, onEdit, onCommit, onReroll, onDrawSheet }: Props) {
  const { name, role, traits, look, dna, sheetImageId, locked } = character
  const drawing = busy === 'sheet'
  const rerolling = busy === 'reroll'
  const frozen = locked || drawing || rerolling
  const disabled = anyBusy || locked

  return (
    <article className={`card character-card${locked ? ' is-locked' : ''}`}>
      <div className="character-head">
        <div className="eyebrow">{locked ? 'Locked' : `Character ${index + 1}`}</div>
        {locked ? (
          <h2 className="character-name">{name}</h2>
        ) : (
          <input
            className="input character-name"
            value={name}
            onChange={(e) => onEdit({ id: character.id, name: e.target.value })}
            disabled={frozen}
            aria-label={`Character ${index + 1} name`}
          />
        )}
        {locked ? (
          <p className="character-role">{role}</p>
        ) : (
          <input
            className="input character-role"
            value={role}
            onChange={(e) => onEdit({ id: character.id, role: e.target.value })}
            disabled={frozen}
            aria-label={`${name || `Character ${index + 1}`} role`}
          />
        )}
      </div>

      <div className="trait-row">
        {traits.map((trait, i) =>
          locked ? (
            <span key={i} className="tag tag-neutral">
              {trait}
            </span>
          ) : (
            <input
              key={i}
              className="input trait-input"
              value={trait}
              onChange={(e) =>
                onEdit({ id: character.id, traits: traits.map((t, j) => (j === i ? e.target.value : t)) })
              }
              disabled={frozen}
              aria-label={`Trait ${i + 1}`}
            />
          )
        )}
      </div>

      <div className="eyebrow-sm">How they look</div>
      {locked ? (
        <p className="character-look">{look}</p>
      ) : (
        <textarea
          className="input character-look"
          rows={3}
          value={look}
          onChange={(e) => onEdit({ id: character.id, look: e.target.value })}
          disabled={frozen}
          aria-label={`${name || `Character ${index + 1}`} look`}
        />
      )}

      {/* The kernel, made visible: the frozen words next to the picture they
          produced, so a mismatch is caught before it reaches every panel. */}
      <div className="sheet-pair">
        <div className="sheet-art">
          {drawing ? (
            <div className="sketch sheet-sketch" aria-busy="true">
              <span className="sketch-label">Inking the sheet…</span>
            </div>
          ) : sheetImageId ? (
            <Image
              className="sheet-image"
              src={`/api/image/${sheetImageId}`}
              alt={`Model sheet for ${name}`}
              width={1536}
              height={1024}
              unoptimized
            />
          ) : (
            <div className="sheet-empty">
              <span>The model sheet lands here.</span>
            </div>
          )}
        </div>
        <div className="sheet-dna">
          <div className="eyebrow-sm">Visual DNA</div>
          {dna ? (
            <p className="dna-text">{dna}</p>
          ) : (
            <p className="dna-empty">
              {drawing
                ? 'Claude is writing it…'
                : 'Written when you draw the sheet, then pasted into every panel unchanged.'}
            </p>
          )}
        </div>
      </div>

      {!locked && (
        <div className="character-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onDrawSheet(false)}
            disabled={disabled || drawing || look.trim() === ''}
          >
            {drawing ? 'Drawing…' : sheetImageId ? 'Draw sheet again' : 'Draw sheet'}
          </button>
          {sheetImageId && dna && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onDrawSheet(true)}
              disabled={disabled || drawing}
              title="Same DNA, a different drawing of it"
            >
              Redraw sheet
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onReroll} disabled={disabled || rerolling}>
            {rerolling ? 'Rerolling…' : 'Reroll'}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-lock"
            onClick={() => onCommit({ id: character.id, locked: true })}
            disabled={disabled || drawing || !dna || !sheetImageId}
            title={dna && sheetImageId ? 'Final — there is no unlock in this version' : 'Draw the sheet first'}
          >
            Lock
          </button>
        </div>
      )}

      {locked && <span className="stamp">Locked</span>}
    </article>
  )
}

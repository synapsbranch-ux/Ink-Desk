'use client'

// One character card: the words (name, role, traits, look — all editable
// until locked), the DNA text beside the sheet art, and the four actions —
// Reroll, Draw sheet, Redraw sheet, Lock — always visible with a caption
// saying what each does or why it's disabled. A locked card is read-only
// and wears the stamp. Implements `devpost/prd.md > Cast — Model Sheets`;
// see `devpost/spec.md > Components > Cast Station and Character Card`.
import { useState } from 'react'
import { GenerationStatus } from '@/components/GenerationStatus'
import type { CharacterEdit } from '@/lib/patch'
import { SHEET_FRESH_STAGES, SHEET_STAGES } from '@/lib/stages'
import type { Character } from '@/lib/types'

export type CardState = { busy: 'rerolling' | 'drawing' | 'redrawing' | null; notice: string | null }
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
  const hasDna = Boolean(c.dna)
  const hasSheet = Boolean(c.sheetImageId)
  const hasPair = hasDna && hasSheet
  const drawing = busy === 'drawing' || busy === 'redrawing'

  // The four actions, always rendered in the same places with fixed labels —
  // the checkpoint verdict was that a morphing label hid Redraw entirely.
  // Draw sheet always writes the DNA fresh from the look; Redraw sheet keeps
  // the DNA and only tries a new picture.
  const actions: {
    key: string
    label: string
    kind: 'ghost' | 'secondary' | 'primary'
    onClick: () => void
    disabled: boolean
    caption: string
  }[] = [
    {
      key: 'reroll',
      label: busy === 'rerolling' ? 'Rerolling…' : 'Reroll',
      kind: 'ghost',
      onClick: () => onReroll(c.id),
      disabled: working || c.locked,
      caption: 'A fresh proposal for this slot — new look, same name.',
    },
    {
      key: 'draw',
      label: busy === 'drawing' ? 'Drawing…' : 'Draw sheet',
      kind: 'secondary',
      onClick: () => onDraw(c.id, false),
      disabled: working || c.locked,
      caption: hasDna
        ? 'Rereads the look, writes fresh DNA, draws again.'
        : hasSheet
          ? 'The look changed — Claude writes fresh DNA, then draws.'
          : 'Claude writes the visual DNA from the look, then draws.',
    },
    {
      key: 'redraw',
      label: busy === 'redrawing' ? 'Redrawing…' : 'Redraw sheet',
      kind: 'secondary',
      onClick: () => onDraw(c.id, true),
      disabled: working || c.locked || !hasDna,
      caption: !hasDna
        ? hasSheet
          ? 'Disabled — the DNA was retired with the old look. Use Draw sheet.'
          : 'Disabled — draw the sheet first. Redraw reuses its DNA.'
        : hasSheet
          ? 'Same DNA, new picture.'
          : 'Same DNA — try the picture again.',
    },
    {
      key: 'lock',
      label: 'Lock',
      kind: 'primary',
      onClick: () => onLock(c.id),
      disabled: working || c.locked || !hasPair,
      caption: !hasPair
        ? 'Disabled — draw the sheet, then read the DNA against it.'
        : 'Freezes this DNA and sheet. Final in this version.',
    },
  ]

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
          {drawing ? (
            <div className="sketch sheet-art is-drawing">
              <div className="speedlines" />
              <GenerationStatus stages={busy === 'redrawing' ? SHEET_STAGES : SHEET_FRESH_STAGES} />
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
              {drawing
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
        <div className="card-actions" role="group" aria-label={`Actions for ${c.name}`}>
          {actions.map((a) => (
            <div key={a.key} className="card-action">
              <button type="button" className={`btn btn-${a.kind}`} onClick={a.onClick} disabled={a.disabled}>
                {a.label}
              </button>
              {!c.locked && <span className="action-caption">{a.caption}</span>}
            </div>
          ))}
        </div>
        {c.locked && (
          <span className="helper">
            Locked — sheets are final in this version. Every panel {c.name} appears in is drawn from this DNA and
            sheet.
          </span>
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

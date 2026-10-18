'use client'

// The bubble's edit sheet on a touch screen (v3, slice 23). On a phone or a
// tablet a finger dragging the bubble fights the page's own scroll, so a tap
// on the bubble opens this sheet instead: the words, a pad that nudges the
// bubble, Smaller / Larger, and where the tail points. Every change shows on
// the panel above at once; Done saves through the same path a drag, a resize
// and an in-place text edit take on the desktop. Cancel and Escape put the
// bubble back as it was; a tap outside the sheet is Done. A bottom sheet, so
// the panel stays in view above it (the bubble scrolls its panel to the top).
// Implements `devpost/prd.md > Responsive (v3)`; see
// `devpost/spec.md > Responsive (v3)`.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { clampBubble } from '@/lib/bubble'
import type { BubbleLayout } from '@/lib/types'

type Props = {
  /** 1-based, as the page shows it. */
  panelNumber: number
  layout: BubbleLayout
  dialogue: string
  /** Each change, for the panel to show while the sheet is open. */
  onPreview: (layout: BubbleLayout, dialogue: string) => void
  onDone: (layout: BubbleLayout, dialogue: string) => void
  onCancel: () => void
}

/** One nudge, in % of the panel. */
const STEP = 4
/** How far past the rim the tail reaches, in % of the panel. */
const REACH = 12

type Dir = {
  key: string
  label: string
  glyph: string
  dx: number
  dy: number
}
const MOVES: (Dir & { edge: string })[] = [
  {
    key: 'up',
    edge: 'top',
    label: 'Move the bubble up',
    glyph: '↑',
    dx: 0,
    dy: -1,
  },
  {
    key: 'left',
    edge: 'left',
    label: 'Move the bubble left',
    glyph: '←',
    dx: -1,
    dy: 0,
  },
  {
    key: 'right',
    edge: 'right',
    label: 'Move the bubble right',
    glyph: '→',
    dx: 1,
    dy: 0,
  },
  {
    key: 'down',
    edge: 'bottom',
    label: 'Move the bubble down',
    glyph: '↓',
    dx: 0,
    dy: 1,
  },
]
// Reading order of the 3 × 3 pad, the middle left empty.
const TAILS: (Dir | null)[] = [
  { key: 'nw', label: 'up and left', glyph: '↖', dx: -1, dy: -1 },
  { key: 'n', label: 'up', glyph: '↑', dx: 0, dy: -1 },
  { key: 'ne', label: 'up and right', glyph: '↗', dx: 1, dy: -1 },
  { key: 'w', label: 'left', glyph: '←', dx: -1, dy: 0 },
  null,
  { key: 'e', label: 'right', glyph: '→', dx: 1, dy: 0 },
  { key: 'sw', label: 'down and left', glyph: '↙', dx: -1, dy: 1 },
  { key: 's', label: 'down', glyph: '↓', dx: 0, dy: 1 },
  { key: 'se', label: 'down and right', glyph: '↘', dx: 1, dy: 1 },
]

/** Two layouts are the same placement. */
export const sameLayout = (a: BubbleLayout, b: BubbleLayout) =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.tailX === b.tailX && a.tailY === b.tailY

function moved(l: BubbleLayout, dx: number, dy: number) {
  return clampBubble({ ...l, x: l.x + dx * STEP, y: l.y + dy * STEP })
}

function resized(l: BubbleLayout, k: number) {
  const w = l.w + k * STEP
  const h = l.h + k * (STEP * 0.75)
  return clampBubble({
    ...l,
    w,
    h,
    x: l.x + (l.w - w) / 2,
    y: l.y + (l.h - h) / 2,
  })
}

function pointed(l: BubbleLayout, dx: number, dy: number) {
  // Diagonals reach a little less, so the tip lands near the oval's own diagonal.
  const k = dx !== 0 && dy !== 0 ? 0.75 : 1
  return clampBubble({
    ...l,
    tailX: l.x + l.w / 2 + dx * (l.w / 2 + REACH) * k,
    tailY: l.y + l.h / 2 + dy * (l.h / 2 + REACH) * k,
  })
}

/** Which of the eight ways the tail points now. */
function tailKey(l: BubbleLayout) {
  const a = Math.atan2(l.tailY - (l.y + l.h / 2), l.tailX - (l.x + l.w / 2))
  const order = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne']
  return order[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]
}

/** The edges the bubble already touches, in words, for the shut arrows. */
function edges(l: BubbleLayout) {
  const at: string[] = []
  if (moved(l, 0, -1).y === l.y) at.push('top')
  if (moved(l, 0, 1).y === l.y) at.push('bottom')
  if (moved(l, -1, 0).x === l.x) at.push('left')
  if (moved(l, 1, 0).x === l.x) at.push('right')
  return at
}

export function BubbleEditSheet({ panelNumber, layout, dialogue, onPreview, onDone, onCancel }: Props) {
  const [draft, setDraft] = useState(layout)
  const [text, setText] = useState(dialogue)
  const sheetRef = useRef<HTMLDivElement>(null)
  const id = useId()

  const change = (next: BubbleLayout, words = text) => {
    setDraft(next)
    setText(words)
    onPreview(next, words)
  }
  const done = () => onDone(draft, text.trim())

  // The sheet takes focus (not the text field, so a phone's keyboard doesn't
  // cover the controls on open), and gives it back to the bubble on close.
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    sheetRef.current?.focus()
    return () => back?.focus?.()
  }, [])

  // Tab stays inside the sheet while it is open.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onCancel()
      return
    }
    if (e.key !== 'Tab' || !sheetRef.current) return
    const items = Array.from(
      sheetRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, [tabindex="0"]')
    )
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sheetRef.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const atEdges = edges(draft)
  const smaller = resized(draft, -1)
  const larger = resized(draft, 1)
  const canShrink = !sameLayout(smaller, draft)
  const canGrow = !sameLayout(larger, draft)
  const pointing = tailKey(draft)

  return createPortal(
    <div
      className="bubble-sheet-overlay"
      role="presentation"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) done()
      }}
    >
      <div
        ref={sheetRef}
        className="bubble-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="bubble-sheet-body">
          <div className="bubble-sheet-head">
            <h2 id={`${id}-title`} className="bubble-sheet-title">
              Panel {panelNumber} · the bubble
            </h2>
            <p className="helper">Changes show on the panel above as you make them.</p>
          </div>

          <label className="bubble-sheet-field">
            <span className="field-label">Words</span>
            <textarea
              className="bubble-sheet-text"
              rows={2}
              maxLength={500}
              value={text}
              placeholder="Say it…"
              onChange={(e) => change(draft, e.target.value)}
            />
          </label>

          <div className="bubble-sheet-groups">
            <fieldset className="bubble-sheet-group">
              <legend className="field-label">Move</legend>
              <div className="bubble-pad is-move">
                {MOVES.map((m) => {
                  const shut = moved(draft, m.dx, m.dy)
                  const stuck = sameLayout(shut, draft)
                  return (
                    <button
                      key={m.key}
                      type="button"
                      className={`bubble-pad-btn is-${m.key}`}
                      aria-label={stuck ? `${m.label} — it is at the ${m.edge} edge` : m.label}
                      title={stuck ? `The bubble is already at the ${m.edge} edge of the panel.` : m.label}
                      disabled={stuck}
                      onClick={() => change(shut)}
                    >
                      <span aria-hidden="true">{m.glyph}</span>
                    </button>
                  )
                })}
              </div>
              <p className="bubble-sheet-note" aria-live="polite">
                {atEdges.length > 0 ? `At the ${atEdges.join(' and ')} edge.` : ' '}
              </p>
            </fieldset>

            <fieldset className="bubble-sheet-group">
              <legend className="field-label">Tail points</legend>
              <div className="bubble-pad is-tail">
                {TAILS.map((t, i) =>
                  t ? (
                    <button
                      key={t.key}
                      type="button"
                      className="bubble-pad-btn"
                      aria-label={`Point the tail ${t.label}`}
                      aria-pressed={pointing === t.key}
                      onClick={() => change(pointed(draft, t.dx, t.dy))}
                    >
                      <span aria-hidden="true">{t.glyph}</span>
                    </button>
                  ) : (
                    <span key={`mid-${i}`} className="bubble-pad-mid" aria-hidden="true" />
                  )
                )}
              </div>
            </fieldset>

            <fieldset className="bubble-sheet-group">
              <legend className="field-label">Size</legend>
              <div className="bubble-size">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!canShrink}
                  title={canShrink ? 'Make the bubble smaller' : 'This is the smallest a bubble can be.'}
                  onClick={() => change(smaller)}
                >
                  Smaller
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!canGrow}
                  title={canGrow ? 'Make the bubble larger' : 'This is the largest a bubble can be.'}
                  onClick={() => change(larger)}
                >
                  Larger
                </button>
              </div>
              <p className="bubble-sheet-note" aria-live="polite">
                {!canShrink ? 'As small as it goes.' : !canGrow ? 'As large as it goes.' : ' '}
              </p>
            </fieldset>
          </div>
        </div>

        <div className="bubble-sheet-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={done}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

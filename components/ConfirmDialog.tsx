'use client'

// The confirmation the PRD requires before anything clears the desk: a paper
// card over a dimmed studio, one hanko-red confirm, cancel focused by default
// so Enter never destroys anything. Used by New chapter (the reader) and by
// accepting a new synopsis (the story station). A browser `confirm()` would
// neither match the studio nor stay scriptable.
// See `devpost/prd.md > States and Boundaries > New chapter`.
import { useEffect, useRef } from 'react'

type Props = {
  title: string
  body: string
  confirmLabel: string
  /** The clear is on the wire. */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ title, body, confirmLabel, busy = false, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => cancelRef.current?.focus(), [])

  return (
    <div
      className="confirm-overlay"
      role="presentation"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) onCancel()
      }}
    >
      <div className="confirm-card" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2 className="confirm-title">{title}</h2>
        <p className="confirm-body">{body}</p>
        <div className="confirm-actions">
          <button ref={cancelRef} type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>
            Keep this chapter
          </button>
          <button type="button" className="btn btn-stamp" disabled={busy} onClick={onConfirm}>
            {busy ? 'Clearing the desk…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

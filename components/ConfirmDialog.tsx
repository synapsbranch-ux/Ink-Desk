'use client'

// The confirmation the PRD requires before anything clears the desk: a paper
// card over a dimmed studio, one hanko-red confirm, cancel focused by default
// so Enter never destroys anything. Used by New chapter (the reader) and by
// accepting a new synopsis (the story station). A browser `confirm()` would
// neither match the studio nor stay scriptable.
// See `devpost/prd.md > States and Boundaries > New chapter`.
// Under 480 px it is a full-height sheet (slice 23, app/responsive/shell.css).
import { useEffect, useRef } from 'react'
import { useSheetViewport } from '@/components/use-sheet-viewport'

type Props = {
  title: string
  body: string
  confirmLabel: string
  /** The clear is on the wire. */
  busy?: boolean
  /** The safe choice's words — "Keep this chapter" unless the caller says otherwise. */
  cancelLabel?: string
  /** What the confirm says while it is on the wire. */
  busyLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy = false,
  cancelLabel = 'Keep this chapter',
  busyLabel = 'Clearing the desk…',
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => cancelRef.current?.focus(), [])
  const overlayRef = useRef<HTMLDivElement>(null)
  useSheetViewport(overlayRef)

  return (
    <div
      ref={overlayRef}
      className="confirm-overlay is-sheet"
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
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-stamp" disabled={busy} onClick={onConfirm}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

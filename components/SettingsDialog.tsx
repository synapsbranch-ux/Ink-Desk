'use client'

// A paper card over a dimmed studio for Settings' questions (v3, slice 21):
// Unpublish a link, Delete my account. It is the confirmation dialog's own
// frame (`.confirm-*`) with what a dialog owes a keyboard and a screen reader,
// which the plain confirmation does not need to do for its one question:
//
//   • focus moves in when it opens — to the element marked `data-autofocus`
//     (the safe choice, or the field to type in), else the card itself;
//   • Tab and Shift+Tab stay inside it;
//   • Escape closes it, unless the request it asked about is on the wire;
//   • focus goes back to the button that opened it when it closes;
//   • it is a `role="alertdialog"` named by its title.
// Pressing the dimmed backdrop closes it too, again unless busy. The page behind
// stays put (the overlay is fixed); the card scrolls inside itself when a phone
// is shorter than it is.
import { useEffect, useId, useRef } from 'react'

export function SettingsDialog({
  title,
  busy = false,
  onClose,
  children,
}: {
  title: string
  /** The thing it asked about is on the wire: it cannot be dismissed until it answers. */
  busy?: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  const id = useId()
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const card = cardRef.current
    const first = card?.querySelector<HTMLElement>('[data-autofocus]')
    if (first) first.focus()
    else card?.focus()
    return () => returnTo?.focus()
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      if (!busy) onClose()
      return
    }
    if (e.key !== 'Tab') return
    const items = Array.from(cardRef.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? [])
    if (items.length === 0) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === cardRef.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="confirm-overlay"
      role="presentation"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={cardRef}
        className="confirm-card settings-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-busy={busy}
        tabIndex={-1}
      >
        <h2 id={`${id}-title`} className="confirm-title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}

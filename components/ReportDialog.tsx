'use client'

// The Report button of a shared page and the dialog behind it (v3, slice 21).
// Anyone holding the link can use it — no sign-in, no account: it posts to the
// public `POST /api/s/[token]/report`. A reason (one of five, as radios) and an
// optional note of up to 500 characters; the visitor is thanked and is never
// told what became of the report. See `devpost/prd.md > Report (v3)`.
//
//   • An accessible modal: `role="dialog"` with `aria-modal`, labelled by its
//     heading and described by its lede; focus goes to the first reason on
//     opening, Tab and Shift+Tab stay inside it, Escape and a press on the dimmed
//     page close it (not while a report is on the wire), and focus returns to the
//     Report button. It is drawn in a portal on <body>, so no ancestor's overflow
//     or transform can clip or trap it, and the page behind does not scroll.
//   • Four states, each a sentence with a way forward: the form; a thank-you
//     (`role="status"`); the address's hourly window being full, with the time to
//     wait (`role="alert"`, from the server's `Retry-After`/`retryAfterSec`); and
//     a calm error that keeps what was typed, so Send can simply be pressed again.
//   • Under 480 px it is a full-height sheet, fitted to what a phone's keyboard
//     leaves visible (`useSheetViewport`). Every control is at least 44 px tall.
//
// The server answers the same "thanks" for a share that is live, taken down or
// never existed, so nothing here can tell the visitor which it was.
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSheetViewport } from '@/components/use-sheet-viewport'
import { REPORT_NOTE_MAX, REPORT_REASON_HINT, REPORT_REASON_LABEL, waitWords } from '@/lib/share/report-copy'
import { REPORT_REASONS, type ReportReason } from '@/lib/share/types'
import './report-dialog.css'

type View = { kind: 'form' } | { kind: 'thanks' } | { kind: 'limited'; waitSec: number }

const FAILED = 'Your report couldn’t be sent just now. Try again in a little while.'
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'

export function ReportDialog({ token }: { token: string }) {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button ref={opener} type="button" className="btn btn-secondary report-open" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Report
      </button>
      {open &&
        createPortal(
          <ReportSheet
            token={token}
            onClose={() => {
              setOpen(false)
              // Back to the button that opened it, once the dialog is gone.
              requestAnimationFrame(() => opener.current?.focus())
            }}
          />,
          document.body
        )}
    </>
  )
}

function ReportSheet({ token, onClose }: { token: string; onClose: () => void }) {
  const ids = useId()
  const titleId = `${ids}-title`
  const ledeId = `${ids}-lede`
  const noteId = `${ids}-note`
  const countId = `${ids}-count`
  const [view, setView] = useState<View>({ kind: 'form' })
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const card = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const firstReason = useRef<HTMLInputElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const request = useRef<AbortController | null>(null)

  // Under 480 px the sheet fits what the keyboard leaves visible, so Send is never under the keys.
  useSheetViewport(overlay)

  // The page behind stays put while the dialog is up; focus starts on the first reason.
  useEffect(() => {
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    firstReason.current?.focus()
    return () => {
      document.body.style.overflow = before
      request.current?.abort()
    }
  }, [])

  // When the form is replaced by a message, focus would be lost with the buttons that went: put it on Close.
  useEffect(() => {
    if (view.kind !== 'form') closeButton.current?.focus()
  }, [view.kind])

  function keys(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && !sending) {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !card.current) return
    const stops = [...card.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (stops.length === 0) return
    const first = stops[0]
    const last = stops[stops.length - 1]
    const here = document.activeElement
    if (e.shiftKey && (here === first || !card.current.contains(here))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (here === last || !card.current.contains(here))) {
      e.preventDefault()
      first.focus()
    }
  }

  async function send() {
    if (!reason || sending) return
    setSending(true)
    setError('')
    const controller = new AbortController()
    request.current = controller
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(token)}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note.trim() ? { reason, note } : { reason }),
        signal: controller.signal,
      })
      if (res.ok) {
        setView({ kind: 'thanks' })
        return
      }
      const body = (await res.json().catch(() => null)) as { error?: unknown; retryAfterSec?: unknown } | null
      if (res.status === 429) {
        const header = Number(res.headers.get('Retry-After'))
        const waitSec = typeof body?.retryAfterSec === 'number' ? body.retryAfterSec : Number.isFinite(header) && header > 0 ? header : 60
        setView({ kind: 'limited', waitSec })
        return
      }
      setError(typeof body?.error === 'string' && body.error.length <= 200 ? body.error : FAILED)
    } catch (err) {
      if (controller.signal.aborted && err instanceof DOMException && err.name === 'AbortError') return // the dialog closed
      setError(FAILED)
    } finally {
      if (!controller.signal.aborted) setSending(false)
    }
  }

  const left = REPORT_NOTE_MAX - note.length
  // The counter is read aloud only when it matters, not on every keystroke.
  const countAnnouncement = left <= 50 && (left % 10 === 0 || left <= 5) ? `${left} ${left === 1 ? 'character' : 'characters'} left` : ''

  return (
    <div
      ref={overlay}
      className="report-overlay"
      role="presentation"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !sending) onClose()
      }}
      onKeyDown={keys}
    >
      <div
        ref={card}
        className="report-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={view.kind === 'form' ? ledeId : undefined}
      >
        {view.kind === 'form' && (
          <form
            className="report-form"
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <h2 id={titleId} className="report-title">
              Report this page
            </h2>
            <p id={ledeId} className="report-lede">
              Tell the studio what is wrong with this page. You won’t be told what happens next.
            </p>

            <fieldset className="report-reasons" disabled={sending}>
              <legend className="report-legend">Why are you reporting it?</legend>
              {REPORT_REASONS.map((value, i) => (
                <label key={value} className={`report-reason${reason === value ? ' is-selected' : ''}`}>
                  <input
                    ref={i === 0 ? firstReason : undefined}
                    type="radio"
                    name={`${ids}-reason`}
                    value={value}
                    checked={reason === value}
                    onChange={() => setReason(value)}
                  />
                  <span className="report-reason-text">
                    <span className="report-reason-label">{REPORT_REASON_LABEL[value]}</span>
                    <span className="report-reason-hint">{REPORT_REASON_HINT[value]}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="report-note">
              <label htmlFor={noteId} className="report-legend">
                Anything we should know? <span className="report-optional">Optional</span>
              </label>
              <textarea
                id={noteId}
                className="input report-textarea"
                rows={4}
                maxLength={REPORT_NOTE_MAX}
                value={note}
                disabled={sending}
                aria-describedby={countId}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="report-count" id={countId}>
                <span aria-hidden="true" className={left <= 50 ? 'is-near' : undefined}>
                  {note.length} / {REPORT_NOTE_MAX}
                </span>
                <span className="sr-only">Up to {REPORT_NOTE_MAX} characters.</span>
              </div>
              <span className="sr-only" role="status" aria-live="polite">
                {countAnnouncement}
              </span>
            </div>

            {error && (
              <p className="notice report-error" role="alert">
                {error}
              </p>
            )}

            <div className="report-actions">
              <button type="button" className="btn btn-secondary report-btn" disabled={sending} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-stamp report-btn" disabled={!reason || sending} aria-describedby={reason ? undefined : `${ids}-pick`}>
                {sending ? 'Sending…' : 'Send report'}
              </button>
            </div>
            {!reason && (
              <p className="report-hint" id={`${ids}-pick`}>
                Choose the closest reason to send.
              </p>
            )}
          </form>
        )}

        {view.kind === 'thanks' && (
          <div className="report-form">
            <h2 id={titleId} className="report-title">
              Thank you
            </h2>
            <p className="report-lede" role="status">
              Your report has been received. You won’t hear back about what is done, but it will be read.
            </p>
            <div className="report-actions">
              <button ref={closeButton} type="button" className="btn btn-primary report-btn" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}

        {view.kind === 'limited' && (
          <div className="report-form">
            <h2 id={titleId} className="report-title">
              That’s enough for now
            </h2>
            <p className="report-lede" role="alert">
              You’ve sent a few reports in a short while, so this one wasn’t sent. You can send another in {waitWords(view.waitSec)}.
            </p>
            <div className="report-actions">
              <button ref={closeButton} type="button" className="btn btn-primary report-btn" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

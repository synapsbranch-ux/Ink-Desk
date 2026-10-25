'use client'

// The trailer player and what a person can do with a finished trailer (v3,
// slice 22). Three pieces that every screen showing a trailer shares, so the
// studio's Animate station, the dashboard's Play button and the public share
// page cannot drift apart:
//
//   • `VideoPlayer` — the browser's own <video controls playsInline
//     preload="metadata" poster>, with a captions <track kind="captions"
//     default> when the trailer has them. Native controls on purpose: they are
//     keyboard- and screen-reader-complete, and iOS Safari plays inline only
//     with `playsInline` and a server that answers HTTP Range. Nothing starts
//     by itself. A file that cannot be played says so in a sentence with a way
//     forward instead of showing a black box.
//   • `VideoDialog` — a paper card over a dimmed page that holds a player (the
//     dashboard's Play); under 480 px a full-height sheet. It is the dialog the studio's others are: focus moves
//     in, Tab stays inside, Escape and a press on the dimmed page close it, and
//     focus goes back to the button that opened it. Drawn in a portal on <body>
//     so no ancestor's overflow can clip it.
//   • `VideoActions` — Share for a finished trailer: it opens the Share dialog in
//     its video form, and knows whether the trailer is shared (one read when it
//     mounts, then whatever the dialog says).
//
// Nothing here knows a key, a cost or an owner: the addresses come from the
// `VideoView` / `VideoSummary` the server sent. Implements `devpost/prd.md >
// Animate a Page (v3)` and `> Responsive (v3)`.
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch } from '@/components/api-fetch'
import { ShareDialog } from '@/components/ShareDialog'
import { useSheetViewport } from '@/components/use-sheet-viewport'
import type { ShareView } from '@/lib/share/types'

const CANT_PLAY = 'This video can’t be played just now. Try again in a moment.'

// --- The player -------------------------------------------------------------------------------

type PlayerProps = {
  /** The trailer file's address (`final.mp4`): the owner's route in the studio, the share's route on a public page. */
  src: string
  poster: string | null
  /** The captions file's address, when the trailer has them. */
  captions: string | null
  /** What the player is called to a screen reader. */
  title: string
}

export function VideoPlayer({ src, poster, captions, title }: PlayerProps) {
  // A failed load shows its sentence and Try again, which mounts a fresh element (the key) so the browser asks again.
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  return (
    <div className="video-player">
      {failed ? (
        <div className="video-player-fail" role="alert">
          <p>{CANT_PLAY}</p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setFailed(false)
              setAttempt((n) => n + 1)
            }}
          >
            Try again
          </button>
        </div>
      ) : (
        <video
          key={`${src}:${attempt}`}
          className="video-player-media"
          src={src}
          poster={poster ?? undefined}
          controls
          playsInline
          preload="metadata"
          aria-label={title}
          onError={() => setFailed(true)}
        >
          {captions && <track kind="captions" src={captions} srcLang="en" label="English" default />}
        </video>
      )}
    </div>
  )
}

// --- The dialog ---------------------------------------------------------------------------------

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), video[controls], [tabindex="0"]'

/** A player in a card over a dimmed page. `children` sit under the player (the trailer's actions). */
export function VideoDialog({ title, onClose, children }: { title: string; onClose: () => void; children?: React.ReactNode }) {
  const id = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  // Under 480 px the dialog is a full-height sheet over the whole screen, like the studio's other dialogs.
  useSheetViewport(overlayRef)

  useEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const card = cardRef.current
    // The close button is the first stop; focus starts there, not on the video, so Space does not start a trailer by surprise.
    const first = card?.querySelector<HTMLElement>('[data-autofocus]')
    if (first) first.focus()
    else card?.focus()
    return () => {
      document.body.style.overflow = before
      // Back to the button that opened it.
      returnTo?.focus()
    }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    // A dialog drawn from inside this one (Share, Remove) is a React child but not a DOM one: its keys are its own.
    if (!cardRef.current?.contains(e.target as Node)) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const items = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
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

  return createPortal(
    <div
      ref={overlayRef}
      className="confirm-overlay is-sheet"
      role="presentation"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={onKeyDown}
    >
      <div ref={cardRef} className="confirm-card video-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}>
        <div className="video-dialog-head">
          <h2 id={`${id}-title`} className="confirm-title">
            {title}
          </h2>
          <button type="button" className="btn btn-secondary" data-autofocus onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}

// --- Share ------------------------------------------------------------------------------------

type ActionsProps = {
  videoId: string
  /** The trailer is finished, so there is something to share. */
  shareable: boolean
  className?: string
}

export function VideoActions({ videoId, shareable, className = '' }: ActionsProps) {
  const base = `/api/videos/${encodeURIComponent(videoId)}`
  const [sharing, setSharing] = useState(false)
  const [shared, setShared] = useState<boolean | null>(null)

  // Is it shared already? One read; the dialog reports every change after it. A failed read leaves the button as "Share", which is still true to what it does.
  useEffect(() => {
    if (!shareable) return
    let alive = true
    apiFetch(`${base}/share`, { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { share?: ShareView | null } | null
        if (alive && res.ok && body && 'share' in body) setShared(Boolean(body.share))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [base, shareable])

  if (!shareable) return null
  return (
    <div className={`video-actions ${className}`.trim()}>
      <div className="video-actions-row">
        <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => setSharing(true)}>
          {shared ? 'Share link…' : 'Share…'}
        </button>
        {shared && (
          <span className="tag tag-outline" title="Anyone with its link can watch this trailer">
            Shared
          </span>
        )}
      </div>
      {sharing &&
        createPortal(
          <ShareDialog videoId={videoId} readable={shareable} onChange={(share) => setShared(Boolean(share))} onClose={() => setSharing(false)} />,
          document.body
        )}
    </div>
  )
}

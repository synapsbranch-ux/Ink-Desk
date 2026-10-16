'use client'

// Share publicly (v3, slice 21): the Reader station's door to a public link. A
// paper card over a dimmed studio, in the confirmation dialog's own frame. It
// asks the server what the project's share is (`GET /api/projects/<id>/share`)
// and shows exactly one of:
//
//   • loading, or a calm sentence with Try again if that failed;
//   • not shared — one honest paragraph on what a link holds (the cover, the
//     title, the finished pages — nothing else of yours) and **Share publicly**,
//     disabled with its reason when there is nothing readable yet;
//   • shared — the link with **Copy** (the clipboard, or the field selected for
//     a manual copy where the clipboard is not available), **Update share** when
//     the chapter has changed since the snapshot, and **Unpublish**, which asks
//     first: the address is dead for good and sharing again makes a new one.
//
// Focus is managed the way a dialog should: it moves in when the card opens,
// Tab stays inside, Escape closes (or backs out of the Unpublish question), and
// focus returns to the button that opened it. Results are announced
// (`role="status"` / `role="alert"`). Every failure ends in a sentence with a way
// forward. Implements `devpost/prd.md > Sharing (v3)`.
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/components/api-fetch'
import type { ShareView } from '@/lib/share/types'
import '../app/s/share.css'

type Props = {
  projectId: string
  /** The chapter has a drawn cover or a complete page, so there is something to publish. */
  readable: boolean
  onClose: () => void
}

type Busy = 'create' | 'update' | 'unpublish' | null

const NOTHING_YET = 'There’s nothing to share yet. Ink the cover or a whole page first, then share it.'
const READ_FAILED = 'The share couldn’t be read just now. Try again in a moment.'
const FAILED: Record<Exclude<Busy, null>, string> = {
  create: 'The link couldn’t be made just now. Try again in a moment.',
  update: 'The share couldn’t be updated just now. Try again in a moment.',
  unpublish: 'The link couldn’t be taken down just now. Try again in a moment — it is still live until it is.',
}

/** The server's own sentence when it sent one (a 409 says why), else ours. */
async function sentenceOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === 'string' && body.error.length > 0 && body.error.length < 300 ? body.error : fallback
}

export function ShareDialog({ projectId, readable, onClose }: Props) {
  const url = `/api/projects/${encodeURIComponent(projectId)}/share`
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [share, setShare] = useState<ShareView | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [copied, setCopied] = useState<'yes' | 'by-hand' | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const linkRef = useRef<HTMLInputElement>(null)
  const opener = useRef<HTMLElement | null>(null)

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await apiFetch(url)
      const body = (await res.json().catch(() => null)) as { share?: ShareView | null } | null
      if (!res.ok || !body || !('share' in body)) throw new Error('unreadable')
      setShare(body.share ?? null)
      setState('ready')
    } catch {
      setState('failed')
    }
  }, [url])

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const returnTo = opener.current
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the dialog reads its state from the server once it opens
    void load()
    return () => returnTo?.focus()
  }, [load])

  // Focus moves into the card when it opens, and again when what it shows changes (the link, the question).
  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    // While it loads, the card itself holds focus (so Tab and Escape already belong to it); once it shows something, focus goes to its first control.
    if (state === 'loading') {
      card.focus()
      return
    }
    if (card.contains(document.activeElement) && document.activeElement !== card) return
    const first = card.querySelector<HTMLElement>('[data-autofocus]')
    if (first) first.focus()
    else card.focus()
  }, [state, share, asking])

  const act = async (what: Exclude<Busy, null>) => {
    setBusy(what)
    setProblem(null)
    setCopied(null)
    try {
      const res = await apiFetch(url, { method: what === 'create' ? 'POST' : what === 'update' ? 'PUT' : 'DELETE' })
      const body = (await res.json().catch(() => null)) as { share?: ShareView | null } | null
      if (!res.ok || !body || !('share' in body)) {
        setProblem(await sentenceOf(res, FAILED[what]))
        return
      }
      setShare(body.share ?? null)
      setAsking(false)
    } catch {
      setProblem(FAILED[what])
    } finally {
      setBusy(null)
    }
  }

  const copy = async () => {
    if (!share) return
    try {
      await navigator.clipboard.writeText(share.url)
      setCopied('yes')
    } catch {
      // No clipboard here (an insecure address, a blocked permission): select the link so Ctrl+C / Cmd+C finishes the job.
      linkRef.current?.focus()
      linkRef.current?.select()
      setCopied('by-hand')
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      if (busy) return
      if (asking) setAsking(false)
      else onClose()
      return
    }
    if (e.key !== 'Tab') return
    // Tab stays inside the card.
    const items = Array.from(cardRef.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input, [tabindex="0"]') ?? [])
    if (items.length === 0) return
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
        className="confirm-card share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        aria-busy={busy !== null || state === 'loading'}
        tabIndex={-1}
      >
        <h2 id="share-dialog-title" className="confirm-title">
          Share publicly
        </h2>

        {state === 'loading' && (
          <p className="confirm-body" role="status">
            Looking for the link…
          </p>
        )}

        {state === 'failed' && (
          <>
            <p className="notice" role="alert">
              {READ_FAILED}
            </p>
            <div className="confirm-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Close
              </button>
              <button type="button" className="btn btn-primary" data-autofocus onClick={() => void load()}>
                Try again
              </button>
            </div>
          </>
        )}

        {state === 'ready' && !share && (
          <>
            <p className="confirm-body">
              Anyone with the link can read this chapter: its title, its cover and its finished pages, with the lettering. Nothing else of
              yours goes with it: not your story notes, your characters’ descriptions, your costs or your name. Later changes don’t reach
              the link until you update it, and you can take it down whenever you like.
            </p>
            {!readable && (
              <p className="notice" id="share-reason">
                {NOTHING_YET}
              </p>
            )}
            {problem && (
              <p className="notice" role="alert">
                {problem}
              </p>
            )}
            <div className="confirm-actions">
              <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                className="btn btn-stamp"
                data-autofocus={readable ? true : undefined}
                disabled={busy !== null || !readable}
                aria-describedby={readable ? undefined : 'share-reason'}
                title={readable ? undefined : NOTHING_YET}
                onClick={() => void act('create')}
              >
                {busy === 'create' ? 'Making the link…' : 'Share publicly'}
              </button>
            </div>
          </>
        )}

        {state === 'ready' && share && !asking && (
          <>
            <p className="confirm-body">
              Anyone with this link can read “{share.title}”
              {share.pages > 0 ? ` — ${share.pages} ${share.pages === 1 ? 'page' : 'pages'}` : ''}. Shared{' '}
              {new Date(share.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}.
            </p>
            <div className="share-link-row">
              <label className="field share-link-field">
                <span className="field-label">Link</span>
                <input
                  ref={linkRef}
                  className="input share-link"
                  readOnly
                  value={share.url}
                  onFocus={(e) => e.currentTarget.select()}
                  data-autofocus
                />
              </label>
              <button type="button" className="btn btn-primary share-copy" onClick={() => void copy()}>
                {copied === 'yes' ? 'Copied' : 'Copy link'}
              </button>
            </div>
            <p className="helper share-status" role="status">
              {copied === 'yes' ? 'The link is on your clipboard.' : copied === 'by-hand' ? 'Your browser wouldn’t copy it. The link is selected: press Ctrl+C (Cmd+C on a Mac).' : ''}
            </p>
            <a className="share-open" href={share.path} target="_blank" rel="noopener noreferrer">
              Open the page ↗
            </a>
            {share.stale && (
              <p className="notice" id="share-stale">
                The chapter has changed since you shared it. Readers still see the earlier version until you update the share.
              </p>
            )}
            {share.stale && !readable && <p className="notice">{NOTHING_YET}</p>}
            {problem && (
              <p className="notice" role="alert">
                {problem}
              </p>
            )}
            <div className="confirm-actions share-actions">
              <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => setAsking(true)}>
                Unpublish
              </button>
              {share.stale && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy !== null || !readable}
                  aria-describedby="share-stale"
                  onClick={() => void act('update')}
                >
                  {busy === 'update' ? 'Updating…' : 'Update share'}
                </button>
              )}
              <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}

        {state === 'ready' && share && asking && (
          <>
            <p className="confirm-body" id="share-unpublish-body">
              Unpublish this link? Anyone who has it will see “not found” straight away. The link can’t be brought back; sharing again
              makes a new one.
            </p>
            {problem && (
              <p className="notice" role="alert">
                {problem}
              </p>
            )}
            <div className="confirm-actions">
              <button type="button" className="btn btn-secondary" data-autofocus disabled={busy !== null} onClick={() => setAsking(false)}>
                Keep it shared
              </button>
              <button
                type="button"
                className="btn btn-stamp"
                aria-describedby="share-unpublish-body"
                disabled={busy !== null}
                onClick={() => void act('unpublish')}
              >
                {busy === 'unpublish' ? 'Taking it down…' : 'Unpublish'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

'use client'

// Settings › Sharing (v3, slice 21): everything this person has published, with
// its link and the three things they can do about it — Copy link, Update share
// (retake the snapshot from the project as it is now) and Unpublish (after an
// explicit question, because the address is dead for good). The list is the
// caller's ACTIVE shares from `GET /api/shares`; a revoked one is gone from it.
//
// States: a skeleton while it loads; a sentence with Try again if the list
// could not be read; an empty state that says how a share is made; and the
// rows. Each row keeps its own busy state and its own note (role="status", or
// "alert" for a failure), so one slow request never freezes the rest. The link
// is a read-only field, so when the clipboard is not available (an insecure
// address, a blocked permission) the person can still select and copy it.
// Pictures are the owner's image route, never a bucket address. Implements
// `devpost/prd.md > Settings (v3)` (Sharing) and `> Sharing (v3)`.
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/components/api-fetch'
import { SettingsDialog } from '@/components/SettingsDialog'
import { imageUrl } from '@/lib/image-url'
import type { ShareView } from '@/lib/share/types'

const LIST_FAILED = 'Your shared links couldn’t be listed just now. Try again in a moment.'
const UPDATE_FAILED = 'The share couldn’t be updated just now. Try again in a moment.'
const UNPUBLISH_FAILED = 'The link couldn’t be taken down just now. Try again in a moment — it is still live until it is.'

type Note = { kind: 'ok' | 'error'; text: string }

/** The server's own sentence when it sent a short one, else ours. */
async function sentenceOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === 'string' && body.error.length > 0 && body.error.length < 300 ? body.error : fallback
}

function day(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function SettingsSharing() {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [shares, setShares] = useState<ShareView[]>([])
  const [busy, setBusy] = useState<Record<string, 'update' | 'unpublish'>>({})
  const [notes, setNotes] = useState<Record<string, Note>>({})
  const [asking, setAsking] = useState<ShareView | null>(null)
  const [announce, setAnnounce] = useState('')
  const headRef = useRef<HTMLHeadingElement>(null)
  const links = useRef<Record<string, HTMLInputElement | null>>({})

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await apiFetch('/api/shares')
      const body = (await res.json().catch(() => null)) as { shares?: ShareView[] } | null
      if (!res.ok || !body || !Array.isArray(body.shares)) throw new Error('unreadable')
      setShares(body.shares)
      setState('ready')
    } catch {
      setState('failed')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the list is read from the server once the page opens
    void load()
  }, [load])

  const note = (token: string, n: Note | null) =>
    setNotes((all) => {
      const next = { ...all }
      if (n) next[token] = n
      else delete next[token]
      return next
    })
  const working = (token: string, what: 'update' | 'unpublish' | null) =>
    setBusy((all) => {
      const next = { ...all }
      if (what) next[token] = what
      else delete next[token]
      return next
    })

  const copy = async (share: ShareView) => {
    try {
      await navigator.clipboard.writeText(share.url)
      note(share.token, { kind: 'ok', text: 'Link copied.' })
    } catch {
      // No clipboard here: select the link so Ctrl+C / Cmd+C finishes the job.
      const field = links.current[share.token]
      field?.focus()
      field?.select()
      note(share.token, { kind: 'ok', text: 'The link is selected: copy it with Ctrl+C or Cmd+C.' })
    }
  }

  const update = async (share: ShareView) => {
    if (!share.projectId) return
    working(share.token, 'update')
    note(share.token, null)
    try {
      const res = await apiFetch(`/api/projects/${encodeURIComponent(share.projectId)}/share`, { method: 'PUT' })
      const body = (await res.json().catch(() => null)) as { share?: ShareView | null } | null
      if (!res.ok || !body?.share) {
        note(share.token, { kind: 'error', text: await sentenceOf(res, UPDATE_FAILED) })
        return
      }
      const fresh = body.share
      setShares((all) => all.map((s) => (s.token === share.token ? fresh : s)))
      note(share.token, { kind: 'ok', text: 'Updated: the link now shows the chapter as it is today.' })
    } catch {
      note(share.token, { kind: 'error', text: UPDATE_FAILED })
    } finally {
      working(share.token, null)
    }
  }

  const unpublish = async (share: ShareView) => {
    working(share.token, 'unpublish')
    try {
      const res = await apiFetch(`/api/shares/${encodeURIComponent(share.token)}`, { method: 'DELETE' })
      if (!res.ok) {
        note(share.token, { kind: 'error', text: await sentenceOf(res, UNPUBLISH_FAILED) })
        setAsking(null)
        return
      }
      setShares((all) => all.filter((s) => s.token !== share.token))
      note(share.token, null)
      setAnnounce(`Unpublished “${share.title}”. Its link no longer works.`)
      setAsking(null)
      // The row that held focus is gone: the heading is the calm place to land.
      requestAnimationFrame(() => headRef.current?.focus())
    } catch {
      note(share.token, { kind: 'error', text: UNPUBLISH_FAILED })
      setAsking(null)
    } finally {
      working(share.token, null)
    }
  }

  return (
    <section aria-labelledby="sharing-title" className="data-stack">
      <h2 id="sharing-title" ref={headRef} tabIndex={-1} className="sr-only">
        Your shared links
      </h2>
      <p className="sr-only" role="status">
        {announce}
      </p>

      {state === 'loading' && (
        <div className="share-list" aria-busy="true" aria-label="Loading your shared links">
          <span className="share-skeleton" />
          <span className="share-skeleton" />
        </div>
      )}

      {state === 'failed' && (
        <div className="notice cast-notice" role="alert">
          <span>{LIST_FAILED}</span>
          <button type="button" className="btn btn-secondary" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {state === 'ready' && shares.length === 0 && (
        <div className="card settings-card">
          <h2 className="settings-card-title">Nothing is shared</h2>
          <p className="settings-note">
            A shared link lets anyone with it read a finished chapter, without an account. To make one, open a project, go to Ink &amp;
            Publish and choose Share publicly.
          </p>
          <div className="settings-actions">
            <Link className="btn btn-primary" href="/">
              Go to the desk
            </Link>
          </div>
        </div>
      )}

      {state === 'ready' && shares.length > 0 && (
        <ul className="share-list" aria-label="Shared links">
          {shares.map((share) => {
            const what = busy[share.token]
            const n = notes[share.token]
            const canUpdate = share.kind === 'manga' && share.projectId !== null
            const updated = share.updatedAt !== share.createdAt ? day(share.updatedAt) : ''
            return (
              <li key={share.token} className="card share-row">
                <div className="share-row-thumb">
                  {share.cover && share.projectId ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the owner's picture, served by id
                    <img src={imageUrl(share.projectId, share.cover)} alt="" loading="lazy" />
                  ) : (
                    <span>No cover</span>
                  )}
                </div>
                <div className="share-row-body">
                  <div className="share-row-title">{share.title}</div>
                  <div className="share-row-meta">
                    <span className="tag tag-neutral">{share.kind === 'video' ? 'Trailer' : 'Manga'}</span>
                    {share.kind === 'manga' && (
                      <span>{share.pages === 0 ? 'Cover only' : `${share.pages} ${share.pages === 1 ? 'page' : 'pages'}`}</span>
                    )}
                    <span>Shared {day(share.createdAt)}</span>
                    {updated && <span>Updated {updated}</span>}
                    {share.stale && <span className="tag tag-outline">Changed since shared</span>}
                  </div>
                  <input
                    ref={(el) => {
                      links.current[share.token] = el
                    }}
                    className="input share-row-link"
                    readOnly
                    value={share.url}
                    aria-label={`Link to ${share.title}`}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <div className="share-row-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => void copy(share)}>
                      Copy link
                    </button>
                    {canUpdate && (
                      <button
                        type="button"
                        className={`btn ${share.stale ? 'btn-primary' : 'btn-secondary'}`}
                        disabled={Boolean(what)}
                        title="Retake the link’s copy of the chapter from the project as it is now"
                        onClick={() => void update(share)}
                      >
                        {what === 'update' ? 'Updating…' : 'Update share'}
                      </button>
                    )}
                    <a className="btn btn-secondary" href={share.path} target="_blank" rel="noopener noreferrer">
                      Open<span className="sr-only"> {share.title} in a new tab</span>
                    </a>
                    <button type="button" className="btn btn-ghost" disabled={Boolean(what)} onClick={() => setAsking(share)}>
                      Unpublish
                    </button>
                  </div>
                  <p className={`share-row-note${n?.kind === 'error' ? ' is-error' : ''}`} role={n?.kind === 'error' ? 'alert' : 'status'}>
                    {n?.text}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {asking && (
        <SettingsDialog title="Unpublish this link?" busy={Boolean(busy[asking.token])} onClose={() => setAsking(null)}>
          <p className="confirm-body">
            <strong>{asking.title}</strong> will stop working at once: anyone who opens the link sees the same “not found” page as for a
            link that never existed. This can’t be undone — sharing the chapter again makes a new link.
          </p>
          <div className="confirm-actions">
            <button type="button" className="btn btn-secondary" data-autofocus disabled={Boolean(busy[asking.token])} onClick={() => setAsking(null)}>
              Keep it shared
            </button>
            <button type="button" className="btn btn-stamp" disabled={Boolean(busy[asking.token])} onClick={() => void unpublish(asking)}>
              {busy[asking.token] === 'unpublish' ? 'Taking it down…' : 'Unpublish'}
            </button>
          </div>
        </SettingsDialog>
      )}
    </section>
  )
}

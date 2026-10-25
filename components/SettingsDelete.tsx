'use client'

// Settings › Data and privacy › Delete my account (v3, slice 21). The one thing
// in Settings that cannot be taken back, so it is fenced off — its own card
// with a hanko rule, below the export — and asks twice: the button opens a
// dialog that NAMES what goes (projects and their pictures, videos, shared
// links, queued work, export files, usage counters, settings) and what stays
// (a minimal record of the account, anonymous spend totals, logs and backups
// until they expire, and rarely a picture no record names), and the confirm
// stays shut until the person has typed `delete my account`. The server checks
// the same phrase again.
//
// Deleting is a background job (`POST /api/settings/delete`, 202): it removes
// the work first and the sign-in last, so this panel polls
// (`GET /api/settings/delete`) and, when it is done — or when the session has
// already gone, a 401 — sends the browser to sign-in. A reload mid-way picks
// the same state up from the server. A failure ends in the server's sentence and
// a Try again that reopens the question; the job is safe to repeat.
//
// On a desk with sign-in off there is no account to delete, and deleting would
// wipe the one local desk: the card says it is unavailable and offers nothing.
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/components/api-fetch'
import { SettingsDialog } from '@/components/SettingsDialog'
import { useBackoffPoll, type PollResult } from '@/components/settings-poll'

/** The phrase to type; compared case-insensitively and trimmed, as the server does. */
export const DELETE_PHRASE = 'delete my account'

const GOES = [
  'Your projects and every picture in them',
  'Your videos',
  'Your shared links, which stop working at once',
  'Any work still waiting in the queue',
  'Your export files',
  'Your usage counters and your settings',
]

type DeleteView = { state: 'none' | 'working' | 'done' | 'failed'; error?: string }

const READ_FAILED = 'We couldn’t check whether a deletion is under way just now. Reload this page in a moment.'
const START_FAILED = 'The deletion couldn’t be started just now. Nothing was removed; try again in a moment.'
const JOB_FAILED = 'The deletion stopped before it finished. Nothing is lost by trying again: it picks up where it left off.'

function isView(x: unknown): x is DeleteView {
  const state = (x as { state?: unknown } | null)?.state
  return state === 'none' || state === 'working' || state === 'done' || state === 'failed'
}

/** The account is gone: the browser goes to sign-in, a full load so nothing of the old session is kept. */
function leave(): void {
  window.location.assign(new URL('/sign-in', window.location.origin))
}

export function SettingsDelete({ available }: { available: boolean }) {
  const [phase, setPhase] = useState<'checking' | 'idle' | 'working' | 'failed' | 'gone'>(available ? 'checking' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [typed, setTyped] = useState('')
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [quiet, setQuiet] = useState(0)
  /** We started it in this page: a deletion that is no longer on record has finished. */
  const started = useRef(false)

  // A plain fetch, not `apiFetch`: once the sign-in is ended a 401 means "done", not "go sign in and come back here".
  const read = useCallback(async (): Promise<DeleteView | 'signed-out' | null> => {
    try {
      const res = await fetch('/api/settings/delete', { cache: 'no-store' })
      if (res.status === 401) return 'signed-out'
      const body: unknown = await res.json().catch(() => null)
      return res.ok && isView(body) ? body : null
    } catch {
      return null
    }
  }, [])

  const apply = useCallback((v: DeleteView | 'signed-out'): PollResult => {
    if (v === 'signed-out' || v.state === 'done' || (v.state === 'none' && started.current)) {
      setPhase('gone')
      leave()
      return 'stop'
    }
    if (v.state === 'working') {
      setPhase('working')
      return 'again'
    }
    if (v.state === 'failed') {
      setError(v.error && v.error.length < 300 ? v.error : JOB_FAILED)
      setPhase('failed')
      return 'stop'
    }
    setPhase('idle')
    return 'stop'
  }, [])

  useEffect(() => {
    if (!available) return
    let live = true
    void read().then((v) => {
      if (!live) return
      if (v) apply(v)
      else {
        setPhase('idle')
        setProblem(READ_FAILED)
      }
    })
    return () => {
      live = false
    }
  }, [available, read, apply])

  useBackoffPoll(async (): Promise<PollResult> => {
    const v = await read()
    if (!v) {
      setQuiet((n) => n + 1)
      return 'error'
    }
    setQuiet(0)
    return apply(v)
  }, phase === 'working')

  const matches = typed.trim().toLowerCase() === DELETE_PHRASE

  const close = () => {
    setAsking(false)
    setTyped('')
    setProblem(null)
  }

  const submit = async () => {
    if (!matches) return
    setSending(true)
    setProblem(null)
    try {
      const res = await apiFetch('/api/settings/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: typed.trim() }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null
        setProblem(typeof body?.error === 'string' && body.error.length > 0 && body.error.length < 300 ? body.error : START_FAILED)
        return
      }
      started.current = true
      setError(null)
      setPhase('working')
      close()
    } catch {
      setProblem(START_FAILED)
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="card settings-card danger-zone" aria-labelledby="delete-title" aria-busy={phase === 'working' || phase === 'checking'}>
      <h2 className="settings-card-title" id="delete-title">
        Delete my account
      </h2>

      {!available ? (
        <p className="notice">Deleting an account isn’t available on a desk without accounts: there is only this one desk, and clearing it would wipe everything on it.</p>
      ) : (
        <>
          <p className="settings-note">
            This ends your account and erases everything you made, for good. If you want a copy first, make an export above and
            download it before you start.
          </p>

          <p className="sr-only" role="status">
            {phase === 'working' ? 'Deleting your account.' : phase === 'gone' ? 'Your account is deleted.' : ''}
          </p>

          {phase === 'working' && (
            <p className="notice">
              Deleting your account and everything in it. This can take a minute and keeps going if you close this page. When it is done
              you will be taken to sign-in.
              {quiet >= 3 && ' The studio isn’t answering just now. This page will keep trying.'}
            </p>
          )}
          {phase === 'gone' && <p className="notice">Your account is deleted. Taking you to sign-in…</p>}
          {phase === 'failed' && (
            <p className="notice" role="alert">
              {error ?? JOB_FAILED}
            </p>
          )}
          {problem && !asking && (
            <p className="notice" role="alert">
              {problem}
            </p>
          )}

          <div className="settings-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={phase === 'working' || phase === 'gone' || phase === 'checking'}
              onClick={() => setAsking(true)}
            >
              {phase === 'failed' ? 'Try the deletion again…' : 'Delete my account…'}
            </button>
            {/* Why the button is shut for a moment: it waits to learn whether a deletion is already running. */}
            {phase === 'checking' && <span className="settings-status">Checking whether a deletion is already under way…</span>}
          </div>
        </>
      )}

      {asking && (
        <SettingsDialog title="Delete your account?" busy={sending} onClose={close}>
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <p className="confirm-body">This can’t be undone, and nothing can be brought back afterwards.</p>
            <div className="settings-dialog-lists">
              <div className="settings-dialog-list">
                <h3>What goes</h3>
                <ul>
                  {GOES.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>
              <div className="settings-dialog-list">
                <h3>What stays</h3>
                <ul>
                  <li>A minimal record of the account: your account id and when it was created and deleted, no email. It stops the account being brought back by mistake.</li>
                  <li>The studio’s own anonymous spend totals, which hold no names and none of your work.</li>
                  <li>Server logs and backups, until they expire.</li>
                  <li>Rarely, a picture that no record of yours names, which cannot be traced to you to be removed.</li>
                </ul>
              </div>
            </div>
            <label className="field">
              <span className="field-label">
                Type “{DELETE_PHRASE}” to confirm
              </span>
              <input
                className="input"
                data-autofocus
                value={typed}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={sending}
                aria-describedby={problem ? 'delete-problem' : undefined}
                onChange={(e) => setTyped(e.target.value)}
              />
            </label>
            {problem && (
              <p className="notice" id="delete-problem" role="alert">
                {problem}
              </p>
            )}
            <div className="confirm-actions">
              <button type="button" className="btn btn-secondary" disabled={sending} onClick={close}>
                Keep my account
              </button>
              <button type="submit" className="btn btn-stamp" disabled={!matches || sending}>
                {sending ? 'Starting…' : 'Delete everything'}
              </button>
            </div>
          </form>
        </SettingsDialog>
      )}
    </section>
  )
}

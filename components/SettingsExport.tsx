'use client'

// Settings › Data and privacy › Export my data (v3, slice 21). One button asks
// the studio to pack the person's projects (as JSON) and their pictures into a
// single zip; the pack runs as a background job, so this panel shows where it
// is — nothing yet, working, ready to download, or failed with a way forward —
// and comes back to the right state when the page is reopened or reloaded (the
// state is read from the server, not remembered here). While it works the panel
// polls politely (`settings-poll.ts`: backs off, and pauses in a hidden tab).
// Only the latest export is kept; making a new one replaces it.
//
//   POST /api/settings/export            start
//   GET  /api/settings/export            { state: none | working | ready | failed, … }
//   GET  /api/settings/export/download   the zip (a plain link: the browser saves it)
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/components/api-fetch'
import { useBackoffPoll, type PollResult } from '@/components/settings-poll'

type ExportView = { state: 'none' | 'working' | 'ready' | 'failed'; jobId?: string; readyAt?: string; bytes?: number; error?: string }

const READ_FAILED = 'Your export couldn’t be checked just now. Try again in a moment.'
const START_FAILED = 'The export couldn’t be started just now. Try again in a moment.'
const JOB_FAILED = 'The export didn’t finish. Nothing was changed; try again in a moment.'

function isView(x: unknown): x is ExportView {
  const state = (x as { state?: unknown } | null)?.state
  return state === 'none' || state === 'working' || state === 'ready' || state === 'failed'
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function when(iso: string | undefined): string {
  const d = iso ? new Date(iso) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

/** A server sentence is shown when it is short; its absence is ours to cover. */
function sentence(x: unknown, fallback: string): string {
  return typeof x === 'string' && x.length > 0 && x.length < 300 ? x : fallback
}

export function SettingsExport() {
  const [view, setView] = useState<ExportView | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [quiet, setQuiet] = useState(0) // failed polls in a row

  const read = useCallback(async (): Promise<ExportView | null> => {
    try {
      const res = await apiFetch('/api/settings/export')
      const body: unknown = await res.json().catch(() => null)
      if (!res.ok || !isView(body)) return null
      return body
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    let live = true
    void read().then((v) => {
      if (!live) return
      if (v) setView(v)
      else setProblem(READ_FAILED)
    })
    return () => {
      live = false
    }
  }, [read])

  const working = view?.state === 'working'
  useBackoffPoll(async (): Promise<PollResult> => {
    const v = await read()
    if (!v) {
      setQuiet((n) => n + 1)
      return 'error'
    }
    setQuiet(0)
    setView(v)
    return v.state === 'working' ? 'again' : 'stop'
  }, working)

  const start = async () => {
    setStarting(true)
    setProblem(null)
    try {
      const res = await apiFetch('/api/settings/export', { method: 'POST' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null
        setProblem(sentence(body?.error, START_FAILED))
        return
      }
      setQuiet(0)
      setView({ state: 'working' })
    } catch {
      setProblem(START_FAILED)
    } finally {
      setStarting(false)
    }
  }

  return (
    <section id="export" className="card settings-card" aria-labelledby="export-title" aria-busy={working || view === null}>
      <h2 className="settings-card-title" id="export-title">
        Export my data
      </h2>
      <p className="settings-note">
        One zip with your account details, your settings, your shared links and, for every project, its data as JSON and all of its
        pictures. Only your latest export is kept: a new one replaces the last.
      </p>

      {/* One live region for the whole life of the panel, so a change from working to ready is announced. */}
      <p className="sr-only" role="status">
        {working ? 'Packing your export.' : view?.state === 'ready' ? 'Your export is ready to download.' : ''}
      </p>

      {view === null && !problem && <p className="settings-status">Checking for an export…</p>}

      {working && (
        <p className="notice">
          Packing your projects and pictures. This can take a minute, and it keeps going if you leave this page; come back and the zip will be
          here.
          {quiet >= 3 && ' The studio isn’t answering just now. This page will keep trying.'}
        </p>
      )}

      {view?.state === 'ready' && (
        <div>
          <dl className="data-facts">
            {view.readyAt && (
              <div>
                <dt>Made</dt>
                <dd>{when(view.readyAt)}</dd>
              </div>
            )}
            {typeof view.bytes === 'number' && (
              <div>
                <dt>Size</dt>
                <dd>{size(view.bytes)}</dd>
              </div>
            )}
          </dl>
          <p className="settings-note">Your export is ready.</p>
        </div>
      )}

      {view?.state === 'failed' && (
        <p className="notice" role="alert">
          {sentence(view.error, JOB_FAILED)}
        </p>
      )}

      {problem && (
        <p className="notice" role="alert">
          {problem}
        </p>
      )}

      <div className="settings-actions">
        {view?.state === 'ready' && (
          <a className="btn btn-stamp" href="/api/settings/export/download" download>
            Download my export{typeof view.bytes === 'number' ? ` (${size(view.bytes)})` : ''}
          </a>
        )}
        {view !== null && (
          <button
            type="button"
            className={`btn ${view.state === 'ready' || view.state === 'working' ? 'btn-secondary' : 'btn-stamp'}`}
            disabled={starting || working}
            onClick={() => void start()}
          >
            {starting || working ? 'Preparing…' : view.state === 'ready' ? 'Make a new export' : view.state === 'failed' ? 'Try again' : 'Export my data'}
          </button>
        )}
        {view === null && problem && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setProblem(null)
              void read().then((v) => (v ? setView(v) : setProblem(READ_FAILED)))
            }}
          >
            Check again
          </button>
        )}
      </div>
    </section>
  )
}

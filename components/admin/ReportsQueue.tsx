'use client'

// The admin's list of visitor reports (v3, slice 21): newest first, each with
// its reason, note, time, the share's title and whether it is still published,
// a link to the live share, and the two things an admin can do — Unpublish
// (behind a confirmation) and Mark handled. The page that renders this has
// already refused everyone who is not an admin; the buttons talk to
// `POST /api/admin/reports/[id]`, which checks again.
//
//   • The filter is a pair of toggle chips, kept here, not in the URL. A row
//     acted on while "Unhandled" is chosen stays on screen until the filter is
//     changed, so a button never vanishes under the hand that pressed it (focus
//     goes to the row, and a status line says what happened).
//   • Times are shown in UTC, written by `formatWhen`, so the server render and
//     the browser's agree.
//   • A failure is one calm sentence on that row, with the button still there
//     to try again. Nothing is optimistic: a row changes when the server says so.
import { useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { apiFetch } from '@/components/api-fetch'
import { REPORT_REASON_LABEL, formatWhen } from '@/lib/share/report-copy'
import type { AdminReportView } from '@/lib/share/report'

type Filter = 'all' | 'unhandled'
type Action = 'unpublish' | 'handled'

const FAILED = 'That didn’t go through. Try again in a moment.'

export function ReportsQueue({ initial, capped }: { initial: AdminReportView[]; capped: boolean }) {
  const [reports, setReports] = useState(initial)
  const [filter, setFilter] = useState<Filter>('all')
  // Rows acted on since the filter was chosen: they stay listed even if they no longer match.
  const [kept, setKept] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Record<string, Action | undefined>>({})
  const [problem, setProblem] = useState<Record<string, string | undefined>>({})
  const [confirming, setConfirming] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const rows = useRef(new Map<string, HTMLElement>())
  const triggers = useRef(new Map<string, HTMLButtonElement>())

  const waiting = reports.filter((r) => r.handledAt === null).length
  const shown = reports.filter((r) => filter === 'all' || r.handledAt === null || kept.has(r.id))

  function choose(next: Filter) {
    setFilter(next)
    setKept(new Set())
  }

  async function act(id: string, action: Action): Promise<boolean> {
    setBusy((b) => ({ ...b, [id]: action }))
    setProblem((p) => ({ ...p, [id]: undefined }))
    try {
      const res = await apiFetch(`/api/admin/reports/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = (await res.json().catch(() => null)) as { report?: AdminReportView; sameShare?: string[] } | null
      if (!res.ok || !data?.report) {
        setProblem((p) => ({ ...p, [id]: FAILED }))
        return false
      }
      const updated = data.report
      const siblings = new Set(action === 'unpublish' ? (data.sameShare ?? []) : [])
      setKept((k) => new Set(k).add(id))
      // An unpublish answers every report about that share, and none of them is live any more.
      setReports((list) =>
        list.map((r) => (r.id === updated.id ? updated : siblings.has(r.id) ? { ...r, live: false, path: null, title: null, handledAt: r.handledAt ?? updated.handledAt } : r))
      )
      setStatus(action === 'unpublish' ? 'The share is unpublished. Its link now shows the same page as one that never existed.' : 'Marked as handled.')
      rows.current.get(id)?.focus()
      return true
    } catch {
      setProblem((p) => ({ ...p, [id]: FAILED }))
      return false
    } finally {
      setBusy((b) => ({ ...b, [id]: undefined }))
    }
  }

  return (
    <section className="admin-queue" aria-labelledby="admin-queue-title">
      <div className="admin-queue-head">
        <h2 id="admin-queue-title" className="admin-queue-title">
          {reports.length === 0 ? 'No reports' : `${waiting} waiting · ${reports.length} in all`}
        </h2>
        <div className="admin-chips" role="group" aria-label="Show">
          <button type="button" className={`chip admin-chip${filter === 'all' ? ' is-selected' : ''}`} aria-pressed={filter === 'all'} onClick={() => choose('all')}>
            All
          </button>
          <button type="button" className={`chip admin-chip${filter === 'unhandled' ? ' is-selected' : ''}`} aria-pressed={filter === 'unhandled'} onClick={() => choose('unhandled')}>
            Unhandled
          </button>
        </div>
      </div>

      <p className="admin-status" role="status" aria-live="polite">
        {status}
      </p>

      {reports.length === 0 ? (
        <div className="card admin-empty">
          <p className="admin-empty-title">Nothing has been reported.</p>
          <p>When a visitor reports a shared page, it will appear here.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="card admin-empty">
          <p className="admin-empty-title">Nothing is waiting.</p>
          <p>Every report has been handled.</p>
        </div>
      ) : (
        <ul className="admin-list">
          {shown.map((r) => (
            <li key={r.id}>
              <article
                className={`card admin-report${r.handledAt !== null ? ' is-handled' : ''}`}
                tabIndex={-1}
                ref={(el) => {
                  if (el) rows.current.set(r.id, el)
                  else rows.current.delete(r.id)
                }}
                aria-labelledby={`report-${r.id}-title`}
              >
                <div className="admin-report-meta">
                  <span className="tag tag-neutral">{REPORT_REASON_LABEL[r.reason]}</span>
                  <span className={`tag ${r.live ? 'tag-outline' : 'tag-neutral'}`}>{r.live ? 'Published' : 'Unpublished'}</span>
                  {r.handledAt !== null && <span className="tag tag-neutral">Handled</span>}
                  <time className="admin-time" dateTime={r.at}>
                    {formatWhen(r.at)}
                  </time>
                </div>
                <h3 id={`report-${r.id}-title`} className="admin-report-title">
                  {r.title ?? 'Unpublished'}
                </h3>
                {r.note ? <p className="admin-note">{r.note}</p> : <p className="admin-note is-empty">No note.</p>}
                <div className="admin-actions">
                  {r.path && (
                    <a className="btn btn-secondary admin-btn" href={r.path} target="_blank" rel="noopener noreferrer">
                      Open the shared page
                    </a>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary admin-btn"
                    disabled={!r.live || busy[r.id] !== undefined}
                    ref={(el) => {
                      if (el) triggers.current.set(r.id, el)
                      else triggers.current.delete(r.id)
                    }}
                    onClick={() => setConfirming(r.id)}
                  >
                    Unpublish
                  </button>
                  <button type="button" className="btn btn-primary admin-btn" disabled={r.handledAt !== null || busy[r.id] !== undefined} onClick={() => void act(r.id, 'handled')}>
                    {busy[r.id] === 'handled' ? 'Saving…' : 'Mark handled'}
                  </button>
                </div>
                {problem[r.id] && (
                  <p className="notice" role="alert">
                    {problem[r.id]}
                  </p>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}

      {capped && <p className="admin-foot">Showing the latest {initial.length} reports.</p>}

      {confirming && (
        <ConfirmDialog
          title="Unpublish this share?"
          body="Its link will show the same page as a link that never existed, at once, and the pictures behind it stop opening. The owner keeps their project and can share it again with a new link."
          confirmLabel="Unpublish"
          cancelLabel="Keep it published"
          busyLabel="Unpublishing…"
          busy={busy[confirming] === 'unpublish'}
          onCancel={() => {
            const id = confirming
            setConfirming(null)
            requestAnimationFrame(() => triggers.current.get(id)?.focus())
          }}
          onConfirm={() => {
            const id = confirming
            void act(id, 'unpublish').then((done) => {
              setConfirming(null)
              if (!done) requestAnimationFrame(() => triggers.current.get(id)?.focus())
            })
          }}
        />
      )}
    </section>
  )
}

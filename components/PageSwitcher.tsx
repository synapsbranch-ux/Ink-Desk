'use client'

// The page switcher above the board (slice 11): one tab per page of the
// chapter with a small status — inked count, inking, failed, not generated —
// so the storyteller moves between pages without leaving the station. A tab
// is a labelled button; switching is a patch (`{ page: n }`) and the reply is
// already that page's desk. A page with a panel job waiting or drawing reads
// as inking (slice 18), whatever its summary says. Implements
// `devpost/prd.md > Pages — Generation, Lettering, Repair`.
import { pageJobCount } from '@/lib/activity'
import type { Activity } from '@/lib/queue/jobs'
import type { PageSummary } from '@/lib/types'

export type PageTone = 'blank' | 'waiting' | 'inking' | 'failed' | 'done'

/** One page's state in a few words — shared with the Director's page cards.
 *  `queued` is how many of its panels have a job waiting or drawing. */
export function pageStatus(summary: PageSummary | undefined, queued = 0): { label: string; tone: PageTone } {
  if (!summary || !summary.written) return { label: 'Not generated', tone: 'blank' }
  if (summary.inking > 0 || queued > 0) return { label: `Inking · ${summary.inked} of 4`, tone: 'inking' }
  if (summary.failed > 0) {
    return { label: `${summary.failed} didn’t come back · ${summary.inked} of 4`, tone: 'failed' }
  }
  if (summary.inked === 4) return { label: 'Complete · 4 of 4', tone: 'done' }
  return { label: `${summary.inked} of 4 inked`, tone: 'waiting' }
}

type Props = {
  pages: PageSummary[]
  activity: Activity | undefined
  /** The open page — the project's, so a click shows at once. */
  open: number
  onPick: (page: number) => void
}

export function PageSwitcher({ pages, activity, open, onPick }: Props) {
  return (
    <nav className="page-switcher" aria-label="Pages of the chapter">
      {pages.map((p) => {
        const status = pageStatus(p, pageJobCount(activity, p.index))
        const active = p.index === open
        return (
          <button
            key={p.index}
            type="button"
            className={`page-tab is-${status.tone}${active ? ' is-active' : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => {
              if (!active) onPick(p.index)
            }}
          >
            <span className="page-tab-num">Page {p.index + 1}</span>
            <span className="page-tab-status">{status.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

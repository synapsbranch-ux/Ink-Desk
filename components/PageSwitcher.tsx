'use client'

// The page switcher above the board (slice 11): one tab per page of the
// chapter with a small status — inked count, inking, failed, not generated —
// so the storyteller moves between pages without leaving the station. A tab
// is a labelled button; switching is a patch (`{ page: n }`) and the reply is
// already that page's desk. Implements `devpost/prd.md > Pages — Generation,
// Lettering, Repair`.
import type { PageSummary } from '@/lib/types'

export type PageTone = 'blank' | 'waiting' | 'inking' | 'failed' | 'done'

/** One page's state in a few words — shared with the Director's page cards. */
export function pageStatus(summary: PageSummary | undefined): { label: string; tone: PageTone } {
  if (!summary || !summary.written) return { label: 'Not generated', tone: 'blank' }
  if (summary.inking > 0) return { label: `Inking · ${summary.inked} of 4`, tone: 'inking' }
  if (summary.failed > 0) {
    return { label: `${summary.failed} didn’t come back · ${summary.inked} of 4`, tone: 'failed' }
  }
  if (summary.inked === 4) return { label: 'Complete · 4 of 4', tone: 'done' }
  return { label: `${summary.inked} of 4 inked`, tone: 'waiting' }
}

type Props = {
  pages: PageSummary[]
  /** The open page — the project's, so a click shows at once. */
  open: number
  onPick: (page: number) => void
}

export function PageSwitcher({ pages, open, onPick }: Props) {
  return (
    <nav className="page-switcher" aria-label="Pages of the chapter">
      {pages.map((p) => {
        const status = pageStatus(p)
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
